'use strict';
// All API routes. Platform-neutral: used by the Vercel function (api/index.mjs) and the
// local Node server (server/index.js). dispatch(ctx) -> { status, data, headers }.
const db = require('./supabase');
const auth = require('./auth');
const engine = require('./engine');
const sheets = require('./sheets');
const config = require('./config');

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
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
};
function mapDbError(e) {
  if (e instanceof db.DbError) {
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
const publicUser = (u) => { if (!u) return u; const { password_hash, ...rest } = u; return rest; };
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
  const user = await db.one('app_users', { filters: [['id', 'eq', payload.sub]] });
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
  const markets = await engine.getMarkets();
  const byId = new Map(markets.map((m) => [m.id, m]));
  return rows.map((r) => {
    const o = engine.normalizeOrder(r);
    const m = byId.get(o.market_id);
    return { ...o, mark_price: m ? m.price : null, unrealized_pnl: unrealized(o, m) };
  });
}
const withLive = async (row) => (await withLiveAll([row]))[0];

// ---------- one-time setup per instance ----------
let booted = null;
function bootstrap() {
  if (!booted) {
    booted = (async () => {
      const existing = await db.one('app_users', { filters: [['email', 'eq', config.adminEmail]] });
      if (!existing) {
        try {
          await db.rpc('create_user', {
            p_email: config.adminEmail, p_name: 'Administrator', p_password_hash: auth.hashPassword(config.adminPassword),
            p_role: 'admin', p_start_balance: 0,
          });
          console.log(`[setup] created admin account ${config.adminEmail}`);
        } catch (e) { if (!/EMAIL_TAKEN/.test(e.message)) throw e; }
      }
      await engine.ensureHistory();
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
const CDN_1S = { 'cache-control': 'public, max-age=0, s-maxage=1, stale-while-revalidate=2' };

route('GET', '/api/health', async () => ({ ok: true, time: new Date().toISOString(), vercel: config.onVercel }));

// Auth
route('POST', '/api/auth/register', async ({ body }) => {
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 80);
  const password = String(body.password || '');
  if (!EMAIL_RE.test(email)) throw new ApiError(400, 'Enter a valid email');
  if (password.length < 8) throw new ApiError(400, 'Password must be at least 8 characters');
  if (!name) throw new ApiError(400, 'Enter your name');
  const user = await db.rpc('create_user', {
    p_email: email, p_name: name, p_password_hash: auth.hashPassword(password),
    p_role: 'customer', p_start_balance: config.startingBalance,
  });
  return { token: auth.sign({ sub: Number(user.id), role: user.role }), user: publicUser(user) };
});

route('POST', '/api/auth/login', async ({ body, ip }) => {
  const email = String(body.email || '').trim().toLowerCase();
  const key = `${ip}|${email}`;
  if ((await db.rpc('login_failure_count', { p_key: key })) >= 10) throw new ApiError(429, 'Too many attempts. Try again in a few minutes.');
  const user = await db.one('app_users', { filters: [['email', 'eq', email]] });
  if (!user || !auth.verifyPassword(String(body.password || ''), user.password_hash)) {
    await db.rpc('note_login_failure', { p_key: key });
    throw new ApiError(401, 'Wrong email or password');
  }
  if (user.status !== 'active') throw new ApiError(403, 'Your account is suspended');
  await db.update('app_users', { last_login_at: new Date().toISOString() }, [['id', 'eq', user.id]]);
  return { token: auth.sign({ sub: Number(user.id), role: user.role }), user: publicUser(user) };
});

route('GET', '/api/me', async (ctx) => publicUser(await requireUser(ctx)));

// Market data (public)
route('GET', '/api/markets', async () => {
  await engine.advanceAll();
  return { data: await engine.publicMarkets(), headers: CDN_1S };
});

// Live prices: polled by every open page. Advancing here is what keeps markets moving.
route('GET', '/api/ticker', async () => {
  const results = await engine.advanceAll();
  const prices = {};
  await Promise.all(results.filter((r) => r.market && r.market.enabled).map(async (r) => {
    let k = r.lastCandle;
    if (!k) k = (await engine.candles(r.market.id, 1))[0];
    prices[r.market.symbol] = { p: r.market.price, k };
  }));
  await sheets.maybeSync();
  return { data: { t: Date.now(), prices }, headers: CDN_1S };
});

route('GET', '/api/candles', async ({ query }) => {
  const m = await engine.bySymbol(query.get('symbol'));
  if (!m) throw new ApiError(404, 'Unknown market');
  await engine.advance(m);
  return { data: await engine.candles(m.id, Math.min(Number(query.get('limit')) || 500, 1500)), headers: CDN_1S };
});

// Trading
route('POST', '/api/orders', async (ctx) => {
  const user = await requireUser(ctx);
  const { body } = ctx;
  let m = await engine.bySymbol(body.symbol, { fresh: true });
  if (!m || !m.enabled) throw new ApiError(400, 'This market is currently closed');
  m = await engine.advanceOne(m.id); // execute at the current price
  const type = body.type === 'limit' ? 'limit' : 'market';
  const order = await db.rpc('place_order', {
    p_user: user.id, p_market: m.id,
    p_side: body.side === 'short' ? 'short' : 'long',
    p_type: type,
    p_margin: posNum(body.margin, 'margin'),
    p_leverage: Math.round(posNum(body.leverage, 'leverage')),
    p_exec_price: m.price,
    p_limit_price: type === 'limit' ? posNum(body.limitPrice, 'limit price') : null,
    p_tp: posNum(body.tp, 'take profit', { optional: true }),
    p_sl: posNum(body.sl, 'stop loss', { optional: true }),
  });
  return withLive(order);
});

route('GET', '/api/orders', async (ctx) => {
  const user = await requireUser(ctx);
  await engine.advanceAll(); // settle anything that triggered since the last request
  const scope = ctx.query.get('scope') || 'active';
  const statuses = scope === 'history' ? ['closed', 'cancelled'] : ['open', 'pending'];
  const rows = await db.select('orders_view', {
    filters: [['user_id', 'eq', user.id], ['status', 'in', statuses]], order: 'id.desc', limit: 300,
  });
  return withLiveAll(rows);
});

// Changes to the user's orders since a timestamp (fills, TP/SL, liquidations), plus balance.
route('GET', '/api/updates', async (ctx) => {
  const user = await requireUser(ctx);
  await engine.advanceAll();
  const since = new Date(Number(ctx.query.get('since')) || Date.now() - 60_000).toISOString();
  const rows = await db.select('orders_view', {
    filters: [['user_id', 'eq', user.id]],
    or: `closed_at.gt.${since},opened_at.gt.${since}`,
    order: 'id.desc', limit: 50,
  });
  const fresh = await db.one('app_users', { filters: [['id', 'eq', user.id]] });
  return { t: Date.now(), balance: Number(fresh.balance), orders: await withLiveAll(rows) };
});

async function closeOrder(id, reason, userId) {
  const row = await db.one('orders', { filters: [['id', 'eq', id]] });
  if (!row || (userId && Number(row.user_id) !== userId)) throw new ApiError(404, 'Position not found or already closed');
  const m = await engine.advanceOne(row.market_id); // settles TP/SL first if they already hit
  const closed = await db.rpc('close_order', { p_order: id, p_price: m.price, p_reason: reason, p_user: userId || null });
  return withLive(closed);
}

route('POST', '/api/orders/:id/close', async (ctx) => {
  const user = await requireUser(ctx);
  return closeOrder(intId(ctx.params.id), 'manual', user.id);
});

route('POST', '/api/orders/:id/cancel', async (ctx) => {
  const user = await requireUser(ctx);
  const row = await db.one('orders', { filters: [['id', 'eq', intId(ctx.params.id)]] });
  if (row) await engine.advanceOne(row.market_id); // it may have filled already
  return withLive(await db.rpc('cancel_order', { p_order: intId(ctx.params.id), p_user: user.id }));
});

// Wallet
route('GET', '/api/transactions', async (ctx) => {
  const user = await requireUser(ctx);
  return db.select('transactions', { filters: [['user_id', 'eq', user.id]], order: 'id.desc', limit: 300 });
});
route('POST', '/api/wallet/deposit', async (ctx) => {
  const user = await requireUser(ctx);
  return db.rpc('request_deposit', { p_user: user.id, p_amount: posNum(ctx.body.amount, 'amount'), p_note: clean(ctx.body.note) || null });
});
route('POST', '/api/wallet/withdraw', async (ctx) => {
  const user = await requireUser(ctx);
  return db.rpc('request_withdrawal', { p_user: user.id, p_amount: posNum(ctx.body.amount, 'amount'), p_note: clean(ctx.body.note) || null });
});

// Scheduled job: Vercel Cron (Authorization: Bearer CRON_SECRET) or an external pinger (?key=CRON_SECRET)
route('GET', '/api/cron', async ({ headers, query }) => {
  const given = (headers.authorization || '').replace(/^Bearer /, '') || query.get('key') || '';
  if (!config.cronSecret || given !== config.cronSecret) throw new ApiError(401, 'Unauthorized');
  const results = await engine.advanceAll();
  const settled = results.reduce((n, r) => n + r.orders.length, 0);
  const sync = await sheets.maybeSync();
  let pruned = 0;
  if (await db.rpc('claim_job', { p_key: 'prune_candles', p_seconds: 86400 })) pruned = await db.rpc('prune_candles', { p_days: 30 });
  return { ok: true, advanced: results.length, settled, sheets: sync ? (sync.lastError ? 'error' : 'synced') : 'skipped', pruned };
});

// ---------- Admin ----------
route('GET', '/api/admin/stats', async (ctx) => {
  await requireAdmin(ctx);
  await engine.advanceAll();
  const [stats, open, markets, sheetsStatus] = await Promise.all([
    db.rpc('admin_stats'),
    db.select('orders', { filters: [['status', 'eq', 'open']] }),
    engine.getMarkets(),
    sheets.getStatus(),
  ]);
  const byId = new Map(markets.map((m) => [m.id, m]));
  let unrealizedPnl = 0;
  for (const r of open) { const o = engine.normalizeOrder(r); unrealizedPnl += unrealized(o, byId.get(o.market_id)) || 0; }
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
  await engine.advanceAll();
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
};
function pickMarket(body) {
  const out = {};
  for (const [k, fn] of Object.entries(MARKET_FIELDS)) if (body[k] !== undefined && body[k] !== '') out[k] = fn(body[k]);
  return out;
}
const adminMarket = async (id) => (await engine.publicMarkets({ includeDisabled: true })).find((m) => m.id === id);

route('POST', '/api/admin/markets', async (ctx) => {
  await requireAdmin(ctx);
  const symbol = String(ctx.body.symbol || '').trim().toUpperCase();
  const mm = symbol.match(/^([A-Z0-9]{2,10})\/([A-Z0-9]{2,10})$/);
  if (!mm) throw new ApiError(400, 'Symbol must look like BTC/USDT');
  if (await engine.bySymbol(symbol, { fresh: true })) throw new ApiError(400, 'Market already exists');
  const fields = pickMarket(ctx.body);
  if (!fields.price) throw new ApiError(400, 'Starting price is required');
  const [row] = await db.insert('markets', { symbol, base: mm[1], quote: mm[2], name: fields.name || mm[1], ...fields });
  await engine.backfill(engine.normalizeMarket(row));
  engine.invalidate();
  return adminMarket(Number(row.id));
});

route('PATCH', '/api/admin/markets/:id', async (ctx) => {
  await requireAdmin(ctx);
  const id = intId(ctx.params.id);
  const m = await engine.getMarket(id, { fresh: true });
  if (!m) throw new ApiError(404, 'Market not found');
  const { price, ...fields } = pickMarket(ctx.body);
  if (price === undefined && !Object.keys(fields).length) throw new ApiError(400, 'Nothing to update');
  if (m.enabled) await engine.advance(m); // settle up to now under the old settings
  if (Object.keys(fields).length) {
    if (fields.enabled === true && !m.enabled) fields.last_tick_at = new Date().toISOString(); // resume without a back-filled gap
    await db.update('markets', { ...fields, updated_at: new Date().toISOString() }, [['id', 'eq', id]]);
  }
  if (price !== undefined) await db.rpc('set_market_price', { p_market: id, p_price: price });
  engine.invalidate();
  return adminMarket(id);
});

route('GET', '/api/admin/users', async (ctx) => {
  await requireAdmin(ctx);
  const q = clean(ctx.query.get('q'));
  return db.select('users_view', {
    filters: [['role', 'eq', ctx.query.get('role') || undefined], ['status', 'eq', ctx.query.get('status') || undefined]],
    or: q ? `email.ilike.*${q}*,name.ilike.*${q}*` : undefined,
    order: 'id.desc', limit: 500,
  });
});

route('GET', '/api/admin/users/:id', async (ctx) => {
  await requireAdmin(ctx);
  const id = intId(ctx.params.id);
  const [user, orders, transactions] = await Promise.all([
    db.one('users_view', { filters: [['id', 'eq', id]] }),
    db.select('orders_view', { filters: [['user_id', 'eq', id]], order: 'id.desc', limit: 300 }),
    db.select('transactions', { filters: [['user_id', 'eq', id]], order: 'id.desc', limit: 300 }),
  ]);
  if (!user) throw new ApiError(404, 'User not found');
  return { user, orders: await withLiveAll(orders), transactions };
});

route('PATCH', '/api/admin/users/:id', async (ctx) => {
  const admin = await requireAdmin(ctx);
  const id = intId(ctx.params.id);
  const { body } = ctx;
  const patch = {};
  if (body.name !== undefined) patch.name = String(body.name).trim().slice(0, 80);
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
  if (body.password) {
    if (String(body.password).length < 8) throw new ApiError(400, 'Password must be at least 8 characters');
    patch.password_hash = auth.hashPassword(String(body.password));
  }
  if (id === Number(admin.id) && (patch.status === 'suspended' || patch.role === 'customer')) {
    throw new ApiError(400, 'You cannot suspend or demote yourself');
  }
  if (!Object.keys(patch).length) throw new ApiError(400, 'Nothing to update');
  let rows;
  try {
    rows = await db.update('app_users', patch, [['id', 'eq', id]]);
  } catch (e) {
    if (/duplicate key|unique/i.test(e.message)) throw new ApiError(400, 'That email is already registered');
    throw e;
  }
  if (!rows.length) throw new ApiError(404, 'User not found');
  return publicUser(rows[0]);
});

route('POST', '/api/admin/users/:id/adjust', async (ctx) => {
  const admin = await requireAdmin(ctx);
  const amount = Number(ctx.body.amount);
  if (!Number.isFinite(amount) || amount === 0) throw new ApiError(400, 'Enter a non-zero amount');
  return db.rpc('admin_adjust_balance', { p_user: intId(ctx.params.id), p_amount: amount, p_note: clean(ctx.body.note) || null, p_admin: admin.id });
});

route('GET', '/api/admin/transactions', async (ctx) => {
  await requireAdmin(ctx);
  const q = ctx.query;
  return db.select('transactions_view', {
    filters: [['type', 'eq', q.get('type') || undefined], ['status', 'eq', q.get('status') || undefined], ['user_id', 'eq', q.get('user_id') || undefined]],
    order: 'id.desc', limit: 500,
  });
});

for (const action of ['approve', 'reject']) {
  route('POST', `/api/admin/transactions/:id/${action}`, async (ctx) => {
    const admin = await requireAdmin(ctx);
    return db.rpc('process_transaction', {
      p_tx: intId(ctx.params.id), p_approve: action === 'approve', p_admin: admin.id, p_note: clean(ctx.body.note) || null,
    });
  });
}

route('GET', '/api/admin/orders', async (ctx) => {
  await requireAdmin(ctx);
  await engine.advanceAll();
  const q = ctx.query;
  const m = q.get('symbol') ? await engine.bySymbol(q.get('symbol')) : null;
  const rows = await db.select('orders_view', {
    filters: [
      ['status', 'eq', q.get('status') || undefined], ['result', 'eq', q.get('result') || undefined],
      ['side', 'eq', q.get('side') || undefined], ['user_id', 'eq', q.get('user_id') || undefined],
      ['market_id', 'eq', m ? m.id : undefined],
    ],
    order: 'id.desc', limit: 500,
  });
  return withLiveAll(rows);
});

route('POST', '/api/admin/orders/:id/close', async (ctx) => {
  await requireAdmin(ctx);
  return closeOrder(intId(ctx.params.id), 'admin', null);
});

route('POST', '/api/admin/orders/:id/cancel', async (ctx) => {
  await requireAdmin(ctx);
  return withLive(await db.rpc('cancel_order', { p_order: intId(ctx.params.id) }));
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
      if (err instanceof ApiError) return { status: err.status, data: { error: err.message } };
      console.error(e);
      if (/relation|does not exist|Could not find/i.test(e.message || '')) {
        return { status: 500, data: { error: 'Database not set up: run supabase/migrations/001_init.sql and 002_serverless.sql in Supabase' } };
      }
      return { status: 500, data: { error: 'Server error' } };
    }
  }
  return { status: 404, data: { error: 'Not found' } };
}

module.exports = { dispatch, bootstrap };
