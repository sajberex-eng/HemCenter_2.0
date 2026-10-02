import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@hemcenter/shared';
import { mfaSetupRequired } from './totp.service';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required?.length) return true;
    const user = ctx.switchToHttp().getRequest().user as { roles: Role[]; totpEnabled: boolean } | undefined;
    if (!user || !user.roles.some((r) => required.includes(r))) throw new ForbiddenException('FORBIDDEN');
    // An administrator or manager without 2FA is locked out of privileged endpoints until they enrol (TZ 4.2).
    if ((required.includes('ADMIN') || required.includes('MANAGEMENT')) && mfaSetupRequired(user)) throw new ForbiddenException('MFA_SETUP_REQUIRED');
    return true;
  }
}
