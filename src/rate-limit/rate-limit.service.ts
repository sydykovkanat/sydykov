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
      this.logger.error(
        `Failed to check rate limit for ${telegramId}`,
        error,
      );
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
      this.logger.error(
        `Failed to get TTL for ${telegramId}`,
        error,
      );
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
      this.logger.error(
        `Failed to reset rate limit for ${telegramId}`,
        error,
      );
    }
  }

  /**
   * Формирует ключ для Redis
   */
  private getKey(telegramId: bigint): string {
    return `rate_limit:user:${telegramId}`;
  }

  /**
   * Закрывает соединение с Redis при остановке приложения
   */
  async onModuleDestroy() {
    await this.redis.quit();
    this.logger.log('Redis connection closed');
  }
}
