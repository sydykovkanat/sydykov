import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DatabaseModule } from '../database/database.module';
import { OpenAIModule } from '../openai/openai.module';

import { ConversationService } from './conversation.service';

@Module({
  imports: [DatabaseModule, OpenAIModule, ConfigModule],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
