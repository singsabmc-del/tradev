'use strict';
const db = require('./supabase');
const auth = require('./auth');
const engine = require('./engine');
const config = require('./config');
const sheets = require('./sheets');

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
    if (key) return new ApiError(key === 'ORDER_NOT_FOUND' || key === 'USER_NOT_FOUND' || key === 'TX_NOT_FOUND' ? 404 : 400, MESSAGES[key]);
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

// short-lived user cache so each request doesn't need a DB round-trip
const userCache = new Map();
async function loadUser(id, fresh = false) {
  const hit = userCache.get(id);
  if (!fresh && hit && hit.at > Date.now() - 5000) return hit.user;
  const user = await db.one('app_users', { filters: [['id', 'eq', id]] });
  userCache.set(id, { user, at: Date.now() });
  return user;
}

async function requireUser(req) {
  const h = req.headers.authorization || '';
  const payload = auth.verify(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!payload) throw new ApiError(401, 'Please log in');
  const user = await loadUser(payload.sub);
  if (!user) throw new ApiError(401, 'Please log in');
  if (user.status !== 'active') throw new ApiError(403, 'Your account is suspended');
  return user;
}
async function requireAdmin(req) {
  const user = await requireUser(req);
  if (user.role !== 'admin') throw new ApiError(403, 'Admin only');
  return user;
}

// login throttling: 10 failures per 15 minutes per IP+email
const attempts = new Map();
function throttle(key) {
  const now = Date.now();
  const a = (attempts.get(key) || []).filter((t) => t > now - 15 * 60_000);
  attempts.set(key, a);
  if (a.length >= 10) throw new ApiError(429, 'Too many attempts. Try again in a few minutes.');
  return () => a.push(now);
}

function unrealized(o) {
  const m = engine.markets.get(o.market_id);
  if (!m || o.status !== 'open') return null;
  const pnl = (o.side === 'long' ? m.price - o.entry_price : o.entry_price - m.price) * o.size;
  return Math.max(pnl, -o.margin);
}
const withLive = (o) => {
  const n = engine.normalizeOrder(o);
  const m = engine.markets.get(n.market_id);
  return { ...n, mark_price: m ? m.price : null, unrealized_pnl: unrealized(n) };
};

// ---------- routes ----------
const routes = [];
const route = (method, path, handler) => {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

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
  const fail = throttle(`${ip}|${email}`);
  const user = await db.one('app_users', { filters: [['email', 'eq', email]] });
  if (!user || !auth.verifyPassword(String(body.password || ''), user.password_hash)) {
    fail();
    throw new ApiError(401, 'Wrong email or password');
  }
  if (user.status !== 'active') throw new ApiError(403, 'Your account is suspended');
  await db.update('app_users', { last_login_at: new Date().toISOString() }, [['id', 'eq', user.id]]);
  return { token: auth.sign({ sub: Number(user.id), role: user.role }), user: publicUser(user) };
});

route('GET', '/api/me', async ({ req }) => {
  const u = await requireUser(req);
  return publicUser(await loadUser(u.id, true));
});

// Market data (public)
route('GET', '/api/markets', async () => [...engine.markets.values()].filter((m) => m.enabled).map(engine.publicMarket));
route('GET', '/api/candles', async ({ query }) => {
  const m = engine.bySymbol(query.get('symbol'));
  if (!m) throw new ApiError(404, 'Unknown market');
  return engine.candles(m.id, Math.min(Number(query.get('limit')) || 500, 1500));
});

// Trading
route('POST', '/api/orders', async ({ req, body }) => {
  const user = await requireUser(req);
  const m = engine.bySymbol(body.symbol);
  if (!m || !m.enabled) throw new ApiError(400, 'This market is currently closed');
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
  userCache.delete(user.id);
  return withLive(engine.track(order));
});

route('GET', '/api/orders', async ({ req, query }) => {
  const user = await requireUser(req);
  const scope = query.get('scope') || 'active';
  const statuses = scope === 'history' ? ['closed', 'cancelled'] : ['open', 'pending'];
  const rows = await db.select('orders_view', {
    filters: [['user_id', 'eq', user.id], ['status', 'in', statuses]],
    order: 'id.desc', limit: 300,
  });
  return rows.map(withLive);
});

async function closeOrder(id, reason, userId) {
  const live = engine.orders.get(id);
  if (!live || (userId && live.user_id !== userId)) throw new ApiError(404, 'Position not found or already closed');
  if (live.status !== 'open') throw new ApiError(400, 'Order is not an open position');
  if (live.busy) throw new ApiError(409, 'Position is already being closed');
  const m = engine.markets.get(live.market_id);
  live.busy = true;
  try {
    const row = await db.rpc('close_order', { p_order: id, p_price: m.price, p_reason: reason, p_user: userId || null });
    userCache.delete(live.user_id);
    return withLive(engine.track(row));
  } catch (e) {
    live.busy = false;
    throw e;
  }
}

route('POST', '/api/orders/:id/close', async ({ req, params }) => {
  const user = await requireUser(req);
  return closeOrder(intId(params.id), 'manual', user.id);
});

route('POST', '/api/orders/:id/cancel', async ({ req, params }) => {
  const user = await requireUser(req);
  const row = await db.rpc('cancel_order', { p_order: intId(params.id), p_user: user.id });
  userCache.delete(user.id);
  return withLive(engine.track(row));
});

// Wallet
route('GET', '/api/transactions', async ({ req }) => {
  const user = await requireUser(req);
  return db.select('transactions', { filters: [['user_id', 'eq', user.id]], order: 'id.desc', limit: 300 });
});
route('POST', '/api/wallet/deposit', async ({ req, body }) => {
  const user = await requireUser(req);
  return db.rpc('request_deposit', { p_user: user.id, p_amount: posNum(body.amount, 'amount'), p_note: clean(body.note) || null });
});
route('POST', '/api/wallet/withdraw', async ({ req, body }) => {
  const user = await requireUser(req);
  const tx = await db.rpc('request_withdrawal', { p_user: user.id, p_amount: posNum(body.amount, 'amount'), p_note: clean(body.note) || null });
  userCache.delete(user.id);
  return tx;
});

// ---------- Admin ----------
route('GET', '/api/admin/stats', async ({ req }) => {
  await requireAdmin(req);
  const stats = await db.rpc('admin_stats');
  let unrealizedPnl = 0;
  for (const o of engine.orders.values()) unrealizedPnl += unrealized(o) || 0;
  return { ...stats, unrealized_pnl: unrealizedPnl, sheets: sheets.status };
});

route('POST', '/api/admin/sheets/sync', async ({ req }) => {
  await requireAdmin(req);
  if (!sheets.status.enabled) throw new ApiError(400, 'Google Sheets sync is not configured (set SHEETS_WEBHOOK_URL and SHEETS_SECRET)');
  await sheets.syncOnce();
  if (sheets.status.lastError) throw new ApiError(502, `Google Sheets: ${sheets.status.lastError}`);
  return sheets.status;
});

route('GET', '/api/admin/markets', async ({ req }) => {
  await requireAdmin(req);
  return [...engine.markets.values()].map((m) => ({ ...engine.publicMarket(m), volatility: m.volatility, drift: m.drift }));
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

route('POST', '/api/admin/markets', async ({ req, body }) => {
  await requireAdmin(req);
  const symbol = String(body.symbol || '').trim().toUpperCase();
  const mm = symbol.match(/^([A-Z0-9]{2,10})\/([A-Z0-9]{2,10})$/);
  if (!mm) throw new ApiError(400, 'Symbol must look like BTC/USDT');
  if (engine.bySymbol(symbol)) throw new ApiError(400, 'Market already exists');
  const fields = pickMarket(body);
  if (!fields.price) throw new ApiError(400, 'Starting price is required');
  const [row] = await db.insert('markets', { symbol, base: mm[1], quote: mm[2], name: fields.name || mm[1], ...fields });
  const m = await engine.addMarket(row);
  return engine.publicMarket(m);
});

route('PATCH', '/api/admin/markets/:id', async ({ req, params, body }) => {
  await requireAdmin(req);
  const id = intId(params.id);
  if (!engine.markets.has(id)) throw new ApiError(404, 'Market not found');
  const fields = pickMarket(body);
  if (!Object.keys(fields).length) throw new ApiError(400, 'Nothing to update');
  const [row] = await db.update('markets', { ...fields, updated_at: new Date().toISOString() }, [['id', 'eq', id]]);
  const m = await engine.applyMarket(row);
  return { ...engine.publicMarket(m), volatility: m.volatility, drift: m.drift };
});

route('GET', '/api/admin/users', async ({ req, query }) => {
  await requireAdmin(req);
  const q = clean(query.get('q'));
  return db.select('users_view', {
    filters: [['role', 'eq', query.get('role') || undefined], ['status', 'eq', query.get('status') || undefined]],
    or: q ? `email.ilike.*${q}*,name.ilike.*${q}*` : undefined,
    order: 'id.desc', limit: 500,
  });
});

route('GET', '/api/admin/users/:id', async ({ req, params }) => {
  await requireAdmin(req);
  const id = intId(params.id);
  const [user, orders, transactions] = await Promise.all([
    db.one('users_view', { filters: [['id', 'eq', id]] }),
    db.select('orders_view', { filters: [['user_id', 'eq', id]], order: 'id.desc', limit: 300 }),
    db.select('transactions', { filters: [['user_id', 'eq', id]], order: 'id.desc', limit: 300 }),
  ]);
  if (!user) throw new ApiError(404, 'User not found');
  return { user, orders: orders.map(withLive), transactions };
});

route('PATCH', '/api/admin/users/:id', async ({ req, params, body }) => {
  const admin = await requireAdmin(req);
  const id = intId(params.id);
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
  if (id === admin.id && (patch.status === 'suspended' || patch.role === 'customer')) {
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
  userCache.delete(id);
  return publicUser(rows[0]);
});

route('POST', '/api/admin/users/:id/adjust', async ({ req, params, body }) => {
  const admin = await requireAdmin(req);
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount === 0) throw new ApiError(400, 'Enter a non-zero amount');
  const id = intId(params.id);
  const u = await db.rpc('admin_adjust_balance', { p_user: id, p_amount: amount, p_note: clean(body.note) || null, p_admin: admin.id });
  userCache.delete(id);
  return u;
});

route('GET', '/api/admin/transactions', async ({ req, query }) => {
  await requireAdmin(req);
  return db.select('transactions_view', {
    filters: [
      ['type', 'eq', query.get('type') || undefined],
      ['status', 'eq', query.get('status') || undefined],
      ['user_id', 'eq', query.get('user_id') || undefined],
    ],
    order: 'id.desc', limit: 500,
  });
});

for (const action of ['approve', 'reject']) {
  route('POST', `/api/admin/transactions/:id/${action}`, async ({ req, params, body }) => {
    const admin = await requireAdmin(req);
    const tx = await db.rpc('process_transaction', {
      p_tx: intId(params.id), p_approve: action === 'approve', p_admin: admin.id, p_note: clean(body.note) || null,
    });
    userCache.delete(Number(tx.user_id));
    return tx;
  });
}

route('GET', '/api/admin/orders', async ({ req, query }) => {
  await requireAdmin(req);
  const symbol = query.get('symbol');
  const m = symbol ? engine.bySymbol(symbol) : null;
  const rows = await db.select('orders_view', {
    filters: [
      ['status', 'eq', query.get('status') || undefined],
      ['result', 'eq', query.get('result') || undefined],
      ['side', 'eq', query.get('side') || undefined],
      ['user_id', 'eq', query.get('user_id') || undefined],
      ['market_id', 'eq', m ? m.id : undefined],
    ],
    order: 'id.desc', limit: 500,
  });
  return rows.map(withLive);
});

route('POST', '/api/admin/orders/:id/close', async ({ req, params }) => {
  await requireAdmin(req);
  return closeOrder(intId(params.id), 'admin', null);
});

route('POST', '/api/admin/orders/:id/cancel', async ({ req, params }) => {
  await requireAdmin(req);
  const row = await db.rpc('cancel_order', { p_order: intId(params.id) });
  userCache.delete(Number(row.user_id));
  return withLive(engine.track(row));
});

// ---------- dispatcher ----------
async function dispatch(ctx) {
  for (const r of routes) {
    if (r.method !== ctx.method) continue;
    const m = ctx.pathname.match(r.re);
    if (!m) continue;
    ctx.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    try {
      return { status: 200, data: await r.handler(ctx) };
    } catch (e) {
      const err = mapDbError(e);
      if (err instanceof ApiError) return { status: err.status, data: { error: err.message } };
      console.error(e);
      return { status: 500, data: { error: 'Server error' } };
    }
  }
  return { status: 404, data: { error: 'Not found' } };
}

async function ensureAdmin() {
  const existing = await db.one('app_users', { filters: [['email', 'eq', config.adminEmail]] });
  if (existing) return;
  await db.rpc('create_user', {
    p_email: config.adminEmail, p_name: 'Administrator', p_password_hash: auth.hashPassword(config.adminPassword),
    p_role: 'admin', p_start_balance: 0,
  });
  console.log(`[setup] created admin account ${config.adminEmail}`);
}

module.exports = { dispatch, ensureAdmin, auth };
