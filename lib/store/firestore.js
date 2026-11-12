'use strict';
// Storage: Firebase Cloud Firestore (REST). Every money-moving operation runs in a
// Firestore read-write transaction.
//
// Collections
//   users/{key}            user + running stats (trades, wins, losses, total_pnl, fees, volume, open_positions)
//   emails/{email}         uniqueness index -> { user_id }
//   markets/{key}          market settings, price, last_tick_at, day (hourly summaries for 24h stats)
//   markets/{key}/candleHours/{hourStartMs}   { start, k: [60 one-minute candles] }
//   market_stats/{key}     per-market trading counters
//   orders/{key}, transactions/{key}
//   counters/{kind}        sequential numeric ids
//   app_state/{key}, login_failures/{hash}
// Document keys are 10-digit "reversed" ids (9999999999 - id), so the default document order
// is newest-first: list queries need no orderBy and therefore no composite indexes.
const crypto = require('node:crypto');
const fs = require('../firestore');
const { DbError } = require('../errors');
const { MARKETS: SEED } = require('../seed');

const MINUTE = 60_000, HOUR = 3_600_000;
const key = (id) => String(9_999_999_999 - Number(id)).padStart(10, '0');
const P = {
  user: (id) => `users/${key(id)}`, email: (e) => `emails/${hashKey(String(e).toLowerCase())}`,
  phone: (p) => `phones/${hashKey(phoneKey(p))}`,
  market: (id) => `markets/${key(id)}`, stats: (id) => `market_stats/${key(id)}`,
  hour: (marketId, start) => `markets/${key(marketId)}/candleHours/${start}`,
  order: (id) => `orders/${key(id)}`, tx: (id) => `transactions/${key(id)}`,
  notif: (id) => `notifications/${key(id)}`,
  counter: (kind) => `counters/${kind}`, state: (k) => `app_state/${String(k).replace(/[^A-Za-z0-9_-]/g, '_')}`,
};
// Phone numbers are matched on the national number, so the local and international ways of writing
// the same number are one login: "081-234 5678", "+66 81 234 5678" and "0066812345678" all become 812345678.
const COUNTRY_CODES = ['855', '856', '880', '971', '66', '95', '84', '60', '65', '63', '62', '86', '91', '81', '82', '44', '61', '1'];
function phoneKey(p) {
  const raw = String(p || '').trim();
  let d = raw.replace(/\D/g, '');
  const intl = raw.startsWith('+') || d.startsWith('00');
  d = d.replace(/^00/, '');
  if (intl) { const cc = COUNTRY_CODES.find((c) => d.startsWith(c)); if (cc) d = d.slice(cc.length); }
  else if (/^66\d{9}$/.test(d)) d = d.slice(2); // Thailand written without the +
  else if (/^855\d{8,9}$/.test(d)) d = d.slice(3); // Cambodia written without the +
  return d.replace(/^0+/, '');
}
const fail = (code, status = 400) => { throw new DbError(code, status); };
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const strip = (d) => { if (!d) return d; const { _path, _updateTime, ...rest } = d; return rest; };
const noHash = (u) => { if (!u) return u; const { password_hash, ...rest } = strip(u); return rest; };
const liqPrice = (side, entry, lev) => (side === 'long' ? entry * (1 - 1 / lev) : entry * (1 + 1 / lev));
const now = () => new Date();

// ---------- id allocation inside a transaction ----------
function idAllocator(tx) {
  const next = new Map();
  return {
    async take(kind) {
      if (!next.has(kind)) {
        const c = await tx.get(P.counter(kind));
        next.set(kind, c ? Number(c.next) : 1);
      }
      const id = next.get(kind);
      next.set(kind, id + 1);
      return id;
    },
    flush() { for (const [kind, n] of next) tx.set(P.counter(kind), { next: n }); },
  };
}

// ---------- markets cache (symbol/decimals for order listings) ----------
let mcache = { at: 0, list: null };
async function marketsList(fresh = false) {
  if (!fresh && mcache.list && Date.now() - mcache.at < 2000) return mcache.list;
  const rows = (await fs.query({ collection: 'markets' })).map(strip).sort((a, b) => a.id - b.id);
  mcache = { at: Date.now(), list: rows };
  return rows;
}
const invalidateMarkets = () => { mcache = { at: 0, list: null }; };

async function decorateOrders(orders) {
  if (!orders.length) return [];
  const markets = new Map((await marketsList()).map((m) => [m.id, m]));
  const users = await fs.batchGet([...new Set(orders.map((o) => P.user(o.user_id)))]);
  return orders.map((o) => {
    const m = markets.get(o.market_id) || {};
    const u = users.get(P.user(o.user_id)) || {};
    return { ...strip(o), symbol: m.symbol, decimals: m.decimals, user_email: u.email, user_name: u.name };
  });
}
async function decorateTx(txs) {
  if (!txs.length) return [];
  const users = await fs.batchGet([...new Set(txs.map((t) => P.user(t.user_id)))]);
  return txs.map((t) => { const u = users.get(P.user(t.user_id)) || {}; return { ...strip(t), user_email: u.email, user_name: u.name }; });
}

// ---------- shared transactional pieces ----------
function newTx(ids, tx, fields) {
  return ids.take('transactions').then((id) => {
    const doc = { id, order_id: null, note: null, processed_by: null, processed_at: null, status: 'completed', created_at: now(), ...fields };
    if (doc.status !== 'pending' && !doc.processed_at) doc.processed_at = now();
    doc.amount = r2(doc.amount);
    doc.balance_after = doc.balance_after === null ? null : r2(doc.balance_after);
    tx.create(P.tx(id), doc);
    return doc;
  });
}

// Settle a close for an order already read in this transaction. Mutates `o`, `u`, `ms` in memory.
function settleClose(o, u, ms, price, reason, at) {
  let pnl = o.side === 'long' ? (price - o.entry_price) * o.size : (o.entry_price - price) * o.size;
  pnl = r2(Math.max(pnl, -o.margin));
  const payout = r2(o.margin + pnl);
  const result = pnl - o.fee > 0 ? 'win' : pnl - o.fee < 0 ? 'lose' : 'even';
  const opened = Date.parse(o.opened_at);
  Object.assign(o, {
    status: 'closed', exit_price: price, pnl, result, close_reason: reason,
    closed_at: new Date(Math.max(at ? Date.parse(at) : Date.now(), opened || 0)).toISOString(),
  });
  u.balance = r2(u.balance + payout);
  u.trades = (u.trades || 0) + 1;
  if (result === 'win') u.wins = (u.wins || 0) + 1;
  if (result === 'lose') u.losses = (u.losses || 0) + 1;
  u.total_pnl = r2((u.total_pnl || 0) + pnl);
  u.open_positions = Math.max(0, (u.open_positions || 0) - 1);
  if (ms) {
    if (result === 'win') ms.wins = (ms.wins || 0) + 1;
    if (result === 'lose') ms.losses = (ms.losses || 0) + 1;
    ms.customer_pnl = r2((ms.customer_pnl || 0) + pnl);
  }
  return { pnl, payout };
}
function settleFill(o, u, ms, price, at) {
  Object.assign(o, {
    status: 'open', entry_price: price, opened_at: at || new Date().toISOString(),
    size: (o.margin * o.leverage) / price, liq_price: liqPrice(o.side, price, o.leverage),
  });
  u.open_positions = (u.open_positions || 0) + 1;
  u.fees = r2((u.fees || 0) + o.fee);
  u.volume = r2((u.volume || 0) + o.margin * o.leverage);
  if (ms) { ms.trades = (ms.trades || 0) + 1; ms.volume = r2((ms.volume || 0) + o.margin * o.leverage); }
}
const toDates = (o) => {
  const out = { ...o };
  for (const k of ['opened_at', 'closed_at', 'created_at', 'processed_at', 'last_login_at', 'orders_changed_at', 'last_tick_at', 'updated_at']) {
    if (typeof out[k] === 'string') out[k] = new Date(out[k]);
  }
  return out;
};
const writeUser = (tx, u) => tx.update(P.user(u.id), toDates({
  balance: u.balance, trades: u.trades || 0, wins: u.wins || 0, losses: u.losses || 0, total_pnl: u.total_pnl || 0,
  fees: u.fees || 0, volume: u.volume || 0, open_positions: u.open_positions || 0, orders_changed_at: new Date(),
}));
const writeOrder = (tx, o) => tx.set(P.order(o.id), toDates(strip(o)));
const writeStats = (tx, marketId, ms) => tx.set(P.stats(marketId), { market_id: marketId, trades: ms.trades || 0, volume: ms.volume || 0, wins: ms.wins || 0, losses: ms.losses || 0, customer_pnl: ms.customer_pnl || 0 });

// ---------- candles ----------
function hourSummary(start, k) {
  if (!k.length) return null;
  return { t: start, o: k[0].o, h: Math.max(...k.map((c) => c.h)), l: Math.min(...k.map((c) => c.l)), v: r2(k.reduce((s, c) => s + c.v, 0)) };
}
function mergeHour(existing, start, candles) {
  const byT = new Map(((existing && existing.k) || []).map((c) => [c.t, c]));
  for (const c of candles) byT.set(c.t, { t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
  return { start, k: [...byT.values()].sort((a, b) => a.t - b.t) };
}
function mergeDay(day, summaries) {
  const byT = new Map((day || []).map((d) => [d.t, d]));
  for (const s of summaries) if (s) byT.set(s.t, s);
  const cutoff = Date.now() - 26 * HOUR;
  return [...byT.values()].filter((d) => d.t >= cutoff).sort((a, b) => a.t - b.t);
}
const groupByHour = (candles) => {
  const g = new Map();
  for (const c of candles) { const h = Math.floor(c.t / HOUR) * HOUR; if (!g.has(h)) g.set(h, []); g.get(h).push(c); }
  return g;
};

module.exports = {
  name: 'firestore',
  DbError,

  // ---------- first-run seed ----------
  async ensureSeed() {
    const list = await marketsList(true);
    if (list.length) return;
    for (const m of SEED) await module.exports.insertMarket(m);
  },

  // ---------- users ----------
  async getUser(id) { return strip(await fs.get(P.user(id))); },
  async getUserByEmail(email) {
    const [u] = await fs.query({ collection: 'users', where: [['email', '==', String(email).toLowerCase()]], limit: 1 });
    return strip(u) || null;
  },
  createUser: ({ email, name, passwordHash, role = 'customer', startBalance = 0, demo = false, phone = '' }) => fs.runTransaction(async (tx) => {
    email = String(email).toLowerCase();
    if (await tx.get(P.email(email))) fail('EMAIL_TAKEN');
    if (phone && (await tx.get(P.phone(phone)))) fail('PHONE_TAKEN');
    const ids = idAllocator(tx);
    const id = await ids.take('users');
    const bal = r2(Math.max(Number(startBalance) || 0, 0));
    const u = {
      id, email, name: name || '', password_hash: passwordHash, role, balance: bal, status: 'active',
      created_at: now(), last_login_at: null, trades: 0, wins: 0, losses: 0, total_pnl: 0, fees: 0, volume: 0, open_positions: 0,
      orders_changed_at: now(), demo: Boolean(demo), phone: phone || '',
    };
    tx.create(P.user(id), u);
    tx.create(P.email(email), { user_id: id });
    if (phone) tx.create(P.phone(phone), { user_id: id });
    if (bal > 0) await newTx(ids, tx, { user_id: id, type: 'bonus', amount: bal, balance_after: bal, note: demo ? 'Demo funds' : 'Welcome balance' });
    ids.flush();
    return noHash({ ...u, created_at: u.created_at.toISOString(), orders_changed_at: undefined });
  }),
  updateUser: (id, patch) => fs.runTransaction(async (tx) => {
    const u = await tx.get(P.user(id));
    if (!u) return null;
    if (patch.email && patch.email !== u.email) {
      const taken = await tx.get(P.email(patch.email));
      if (taken && Number(taken.user_id) !== Number(id)) fail('EMAIL_TAKEN');
      tx.delete(P.email(u.email));
      tx.set(P.email(patch.email), { user_id: Number(id) });
    }
    if (patch.phone !== undefined && phoneKey(patch.phone) !== phoneKey(u.phone)) {
      if (patch.phone) {
        const taken = await tx.get(P.phone(patch.phone));
        if (taken && Number(taken.user_id) !== Number(id)) fail('PHONE_TAKEN');
        tx.set(P.phone(patch.phone), { user_id: Number(id) });
      }
      if (u.phone) tx.delete(P.phone(u.phone));
    }
    tx.update(P.user(id), toDates(patch));
    return strip({ ...u, ...patch });
  }),
  async getUserByPhone(phone) {
    if (phoneKey(phone).length < 6) return null;
    const idx = await fs.get(P.phone(phone));
    return idx ? strip(await fs.get(P.user(idx.user_id))) : null;
  },
  async listUsers({ q, role, status }) {
    let rows = (await fs.query({ collection: 'users', where: [['role', '==', role], ['status', '==', status]], limit: 1000 })).map(noHash);
    if (q) { const s = q.toLowerCase(); rows = rows.filter((u) => u.email.includes(s) || (u.name || '').toLowerCase().includes(s) || (u.phone || '').replace(/\D/g, '').includes(s.replace(/\D/g, '') || '\u0000')); }
    return rows.sort((a, b) => b.id - a.id).slice(0, 500);
  },
  async getUserWithStats(id) { return noHash(await fs.get(P.user(id))); },
  // Demo accounts: top the practice balance back up. Refused while anything is open so P&L stays coherent.
  resetDemo: (userId, amount) => fs.runTransaction(async (tx) => {
    const u = strip(await tx.get(P.user(userId)));
    if (!u || !u.demo) fail('NOT_DEMO');
    const busy = await tx.query({ collection: 'orders', where: [['user_id', '==', Number(userId)], ['status', 'in', ['open', 'pending']]], limit: 1 });
    if (busy.length) fail('DEMO_HAS_OPEN_ORDERS');
    const bal = r2(amount);
    const ids = idAllocator(tx);
    tx.update(P.user(userId), { balance: bal });
    await newTx(ids, tx, { user_id: Number(userId), type: 'adjustment', amount: r2(bal - u.balance), balance_after: bal, note: 'Demo balance reset' });
    ids.flush();
    return noHash({ ...u, balance: bal });
  }),
  adjustBalance: (userId, amount, note, adminId) => fs.runTransaction(async (tx) => {
    const u = strip(await tx.get(P.user(userId)));
    if (!u) fail('USER_NOT_FOUND', 404);
    const bal = r2(u.balance + amount);
    if (bal < 0) fail('INSUFFICIENT_BALANCE');
    const ids = idAllocator(tx);
    tx.update(P.user(userId), { balance: bal });
    await newTx(ids, tx, { user_id: Number(userId), type: 'adjustment', amount, balance_after: bal, note: note || 'Admin adjustment', processed_by: adminId });
    ids.flush();
    return noHash({ ...u, balance: bal });
  }),

  // Admin deposits / withdraws on the customer's behalf: recorded as a completed deposit or withdrawal.
  adminCashflow: (userId, type, amount, note, adminId) => fs.runTransaction(async (tx) => {
    if (!(amount > 0)) fail('INVALID_AMOUNT');
    const u = strip(await tx.get(P.user(userId)));
    if (!u) fail('USER_NOT_FOUND', 404);
    if (u.demo) fail('DEMO_ACCOUNT');
    const signedAmt = type === 'deposit' ? amount : -amount;
    const bal = r2(u.balance + signedAmt);
    if (bal < 0) fail('INSUFFICIENT_BALANCE');
    const ids = idAllocator(tx);
    tx.update(P.user(userId), { balance: bal });
    const t = await newTx(ids, tx, {
      user_id: Number(userId), type, amount: signedAmt, balance_after: bal, processed_by: adminId,
      note: note || (type === 'deposit' ? 'Deposit by admin' : 'Withdrawal by admin'),
      bank: type === 'withdrawal' ? bankSnapshot(u.bank) : null,
    });
    ids.flush();
    return { transaction: strip(toIso(t)), user: noHash({ ...u, balance: bal }) };
  }),

  // ---------- wallet ----------
  requestDeposit: (userId, amount, note, bank = null) => fs.runTransaction(async (tx) => {
    if (!(amount > 0)) fail('INVALID_AMOUNT');
    const u = await tx.get(P.user(userId));
    if (!u || u.status !== 'active') fail('ACCOUNT_INACTIVE');
    const ids = idAllocator(tx);
    const t = await newTx(ids, tx, { user_id: Number(userId), type: 'deposit', amount, balance_after: u.balance, status: 'pending', note: note || 'Deposit request', bank: bankSnapshot(bank) });
    ids.flush();
    return strip(toIso(t));
  }),
  requestWithdrawal: (userId, amount, note, bank = null) => fs.runTransaction(async (tx) => {
    if (!(amount > 0)) fail('INVALID_AMOUNT');
    const u = await tx.get(P.user(userId));
    if (!u || u.status !== 'active') fail('ACCOUNT_INACTIVE');
    if (u.balance < amount) fail('INSUFFICIENT_BALANCE');
    const bal = r2(u.balance - amount);
    const ids = idAllocator(tx);
    tx.update(P.user(userId), { balance: bal });
    const t = await newTx(ids, tx, { user_id: Number(userId), type: 'withdrawal', amount: -amount, balance_after: bal, status: 'pending', note: note || 'Withdrawal request', bank: bankSnapshot(bank) });
    ids.flush();
    return strip(toIso(t));
  }),
  processTransaction: (txId, approve, adminId, note) => fs.runTransaction(async (tx) => {
    const t = strip(await tx.get(P.tx(txId)));
    if (!t) fail('TX_NOT_FOUND', 404);
    if (t.status !== 'pending') fail('TX_NOT_PENDING');
    const u = strip(await tx.get(P.user(t.user_id)));
    let bal = u.balance;
    if (t.type === 'deposit' && approve) bal = r2(bal + t.amount);
    else if (t.type === 'withdrawal' && !approve) bal = r2(bal - t.amount); // amount is negative: refund
    if (bal !== u.balance) tx.update(P.user(u.id), { balance: bal });
    const upd = { status: approve ? 'completed' : 'rejected', processed_by: adminId, processed_at: now(), balance_after: bal, note: note || t.note };
    tx.update(P.tx(txId), upd);
    return { ...t, ...toIso(upd), user_email: u.email, user_name: u.name };
  }),
  async listTransactions({ userId, type, status, withUser = false, limit = 300 }) {
    const rows = (await fs.query({ collection: 'transactions', where: [['user_id', '==', userId], ['type', '==', type], ['status', '==', status]], limit }))
      .sort((a, b) => b.id - a.id);
    return withUser ? decorateTx(rows) : rows.map(strip);
  },

  // ---------- notifications ----------
  // user_id 0 = every customer. Users carry notif_latest_at / notif_seen_at so the app can show an
  // unread dot from the user doc it already reads, without querying notifications on every poll.
  async sendNotification({ userId = 0, title, body = '', kind = 'info', createdBy = null }) {
    const doc = await fs.runTransaction(async (tx) => {
      const uid = Number(userId) || 0;
      if (uid && !(await tx.get(P.user(uid)))) fail('USER_NOT_FOUND', 404);
      const ids = idAllocator(tx);
      const id = await ids.take('notifications');
      const n = { id, user_id: uid, title, body, kind, created_by: createdBy, created_at: now() };
      tx.create(P.notif(id), n);
      if (uid) tx.update(P.user(uid), { notif_latest_at: n.created_at });
      else tx.set(P.state('notify_broadcast'), { key: 'notify_broadcast', json: JSON.stringify({ at: n.created_at.toISOString() }), updated_at: n.created_at });
      ids.flush();
      return n;
    });
    return strip(toIso(doc));
  },
  async listNotificationsFor(user, limit = 40) {
    const [own, all] = await Promise.all([
      fs.query({ collection: 'notifications', where: [['user_id', '==', Number(user.id)]], limit }),
      fs.query({ collection: 'notifications', where: [['user_id', '==', 0]], limit }),
    ]);
    const joined = new Date(user.created_at || 0).getTime();
    return [...own, ...all.filter((n) => new Date(n.created_at).getTime() >= joined - 86_400_000)]
      .sort((a, b) => b.id - a.id).slice(0, limit).map((n) => strip(toIso(n)));
  },
  async markNotificationsSeen(userId) {
    await fs.commit([fs.W.update(P.user(userId), { notif_seen_at: now() })]);
  },
  async listAllNotifications(limit = 200) {
    const rows = (await fs.query({ collection: 'notifications', limit })).sort((a, b) => b.id - a.id);
    const users = await fs.batchGet([...new Set(rows.filter((n) => n.user_id).map((n) => P.user(n.user_id)))]);
    return rows.map((n) => { const u = (n.user_id && users.get(P.user(n.user_id))) || {}; return { ...strip(toIso(n)), user_email: u.email || null, user_name: u.name || null }; });
  },
  async deleteNotification(id) {
    if (!(await fs.get(P.notif(id)))) fail('NOTIFICATION_NOT_FOUND', 404);
    await fs.commit([fs.W.delete(P.notif(id))]);
  },

  // ---------- orders ----------
  placeOrder: (p) => fs.runTransaction(async (tx) => {
    const [u, m, msRaw] = await Promise.all([tx.get(P.user(p.userId)), tx.get(P.market(p.marketId)), tx.get(P.stats(p.marketId))]);
    if (!u || u.status !== 'active') fail('ACCOUNT_INACTIVE');
    if (!m || !m.enabled) fail('MARKET_CLOSED');
    if (!['long', 'short'].includes(p.side)) fail('INVALID_SIDE');
    if (!['market', 'limit'].includes(p.type)) fail('INVALID_TYPE');
    if (!(p.margin >= m.min_margin)) fail('MARGIN_TOO_SMALL');
    if (!(p.leverage >= 1 && p.leverage <= m.max_leverage)) fail('INVALID_LEVERAGE');
    if (p.type === 'limit' && !(p.limitPrice > 0)) fail('INVALID_LIMIT_PRICE');
    const entry = p.type === 'market' ? p.execPrice : p.limitPrice;
    if (!(entry > 0)) fail('INVALID_PRICE');
    if (p.side === 'long') {
      if (p.tp != null && p.tp <= entry) fail('TP_MUST_BE_ABOVE_ENTRY');
      if (p.sl != null && p.sl >= entry) fail('SL_MUST_BE_BELOW_ENTRY');
    } else {
      if (p.tp != null && p.tp >= entry) fail('TP_MUST_BE_BELOW_ENTRY');
      if (p.sl != null && p.sl <= entry) fail('SL_MUST_BE_ABOVE_ENTRY');
    }
    const margin = r2(p.margin);
    const fee = r2(margin * p.leverage * m.fee_rate);
    if (u.balance < margin + fee) fail('INSUFFICIENT_BALANCE');

    const user = strip(u), ms = strip(msRaw) || {};
    const ids = idAllocator(tx);
    const id = await ids.take('orders');
    const o = {
      id, user_id: Number(p.userId), market_id: Number(p.marketId), side: p.side, type: p.type, margin, leverage: p.leverage,
      size: null, entry_price: null, limit_price: p.type === 'limit' ? p.limitPrice : null, tp: p.tp ?? null, sl: p.sl ?? null,
      liq_price: null, fee, status: 'pending', exit_price: null, pnl: null, result: null, close_reason: null,
      created_at: new Date().toISOString(), opened_at: null, closed_at: null,
    };
    user.balance = r2(user.balance - margin);
    const marginBal = user.balance;
    user.balance = r2(user.balance - fee);
    if (p.type === 'market') settleFill(o, user, ms, p.execPrice, o.created_at);
    writeOrder(tx, o);
    writeUser(tx, user);
    writeStats(tx, p.marketId, ms);
    await newTx(ids, tx, { user_id: user.id, type: 'trade_margin', amount: -margin, balance_after: marginBal, order_id: id, note: `Margin for order #${id}` });
    await newTx(ids, tx, { user_id: user.id, type: 'trade_fee', amount: -fee, balance_after: user.balance, order_id: id, note: `Trading fee for order #${id}` });
    ids.flush();
    return { ...o, symbol: m.symbol, decimals: m.decimals, user_email: user.email, user_name: user.name };
  }).then((o) => (invalidateMarkets(), o)),

  closeOrder: (id, price, reason, userId, at) => fs.runTransaction(async (tx) => {
    const o = strip(await tx.get(P.order(id)));
    if (!o || (userId && o.user_id !== Number(userId))) fail('ORDER_NOT_FOUND', 404);
    if (o.status !== 'open') fail('ORDER_NOT_OPEN');
    if (!(price > 0)) fail('INVALID_PRICE');
    const [u, msRaw] = await Promise.all([tx.get(P.user(o.user_id)), tx.get(P.stats(o.market_id))]);
    const user = strip(u), ms = strip(msRaw) || {};
    const { pnl, payout } = settleClose(o, user, ms, price, reason, at);
    const ids = idAllocator(tx);
    writeOrder(tx, o); writeUser(tx, user); writeStats(tx, o.market_id, ms);
    await newTx(ids, tx, { user_id: user.id, type: 'trade_settle', amount: payout, balance_after: user.balance, order_id: o.id, note: `Settlement order #${o.id} (${reason}, PnL ${pnl})` });
    ids.flush();
    return o;
  }).then(async (o) => (await decorateOrders([o]))[0]),

  cancelOrder: (id, userId) => fs.runTransaction(async (tx) => {
    const o = strip(await tx.get(P.order(id)));
    if (!o || (userId && o.user_id !== Number(userId))) fail('ORDER_NOT_FOUND', 404);
    if (o.status !== 'pending') fail('ORDER_NOT_PENDING');
    const user = strip(await tx.get(P.user(o.user_id)));
    Object.assign(o, { status: 'cancelled', closed_at: new Date().toISOString() });
    user.balance = r2(user.balance + o.margin + o.fee);
    const ids = idAllocator(tx);
    writeOrder(tx, o); writeUser(tx, user);
    await newTx(ids, tx, { user_id: user.id, type: 'order_refund', amount: o.margin + o.fee, balance_after: user.balance, order_id: o.id, note: `Cancelled order #${o.id}` });
    ids.flush();
    return o;
  }).then(async (o) => (await decorateOrders([o]))[0]),

  async getOrder(id) { return strip(await fs.get(P.order(id))); },

  // filters: userId, statuses[], status, result, side, marketId, changedSince (ISO), limit
  async listOrders(f) {
    if (f.changedSince) {
      const u = await fs.get(P.user(f.userId));
      if (!u || !u.orders_changed_at || Date.parse(u.orders_changed_at) <= Date.parse(f.changedSince)) return [];
    }
    let rows = await fs.query({
      collection: 'orders',
      where: [
        ['user_id', '==', f.userId], ['status', f.statuses ? 'in' : '==', f.statuses || f.status],
        ['result', '==', f.result], ['side', '==', f.side], ['market_id', '==', f.marketId],
      ],
      limit: f.changedSince ? 500 : (f.limit || 500),
    });
    if (f.changedSince) {
      const since = Date.parse(f.changedSince);
      rows = rows.filter((o) => (o.closed_at && Date.parse(o.closed_at) > since) || (o.opened_at && Date.parse(o.opened_at) > since));
    }
    rows.sort((a, b) => b.id - a.id);
    return decorateOrders(rows.slice(0, f.limit || 500));
  },
  async activeOrdersForMarket(marketId) {
    return (await fs.query({ collection: 'orders', where: [['market_id', '==', Number(marketId)], ['status', 'in', ['open', 'pending']]] })).map(strip);
  },
  async openPositions() { return (await fs.query({ collection: 'orders', where: [['status', '==', 'open']] })).map(strip); },

  // ---------- markets & candles ----------
  listMarkets: () => marketsList(true),
  insertMarket: (fields) => fs.runTransaction(async (tx) => {
    const ids = idAllocator(tx);
    const id = await ids.take('markets');
    const m = {
      id, symbol: fields.symbol, name: fields.name || fields.base, base: fields.base, quote: fields.quote || 'USDT',
      price: fields.price, volatility: fields.volatility ?? 0.0008, drift: fields.drift ?? 0,
      max_leverage: fields.max_leverage ?? 50, fee_rate: fields.fee_rate ?? 0.0005, min_margin: fields.min_margin ?? 1,
      decimals: fields.decimals ?? 2, enabled: fields.enabled ?? true,
      source: fields.source || 'sim', source_symbol: fields.source_symbol || '', source_url: fields.source_url || '', source_path: fields.source_path || '',
      created_at: now(), updated_at: now(), last_tick_at: now(), day: [],
    };
    tx.create(P.market(id), m);
    tx.set(P.stats(id), { market_id: id, trades: 0, volume: 0, wins: 0, losses: 0, customer_pnl: 0 });
    ids.flush();
    return toIso(m);
  }).then((m) => (invalidateMarkets(), m)),
  async updateMarket(id, fields) {
    await fs.commit([fs.W.update(P.market(id), toDates({ ...fields, updated_at: new Date().toISOString() }))]);
    invalidateMarkets();
    return strip(await fs.get(P.market(id)));
  },
  async setMarketPrice(id, price) {
    await fs.commit([fs.W.update(P.market(id), { price, last_tick_at: now(), updated_at: now() })]);
    invalidateMarkets();
  },
  async lastCandle(marketId) {
    const [h] = await fs.query({ collection: 'candleHours', parent: P.market(marketId), orderBy: [['start', 'desc']], limit: 1 });
    return h && h.k && h.k.length ? h.k[h.k.length - 1] : null;
  },
  async listCandles(marketId, limit) {
    const hours = await fs.query({ collection: 'candleHours', parent: P.market(marketId), orderBy: [['start', 'desc']], limit: Math.ceil(limit / 60) + 1 });
    return hours.flatMap((h) => h.k || []).sort((a, b) => a.t - b.t).slice(-limit);
  },
  async insertCandles(marketId, candles) {
    const groups = groupByHour(candles);
    const paths = [...groups.keys()].map((h) => P.hour(marketId, h));
    const existing = await fs.batchGet(paths);
    const writes = [], summaries = [];
    for (const [h, list] of groups) {
      const doc = mergeHour(existing.get(P.hour(marketId, h)), h, list);
      writes.push(fs.W.set(P.hour(marketId, h), doc));
      summaries.push(hourSummary(h, doc.k));
    }
    await fs.commit(writes);
    const m = await fs.get(P.market(marketId));
    const last = candles.reduce((a, c) => (!a || c.t > a.t ? c : a), null);
    const cur = m.cur && last && m.cur.t > last.t ? m.cur : last;
    await fs.commit([fs.W.update(P.market(marketId), { day: mergeDay(m.day, summaries), cur })]);
    invalidateMarkets();
  },
  async stats24h(markets) {
    const list = markets || await marketsList();
    const cutoff = Date.now() - 24 * HOUR;
    const out = new Map();
    for (const m of list) {
      const day = (m.day || []).filter((d) => d.t + HOUR > cutoff);
      if (!day.length) continue;
      out.set(m.id, { open24h: day[0].o, high24h: Math.max(...day.map((d) => d.h)), low24h: Math.min(...day.map((d) => d.l)), volume24h: r2(day.reduce((s, d) => s + d.v, 0)) });
    }
    return out;
  },
  async pruneCandles(days) {
    const cutoff = Date.now() - days * 86_400_000;
    let n = 0;
    for (const m of await marketsList(true)) {
      const old = await fs.query({ collection: 'candleHours', parent: P.market(m.id), where: [['start', '<', cutoff]], limit: 500 });
      if (old.length) { await fs.commit(old.map((h) => fs.W.delete(h._path))); n += old.length; }
    }
    return n;
  },

  // Commit one engine advance atomically; last_tick_at acts as the optimistic lock.
  applyTick: ({ marketId, expected, newAt, price, candles, events }) => fs.runTransaction(async (tx) => {
    const mdoc = await tx.get(P.market(marketId));
    if (!mdoc || !mdoc.enabled || Date.parse(mdoc.last_tick_at) !== Date.parse(expected)) return { ok: false };
    const groups = groupByHour(candles);
    const orderIds = [...new Set(events.map((e) => e.order_id))];
    const [hours, orderDocs] = await Promise.all([
      tx.batchGet([...groups.keys()].map((h) => P.hour(marketId, h))),
      tx.batchGet(orderIds.map((id) => P.order(id))),
    ]);
    const orders = new Map(orderIds.map((id) => [id, strip(orderDocs.get(P.order(id)))]));
    const userIds = [...new Set([...orders.values()].filter(Boolean).map((o) => o.user_id))];
    const [userDocs, msDoc] = await Promise.all([
      tx.batchGet(userIds.map((id) => P.user(id))),
      events.length ? tx.get(P.stats(marketId)) : null,
    ]);
    const users = new Map(userIds.map((id) => [id, strip(userDocs.get(P.user(id)))]));
    const ms = strip(msDoc) || {};

    // candles + 24h summary
    const summaries = [];
    for (const [h, list] of groups) {
      const doc = mergeHour(hours.get(P.hour(marketId, h)), h, list);
      tx.set(P.hour(marketId, h), doc);
      summaries.push(hourSummary(h, doc.k));
    }
    const lastK = candles.length ? candles[candles.length - 1] : mdoc.cur || null;
    tx.update(P.market(marketId), { price, last_tick_at: new Date(newAt), day: mergeDay(mdoc.day, summaries), cur: lastK });

    // fills / closes, in path order
    const ids = idAllocator(tx);
    const changed = new Map(), touchedUsers = new Set();
    for (const ev of events) {
      const o = orders.get(ev.order_id);
      const u = o && users.get(o.user_id);
      if (!o || !u) continue;
      if (ev.type === 'fill') {
        if (o.status !== 'pending') continue;
        settleFill(o, u, ms, ev.price, ev.at);
      } else {
        if (o.status !== 'open') continue;
        const { pnl, payout } = settleClose(o, u, ms, ev.price, ev.reason, ev.at);
        await newTx(ids, tx, { user_id: u.id, type: 'trade_settle', amount: payout, balance_after: u.balance, order_id: o.id, note: `Settlement order #${o.id} (${ev.reason}, PnL ${pnl})` });
      }
      changed.set(o.id, o); touchedUsers.add(u.id);
    }
    for (const o of changed.values()) writeOrder(tx, o);
    for (const uid of touchedUsers) writeUser(tx, users.get(uid));
    if (changed.size) writeStats(tx, marketId, ms);
    ids.flush();
    return { ok: true, orders: [...changed.values()] };
  }).then(async (res) => {
    if (res.ok) { invalidateMarkets(); res.orders = await decorateOrders(res.orders); }
    return res;
  }),

  // ---------- admin ----------
  async adminStats() {
    let [users, markets, statsDocs, pending, active] = await Promise.all([
      fs.query({ collection: 'users' }),
      marketsList(),
      fs.query({ collection: 'market_stats' }),
      fs.query({ collection: 'transactions', where: [['status', '==', 'pending']] }),
      fs.query({ collection: 'orders', where: [['status', 'in', ['open', 'pending']]] }),
    ]);
    const sum = (arr, f) => r2(arr.reduce((s, x) => s + (Number(x[f]) || 0), 0));
    const demoIds = new Set(users.filter((u) => u.demo).map((u) => Number(u.id)));
    const demoCount = demoIds.size;
    users = users.filter((u) => !u.demo); // practice accounts never count towards the real book
    active = active.filter((o) => !demoIds.has(Number(o.user_id)));
    const customers = users.filter((u) => u.role === 'customer');
    const open = active.filter((o) => o.status === 'open');
    const statsById = new Map(statsDocs.map((s) => [Number(s.market_id), s]));
    return {
      customers: customers.length,
      demo_accounts: demoCount,
      active_customers: customers.filter((u) => u.status === 'active').length,
      customer_balances: sum(customers, 'balance'),
      open_positions: open.length,
      pending_orders: active.length - open.length,
      open_margin: sum(open, 'margin'),
      closed_trades: users.reduce((s, u) => s + (u.trades || 0), 0),
      wins: users.reduce((s, u) => s + (u.wins || 0), 0),
      losses: users.reduce((s, u) => s + (u.losses || 0), 0),
      customer_pnl: sum(users, 'total_pnl'),
      fees: sum(users, 'fees'),
      volume: sum(users, 'volume'),
      pending_deposits: pending.filter((t) => t.type === 'deposit').length,
      pending_withdrawals: pending.filter((t) => t.type === 'withdrawal').length,
      markets: markets.length,
      by_market: markets.map((m) => {
        const s = statsById.get(m.id) || {};
        return { symbol: m.symbol, trades: s.trades || 0, volume: s.volume || 0, wins: s.wins || 0, losses: s.losses || 0, customer_pnl: s.customer_pnl || 0 };
      }).sort((a, b) => b.volume - a.volume),
    };
  },

  // ---------- jobs, state, throttling ----------
  claimJob: (k, seconds) => fs.runTransaction(async (tx) => {
    const d = await tx.get(P.state(k));
    if (d && d.updated_at && Date.now() - Date.parse(d.updated_at) < seconds * 1000) return false;
    tx.set(P.state(k), { key: k, json: d ? d.json : '{}', updated_at: now() });
    return true;
  }),
  async getState(k) { const d = await fs.get(P.state(k)); return d && d.json ? JSON.parse(d.json) : null; },
  setState: (k, value) => fs.runTransaction(async (tx) => {
    const d = await tx.get(P.state(k));
    tx.set(P.state(k), { key: k, json: JSON.stringify(value), updated_at: d && d.updated_at ? new Date(d.updated_at) : new Date(0) });
  }),
  async loginFailureCount(k) {
    const d = await fs.get(`login_failures/${hashKey(k)}`);
    return d ? (d.times || []).filter((t) => t > Date.now() - 15 * MINUTE).length : 0;
  },
  noteLoginFailure: (k) => fs.runTransaction(async (tx) => {
    const path = `login_failures/${hashKey(k)}`;
    const d = await tx.get(path);
    const times = ((d && d.times) || []).filter((t) => t > Date.now() - 15 * MINUTE).concat(Date.now()).slice(-50);
    tx.set(path, { times });
    return times.length;
  }),
};

// The bank account a deposit came from / a withdrawal goes to, frozen at request time.
function bankSnapshot(b) { return b ? { bank_name: b.bank_name, account_name: b.account_name, account_number: b.account_number } : null; }
function hashKey(k) { return crypto.createHash('sha256').update(String(k)).digest('hex').slice(0, 40); }
function toIso(o) {
  const out = { ...o };
  for (const [k, v] of Object.entries(out)) if (v instanceof Date) out[k] = v.toISOString();
  return out;
}
