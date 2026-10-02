import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MeetingsService } from './meetings.service';
import { CreateMeetingDto, ItemDto, ProtocolDto, ResolutionDto, UpdateItemDto, UpdateMeetingDto, UpdateResolutionDto } from './dto';

const me = (req: Request) => req.user as User;

@Controller('meetings')
@UseGuards(JwtAuthGuard)
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Post()
  create(@Body() dto: CreateMeetingDto, @Req() req: Request) {
    return this.meetings.create(me(req), dto, req.ip);
  }

  @Get()
  list(@Req() req: Request) {
    return this.meetings.list(me(req));
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.meetings.get(id, me(req));
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMeetingDto, @Req() req: Request) {
    return this.meetings.update(id, me(req), dto, req.ip);
  }

  @Put(':id/participants/:userId')
  addParticipant(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Req() req: Request) {
    return this.meetings.setParticipant(id, me(req), userId, true, req.ip);
  }

  @Delete(':id/participants/:userId')
  removeParticipant(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Req() req: Request) {
    return this.meetings.setParticipant(id, me(req), userId, false, req.ip);
  }

  @Post(':id/items')
  addItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ItemDto, @Req() req: Request) {
    return this.meetings.addItem(id, me(req), dto, req.ip);
  }

  @Patch(':id/items/:itemId')
  updateItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: UpdateItemDto, @Req() req: Request) {
    return this.meetings.updateItem(id, itemId, me(req), dto, req.ip);
  }

  @Delete(':id/items/:itemId')
  removeItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Req() req: Request) {
    return this.meetings.removeItem(id, itemId, me(req), req.ip);
  }

  @Post(':id/items/:itemId/resolutions')
  addResolution(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: ResolutionDto, @Req() req: Request) {
    return this.meetings.addResolution(id, itemId, me(req), dto, req.ip);
  }

  @Patch(':id/resolutions/:rid')
  updateResolution(@Param('id', ParseUUIDPipe) id: string, @Param('rid', ParseUUIDPipe) rid: string, @Body() dto: UpdateResolutionDto, @Req() req: Request) {
    return this.meetings.updateResolution(id, rid, me(req), dto, req.ip);
  }

  @Delete(':id/resolutions/:rid')
  removeResolution(@Param('id', ParseUUIDPipe) id: string, @Param('rid', ParseUUIDPipe) rid: string, @Req() req: Request) {
    return this.meetings.removeResolution(id, rid, me(req), req.ip);
  }

  @Post(':id/protocol')
  @HttpCode(200)
  protocol(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ProtocolDto, @Req() req: Request) {
    return this.meetings.makeProtocol(id, me(req), dto, req.ip);
  }
}
