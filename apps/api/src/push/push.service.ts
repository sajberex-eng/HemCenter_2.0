import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { MessageDto } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { PushSender } from './push-sender';
import { buildPayload, isAllowedPushEndpoint, parseClock, shouldNotify } from './push-rules';

const MAX_FAILURES = 5;

@Injectable()
export class PushService {
  private readonly log = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private sender: PushSender,
  ) {}

  /** For tests: replace the real push sender with a fake. */
  useSender(sender: PushSender) {
    this.sender = sender;
  }

  get enabled() {
    return !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
  }

  private get timeZone() {
    return process.env.APP_TIMEZONE ?? 'Asia/Almaty';
  }

  config() {
    return { enabled: this.enabled, publicKey: this.enabled ? process.env.VAPID_PUBLIC_KEY! : null };
  }

  /** Registers (or re-registers) this device. An endpoint that was used by another account moves to the current one. */
  async subscribe(userId: string, sub: { endpoint: string; p256dh: string; auth: string }, userAgent?: string, ip?: string) {
    if (!isAllowedPushEndpoint(sub.endpoint)) throw new BadRequestException('PUSH_ENDPOINT_NOT_ALLOWED');
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId, ...sub, userAgent: userAgent?.slice(0, 300) },
      update: { userId, p256dh: sub.p256dh, auth: sub.auth, userAgent: userAgent?.slice(0, 300), failures: 0 },
    });
    await this.audit.log({ actorId: userId, action: 'push.subscribed', ip });
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
  }

  async settings(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { dndUntil: true, quietStart: true, quietEnd: true, pushSubscriptions: { select: { id: true } } } });
    return { dndUntil: u.dndUntil?.toISOString() ?? null, quietStart: u.quietStart, quietEnd: u.quietEnd, devices: u.pushSubscriptions.length };
  }

  async updateSettings(userId: string, input: { dndUntil?: string | null; quietStart?: string | null; quietEnd?: string | null }) {
    const data: { dndUntil?: Date | null; quietStart?: string | null; quietEnd?: string | null } = {};
    if (input.dndUntil !== undefined) data.dndUntil = input.dndUntil ? new Date(input.dndUntil) : null;
    for (const k of ['quietStart', 'quietEnd'] as const) {
      const v = input[k];
      if (v === undefined) continue;
      if (v !== null && parseClock(v) === null) throw new BadRequestException('INVALID_TIME');
      data[k] = v;
    }
    await this.prisma.user.update({ where: { id: userId }, data });
    return this.settings(userId);
  }

  /**
   * Sends the generic "new message" notification to everyone in the chat who should get one.
   * Never throws: a failure here must not affect sending the message itself.
   */
  async notifyNewMessage(message: MessageDto, members: { userId: string; notifyMode: 'ALL' | 'MENTIONS' | 'NONE' }[]): Promise<void> {
    try {
      if (!this.enabled) return;
      const now = new Date();
      const author = await this.prisma.user.findUnique({ where: { id: message.authorId }, select: { fullName: true } });
      if (!author) return;
      const users = await this.prisma.user.findMany({
        where: { id: { in: members.filter((m) => m.userId !== message.authorId).map((m) => m.userId) }, isActive: true, pushSubscriptions: { some: {} } },
        select: { id: true, locale: true, dndUntil: true, quietStart: true, quietEnd: true, pushSubscriptions: true },
      });
      const modeOf = new Map(members.map((m) => [m.userId, m.notifyMode]));
      await Promise.all(
        users.flatMap((u) => {
          const ok = shouldNotify({ userId: u.id, notifyMode: modeOf.get(u.id) ?? 'ALL', dndUntil: u.dndUntil, quietStart: u.quietStart, quietEnd: u.quietEnd }, message, now, this.timeZone);
          if (!ok) return [];
          const payload = JSON.stringify(buildPayload(u.locale, author.fullName, message.chatId, message.mentionIds.includes(u.id)));
          return u.pushSubscriptions.map((s) => this.deliver(s, payload));
        }),
      );
    } catch (e) {
      this.log.warn(`push failed: ${(e as Error).message}`);
    }
  }

  private async deliver(sub: { id: string; endpoint: string; p256dh: string; auth: string; failures: number }, payload: string) {
    try {
      await this.sender.send(sub, payload);
      await this.prisma.pushSubscription.update({ where: { id: sub.id }, data: { failures: 0, lastSuccessAt: new Date() } });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // 404/410: the browser says this subscription no longer exists; any other error is retried next time,
      // but a device that keeps failing is dropped so it does not slow every message down.
      if (status === 404 || status === 410 || sub.failures + 1 >= MAX_FAILURES) await this.prisma.pushSubscription.deleteMany({ where: { id: sub.id } });
      else await this.prisma.pushSubscription.update({ where: { id: sub.id }, data: { failures: { increment: 1 } } }).catch(() => undefined);
    }
  }
}
