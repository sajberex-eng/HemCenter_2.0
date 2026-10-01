import { Controller, Get, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SearchService } from './search.service';

@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('messages')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  messages(@Req() req: Request, @Query('q') q = '', @Query('chatId', new ParseUUIDPipe({ optional: true })) chatId?: string, @Query('offset') offset?: string) {
    return this.search.messages(req.user!.id, q, { chatId, offset: Number.isInteger(Number(offset)) && Number(offset) > 0 ? Number(offset) : 0 });
  }
}
