'use strict';
// Stateless "catch-up" market engine — works on serverless platforms (Vercel) with no
// background process.
//
// Each market row stores its price at `last_tick_at`. advance(market) simulates every
// second from last_tick_at to now (geometric random walk using the admin's volatility
// and drift), builds the 1-minute candles, and walks every open/pending order along that
// path. The first time an order's limit / TP / SL / liquidation price is touched, an event
// is recorded with that price and timestamp. Everything is committed with one call to
// apply_tick(), which uses last_tick_at as an optimistic lock: if another instance already
// advanced the market, this attempt is discarded and the fresh state is read instead.
// So orders settle at the right price and time even if nobody had the site open.
const store = require('./store');
const config = require('./config');

const MINUTE = 60_000;
const MAX_STEPS = 3600;          // per advance; long idle gaps use coarser steps
const MIN_MS = config.advanceMinSeconds * 1000;
const CACHE_MS = Math.min(MIN_MS, 3000);

const num = (v) => (v === null || v === undefined ? null : Number(v));
const roundTo = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
function gaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function normalizeMarket(row) {
  return {
    ...row,
    id: Number(row.id), price: Number(row.price), volatility: Number(row.volatility), drift: Number(row.drift),
    fee_rate: Number(row.fee_rate), min_margin: Number(row.min_margin), max_leverage: Number(row.max_leverage),
    decimals: Number(row.decimals),
  };
}
function normalizeOrder(o) {
  const out = { ...o };
  for (const k of ['id', 'user_id', 'market_id', 'margin', 'leverage', 'size', 'entry_price', 'limit_price', 'tp', 'sl', 'liq_price', 'fee', 'exit_price', 'pnl']) out[k] = num(o[k]);
  return out;
}

// ---------- market cache (per warm instance, very short-lived) ----------
let cache = { at: 0, list: null, pending: null };
async function getMarkets({ fresh = false } = {}) {
  if (!fresh && cache.list && Date.now() - cache.at < CACHE_MS) return cache.list;
  if (!fresh && cache.pending) return cache.pending;
  cache.pending = store.listMarkets().then((rows) => {
    cache = { at: Date.now(), list: rows.map(normalizeMarket), pending: null };
    return cache.list;
  }).catch((e) => { cache.pending = null; throw e; });
  return cache.pending;
}
function invalidate() { cache = { at: 0, list: null, pending: null }; }
function remember(m) {
  if (!cache.list) return;
  const i = cache.list.findIndex((x) => x.id === m.id);
  if (i >= 0) cache.list[i] = m;
}
async function getMarket(id, opts) { return (await getMarkets(opts)).find((m) => m.id === Number(id)) || null; }
async function bySymbol(symbol, opts) { return (await getMarkets(opts)).find((m) => m.symbol === symbol) || null; }

// ---------- order triggers ----------
function triggerFor(o, price) {
  if (o.status === 'pending') {
    if (o.side === 'long' && price <= o.limit_price) return { type: 'fill', price: o.limit_price };
    if (o.side === 'short' && price >= o.limit_price) return { type: 'fill', price: o.limit_price };
    return null;
  }
  const long = o.side === 'long';
  if (o.liq_price != null && (long ? price <= o.liq_price : price >= o.liq_price)) return { type: 'close', reason: 'liquidation', price: o.liq_price };
  if (o.sl != null && (long ? price <= o.sl : price >= o.sl)) return { type: 'close', reason: 'sl', price: o.sl };
  if (o.tp != null && (long ? price >= o.tp : price <= o.tp)) return { type: 'close', reason: 'tp', price: o.tp };
  return null;
}
const liqPrice = (side, entry, lev) => (side === 'long' ? entry * (1 - 1 / lev) : entry * (1 + 1 / lev));

// ---------- advance one market to "now" ----------
const inflight = new Map(); // de-duplicate concurrent advances inside one instance
function advance(m, { now = Date.now() } = {}) {
  if (!m || !m.enabled) return Promise.resolve({ market: m, orders: [] });
  if (now - Date.parse(m.last_tick_at) < MIN_MS) return Promise.resolve({ market: m, orders: [] });
  if (inflight.has(m.id)) return inflight.get(m.id);
  const p = doAdvance(m, now).finally(() => inflight.delete(m.id));
  inflight.set(m.id, p);
  return p;
}

async function doAdvance(m, now) {
  const start = Date.parse(m.last_tick_at);
  const gap = now - start;
  const [last, active] = await Promise.all([m.cur || store.lastCandle(m.id), store.activeOrdersForMarket(m.id)]);
  const steps = Math.max(1, Math.min(MAX_STEPS, Math.floor(gap / 1000)));
  const dtMs = gap / steps;
  const dt = dtMs / 1000;
  const sig = m.volatility * Math.sqrt(dt);
  const mu = m.drift * dt;
  const prec = m.decimals + 2;

  const touched = [];
  let cur = last ? { ...last } : null;
  const book = active.map((o) => {
    const n = normalizeOrder(o);
    n.since = Date.parse(n.opened_at || n.created_at);
    return n;
  });
  const events = [];
  let price = m.price;

  for (let i = 1; i <= steps; i++) {
    const t = start + i * dtMs;
    price = roundTo(price * Math.exp(mu + sig * gaussian()), prec);
    if (!(price > 0)) price = m.price;
    const bucket = Math.floor(t / MINUTE) * MINUTE;
    if (!cur || cur.t !== bucket) {
      if (cur && cur.t > bucket) { /* clock skew: keep writing into the newest candle */ }
      else {
        cur = { t: bucket, o: cur ? cur.c : m.price, h: price, l: price, c: price, v: 0 };
        touched.push(cur);
      }
    }
    if (!touched.includes(cur)) touched.push(cur);
    cur.c = price; cur.h = Math.max(cur.h, price); cur.l = Math.min(cur.l, price);
    cur.v = roundTo(cur.v + Math.random() * 2 * Math.min(dt, 60), 2);

    for (const o of book) {
      if (o.done || t <= o.since) continue;
      const trig = triggerFor(o, price);
      if (!trig) continue;
      const at = new Date(t).toISOString();
      if (trig.type === 'fill') {
        events.push({ type: 'fill', order_id: o.id, price: trig.price, at });
        // continue tracking as an open position from this moment (TP/SL may hit later in this window)
        o.status = 'open'; o.entry_price = trig.price; o.size = (o.margin * o.leverage) / trig.price;
        o.liq_price = liqPrice(o.side, trig.price, o.leverage); o.since = t;
      } else {
        events.push({ type: 'close', order_id: o.id, price: trig.price, reason: trig.reason, at });
        o.done = true;
      }
    }
  }

  const newAt = new Date(now).toISOString();
  const res = await store.applyTick({ marketId: m.id, expected: m.last_tick_at, newAt, price, candles: touched, events });
  if (!res || !res.ok) {
    // Someone else advanced first — use their result.
    const fresh = await getMarket(m.id, { fresh: true });
    return { market: fresh, orders: [], lastCandle: null };
  }
  const updated = { ...m, price, last_tick_at: newAt };
  remember(updated);
  return { market: updated, orders: (res.orders || []).map(normalizeOrder), lastCandle: cur };
}

async function advanceAll() {
  const list = await getMarkets();
  const results = await Promise.all(list.map((m) => advance(m).catch((e) => {
    console.error(`[engine] advance ${m.symbol} failed:`, e.message);
    return { market: m, orders: [] };
  })));
  return results;
}

async function advanceOne(id) {
  const m = await getMarket(id, { fresh: true });
  if (!m) return null;
  return (await advance(m)).market;
}

// ---------- history for new markets ----------
async function backfill(m, count = 600) {
  const now = Math.floor(Date.now() / MINUTE) * MINUTE;
  const sigma = m.volatility * Math.sqrt(60);
  const out = [];
  let close = m.price;
  for (let i = 0; i < count; i++) {
    const t = now - i * MINUTE;
    const open = close / Math.exp(sigma * gaussian());
    const hi = Math.max(open, close) * (1 + Math.abs(gaussian()) * sigma * 0.5);
    const lo = Math.min(open, close) * (1 - Math.abs(gaussian()) * sigma * 0.5);
    out.push({ t, o: open, h: hi, l: lo, c: close, v: Math.round(5 + Math.random() * 40) });
    close = open;
  }
  out.reverse();
  const d = m.decimals + 2;
  await store.insertCandles(m.id, out.map((c) => ({ ...c, o: roundTo(c.o, d), h: roundTo(c.h, d), l: roundTo(c.l, d), c: roundTo(c.c, d) })));
}

// Seeded markets from the migration have no history yet: give them some on first use.
async function ensureHistory() {
  const list = await getMarkets({ fresh: true });
  for (const m of list) {
    if (!(await store.lastCandle(m.id))) await backfill(m);
  }
}

// ---------- read helpers ----------
const candles = (marketId, limit = 500) => store.listCandles(marketId, limit);

async function publicMarkets({ includeDisabled = false } = {}) {
  const list = await getMarkets();
  const byId = await store.stats24h(list);
  return list.filter((m) => includeDisabled || m.enabled).map((m) => {
    const s = byId.get(m.id) || {};
    const open = num(s.open24h) || m.price;
    return {
      id: m.id, symbol: m.symbol, name: m.name, base: m.base, quote: m.quote, price: m.price,
      decimals: m.decimals, max_leverage: m.max_leverage, fee_rate: m.fee_rate, min_margin: m.min_margin,
      enabled: m.enabled, change24h: (m.price - open) / open,
      high24h: Math.max(num(s.high24h) ?? m.price, m.price), low24h: Math.min(num(s.low24h) ?? m.price, m.price),
      volume24h: num(s.volume24h) || 0,
      ...(includeDisabled ? { volatility: m.volatility, drift: m.drift } : {}),
    };
  });
}

module.exports = {
  getMarkets, getMarket, bySymbol, invalidate, advance, advanceAll, advanceOne, backfill, ensureHistory,
  candles, publicMarkets, normalizeOrder, normalizeMarket, triggerFor,
};
