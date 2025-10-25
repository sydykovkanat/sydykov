# Telegram Personal Assistant для Каната Сыдыкова (@nur_ksydykov)

Умный Telegram-ассистент, работающий на **личном аккаунте** через MTProto, который обрабатывает личные сообщения используя GPT-4o для естественного общения. Ассистент накапливает сообщения в течение 10 секунд перед ответом, хранит контекст диалогов и автоматически суммаризирует историю.

**⚠️ ВАЖНО**: Это НЕ обычный бот! Проект использует **MTProto** (личный аккаунт), а не Bot API. Работает как обычный пользователь Telegram.

## Технологический стек

- **Backend**: NestJS + TypeScript
- **Telegram API**: telegram (MTProto/GramJS)
- **AI**: OpenAI (GPT-4o / GPT-4o-mini)
- **Database**: PostgreSQL + Prisma ORM
- **Queue**: BullMQ + Redis
- **Logging**: Pino

## Архитектура

```
src/
├── config/          # Конфигурация с валидацией
├── database/        # Prisma сервис
├── telegram/        # Обработка Telegram сообщений
├── openai/          # Интеграция с OpenAI
├── conversation/    # Управление контекстом и историей
├── queue/           # BullMQ очереди и процессоры
└── common/          # Общие утилиты
```

## Ключевые особенности

1. **Debounce логика**: Ждет 10 секунд, собирает все сообщения и отвечает один раз
2. **Контекст диалогов**: Хранит историю с автоматической суммаризацией
3. **Только личные чаты**: Игнорирует все группы и каналы
4. **Natural AI**: Использует промпт из `base.prompt.txt` для естественного общения

## Быстрый старт

### 1. Предварительные требования

- Node.js >= 18
- Docker и Docker Compose
- Yarn (или npm)

### 2. Установка

```bash
# Клонировать репозиторий
git clone <repo-url>
cd sydykov

# Установить зависимости
yarn install
```

### 3. Конфигурация

```bash
# Скопировать .env.example в .env
cp .env.example .env

# Отредактировать .env и добавить:
# - TELEGRAM_API_ID и TELEGRAM_API_HASH (получить на https://my.telegram.org/apps)
# - OPENAI_API_KEY (от OpenAI)
# - DATABASE_URL (если не используете docker-compose)
```

**Важно**: Нужно зарегистрировать приложение на https://my.telegram.org/apps для получения API_ID и API_HASH

### 4. Запуск инфраструктуры

```bash
# Запустить PostgreSQL и Redis через Docker
docker-compose up -d

# Применить миграции Prisma
npx prisma migrate dev

# Сгенерировать Prisma Client
npx prisma generate
```

### 5. Авторизация в Telegram

**⚠️ КРИТИЧЕСКИ ВАЖНЫЙ ШАГ**

```bash
# Запустить скрипт авторизации
yarn auth

# Следуйте инструкциям:
# 1. Введите номер телефона (в формате +1234567890)
# 2. Введите код из Telegram
# 3. Скопируйте полученный SESSION_STRING в .env
```

Скопируйте полученный session string в `.env`:
```
TELEGRAM_SESSION_STRING="ваш_длинный_session_string_здесь"
```

**⚠️ ВАЖНО**: Session string дает полный доступ к вашему аккаунту! Никогда не коммитьте его в git!

### 6. Запуск приложения

```bash
# Development mode с hot-reload
yarn start:dev

# Production build
yarn build
yarn start:prod
```

## Работа с Prisma

```bash
# Создать миграцию после изменения schema.prisma
npx prisma migrate dev --name migration_name

# Открыть Prisma Studio для просмотра БД
npx prisma studio

# Применить миграции в production
npx prisma migrate deploy
```

## Переменные окружения

См. `.env.example` для полного списка переменных:

### Telegram MTProto
- `TELEGRAM_API_ID` - App api_id с https://my.telegram.org/apps
- `TELEGRAM_API_HASH` - App api_hash с https://my.telegram.org/apps
- `TELEGRAM_SESSION_STRING` - Сессия (получить через `yarn auth`)
- `TELEGRAM_PHONE_NUMBER` - (Опционально) Номер телефона

### Другие настройки
- `OPENAI_API_KEY` - ключ API OpenAI
- `DATABASE_URL` - строка подключения к PostgreSQL
- `REDIS_HOST`, `REDIS_PORT` - настройки Redis
- `MESSAGE_DELAY_SECONDS` - задержка перед ответом (по умолчанию 10 сек)
- `CONTEXT_MESSAGES_LIMIT` - количество сообщений в контексте (по умолчанию 20)

## Деплой

### PM2 (рекомендуется для production)

```bash
# Установить PM2
npm install -g pm2

# Запустить приложение
pm2 start dist/main.js --name sydykov-bot

# Автозапуск при перезагрузке
pm2 startup
pm2 save
```

### Docker (альтернатива)

```bash
# Build образа
docker build -t sydykov-bot .

# Запуск контейнера
docker run -d \
  --name sydykov-bot \
  --env-file .env \
  -p 8000:8000 \
  sydykov-bot
```

## Логи и мониторинг

```bash
# Просмотр логов (development)
yarn start:dev

# Просмотр логов PM2
pm2 logs sydykov-bot

# Мониторинг PM2
pm2 monit
```

## Структура базы данных

- **users** - пользователи Telegram
- **conversations** - диалоги с summary
- **messages** - история сообщений
- **pending_messages** - буфер для debounce логики

## Разработка

```bash
# Запуск линтера
yarn lint

# Форматирование кода
yarn format

# Сборка проекта
yarn build
```

## Troubleshooting

### Ассистент не отвечает

1. Проверьте, что Redis и PostgreSQL запущены
2. Проверьте логи: `pm2 logs` или консоль
3. Убедитесь, что `TELEGRAM_SESSION_STRING` добавлен в .env
4. Проверьте, что вы авторизованы (должно быть сообщение "Logged in as: ...")
5. Проверьте, что пишете в **личные сообщения**, а не в группу

### Ошибки авторизации

```bash
# Удалите старый session string и авторизуйтесь заново
yarn auth
```

### Session истек

Если видите ошибки типа "Session expired":
1. Запустите `yarn auth` заново
2. Обновите `TELEGRAM_SESSION_STRING` в .env
3. Перезапустите приложение

### Ошибки с БД

```bash
# Пересоздать БД
npx prisma migrate reset

# Проверить подключение
npx prisma db pull
```

### Ошибки с Redis

```bash
# Проверить статус Redis
docker-compose ps redis

# Перезапустить Redis
docker-compose restart redis
```

## Лицензия

UNLICENSED - частный проект
