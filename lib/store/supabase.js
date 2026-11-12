'use strict';
// Storage backend: Supabase (Postgres via PostgREST). Money-moving logic lives in the SQL
// functions from supabase/migrations; this file only maps the store interface onto them.
const db = require('../supabase');

const candleFromRow = (r) => ({ t: Date.parse(r.ts), o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v });
const candleToRow = (marketId, c) => ({ market_id: marketId, ts: new Date(c.t).toISOString(), o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
const candleToJson = (c) => ({ ts: new Date(c.t).toISOString(), o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });

module.exports = {
  name: 'supabase',
  DbError: db.DbError,

  // ---------- users ----------
  getUser: (id) => db.one('app_users', { filters: [['id', 'eq', id]] }),
  getUserByEmail: (email) => db.one('app_users', { filters: [['email', 'eq', email]] }),
  createUser: ({ email, name, passwordHash, role, startBalance }) =>
    db.rpc('create_user', { p_email: email, p_name: name, p_password_hash: passwordHash, p_role: role, p_start_balance: startBalance }),
  async updateUser(id, patch) {
    try {
      const rows = await db.update('app_users', patch, [['id', 'eq', id]]);
      return rows[0] || null;
    } catch (e) {
      if (/duplicate key|unique/i.test(e.message)) throw new db.DbError('EMAIL_TAKEN', 400);
      throw e;
    }
  },
  listUsers: ({ q, role, status }) => db.select('users_view', {
    filters: [['role', 'eq', role || undefined], ['status', 'eq', status || undefined]],
    or: q ? `email.ilike.*${q}*,name.ilike.*${q}*` : undefined,
    order: 'id.desc', limit: 500,
  }),
  getUserWithStats: (id) => db.one('users_view', { filters: [['id', 'eq', id]] }),
  adjustBalance: (userId, amount, note, adminId) => db.rpc('admin_adjust_balance', { p_user: userId, p_amount: amount, p_note: note, p_admin: adminId }),

  // ---------- wallet ----------
  requestDeposit: (userId, amount, note) => db.rpc('request_deposit', { p_user: userId, p_amount: amount, p_note: note }),
  requestWithdrawal: (userId, amount, note) => db.rpc('request_withdrawal', { p_user: userId, p_amount: amount, p_note: note }),
  processTransaction: (txId, approve, adminId, note) => db.rpc('process_transaction', { p_tx: txId, p_approve: approve, p_admin: adminId, p_note: note }),
  listTransactions: ({ userId, type, status, withUser = false, limit = 300 }) => db.select(withUser ? 'transactions_view' : 'transactions', {
    filters: [['user_id', 'eq', userId], ['type', 'eq', type || undefined], ['status', 'eq', status || undefined]],
    order: 'id.desc', limit,
  }),

  // ---------- orders ----------
  placeOrder: (p) => db.rpc('place_order', {
    p_user: p.userId, p_market: p.marketId, p_side: p.side, p_type: p.type, p_margin: p.margin, p_leverage: p.leverage,
    p_exec_price: p.execPrice, p_limit_price: p.limitPrice, p_tp: p.tp, p_sl: p.sl,
  }),
  closeOrder: (id, price, reason, userId) => db.rpc('close_order', { p_order: id, p_price: price, p_reason: reason, p_user: userId || null }),
  cancelOrder: (id, userId) => db.rpc('cancel_order', { p_order: id, p_user: userId || null }),
  getOrder: (id) => db.one('orders', { filters: [['id', 'eq', id]] }),
  // filters: userId, statuses[], status, result, side, marketId, changedSince (ISO)
  listOrders: (f) => db.select('orders_view', {
    filters: [
      ['user_id', 'eq', f.userId], ['status', 'in', f.statuses], ['status', 'eq', f.status || undefined],
      ['result', 'eq', f.result || undefined], ['side', 'eq', f.side || undefined], ['market_id', 'eq', f.marketId],
    ],
    or: f.changedSince ? `closed_at.gt.${f.changedSince},opened_at.gt.${f.changedSince}` : undefined,
    order: 'id.desc', limit: f.limit || 500,
  }),
  activeOrdersForMarket: (marketId) => db.select('orders', { filters: [['market_id', 'eq', marketId], ['status', 'in', ['open', 'pending']]] }),
  openPositions: () => db.select('orders', { filters: [['status', 'eq', 'open']] }),

  // ---------- markets & candles ----------
  listMarkets: () => db.select('markets', { order: 'id.asc' }),
  async insertMarket(fields) { return (await db.insert('markets', fields))[0]; },
  async updateMarket(id, fields) { return (await db.update('markets', { ...fields, updated_at: new Date().toISOString() }, [['id', 'eq', id]]))[0]; },
  setMarketPrice: (id, price) => db.rpc('set_market_price', { p_market: id, p_price: price }),
  async lastCandle(marketId) {
    const rows = await db.select('candles', { filters: [['market_id', 'eq', marketId]], order: 'ts.desc', limit: 1 });
    return rows[0] ? candleFromRow(rows[0]) : null;
  },
  async listCandles(marketId, limit) {
    const rows = await db.select('candles', { filters: [['market_id', 'eq', marketId]], order: 'ts.desc', limit });
    return rows.reverse().map(candleFromRow);
  },
  async insertCandles(marketId, candles) {
    for (let i = 0; i < candles.length; i += 300) {
      await db.insert('candles', candles.slice(i, i + 300).map((c) => candleToRow(marketId, c)), { onConflict: 'market_id,ts' });
    }
  },
  async stats24h() {
    const rows = await db.select('market_stats_24h');
    return new Map(rows.map((s) => [Number(s.market_id), { open24h: +s.open24h, high24h: +s.high24h, low24h: +s.low24h, volume24h: +s.volume24h }]));
  },
  pruneCandles: (days) => db.rpc('prune_candles', { p_days: days }),
  // Commit one engine advance atomically. Returns { ok, orders }.
  applyTick: ({ marketId, expected, newAt, price, candles, events }) => db.rpc('apply_tick', {
    p_market: marketId, p_expected: expected, p_new_at: newAt, p_price: price, p_candles: candles.map(candleToJson), p_events: events,
  }),

  // ---------- admin ----------
  adminStats: () => db.rpc('admin_stats'),

  // ---------- jobs, state, throttling ----------
  claimJob: (key, seconds) => db.rpc('claim_job', { p_key: key, p_seconds: seconds }),
  async getState(key) { const row = await db.one('app_state', { filters: [['key', 'eq', key]] }); return row ? row.value : null; },
  setState: (key, value) => db.rpc('set_state', { p_key: key, p_value: value }),
  loginFailureCount: (key) => db.rpc('login_failure_count', { p_key: key }),
  noteLoginFailure: (key) => db.rpc('note_login_failure', { p_key: key }),
};
