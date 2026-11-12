// Test stand-in for exchange market-data APIs. Each route returns data in that exchange's real
// format (field order, strings vs numbers, newest-first where the real API does that).
// Control: POST /__set {symbol, price}  ·  POST /__fail {on: true|false}
'use strict';
const http = require('node:http');
const MIN = 60_000;
const state = new Map(); // normalized symbol -> Map(minuteStart -> candle)
let failing = false;
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const KNOWN = /^(BTC|ETH|LIVE|SOL|XBT|GOLD)/;

function series(sym) {
  const k = norm(sym);
  if (!KNOWN.test(k)) return null;
  if (!state.has(k)) {
    const m = new Map(), now = Math.floor(Date.now() / MIN) * MIN, base = 100;
    for (let i = 700; i >= 0; i--) { const p = base + Math.sin(i / 9); m.set(now - i * MIN, { t: now - i * MIN, o: p, h: p + 0.5, l: p - 0.5, c: p, v: 10 }); }
    state.set(k, m);
  }
  return state.get(k);
}
function setPrice(sym, price) {
  const m = series(sym);
  const t = Math.floor(Date.now() / MIN) * MIN;
  const prev = [...m.values()].sort((a, b) => b.t - a.t)[0];
  const cur = m.get(t) || { t, o: prev ? prev.c : price, h: price, l: price, c: price, v: 0 };
  cur.h = Math.max(cur.h, price); cur.l = Math.min(cur.l, price); cur.c = price; cur.v += 1;
  m.set(t, cur);
}
const window = (sym, since, limit) => {
  const m = series(sym);
  if (!m) return null;
  return [...m.values()].filter((c) => c.t >= since).sort((a, b) => a.t - b.t).slice(0, limit);
};
const S = (n) => String(n);

function route(url) {
  const q = url.searchParams, p = url.pathname;
  if (p === '/binance/api/v3/klines') {
    const w = window(q.get('symbol'), Number(q.get('startTime')) || 0, Number(q.get('limit')) || 500);
    if (!w) return [400, { code: -1121, msg: 'Invalid symbol.' }];
    return [200, w.map((c) => [c.t, S(c.o), S(c.h), S(c.l), S(c.c), S(c.v), c.t + MIN - 1, '0', 1, '0', '0', '0'])];
  }
  if (p === '/bybit/v5/market/kline') {
    const w = window(q.get('symbol'), Number(q.get('start')) || 0, Number(q.get('limit')) || 200);
    if (!w) return [200, { retCode: 10001, retMsg: 'Not supported symbols', result: {} }];
    return [200, { retCode: 0, retMsg: 'OK', result: { symbol: q.get('symbol'), category: 'spot', list: w.reverse().map((c) => [S(c.t), S(c.o), S(c.h), S(c.l), S(c.c), S(c.v), '0']) } }];
  }
  if (p === '/okx/api/v5/market/candles') {
    const w = window(q.get('instId'), Date.now() - 300 * MIN, 300);
    if (!w) return [200, { code: '51001', msg: "Instrument ID doesn't exist.", data: [] }];
    return [200, { code: '0', msg: '', data: w.reverse().map((c) => [S(c.t), S(c.o), S(c.h), S(c.l), S(c.c), S(c.v), '0', '0', '1']) }];
  }
  const cb = p.match(/^\/coinbase\/products\/([^/]+)\/candles$/);
  if (cb) {
    const w = window(decodeURIComponent(cb[1]), Date.parse(q.get('start')) || 0, 300);
    if (!w) return [404, { message: 'NotFound' }];
    return [200, w.reverse().map((c) => [c.t / 1000, c.l, c.h, c.o, c.c, c.v])];
  }
  if (p === '/kraken/0/public/OHLC') {
    const w = window(q.get('pair'), (Number(q.get('since')) || 0) * 1000, 720);
    if (!w) return [200, { error: ['EQuery:Unknown asset pair'] }];
    return [200, { error: [], result: { XXBTZUSD: w.map((c) => [c.t / 1000, S(c.o), S(c.h), S(c.l), S(c.c), S(c.c), S(c.v), 3]), last: w.length ? w[w.length - 1].t / 1000 : 0 } }];
  }
  if (p === '/custom/price') {
    const w = window(q.get('sym'), 0, 100000);
    if (!w) return [404, { error: 'unknown' }];
    return [200, { data: { symbol: q.get('sym'), price: w[w.length - 1].c } }];
  }
  return [404, { error: 'not found' }];
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    let status, data;
    if (url.pathname === '/__set') { const b = JSON.parse(body); setPrice(b.symbol, b.price); [status, data] = [200, { ok: true }]; }
    else if (url.pathname === '/__fail') { failing = JSON.parse(body).on; [status, data] = [200, { ok: true }]; }
    else if (failing) [status, data] = [500, { msg: 'maintenance' }];
    else [status, data] = route(url);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  });
}).listen(Number(process.env.EXCHANGE_MOCK_PORT || 8690), () => console.log('exchange mock up'));
