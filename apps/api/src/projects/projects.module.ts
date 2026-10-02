import { Module } from '@nestjs/common';
import { ChatsModule } from '../chats/chats.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { TasksService } from './tasks.service';
import { DecisionsService } from './decisions.service';
import { WorkloadService } from './workload.service';

@Module({ imports: [ChatsModule], controllers: [ProjectsController], providers: [ProjectsService, TasksService, DecisionsService, WorkloadService], exports: [ProjectsService, WorkloadService] })
export class ProjectsModule {}
