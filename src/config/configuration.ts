import { plainToClass } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

enum LogLevel {
  Debug = 'debug',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
}

export class EnvironmentVariables {
  // Database
  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  // Telegram MTProto
  @IsInt()
  @IsPositive()
  TELEGRAM_API_ID: number;

  @IsString()
  @IsNotEmpty()
  TELEGRAM_API_HASH: string;

  @IsString()
  @IsNotEmpty()
  TELEGRAM_SESSION_STRING: string;

  @IsString()
  @IsOptional()
  TELEGRAM_PHONE_NUMBER?: string;

  // Bot Owner
  @IsString()
  @IsOptional()
  BOT_NAME?: string = 'канатик';

  @IsString()
  @IsOptional()
  OWNER_TELEGRAM_ID?: string;

  // OpenAI
  @IsString()
  @IsNotEmpty()
  OPENAI_API_KEY: string;

  @IsString()
  @IsNotEmpty()
  OPENAI_MODEL: string = 'gpt-4o-mini';

  @IsInt()
  @IsPositive()
  @Max(4096)
  @IsOptional()
  OPENAI_MAX_TOKENS?: number = 1000;

  // Redis
  @IsString()
  @IsNotEmpty()
  REDIS_HOST: string = 'localhost';

  @IsInt()
  @IsPositive()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number = 6379;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD?: string;

  // Application
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @IsPositive()
  @Min(1)
  @Max(65535)
  PORT: number = 8000;

  // Message Processing
  @IsInt()
  @IsPositive()
  @Min(1)
  @Max(60)
  MESSAGE_DELAY_SECONDS: number = 10;

  @IsInt()
  @IsPositive()
  @Min(5)
  @Max(100)
  CONTEXT_MESSAGES_LIMIT: number = 10;

  @IsInt()
  @IsPositive()
  @Min(10)
  @Max(200)
  SUMMARY_THRESHOLD: number = 50;

  // Rate Limiting
  @IsInt()
  @IsPositive()
  @Min(1)
  @Max(1000)
  RATE_LIMIT_MAX_MESSAGES_PER_HOUR: number = 50;

  @IsString()
  @IsOptional()
  RATE_LIMIT_WARNING_MESSAGE?: string = 'Я сейчас занят, чуть позже отвечу 🙏';

  // Typo Configuration
  @IsPositive()
  @Min(0)
  @Max(1)
  @IsOptional()
  TYPO_PROBABILITY?: number = 0.15;

  @IsInt()
  @IsPositive()
  @Min(1)
  @Max(10)
  @IsOptional()
  TYPO_FIX_DELAY_MIN?: number = 1;

  @IsInt()
  @IsPositive()
  @Min(1)
  @Max(10)
  @IsOptional()
  TYPO_FIX_DELAY_MAX?: number = 3;

  // Delay Configuration
  @IsPositive()
  @Min(0)
  @Max(1)
  @IsOptional()
  DELAY_NORMAL_PROBABILITY?: number = 0.8;

  @IsPositive()
  @Min(0)
  @Max(1)
  @IsOptional()
  DELAY_MEDIUM_PROBABILITY?: number = 0.15;

  @IsPositive()
  @Min(0)
  @Max(1)
  @IsOptional()
  DELAY_LONG_PROBABILITY?: number = 0.05;

  // Read Status Configuration
  @IsPositive()
  @Min(0)
  @Max(1)
  @IsOptional()
  READ_SEEN_WITHOUT_READ_PROBABILITY?: number = 0.2;

  // Logging
  @IsEnum(LogLevel)
  @IsOptional()
  LOG_LEVEL?: LogLevel = LogLevel.Info;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToClass(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(`Configuration validation error: ${errors.toString()}`);
  }

  return validatedConfig;
}

export default () => ({
  database: {
    url: process.env.DATABASE_URL,
  },
  telegram: {
    apiId: parseInt(process.env.TELEGRAM_API_ID || '0', 10),
    apiHash: process.env.TELEGRAM_API_HASH,
    sessionString: process.env.TELEGRAM_SESSION_STRING,
    phoneNumber: process.env.TELEGRAM_PHONE_NUMBER,
  },
  bot: {
    name: process.env.BOT_NAME || 'канатик',
    ownerTelegramId: process.env.OWNER_TELEGRAM_ID,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '300', 10),
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },
  app: {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '8000', 10),
  },
  messageProcessing: {
    delaySeconds: parseInt(process.env.MESSAGE_DELAY_SECONDS || '10', 10),
    contextMessagesLimit: parseInt(
      process.env.CONTEXT_MESSAGES_LIMIT || '10',
      10,
    ),
    summaryThreshold: parseInt(process.env.SUMMARY_THRESHOLD || '50', 10),
  },
  rateLimit: {
    maxMessagesPerHour: parseInt(
      process.env.RATE_LIMIT_MAX_MESSAGES_PER_HOUR || '50',
      10,
    ),
    warningMessage:
      process.env.RATE_LIMIT_WARNING_MESSAGE ||
      'Я сейчас занят, чуть позже отвечу 🙏',
  },
  typo: {
    probability: parseFloat(process.env.TYPO_PROBABILITY || '0.15'),
    fixDelayMin: parseInt(process.env.TYPO_FIX_DELAY_MIN || '1', 10),
    fixDelayMax: parseInt(process.env.TYPO_FIX_DELAY_MAX || '3', 10),
  },
  delay: {
    normalProbability: parseFloat(
      process.env.DELAY_NORMAL_PROBABILITY || '0.80',
    ),
    mediumProbability: parseFloat(
      process.env.DELAY_MEDIUM_PROBABILITY || '0.15',
    ),
    longProbability: parseFloat(process.env.DELAY_LONG_PROBABILITY || '0.05'),
  },
  readStatus: {
    seenWithoutReadProbability: parseFloat(
      process.env.READ_SEEN_WITHOUT_READ_PROBABILITY || '0.20',
    ),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
});
