import { Module } from '@nestjs/common';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';
import { MessagesService } from './messages.service';
import { FilesModule } from '../files/files.module';

@Module({ imports: [FilesModule], controllers: [ChatsController], providers: [ChatsService, MessagesService], exports: [ChatsService, MessagesService] })
export class ChatsModule {}
