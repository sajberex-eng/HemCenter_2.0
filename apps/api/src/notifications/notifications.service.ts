import { Injectable } from '@nestjs/common';
import type { NotificationDto, NotificationType } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PushService } from '../push/push.service';
import { PUSH_TEXT } from '../assignments/assignment-rules';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
  ) {}

  /** A line in each person's list, a live signal to open pages, and a push that carries no content of the work. */
  async send(userIds: string[], type: NotificationType, assignmentId: string | null) {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return;
    const rows = await Promise.all(ids.map((userId) => this.prisma.notification.create({ data: { userId, type, assignmentId } })));
    for (const r of rows) this.realtime.emit([r.userId], 'notification:new', { id: r.id, type, assignmentId, createdAt: r.createdAt.toISOString() });
    void this.push.notifyEvent(ids, PUSH_TEXT[type], assignmentId ? `/assignments/${assignmentId}` : '/assignments', assignmentId ? `assignment:${assignmentId}` : 'assignments');
  }

  async list(userId: string): Promise<{ items: NotificationDto[]; unread: number }> {
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items: rows.map((r) => ({ id: r.id, type: r.type as NotificationType, assignmentId: r.assignmentId, read: r.readAt !== null, createdAt: r.createdAt.toISOString() })), unread };
  }

  /** Marks the given lines read, or all of them when no ids are given. Only the person's own lines can be touched. */
  async markRead(userId: string, ids?: string[]) {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
    return this.list(userId);
  }
}
