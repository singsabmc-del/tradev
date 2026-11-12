'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Minimal .env loader (no dependencies). Real environment variables win.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    const val = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

const env = process.env;
const config = {
  port: Number(env.PORT || 3000),
  supabaseUrl: (env.SUPABASE_URL || '').replace(/\/+$/, ''),
  supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '',
  jwtSecret: env.JWT_SECRET || '',
  tokenTtlHours: Number(env.TOKEN_TTL_HOURS || 24),
  adminEmail: (env.ADMIN_EMAIL || 'admin@tradev.local').toLowerCase(),
  adminPassword: env.ADMIN_PASSWORD || 'ChangeMe123!',
  startingBalance: Number(env.STARTING_BALANCE ?? 10000),
  tickMs: Number(env.TICK_MS || 1000),
};

if (!config.supabaseUrl || !config.supabaseKey) {
  console.error('\n  Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env and fill them in.\n');
  process.exit(1);
}
if (!config.jwtSecret) {
  config.jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[warn] JWT_SECRET not set: using a random secret, so logins reset on every restart.');
}
if (!env.ADMIN_PASSWORD) {
  console.warn(`[warn] ADMIN_PASSWORD not set: default admin is ${config.adminEmail} / ${config.adminPassword}. Change it!`);
}

module.exports = config;
