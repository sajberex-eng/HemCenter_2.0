import { Module } from '@nestjs/common';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';
import { MessagesService } from './messages.service';

@Module({ controllers: [ChatsController], providers: [ChatsService, MessagesService], exports: [ChatsService, MessagesService] })
export class ChatsModule {}
