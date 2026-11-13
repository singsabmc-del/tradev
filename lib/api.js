'use strict';
const crypto = require('node:crypto');
// All API routes. Platform-neutral: used by the Vercel function (api/index.mjs) and the
// local Node server (server/index.js). dispatch(ctx) -> { status, data, headers }.
const store = require('./store');
const { DbError } = require('./errors');
const auth = require('./auth');
const engine = require('./engine');
const sheets = require('./sheets');
const feeds = require('./feeds');
const settings = require('./settings');
const config = require('./config');

class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const MESSAGES = {
  INSUFFICIENT_BALANCE: 'Insufficient balance',
  EMAIL_TAKEN: 'That email is already registered',
  ACCOUNT_INACTIVE: 'Your account is suspended',
  MARKET_CLOSED: 'This market is currently closed',
  MARGIN_TOO_SMALL: 'Margin is below the market minimum',
  INVALID_LEVERAGE: 'Leverage is outside the allowed range',
  INVALID_LIMIT_PRICE: 'Enter a valid limit price',
  TP_MUST_BE_ABOVE_ENTRY: 'Take profit must be above the entry price for a long',
  SL_MUST_BE_BELOW_ENTRY: 'Stop loss must be below the entry price for a long',
  TP_MUST_BE_BELOW_ENTRY: 'Take profit must be below the entry price for a short',
  SL_MUST_BE_ABOVE_ENTRY: 'Stop loss must be above the entry price for a short',
  ORDER_NOT_FOUND: 'Order not found',
  ORDER_NOT_OPEN: 'Position is already closed',
  ORDER_NOT_PENDING: 'Order is no longer pending',
  INVALID_AMOUNT: 'Enter a valid amount',
  TX_NOT_FOUND: 'Transaction not found',
  TX_NOT_PENDING: 'Transaction was already processed',
  USER_NOT_FOUND: 'User not found',
  NOT_DEMO: 'Only demo accounts can be reset',
  PHONE_TAKEN: 'That phone number is already registered',
  DEMO_ACCOUNT: 'Demo accounts use virtual funds: use Reset or Adjust instead',
  DEMO_HAS_OPEN_ORDERS: 'Close your positions and cancel open orders before resetting',
  NOTIFICATION_NOT_FOUND: 'Notification not found',
};
function mapDbError(e) {
  if (e instanceof settings.SettingsError) return new ApiError(400, e.message);
  if (e instanceof feeds.FeedError) return new ApiError(503, `Live price unavailable: ${e.message}`);
  if (e instanceof DbError) {
    const key = Object.keys(MESSAGES).find((k) => e.message.includes(k));
    if (key) return new ApiError(/_NOT_FOUND$/.test(key) ? 404 : 400, MESSAGES[key]);
    if (e.code === 'NETWORK') return new ApiError(503, 'Database unavailable, try again shortly');
    console.error('[db]', e.status, e.message);
    return new ApiError(500, 'Database error');
  }
  return e;
}

// ---------- helpers ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// ---------- bank accounts ----------
const maskNumber = (n) => { const d = String(n || ''); return d.length > 4 ? `•••• ${d.slice(-4)}` : d; };
// What a customer sees about their own bank account (number masked).
const ownBank = (b) => (b && b.account_number ? { bank_name: b.bank_name, account_name: b.account_name, account_number: maskNumber(b.account_number), updated_at: b.updated_at } : null);
function parseBank(body) {
  const bank_name = String(body.bank_name || '').trim().replace(/\s+/g, ' ');
  const account_name = String(body.account_name || '').trim().replace(/\s+/g, ' ');
  const account_number = String(body.account_number || '').replace(/[\s-]/g, '');
  if (bank_name.length < 2 || bank_name.length > 60) throw new ApiError(400, 'Enter the bank name');
  if (account_name.length < 2 || account_name.length > 80) throw new ApiError(400, "Enter the account holder's name");
  if (!/^[0-9A-Za-z]{6,34}$/.test(account_number)) throw new ApiError(400, 'Enter a valid account number (6–34 letters or digits)');
  return { bank_name, account_name, account_number: account_number.toUpperCase() };
}
// Deposits, withdrawals and trading need a bank account on file.
// (Admins can switch this off in System settings.)
async function requireBank(user) {
  if (user.demo) return null; // practice accounts never move real money
  const has = user.bank && user.bank.account_number;
  if (!has && (await settings.get()).require_bank_account) throw new ApiError(403, 'Add your bank account first', 'BANK_REQUIRED');
  return has ? user.bank : null;
}
// Amount limits from System settings (0 = no limit).
function checkLimits(amount, min, max, what) {
  if (min && amount < min) throw new ApiError(400, `Minimum ${what} is ${min} USDT`);
  if (max && amount > max) throw new ApiError(400, `Maximum ${what} is ${max} USDT`);
}
// Contact details a customer (or admin) can edit. Only fields present in the body are changed.
function parseProfile(body, patch = {}) {
  const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
  if (body.name !== undefined) {
    patch.name = str(body.name, 80);
    if (!patch.name) throw new ApiError(400, 'Enter a name');
  }
  if (body.phone !== undefined) {
    const phone = str(body.phone, 30);
    if (phone && !/^\+?[0-9][0-9 ()-]{5,}$/.test(phone)) throw new ApiError(400, 'Enter a valid phone number');
    patch.phone = phone;
  }
  if (body.country !== undefined) patch.country = str(body.country, 60);
  if (body.address !== undefined) patch.address = str(body.address, 300);
  if (body.birth_date !== undefined) {
    const d = str(body.birth_date, 10);
    if (d) {
      const t = Date.parse(`${d}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !t || t > Date.now() || t < Date.parse('1900-01-01')) throw new ApiError(400, 'Enter a valid date of birth');
    }
    patch.birth_date = d;
  }
  return patch;
}
const publicUser = (u) => { if (!u) return u; const { password_hash, bank, admin_note, withdraw_code_hash, ...rest } = u; return { ...rest, has_withdraw_code: Boolean(withdraw_code_hash), bank: ownBank(bank), has_bank: Boolean(bank && bank.account_number) }; };
const adminUser = (u) => { if (!u) return u; const { password_hash, withdraw_code_hash, ...rest } = u; return { ...rest, has_withdraw_code: Boolean(withdraw_code_hash), bank: rest.bank && rest.bank.account_number ? rest.bank : null, has_bank: Boolean(rest.bank && rest.bank.account_number) }; };
const posNum = (v, name, { optional = false } = {}) => {
  if (optional && (v === undefined || v === null || v === '')) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new ApiError(400, `Invalid ${name}`);
  return n;
};
const intId = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, 'Invalid id'); return n; };
const clean = (s) => String(s || '').replace(/[,()*%\\]/g, '').trim().slice(0, 80);

async function requireUser(ctx) {
  const h = ctx.headers.authorization || '';
  const payload = auth.verify(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!payload) throw new ApiError(401, 'Please log in');
  const user = await store.getUser(payload.sub);
  if (!user) throw new ApiError(401, 'Please log in');
  if (user.status !== 'active') throw new ApiError(403, 'Your account is suspended');
  return user;
}
async function requireAdmin(ctx) {
  const user = await requireUser(ctx);
  if (user.role !== 'admin') throw new ApiError(403, 'Admin only');
  return user;
}

function unrealized(o, m) {
  if (!m || o.status !== 'open') return null;
  const pnl = (o.side === 'long' ? m.price - o.entry_price : o.entry_price - m.price) * o.size;
  return Math.max(pnl, -o.margin);
}
async function withLiveAll(rows) {
  if (!rows.length) return [];
  const px = await engine.prices();
  return rows.map((r) => {
    const o = engine.normalizeOrder(r);
    const price = px.has(o.market_id) ? px.get(o.market_id) : null;
    return { ...o, mark_price: price, unrealized_pnl: price === null ? null : unrealized(o, { price }) };
  });
}
const withLive = async (row) => (await withLiveAll([row]))[0];

// ---------- one-time setup per instance ----------
let booted = null;
function bootstrap() {
  if (!booted) {
    booted = (async () => {
      const existing = await store.getUserByEmail(config.adminEmail);
      if (!existing) {
        try {
          await store.createUser({
            email: config.adminEmail, name: 'Administrator', passwordHash: auth.hashPassword(config.adminPassword),
            role: 'admin', startBalance: 0,
          });
          console.log(`[setup] created admin account ${config.adminEmail}`);
        } catch (e) { if (!/EMAIL_TAKEN/.test(e.message)) throw e; }
      }
      if (store.ensureSeed) await store.ensureSeed();
    })().catch((e) => { booted = null; throw e; });
  }
  return booted;
}

// ---------- routes ----------
const routes = [];
const route = (method, path, handler) => {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};
// Short shared-cache for public market data: the CDN answers most polls without running the function.
const CDN_1S = { 'cache-control': `public, max-age=0, s-maxage=${config.advanceMinSeconds}, stale-while-revalidate=${config.advanceMinSeconds * 2}` };

// Settings visitors and customers need (deposit account etc. only when signed in).
route('GET', '/api/settings', async (ctx) => {
  let loggedIn = false;
  try { loggedIn = Boolean(await requireUser(ctx)); } catch { /* visitor */ }
  return settings.publicView(await settings.get(), { loggedIn });
});

route('GET', '/api/admin/settings', async (ctx) => {
  await requireAdmin(ctx);
  const fb = config.firebase;
  return {
    settings: await settings.get(),
    system: {
      database: fb.emulatorHost ? `Firestore emulator (${fb.projectId})` : `Firestore · ${fb.projectId}`,
      firebase_account: fb.clientEmail || null,
      region: process.env.VERCEL_REGION || (config.onVercel ? 'vercel' : 'local'),
      google_sheets: Boolean(config.sheetsUrl), sheets_sync_seconds: config.sheetsSyncSeconds,
      cron_secret: Boolean(config.cronSecret), advance_seconds: config.advanceMinSeconds,
      admin_email: config.adminEmail, version: require('../package.json').version,
    },
  };
});
route('PUT', '/api/admin/settings', async (ctx) => {
  const admin = await requireAdmin(ctx);
  return { settings: await settings.save(ctx.body || {}, Number(admin.id)) };
});

route('GET', '/api/health', async () => ({ ok: true, time: new Date().toISOString(), vercel: config.onVercel }));

// Auth
route('POST', '/api/auth/register', async ({ body }) => {
  const s = await settings.get();
  if (!s.registration_open) throw new ApiError(403, 'Registration is closed', 'REGISTRATION_CLOSED');
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 80);
  const password = String(body.password || '');
  if (!EMAIL_RE.test(email)) throw new ApiError(400, 'Enter a valid email');
  if (password.length < 8) throw new ApiError(400, 'Password must be at least 8 characters');
  if (!name) throw new ApiError(400, 'Enter your name');
  const { phone = '' } = parseProfile({ phone: body.phone });
  const user = await store.createUser({
    email, name, phone, passwordHash: auth.hashPassword(password), role: 'customer', startBalance: s.starting_balance,
  });
  return { token: auth.sign({ sub: Number(user.id), role: user.role }), user: publicUser(user) };
});

// Practice account with virtual funds, created in one click from the sign-in screen.
route('POST', '/api/auth/demo', async ({ ip }) => {
  const s = await settings.get();
  if (!s.demo_enabled) throw new ApiError(403, 'Demo accounts are not available', 'DEMO_DISABLED');
  const key = `demo|${ip}`;
  if ((await store.loginFailureCount(key)) >= 5) throw new ApiError(429, 'Too many demo accounts. Try again in a few minutes.');
  await store.noteLoginFailure(key);
  const tag = crypto.randomBytes(5).toString('hex');
  const user = await store.createUser({
    email: `demo-${tag}@demo.tradev`, name: 'Demo trader', passwordHash: auth.hashPassword(crypto.randomBytes(24).toString('hex')),
    role: 'customer', startBalance: s.demo_balance, demo: true,
  });
  return { token: auth.sign({ sub: Number(user.id), role: user.role }), user: publicUser(user) };
});

route('POST', '/api/me/demo/reset', async (ctx) => {
  const user = await requireUser(ctx);
  if (!user.demo) throw new ApiError(400, 'Only demo accounts can be reset');
  return publicUser(await store.resetDemo(Number(user.id), (await settings.get()).demo_balance));
});

route('POST', '/api/auth/login', async ({ body, ip }) => {
  // One field takes either an email address or a phone number.
  const login = String(body.login ?? body.email ?? body.phone ?? '').trim().toLowerCase();
  const byPhone = !login.includes('@');
  const key = `${ip}|${byPhone ? login.replace(/\D/g, '') : login}`;
  if ((await store.loginFailureCount(key)) >= 10) throw new ApiError(429, 'Too many attempts. Try again in a few minutes.');
  const user = byPhone ? await store.getUserByPhone(login) : await store.getUserByEmail(login);
  if (!user || user.demo || !auth.verifyPassword(String(body.password || ''), user.password_hash)) {
    await store.noteLoginFailure(key);
    throw new ApiError(401, byPhone ? 'Wrong phone number or password' : 'Wrong email or password');
  }
  if (user.status !== 'active') throw new ApiError(403, 'Your account is suspended');
  await store.updateUser(Number(user.id), { last_login_at: new Date().toISOString() });
  return { token: auth.sign({ sub: Number(user.id), role: user.role }), user: publicUser(user) };
});

route('GET', '/api/me', async (ctx) => { const u = await requireUser(ctx); return { ...publicUser(u), notify: await hasUnread(u) }; });

route('PUT', '/api/me/profile', async (ctx) => {
  const user = await requireUser(ctx);
  const patch = parseProfile(ctx.body);
  if (!Object.keys(patch).length) throw new ApiError(400, 'Nothing to update');
  patch.profile_updated_at = new Date().toISOString();
  return publicUser(await store.updateUser(Number(user.id), patch));
});

// ---------- withdrawal code ----------
const CODE_RE = /^\d{6}$/;
async function checkWithdrawCode(user, code, s) {
  if (!user.withdraw_code_hash) {
    if (s.require_withdrawal_code) throw new ApiError(403, 'Set your withdrawal code first (Account page)', 'WITHDRAW_CODE_REQUIRED');
    return;
  }
  const key = `wcode|${user.id}`;
  if ((await store.loginFailureCount(key)) >= 5) throw new ApiError(429, 'Too many wrong codes. Try again in 15 minutes.', 'WITHDRAW_CODE_LOCKED');
  if (!auth.verifyPassword(String(code || ''), user.withdraw_code_hash)) {
    await store.noteLoginFailure(key);
    throw new ApiError(400, 'Wrong withdrawal code', 'WITHDRAW_CODE_WRONG');
  }
}

// Set or change the code. Always confirmed with the account password.
route('PUT', '/api/me/withdraw-code', async (ctx) => {
  const user = await requireUser(ctx);
  if (user.demo) throw new ApiError(400, 'Demo accounts cannot withdraw');
  const key = `pw|${user.id}`;
  if ((await store.loginFailureCount(key)) >= 10) throw new ApiError(429, 'Too many attempts. Try again in a few minutes.');
  if (!auth.verifyPassword(String(ctx.body.password || ''), user.password_hash)) {
    await store.noteLoginFailure(key);
    throw new ApiError(400, 'Account password is wrong');
  }
  const code = String(ctx.body.code || '');
  if (!CODE_RE.test(code)) throw new ApiError(400, 'The withdrawal code must be 6 digits');
  if (/^(\d)\1{5}$/.test(code) || '0123456789'.includes(code) || '9876543210'.includes(code)) throw new ApiError(400, 'Choose a less obvious code (not 111111 or 123456)');
  const updated = await store.updateUser(Number(user.id), { withdraw_code_hash: auth.hashPassword(code), withdraw_code_set_at: new Date().toISOString() });
  await autoNotify(user.id, user.withdraw_code_hash ? 'Withdrawal code changed' : 'Withdrawal code set', 'If this was not you, contact support right away.', 'info');
  return publicUser(updated);
});

route('POST', '/api/me/password', async (ctx) => {
  const user = await requireUser(ctx);
  if (user.demo) throw new ApiError(400, 'Demo accounts have no password');
  const key = `pw|${user.id}`;
  if ((await store.loginFailureCount(key)) >= 10) throw new ApiError(429, 'Too many attempts. Try again in a few minutes.');
  if (!auth.verifyPassword(String(ctx.body.current_password || ''), user.password_hash)) {
    await store.noteLoginFailure(key);
    throw new ApiError(400, 'Current password is wrong');
  }
  const next = String(ctx.body.new_password || '');
  if (next.length < 8) throw new ApiError(400, 'Password must be at least 8 characters');
  await store.updateUser(Number(user.id), { password_hash: auth.hashPassword(next) });
  return { ok: true };
});

route('PUT', '/api/me/bank', async (ctx) => {
  const user = await requireUser(ctx);
  const bank = { ...parseBank(ctx.body), updated_at: new Date().toISOString(), added_at: (user.bank && user.bank.added_at) || new Date().toISOString() };
  return publicUser(await store.updateUser(Number(user.id), { bank }));
});

// Market data (public)
route('GET', '/api/markets', async () => {
  await engine.settleDue();
  return { data: await engine.publicMarkets(), headers: CDN_1S };
});

// Live prices: polled by every open page. Prices are computed (or come from the exchange cache), so
// this costs no database reads beyond the occasional "did markets change" check and order checks.
route('GET', '/api/ticker', async () => {
  await engine.settleDue();
  const prices = {};
  await Promise.all((await engine.getMarkets()).filter((m) => m.enabled).map(async (m) => {
    try { const q = await engine.quote(m); if (q) prices[m.symbol] = q; } catch { /* live source down */ }
  }));
  await sheets.maybeSync();
  return { data: { t: Date.now(), prices }, headers: CDN_1S };
});

route('GET', '/api/candles', async ({ query }) => {
  const m = await engine.bySymbol(query.get('symbol'));
  if (!m) throw new ApiError(404, 'Unknown market');
  return { data: await engine.candles(m, Math.min(Number(query.get('limit')) || 500, 1500)), headers: CDN_1S };
});

// Trading
route('POST', '/api/orders', async (ctx) => {
  const user = await requireUser(ctx);
  const s = await settings.get();
  if (!s.trading_enabled) throw new ApiError(403, 'Trading is paused', 'TRADING_PAUSED');
  await requireBank(user);
  if (s.max_open_positions) {
    const mine = await store.listOrders({ userId: Number(user.id), statuses: ['open', 'pending'], limit: 1000 });
    if (mine.length >= s.max_open_positions) throw new ApiError(400, `You can have at most ${s.max_open_positions} open positions and orders`);
  }
  const { body } = ctx;
  const m = await engine.bySymbol(body.symbol);
  if (!m || !m.enabled) throw new ApiError(400, 'This market is currently closed');
  const execPrice = await engine.priceOf(m); // execute at the current price
  const type = body.type === 'limit' ? 'limit' : 'market';
  const order = await store.placeOrder({
    userId: Number(user.id), marketId: m.id,
    side: body.side === 'short' ? 'short' : 'long',
    type,
    margin: posNum(body.margin, 'margin'),
    leverage: Math.round(posNum(body.leverage, 'leverage')),
    execPrice,
    limitPrice: type === 'limit' ? posNum(body.limitPrice, 'limit price') : null,
    tp: posNum(body.tp, 'take profit', { optional: true }),
    sl: posNum(body.sl, 'stop loss', { optional: true }),
  });
  return withLive(order);
});

route('GET', '/api/orders', async (ctx) => {
  const user = await requireUser(ctx);
  await engine.settleDue(); // settle anything that triggered since the last check
  const scope = ctx.query.get('scope') || 'active';
  const statuses = scope === 'history' ? ['closed', 'cancelled'] : ['open', 'pending'];
  return withLiveAll(await store.listOrders({ userId: Number(user.id), statuses, limit: 300 }));
});

// Changes to the user's orders since a timestamp (fills, TP/SL, liquidations), plus balance.
route('GET', '/api/updates', async (ctx) => {
  const user = await requireUser(ctx);
  await engine.settleDue();
  const since = new Date(Number(ctx.query.get('since')) || Date.now() - 60_000).toISOString();
  // `user` was just read from the database by requireUser, so it is current: no second read.
  const rows = await store.listOrders({ userId: Number(user.id), user, changedSince: since, limit: 50 });
  return { t: Date.now(), balance: Number(user.balance), orders: await withLiveAll(rows), notify: await hasUnread(user) };
});

async function closeOrder(id, reason, userId) {
  const row = await store.getOrder(id);
  if (!row || (userId && Number(row.user_id) !== userId)) throw new ApiError(404, 'Position not found or already closed');
  await engine.settleMarket(row.market_id); // a TP/SL that already hit wins over the manual close
  const m = await engine.getMarket(row.market_id);
  const closed = await store.closeOrder(id, await engine.priceOf(m), reason, userId || null);
  return withLive(closed);
}

route('POST', '/api/orders/:id/close', async (ctx) => {
  const user = await requireUser(ctx);
  return closeOrder(intId(ctx.params.id), 'manual', Number(user.id));
});

route('POST', '/api/orders/:id/cancel', async (ctx) => {
  const user = await requireUser(ctx);
  const row = await store.getOrder(intId(ctx.params.id));
  if (row) await engine.settleMarket(row.market_id); // it may have filled already
  return withLive(await store.cancelOrder(intId(ctx.params.id), Number(user.id)));
});

// Wallet
route('GET', '/api/transactions', async (ctx) => {
  const user = await requireUser(ctx);
  return (await store.listTransactions({ userId: Number(user.id), limit: 300 })).map((t) => (t.bank ? { ...t, bank: { ...t.bank, account_number: maskNumber(t.bank.account_number) } } : t));
});
route('POST', '/api/wallet/deposit', async (ctx) => {
  const user = await requireUser(ctx);
  if (user.demo) throw new ApiError(403, 'Deposits and withdrawals are not available on a demo account', 'DEMO');
  const s = await settings.get();
  if (!s.deposits_enabled) throw new ApiError(403, 'Deposits are currently disabled');
  const bank = await requireBank(user);
  const amount = posNum(ctx.body.amount, 'amount');
  checkLimits(amount, s.min_deposit, s.max_deposit, 'deposit');
  return store.requestDeposit(Number(user.id), amount, clean(ctx.body.note) || null, bank);
});
route('POST', '/api/wallet/withdraw', async (ctx) => {
  const user = await requireUser(ctx);
  if (user.demo) throw new ApiError(403, 'Deposits and withdrawals are not available on a demo account', 'DEMO');
  const s = await settings.get();
  if (!s.withdrawals_enabled) throw new ApiError(403, 'Withdrawals are currently disabled');
  const bank = await requireBank(user);
  const amount = posNum(ctx.body.amount, 'amount');
  checkLimits(amount, s.min_withdrawal, s.max_withdrawal, 'withdrawal');
  await checkWithdrawCode(user, ctx.body.code, s);
  return store.requestWithdrawal(Number(user.id), amount, clean(ctx.body.note) || null, bank);
});

// Scheduled job: Vercel Cron (Authorization: Bearer CRON_SECRET) or an external pinger (?key=CRON_SECRET)
route('GET', '/api/cron', async ({ headers, query }) => {
  const given = (headers.authorization || '').replace(/^Bearer /, '') || query.get('key') || '';
  if (!config.cronSecret || given !== config.cronSecret) throw new ApiError(401, 'Unauthorized');
  const settled = await engine.settleDue({ force: true });
  const sync = await sheets.maybeSync();
  return { ok: true, settled: settled.length, sheets: sync ? (sync.lastError ? 'error' : 'synced') : 'skipped' };
});

// ---------- Admin ----------
route('GET', '/api/admin/stats', async (ctx) => {
  await requireAdmin(ctx);
  await engine.settleDue();
  const [stats, open, px, sheetsStatus] = await Promise.all([
    store.adminStats(),
    store.openPositions(),
    engine.prices(),
    sheets.getStatus(),
  ]);
  let unrealizedPnl = 0;
  for (const r of open) { const o = engine.normalizeOrder(r); if (px.has(o.market_id)) unrealizedPnl += unrealized(o, { price: px.get(o.market_id) }) || 0; }
  return { ...stats, unrealized_pnl: unrealizedPnl, sheets: sheetsStatus };
});

route('POST', '/api/admin/sheets/sync', async (ctx) => {
  await requireAdmin(ctx);
  if (!sheets.enabled()) throw new ApiError(400, 'Google Sheets sync is not configured (set SHEETS_WEBHOOK_URL and SHEETS_SECRET)');
  const status = await sheets.syncNow();
  if (status.lastError) throw new ApiError(502, `Google Sheets: ${status.lastError}`);
  return status;
});

route('GET', '/api/admin/markets', async (ctx) => {
  await requireAdmin(ctx);
  await engine.settleDue();
  return engine.publicMarkets({ includeDisabled: true });
});

const MARKET_FIELDS = {
  name: (v) => String(v).slice(0, 60),
  price: (v) => posNum(v, 'price'),
  volatility: (v) => { const n = Number(v); if (!(n >= 0 && n <= 0.05)) throw new ApiError(400, 'Volatility must be between 0 and 0.05'); return n; },
  drift: (v) => { const n = Number(v); if (!(Math.abs(n) <= 0.01)) throw new ApiError(400, 'Drift must be between -0.01 and 0.01'); return n; },
  max_leverage: (v) => { const n = Math.round(Number(v)); if (!(n >= 1 && n <= 200)) throw new ApiError(400, 'Max leverage must be 1–200'); return n; },
  fee_rate: (v) => { const n = Number(v); if (!(n >= 0 && n < 0.1)) throw new ApiError(400, 'Fee rate must be between 0 and 0.1'); return n; },
  min_margin: (v) => posNum(v, 'minimum margin'),
  decimals: (v) => { const n = Math.round(Number(v)); if (!(n >= 0 && n <= 8)) throw new ApiError(400, 'Decimals must be 0–8'); return n; },
  enabled: (v) => Boolean(v),
  source: (v) => { if (!feeds.SOURCES[v]) throw new ApiError(400, 'Unknown price source'); return v; },
  source_symbol: (v) => { const t = String(v).trim(); if (!/^[A-Za-z0-9._:/-]{1,30}$/.test(t)) throw new ApiError(400, 'Invalid source symbol'); return t; },
  source_url: (v) => { const t = String(v).trim(); if (!/^https?:\/\/\S+$/i.test(t) || t.length > 500) throw new ApiError(400, 'Invalid source URL'); return t; },
  source_path: (v) => String(v).trim().slice(0, 120),
};
function pickMarket(body) {
  const out = {};
  for (const [k, fn] of Object.entries(MARKET_FIELDS)) if (body[k] !== undefined && body[k] !== '') out[k] = fn(body[k]);
  return out;
}
// Validate a live source before saving it; returns its current price.
async function checkSource(f) {
  if (!f.source || f.source === 'sim') return null;
  if (f.source === 'custom' && !f.source_url) throw new ApiError(400, 'Enter the URL that returns the price');
  if (f.source !== 'custom' && !f.source_symbol) throw new ApiError(400, `Enter the ${feeds.SOURCES[f.source].label} symbol, e.g. ${feeds.SOURCES[f.source].example}`);
  try { return (await feeds.test(f)).price; } catch (e) { throw new ApiError(400, `${feeds.SOURCES[f.source].label}: ${e.message}`); }
}

route('GET', '/api/admin/feeds', async (ctx) => { await requireAdmin(ctx); return feeds.SOURCES; });
route('POST', '/api/admin/feeds/test', async (ctx) => {
  await requireAdmin(ctx);
  const f = pickMarket({ source: ctx.body.source, source_symbol: ctx.body.source_symbol, source_url: ctx.body.source_url, source_path: ctx.body.source_path });
  const price = await checkSource(f);
  if (price === null) throw new ApiError(400, 'Choose a live price source to test');
  return { price, decimals: feeds.decimalsFor(price) };
});

const adminMarket = async (id) => (await engine.publicMarkets({ includeDisabled: true })).find((m) => m.id === id);

route('POST', '/api/admin/markets', async (ctx) => {
  await requireAdmin(ctx);
  const symbol = String(ctx.body.symbol || '').trim().toUpperCase();
  const mm = symbol.match(/^([A-Z0-9]{2,10})\/([A-Z0-9]{2,10})$/);
  if (!mm) throw new ApiError(400, 'Symbol must look like BTC/USDT');
  if (await engine.bySymbol(symbol, { fresh: true })) throw new ApiError(400, 'Market already exists');
  const fields = pickMarket(ctx.body);
  const livePrice = await checkSource(fields);
  if (livePrice !== null) {
    fields.price = livePrice;
    if (ctx.body.decimals === undefined || ctx.body.decimals === '') fields.decimals = feeds.decimalsFor(livePrice);
  }
  if (!fields.price) throw new ApiError(400, 'Starting price is required');
  const row = await store.insertMarket({ symbol, base: mm[1], quote: mm[2], name: fields.name || mm[1], ...fields, segs: engine.firstSegs(fields) });
  engine.invalidate();
  return adminMarket(Number(row.id));
});

route('PATCH', '/api/admin/markets/:id', async (ctx) => {
  await requireAdmin(ctx);
  const id = intId(ctx.params.id);
  const m = await engine.getMarket(id, { fresh: true });
  if (!m) throw new ApiError(404, 'Market not found');
  let { price, ...fields } = pickMarket(ctx.body);
  if (price === undefined && !Object.keys(fields).length) throw new ApiError(400, 'Nothing to update');
  const next = { ...m, ...fields };
  if (price !== undefined && feeds.isLive(next)) {
    throw new ApiError(400, `Price comes from ${feeds.SOURCES[next.source].label}; switch the source to Simulated to set it by hand`);
  }
  const sourceChanged = ['source', 'source_symbol', 'source_url', 'source_path'].some((k) => fields[k] !== undefined && fields[k] !== m[k]);
  let livePrice = null;
  if (sourceChanged) livePrice = await checkSource(next);
  if (m.enabled) await engine.settleMarket(m.id).catch(() => {}); // settle up to now under the old settings
  if (livePrice !== null) { price = livePrice; fields.live_checked_at = new Date().toISOString(); }
  // Simulated path: any change to price, volatility, drift or pausing starts a new segment now.
  const pausedNext = next.enabled === false, resuming = fields.enabled === true && !m.enabled;
  const wasLive = feeds.isLive(m);
  if (!feeds.isLive(next) && (price !== undefined || fields.volatility !== undefined || fields.drift !== undefined || fields.enabled !== undefined || wasLive)) {
    let p0 = price;
    if (p0 === undefined && wasLive) p0 = await engine.priceOf(m).catch(() => undefined);
    // A paused market stands still; its volatility / drift wait in paused_params until it resumes.
    const params = { vol: fields.volatility ?? m.volatility, drift: fields.drift ?? m.drift };
    if (pausedNext) fields.paused_params = params;
    fields.segs = engine.nextSegs(m, { price: p0, volatility: params.vol, drift: params.drift, paused: pausedNext });
    if (resuming) fields.paused_params = null;
  }
  if (price !== undefined) fields.price = price;
  if (Object.keys(fields).length) await store.updateMarket(id, fields);
  engine.invalidate();
  return adminMarket(id);
});

route('POST', '/api/admin/users', async (ctx) => {
  await requireAdmin(ctx);
  const b = ctx.body;
  const email = String(b.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new ApiError(400, 'Enter a valid email');
  if (String(b.password || '').length < 8) throw new ApiError(400, 'Password must be at least 8 characters');
  const prof = parseProfile({ name: b.name ?? '', phone: b.phone ?? '' });
  const user = await store.createUser({
    email, name: prof.name, phone: prof.phone, passwordHash: auth.hashPassword(String(b.password)),
    role: 'customer', startBalance: (await settings.get()).starting_balance,
  });
  return adminUser(user);
});

route('GET', '/api/admin/users', async (ctx) => {
  await requireAdmin(ctx);
  const q = clean(ctx.query.get('q'));
  const kind = ctx.query.get('kind'); // real | demo
  return (await store.listUsers({ q, role: ctx.query.get('role') || undefined, status: ctx.query.get('status') || undefined }))
    .filter((u) => !kind || (kind === 'demo') === Boolean(u.demo)).map(adminUser);
});

route('GET', '/api/admin/users/:id', async (ctx) => {
  await requireAdmin(ctx);
  const id = intId(ctx.params.id);
  const [user, orders, transactions] = await Promise.all([
    store.getUserWithStats(id),
    store.listOrders({ userId: id, limit: 300 }),
    store.listTransactions({ userId: id, limit: 300 }),
  ]);
  if (!user) throw new ApiError(404, 'User not found');
  return { user: adminUser(user), orders: await withLiveAll(orders), transactions };
});

route('PATCH', '/api/admin/users/:id', async (ctx) => {
  const admin = await requireAdmin(ctx);
  const id = intId(ctx.params.id);
  const { body } = ctx;
  const patch = {};
  parseProfile(body, patch);
  if (body.reset_withdraw_code) { patch.withdraw_code_hash = null; patch.withdraw_code_set_at = null; }
  if (body.admin_note !== undefined) patch.admin_note = String(body.admin_note || '').trim().slice(0, 1000);
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new ApiError(400, 'Invalid email');
    patch.email = email;
  }
  if (body.status !== undefined) {
    if (!['active', 'suspended'].includes(body.status)) throw new ApiError(400, 'Invalid status');
    patch.status = body.status;
  }
  if (body.role !== undefined) {
    if (!['customer', 'admin'].includes(body.role)) throw new ApiError(400, 'Invalid role');
    patch.role = body.role;
  }
  if (body.bank !== undefined) {
    const prev = (await store.getUser(id)) || {};
    patch.bank = body.bank === null ? null
      : { ...parseBank(body.bank), updated_at: new Date().toISOString(), added_at: (prev.bank && prev.bank.added_at) || new Date().toISOString() };
  }
  if (body.password) {
    if (String(body.password).length < 8) throw new ApiError(400, 'Password must be at least 8 characters');
    patch.password_hash = auth.hashPassword(String(body.password));
  }
  if (patch.email) {
    const other = await store.getUserByEmail(patch.email);
    if (other && Number(other.id) !== id) throw new ApiError(400, 'That email is already registered');
  }
  if (id === Number(admin.id) && (patch.status === 'suspended' || patch.role === 'customer')) {
    throw new ApiError(400, 'You cannot suspend or demote yourself');
  }
  if (!Object.keys(patch).length) throw new ApiError(400, 'Nothing to update');
  const updated = await store.updateUser(id, patch);
  if (!updated) throw new ApiError(404, 'User not found');
  if (body.reset_withdraw_code) await autoNotify(id, 'Withdrawal code reset', 'An administrator reset your withdrawal code. Set a new one on the Account page before your next withdrawal.', 'warning');
  return adminUser(updated);
});

route('POST', '/api/admin/users/:id/adjust', async (ctx) => {
  const admin = await requireAdmin(ctx);
  const amount = Number(ctx.body.amount);
  if (!Number.isFinite(amount) || amount === 0) throw new ApiError(400, 'Enter a non-zero amount');
  const note = clean(ctx.body.note) || null;
  const user = await store.adjustBalance(intId(ctx.params.id), amount, note, Number(admin.id));
  if (ctx.body.notify !== false && ctx.body.notify !== 'false') {
    await autoNotify(user.id, 'Balance adjusted',
      `Your balance was ${amount > 0 ? 'credited' : 'debited'} ${fmtAmt(Math.abs(amount))} USDT.${note ? ` Note: ${note}` : ''}`, amount > 0 ? 'success' : 'info');
  }
  return user;
});

for (const [action, type] of [['deposit', 'deposit'], ['withdraw', 'withdrawal']]) {
  route('POST', `/api/admin/users/:id/${action}`, async (ctx) => {
    const admin = await requireAdmin(ctx);
    const amount = Number(ctx.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, 'Enter an amount above 0');
    const note = clean(ctx.body.note) || null;
    const r = await store.adminCashflow(intId(ctx.params.id), type, Math.round(amount * 100) / 100, note, Number(admin.id));
    if (ctx.body.notify !== false && ctx.body.notify !== 'false') {
      const amt = fmtAmt(Math.abs(r.transaction.amount));
      if (type === 'deposit') await autoNotify(r.user.id, 'Deposit received', `${amt} USDT has been deposited to your balance.${note ? ` Note: ${note}` : ''}`, 'success');
      else await autoNotify(r.user.id, 'Withdrawal completed', `${amt} USDT has been withdrawn from your balance.${note ? ` Note: ${note}` : ''}`, 'info');
    }
    return r;
  });
}

route('GET', '/api/admin/transactions', async (ctx) => {
  await requireAdmin(ctx);
  const q = ctx.query;
  return store.listTransactions({
    type: q.get('type') || undefined, status: q.get('status') || undefined,
    userId: q.get('user_id') ? intId(q.get('user_id')) : undefined, withUser: true, limit: 500,
  });
});

for (const action of ['approve', 'reject']) {
  route('POST', `/api/admin/transactions/:id/${action}`, async (ctx) => {
    const admin = await requireAdmin(ctx);
    const reason = text(ctx.body.note, 200) || null;
    const t = await store.processTransaction(intId(ctx.params.id), action === 'approve', Number(admin.id), reason);
    const amt = fmtAmt(Math.abs(t.amount)), ok = action === 'approve', dep = t.type === 'deposit';
    const msg = dep
      ? (ok ? ['Deposit approved', `Your deposit of ${amt} USDT has been credited to your balance.`, 'success']
        : ['Deposit rejected', `Your deposit request of ${amt} USDT was rejected.`, 'warning'])
      : (ok ? ['Withdrawal completed', `${amt} USDT has been sent to your bank account.`, 'success']
        : ['Withdrawal rejected', `Your withdrawal of ${amt} USDT was rejected and the amount returned to your balance.`, 'warning']);
    if (reason && !ok) msg[1] += ` Note: ${reason}`;
    await autoNotify(t.user_id, ...msg);
    return t;
  });
}

// ---------- notifications ----------
const KINDS = ['info', 'success', 'warning', 'alert'];
const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max);
const fmtAmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// A failed notification must never undo the money operation that triggered it.
async function autoNotify(userId, title, body, kind = 'info') {
  try { await store.sendNotification({ userId, title, body, kind }); } catch (e) { console.error('notify failed', e.message); }
}

let bcastCache = { at: 0, v: 0 };
async function lastBroadcastAt() {
  if (Date.now() - bcastCache.at < 60_000) return bcastCache.v;
  const st = await store.getState('notify_broadcast');
  bcastCache = { at: Date.now(), v: st && st.at ? new Date(st.at).getTime() : 0 };
  return bcastCache.v;
}
const ms = (d) => (d ? new Date(d).getTime() || 0 : 0);
// True when something arrived after the customer last opened their notifications.
async function hasUnread(user) {
  const joined = ms(user.created_at) - 86_400_000;
  const b = await lastBroadcastAt();
  const latest = Math.max(ms(user.notif_latest_at), b >= joined ? b : 0);
  return latest > ms(user.notif_seen_at);
}

route('GET', '/api/notifications', async (ctx) => {
  const user = await requireUser(ctx);
  const seen = ms(user.notif_seen_at);
  const items = (await store.listNotificationsFor(user)).map((n) => ({ id: n.id, title: n.title, body: n.body, kind: n.kind, created_at: n.created_at, broadcast: !n.user_id, unread: ms(n.created_at) > seen }));
  return { items, unread: items.filter((n) => n.unread).length };
});

route('POST', '/api/notifications/read', async (ctx) => {
  const user = await requireUser(ctx);
  await store.markNotificationsSeen(Number(user.id));
  return { ok: true };
});

route('GET', '/api/admin/notifications', async (ctx) => {
  await requireAdmin(ctx);
  return store.listAllNotifications();
});

route('POST', '/api/admin/notifications', async (ctx) => {
  const admin = await requireAdmin(ctx);
  const b = ctx.body;
  const title = text(b.title, 120), body = text(b.body, 2000);
  if (!title) throw new ApiError(400, 'Enter a title');
  const kind = KINDS.includes(b.kind) ? b.kind : 'info';
  let userId = 0;
  if (b.target !== 'all') {
    if (b.user_id) userId = intId(b.user_id);
    else if (b.email) {
      const u = await store.getUserByEmail(String(b.email).trim().toLowerCase());
      if (!u) throw new ApiError(404, 'No customer with that email');
      userId = Number(u.id);
    } else throw new ApiError(400, 'Choose a customer or send to everyone');
  }
  const n = await store.sendNotification({ userId, title, body, kind, createdBy: Number(admin.id) });
  if (!userId) bcastCache = { at: 0, v: 0 };
  return n;
});

route('DELETE', '/api/admin/notifications/:id', async (ctx) => {
  await requireAdmin(ctx);
  await store.deleteNotification(intId(ctx.params.id));
  return { ok: true };
});

route('GET', '/api/admin/orders', async (ctx) => {
  await requireAdmin(ctx);
  await engine.settleDue();
  const q = ctx.query;
  const m = q.get('symbol') ? await engine.bySymbol(q.get('symbol')) : null;
  return withLiveAll(await store.listOrders({
    status: q.get('status') || undefined, result: q.get('result') || undefined, side: q.get('side') || undefined,
    userId: q.get('user_id') ? intId(q.get('user_id')) : undefined, marketId: m ? m.id : undefined, limit: 500,
  }));
});

route('POST', '/api/admin/orders/:id/close', async (ctx) => {
  await requireAdmin(ctx);
  return closeOrder(intId(ctx.params.id), 'admin', null);
});

route('POST', '/api/admin/orders/:id/cancel', async (ctx) => {
  await requireAdmin(ctx);
  return withLive(await store.cancelOrder(intId(ctx.params.id), null));
});

// ---------- dispatcher ----------
// ctx: { method, pathname, query: URLSearchParams, headers: {lowercase: value}, body: object, ip }
async function dispatch(ctx) {
  if (config.problems.length) return { status: 500, data: { error: `Server not configured: ${config.problems.join('; ')}` } };
  for (const r of routes) {
    if (r.method !== ctx.method) continue;
    const m = ctx.pathname.match(r.re);
    if (!m) continue;
    ctx.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    try {
      await bootstrap();
      const out = await r.handler(ctx);
      if (out && out.data !== undefined && out.headers) return { status: 200, data: out.data, headers: out.headers };
      return { status: 200, data: out };
    } catch (e) {
      const err = mapDbError(e);
      if (err instanceof ApiError) return { status: err.status, data: { error: err.message, ...(err.code ? { code: err.code } : {}) } };
      console.error(e);
      if (/NOT_FOUND|PERMISSION_DENIED|does not exist|Firebase auth failed/i.test(e.message || '')) {
        return { status: 500, data: { error: 'Database not reachable: check FIREBASE_SERVICE_ACCOUNT and that Firestore is created in your Firebase project' } };
      }
      return { status: 500, data: { error: 'Server error' } };
    }
  }
  return { status: 404, data: { error: 'Not found' } };
}

module.exports = { dispatch, bootstrap };
