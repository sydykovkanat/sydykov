#!/bin/bash

set -e # Exit on any error

echo "🚀 Starting deployment..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="sydykov-bot"
APP_DIR="$HOME/sydykov"

cd "$APP_DIR"

echo -e "${BLUE}📥 Pulling latest changes...${NC}"
git pull origin main

echo -e "${BLUE}📦 Installing dependencies...${NC}"
yarn install --frozen-lockfile

echo -e "${BLUE}🗄️  Running database migrations...${NC}"
npx prisma migrate deploy
npx prisma generate

echo -e "${BLUE}🔨 Building application...${NC}"
yarn build

echo -e "${BLUE}🔄 Restarting PM2...${NC}"
if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
  pm2 restart "$APP_NAME"
else
  echo -e "${BLUE}Starting new PM2 process...${NC}"
  pm2 start dist/main.js --name "$APP_NAME"
fi

echo -e "${GREEN}✅ Deployment completed!${NC}"
pm2 status "$APP_NAME"
pm2 logs "$APP_NAME" --lines 20
