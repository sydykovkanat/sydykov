import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bull';
import { TelegramClient } from 'telegram';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';

import { ConversationService } from '../conversation/conversation.service';
import { OwnerCommandsService } from '../conversation/owner-commands.service';
import { MESSAGE_QUEUE } from '../queue/shared-queue.module';
import { RateLimitService } from '../rate-limit/rate-limit.service';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private client: TelegramClient;
  private readonly messageDelaySeconds: number;
  private readonly botName: string;
  private readonly ownerTelegramId?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly conversationService: ConversationService,
    private readonly ownerCommandsService: OwnerCommandsService,
    private readonly rateLimitService: RateLimitService,
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

    this.botName = this.configService.get<string>('bot.name', 'канатик');
    this.ownerTelegramId = this.configService.get<string>(
      'bot.ownerTelegramId',
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
    this.client.addEventHandler(async (event: NewMessageEvent) => {
      try {
        const message = event.message;

        this.logger.log(message);

        // Обрабатываем команды управления ботом (исходящие сообщения)
        if (message.out) {
          await this.handleControlCommands(message);
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
        const messageText = message.text || '';

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

        // Проверяем rate limit
        const rateLimitStatus =
          await this.rateLimitService.checkLimit(telegramId);

        if (rateLimitStatus.exceeded) {
          // Если лимит превышен и предупреждение еще не отправлено
          if (!rateLimitStatus.warningSent) {
            const warningMessage = this.configService.get<string>(
              'rateLimit.warningMessage',
              'Я сейчас занят, чуть позже отвечу 🙏',
            );

            await this.sendMessage(Number(sender.id), warningMessage);
            await this.rateLimitService.markWarningSent(telegramId);

            this.logger.warn(
              `Rate limit exceeded for ${telegramId} (${rateLimitStatus.currentCount}/${rateLimitStatus.limit}). Warning sent.`,
            );
          } else {
            this.logger.debug(
              `Rate limit exceeded for ${telegramId}, ignoring message (warning already sent)`,
            );
          }

          // НЕ читаем сообщение, НЕ обрабатываем
          return;
        }

        // Инкрементируем счетчик (лимит не превышен)
        await this.rateLimitService.incrementCounter(telegramId);

        // Находим или создаем пользователя
        const user = await this.conversationService.findOrCreateUser(
          telegramId,
          username,
          firstName,
          lastName,
        );

        // Проверяем, не находится ли чат в игнор-листе
        const isIgnored = await this.conversationService.isConversationIgnored(
          user.id,
        );
        if (isIgnored) {
          this.logger.debug(
            `Conversation with ${telegramId} is ignored, skipping message`,
          );
          // Все равно отмечаем как прочитанное, чтобы не было непрочитанных
          await this.markAsRead(Number(sender.id));
          return;
        }

        // Проверяем owner commands для Saved Messages (когда пользователь пишет себе)
        let isOwnerMessage = false;
        if (this.ownerTelegramId && messageText) {
          // Проверяем, что это сообщение в Saved Messages (savedPeerId присутствует)
          const savedPeerId = (message as any).savedPeerId;
          if (savedPeerId && savedPeerId instanceof Api.PeerUser) {
            const savedUserId = BigInt(savedPeerId.userId.toString());

            // Если savedPeerId === OWNER_TELEGRAM_ID, это сообщение владельца себе
            if (savedUserId.toString() === this.ownerTelegramId) {
              this.logger.debug(
                'Checking for owner commands in Saved Messages...',
              );

              const commandResult =
                await this.ownerCommandsService.handleOwnerCommand(
                  savedUserId, // ID владельца
                  telegramId, // ID целевого пользователя (в Saved Messages это всегда владелец)
                  messageText,
                );

              if (commandResult.isCommand && commandResult.response) {
                this.logger.log(
                  `Processing owner command in Saved Messages: ${messageText.substring(0, 50)}...`,
                );

                // Редактируем сообщение с ответом напрямую через объект message
                await message.edit({ text: commandResult.response });

                // Отмечаем как прочитанное
                await this.markAsRead(Number(sender.id));

                // НЕ сохраняем в очередь, НЕ обрабатываем через AI
                return;
              }

              // Флаг isOwnerMessage для передачи в AI
              isOwnerMessage = commandResult.isOwnerMessage;
            } else {
              this.logger.debug(
                `Saved message from non-owner user ${savedUserId}, processing normally`,
              );
            }
          } else {
            // Обычный приватный чат - проверяем, не владелец ли это
            this.logger.debug(
              `Normal private chat message from ${telegramId}, checking for owner commands`,
            );

            // Проверяем owner commands в обычных чатах
            const commandResult =
              await this.ownerCommandsService.handleOwnerCommand(
                BigInt(sender.id.toString()), // ID отправителя (может быть владелец)
                telegramId, // ID пользователя в чате (целевой пользователь)
                messageText,
              );

            if (commandResult.isCommand && commandResult.response) {
              this.logger.log(
                `Processing owner command in chat: ${messageText.substring(0, 50)}...`,
              );

              // Редактируем сообщение с ответом напрямую через объект message
              await message.edit({ text: commandResult.response });

              // Отмечаем как прочитанное
              await this.markAsRead(Number(sender.id));

              // НЕ сохраняем в очередь, НЕ обрабатываем через AI
              return;
            }

            // Флаг isOwnerMessage для передачи в AI
            isOwnerMessage = commandResult.isOwnerMessage;
          }
        }

        // Сохраняем сообщение как pending
        this.logger.debug(
          `Saving pending message for ${telegramId}, isOwnerMessage=${isOwnerMessage}`,
        );
        await this.conversationService.savePendingMessage(
          user.id,
          telegramId,
          messageText,
          messageId,
          this.messageDelaySeconds,
          [], // imageUrls deprecated
          finalImageBase64,
          isOwnerMessage,
        );

        // Добавляем задачу в очередь с минимальной задержкой 2 секунды
        // (реальная задержка будет больше - в процессоре ждем пока пользователь перестанет печатать)
        const minDelaySeconds = 2;
        await this.messageQueue.add(
          'process-message',
          {
            userId: user.id,
            telegramId: Number(sender.id),
          },
          {
            delay: minDelaySeconds * 1000,
            jobId: `${user.id}-${Date.now()}`,
          },
        );

        this.logger.debug(
          `Added message to queue with ${minDelaySeconds}s initial delay (will wait for typing to stop)`,
        );

        // Отмечаем сообщение как прочитанное через 0.5-1 секунду (быстро, как человек)
        // Запускаем асинхронно - пока пользователь может печатать следующее
        this.markAsReadWithDelay(Number(sender.id), 0.5, 1).catch((err) => {
          this.logger.error('Failed to mark as read with delay', err);
        });
      } catch (error) {
        this.logger.error('Error handling message', error);
      }
    }, new NewMessage({}));

    // Обработчик события "печатает..." (UpdateUserTyping)
    this.client.addEventHandler(async (update: any) => {
      try {
        // Проверяем что это UpdateUserTyping
        if (!(update instanceof Api.UpdateUserTyping)) {
          return;
        }

        // Получаем ID пользователя
        const userId = update.userId;
        if (!userId) return;

        const telegramId = BigInt(userId.toString());

        // Проверяем тип действия (typing, recording voice, etc.)
        const action = update.action;

        if (action instanceof Api.SendMessageTypingAction) {
          // Отмечаем в Redis что пользователь печатает (без логов - слишком часто)
          await this.rateLimitService.setUserTyping(telegramId);
        } else if (action instanceof Api.SendMessageCancelAction) {
          // Очищаем статус (без логов - слишком часто)
          await this.rateLimitService.clearUserTyping(telegramId);
        }
      } catch (error) {
        this.logger.error('Error handling typing status', error);
      }
    });

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
   * Обрабатывает исходящие сообщения: отменяет автоответ + owner commands
   */
  private async handleControlCommands(message: any): Promise<void> {
    try {
      const text: string = (message.text || '').trim();
      const lowerText = text.toLowerCase();

      // Проверяем, что это приватный чат
      const peerId = message.peerId;
      if (!peerId || !(peerId instanceof Api.PeerUser)) {
        this.logger.debug(`Outgoing message not in private chat, ignoring`);
        return;
      }

      // Получаем ID собеседника из peerId
      const chatId = peerId.userId;
      const telegramId = BigInt(chatId.toString());

      this.logger.debug(
        `Outgoing message to ${telegramId}: "${text.substring(0, 50)}..."`,
      );

      // ===== ВАЖНО: Отменяем автоответ при любом исходящем сообщении =====
      // Если владелец сам написал сообщение, значит он сам отвечает - отменяем автоответ
      try {
        // Ищем pending сообщения по telegramId
        const pendingMessages =
          await this.conversationService.findPendingMessagesByTelegramId(
            telegramId,
          );

        if (pendingMessages.length > 0) {
          this.logger.log(
            `Owner sent message to ${telegramId}, cancelling ${pendingMessages.length} pending auto-responses`,
          );

          const pendingIds = pendingMessages.map((msg) => msg.id);
          await this.conversationService.markPendingMessagesAsProcessed(
            pendingIds,
          );
        }

        // ===== ВАЖНО: Сохраняем исходящее сообщение владельца в БД =====
        // Чтобы GPT видел контекст - что владелец уже ответил
        if (text) {
          const user = await this.conversationService.findOrCreateUser(
            telegramId,
            undefined, // username неизвестен
            undefined, // firstName неизвестен
            undefined, // lastName неизвестен
          );

          const conversation =
            await this.conversationService.findOrCreateConversation(user.id);

          // Сохраняем как assistant (ответ бота)
          await this.conversationService.saveMessage(
            conversation.id,
            'assistant',
            text,
          );

          this.logger.debug(
            `Saved outgoing message to DB for context: "${text.substring(0, 50)}..."`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to cancel auto-response for ${telegramId}`,
          error,
        );
        // Не бросаем ошибку, продолжаем обработку команд
      }

      // ===== Проверяем owner commands (только если есть botName в сообщении) =====
      if (!lowerText.includes(this.botName.toLowerCase())) {
        return; // Нет botName - это обычное сообщение, мы уже отменили автоответ
      }

      this.logger.debug(
        `Found '${this.botName}' in message, checking for owner commands...`,
      );

      this.logger.debug(`Processing command for chat ${telegramId}`);

      // Проверяем owner commands (если OWNER_TELEGRAM_ID настроен и это наше сообщение владельцу)
      if (this.ownerTelegramId) {
        const fromId = message.fromId;
        const myTelegramId =
          fromId && fromId instanceof Api.PeerUser
            ? BigInt(fromId.userId.toString())
            : null;

        // Если это сообщение от владельца (myTelegramId === OWNER_TELEGRAM_ID)
        if (myTelegramId?.toString() === this.ownerTelegramId) {
          this.logger.debug('Checking for owner commands...');

          const commandResult =
            await this.ownerCommandsService.handleOwnerCommand(
              myTelegramId, // ID владельца (для проверки прав)
              telegramId, // ID целевого пользователя (для команд стоп/продолжай)
              text,
            );

          if (commandResult.isCommand && commandResult.response) {
            this.logger.log(
              `Processing owner command: ${text.substring(0, 50)}...`,
            );

            // Редактируем сообщение владельца с ответом напрямую через объект message
            await message.edit({ text: commandResult.response });

            return; // Не обрабатываем как "стоп/продолжай"
          }

          // Если это owner message (с botName), но неизвестная команда - не продолжаем обработку стоп/продолжай
          if (commandResult.isOwnerMessage) {
            this.logger.debug(
              'Unknown owner command, skipping stop/continue check',
            );
            return;
          }
        }
      }

      // Все команды (включая стоп/продолжай) теперь обрабатываются через owner commands
      // Эта ветка достигается только если:
      // 1. В сообщении есть botName
      // 2. Это НЕ owner command (или команда неизвестна)
      // 3. Это НЕ owner message
      // В этом случае просто игнорируем сообщение
      this.logger.debug(
        `Message contains bot name but not processed as command`,
      );
    } catch (error) {
      this.logger.error('❌ Error handling control commands', error);
    }
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

      // Ждем случайное время
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      // Отмечаем как прочитанное
      await this.client.invoke(
        new Api.messages.ReadHistory({
          peer: telegramId,
          maxId: 0, // 0 означает "все сообщения"
        }),
      );
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
    } catch (error) {
      this.logger.error(
        `Failed to mark messages as read for ${telegramId}`,
        error,
      );
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
    } catch (error) {
      this.logger.error(`Failed to send message to ${telegramId}`, error);
      throw error;
    }
  }

  /**
   * Редактирует сообщение
   * @param telegramId - ID пользователя (чата)
   * @param messageId - ID сообщения для редактирования
   * @param text - Новый текст сообщения
   */
  async editMessage(
    telegramId: number,
    messageId: number,
    text: string,
  ): Promise<void> {
    try {
      // Получаем entity чата перед редактированием
      // Это обязательно для того чтобы клиент мог редактировать сообщения
      const entity = await this.client.getEntity(telegramId);

      await this.client.editMessage(entity, {
        message: messageId,
        text: text,
      });
    } catch (error) {
      this.logger.error(
        `Failed to edit message ${messageId} in chat ${telegramId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Отправляет реакцию на сообщение
   * @param telegramId - ID пользователя
   * @param messageId - ID сообщения, на которое отправляется реакция
   * @param emoji - Эмодзи реакции (👍❤️🔥🎉👏😁)
   */
  async sendReaction(
    telegramId: number,
    messageId: number,
    emoji: string,
  ): Promise<void> {
    try {
      await this.client.invoke(
        new Api.messages.SendReaction({
          peer: telegramId,
          msgId: messageId,
          reaction: [new Api.ReactionEmoji({ emoticon: emoji })],
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to send reaction to ${telegramId} on message ${messageId}`,
        error,
      );
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
