# Quick Setup Guide: MTProto Migration

This guide will help you set up the Telegram userbot using MTProto.

## Prerequisites

✅ Node.js >= 18
✅ Docker and Docker Compose
✅ Telegram account

## Step-by-Step Setup

### 1. Get Telegram API Credentials

1. Go to https://my.telegram.org/apps
2. Login with your phone number
3. Click "API development tools"
4. Fill in the form:
   - App title: `sydykov-bot` (or any name)
   - Short name: `sydykov` (or any short name)
   - Platform: Other
5. Copy **api_id** and **api_hash**

### 2. Configure Environment

```bash
# Copy example env file
cp .env.example .env

# Edit .env and add your credentials
nano .env
```

Update these values in `.env`:
```env
TELEGRAM_API_ID=12345678                    # Your api_id from step 1
TELEGRAM_API_HASH=abcdef1234567890abcdef   # Your api_hash from step 1
OPENAI_API_KEY=sk-...                       # Your OpenAI API key
```

### 3. Install Dependencies

```bash
yarn install
```

### 4. Start Infrastructure

```bash
# Start PostgreSQL and Redis
yarn docker:up

# Run database migrations
yarn prisma:generate
yarn prisma:migrate
```

### 5. Authenticate with Telegram

**⚠️ IMPORTANT: This step generates your session string**

```bash
yarn auth
```

Follow the prompts:
1. Enter your phone number (international format): `+1234567890`
2. Enter the code you receive in Telegram
3. If you have 2FA enabled, enter your password
4. Copy the **SESSION_STRING** that appears

Example output:
```
=== SESSION STRING ===
Copy this to your .env file as TELEGRAM_SESSION_STRING:

1AgAOMTQ5LjE1NC4xNjcuNTEBu...very_long_string...

======================
```

### 6. Add Session String to .env

Open `.env` and add:
```env
TELEGRAM_SESSION_STRING="1AgAOMTQ5LjE1NC4xNjcuNTEBu...paste_your_session_string_here..."
```

**⚠️ SECURITY WARNING**:
- This session string gives FULL ACCESS to your Telegram account
- Never commit it to git (it's already in .gitignore)
- Keep it secure like a password

### 7. Build and Run

```bash
# Build the project
yarn build

# Run in development mode
yarn start:dev

# Or run in production mode
yarn start:prod
```

### 8. Verify It's Working

You should see in the logs:
```
[TelegramService] Telegram MTProto client connected successfully
[TelegramService] Logged in as: Your Name (@your_username)
```

Now send yourself a message in Telegram and the bot should respond!

## Common Issues

### "Failed to connect Telegram MTProto client"
- Check your `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`
- Make sure they're numbers/strings, not empty

### "Session expired" errors
- Run `yarn auth` again to generate a new session string
- Update `.env` with the new session string
- Restart the application

### Bot doesn't respond
- Check that Redis and PostgreSQL are running: `docker-compose ps`
- Check logs for errors: `yarn start:dev`
- Make sure you're sending messages to **private chats** only (not groups)
- Wait 10 seconds (default debounce delay)

### Can't run `yarn auth`
- Make sure `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` are in `.env`
- Try running: `ts-node scripts/auth.ts` directly

## Next Steps

- Customize the AI personality in `src/openai/base.prompt.txt`
- Adjust `MESSAGE_DELAY_SECONDS` in `.env` (default: 10 seconds)
- Deploy to production using PM2 or Docker

## Production Deployment

For production, use PM2:

```bash
# Install PM2
npm install -g pm2

# Start the app
pm2 start dist/main.js --name sydykov-bot

# Enable auto-start on system reboot
pm2 startup
pm2 save
```

## Help

For more details, see:
- [README.md](./README.md) - Full documentation
- [CLAUDE.md](./CLAUDE.md) - Architecture and implementation details
