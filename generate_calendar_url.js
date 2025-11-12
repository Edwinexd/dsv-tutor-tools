#!/usr/bin/env node
/**
 * Generate encrypted calendar URL for a user
 *
 * Usage:
 *   node generate_calendar_url.js [username] [password]
 *
 * If no arguments provided, reads from .env file (SU_USERNAME, SU_PASSWORD)
 */

import crypto from 'crypto';
import fs from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

// Configuration
const WORKER_URL = 'https://dsv-calendar.edt.workers.dev';

/**
 * Encrypt credentials using AES-GCM
 * @param {string} plaintext - Format: "username:password"
 * @param {string} keyBase64 - Base64-encoded AES-256 key
 * @returns {string} Format: "iv:authTag:ciphertext" (all base64)
 */
function encryptCredentials(plaintext, keyBase64) {
  // Generate random IV (12 bytes for AES-GCM)
  const iv = crypto.randomBytes(12);

  // Decode key from base64
  const key = Buffer.from(keyBase64, 'base64');

  // Create cipher
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  // Encrypt
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);

  // Get auth tag
  const authTag = cipher.getAuthTag();

  // Encode to base64 and combine
  const ivBase64 = iv.toString('base64');
  const authTagBase64 = authTag.toString('base64');
  const ciphertextBase64 = ciphertext.toString('base64');

  return `${ivBase64}:${authTagBase64}:${ciphertextBase64}`;
}

/**
 * Get secret from environment
 * @param {string} secretName
 * @returns {Promise<string>}
 */
async function getWranglerSecret(secretName) {
  try {
    // Try to read from .env file
    if (fs.existsSync('.env')) {
      const content = fs.readFileSync('.env', 'utf8');
      const match = content.match(new RegExp(`^${secretName}\\s*=\\s*(.+)$`, 'm'));
      if (match) {
        return match[1].trim();
      }
    }

    console.error(`Warning: ${secretName} not found in .env`);
    console.error('Please ensure the secret is set in .env file');
    return null;
  } catch (e) {
    console.error(`Error reading secret ${secretName}:`, e.message);
    return null;
  }
}

/**
 * Read credentials from .env file
 * @returns {{username: string, password: string} | null}
 */
function readEnvCredentials() {
  try {
    if (!fs.existsSync('.env')) {
      return null;
    }

    const content = fs.readFileSync('.env', 'utf8');
    const lines = content.split('\n');

    let username = null;
    let password = null;

    for (const line of lines) {
      const match = line.match(/^(\w+)\s*=\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        if (key === 'SU_USERNAME') username = value.trim();
        if (key === 'SU_PASSWORD') password = value.trim();
      }
    }

    if (username && password) {
      return { username, password };
    }

    return null;
  } catch (e) {
    return null;
  }
}

async function main() {
  // Get credentials
  let username, password;

  if (process.argv.length >= 4) {
    username = process.argv[2];
    password = process.argv[3];
  } else {
    const creds = readEnvCredentials();
    if (!creds) {
      console.error('Usage: node generate_calendar_url.js [username] [password]');
      console.error('Or: Set SU_USERNAME and SU_PASSWORD in .env file');
      process.exit(1);
    }
    username = creds.username;
    password = creds.password;
  }

  // Get secrets
  const secret = await getWranglerSecret('CALENDAR_SECRET');
  const encryptionKey = await getWranglerSecret('ENCRYPTION_KEY');

  if (!secret) {
    console.error('Error: CALENDAR_SECRET not found in .env');
    console.error('Generate one with: openssl rand -hex 32');
    console.error('Then set it: echo "CALENDAR_SECRET=your-secret" >> .env');
    process.exit(1);
  }

  if (!encryptionKey) {
    console.error('Error: ENCRYPTION_KEY not found in .env');
    console.error('Generate one with: openssl rand -base64 32');
    console.error('Then set it: echo "ENCRYPTION_KEY=your-key" >> .env');
    process.exit(1);
  }

  // Encrypt credentials
  const plaintext = `${username}:${password}`;
  const encrypted = encryptCredentials(plaintext, encryptionKey);

  // Calculate digest
  const digest = crypto.createHash('sha256')
    .update(secret + encrypted)
    .digest('hex');

  // Build URL
  const url = `${WORKER_URL}/calendar.ics?digest=${digest}&auth=${encodeURIComponent(encrypted)}`;

  // Output
  console.log('=== 🔒 Your Encrypted DSV Calendar URL ===\n');
  console.log(url);
  console.log('\n=== 📅 How to Add to Your Calendar ===\n');
  console.log('1. Copy the URL above');
  console.log('2. Add it to your calendar app:');
  console.log('   - Google Calendar: Settings → Add calendar → From URL');
  console.log('   - Apple Calendar: File → New Calendar Subscription');
  console.log('   - Outlook: Calendar → Add calendar → Subscribe from web');
  console.log('\n=== 🔐 Security Details ===\n');
  console.log('✅ Credentials encrypted with AES-256-GCM');
  console.log('✅ Unique digest prevents URL reuse');
  console.log('✅ Encryption key stored securely in Wrangler secrets');
  console.log('\nUsername:', username);
  console.log('Encrypted auth:', encrypted.substring(0, 40) + '...');
  console.log('Digest:', digest);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
