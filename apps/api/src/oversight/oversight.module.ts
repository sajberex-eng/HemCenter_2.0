import { Module } from '@nestjs/common';
import { ChatsModule } from '../chats/chats.module';
import { FilesModule } from '../files/files.module';
import { OversightController } from './oversight.controller';
import { OversightService } from './oversight.service';

@Module({ imports: [ChatsModule, FilesModule], controllers: [OversightController], providers: [OversightService] })
export class OversightModule {}
