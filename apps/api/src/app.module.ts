import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from './prisma.service';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { OrgModule } from './org/org.module';
import { ChatsModule } from './chats/chats.module';
import { SearchModule } from './search/search.module';
import { ImportModule } from './import/import.module';
import { RealtimeModule } from './realtime/realtime.module';
import { HealthController } from './health.controller';

@Global()
@Module({
  imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 300 }], skipIf: () => process.env.DISABLE_THROTTLE === 'true' }), AuditModule, RealtimeModule, AuthModule, UsersModule, OrgModule, ChatsModule, SearchModule, ImportModule],
  controllers: [HealthController],
  providers: [PrismaService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
  exports: [PrismaService],
})
export class AppModule {}
