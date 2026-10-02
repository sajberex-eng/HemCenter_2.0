import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

class MarkReadDto {
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID(undefined, { each: true }) ids?: string[];
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Req() req: Request) {
    return this.notifications.list(req.user!.id);
  }

  @Post('read')
  @HttpCode(200)
  read(@Body() dto: MarkReadDto, @Req() req: Request) {
    return this.notifications.markRead(req.user!.id, dto.ids);
  }
}
