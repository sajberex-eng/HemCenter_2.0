import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import type { User } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { contentDisposition } from '../files/file-rules';
import { DocumentsService } from './documents.service';
import { KindsTemplatesService, MAX_TEMPLATE_BYTES } from './kinds-templates.service';
import { CreateDocumentDto, CreateKindDto, UpdateDocumentDto, UpdateKindDto, UploadTemplateDto } from './dto';

const me = (req: Request) => req.user as User;
const isSecretary = (u: User) => u.roles.includes('SECRETARY') || u.roles.includes('ADMIN');

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService, private readonly kinds: KindsTemplatesService) {}

  // ---- kinds & templates (the secretary's directory) ----
  @Get('document-kinds')
  listKinds(@Req() req: Request, @Query('all') all?: string) {
    return this.kinds.listKinds(all === '1' && isSecretary(me(req)));
  }

  @Post('document-kinds')
  @Roles('SECRETARY', 'ADMIN')
  createKind(@Body() dto: CreateKindDto, @Req() req: Request) {
    return this.kinds.createKind(me(req), dto, req.ip);
  }

  @Patch('document-kinds/:id')
  @Roles('SECRETARY', 'ADMIN')
  updateKind(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateKindDto, @Req() req: Request) {
    return this.kinds.updateKind(me(req), id, dto, req.ip);
  }

  @Get('document-templates')
  @Roles('SECRETARY', 'ADMIN')
  listTemplates(@Query('kindId') kindId?: string) {
    return this.kinds.listTemplates(kindId && /^[0-9a-f-]{36}$/.test(kindId) ? kindId : undefined);
  }

  @Post('document-templates')
  @Roles('SECRETARY', 'ADMIN')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_TEMPLATE_BYTES, files: 1 } }))
  upload(@Body() dto: UploadTemplateDto, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    return this.kinds.upload(me(req), dto.kindId, dto.lang, file, req.ip);
  }

  @Get('document-templates/:id/file')
  @Roles('SECRETARY', 'ADMIN')
  async templateFile(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const { template, stream } = await this.kinds.openTemplate(id);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': contentDisposition('attachment', template.name.endsWith('.docx') ? template.name : `${template.name}.docx`),
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(stream);
  }

  // ---- documents ----
  @Post('documents')
  create(@Body() dto: CreateDocumentDto, @Req() req: Request) {
    return this.documents.create(me(req), dto, req.ip);
  }

  @Get('documents')
  list(@Req() req: Request, @Query('status') status?: string, @Query('kindId') kindId?: string, @Query('mine') mine?: string) {
    return this.documents.list(me(req), { status, kindId: kindId && /^[0-9a-f-]{36}$/.test(kindId) ? kindId : undefined, mine: mine === '1' });
  }

  @Get('documents/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.documents.get(id, me(req));
  }

  @Patch('documents/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDocumentDto, @Req() req: Request) {
    return this.documents.update(id, me(req), dto, req.ip);
  }

  @Get('documents/:id/file')
  async file(@Param('id', ParseUUIDPipe) id: string, @Query('format') format: string | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { stream, name, mime } = await this.documents.file(id, me(req), format === 'pdf' ? 'pdf' : 'docx');
    res.set({ 'Content-Type': mime, 'Content-Disposition': contentDisposition('attachment', name), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    return new StreamableFile(stream);
  }
}
