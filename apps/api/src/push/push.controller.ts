import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsISO8601, IsOptional, IsString, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PushService } from './push.service';

class KeysDto {
  @IsString() @MaxLength(200) @Matches(/^[A-Za-z0-9_-]+={0,2}$/) p256dh: string;
  @IsString() @MaxLength(100) @Matches(/^[A-Za-z0-9_-]+={0,2}$/) auth: string;
}

class SubscribeDto {
  @IsString() @MaxLength(2000) endpoint: string;
  @ValidateNested() @Type(() => KeysDto) keys: KeysDto;
}

class UnsubscribeDto {
  @IsString() @MaxLength(2000) endpoint: string;
}

class SettingsDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsISO8601() dndUntil?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(5) quietStart?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(5) quietEnd?: string | null;
}

@Controller('push')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('config')
  config() {
    return this.push.config();
  }

  @Post('subscriptions')
  @HttpCode(204)
  async subscribe(@Body() dto: SubscribeDto, @Req() req: Request) {
    await this.push.subscribe(req.user!.id, { endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth }, req.headers['user-agent'], req.ip);
  }

  @Delete('subscriptions')
  @HttpCode(204)
  async unsubscribe(@Body() dto: UnsubscribeDto, @Req() req: Request) {
    await this.push.unsubscribe(req.user!.id, dto.endpoint);
  }

  @Get('settings')
  settings(@Req() req: Request) {
    return this.push.settings(req.user!.id);
  }

  @Patch('settings')
  updateSettings(@Body() dto: SettingsDto, @Req() req: Request) {
    return this.push.updateSettings(req.user!.id, dto);
  }
}
