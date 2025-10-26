import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';

export interface ExtractedFact {
  category: string;
  fact: string;
}

@Injectable()
export class FactsService {
  private readonly logger = new Logger(FactsService.name);

  constructor(private readonly db: PrismaService) {}

  /**
   * Сохраняет факты о пользователе
   * Если факт с такой же категорией уже существует, обновляет его
   */
  async saveFactsForUser(
    userId: string,
    facts: ExtractedFact[],
  ): Promise<void> {
    if (facts.length === 0) {
      this.logger.debug(`No facts to save for user ${userId}`);
      return;
    }

    this.logger.log(`Saving ${facts.length} facts for user ${userId}`);

    for (const { category, fact } of facts) {
      try {
        // Проверяем, существует ли уже факт с такой категорией
        const existingFact = await this.db.userFact.findFirst({
          where: {
            userId,
            category,
          },
        });

        if (existingFact) {
          // Обновляем существующий факт
          await this.db.userFact.update({
            where: { id: existingFact.id },
            data: { fact },
          });
          this.logger.debug(
            `Updated fact for user ${userId}, category: ${category}`,
          );
        } else {
          // Создаем новый факт
          await this.db.userFact.create({
            data: {
              userId,
              category,
              fact,
            },
          });
          this.logger.debug(
            `Created fact for user ${userId}, category: ${category}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to save fact for user ${userId}, category: ${category}`,
          error,
        );
      }
    }
  }

  /**
   * Получает все факты о пользователе
   */
  async getFactsForUser(userId: string): Promise<ExtractedFact[]> {
    try {
      const facts = await this.db.userFact.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });

      return facts.map(({ category, fact }) => ({ category, fact }));
    } catch (error) {
      this.logger.error(`Failed to get facts for user ${userId}`, error);
      return [];
    }
  }

  /**
   * Форматирует факты для добавления в контекст OpenAI
   */
  formatFactsForContext(facts: ExtractedFact[]): string {
    if (facts.length === 0) {
      return '';
    }

    const lines = facts.map(
      ({ category, fact }) => `  - [${category}] ${fact}`,
    );

    return `Факты о пользователе:\n${lines.join('\n')}`;
  }

  /**
   * Удаляет факт по категории
   */
  async deleteFactByCategory(
    userId: string,
    category: string,
  ): Promise<boolean> {
    try {
      await this.db.userFact.deleteMany({
        where: { userId, category },
      });

      this.logger.log(
        `Deleted fact for user ${userId}, category: ${category}`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to delete fact for user ${userId}, category: ${category}`,
        error,
      );
      return false;
    }
  }

  /**
   * Удаляет все факты о пользователе
   */
  async deleteAllFactsForUser(userId: string): Promise<boolean> {
    try {
      await this.db.userFact.deleteMany({
        where: { userId },
      });

      this.logger.log(`Deleted all facts for user ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete facts for user ${userId}`, error);
      return false;
    }
  }
}
