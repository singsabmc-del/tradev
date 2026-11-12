'use strict';
// Market engine: simulates live prices (geometric random walk with admin-controlled
// volatility & drift), builds 1-minute candles, and watches orders for limit fills,
// take-profit, stop-loss and liquidation. All balance changes go through Postgres
// functions so they stay atomic even if the engine and an API call race.
const { EventEmitter } = require('node:events');
const db = require('./supabase');
const config = require('./config');

const MINUTE = 60_000;
const MAX_CANDLES = 1500;
const events = new EventEmitter();
events.setMaxListeners(0);

const markets = new Map(); // id -> market (+ price, candles)
const orders = new Map();  // id -> open/pending order
let tickCount = 0;
let timer = null;

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
    id: Number(row.id),
    price: Number(row.price),
    volatility: Number(row.volatility),
    drift: Number(row.drift),
    fee_rate: Number(row.fee_rate),
    min_margin: Number(row.min_margin),
    max_leverage: Number(row.max_leverage),
    decimals: Number(row.decimals),
  };
}

function normalizeOrder(o) {
  const out = { ...o };
  for (const k of ['id', 'user_id', 'market_id', 'margin', 'leverage', 'size', 'entry_price', 'limit_price', 'tp', 'sl', 'liq_price', 'fee', 'exit_price', 'pnl']) {
    out[k] = num(o[k]);
  }
  return out;
}

async function loadCandles(m) {
  const rows = await db.select('candles', {
    filters: [['market_id', 'eq', m.id]], order: 'ts.desc', limit: MAX_CANDLES,
  });
  m.candles = rows.reverse().map((r) => ({ t: Date.parse(r.ts), o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v }));
  if (m.candles.length < 120) await backfill(m);
  m.price = m.candles.length ? m.candles[m.candles.length - 1].c : m.price;
}

// Generate plausible history so a brand-new market has a chart.
async function backfill(m) {
  const count = 600;
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
  for (const c of out) { c.o = roundTo(c.o, d); c.h = roundTo(c.h, d); c.l = roundTo(c.l, d); c.c = roundTo(c.c, d); }
  const existing = new Set((m.candles || []).map((c) => c.t));
  const fresh = out.filter((c) => !existing.has(c.t));
  for (let i = 0; i < fresh.length; i += 200) {
    await db.insert('candles', fresh.slice(i, i + 200).map((c) => toRow(m.id, c)), { onConflict: 'market_id,ts' });
  }
  m.candles = [...fresh, ...(m.candles || [])].sort((a, b) => a.t - b.t).slice(-MAX_CANDLES);
}

const toRow = (marketId, c) => ({ market_id: marketId, ts: new Date(c.t).toISOString(), o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });

async function addMarket(row) {
  const m = normalizeMarket(row);
  m.candles = [];
  markets.set(m.id, m);
  await loadCandles(m);
  return m;
}

function applyMarket(row) {
  const m = markets.get(Number(row.id));
  if (!m) return addMarket(row);
  const prevPrice = m.price;
  Object.assign(m, normalizeMarket(row), { candles: m.candles });
  if (Number(row.price) !== prevPrice) setPrice(m, Number(row.price));
  else m.price = prevPrice;
  return m;
}

function setPrice(m, price) {
  m.price = price;
  const bucket = Math.floor(Date.now() / MINUTE) * MINUTE;
  let last = m.candles[m.candles.length - 1];
  if (!last || last.t !== bucket) {
    last = { t: bucket, o: last ? last.c : price, h: price, l: price, c: price, v: 0 };
    if (m.candles.length && m.candles[m.candles.length - 1].t > bucket) return; // clock skew guard
    m.candles.push(last);
    if (m.candles.length > MAX_CANDLES) m.candles.shift();
    m.closedCandle = m.candles[m.candles.length - 2];
  }
  last.c = price;
  last.h = Math.max(last.h, price);
  last.l = Math.min(last.l, price);
}

function tick() {
  tickCount++;
  const dt = config.tickMs / 1000;
  const prices = {};
  for (const m of markets.values()) {
    if (!m.enabled) continue;
    const ret = m.drift * dt + m.volatility * Math.sqrt(dt) * gaussian();
    const price = roundTo(m.price * Math.exp(ret), m.decimals + 2);
    setPrice(m, price);
    const last = m.candles[m.candles.length - 1];
    last.v = roundTo(last.v + Math.random() * 2, 2);
    prices[m.symbol] = { p: price, k: last };
    checkOrders(m);
  }
  events.emit('tick', { t: Date.now(), prices });
  if (tickCount % 5 === 0) persist().catch((e) => console.error('[engine] persist failed:', e.message));
}

async function persist() {
  const candleRows = [];
  for (const m of markets.values()) {
    if (!m.enabled || !m.candles.length) continue;
    candleRows.push(toRow(m.id, m.candles[m.candles.length - 1]));
    if (m.closedCandle) { candleRows.push(toRow(m.id, m.closedCandle)); m.closedCandle = null; }
    await db.update('markets', { price: m.price, updated_at: new Date().toISOString() }, [['id', 'eq', m.id]]);
  }
  if (candleRows.length) await db.insert('candles', candleRows, { onConflict: 'market_id,ts' });
}

function triggerFor(o, price) {
  if (o.status === 'pending') {
    if (o.side === 'long' && price <= o.limit_price) return { action: 'fill', price: o.limit_price };
    if (o.side === 'short' && price >= o.limit_price) return { action: 'fill', price: o.limit_price };
    return null;
  }
  const long = o.side === 'long';
  if (o.liq_price != null && (long ? price <= o.liq_price : price >= o.liq_price)) return { action: 'close', reason: 'liquidation', price: o.liq_price };
  if (o.sl != null && (long ? price <= o.sl : price >= o.sl)) return { action: 'close', reason: 'sl', price: o.sl };
  if (o.tp != null && (long ? price >= o.tp : price <= o.tp)) return { action: 'close', reason: 'tp', price: o.tp };
  return null;
}

function checkOrders(m) {
  for (const o of orders.values()) {
    if (o.market_id !== m.id || o.busy) continue;
    const t = triggerFor(o, m.price);
    if (!t) continue;
    o.busy = true;
    const p = t.action === 'fill'
      ? db.rpc('fill_limit_order', { p_order: o.id, p_price: t.price })
      : db.rpc('close_order', { p_order: o.id, p_price: t.price, p_reason: t.reason });
    p.then((row) => {
      if (!row) { orders.delete(o.id); return; }
      const updated = normalizeOrder(row);
      if (updated.status === 'open') orders.set(updated.id, updated); else orders.delete(updated.id);
      events.emit('order', updated);
    }).catch((e) => {
      if (/ORDER_NOT_OPEN|ORDER_NOT_FOUND/.test(e.message)) orders.delete(o.id);
      else { console.error(`[engine] order ${o.id} ${t.action} failed:`, e.message); o.busy = false; }
    });
  }
}

function track(order) {
  const o = normalizeOrder(order);
  if (o.status === 'open' || o.status === 'pending') orders.set(o.id, o); else orders.delete(o.id);
  events.emit('order', o);
  return o;
}

async function start() {
  const rows = await db.select('markets', { order: 'id.asc' });
  for (const r of rows) await addMarket(r);
  const active = await db.select('orders', { filters: [['status', 'in', ['open', 'pending']]] });
  for (const o of active) orders.set(Number(o.id), normalizeOrder(o));
  timer = setInterval(tick, config.tickMs);
  console.log(`[engine] ${markets.size} markets, ${orders.size} active orders, tick ${config.tickMs}ms`);
}

function stop() { if (timer) clearInterval(timer); timer = null; }

function change24h(m) {
  const since = Date.now() - 24 * 3600_000;
  const ref = m.candles.find((c) => c.t >= since) || m.candles[0];
  return ref ? (m.price - ref.o) / ref.o : 0;
}

function publicMarket(m) {
  const day = m.candles.filter((c) => c.t >= Date.now() - 24 * 3600_000);
  return {
    id: m.id, symbol: m.symbol, name: m.name, base: m.base, quote: m.quote, price: m.price,
    decimals: m.decimals, max_leverage: m.max_leverage, fee_rate: m.fee_rate, min_margin: m.min_margin,
    enabled: m.enabled, change24h: change24h(m),
    high24h: day.length ? Math.max(...day.map((c) => c.h)) : m.price,
    low24h: day.length ? Math.min(...day.map((c) => c.l)) : m.price,
    volume24h: day.reduce((s, c) => s + c.v, 0),
  };
}

module.exports = {
  events, markets, orders, start, stop, track, addMarket, applyMarket, publicMarket, normalizeOrder,
  bySymbol: (s) => [...markets.values()].find((m) => m.symbol === s),
  candles: (id, limit = 500) => (markets.get(id)?.candles || []).slice(-limit),
  // exposed for tests
  _triggerFor: triggerFor,
};
