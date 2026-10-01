import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FilesService } from './files.service';
import { contentDisposition, maxUploadBytes } from './file-rules';

@Controller()
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  // multer's own cap is read once at start-up (it protects memory); the exact limit is re-checked per request.
  @Post('chats/:id/attachments')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: maxUploadBytes(), files: 1 } }))
  upload(@Param('id', ParseUUIDPipe) chatId: string, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    return this.files.upload(chatId, req.user!.id, file, req.ip);
  }

  @Get('attachments/:id')
  async download(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { attachment, stream } = await this.files.open(id, req.user!.id);
    const inline = attachment.mime.startsWith('image/');
    res.set({
      'Content-Type': attachment.mime,
      'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', attachment.name),
      'Content-Length': String(attachment.size),
      'X-Content-Type-Options': 'nosniff',
      // even if something dangerous slipped through, the browser may not run or embed it
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=300',
    });
    const file = new StreamableFile(stream);
    // a missing file on disk must not leak a server path in the error text
    file.setErrorHandler((_err, response) => {
      if (response.headersSent) return response.end();
      response.statusCode = 404;
      response.send(JSON.stringify({ statusCode: 404, message: 'ATTACHMENT_NOT_FOUND' }));
    });
    return file;
  }

  @Delete('attachments/:id')
  @HttpCode(204)
  async discard(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.files.discard(id, req.user!.id, req.ip);
  }
}
