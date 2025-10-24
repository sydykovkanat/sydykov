import { forwardRef, Module } from '@nestjs/common';

import { ConversationModule } from '../conversation/conversation.module';
import { OpenAIModule } from '../openai/openai.module';
import { TelegramModule } from '../telegram/telegram.module';

import { MessageProcessor } from './message.processor';
import { SharedQueueModule } from './shared-queue.module';

@Module({
  imports: [
    SharedQueueModule,
    ConversationModule,
    OpenAIModule,
    forwardRef(() => TelegramModule),
  ],
  providers: [MessageProcessor],
})
export class QueueModule {}
