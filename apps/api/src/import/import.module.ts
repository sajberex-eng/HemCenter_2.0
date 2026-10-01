import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

@Module({ imports: [FilesModule], controllers: [ImportController], providers: [ImportService] })
export class ImportModule {}
