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

      // 0. Проверить, не находится ли чат в игнор-листе
      const isIgnored =
        await this.conversationService.isConversationIgnored(userId);
      if (isIgnored) {
        this.logger.debug(
          `Conversation with user ${userId} is ignored, skipping processing`,
        );
        // Помечаем pending сообщения как обработанные, чтобы они не накапливались
        const pendingMessages =
          await this.conversationService.getPendingMessages(userId);
        if (pendingMessages.length > 0) {
          const pendingMessageIds = pendingMessages.map((msg) => msg.id);
          await this.conversationService.markPendingMessagesAsProcessed(
            pendingMessageIds,
          );
        }
        return { success: true, ignored: true };
      }

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
          pendingMsg.imageBase64 || undefined,
        );
      }

      // 4. Загрузить контекст разговора (summary + последние N сообщений)
      const contextMessages =
        await this.conversationService.getConversationContext(conversation.id);

      // 5. Сформировать промпт для OpenAI и получить ответ
      this.logger.debug(`Sending ${contextMessages.length} messages to OpenAI`);
      const aiResponse =
        await this.openaiService.generateResponse(contextMessages);

      // 7. Обработать ответ в зависимости от типа (реакция или текст)
      if (aiResponse.responseType === 'reaction') {
        // Валидация: проверяем что эмодзи из разрешенного списка
        const allowedReactions = ['👍', '❤️', '❤', '🔥', '🎉', '👏', '😁'];
        if (!allowedReactions.includes(aiResponse.content)) {
          this.logger.warn(
            `GPT chose invalid reaction: ${aiResponse.content}. Falling back to text response.`,
          );
          // Fallback: отправляем текстовое подтверждение вместо реакции
          const fallbackText = aiResponse.content === '👋' ? 'йоу' : 'ок';
          await this.conversationService.saveMessage(
            conversation.id,
            'assistant',
            fallbackText,
          );
          await this.telegramService.sendMessage(telegramId, fallbackText);
        } else {
          // Найти последнее сообщение пользователя для отправки реакции
          const lastPendingMessage =
            pendingMessages[pendingMessages.length - 1];
          if (!lastPendingMessage?.telegramMessageId) {
            this.logger.error(
              'Cannot send reaction: no telegram message ID found',
            );
            throw new Error('Missing telegram message ID for reaction');
          }

          try {
            // Отправить реакцию
            this.logger.log(
              `Sending reaction ${aiResponse.content} to message ${lastPendingMessage.telegramMessageId}`,
            );
            await this.telegramService.sendReaction(
              telegramId,
              lastPendingMessage.telegramMessageId,
              aiResponse.content,
            );

            // Сохранить реакцию в БД как текстовое представление
            await this.conversationService.saveMessage(
              conversation.id,
              'assistant',
              `[Реакция: ${aiResponse.content}]`,
            );
          } catch (error) {
            // Fallback: если реакция не сработала, отправляем текст
            this.logger.warn(
              `Failed to send reaction, falling back to text response`,
              error,
            );
            const fallbackText = 'ок';
            await this.conversationService.saveMessage(
              conversation.id,
              'assistant',
              fallbackText,
            );
            await this.telegramService.sendMessage(telegramId, fallbackText);
          }
        }
      } else {
        // Текстовый ответ - показать "печатает..." и отправить
        await this.telegramService.setTyping(telegramId, true);

        await this.conversationService.saveMessage(
          conversation.id,
          'assistant',
          aiResponse.content,
        );

        await this.telegramService.sendMessage(telegramId, aiResponse.content);
      }

      // 9. Пометить pending сообщения как обработанные
      const pendingMessageIds = pendingMessages.map((msg) => msg.id);
      await this.conversationService.markPendingMessagesAsProcessed(
        pendingMessageIds,
      );

      // 10. Проверить, нужна ли суммаризация
      await this.conversationService.summarizeConversation(conversation.id);

      this.logger.log(`Successfully processed message job ${job.id}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to process message job ${job.id}`, error);
      throw error;
    }
  }
}
