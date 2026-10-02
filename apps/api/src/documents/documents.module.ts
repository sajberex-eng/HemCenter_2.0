import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { KindsTemplatesService } from './kinds-templates.service';
import { pdfConverterFactory } from './pdf-converter';

@Module({
  imports: [FilesModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, KindsTemplatesService, pdfConverterFactory],
  exports: [DocumentsService, KindsTemplatesService],
})
export class DocumentsModule {}
