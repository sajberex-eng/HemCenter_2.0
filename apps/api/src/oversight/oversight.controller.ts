import { Controller, Get, Param, ParseUUIDPipe, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { contentDisposition } from '../files/file-rules';
import { OversightService } from './oversight.service';

/** A non-negative whole number from a query string, or undefined. */
const int = (v?: string) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isInteger(n) && n >= 0 ? n : undefined;
};

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class OversightController {
  constructor(private readonly oversight: OversightService) {}

  @Get('oversight/chats')
  @Roles('MANAGEMENT')
  list(@Query('q') q: string | undefined, @Req() req: Request) {
    return this.oversight.listChats(req.user!.id, q, req.ip);
  }

  @Get('oversight/chats/:id')
  @Roles('MANAGEMENT')
  open(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.oversight.openChat(req.user!.id, id, req.ip);
  }

  @Get('oversight/chats/:id/messages')
  @Roles('MANAGEMENT')
  messages(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Query('before') before?: string,
    @Query('after') after?: string,
    @Query('around') around?: string,
    @Query('limit') limit?: string,
  ) {
    return this.oversight.readMessages(req.user!.id, id, { before: int(before), after: int(after), around: int(around), limit: int(limit) }, req.ip);
  }

  @Get('oversight/attachments/:attachmentId')
  @Roles('MANAGEMENT')
  async file(@Param('attachmentId', ParseUUIDPipe) attachmentId: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { attachment, stream } = await this.oversight.openFile(req.user!.id, attachmentId, req.ip);
    res.set({
      'Content-Type': attachment.mime,
      'Content-Disposition': contentDisposition(attachment.mime.startsWith('image/') ? 'inline' : 'attachment', attachment.name),
      'Content-Length': String(attachment.size),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(stream);
  }

  /** For the members of a chat: how many times management has opened it. Everyone else gets 404. */
  @Get('chats/:id/oversight')
  views(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.oversight.viewsOf(id, req.user!.id);
  }
}
