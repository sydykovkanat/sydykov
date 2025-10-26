import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export interface RateLimitStatus {
  exceeded: boolean;
  warningSent: boolean;
  currentCount: number;
  limit: number;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly redis: Redis;
  private readonly maxMessagesPerHour: number;
  private readonly ttl = 3600; // 1 час в секундах

  constructor(private readonly configService: ConfigService) {
    const redisHost = this.configService.get<string>('redis.host', 'localhost');
    const redisPort = this.configService.get<number>('redis.port', 6379);

    this.redis = new Redis({
      host: redisHost,
      port: redisPort,
      maxRetriesPerRequest: 3,
    });

    this.maxMessagesPerHour = this.configService.get<number>(
      'rateLimit.maxMessagesPerHour',
      50,
    );

    this.logger.log(
      `Rate limiting initialized: ${this.maxMessagesPerHour} messages/hour`,
    );
  }

  /**
   * Проверяет лимит сообщений для пользователя
   */
  async checkLimit(telegramId: bigint): Promise<RateLimitStatus> {
    const key = this.getKey(telegramId);

    try {
      // Получаем текущее состояние
      const data = await this.redis.hgetall(key);
      const currentCount = parseInt(data.count || '0', 10);
      const warningSent = data.warningSent === 'true';

      const exceeded = currentCount >= this.maxMessagesPerHour;

      this.logger.debug(
        `Rate limit check for ${telegramId}: count=${currentCount}/${this.maxMessagesPerHour}, exceeded=${exceeded}, warningSent=${warningSent}`,
      );

      return {
        exceeded,
        warningSent,
        currentCount,
        limit: this.maxMessagesPerHour,
      };
    } catch (error) {
      this.logger.error(`Failed to check rate limit for ${telegramId}`, error);
      // В случае ошибки не блокируем пользователя
      return {
        exceeded: false,
        warningSent: false,
        currentCount: 0,
        limit: this.maxMessagesPerHour,
      };
    }
  }

  /**
   * Инкрементирует счетчик сообщений
   */
  async incrementCounter(telegramId: bigint): Promise<number> {
    const key = this.getKey(telegramId);

    try {
      // Инкрементируем счетчик
      const newCount = await this.redis.hincrby(key, 'count', 1);

      // Устанавливаем TTL если это первое сообщение (счетчик = 1)
      if (newCount === 1) {
        await this.redis.expire(key, this.ttl);
        this.logger.debug(
          `Started new rate limit window for ${telegramId} (TTL: ${this.ttl}s)`,
        );
      }

      this.logger.debug(
        `Incremented rate limit counter for ${telegramId}: ${newCount}/${this.maxMessagesPerHour}`,
      );

      return newCount;
    } catch (error) {
      this.logger.error(
        `Failed to increment rate limit counter for ${telegramId}`,
        error,
      );
      return 0;
    }
  }

  /**
   * Помечает что предупреждение отправлено
   */
  async markWarningSent(telegramId: bigint): Promise<void> {
    const key = this.getKey(telegramId);

    try {
      await this.redis.hset(key, 'warningSent', 'true');
      this.logger.debug(`Marked warning as sent for ${telegramId}`);
    } catch (error) {
      this.logger.error(
        `Failed to mark warning as sent for ${telegramId}`,
        error,
      );
    }
  }

  /**
   * Получает оставшееся время до сброса лимита
   */
  async getTimeToReset(telegramId: bigint): Promise<number> {
    const key = this.getKey(telegramId);

    try {
      const ttl = await this.redis.ttl(key);
      return ttl > 0 ? ttl : 0;
    } catch (error) {
      this.logger.error(`Failed to get TTL for ${telegramId}`, error);
      return 0;
    }
  }

  /**
   * Сбрасывает лимит для пользователя (для тестирования или админки)
   */
  async resetLimit(telegramId: bigint): Promise<void> {
    const key = this.getKey(telegramId);

    try {
      await this.redis.del(key);
      this.logger.log(`Reset rate limit for ${telegramId}`);
    } catch (error) {
      this.logger.error(`Failed to reset rate limit for ${telegramId}`, error);
    }
  }

  /**
   * Формирует ключ для Redis
   */
  private getKey(telegramId: bigint): string {
    return `rate_limit:user:${telegramId}`;
  }

  /**
   * Отмечает что пользователь начал печатать
   * TTL: 10 секунд (автоматически сбрасывается если не обновляется)
   */
  async setUserTyping(telegramId: bigint): Promise<void> {
    const key = this.getTypingKey(telegramId);
    try {
      await this.redis.set(key, Date.now().toString(), 'EX', 10);
      this.logger.debug(`User ${telegramId} is typing`);
    } catch (error) {
      this.logger.error(`Failed to set typing status for ${telegramId}`, error);
    }
  }

  /**
   * Проверяет, печатает ли пользователь сейчас
   */
  async isUserTyping(telegramId: bigint): Promise<boolean> {
    const key = this.getTypingKey(telegramId);
    try {
      const value = await this.redis.get(key);
      return value !== null;
    } catch (error) {
      this.logger.error(
        `Failed to check typing status for ${telegramId}`,
        error,
      );
      return false;
    }
  }

  /**
   * Очищает статус "печатает"
   */
  async clearUserTyping(telegramId: bigint): Promise<void> {
    const key = this.getTypingKey(telegramId);
    try {
      await this.redis.del(key);
      this.logger.debug(`User ${telegramId} stopped typing`);
    } catch (error) {
      this.logger.error(
        `Failed to clear typing status for ${telegramId}`,
        error,
      );
    }
  }

  /**
   * Ждет пока пользователь перестанет печатать + 5 секунд
   * Возвращает: true если дождались, false если timeout
   */
  async waitForUserToStopTyping(
    telegramId: bigint,
    maxWaitMs: number = 120000, // максимум 2 минуты ждем
  ): Promise<boolean> {
    const startTime = Date.now();
    let lastTypingCheck = Date.now();

    this.logger.debug(
      `Waiting for user ${telegramId} to stop typing (max ${maxWaitMs}ms)`,
    );

    while (Date.now() - startTime < maxWaitMs) {
      const isTyping = await this.isUserTyping(telegramId);

      if (isTyping) {
        // Пользователь печатает - обновляем время последней проверки
        lastTypingCheck = Date.now();
        this.logger.debug(`User ${telegramId} is still typing, waiting...`);
        await new Promise((resolve) => setTimeout(resolve, 1000)); // проверяем каждую секунду
      } else {
        // Пользователь не печатает
        const timeSinceLastTyping = Date.now() - lastTypingCheck;

        if (timeSinceLastTyping >= 5000) {
          // Прошло 5 секунд с момента как перестал печатать
          this.logger.debug(
            `User ${telegramId} stopped typing 5+ seconds ago, proceeding`,
          );
          return true;
        } else {
          // Еще не прошло 5 секунд, ждем
          const remainingMs = 5000 - timeSinceLastTyping;
          this.logger.debug(
            `User ${telegramId} stopped typing, waiting ${Math.ceil(remainingMs / 1000)}s more...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    // Timeout - слишком долго ждали
    this.logger.warn(
      `Timeout waiting for user ${telegramId} to stop typing (${maxWaitMs}ms exceeded)`,
    );
    return false;
  }

  /**
   * Формирует ключ для typing status
   */
  private getTypingKey(telegramId: bigint): string {
    return `typing_status:user:${telegramId}`;
  }

  /**
   * Закрывает соединение с Redis при остановке приложения
   */
  async onModuleDestroy() {
    await this.redis.quit();
    this.logger.log('Redis connection closed');
  }
}
