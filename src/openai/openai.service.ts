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
  responseType: 'reaction' | 'text';
  content: string; // Emoji (👍❤️🔥🎉👏😁) or text response
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
   * Возвращает structured output с типом ответа (реакция или текст)
   */
  async generateResponse(messages: ChatMessage[]): Promise<AIResponse> {
    try {
      const systemMessage: ChatMessage = {
        role: 'system',
        content: this.baseSystemPrompt,
      };

      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [systemMessage, ...messages] as ChatCompletionMessageParam[],
        max_tokens: this.maxTokens,
        temperature: 0.8,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'response_with_reaction',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                responseType: {
                  type: 'string',
                  enum: ['reaction', 'text'],
                  description:
                    'Type of response: "reaction" for emoji reaction, "text" for text message',
                },
                content: {
                  type: 'string',
                  description:
                    'If responseType is "reaction", content MUST be EXACTLY one of these 6 emojis: 👍 ❤ 🔥 🎉 👏 😁 (NO OTHER EMOJIS ALLOWED, not even 👋 or 🙏). If responseType is "text", content is the text message in Russian.',
                },
              },
              required: ['responseType', 'content'],
              additionalProperties: false,
            },
          },
        },
      });

      const responseContent = completion.choices[0]?.message?.content;

      if (!responseContent) {
        throw new Error('No response from OpenAI');
      }

      // Парсим JSON ответ
      const aiResponse: AIResponse = JSON.parse(responseContent);

      this.logger.debug(
        `Generated ${aiResponse.responseType}: ${aiResponse.responseType === 'reaction' ? aiResponse.content : aiResponse.content.substring(0, 100) + '...'}`,
      );

      return aiResponse;
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
}
