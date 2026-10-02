import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

@Module({ imports: [PushModule], controllers: [SystemController], providers: [SystemService] })
export class SystemModule {}
