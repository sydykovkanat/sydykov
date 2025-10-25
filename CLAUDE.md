# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal Telegram assistant for Kanat Sydykov (@nur_ksydykov) running on a **personal Telegram account** (via MTProto) that uses GPT-4o to respond naturally to private messages. The assistant accumulates messages for 10 seconds before responding, maintains conversation context with automatic summarization, and only processes private chats.

**Tech Stack**: NestJS, TypeScript, **telegram (MTProto/GramJS)**, OpenAI API, PostgreSQL, Prisma ORM, BullMQ, Redis, Pino

**Important**: This uses **MTProto** (user account), NOT Bot API. It runs as your personal account, so it can read and respond to all messages in private chats.

## Development Commands

```bash
# Development
yarn install              # Install dependencies
yarn start:dev            # Start with hot-reload
yarn build                # Build for production
yarn start:prod           # Run production build
yarn lint                 # Run ESLint with auto-fix
yarn format               # Format code with Prettier

# Testing
yarn test                 # Run all tests
yarn test:watch           # Run tests in watch mode
yarn test:cov             # Run tests with coverage

# Prisma
yarn prisma:generate      # Generate Prisma Client
yarn prisma:migrate       # Create and apply migration
yarn prisma:migrate:deploy # Apply migrations (production)
yarn prisma:studio        # Open Prisma Studio GUI
yarn prisma:reset         # Reset database (WARNING: deletes all data)

# Alternatively use npx directly:
npx prisma migrate dev --name migration_name
npx prisma generate

# MTProto Authentication
yarn auth                 # Generate session string (run once)

# Docker (PostgreSQL + Redis)
yarn docker:up            # Start containers
yarn docker:down          # Stop containers
yarn docker:logs          # View container logs
```

## Architecture & Message Flow

### Core Message Processing Flow

1. **TelegramService** ([telegram.service.ts](src/telegram/telegram.service.ts)) receives message from Telegram via MTProto
   - Uses `TelegramClient` with `NewMessage` event handler
   - Filters: Only private chats (`PeerUser`), ignores outgoing messages (`message.out === false`)
   - Extracts text and photo URLs (TODO: implement photo download/storage)
   - Calls `ConversationService.savePendingMessage()` to store in `PendingMessage` table
   - Adds job to BullMQ queue with 10-second delay (configurable via `MESSAGE_DELAY_SECONDS`)
   - **Asynchronously marks message as read** after random delay of 3-5 seconds (`markAsReadWithDelay()`) - simulates human reading time

2. **Queue System** (BullMQ + Redis) delays message processing
   - Job ID: `${userId}-${Date.now()}`
   - Delay: `messageDelaySeconds * 1000` (default 10s)
   - This allows accumulating multiple messages before responding

3. **MessageProcessor** ([message.processor.ts](src/queue/message.processor.ts)) processes after delay:
   - Fetches all unprocessed `PendingMessage` records for the user
   - Saves them to `Message` table with role='user'
   - Loads conversation context (summary + last N messages)
   - **Shows "typing..." indicator** (`setTyping()`) - user sees typing animation
   - Calls OpenAI API with context
   - Saves assistant response to `Message` table
   - Sends reply via Telegram (typing indicator auto-cancels)
   - Marks pending messages as processed
   - Triggers conversation summarization if needed

### Key Architectural Patterns

**Debounce Logic**: The 10-second delay allows users to send multiple messages (e.g., corrections, additions, photos) before the bot responds once with full context.

**Conversation Context**: Each conversation has:
- `summary` field: Summarized old messages (when conversation gets long)
- Recent messages: Last N messages (default 20, via `CONTEXT_MESSAGES_LIMIT`)
- Both are combined when calling OpenAI to maintain context while staying within token limits

**Photo Support**: The client can receive photos with captions. Photo handling via MTProto is available through `client.downloadMedia()` but needs to be implemented for storage (local files or S3). Currently photos are detected but not processed.

**Read Receipts & Typing**: The assistant marks messages as read after a random delay of 3-5 seconds (simulating human reading time) and shows "typing..." status while generating a response. This makes interactions feel natural and human-like.

## Module Structure

- **AppModule** ([app.module.ts](src/app.module.ts)): Root module, imports all others
- **TelegramModule**: Telegraf bot setup and message handling
- **QueueModule**: BullMQ configuration and shared queue
- **ConversationModule**: Business logic for conversations, messages, users
- **OpenAIModule**: OpenAI API integration
- **DatabaseModule**: Prisma service wrapper
- **ConfigModule**: Environment variables with validation

## Database Models (Prisma)

Schema location: [prisma/schema.prisma](prisma/schema.prisma)

**User**: Telegram users
- `telegramId` (BigInt, unique): Telegram user ID
- `username`, `firstName`, `lastName`: Profile info

**Conversation**: Dialogs with users
- `userId`: Foreign key to User
- `summary`: Summarized context of old messages (for long conversations)
- `lastMessageAt`: For sorting/cleanup

**Message**: Chat history
- `conversationId`: Foreign key to Conversation
- `role`: 'user' or 'assistant'
- `content`: Message text
- `imageUrls`: Array of photo URLs (if message has images)
- `telegramMessageId`: Original Telegram message ID (for user messages)

**PendingMessage**: Temporary queue for debounce logic
- `userId`, `telegramId`: User identifiers
- `content`, `imageUrls`: Message data
- `scheduledFor`: When to process (createdAt + delay)
- `processed`: Boolean flag
- Gets deleted after processing and moving to Message table

## Configuration

Required environment variables (see `.env.example`):

### Telegram MTProto Configuration
- `TELEGRAM_API_ID`: Get from https://my.telegram.org/apps
- `TELEGRAM_API_HASH`: Get from https://my.telegram.org/apps
- `TELEGRAM_SESSION_STRING`: Generate using `yarn auth` script
- `TELEGRAM_PHONE_NUMBER`: (Optional) Phone number for initial auth

### Other Configuration
- `OPENAI_API_KEY`: OpenAI API key
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_HOST`, `REDIS_PORT`: Redis connection
- `MESSAGE_DELAY_SECONDS`: Debounce delay (default: 10)
- `CONTEXT_MESSAGES_LIMIT`: How many recent messages to include (default: 20)

Configuration is validated via [config/configuration.ts](src/config/configuration.ts) using class-validator.

### Initial Setup

1. Get API credentials from https://my.telegram.org/apps
2. Add `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` to `.env`
3. Run `yarn auth` to authenticate and get session string
4. Add the session string to `.env` as `TELEGRAM_SESSION_STRING`
5. Start the application with `yarn start:dev`

## Important Implementation Details

**MTProto User Account**: This runs as a personal Telegram account, not a bot. It uses the `telegram` library (GramJS wrapper) to connect via MTProto protocol. This gives full access to all Telegram features as a regular user.

**Private Chats Only**: The service checks `peer instanceof Api.PeerUser` and `!message.out` to only process incoming messages from private chats. This is intentional to keep it as a personal assistant.

**Session Management**: The session is stored as a string (`TELEGRAM_SESSION_STRING`). Keep this secure - it provides full access to your Telegram account. Never commit it to git.

**AI Personality**: The AI personality/style is defined in `base.prompt.txt` file (referenced in OpenAI service).

**Logging**: Uses Pino with pretty-printing in development. Logs include message previews, processing steps, and errors.

**Graceful Shutdown**: Telegram client handles SIGINT/SIGTERM for clean disconnection.

**Production Deployment**: Recommended to use PM2 (`pm2 start dist/main.js --name sydykov-bot`) or Docker. Make sure to keep session string secure in production.
