import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { LOCKOUT_MINUTES, MAX_FAILED_LOGINS, UserDto } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { TotpService, mfaSetupRequired } from './totp.service';
import { RealtimeService } from '../realtime/realtime.service';
import { checkPasswordPolicy, hashPassword, randomToken, sha256, verifyPassword } from '../common/password';

const REFRESH_DAYS = 14;
export const REFRESH_GRACE_MS = 10_000;
// Verifying against a real dummy hash keeps response time the same for unknown logins.
const DUMMY_HASH = hashPassword('dummy-password-for-timing');

export const toUserDto = (u: User): UserDto => ({
  id: u.id,
  login: u.login,
  fullName: u.fullName,
  phone: u.phone,
  email: u.email,
  roles: u.roles,
  locale: u.locale,
  isActive: u.isActive,
  mustChangePassword: u.mustChangePassword,
  totpEnabled: u.totpEnabled,
  mfaSetupRequired: mfaSetupRequired(u),
  departmentId: u.departmentId,
  positionId: u.positionId,
});

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly totp: TotpService,
    private readonly realtime: RealtimeService,
  ) {}

  private async issueTokens(user: User, meta: { ip?: string; userAgent?: string }): Promise<Tokens> {
    const refreshToken = randomToken();
    const refreshExpiresAt = new Date(Date.now() + REFRESH_DAYS * 86400_000);
    await this.prisma.session.create({
      data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt: refreshExpiresAt, ip: meta.ip, userAgent: meta.userAgent },
    });
    const accessToken = await this.jwt.signAsync({ sub: user.id, tv: user.tokenVersion });
    return { accessToken, refreshToken, refreshExpiresAt };
  }

  /** Counts a failed password or 2FA code; locks the account after MAX_FAILED_LOGINS in a row. */
  private async registerFailure(user: User, ip: string | undefined, code = 'INVALID_CREDENTIALS'): Promise<never> {
    const failed = user.failedLogins + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null },
    });
    await this.audit.log({ actorId: user.id, action: lock ? 'auth.account_locked' : 'auth.login_failed', ip });
    throw new UnauthorizedException(code);
  }

  private async completeLogin(user: User, meta: { ip?: string; userAgent?: string }) {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.audit.log({ actorId: user.id, action: 'auth.login', ip: meta.ip });
    return { user: updated, tokens: await this.issueTokens(updated, meta) };
  }

  /**
   * Step 1. Without 2FA this finishes the login. With 2FA the password is only half the proof:
   * the failure counter is deliberately NOT reset here, otherwise someone who knows the password
   * could alternate it with wrong codes and guess the 6 digits without ever being locked out.
   */
  async login(login: string, password: string, meta: { ip?: string; userAgent?: string }) {
    const user = await this.prisma.user.findUnique({ where: { login: login.trim().toLowerCase() } });
    if (!user) {
      await verifyPassword(await DUMMY_HASH, password);
      await this.audit.log({ action: 'auth.login_failed', data: { login }, ip: meta.ip });
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.log({ actorId: user.id, action: 'auth.login_locked', ip: meta.ip });
      throw new ForbiddenException('ACCOUNT_LOCKED');
    }
    const ok = user.isActive && (await verifyPassword(user.passwordHash, password));
    if (!ok) return this.registerFailure(user, meta.ip);
    if (user.totpEnabled) {
      const mfaToken = await this.jwt.signAsync({ sub: user.id, purpose: 'mfa' }, { expiresIn: '5m' });
      return { mfaRequired: true as const, mfaToken };
    }
    return { mfaRequired: false as const, ...(await this.completeLogin(user, meta)) };
  }

  /** Step 2 of a 2FA login: authenticator code or one-time recovery code. */
  async loginTotp(mfaToken: string, code: string, meta: { ip?: string; userAgent?: string }) {
    let payload: { sub: string; purpose?: string };
    try {
      payload = await this.jwt.verifyAsync(mfaToken);
    } catch {
      throw new UnauthorizedException('UNAUTHORIZED');
    }
    if (payload.purpose !== 'mfa') throw new UnauthorizedException('UNAUTHORIZED');
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive || !user.totpEnabled) throw new UnauthorizedException('UNAUTHORIZED');
    if (user.lockedUntil && user.lockedUntil > new Date()) throw new ForbiddenException('ACCOUNT_LOCKED');
    if (!(await this.totp.verifyLogin(user, code))) return this.registerFailure(user, meta.ip, 'TOTP_CODE_INVALID');
    return this.completeLogin(user, meta);
  }

  /**
   * Rotating refresh token: the presented token is revoked and a new one is issued.
   * A browser can lose the new cookie (a reload cancels the response while the server has already rotated)
   * or two tabs can present the same cookie at once. A token rotated less than REFRESH_GRACE_MS ago is therefore
   * still honoured; a replay after that suggests theft and burns every session of the user.
   */
  async refresh(token: string | undefined, meta: { ip?: string; userAgent?: string }) {
    if (!token) throw new UnauthorizedException('UNAUTHORIZED');
    const session = await this.prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    const inGrace = !!session?.revokedAt && Date.now() - session.revokedAt.getTime() < REFRESH_GRACE_MS;
    if (!session || (session.revokedAt && !inGrace) || session.expiresAt < new Date() || !session.user.isActive) {
      if (session && session.revokedAt && !inGrace) {
        await this.revokeAll(session.userId);
        await this.audit.log({ actorId: session.userId, action: 'auth.refresh_reuse_detected', ip: meta.ip });
      }
      throw new UnauthorizedException('UNAUTHORIZED');
    }
    if (!session.revokedAt) await this.prisma.session.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return { user: session.user, tokens: await this.issueTokens(session.user, meta) };
  }

  async logout(token: string | undefined) {
    if (!token) return;
    await this.prisma.session.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Logs the user out of every device (access tokens are invalidated via tokenVersion). */
  async revokeAll(userId: string) {
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
      this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    this.realtime.disconnectUser(userId);
  }

  async changePassword(user: User, current: string, next: string, ip?: string) {
    if (!(await verifyPassword(user.passwordHash, current))) throw new UnauthorizedException('INVALID_CREDENTIALS');
    const problem = checkPasswordPolicy(next);
    if (problem) throw new BadRequestException(problem);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } });
    await this.revokeAll(user.id);
    await this.audit.log({ actorId: user.id, action: 'auth.password_changed', ip });
  }

  async acceptInvite(token: string, password: string, consent: boolean, meta: { ip?: string; userAgent?: string }) {
    if (!consent) throw new BadRequestException('CONSENT_REQUIRED');
    const problem = checkPasswordPolicy(password);
    if (problem) throw new BadRequestException(problem);
    const invite = await this.prisma.invitation.findUnique({ where: { tokenHash: sha256(token) } });
    if (!invite || invite.usedAt || invite.expiresAt < new Date()) throw new BadRequestException('INVITE_INVALID');
    const [user] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: invite.userId },
        data: { passwordHash: await hashPassword(password), mustChangePassword: false, consentAt: new Date(), isActive: true },
      }),
      this.prisma.invitation.update({ where: { id: invite.id }, data: { usedAt: new Date() } }),
    ]);
    await this.audit.log({ actorId: user.id, action: 'auth.invite_accepted', ip: meta.ip });
    return { user, tokens: await this.issueTokens(user, meta) };
  }
}
