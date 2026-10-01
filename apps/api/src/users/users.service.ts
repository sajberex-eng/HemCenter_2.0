import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService, toUserDto } from '../auth/auth.service';
import { TotpService } from '../auth/totp.service';
import { hashPassword, randomToken, sha256 } from '../common/password';
import { CreateUserDto, UpdateUserDto } from './dto';

const INVITE_DAYS = 7;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly totp: TotpService,
  ) {}

  async list(params: { q?: string; departmentId?: string; includeInactive?: boolean }) {
    const q = params.q?.trim();
    const users = await this.prisma.user.findMany({
      where: {
        isExternal: false, // names from imported chats are not part of the staff directory
        isActive: params.includeInactive ? undefined : true,
        departmentId: params.departmentId,
        OR: q
          ? [
              { fullName: { contains: q, mode: 'insensitive' } },
              { login: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
            ]
          : undefined,
      },
      orderBy: { fullName: 'asc' },
    });
    return users.map(toUserDto);
  }

  async get(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('USER_NOT_FOUND');
    return toUserDto(u);
  }

  private async createInvitation(userId: string) {
    const token = randomToken();
    await this.prisma.invitation.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    await this.prisma.invitation.create({
      data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) },
    });
    return token;
  }

  /** Creates an account without a usable password; the employee sets it through the invitation link. */
  async create(dto: CreateUserDto, actorId: string, ip?: string) {
    try {
      const user = await this.prisma.user.create({
        data: {
          login: dto.login.toLowerCase(),
          // random unusable password until the invitation is accepted
          passwordHash: await hashPassword(randomToken()),
          fullName: dto.fullName,
          phone: dto.phone,
          email: dto.email,
          roles: dto.roles,
          locale: dto.locale,
          departmentId: dto.departmentId,
          positionId: dto.positionId,
        },
      });
      const inviteToken = await this.createInvitation(user.id);
      await this.audit.log({ actorId, action: 'user.created', entityType: 'User', entityId: user.id, data: { roles: dto.roles }, ip });
      return { user: toUserDto(user), inviteToken, inviteDays: INVITE_DAYS };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('LOGIN_TAKEN');
      throw e;
    }
  }

  async update(id: string, dto: UpdateUserDto, actorId: string, ip?: string) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('USER_NOT_FOUND');
    if (id === actorId && (dto.isActive === false || (dto.roles && !dto.roles.includes('ADMIN') && before.roles.includes('ADMIN')))) {
      throw new BadRequestException('CANNOT_REMOVE_OWN_ADMIN');
    }
    const user = await this.prisma.user.update({ where: { id }, data: dto });
    // Role or activation changes take effect immediately: kick the user out of all sessions.
    if (dto.isActive === false || dto.roles) await this.auth.revokeAll(id);
    await this.audit.log({ actorId, action: 'user.updated', entityType: 'User', entityId: id, data: dto as Prisma.InputJsonValue, ip });
    return toUserDto(user);
  }

  /** Reset: new invitation link, old sessions revoked. */
  async resetAccess(id: string, actorId: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('USER_NOT_FOUND');
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(randomToken()), mustChangePassword: true } });
    await this.auth.revokeAll(id);
    const inviteToken = await this.createInvitation(id);
    await this.audit.log({ actorId, action: 'user.access_reset', entityType: 'User', entityId: id, ip });
    return { inviteToken, inviteDays: INVITE_DAYS };
  }

  /** For an employee who lost the authenticator device: they sign in with the password and enrol again. */
  async resetTotp(id: string, actorId: string, ip?: string) {
    if (!(await this.prisma.user.findUnique({ where: { id } }))) throw new NotFoundException('USER_NOT_FOUND');
    await this.totp.clear(id);
    await this.auth.revokeAll(id);
    await this.audit.log({ actorId, action: 'user.totp_reset', entityType: 'User', entityId: id, ip });
  }
}
