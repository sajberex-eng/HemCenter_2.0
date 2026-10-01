import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { Secret, TOTP } from 'otpauth';
import { TOTP_RECOVERY_CODES } from '@hemcenter/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { decryptSecret, encryptSecret } from '../common/crypto';
import { randomToken, sha256, verifyPassword } from '../common/password';

const PERIOD = 30;

/** Administrators must use 2FA (TZ 4.2). Read at call time so tests can toggle it. */
export const requireAdminTotp = () => process.env.REQUIRE_ADMIN_TOTP !== 'false';

export const mfaSetupRequired = (u: Pick<User, 'roles' | 'totpEnabled'>) =>
  requireAdminTotp() && u.roles.includes('ADMIN') && !u.totpEnabled;

const makeTotp = (secret: Secret | string, label: string) =>
  new TOTP({
    issuer: 'HemCenter',
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: PERIOD,
    secret: typeof secret === 'string' ? Secret.fromBase32(secret) : secret,
  });

@Injectable()
export class TotpService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Starts enrolment: stores a new pending secret (not active until confirmed with a valid code). */
  async setup(user: User) {
    if (user.totpEnabled) throw new ConflictException('TOTP_ALREADY_ENABLED');
    const secret = new Secret({ size: 20 });
    await this.prisma.user.update({ where: { id: user.id }, data: { totpSecretEnc: encryptSecret(secret.base32), totpLastStep: null } });
    return { secret: secret.base32, uri: makeTotp(secret, user.login).toString() };
  }

  async enable(user: User, code: string, ip?: string) {
    if (user.totpEnabled) throw new ConflictException('TOTP_ALREADY_ENABLED');
    if (!user.totpSecretEnc) throw new BadRequestException('TOTP_NOT_STARTED');
    if (!(await this.checkCode(user, code))) throw new BadRequestException('TOTP_CODE_INVALID');
    const codes = Array.from({ length: TOTP_RECOVERY_CODES }, () => randomToken(6));
    await this.prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true, totpRecoveryHashes: codes.map(sha256) } });
    await this.audit.log({ actorId: user.id, action: 'auth.totp_enabled', ip });
    return { recoveryCodes: codes };
  }

  async disable(user: User, password: string, ip?: string) {
    if (requireAdminTotp() && user.roles.includes('ADMIN')) throw new ForbiddenException('MFA_REQUIRED_FOR_ADMIN');
    if (!(await verifyPassword(user.passwordHash, password))) throw new UnauthorizedException('INVALID_CREDENTIALS');
    await this.clear(user.id);
    await this.audit.log({ actorId: user.id, action: 'auth.totp_disabled', ip });
  }

  clear(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: false, totpSecretEnc: null, totpLastStep: null, totpRecoveryHashes: [] },
    });
  }

  /**
   * Accepts a current authenticator code (once per 30-second step, so a sniffed code cannot be replayed)
   * or a recovery code (consumed on use).
   */
  async verifyLogin(user: User, code: string): Promise<boolean> {
    const clean = code.replace(/\s+/g, '');
    if (/^\d{6}$/.test(clean)) return this.checkCode(user, clean);
    const hash = sha256(clean);
    if (!user.totpRecoveryHashes.includes(hash)) return false;
    // updateMany with the hash in the filter makes consumption atomic: only one concurrent request wins
    const res = await this.prisma.user.updateMany({
      where: { id: user.id, totpRecoveryHashes: { has: hash } },
      data: { totpRecoveryHashes: user.totpRecoveryHashes.filter((h) => h !== hash) },
    });
    return res.count === 1;
  }

  private async checkCode(user: User, code: string): Promise<boolean> {
    if (!user.totpSecretEnc || !/^\d{6}$/.test(code)) return false;
    const delta = makeTotp(decryptSecret(user.totpSecretEnc), user.login).validate({ token: code, window: 1 });
    if (delta === null) return false;
    const step = Math.floor(Date.now() / 1000 / PERIOD) + delta;
    // Conditional update: a code (or any earlier one) that was already used is rejected, even under concurrency.
    const res = await this.prisma.user.updateMany({
      where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    return res.count === 1;
  }
}
