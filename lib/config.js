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

// Firebase service account: either the whole JSON (raw or base64) in FIREBASE_SERVICE_ACCOUNT,
// or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.
function firebaseCredentials() {
  let sa = null;
  const raw = (env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (raw) {
    try { sa = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')); }
    catch { sa = { invalid: true }; }
  }
  const projectId = env.FIREBASE_PROJECT_ID || (sa && sa.project_id) || '';
  const clientEmail = env.FIREBASE_CLIENT_EMAIL || (sa && sa.client_email) || '';
  const privateKey = (env.FIREBASE_PRIVATE_KEY || (sa && sa.private_key) || '').replace(/\\n/g, '\n');
  return { projectId, clientEmail, privateKey, invalidJson: Boolean(sa && sa.invalid) };
}
const fb = firebaseCredentials();

const config = {
  onVercel,
  firebase: { ...fb, databaseId: env.FIRESTORE_DATABASE_ID || '(default)', emulatorHost: env.FIRESTORE_EMULATOR_HOST || '' },
  port: Number(env.PORT || 3000),
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
  // Minimum seconds between persisted market advances (the path in between is still simulated per second).
  // Lower = livelier prices but more billed Firestore reads/writes.
  advanceMinSeconds: null,
  orderCheckSeconds: null,
  marketsRevSeconds: null,
  // Local server only: advance markets in the background every N ms (0 = only on requests, like Vercel)
  localTickMs: Number(env.LOCAL_TICK_MS || 0),
};

// Problems that make the app unusable. Reported as a clear error instead of crashing the function.
const problems = [];
if (fb.invalidJson) problems.push('FIREBASE_SERVICE_ACCOUNT is not valid JSON (paste the whole key file, or its base64)');
else if (!fb.projectId) problems.push('Missing Firebase project: set FIREBASE_SERVICE_ACCOUNT (or FIREBASE_PROJECT_ID)');
else if (!config.firebase.emulatorHost && (!fb.clientEmail || !fb.privateKey)) problems.push('Missing Firebase credentials: set FIREBASE_SERVICE_ACCOUNT (a service-account key, not the web apiKey config)');
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
config.advanceMinSeconds = Math.max(1, Number(env.ADVANCE_MIN_SECONDS || 5));
// How often active orders are checked for limit / TP / SL / liquidation (each check reads the active orders).
config.orderCheckSeconds = Math.max(1, Number(env.ORDER_CHECK_SECONDS || 10));
config.marketsRevSeconds = Math.max(1, Number(env.MARKETS_REV_SECONDS || 10));
config.problems = problems;

module.exports = config;
