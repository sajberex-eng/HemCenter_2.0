import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { importDir, ImportService } from './import.service';
import type { DateOrder } from './whatsapp-parser';

const MAX_UPLOAD = Math.floor(Number(process.env.IMPORT_MAX_MB ?? 500) * 1024 * 1024);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class CommitDto {
  @IsString() @MinLength(1) @MaxLength(100) title: string;
  @IsObject() mapping: Record<string, string | null>;
  @IsOptional() @IsIn(['DMY', 'MDY']) dateOrder?: DateOrder;
  @IsOptional() @IsString() @MaxLength(64) timeZone?: string;
}

/** Imports history from exported WhatsApp chats. Administrators only. */
@Controller('import/whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  // The upload goes straight to disk: exports with photos run to hundreds of megabytes.
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({ destination: (_req, _file, cb) => cb(null, importDir()), filename: (_req, _file, cb) => cb(null, `${randomUUID()}.upload`) }),
      limits: { fileSize: MAX_UPLOAD, files: 1 },
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    const id = await this.imports.createSession(req.user!.id, file);
    try {
      return await this.imports.preview(id, req.user!.id);
    } catch (e) {
      await this.imports.discard(id, req.user!.id); // an unreadable file is not kept
      throw e;
    }
  }

  @Get(':id')
  preview(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Query('order') order?: string, @Query('tz') tz?: string) {
    return this.imports.preview(id, req.user!.id, { order: order === 'DMY' || order === 'MDY' ? order : undefined, timeZone: tz });
  }

  @Post(':id/commit')
  @HttpCode(201)
  commit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CommitDto, @Req() req: Request) {
    // every mapping value is a user id or null; anything else is rejected before it reaches the database
    for (const [name, v] of Object.entries(dto.mapping)) {
      if (name.length > 300 || !(v === null || (typeof v === 'string' && UUID.test(v)))) throw new BadRequestException('IMPORT_MAPPING_INVALID');
    }
    return this.imports.commit(id, req.user!.id, dto, req.ip);
  }

  @Delete(':id')
  @HttpCode(204)
  async discard(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.imports.discard(id, req.user!.id);
  }
}
