import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { PushSender, WebPushSender } from './push-sender';

@Module({
  controllers: [PushController],
  providers: [PushService, { provide: PushSender, useClass: WebPushSender }],
  exports: [PushService],
})
export class PushModule {}
