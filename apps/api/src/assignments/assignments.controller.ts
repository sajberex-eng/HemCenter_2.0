import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, StreamableFile, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import type { User } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { contentDisposition, maxUploadBytes } from '../files/file-rules';
import { AssignmentsService } from './assignments.service';
import { CreateAssignmentDto, DueRequestDto, RemoveDto, ReportDto, ReviewDto } from './dto';

const me = (req: Request) => req.user as User;

@Controller()
@UseGuards(JwtAuthGuard)
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Post('assignments')
  create(@Body() dto: CreateAssignmentDto, @Req() req: Request) {
    return this.assignments.create(me(req), dto, req.ip);
  }

  @Post('chats/:chatId/messages/:messageId/assignment')
  fromMessage(@Param('chatId', ParseUUIDPipe) chatId: string, @Param('messageId', ParseUUIDPipe) messageId: string, @Body() dto: CreateAssignmentDto, @Req() req: Request) {
    return this.assignments.createFromMessage(me(req), chatId, messageId, dto, req.ip);
  }

  @Get('assignments')
  list(@Req() req: Request, @Query('scope') scope?: string, @Query('state') state?: string, @Query('documentId') documentId?: string) {
    return this.assignments.list(me(req), { scope, state, documentId: documentId && /^[0-9a-f-]{36}$/.test(documentId) ? documentId : undefined });
  }

  @Get('assignments/summary')
  summary(@Req() req: Request) {
    return this.assignments.summary(me(req));
  }

  @Get('assignments/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.assignments.get(id, me(req));
  }

  @Post('assignments/:id/start')
  @HttpCode(200)
  start(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.assignments.start(me(req), id, req.ip);
  }

  @Post('assignments/:id/report')
  @HttpCode(200)
  @UseInterceptors(FilesInterceptor('files', 5, { limits: { fileSize: maxUploadBytes(), files: 5 } }))
  report(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportDto, @UploadedFiles() files: Express.Multer.File[] | undefined, @Req() req: Request) {
    return this.assignments.report(me(req), id, dto.text, files ?? [], req.ip);
  }

  @Post('assignments/:id/reports/:rid/accept')
  @HttpCode(200)
  accept(@Param('id', ParseUUIDPipe) id: string, @Param('rid', ParseUUIDPipe) rid: string, @Body() dto: ReviewDto, @Req() req: Request) {
    return this.assignments.review(me(req), id, rid, true, dto.comment, req.ip);
  }

  @Post('assignments/:id/reports/:rid/return')
  @HttpCode(200)
  returnReport(@Param('id', ParseUUIDPipe) id: string, @Param('rid', ParseUUIDPipe) rid: string, @Body() dto: ReviewDto, @Req() req: Request) {
    return this.assignments.review(me(req), id, rid, false, dto.comment, req.ip);
  }

  @Post('assignments/:id/due-requests')
  requestDue(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DueRequestDto, @Req() req: Request) {
    return this.assignments.requestDue(me(req), id, dto, req.ip);
  }

  @Post('assignments/:id/due-requests/:rid/approve')
  @HttpCode(200)
  approveDue(@Param('id', ParseUUIDPipe) id: string, @Param('rid', ParseUUIDPipe) rid: string, @Body() dto: ReviewDto, @Req() req: Request) {
    return this.assignments.decideDue(me(req), id, rid, true, dto.comment, req.ip);
  }

  @Post('assignments/:id/due-requests/:rid/reject')
  @HttpCode(200)
  rejectDue(@Param('id', ParseUUIDPipe) id: string, @Param('rid', ParseUUIDPipe) rid: string, @Body() dto: ReviewDto, @Req() req: Request) {
    return this.assignments.decideDue(me(req), id, rid, false, dto.comment, req.ip);
  }

  @Post('assignments/:id/remove')
  @HttpCode(200)
  remove(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RemoveDto, @Req() req: Request) {
    return this.assignments.remove(me(req), id, dto.reason, req.ip);
  }

  @Get('report-files/:id')
  async file(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { stream, name, mime, size } = await this.assignments.openFile(me(req), id);
    res.set({
      'Content-Type': mime,
      'Content-Disposition': contentDisposition(mime.startsWith('image/') ? 'inline' : 'attachment', name),
      'Content-Length': String(size),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(stream);
  }
}
