'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Minimal .env loader for local runs (Vercel injects env vars itself). Real env vars win.
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
const onVercel = Boolean(env.VERCEL);

const config = {
  onVercel,
  port: Number(env.PORT || 3000),
  supabaseUrl: (env.SUPABASE_URL || '').replace(/\/+$/, ''),
  supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '',
  jwtSecret: env.JWT_SECRET || '',
  tokenTtlHours: Number(env.TOKEN_TTL_HOURS || 24),
  adminEmail: (env.ADMIN_EMAIL || 'admin@tradev.local').toLowerCase(),
  adminPassword: env.ADMIN_PASSWORD || '',
  startingBalance: Number(env.STARTING_BALANCE ?? 10000),
  cronSecret: env.CRON_SECRET || '',
  // Google Sheets public data sync (optional) — see integrations/google-sheets/README.md
  sheetsUrl: env.SHEETS_WEBHOOK_URL || '',
  sheetsSecret: env.SHEETS_SECRET || '',
  sheetsSyncSeconds: Math.max(1, Number(env.SHEETS_SYNC_SECONDS || 60)),
  sheetsIncludeStats: /^(1|true|yes)$/i.test(env.SHEETS_INCLUDE_STATS || ''),
  // Local server only: advance markets in the background every N ms (0 = only on requests, like Vercel)
  localTickMs: Number(env.LOCAL_TICK_MS || 0),
};

// Problems that make the app unusable. Reported as a clear error instead of crashing the function.
const problems = [];
if (!config.supabaseUrl || !config.supabaseKey) problems.push('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY');
if (!config.jwtSecret) {
  if (onVercel) problems.push('Missing JWT_SECRET (required on Vercel so every instance signs the same tokens)');
  else {
    config.jwtSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[warn] JWT_SECRET not set: using a random secret, so logins reset on every restart.');
  }
}
if (!config.adminPassword) {
  if (onVercel) problems.push('Missing ADMIN_PASSWORD (used to create the first admin account)');
  else {
    config.adminPassword = 'ChangeMe123!';
    console.warn(`[warn] ADMIN_PASSWORD not set: default admin is ${config.adminEmail} / ${config.adminPassword}. Change it!`);
  }
}
if (config.sheetsUrl && !config.sheetsSecret) {
  console.warn('[warn] SHEETS_WEBHOOK_URL is set but SHEETS_SECRET is empty: Google Sheets sync disabled.');
  config.sheetsUrl = '';
}
config.problems = problems;

module.exports = config;
