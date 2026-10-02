import { Module } from '@nestjs/common';
import { ChatsModule } from '../chats/chats.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { ReminderScheduler } from './reminder.scheduler';

@Module({
  imports: [ChatsModule, FilesModule, NotificationsModule],
  controllers: [AssignmentsController],
  providers: [AssignmentsService, ReminderScheduler],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
