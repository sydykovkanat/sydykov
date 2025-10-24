import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const MESSAGE_QUEUE = 'message-queue';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get('redis.host'),
          port: configService.get('redis.port'),
          password: configService.get('redis.password'),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: MESSAGE_QUEUE,
    }),
  ],
  exports: [BullModule],
})
export class SharedQueueModule {}
