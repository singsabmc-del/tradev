'use strict';
// Real market prices from public exchange APIs (no API keys needed), plus a generic
// "custom JSON URL" source for anything else (forex, metals, stocks, your own API).
// Every adapter returns ascending 1-minute candles: [{ t (ms), o, h, l, c, v }].
const MINUTE = 60_000;
const env = process.env;

// Base URLs can be overridden (tests use a local mock).
const BASE = {
  // Binance's market-data mirror also works from regions where api.binance.com answers 451.
  binance: env.FEED_URL_BINANCE || 'https://data-api.binance.vision',
  bybit: env.FEED_URL_BYBIT || 'https://api.bybit.com',
  okx: env.FEED_URL_OKX || 'https://www.okx.com',
  coinbase: env.FEED_URL_COINBASE || 'https://api.exchange.coinbase.com',
  kraken: env.FEED_URL_KRAKEN || 'https://api.kraken.com',
};

// Shown in the admin form.
const SOURCES = {
  sim: { label: 'Simulated', example: '' },
  binance: { label: 'Binance', example: 'BTCUSDT', maxMinutes: 1000 },
  bybit: { label: 'Bybit', example: 'BTCUSDT', maxMinutes: 1000 },
  okx: { label: 'OKX', example: 'BTC-USDT', maxMinutes: 300 },
  coinbase: { label: 'Coinbase', example: 'BTC-USD', maxMinutes: 300 },
  kraken: { label: 'Kraken', example: 'XBTUSD', maxMinutes: 720 },
  custom: { label: 'Custom JSON URL', example: '', maxMinutes: 0 },
};
const isLive = (m) => Boolean(m && m.source && m.source !== 'sim');

class FeedError extends Error {}

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'TradeV/1.0' }, signal: AbortSignal.timeout(8000) });
  } catch (e) {
    throw new FeedError(`cannot reach ${new URL(url).host}: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new FeedError(`${new URL(url).host} returned HTTP ${res.status} (not JSON)`); }
  if (res.status === 451 || res.status === 403) throw new FeedError(`${new URL(url).host} blocked this server's region (HTTP ${res.status})`);
  if (!res.ok) throw new FeedError(`${new URL(url).host} HTTP ${res.status}: ${(data && (data.msg || data.message || data.retMsg)) || text.slice(0, 120)}`);
  return data;
}

const num = (v) => { const n = Number(v); if (!Number.isFinite(n)) throw new FeedError('unexpected number in response'); return n; };
const candle = (t, o, h, l, c, v) => ({ t: Number(t), o: num(o), h: num(h), l: num(l), c: num(c), v: Number(v) || 0 });
const ascending = (list) => list.filter((c) => c.c > 0).sort((a, b) => a.t - b.t);
const enc = encodeURIComponent;

const ADAPTERS = {
  async binance(symbol, since) {
    const rows = await getJson(`${BASE.binance}/api/v3/klines?symbol=${enc(symbol)}&interval=1m&startTime=${since}&limit=1000`);
    if (!Array.isArray(rows)) throw new FeedError(rows.msg || 'unexpected Binance response');
    return rows.map((r) => candle(r[0], r[1], r[2], r[3], r[4], r[5]));
  },
  async bybit(symbol, since) {
    const d = await getJson(`${BASE.bybit}/v5/market/kline?category=spot&symbol=${enc(symbol)}&interval=1&start=${since}&limit=1000`);
    if (d.retCode !== 0) throw new FeedError(d.retMsg || 'Bybit error');
    return (d.result.list || []).map((r) => candle(r[0], r[1], r[2], r[3], r[4], r[5]));
  },
  async okx(symbol, since) {
    const d = await getJson(`${BASE.okx}/api/v5/market/candles?instId=${enc(symbol)}&bar=1m&limit=300`);
    if (d.code !== '0') throw new FeedError(d.msg || 'OKX error');
    return (d.data || []).map((r) => candle(r[0], r[1], r[2], r[3], r[4], r[5])).filter((c) => c.t >= since);
  },
  async coinbase(symbol, since) {
    const start = new Date(Math.max(since, Date.now() - 299 * MINUTE)).toISOString();
    const rows = await getJson(`${BASE.coinbase}/products/${enc(symbol)}/candles?granularity=60&start=${start}&end=${new Date().toISOString()}`);
    if (!Array.isArray(rows)) throw new FeedError(rows.message || 'unexpected Coinbase response');
    // [time (s), low, high, open, close, volume]
    return rows.map((r) => candle(r[0] * 1000, r[3], r[2], r[1], r[4], r[5]));
  },
  async kraken(symbol, since) {
    const d = await getJson(`${BASE.kraken}/0/public/OHLC?pair=${enc(symbol)}&interval=1&since=${Math.floor(since / 1000) - 1}`);
    if (d.error && d.error.length) throw new FeedError(d.error.join(', '));
    const key = Object.keys(d.result || {}).find((k) => k !== 'last');
    if (!key) throw new FeedError('Kraken returned no data for this pair');
    // [time (s), open, high, low, close, vwap, volume, count]
    return d.result[key].map((r) => candle(r[0] * 1000, r[1], r[2], r[3], r[4], r[6])).filter((c) => c.t >= since);
  },
};

// "data.price", "quotes.0.last", "price" ... ; also accepts "$.data.price"
function pick(obj, path) {
  let cur = obj;
  for (const part of String(path || '').replace(/^\$\.?/, '').split('.').filter(Boolean)) {
    if (cur === null || cur === undefined) break;
    cur = cur[/^\d+$/.test(part) ? Number(part) : part];
  }
  return cur;
}

async function customPrice(url, path) {
  if (!/^https:\/\//i.test(url || '') && !(env.FEED_ALLOW_HTTP === '1' && /^http:\/\//i.test(url || ''))) throw new FeedError('Custom URL must start with https://');
  const data = await getJson(url);
  const p = Number(path ? pick(data, path) : data);
  if (!Number.isFinite(p) || p <= 0) throw new FeedError(`no positive number at "${path || '(whole response)'}"`);
  return p;
}

// Candles for a market from `since` (ms) to now, ascending. Custom URLs give one live point.
async function fetchCandles(m, since) {
  if (m.source === 'custom') {
    const p = await customPrice(m.source_url, m.source_path);
    return [{ t: Math.floor(Date.now() / MINUTE) * MINUTE, o: p, h: p, l: p, c: p, v: 0, point: true }];
  }
  const adapter = ADAPTERS[m.source];
  if (!adapter) throw new FeedError(`unknown price source "${m.source}"`);
  if (!m.source_symbol) throw new FeedError('missing source symbol');
  const max = SOURCES[m.source].maxMinutes;
  const from = Math.max(Math.floor(since / MINUTE) * MINUTE, Math.floor((Date.now() - (max - 1) * MINUTE) / MINUTE) * MINUTE);
  return ascending(await adapter(m.source_symbol, from));
}

// Check a source config and return its latest price (used by the admin "Test" button and on save).
async function test(cfg) {
  const m = { source: cfg.source, source_symbol: cfg.source_symbol, source_url: cfg.source_url, source_path: cfg.source_path };
  const list = await fetchCandles(m, Date.now() - 120 * MINUTE);
  if (!list.length) throw new FeedError('the source returned no prices — check the symbol');
  return { price: list[list.length - 1].c, candles: list.length };
}

// Decimals that suit a price, e.g. 70321.5 -> 1, 3450.12 -> 2, 1.0842 -> 5
function decimalsFor(p) {
  if (p >= 10000) return 1;
  if (p >= 10) return 2;
  if (p >= 1) return 4;
  if (p >= 0.01) return 5;
  return 8;
}

module.exports = { SOURCES, BASE, isLive, fetchCandles, test, pick, decimalsFor, FeedError, MINUTE };
