import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bull';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { Api } from 'telegram/tl';

import { ConversationService } from '../conversation/conversation.service';
import { MESSAGE_QUEUE } from '../queue/shared-queue.module';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private client: TelegramClient;
  private readonly messageDelaySeconds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly conversationService: ConversationService,
    @InjectQueue(MESSAGE_QUEUE) private readonly messageQueue: Queue,
  ) {
    const apiId = this.configService.get<number>('telegram.apiId');
    const apiHash = this.configService.get<string>('telegram.apiHash');
    const sessionString = this.configService.get<string>(
      'telegram.sessionString',
    );

    this.messageDelaySeconds = this.configService.get<number>(
      'messageProcessing.delaySeconds',
      10,
    );

    // Инициализация MTProto клиента
    const session = new StringSession(sessionString || '');
    this.client = new TelegramClient(session, apiId!, apiHash!, {
      connectionRetries: 5,
    });

    this.setupHandlers();
  }

  async onModuleInit() {
    try {
      await this.client.connect();
      this.logger.log('Telegram MTProto client connected successfully');

      // Получаем информацию о текущем пользователе
      const me = await this.client.getMe();
      this.logger.log(
        `Logged in as: ${me.firstName} ${me.lastName || ''} (@${(me as any).username || 'no username'})`,
      );
    } catch (error) {
      this.logger.error('Failed to connect Telegram MTProto client', error);
      throw error;
    }
  }

  private setupHandlers() {
    // Обработчик входящих сообщений
    this.client.addEventHandler(
      async (event: NewMessageEvent) => {
        try {
          const message = event.message;

          // Игнорируем исходящие сообщения (отправленные нами)
          if (message.out) {
            return;
          }

          // Игнорируем сообщения не из приватных чатов
          const peerId = message.peerId;
          if (!peerId || !(peerId instanceof Api.PeerUser)) {
            this.logger.debug(`Ignoring message from non-private chat`);
            return;
          }

          // Получаем отправителя
          const sender = await message.getSender();
          if (!sender || !(sender instanceof Api.User)) {
            this.logger.debug('Sender is not a user, ignoring');
            return;
          }

          const telegramId = BigInt(sender.id.toString());
          const username = (sender as any).username || undefined;
          const firstName = sender.firstName || '';
          const lastName = sender.lastName || undefined;
          const messageId = message.id;

          // Получаем текст сообщения
          let messageText = message.text || '';

          // Проверяем и фильтруем типы медиа
          const imageBase64List: string[] = [];
          let hasPhoto = false;

          if (message.media) {
            // Разрешаем только фото
            if (message.media instanceof Api.MessageMediaPhoto) {
              hasPhoto = true;
              try {
                // Скачиваем фото как Buffer
                this.logger.debug('Downloading photo...');
                const buffer = await this.client.downloadMedia(message.media);

                if (buffer && Buffer.isBuffer(buffer)) {
                  // Конвертируем в base64
                  const base64Image = buffer.toString('base64');
                  imageBase64List.push(base64Image);
                  this.logger.debug(
                    `Photo downloaded successfully (${buffer.length} bytes)`,
                  );
                } else {
                  this.logger.warn('Downloaded media is not a Buffer');
                }
              } catch (error) {
                this.logger.error('Failed to download photo', error);
                // Продолжаем обработку даже если фото не скачалось
              }
            } else {
              // Игнорируем другие типы медиа
              const mediaType = message.media.className;
              this.logger.debug(`Ignoring unsupported media type: ${mediaType}`);
              return;
            }
          }

          // Разрешаем сообщения с текстом ИЛИ с фото
          if (!messageText && !hasPhoto) {
            this.logger.debug('Ignoring message without text and without photo');
            return;
          }

          // Антиспам: берем только первое фото (если пришло несколько)
          const finalImageBase64 =
            imageBase64List.length > 0 ? imageBase64List[0] : undefined;

          if (imageBase64List.length > 1) {
            this.logger.warn(
              `User sent ${imageBase64List.length} photos, using only the first one (anti-spam)`,
            );
          }

          this.logger.log(
            `Received message from ${firstName} (${telegramId}): "${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}" ${hasPhoto ? '[with photo]' : ''}`,
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
            [], // imageUrls deprecated
            finalImageBase64,
          );

          // Добавляем задачу в очередь с задержкой
          await this.messageQueue.add(
            'process-message',
            {
              userId: user.id,
              telegramId: Number(sender.id),
            },
            {
              delay: this.messageDelaySeconds * 1000,
              jobId: `${user.id}-${Date.now()}`,
            },
          );

          this.logger.debug(
            `Added message to queue with ${this.messageDelaySeconds}s delay`,
          );

          // Отмечаем сообщение как прочитанное с задержкой 3-5 секунд
          // Запускаем асинхронно, не блокируя основной поток
          this.markAsReadWithDelay(Number(sender.id), 3, 5).catch((err) => {
            this.logger.error('Failed to mark as read with delay', err);
          });
        } catch (error) {
          this.logger.error('Error handling message', error);
        }
      },
      new NewMessage({}),
    );

    // Graceful shutdown
    const shutdown = async () => {
      this.logger.log('Disconnecting Telegram client...');
      await this.client.disconnect();
      process.exit(0);
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }

  /**
   * Устанавливает статус "печатает..." для пользователя
   */
  async setTyping(telegramId: number, isTyping: boolean = true): Promise<void> {
    try {
      if (isTyping) {
        await this.client.invoke(
          new Api.messages.SetTyping({
            peer: telegramId,
            action: new Api.SendMessageTypingAction(),
          }),
        );
        this.logger.debug(`Set typing status for ${telegramId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to set typing status for ${telegramId}`, error);
      // Не бросаем ошибку, это не критично
    }
  }

  /**
   * Отмечает сообщения как прочитанные с задержкой (имитация чтения человеком)
   * @param telegramId - ID пользователя
   * @param minDelay - минимальная задержка в секундах (по умолчанию 3)
   * @param maxDelay - максимальная задержка в секундах (по умолчанию 5)
   */
  async markAsReadWithDelay(
    telegramId: number,
    minDelay: number = 3,
    maxDelay: number = 5,
  ): Promise<void> {
    try {
      // Случайная задержка между min и max секундами
      const delaySeconds = Math.random() * (maxDelay - minDelay) + minDelay;
      const delayMs = Math.floor(delaySeconds * 1000);

      this.logger.debug(
        `Waiting ${(delayMs / 1000).toFixed(2)}s before marking as read for ${telegramId}`,
      );

      // Ждем случайное время
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      // Отмечаем как прочитанное
      await this.client.invoke(
        new Api.messages.ReadHistory({
          peer: telegramId,
          maxId: 0, // 0 означает "все сообщения"
        }),
      );
      this.logger.debug(`Marked messages as read for ${telegramId}`);
    } catch (error) {
      this.logger.error(
        `Failed to mark messages as read for ${telegramId}`,
        error,
      );
      // Не бросаем ошибку, это не критично
    }
  }

  /**
   * Отмечает сообщения как прочитанные (без задержки)
   */
  async markAsRead(telegramId: number): Promise<void> {
    try {
      await this.client.invoke(
        new Api.messages.ReadHistory({
          peer: telegramId,
          maxId: 0, // 0 означает "все сообщения"
        }),
      );
      this.logger.debug(`Marked messages as read for ${telegramId}`);
    } catch (error) {
      this.logger.error(`Failed to mark messages as read for ${telegramId}`, error);
      // Не бросаем ошибку, это не критично
    }
  }

  /**
   * Отправляет сообщение пользователю
   */
  async sendMessage(telegramId: number, text: string): Promise<void> {
    try {
      await this.client.sendMessage(telegramId, {
        message: text,
      });
      this.logger.log(`Sent message to ${telegramId}`);
    } catch (error) {
      this.logger.error(`Failed to send message to ${telegramId}`, error);
      throw error;
    }
  }

  /**
   * Возвращает экземпляр клиента (для дополнительной кастомизации если нужно)
   */
  getClient(): TelegramClient {
    return this.client;
  }
}
