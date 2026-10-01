import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { User } from '@prisma/client';
import { AuthService, Tokens, toUserDto } from './auth.service';
import { AcceptInviteDto, ChangePasswordDto, LoginDto } from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';

const COOKIE = 'hc_refresh';

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

function setRefreshCookie(res: Response, t: Tokens) {
  res.cookie(COOKIE, t.refreshToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth',
    expires: t.refreshExpiresAt,
  });
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.login(dto.login, dto.password, meta(req));
    setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken, user: toUserDto(user) };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.refresh(req.cookies?.[COOKIE], meta(req));
    setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken, user: toUserDto(user) };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, { path: '/api/auth' });
  }

  @Post('logout-all')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async logoutAll(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.revokeAll((req.user as User).id);
    res.clearCookie(COOKIE, { path: '/api/auth' });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request) {
    return toUserDto(req.user as User);
  }

  @Post('change-password')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.changePassword(req.user as User, dto.currentPassword, dto.newPassword, req.ip);
    res.clearCookie(COOKIE, { path: '/api/auth' });
  }

  @Post('accept-invite')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async acceptInvite(@Body() dto: AcceptInviteDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.acceptInvite(dto.token, dto.password, dto.consent, meta(req));
    setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken, user: toUserDto(user) };
  }
}
