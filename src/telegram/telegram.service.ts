import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bull';
import { Context, Telegraf } from 'telegraf';
import { Update } from 'telegraf/types';

import { ConversationService } from '../conversation/conversation.service';
import { MESSAGE_QUEUE } from '../queue/shared-queue.module';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf<Context<Update>>;
  private readonly messageDelaySeconds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly conversationService: ConversationService,
    @InjectQueue(MESSAGE_QUEUE) private readonly messageQueue: Queue,
  ) {
    const botToken = this.configService.get<string>('telegram.botToken');
    this.messageDelaySeconds = this.configService.get<number>(
      'messageProcessing.delaySeconds',
      10,
    );

    this.bot = new Telegraf(botToken!);
    this.setupHandlers();
  }

  async onModuleInit() {
    try {
      await this.bot.launch();
      this.logger.log('Telegram bot launched successfully');
    } catch (error) {
      this.logger.error('Failed to launch Telegram bot', error);
      throw error;
    }
  }

  private setupHandlers() {
    // Обработчик сообщений (текст + фото)
    this.bot.on('message', async (ctx) => {
      try {
        // ВАЖНО: Игнорируем все сообщения из групп и каналов
        if (ctx.chat.type !== 'private') {
          this.logger.debug(`Ignoring message from ${ctx.chat.type} chat`);
          return;
        }

        const telegramId = BigInt(ctx.from.id);
        const username = ctx.from.username;
        const firstName = ctx.from.first_name;
        const lastName = ctx.from.last_name;
        const messageId = ctx.message.message_id;

        // Получаем текст (если есть) и фото (если есть)
        let messageText = '';
        const imageUrls: string[] = [];

        if ('text' in ctx.message) {
          messageText = ctx.message.text;
        } else if ('caption' in ctx.message && ctx.message.caption) {
          messageText = ctx.message.caption;
        }

        // Обрабатываем фото
        if ('photo' in ctx.message && ctx.message.photo) {
          // Берем фото с наибольшим разрешением (последнее в массиве)
          const photo = ctx.message.photo[ctx.message.photo.length - 1];
          try {
            const fileLink = await ctx.telegram.getFileLink(photo.file_id);
            imageUrls.push(fileLink.href);
            this.logger.debug(`Got photo URL: ${fileLink.href}`);
          } catch (error) {
            this.logger.error('Failed to get photo URL', error);
          }
        }

        // Игнорируем сообщения без текста и без фото
        if (!messageText && imageUrls.length === 0) {
          this.logger.debug('Ignoring message without text and photos');
          return;
        }

        this.logger.log(
          `Received message from ${firstName} (${telegramId}): ${messageText.substring(0, 50)}... with ${imageUrls.length} photo(s)`,
        );

        // Находим или создаем пользователя
        const user = await this.conversationService.findOrCreateUser(
          telegramId,
          username,
          firstName,
          lastName,
        );

        // Сохраняем сообщение как pending
        await this.conversationService.savePendingMessage(
          user.id,
          telegramId,
          messageText,
          messageId,
          this.messageDelaySeconds,
          imageUrls,
        );

        // Добавляем задачу в очередь с задержкой
        await this.messageQueue.add(
          'process-message',
          {
            userId: user.id,
            telegramId: ctx.from.id,
          },
          {
            delay: this.messageDelaySeconds * 1000,
            jobId: `${user.id}-${Date.now()}`,
          },
        );

        this.logger.debug(
          `Added message to queue with ${this.messageDelaySeconds}s delay`,
        );
      } catch (error) {
        this.logger.error('Error handling message', error);
      }
    });

    // Graceful shutdown
    process.once('SIGINT', () => this.bot.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
  }

  /**
   * Отправляет сообщение пользователю
   */
  async sendMessage(telegramId: number, text: string): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(telegramId, text);
      this.logger.log(`Sent message to ${telegramId}`);
    } catch (error) {
      this.logger.error(`Failed to send message to ${telegramId}`, error);
      throw error;
    }
  }

  /**
   * Возвращает экземпляр бота (для дополнительной кастомизации если нужно)
   */
  getBot(): Telegraf<Context<Update>> {
    return this.bot;
  }
}
