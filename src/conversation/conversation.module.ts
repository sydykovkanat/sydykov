import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DatabaseModule } from '../database/database.module';
import { OpenAIModule } from '../openai/openai.module';

import { ConversationService } from './conversation.service';
import { FactsService } from './facts.service';
import { OwnerCommandsService } from './owner-commands.service';

@Module({
  imports: [DatabaseModule, OpenAIModule, ConfigModule],
  providers: [ConversationService, OwnerCommandsService, FactsService],
  exports: [ConversationService, OwnerCommandsService, FactsService],
})
export class ConversationModule {}
