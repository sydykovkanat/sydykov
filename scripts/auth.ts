#!/usr/bin/env ts-node

/**
 * Script to authenticate with Telegram MTProto and generate session string
 *
 * Usage:
 * 1. Get API_ID and API_HASH from https://my.telegram.org/apps
 * 2. Add them to .env file
 * 3. Run: yarn auth
 * 4. Enter phone number and code from Telegram
 * 5. Copy the session string to .env as TELEGRAM_SESSION_STRING
 */

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as readline from 'readline';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env file
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
};

async function main() {
  console.log('=== Telegram MTProto Authentication ===\n');

  // Get API credentials from .env
  const apiId = parseInt(process.env.TELEGRAM_API_ID || '0', 10);
  const apiHash = process.env.TELEGRAM_API_HASH || '';

  if (!apiId || !apiHash) {
    console.error('ERROR: TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in .env file');
    console.error('Get them from https://my.telegram.org/apps');
    process.exit(1);
  }

  console.log(`Using API_ID: ${apiId}`);
  console.log(`Using API_HASH: ${apiHash.substring(0, 8)}...`);
  console.log();

  // Create client with empty session
  const session = new StringSession('');
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => {
      const phone = await question('Enter your phone number (with country code, e.g., +1234567890): ');
      return phone.trim();
    },
    password: async () => {
      const password = await question('Enter your 2FA password (if enabled): ');
      return password.trim();
    },
    phoneCode: async () => {
      const code = await question('Enter the code you received from Telegram: ');
      return code.trim();
    },
    onError: (err) => {
      console.error('Authentication error:', err);
    },
  });

  console.log('\n=== Authentication successful! ===\n');

  // Get user info
  const me = await client.getMe();
  console.log('Logged in as:');
  console.log(`  Name: ${me.firstName} ${me.lastName || ''}`);
  console.log(`  Username: @${(me as any).username || 'no username'}`);
  console.log(`  ID: ${me.id}`);
  console.log();

  // Get and display session string
  const sessionString = client.session.save() as unknown as string;
  console.log('=== SESSION STRING ===');
  console.log('Copy this to your .env file as TELEGRAM_SESSION_STRING:');
  console.log();
  console.log(sessionString);
  console.log();
  console.log('======================');
  console.log();
  console.log('Add this line to your .env file:');
  console.log(`TELEGRAM_SESSION_STRING="${sessionString}"`);
  console.log();

  await client.disconnect();
  rl.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  rl.close();
  process.exit(1);
});
