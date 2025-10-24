import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';

import { ConversationService } from '../conversation/conversation.service';
import { OpenAIService } from '../openai/openai.service';
import { TelegramService } from '../telegram/telegram.service';

import { MESSAGE_QUEUE } from './shared-queue.module';

export interface MessageJob {
  userId: string;
  telegramId: number;
}

@Processor(MESSAGE_QUEUE)
export class MessageProcessor {
  private readonly logger = new Logger(MessageProcessor.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly openaiService: OpenAIService,
    private readonly telegramService: TelegramService,
  ) {}

  @Process('process-message')
  async handleMessage(job: Job<MessageJob>) {
    this.logger.log(
      `Processing message job ${job.id} for user ${job.data.userId}`,
    );

    try {
      const { userId, telegramId } = job.data;

      // 1. Получить все непрочитанные сообщения от пользователя из PendingMessage
      const pendingMessages =
        await this.conversationService.getPendingMessages(userId);

      if (pendingMessages.length === 0) {
        this.logger.debug(`No pending messages for user ${userId}`);
        return { success: true };
      }

      this.logger.debug(`Found ${pendingMessages.length} pending messages`);

      // 2. Найти или создать диалог
      const conversation =
        await this.conversationService.findOrCreateConversation(userId);

      // 3. Сохранить все pending сообщения в диалог
      for (const pendingMsg of pendingMessages) {
        await this.conversationService.saveMessage(
          conversation.id,
          'user',
          pendingMsg.content,
          pendingMsg.telegramMessageId,
          pendingMsg.imageUrls,
        );
      }

      // 4. Загрузить контекст разговора (summary + последние N сообщений)
      const contextMessages =
        await this.conversationService.getConversationContext(conversation.id);

      // 5. Сформировать промпт для OpenAI и получить ответ
      this.logger.debug(`Sending ${contextMessages.length} messages to OpenAI`);
      const response =
        await this.openaiService.generateResponse(contextMessages);

      // 6. Сохранить ответ в БД
      await this.conversationService.saveMessage(
        conversation.id,
        'assistant',
        response,
      );

      // 7. Отправить ответ в Telegram
      await this.telegramService.sendMessage(telegramId, response);

      // 8. Пометить pending сообщения как обработанные
      const pendingMessageIds = pendingMessages.map((msg) => msg.id);
      await this.conversationService.markPendingMessagesAsProcessed(
        pendingMessageIds,
      );

      // 9. Проверить, нужна ли суммаризация
      await this.conversationService.summarizeConversation(conversation.id);

      this.logger.log(`Successfully processed message job ${job.id}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to process message job ${job.id}`, error);
      throw error;
    }
  }
}
