import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FileStorage, LocalDiskStorage } from './file-storage';

@Module({
  controllers: [FilesController],
  providers: [FilesService, { provide: FileStorage, useClass: LocalDiskStorage }],
  exports: [FilesService],
})
export class FilesModule {}
