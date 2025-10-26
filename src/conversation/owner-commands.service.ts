import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service';

import { ConversationService } from './conversation.service';

export interface CommandResult {
  isCommand: boolean; // true если это выполненная команда (не нужно обрабатывать через AI)
  response?: string; // Ответ команды (если isCommand === true)
  isOwnerMessage: boolean; // true если сообщение содержит botName от владельца (даже если команда неизвестна)
}

@Injectable()
export class OwnerCommandsService {
  private readonly logger = new Logger(OwnerCommandsService.name);
  private readonly botName: string;
  private readonly ownerTelegramId?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly conversationService: ConversationService,
  ) {
    this.botName = this.configService.get<string>('bot.name', 'канатик');
    this.ownerTelegramId = this.configService.get<string>(
      'bot.ownerTelegramId',
    );
  }

  /**
   * Проверяет, является ли сообщение командой от владельца
   * @param ownerTelegramId - ID владельца (для проверки прав)
   * @param targetTelegramId - ID целевого пользователя (для команд стоп/продолжай)
   * @param messageText - текст сообщения
   */
  async handleOwnerCommand(
    ownerTelegramId: bigint,
    targetTelegramId: bigint,
    messageText: string,
  ): Promise<CommandResult> {
    // Если OWNER_TELEGRAM_ID не настроен, команды недоступны
    if (!this.ownerTelegramId) {
      return { isCommand: false, isOwnerMessage: false };
    }

    // Проверяем, что это владелец
    if (ownerTelegramId.toString() !== this.ownerTelegramId) {
      return { isCommand: false, isOwnerMessage: false };
    }

    // Проверяем, что сообщение содержит имя бота
    const lowerText = messageText.toLowerCase().trim();
    const lowerBotName = this.botName.toLowerCase();

    if (!lowerText.includes(lowerBotName)) {
      return { isCommand: false, isOwnerMessage: false };
    }

    // Это сообщение владельца с именем бота
    this.logger.debug(`Processing owner message: ${messageText}`);

    // Убираем имя бота и запятую, получаем чистую команду
    const commandText = lowerText
      .replace(lowerBotName, '')
      .replace(/^[,\s]+/, '')
      .replace(/[,\s]+$/, '')
      .trim();

    // Обрабатываем команды
    let response: string | undefined;

    if (
      this.matchesCommand(commandText, [
        'айди',
        'мой айди',
        'айди чата',
        'айди пользователя',
        'id',
        'my id',
      ])
    ) {
      response = this.handleGetId(ownerTelegramId);
    } else if (
      this.matchesCommand(commandText, [
        'информация',
        'моя информация',
        'информация о чате',
        'инфо',
        'info',
      ])
    ) {
      response = await this.handleGetInfo(targetTelegramId);
    } else if (
      this.matchesCommand(commandText, [
        'команды',
        'список команд',
        'помощь',
        'help',
        'commands',
      ])
    ) {
      response = this.handleGetCommands();
    } else if (
      this.matchesCommand(commandText, ['статистика', 'стата', 'stats'])
    ) {
      response = await this.handleGetStats(ownerTelegramId);
    } else if (
      commandText.startsWith('установить контекст ') ||
      commandText.startsWith('set context ')
    ) {
      const context = commandText
        .replace(/^установить контекст /, '')
        .replace(/^set context /, '')
        .trim();
      response = await this.handleSetContext(targetTelegramId, context);
    } else if (
      this.matchesCommand(commandText, [
        'очистить контекст',
        'удалить контекст',
        'clear context',
      ])
    ) {
      response = await this.handleClearContext(targetTelegramId);
    } else if (
      this.matchesCommand(commandText, [
        'игнор-лист',
        'список игнорируемых',
        'ignored list',
      ])
    ) {
      response = await this.handleGetIgnoredList();
    } else if (
      this.matchesCommand(commandText, ['стоп', 'стоп канатик', 'stop'])
    ) {
      response = await this.handleStopChat(targetTelegramId);
    } else if (
      this.matchesCommand(commandText, [
        'продолжай',
        'продолжай канатик',
        'continue',
      ])
    ) {
      response = await this.handleContinueChat(targetTelegramId);
    } else {
      // Неизвестная команда - отправить на обработку AI
      this.logger.debug(
        `Unknown owner command "${commandText}", will be processed by AI`,
      );
      return { isCommand: false, isOwnerMessage: true };
    }

    // Известная команда - выполнена успешно
    return { isCommand: true, isOwnerMessage: true, response };
  }

  /**
   * Проверяет, соответствует ли командный текст одному из вариантов
   */
  private matchesCommand(commandText: string, variants: string[]): boolean {
    return variants.some((variant) => commandText === variant);
  }

  /**
   * Команда: получить Telegram ID
   */
  private handleGetId(telegramId: bigint): string {
    return `Твой Telegram ID: \`${telegramId}\``;
  }

  /**
   * Команда: получить информацию о контексте пользователя
   */
  private async handleGetInfo(telegramId: bigint): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) {
      return 'Пользователь не найден в базе данных.';
    }

    let info = `Информация о пользователе\n\n`;
    info += `Telegram ID: \`${telegramId}\`\n`;
    info += `Username: ${user.username || 'не указан'}\n`;
    info += `Имя: ${user.firstName || 'не указано'} ${user.lastName || ''}\n`;
    info += `Создан: ${user.createdAt.toLocaleString('ru-RU')}\n\n`;

    if (user.customContext) {
      info += `Персональный контекст:\n${user.customContext}`;
    } else {
      info += `Персональный контекст не установлен.`;
    }

    return info;
  }

  /**
   * Команда: список всех команд
   */
  private handleGetCommands(): string {
    return `Доступные команды для владельца:

📋 Информация
• \`канатик, айди\` - получить свой Telegram ID
• \`канатик, информация\` - информация о контексте

📊 Статистика
• \`канатик, статистика\` - статистика по сообщениям

⚙️ Управление контекстом
• \`канатик, установить контекст [текст]\` - установить персональный контекст
• \`канатик, очистить контекст\` - удалить персональный контекст

🚫 Игнор-лист
• \`канатик, игнор-лист\` - список игнорируемых чатов
• \`канатик, стоп\` - добавить текущий чат в игнор-лист
• \`канатик, продолжай\` - убрать текущий чат из игнор-листа

❓ Помощь
• \`канатик, команды\` - показать этот список

**Другие запросы:** Если написать "канатик, [что угодно]" и команда неизвестна - запрос будет обработан через AI как личный ассистент.`;
  }

  /**
   * Команда: статистика по сообщениям
   */
  private async handleGetStats(telegramId: bigint): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { telegramId },
      include: {
        conversations: {
          include: {
            messages: true,
          },
        },
      },
    });

    if (!user) {
      return 'Пользователь не найден в базе данных.';
    }

    const totalConversations = user.conversations.length;
    const totalMessages = user.conversations.reduce(
      (sum, conv) => sum + conv.messages.length,
      0,
    );
    const userMessages = user.conversations.reduce(
      (sum, conv) =>
        sum + conv.messages.filter((msg) => msg.role === 'user').length,
      0,
    );
    const assistantMessages = user.conversations.reduce(
      (sum, conv) =>
        sum + conv.messages.filter((msg) => msg.role === 'assistant').length,
      0,
    );

    let stats = `Статистика\n\n`;
    stats += `Всего диалогов: ${totalConversations}\n`;
    stats += `Всего сообщений: ${totalMessages}\n`;
    stats += `├─ Твоих: ${userMessages}\n`;
    stats += `└─ Ассистента: ${assistantMessages}\n`;

    return stats;
  }

  /**
   * Команда: установить персональный контекст
   */
  private async handleSetContext(
    telegramId: bigint,
    context: string,
  ): Promise<string> {
    if (!context || context.trim().length === 0) {
      return 'Укажи текст контекста после команды.\n\nПример: `канатик, установить контекст Это мой руководитель`';
    }

    await this.prisma.user.update({
      where: { telegramId },
      data: { customContext: context },
    });

    this.logger.log(
      `Updated custom context for user ${telegramId}: ${context.substring(0, 50)}...`,
    );

    return `Персональный контекст обновлен:\n\n${context}`;
  }

  /**
   * Команда: очистить персональный контекст
   */
  private async handleClearContext(telegramId: bigint): Promise<string> {
    await this.prisma.user.update({
      where: { telegramId },
      data: { customContext: null },
    });

    this.logger.log(`Cleared custom context for user ${telegramId}`);

    return 'Персональный контекст удален.';
  }

  /**
   * Команда: список игнорируемых чатов
   */
  private async handleGetIgnoredList(): Promise<string> {
    const ignoredConversations = await this.prisma.conversation.findMany({
      where: { isIgnored: true },
      include: {
        user: true,
      },
    });

    if (ignoredConversations.length === 0) {
      return 'Игнор-лист пуст.';
    }

    let list = `Игнорируемые чаты (${ignoredConversations.length}):\n\n`;
    for (const conv of ignoredConversations) {
      const username = conv.user.username ? `@${conv.user.username}` : '';
      const name = [conv.user.firstName, conv.user.lastName]
        .filter(Boolean)
        .join(' ');
      list += `• ${name || 'Без имени'} ${username}\n`;
      list += `  ID: \`${conv.user.telegramId}\`\n\n`;
    }

    return list;
  }

  /**
   * Команда: остановить ответы в текущем чате
   */
  private async handleStopChat(telegramId: bigint): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) {
      return 'Пользователь не найден.';
    }

    await this.conversationService.setConversationIgnored(user.id, true);

    this.logger.log(`Chat with ${telegramId} added to ignore list`);

    return 'Чат добавлен в игнор-лист. Я не буду отвечать на сообщения из этого чата.';
  }

  /**
   * Команда: продолжить отвечать в текущем чате
   */
  private async handleContinueChat(telegramId: bigint): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) {
      return 'Пользователь не найден.';
    }

    await this.conversationService.setConversationIgnored(user.id, false);

    this.logger.log(`Chat with ${telegramId} removed from ignore list`);

    return 'Чат удален из игнор-листа. Я снова буду отвечать на сообщения.';
  }
}
