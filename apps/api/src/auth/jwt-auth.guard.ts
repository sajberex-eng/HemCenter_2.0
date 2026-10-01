import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';

export interface AccessPayload {
  sub: string;
  tv?: number;
  purpose?: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('UNAUTHORIZED');
    let payload: AccessPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(header.slice(7));
    } catch {
      throw new UnauthorizedException('UNAUTHORIZED');
    }
    // A half-finished 2FA login token must never work as an access token.
    if (payload.purpose || payload.tv === undefined) throw new UnauthorizedException('UNAUTHORIZED');
    // Permissions are re-read from the database on every request (TZ 4.2).
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive || user.tokenVersion !== payload.tv) throw new UnauthorizedException('UNAUTHORIZED');
    req.user = user;
    return true;
  }
}
