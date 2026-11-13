'use strict';
// Market engine — prices are COMPUTED, not stored.
//
// Why: every stored price tick is a database write (and the reads that go with it). On Firestore's
// free tier that ran out within hours of a page being open. Now nothing is written while markets move;
// the database is touched only when money moves (an order fills or closes) — plus one tiny "markets
// changed?" read every few seconds per server instance.
//
// Simulated markets
//   Each market stores a short list of "segments": { t0, p0, drift, vol, seed }. From t0 the log price
//   takes one random step per second: drift + vol * Z, where Z is a standard normal drawn from a
//   seeded hash of (seed, second). So the price at any second is a pure function of the segment —
//   every server instance computes exactly the same path, at any time, without storing it. Before
//   the first segment the same walk is run backwards, which gives the chart unlimited history.
//   An admin change (price, volatility, drift, pause) appends a new segment starting now.
//
// Live markets (Binance, Bybit, ...): candles come from the exchange and are cached in memory.
//
// Orders: every few seconds (and right before an order is closed or cancelled) each active order is
// walked along its market's price path from the moment it opened. The first second that reaches its
// limit / TP / SL / liquidation price is recorded and settled at that price and time, exactly as if
// someone had been watching. Settlement runs in a transaction that re-checks the order's status, so
// two instances checking at once can never settle the same order twice.
const store = require('./store');
const feeds = require('./feeds');
const config = require('./config');

const SEC = 1000;
const MINUTE = 60_000;
const CHECK_MS = config.orderCheckSeconds * 1000; // how often active orders are re-checked
const REV_MS = config.marketsRevSeconds * 1000;    // how often an instance asks "did any market change?"
const LIVE_PRICE_MS = 3000;                        // live markets: refresh the current minute this often
const LIVE_HISTORY_MS = 10 * MINUTE;               // ... and the full history this often
const MAX_SEGS = 20;
const CHECKPOINT_AFTER = 2 * 86_400_000;           // re-anchor long segments (speed only; same path)

const num = (v) => (v === null || v === undefined ? null : Number(v));
const roundTo = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// ---------- seeded randomness ----------
function mix(a, b, c) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca77) ^ Math.imul((c | 0) + 0x165667b1, 0xc2b2ae3d)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
const unit = (a, b, c) => (mix(a, b, c) + 0.5) / 4294967296; // (0, 1)
// Standard normal for (seed, second) — Box–Muller on two hashed uniforms.
const z = (seed, s) => Math.sqrt(-2 * Math.log(unit(seed, s, 1))) * Math.cos(2 * Math.PI * unit(seed, s, 2));
const randomSeed = () => (Math.random() * 2 ** 31) | 0;
const seedFor = (id) => mix(Number(id) || 0, 12345, 777) & 0x7fffffff;

// Tiny LRU for computed data (closed minutes never change, so they are cached forever-ish).
class Lru {
  constructor(max) { this.max = max; this.map = new Map(); }
  get(k) { const v = this.map.get(k); if (v !== undefined) { this.map.delete(k); this.map.set(k, v); } return v; }
  set(k, v) { this.map.set(k, v); if (this.map.size > this.max) this.map.delete(this.map.keys().next().value); return v; }
}
const blockCache = new Lru(120_000); // `${seed}:${minute}` -> Float64Array(60) cumulative Z of that minute's 60 steps
const anchorCache = new Lru(200_000); // `${segKey}:${minute}` -> log price at the minute's first second
const candleCache = new Lru(120_000); // `${marketKey}:${minute}` -> closed candle

function block(seed, M) {
  const key = `${seed}:${M}`;
  let b = blockCache.get(key);
  if (!b) {
    b = new Float64Array(60);
    let acc = 0;
    for (let j = 0; j < 60; j++) { acc += z(seed, M * 60 + j + 1); b[j] = acc; }
    blockCache.set(key, b);
  }
  return b;
}

// ---------- segments ----------
const segKey = (g) => g._k || (g._k = `${g.seed}:${g.t0}:${g.p0}:${g.drift}:${g.vol}`);
function normalizeSegs(row) {
  let segs = Array.isArray(row.segs) && row.segs.length ? row.segs : null;
  if (!segs) {
    // Markets saved by the old engine: anchor at their last stored price and time.
    const t0 = Math.floor(Date.parse(row.last_tick_at || row.created_at || Date.now()) / SEC) * SEC;
    segs = [{ t0, p0: Number(row.price), drift: Number(row.drift) || 0, vol: Number(row.volatility) || 0, seed: seedFor(row.id) }];
  }
  return segs.map((g) => ({ t0: Number(g.t0), p0: Number(g.p0), drift: Number(g.drift) || 0, vol: Number(g.vol) || 0, seed: Number(g.seed) | 0 }))
    .sort((a, b) => a.t0 - b.t0);
}
// The segment that governs second s: the latest one that started at or before s (else the first).
function segAt(segs, s) {
  let g = segs[0];
  for (let i = 1; i < segs.length; i++) if (segs[i].t0 / SEC <= s) g = segs[i]; else break;
  return g;
}
// Log price at the first second of minute M, under segment g.
function anchorLog(g, M) {
  const key = `${segKey(g)}:${M}`;
  const hit = anchorCache.get(key);
  if (hit !== undefined) return hit;
  const s0 = Math.floor(g.t0 / SEC);
  const A = Math.floor(s0 / 60);
  // log price at minute A's first second: step back from s0 to 60A
  const jA = s0 - A * 60;
  let L = Math.log(g.p0) - (jA * g.drift + (jA > 0 ? g.vol * block(g.seed, A)[jA - 1] : 0));
  anchorCache.set(`${segKey(g)}:${A}`, L);
  if (M === A) return L;
  // walk minute by minute (cached), from the nearest cached anchor if there is one
  const dir = M > A ? 1 : -1;
  let k = A;
  for (let probe = M - dir; probe !== A; probe -= dir) {
    const c = anchorCache.get(`${segKey(g)}:${probe}`);
    if (c !== undefined) { k = probe; L = c; break; }
  }
  while (k !== M) {
    if (dir > 0) { L += 60 * g.drift + g.vol * block(g.seed, k)[59]; k += 1; }
    else { k -= 1; L -= 60 * g.drift + g.vol * block(g.seed, k)[59]; }
    anchorCache.set(`${segKey(g)}:${k}`, L);
  }
  return L;
}
// Price at integer second s.
function priceAtSec(segs, s) {
  const g = segAt(segs, s);
  const M = Math.floor(s / 60), j = s - M * 60;
  const L = anchorLog(g, M) + j * g.drift + (j > 0 ? g.vol * block(g.seed, M)[j - 1] : 0);
  return Math.exp(L);
}
const simPrice = (m, t = Date.now()) => roundTo(priceAtSec(m.segs, Math.floor(t / SEC)), m.decimals + 2);

// One-minute candle for minute M (seconds 60M .. 60M+60, or up to `untilSec` for the current minute).
function simCandle(m, M, untilSec) {
  const last = Math.min(M * 60 + 60, untilSec);
  const closed = last === M * 60 + 60;
  const key = `${m.id}:${m.rev}:${M}`;
  if (closed) { const c = candleCache.get(key); if (c) return c; }
  const d = m.decimals + 2;
  let o = 0, h = -Infinity, l = Infinity, c = 0;
  const g0 = segAt(m.segs, M * 60);
  if (g0 === segAt(m.segs, last)) {
    // whole minute inside one segment: anchor once, then add that minute's cumulative steps
    const L0 = anchorLog(g0, M), b = block(g0.seed, M);
    for (let j = 0; j <= last - M * 60; j++) {
      const p = Math.exp(L0 + j * g0.drift + (j > 0 ? g0.vol * b[j - 1] : 0));
      if (j === 0) o = p;
      if (p > h) h = p;
      if (p < l) l = p;
      c = p;
    }
  } else {
    for (let s = M * 60; s <= last; s++) {
      const p = priceAtSec(m.segs, s);
      if (s === M * 60) o = p;
      if (p > h) h = p;
      if (p < l) l = p;
      c = p;
    }
  }
  const g = segAt(m.segs, M * 60);
  const v = g.vol > 0 ? roundTo((5 + 40 * unit(g.seed, M, 3)) * ((last - M * 60) / 60), 2) : 0;
  const k = { t: M * MINUTE, o: roundTo(o, d), h: roundTo(h, d), l: roundTo(l, d), c: roundTo(c, d), v };
  if (closed) candleCache.set(key, k);
  return k;
}

// ---------- market list (cached per instance; a 1-document "revision" read says when to reload) ----------
let cache = { at: 0, rev: null, list: null, pending: null };
let ordersRev = null;                       // last seen 'orders changed' marker
let activeCache = { rev: undefined, list: [] }; // active orders, re-read only when that marker moves
function normalizeMarket(row) {
  const segs = normalizeSegs(row);
  const g = segs[segs.length - 1];
  return {
    ...row,
    id: Number(row.id), fee_rate: Number(row.fee_rate), min_margin: Number(row.min_margin), max_leverage: Number(row.max_leverage),
    decimals: Number(row.decimals), segs, rev: row.updated_at ? Date.parse(row.updated_at) || 0 : 0,
    volatility: row.enabled === false && row.paused_params ? Number(row.paused_params.vol) : g.vol,
    drift: row.enabled === false && row.paused_params ? Number(row.paused_params.drift) : g.drift,
    live_checked_at: row.live_checked_at ? Date.parse(row.live_checked_at) : 0,
  };
}
async function getMarkets({ fresh = false, checkRev = false } = {}) {
  if (!fresh && !checkRev && cache.list && Date.now() - cache.at < REV_MS) return cache.list;
  if (cache.pending) return cache.pending;
  cache.pending = (async () => {
    const revs = await store.marketsRev();
    ordersRev = revs.orders;
    if (!fresh && cache.list && revs.rev === cache.rev) { cache.at = Date.now(); return cache.list; }
    const rows = await store.listMarkets();
    cache = { at: Date.now(), rev: revs.rev, list: rows.map(normalizeMarket), pending: null };
    return cache.list;
  })().finally(() => { cache.pending = null; });
  return cache.pending;
}
function invalidate() { cache = { at: 0, rev: null, list: null, pending: null }; }
async function getMarket(id, opts) { return (await getMarkets(opts)).find((m) => m.id === Number(id)) || null; }
async function bySymbol(symbol, opts) { return (await getMarkets(opts)).find((m) => m.symbol === symbol) || null; }

// ---------- live markets: exchange candles cached in memory ----------
const live = new Map(); // id -> { candles: [], at, priceAt, key, pending }
const feedErrors = new Map();
const liveKey = (m) => `${m.source}|${m.source_symbol}|${m.source_url}|${m.source_path}`;
function mergeCandles(list, add) {
  const byT = new Map(list.map((c) => [c.t, c]));
  for (const c of add) {
    const prev = byT.get(c.t);
    byT.set(c.t, prev && c.point ? { ...prev, h: Math.max(prev.h, c.c), l: Math.min(prev.l, c.c), c: c.c } : (c.point ? { ...c, point: undefined } : c));
  }
  return [...byT.values()].sort((a, b) => a.t - b.t).slice(-1500);
}
async function liveCandles(m, { need = 0, maxAge = LIVE_PRICE_MS } = {}) {
  let e = live.get(m.id);
  if (!e || e.key !== liveKey(m)) { e = { candles: [], at: 0, priceAt: 0, key: liveKey(m), pending: null }; live.set(m.id, e); }
  const now = Date.now();
  const first = e.candles.length ? e.candles[0].t : Infinity;
  const wantHistory = now - e.at > LIVE_HISTORY_MS || (need && need < first);
  const wantPrice = now - e.priceAt > maxAge;
  if (!wantHistory && !wantPrice) return e.candles;
  if (!e.pending) {
    e.pending = (async () => {
      try {
        const since = wantHistory ? Math.min(need || Infinity, now - 1440 * MINUTE) : now - 2 * MINUTE;
        const got = await feeds.fetchCandles(m, since);
        e.candles = mergeCandles(e.candles, got);
        if (wantHistory) e.at = now;
        e.priceAt = now;
        feedErrors.delete(m.id);
      } catch (err) {
        feedErrors.set(m.id, { message: err.message, at: new Date().toISOString() });
        if (!e.candles.length) throw err;
      } finally { e.pending = null; }
      return e.candles;
    })();
  }
  return e.pending;
}

// ---------- prices & candles (public) ----------
// Price to execute at: live markets ask the exchange again unless the cached price is under a second old.
async function priceOf(m) {
  if (!feeds.isLive(m)) return simPrice(m);
  const list = await liveCandles(m, { maxAge: 1000 });
  if (!list.length || feedErrors.has(m.id)) {
    const f = feedErrors.get(m.id);
    throw new feeds.FeedError(f ? f.message : 'no price yet');
  }
  return list[list.length - 1].c;
}
// Current price of every market (live markets fall back to their last known price during an outage).
async function prices(list) {
  list = list || (await getMarkets());
  const out = new Map();
  await Promise.all(list.map(async (m) => {
    if (!feeds.isLive(m)) { out.set(m.id, simPrice(m)); return; }
    try { const c = await liveCandles(m); if (c.length) out.set(m.id, c[c.length - 1].c); } catch { /* unknown for now */ }
  }));
  return out;
}
async function candles(m, limit = 500) {
  limit = Math.max(1, Math.min(1500, limit));
  if (feeds.isLive(m)) return (await liveCandles(m).catch(() => [])).slice(-limit);
  const nowSec = Math.floor(Date.now() / SEC);
  const curM = Math.floor(nowSec / 60);
  const out = [];
  for (let M = curM - limit + 1; M <= curM; M++) out.push(simCandle(m, M, nowSec));
  return out;
}
async function quote(m) {
  const k = (await candles(m, 1))[0];
  return k ? { p: k.c, k } : null;
}

function stats(list) {
  if (!list.length) return null;
  const since = Date.now() - 1440 * MINUTE;
  const day = list.filter((c) => c.t >= since);
  const use = day.length ? day : list;
  let h = -Infinity, l = Infinity, v = 0;
  for (const c of use) { if (c.h > h) h = c.h; if (c.l < l) l = c.l; v += c.v || 0; }
  return { open: use[0].o, high: h, low: l, volume: v, last: list[list.length - 1].c };
}
async function publicMarkets({ includeDisabled = false } = {}) {
  const list = (await getMarkets()).filter((m) => includeDisabled || m.enabled);
  return Promise.all(list.map(async (m) => {
    let st = null;
    try { st = stats(await candles(m, 1440)); } catch { /* live outage */ }
    const price = st ? st.last : null;
    const open = st ? st.open : price;
    return {
      id: m.id, symbol: m.symbol, name: m.name, base: m.base, quote: m.quote, price,
      decimals: m.decimals, max_leverage: m.max_leverage, fee_rate: m.fee_rate, min_margin: m.min_margin,
      enabled: m.enabled, change24h: price && open ? (price - open) / open : 0,
      high24h: st ? st.high : price, low24h: st ? st.low : price, volume24h: st ? roundTo(st.volume, 2) : 0,
      source: m.source || 'sim',
      ...(includeDisabled ? {
        volatility: m.volatility, drift: m.drift, source_symbol: m.source_symbol || '', source_url: m.source_url || '',
        source_path: m.source_path || '', feed_error: feedErrors.get(m.id) || null,
      } : {}),
    };
  }));
}

// ---------- order triggers ----------
function normalizeOrder(o) {
  const out = { ...o };
  for (const k of ['id', 'user_id', 'market_id', 'margin', 'leverage', 'size', 'entry_price', 'limit_price', 'tp', 'sl', 'liq_price', 'fee', 'exit_price', 'pnl']) out[k] = num(o[k]);
  return out;
}
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
// Could this order react anywhere inside a minute whose prices span [lo, hi]?
function reachable(o, lo, hi) {
  if (o.done) return false;
  const long = o.side === 'long';
  if (o.status === 'pending') return long ? lo <= o.limit_price : hi >= o.limit_price;
  // long: liquidation / stop below, take-profit above; short: the mirror image
  const down = long ? [o.liq_price, o.sl] : [o.tp];
  const up = long ? [o.tp] : [o.liq_price, o.sl];
  return down.some((x) => x != null && lo <= x) || up.some((x) => x != null && hi >= x);
}
const inRange = (book, lo, hi) => book.some((o) => reachable(o, lo, hi));

function checkPoint(book, t, price, events) {
  for (const o of book) {
    if (o.done || t <= o.since) continue;
    const trig = triggerFor(o, price);
    if (!trig) continue;
    const at = new Date(t).toISOString();
    if (trig.type === 'fill') {
      events.push({ type: 'fill', order_id: o.id, price: trig.price, at });
      o.status = 'open'; o.entry_price = trig.price; o.size = (o.margin * o.leverage) / trig.price;
      o.liq_price = liqPrice(o.side, trig.price, o.leverage); o.since = t;
    } else {
      events.push({ type: 'close', order_id: o.id, price: trig.price, reason: trig.reason, at });
      o.done = true;
    }
  }
}
// Walk a simulated market's path second by second from `from` (ms) to `to`, skipping quiet minutes.
function walkSim(m, book, from, to, events) {
  const s1 = Math.floor(to / SEC);
  for (let M = Math.floor(Math.floor(from / SEC) / 60); M * 60 <= s1; M++) {
    const k = simCandle(m, M, s1);
    if (!inRange(book, k.l, k.h)) continue;
    for (let s = Math.max(M * 60, Math.floor(from / SEC)); s <= Math.min(M * 60 + 60, s1); s++) {
      checkPoint(book, s * SEC, priceAtSec(m.segs, s), events);
    }
    if (book.every((o) => o.done)) return;
  }
}
// Live market: walk each exchange candle open -> nearer extreme -> farther extreme -> close. In the
// minute an order opened only that candle's close counts, so a high/low from before it can't trigger it.
function walkLive(list, book, from, to, events) {
  for (const c of list) {
    if (c.t + MINUTE <= from) continue;
    const end = Math.min(c.t + MINUTE - 1, to);
    const path = c.c >= c.o ? [c.o, c.l, c.h] : [c.o, c.h, c.l];
    path.forEach((p, i) => {
      const t = c.t + Math.round(((i + 1) / 4) * (end - c.t));
      checkPoint(book.filter((o) => o.since < c.t), t, p, events);
    });
    checkPoint(book, end, c.c, events);
  }
}

// Check (and settle) every active order on the given markets. Safe to run on many instances at once.
async function settleMarkets(list, active) {
  const settled = [];
  const now = Date.now();
  for (const m of list) {
    const rows = active.filter((o) => Number(o.market_id) === m.id);
    if (!rows.length || !m.enabled) continue;
    const book = rows.map((r) => { const o = normalizeOrder(r); o.since = Date.parse(o.opened_at || o.created_at); return o; });
    const events = [];
    try {
      if (feeds.isLive(m)) {
        const from = Math.max(Math.min(...book.map((o) => o.since)), m.live_checked_at || 0);
        const list2 = await liveCandles(m, { need: from });
        walkLive(list2, book, from, now, events);
        if (!events.length && now - (m.live_checked_at || 0) > 10 * MINUTE) {
          // remember how far we've checked, so an order open for days isn't re-walked from the start
          const at = now - 2 * MINUTE;
          m.live_checked_at = at;
          await store.updateMarketQuiet(m.id, { live_checked_at: new Date(at).toISOString() });
        }
      } else {
        walkSim(m, book, Math.min(...book.map((o) => o.since)), now, events);
      }
    } catch (e) {
      console.error(`[engine] checking ${m.symbol}:`, e.message);
      continue;
    }
    if (!events.length) continue;
    events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const res = await store.settleEvents(m.id, events);
    settled.push(...(res.orders || []).map(normalizeOrder));
  }
  return settled;
}

let lastCheck = 0, checking = null;
// Called by most API requests; actually checks at most every CHECK_MS per instance.
async function settleDue({ force = false } = {}) {
  if (checking) return checking;
  if (!force && Date.now() - lastCheck < CHECK_MS) return [];
  lastCheck = Date.now();
  checking = (async () => {
    const list = await getMarkets({ checkRev: true }); // never check orders against stale market settings
    await checkpoint(list);
    if (activeCache.rev !== ordersRev || ordersRev === 0) activeCache = { rev: ordersRev, list: await store.activeOrders() };
    if (!activeCache.list.length) return [];
    const settled = await settleMarkets(list, activeCache.list);
    if (settled.length) activeCache = { rev: undefined, list: [] }; // reload next time
    return settled;
  })().finally(() => { checking = null; });
  return checking;
}
// Right before a user closes / cancels: settle this market first so a TP/SL that already hit wins.
async function settleMarket(id) {
  const m = await getMarket(id);
  if (!m) return [];
  return settleMarkets([m], await store.activeOrdersForMarket(m.id));
}

// Long-running segments: re-anchor (same seed and parameters, so the path is unchanged) so that
// computing today's price doesn't walk through months of seconds after a cold start.
async function checkpoint(list) {
  for (const m of list) {
    if (feeds.isLive(m)) continue;
    const g = m.segs[m.segs.length - 1];
    if (Date.now() - g.t0 < CHECKPOINT_AFTER) continue;
    const t0 = Math.floor(Date.now() / MINUTE) * MINUTE;
    const seg = { ...g, t0, p0: priceAtSec(m.segs, t0 / SEC) };
    m.segs = [...m.segs, seg].slice(-MAX_SEGS);
    await store.updateMarketQuiet(m.id, { segs: m.segs }).catch((e) => console.error('[engine] checkpoint', e.message));
  }
}

// ---------- admin changes ----------
// New segment list for a simulated market after an admin change (price / volatility / drift / pause).
function nextSegs(m, { price, volatility, drift, paused } = {}) {
  const now = Math.floor(Date.now() / SEC) * SEC; // from the current second
  const cur = m.segs[m.segs.length - 1];
  const p0 = price !== undefined ? price : priceAtSec(m.segs, now / SEC);
  const seg = {
    t0: now, p0,
    vol: paused ? 0 : (volatility !== undefined ? volatility : cur.vol),
    drift: paused ? 0 : (drift !== undefined ? drift : cur.drift),
    seed: randomSeed(),
  };
  return [...m.segs.filter((g) => g.t0 < now), seg].slice(-MAX_SEGS);
}
// Starting segments for a new market.
const firstSegs = ({ price, volatility = 0.0008, drift = 0 }) => [{ t0: Math.floor(Date.now() / SEC) * SEC, p0: price, vol: volatility, drift, seed: randomSeed() }];

module.exports = {
  getMarkets, getMarket, bySymbol, invalidate, normalizeMarket, normalizeOrder, triggerFor,
  priceOf, prices, candles, quote, publicMarkets, settleDue, settleMarket, nextSegs, firstSegs, feedErrors,
  // for tests
  _simPrice: simPrice,
};
