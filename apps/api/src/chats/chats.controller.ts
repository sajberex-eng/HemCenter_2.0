import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatsService } from './chats.service';
import { MessagesService } from './messages.service';
import { PinsService } from './pins.service';
import { PinDto, AddMembersDto, CreateDirectDto, CreateGroupDto, EditMessageDto, MarkReadDto, NotifyModeDto, SendMessageDto, UpdateGroupDto } from './dto';

const uid = (req: Request) => req.user!.id;
/** A non-negative whole number from a query string, or undefined (so junk like "abc" is ignored, not a crash). */
const int = (v?: string) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isInteger(n) && n >= 0 ? n : undefined;
};

@Controller('chats')
@UseGuards(JwtAuthGuard)
export class ChatsController {
  constructor(private readonly chats: ChatsService, private readonly messages: MessagesService, private readonly pins: PinsService) {}

  @Get()
  list(@Req() req: Request) {
    return this.chats.list(uid(req));
  }

  @Post('direct')
  @HttpCode(200)
  direct(@Body() dto: CreateDirectDto, @Req() req: Request) {
    return this.chats.createDirect(uid(req), dto.userId);
  }

  @Post('groups')
  group(@Body() dto: CreateGroupDto, @Req() req: Request) {
    return this.chats.createGroup(uid(req), dto.title, dto.memberIds, req.ip);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.chats.get(id, uid(req));
  }

  @Patch(':id')
  rename(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGroupDto, @Req() req: Request) {
    return this.chats.rename(id, uid(req), dto.title, req.ip);
  }

  @Post(':id/members')
  @HttpCode(200)
  addMembers(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMembersDto, @Req() req: Request) {
    return this.chats.addMembers(id, uid(req), dto.userIds, req.ip);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  removeMember(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Req() req: Request) {
    return this.chats.removeMember(id, uid(req), userId, req.ip);
  }

  @Patch(':id/me')
  notifyMode(@Param('id', ParseUUIDPipe) id: string, @Body() dto: NotifyModeDto, @Req() req: Request) {
    return this.chats.setNotifyMode(id, uid(req), dto.notifyMode);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkReadDto, @Req() req: Request) {
    return this.chats.markRead(id, uid(req), dto.seq);
  }

  @Get(':id/messages')
  listMessages(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Query('before') before?: string, @Query('around') around?: string, @Query('after') after?: string, @Query('limit') limit?: string) {
    return this.messages.list(id, uid(req), {
      before: int(before),
      around: int(around),
      after: int(after),
      limit: int(limit),
    });
  }

  @Post(':id/messages')
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto, @Req() req: Request) {
    return this.messages.create(id, uid(req), dto);
  }

  @Patch(':id/messages/:messageId')
  edit(@Param('id', ParseUUIDPipe) id: string, @Param('messageId', ParseUUIDPipe) messageId: string, @Body() dto: EditMessageDto, @Req() req: Request) {
    return this.messages.edit(id, messageId, uid(req), dto, req.ip);
  }

  @Delete(':id/messages/:messageId')
  remove(@Param('id', ParseUUIDPipe) id: string, @Param('messageId', ParseUUIDPipe) messageId: string, @Req() req: Request) {
    return this.messages.remove(id, messageId, uid(req), req.ip);
  }

  @Get(':id/pins')
  listPins(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.pins.list(id, uid(req));
  }

  @Post(':id/pins')
  @HttpCode(200)
  pin(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PinDto, @Req() req: Request) {
    return this.pins.pin(id, uid(req), dto.messageId, req.ip);
  }

  @Delete(':id/pins/:messageId')
  @HttpCode(204)
  unpin(@Param('id', ParseUUIDPipe) id: string, @Param('messageId', ParseUUIDPipe) messageId: string, @Req() req: Request) {
    return this.pins.unpin(id, uid(req), messageId, req.ip);
  }
}
