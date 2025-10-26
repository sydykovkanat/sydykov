import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bull';

import { ConversationService } from '../conversation/conversation.service';
import { FactsService } from '../conversation/facts.service';
import { OpenAIService } from '../openai/openai.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { TelegramService } from '../telegram/telegram.service';
import { getTypoFixDelay, introduceTypo } from '../utils/typo-generator';

import { MESSAGE_QUEUE } from './shared-queue.module';

export interface MessageJob {
  userId: string;
  telegramId: number;
}

@Processor(MESSAGE_QUEUE)
export class MessageProcessor {
  private readonly logger = new Logger(MessageProcessor.name);
  private readonly typoProbability: number;
  private readonly typoFixDelayMin: number;
  private readonly typoFixDelayMax: number;

  constructor(
    private readonly conversationService: ConversationService,
    private readonly openaiService: OpenAIService,
    private readonly telegramService: TelegramService,
    private readonly rateLimitService: RateLimitService,
    private readonly configService: ConfigService,
    private readonly factsService: FactsService,
  ) {
    this.typoProbability = this.configService.get<number>(
      'typo.probability',
      0.15,
    );
    this.typoFixDelayMin = this.configService.get<number>(
      'typo.fixDelayMin',
      1,
    );
    this.typoFixDelayMax = this.configService.get<number>(
      'typo.fixDelayMax',
      3,
    );
  }

  /**
   * Извлекает факты из разговора и сохраняет их
   */
  private async extractAndSaveFacts(
    userId: string,
    contextMessages: any[],
  ): Promise<void> {
    try {
      // Извлекаем факты через OpenAI
      const extractedFacts =
        await this.openaiService.extractFacts(contextMessages);

      if (extractedFacts.length > 0) {
        // Сохраняем факты
        await this.factsService.saveFactsForUser(userId, extractedFacts);
        this.logger.log(
          `Extracted and saved ${extractedFacts.length} facts for user ${userId}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to extract and save facts for user ${userId}`,
        error,
      );
    }
  }

  /**
   * Пост-обработка текста: убирает точки в конце, случайно удаляет запятые
   */
  private postProcessText(text: string): string {
    let processed = text;

    // 1. Убираем точку в конце (но только если это не "..." или другие особые случаи)
    if (processed.endsWith('.') && !processed.endsWith('..')) {
      processed = processed.slice(0, -1);
    }

    // 2. Случайно удаляем 25% запятых (делает текст менее грамотным)
    const commas = processed.match(/,/g);
    if (commas && commas.length > 0) {
      // Удаляем примерно 25% запятых
      processed = processed
        .split('')
        .map((char) => {
          if (char === ',' && Math.random() < 0.25) {
            return ''; // Удаляем запятую
          }
          return char;
        })
        .join('');
    }

    return processed.trim();
  }

  /**
   * Разделяет длинный текст на несколько сообщений (как люди обычно пишут)
   * Делит по точкам, восклицательным и вопросительным знакам
   */
  private splitIntoMessages(text: string): string[] {
    // Разделяем по .!? (но сохраняем знаки препинания)
    const parts = text.split(/([.!?])/);

    const messages: string[] = [];
    let currentMessage = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;

      // Если это знак препинания, добавляем к текущему сообщению
      if (['.', '!', '?'].includes(part)) {
        currentMessage += part;

        // Решаем: завершить ли сообщение или продолжить
        // 60% шанс отправить как отдельное сообщение
        if (Math.random() < 0.6 || i >= parts.length - 2) {
          if (currentMessage.trim()) {
            messages.push(currentMessage.trim());
            currentMessage = '';
          }
        } else {
          currentMessage += ' '; // Продолжаем в том же сообщении
        }
      } else {
        // Это текст
        currentMessage += part;
      }
    }

    // Добавляем оставшийся текст
    if (currentMessage.trim()) {
      messages.push(currentMessage.trim());
    }

    // Если получилось только одно сообщение, возвращаем как есть
    if (messages.length === 0) {
      return [text];
    }

    return messages;
  }

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

      // 4.1. Проверить, есть ли среди pending сообщений owner messages
      const hasOwnerMessage = pendingMessages.some((msg) => msg.isOwnerMessage);

      // 4.2. Если есть owner message, добавить системное сообщение
      if (hasOwnerMessage) {
        contextMessages.push({
          role: 'system',
          content:
            'ВАЖНО: Следующее сообщение от владельца бота (Kanat Sydykov). Он обращается к тебе напрямую. Отвечай ему как личному ассистенту, помогай с задачами, выполняй его запросы.',
        });
        this.logger.debug('Added owner message context to AI prompt');
      }

      // 4.25. Загружаем факты о пользователе и добавляем в контекст
      const userFacts = await this.factsService.getFactsForUser(userId);
      if (userFacts.length > 0) {
        const factsContext = this.factsService.formatFactsForContext(userFacts);
        contextMessages.push({
          role: 'system',
          content: factsContext,
        });
        this.logger.debug(`Added ${userFacts.length} user facts to AI context`);
      }

      // 4.3. УМНАЯ ЗАДЕРЖКА: Ждем пока пользователь перестанет печатать + 5 секунд
      this.logger.log(
        `Waiting for user ${telegramId} to stop typing before responding...`,
      );
      const waited = await this.rateLimitService.waitForUserToStopTyping(
        BigInt(telegramId),
        60000, // максимум 1 минута ждем
      );

      if (!waited) {
        this.logger.warn(
          `Timeout waiting for user ${telegramId}, responding anyway`,
        );
      } else {
        this.logger.log(
          `User ${telegramId} stopped typing, generating response`,
        );
      }

      // 4.5. ВАЖНО: Проверяем pending messages еще раз
      // Могли быть отменены пока ждали (если владелец сам ответил)
      const pendingMessageIds = pendingMessages.map((msg) => msg.id);
      const stillPending =
        await this.conversationService.getPendingMessages(userId);
      const stillPendingIds = pendingMessageIds.filter((id) =>
        stillPending.find((msg) => msg.id === id),
      );

      if (stillPendingIds.length === 0) {
        this.logger.log(
          `All pending messages were cancelled while waiting, skipping response`,
        );
        return { success: true, cancelled: true };
      }

      if (stillPendingIds.length < pendingMessageIds.length) {
        this.logger.log(
          `Some pending messages were cancelled (${pendingMessageIds.length} -> ${stillPendingIds.length})`,
        );
      }

      // 5. Получить информацию о пользователе для передачи имени
      const user = await this.conversationService.getUserById(userId);
      const userName = user?.firstName || undefined;

      if (userName) {
        this.logger.debug(`User name: ${userName}`);
      }

      // 6. Показываем "печатает..." пока генерируем ответ (более естественно)
      await this.telegramService.setTyping(telegramId, true);

      // 7. Сформировать промпт для OpenAI и получить ответ
      this.logger.debug(`Sending ${contextMessages.length} messages to OpenAI`);
      const aiResponse = await this.openaiService.generateResponse(
        contextMessages,
        userName,
      );

      // 8. Пост-обработка текста (убираем точки, случайно удаляем запятые)
      const processedText = this.postProcessText(aiResponse.content);

      // 9. Разделяем на несколько сообщений (как люди пишут)
      const messages = this.splitIntoMessages(processedText);

      this.logger.debug(
        `Generated response: ${aiResponse.content.length} chars, split into ${messages.length} message(s)`,
      );

      // 10. Отправляем каждое сообщение с реалистичными задержками
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        // Рассчитать время "печатает..." для этого сообщения
        // Примерная скорость: 50 символов в секунду
        const typingDurationMs = Math.min(
          Math.max((msg.length / 50) * 1000, 1000), // минимум 1 секунда
          10000, // максимум 10 секунд
        );

        this.logger.debug(
          `Sending message ${i + 1}/${messages.length}: "${msg}" (${msg.length} chars, ${Math.round(typingDurationMs / 1000)}s typing)`,
        );

        // Показать "печатает..."
        await this.telegramService.setTyping(telegramId, true);
        await new Promise((resolve) => setTimeout(resolve, typingDurationMs));

        // Проверяем, нужно ли добавить опечатку
        const typoResult = introduceTypo(msg, this.typoProbability);

        if (typoResult.hasTypo && typoResult.originalText) {
          // Отправляем сообщение с опечаткой
          this.logger.debug(
            `Sending message with typo: "${typoResult.text}" (original: "${typoResult.originalText}")`,
          );
          const messageId = await this.telegramService.sendMessage(
            telegramId,
            typoResult.text,
          );

          // Ждем случайное время перед исправлением
          const fixDelay = getTypoFixDelay(
            this.typoFixDelayMin,
            this.typoFixDelayMax,
          );
          this.logger.debug(
            `Waiting ${fixDelay}ms before fixing typo in message ${messageId}`,
          );
          await new Promise((resolve) => setTimeout(resolve, fixDelay));

          // Исправляем опечатку
          this.logger.debug(`Fixing typo in message ${messageId}`);
          await this.telegramService.editMessage(
            telegramId,
            messageId,
            typoResult.originalText,
          );
        } else {
          // Отправляем сообщение без опечатки
          await this.telegramService.sendMessage(telegramId, msg);
        }

        // Небольшая пауза между сообщениями (0.5-1.5 секунды)
        if (i < messages.length - 1) {
          const pauseMs = 500 + Math.random() * 1000;
          this.logger.debug(
            `Pausing ${Math.round(pauseMs)}ms before next message`,
          );
          await new Promise((resolve) => setTimeout(resolve, pauseMs));
        }
      }

      // 11. Сохранить все сообщения в БД (объединяем обратно для истории)
      const fullResponse = messages.join('\n');
      await this.conversationService.saveMessage(
        conversation.id,
        'assistant',
        fullResponse,
      );

      // 12. Пометить pending сообщения как обработанные (только те что остались)
      await this.conversationService.markPendingMessagesAsProcessed(
        stillPendingIds,
      );

      // 13. Проверить, нужна ли суммаризация
      await this.conversationService.summarizeConversation(conversation.id);

      // 14. Извлечь факты из разговора (асинхронно, не блокируем ответ)
      this.extractAndSaveFacts(userId, contextMessages).catch((err) => {
        this.logger.error('Failed to extract facts', err);
      });

      this.logger.log(`Successfully processed message job ${job.id}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to process message job ${job.id}`, error);
      throw error;
    }
  }
}
