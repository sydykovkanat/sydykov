import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service';
import { ChatMessage, OpenAIService } from '../openai/openai.service';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);
  private readonly contextMessagesLimit: number;
  private readonly summaryThreshold: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly openaiService: OpenAIService,
    private readonly configService: ConfigService,
  ) {
    this.contextMessagesLimit = this.configService.get<number>(
      'messageProcessing.contextMessagesLimit',
      20,
    );
    this.summaryThreshold = this.configService.get<number>(
      'messageProcessing.summaryThreshold',
      50,
    );
  }

  /**
   * Находит или создает пользователя по Telegram ID
   */
  async findOrCreateUser(
    telegramId: bigint,
    username?: string,
    firstName?: string,
    lastName?: string,
  ) {
    let user = await this.prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          telegramId,
          username,
          firstName,
          lastName,
        },
      });
      this.logger.log(
        `Created new user: ${user.id} (Telegram ID: ${telegramId})`,
      );
    }

    return user;
  }

  /**
   * Находит или создает диалог для пользователя
   */
  async findOrCreateConversation(userId: string) {
    let conversation = await this.prisma.conversation.findFirst({
      where: { userId },
      orderBy: { lastMessageAt: 'desc' },
    });

    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: { userId },
      });
      this.logger.log(
        `Created new conversation: ${conversation.id} for user: ${userId}`,
      );
    }

    return conversation;
  }

  /**
   * Сохраняет сообщение в БД
   */
  async saveMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    telegramMessageId?: number,
    imageUrls: string[] = [],
    imageBase64?: string,
  ) {
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        role,
        content,
        telegramMessageId,
        imageUrls,
        imageBase64,
      },
    });

    // Обновляем время последнего сообщения в диалоге
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    return message;
  }

  /**
   * Получает контекст для формирования промпта
   * Возвращает summary + последние N сообщений
   */
  async getConversationContext(conversationId: string): Promise<ChatMessage[]> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: this.contextMessagesLimit,
        },
      },
    });

    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const messages: ChatMessage[] = [];

    // Если есть summary, добавляем его первым
    if (conversation.summary) {
      messages.push({
        role: 'system',
        content: `Краткое резюме предыдущих сообщений:\n${conversation.summary}`,
      });
    }

    // Добавляем последние N сообщений (в обратном порядке, чтобы были от старых к новым)
    const recentMessages = conversation.messages.reverse();
    for (const msg of recentMessages) {
      // Если есть imageBase64 или imageUrls, формируем массив content
      const hasImages =
        (msg.imageUrls && msg.imageUrls.length > 0) || msg.imageBase64;

      if (hasImages) {
        const contentArray: Array<
          | { type: 'text'; text: string }
          | { type: 'image_url'; image_url: { url: string } }
        > = [];

        if (msg.content) {
          contentArray.push({ type: 'text', text: msg.content });
        }

        // Приоритет: base64 изображение (новый формат)
        if (msg.imageBase64) {
          contentArray.push({
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${msg.imageBase64}`,
            },
          });
        } else if (msg.imageUrls && msg.imageUrls.length > 0) {
          // Fallback на старый формат (imageUrls)
          for (const imageUrl of msg.imageUrls) {
            contentArray.push({
              type: 'image_url',
              image_url: { url: imageUrl },
            });
          }
        }

        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: contentArray,
        });
      } else {
        // Если нет картинок, просто текст
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
    }

    this.logger.debug(
      `Retrieved ${messages.length} messages for conversation ${conversationId}`,
    );
    return messages;
  }

  /**
   * Суммаризирует старые сообщения для сжатия контекста
   */
  async summarizeConversation(conversationId: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const messageCount = conversation.messages.length;

    // Проверяем, нужна ли суммаризация
    if (messageCount < this.summaryThreshold) {
      this.logger.debug(
        `Conversation ${conversationId} has only ${messageCount} messages, skipping summarization`,
      );
      return;
    }

    // Берем все сообщения кроме последних contextMessagesLimit
    const messagesToSummarize = conversation.messages.slice(
      0,
      -this.contextMessagesLimit,
    );

    if (messagesToSummarize.length === 0) {
      return;
    }

    const chatMessages: ChatMessage[] = messagesToSummarize.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));

    // Генерируем summary
    const summary = await this.openaiService.summarizeMessages(chatMessages);

    // Сохраняем summary и удаляем старые сообщения
    await this.prisma.$transaction([
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { summary },
      }),
      this.prisma.message.deleteMany({
        where: {
          id: {
            in: messagesToSummarize.map((msg) => msg.id),
          },
        },
      }),
    ]);

    this.logger.log(
      `Summarized ${messagesToSummarize.length} messages for conversation ${conversationId}`,
    );
  }

  /**
   * Сохраняет pending сообщение для debounce логики
   */
  async savePendingMessage(
    userId: string,
    telegramId: bigint,
    content: string,
    telegramMessageId: number,
    delaySeconds: number,
    imageUrls: string[] = [],
    imageBase64?: string,
  ) {
    const scheduledFor = new Date(Date.now() + delaySeconds * 1000);

    return await this.prisma.pendingMessage.create({
      data: {
        userId,
        telegramId,
        content,
        telegramMessageId,
        scheduledFor,
        imageUrls,
        imageBase64,
      },
    });
  }

  /**
   * Получает все непрочитанные pending сообщения для пользователя
   */
  async getPendingMessages(userId: string) {
    return await this.prisma.pendingMessage.findMany({
      where: {
        userId,
        processed: false,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Помечает pending сообщения как обработанные
   */
  async markPendingMessagesAsProcessed(messageIds: string[]) {
    await this.prisma.pendingMessage.updateMany({
      where: {
        id: { in: messageIds },
      },
      data: {
        processed: true,
      },
    });
  }

  /**
   * Устанавливает флаг игнорирования для чата (команда "стоп Канатик")
   */
  async setConversationIgnored(userId: string, ignored: boolean) {
    const conversation = await this.findOrCreateConversation(userId);
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { isIgnored: ignored },
    });
    this.logger.log(
      `Conversation ${conversation.id} isIgnored set to ${ignored}`,
    );
  }

  /**
   * Проверяет, игнорируется ли чат
   */
  async isConversationIgnored(userId: string): Promise<boolean> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { userId },
      orderBy: { lastMessageAt: 'desc' },
    });

    return conversation?.isIgnored ?? false;
  }
}
