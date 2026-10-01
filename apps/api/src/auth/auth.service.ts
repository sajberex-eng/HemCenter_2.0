import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { LOCKOUT_MINUTES, MAX_FAILED_LOGINS, UserDto } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { checkPasswordPolicy, hashPassword, randomToken, sha256, verifyPassword } from '../common/password';

const REFRESH_DAYS = 14;
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
    if (!ok) {
      const failed = user.failedLogins + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null },
      });
      await this.audit.log({ actorId: user.id, action: lock ? 'auth.account_locked' : 'auth.login_failed', ip: meta.ip });
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.audit.log({ actorId: user.id, action: 'auth.login', ip: meta.ip });
    return { user: updated, tokens: await this.issueTokens(updated, meta) };
  }

  /** Rotating refresh token: the presented token is revoked and a new one is issued. */
  async refresh(token: string | undefined, meta: { ip?: string; userAgent?: string }) {
    if (!token) throw new UnauthorizedException('UNAUTHORIZED');
    const session = await this.prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) {
      if (session && session.revokedAt) {
        // Reuse of a rotated token suggests theft: drop every session of this user.
        await this.revokeAll(session.userId);
        await this.audit.log({ actorId: session.userId, action: 'auth.refresh_reuse_detected', ip: meta.ip });
      }
      throw new UnauthorizedException('UNAUTHORIZED');
    }
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
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
