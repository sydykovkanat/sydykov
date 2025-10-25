import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ConversationModule } from '../conversation/conversation.module';
import { SharedQueueModule } from '../queue/shared-queue.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';

import { TelegramService } from './telegram.service';

@Module({
  imports: [
    ConfigModule,
    ConversationModule,
    SharedQueueModule,
    RateLimitModule,
  ],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
