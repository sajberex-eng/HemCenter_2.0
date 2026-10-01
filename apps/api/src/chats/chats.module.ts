import { Module } from '@nestjs/common';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';
import { MessagesService } from './messages.service';
import { PinsService } from './pins.service';
import { FilesModule } from '../files/files.module';
import { PushModule } from '../push/push.module';

@Module({ imports: [FilesModule, PushModule], controllers: [ChatsController], providers: [ChatsService, MessagesService, PinsService], exports: [ChatsService, MessagesService] })
export class ChatsModule {}
