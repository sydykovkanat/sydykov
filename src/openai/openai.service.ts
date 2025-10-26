import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { join } from 'path';

export type MessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: MessageContent;
}

export interface AIResponse {
  content: string; // Text response only
}

@Injectable()
export class OpenAIService implements OnModuleInit {
  private readonly logger = new Logger(OpenAIService.name);
  private client: OpenAI;
  private baseSystemPrompt: string;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('openai.apiKey');
    this.model = this.configService.get<string>('openai.model', 'gpt-4o-mini');
    this.maxTokens = this.configService.get<number>('openai.maxTokens', 1000);

    this.client = new OpenAI({
      apiKey,
    });
  }

  onModuleInit() {
    try {
      // Загружаем базовый промпт из файла
      const promptPath = join(process.cwd(), 'base.prompt.txt');
      this.baseSystemPrompt = readFileSync(promptPath, 'utf-8');
      this.logger.log('Base system prompt loaded successfully');
    } catch (error) {
      this.logger.error('Failed to load base system prompt', error);
      throw error;
    }
  }

  /**
   * Генерирует ответ на основе контекста разговора
   * @param messages - история сообщений
   * @param userName - имя пользователя (опционально)
   */
  async generateResponse(
    messages: ChatMessage[],
    userName?: string,
  ): Promise<AIResponse> {
    try {
      // Формируем системный промпт с именем пользователя (если есть)
      let systemPromptContent = this.baseSystemPrompt;
      if (userName) {
        systemPromptContent += `\n\nТЫ ОБЩАЕШЬСЯ С: ${userName}`;
      }

      const systemMessage: ChatMessage = {
        role: 'system',
        content: systemPromptContent,
      };

      // Детальное логирование контекста
      this.logger.log('=== GPT REQUEST CONTEXT ===');
      this.logger.log(
        `System Prompt Length: ${this.baseSystemPrompt.length} chars`,
      );
      this.logger.log(
        `Total Messages: ${messages.length + 1} (1 system + ${messages.length} conversation)`,
      );
      this.logger.log('=== END CONTEXT ===');

      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [systemMessage, ...messages] as ChatCompletionMessageParam[],
        max_tokens: this.maxTokens,
        temperature: 0.8,
      });

      const responseContent = completion.choices[0]?.message?.content;

      if (!responseContent) {
        throw new Error('No response from OpenAI');
      }

      this.logger.debug(
        `Generated text: ${responseContent.substring(0, 100)}...`,
      );

      return { content: responseContent };
    } catch (error) {
      this.logger.error('Failed to generate response from OpenAI', error);
      throw error;
    }
  }

  /**
   * Суммаризирует старые сообщения для сжатия контекста
   */
  async summarizeMessages(messages: ChatMessage[]): Promise<string> {
    try {
      const summaryPrompt: ChatMessage = {
        role: 'system',
        content: `Ты — ассистент, который суммаризирует историю переписки.
Твоя задача — создать краткое резюме диалога на русском языке, сохраняя ключевые факты, темы и контекст.
Резюме должно быть кратким (не более 300 слов), но информативным.`,
      };

      // Конвертируем сообщения в текст для суммаризации
      const messageTexts = messages
        .map((m) => {
          const contentText =
            typeof m.content === 'string'
              ? m.content
              : m.content
                  .map((c) => (c.type === 'text' ? c.text : '[изображение]'))
                  .join(' ');
          return `${m.role}: ${contentText}`;
        })
        .join('\n');

      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          summaryPrompt,
          {
            role: 'user',
            content: `Суммаризируй следующие сообщения:\n\n${messageTexts}`,
          },
        ] as ChatCompletionMessageParam[],
        max_tokens: 500,
        temperature: 0.5,
      });

      const summary = completion.choices[0]?.message?.content;

      if (!summary) {
        throw new Error('No summary from OpenAI');
      }

      this.logger.debug(`Generated summary: ${summary.substring(0, 100)}...`);
      return summary;
    } catch (error) {
      this.logger.error('Failed to summarize messages', error);
      throw error;
    }
  }

  /**
   * Извлекает факты о пользователе из разговора
   * Возвращает массив фактов с категориями
   */
  async extractFacts(
    messages: ChatMessage[],
  ): Promise<Array<{ category: string; fact: string }>> {
    try {
      const factsPrompt: ChatMessage = {
        role: 'system',
        content: `Ты — ассистент, который анализирует разговоры и извлекает важные факты о пользователе.

Категории фактов:
- birthday: дни рождения (свои или близких)
- interests: интересы, хобби
- plans: планы на будущее
- work: работа, учеба
- relationships: отношения (семья, друзья)
- other: другие важные факты

Верни только НОВЫЕ факты (которые еще не были упомянуты ранее).
Если новых фактов нет, верни пустой массив.

Формат ответа: строгий JSON массив объектов с полями "category" и "fact".
Пример: [{"category":"birthday","fact":"День рождения 15 мая"},{"category":"work","fact":"Работает фронтенд разработчиком в компании О!"}]

Важно: отвечай ТОЛЬКО валидным JSON, без дополнительного текста.`,
      };

      // Конвертируем только последние 5-10 сообщений для анализа
      const recentMessages = messages.slice(-10);
      const messageTexts = recentMessages
        .map((m) => {
          const contentText =
            typeof m.content === 'string'
              ? m.content
              : m.content
                  .map((c) => (c.type === 'text' ? c.text : '[изображение]'))
                  .join(' ');
          return `${m.role}: ${contentText}`;
        })
        .join('\n');

      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          factsPrompt,
          {
            role: 'user',
            content: `Проанализируй разговор и извлеки факты:\n\n${messageTexts}`,
          },
        ] as ChatCompletionMessageParam[],
        max_tokens: 500,
        temperature: 0.3,
      });

      const responseContent = completion.choices[0]?.message?.content;

      if (!responseContent) {
        this.logger.warn('No response from OpenAI for facts extraction');
        return [];
      }

      try {
        // Парсим JSON ответ
        const facts = JSON.parse(responseContent.trim());

        if (!Array.isArray(facts)) {
          this.logger.warn(
            'Facts response is not an array, returning empty array',
          );
          return [];
        }

        this.logger.log(`Extracted ${facts.length} facts from conversation`);
        return facts;
      } catch (parseError) {
        this.logger.error(
          'Failed to parse facts JSON, returning empty array',
          parseError,
        );
        this.logger.debug(`Raw response: ${responseContent}`);
        return [];
      }
    } catch (error) {
      this.logger.error('Failed to extract facts', error);
      return [];
    }
  }
}
