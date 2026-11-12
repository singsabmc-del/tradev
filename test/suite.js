// End-to-end API suite against the Firestore REST stand-in (scripts/firestore-mock.js).
// Two app instances are started on the same database to mimic serverless. No setup needed.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP_PORT = 56000 + (process.pid % 1000);
const URL_ = `http://127.0.0.1:${APP_PORT}`;
const SHEET_PORT = 57000 + (process.pid % 1000);
const MOCK_PORT = 58000 + (process.pid % 1000);
const EX_PORT = 59000 + (process.pid % 1000);
const EX = `http://127.0.0.1:${EX_PORT}`;
const fkey = (id) => String(9_999_999_999 - Number(id)).padStart(10, '0');
const procs = [];
const sheetPayloads = [];
let sheetServer;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(150); }
  throw new Error('timed out');
}

async function call(pathname, { method = 'GET', body, token } = {}) {
  const res = await fetch(URL_ + pathname, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

let admin, alice;

before(async () => {
  procs.push(spawn('node', [path.join(ROOT, 'scripts/firestore-mock.js')], { env: { ...process.env, MOCK_PORT }, stdio: 'ignore' }));
  await waitFor(() => fetch(`http://127.0.0.1:${MOCK_PORT}/`).then(() => true));
  procs.push(spawn('node', [path.join(__dirname, 'exchange-mock.js')], { env: { ...process.env, EXCHANGE_MOCK_PORT: EX_PORT }, stdio: 'ignore' }));
  await waitFor(() => fetch(`${EX}/x`).then(() => true));

  // Fake Google Apps Script web app: POST /exec answers 302 -> GET /echo (like the real one)
  sheetServer = require('node:http').createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/exec') {
        sheetPayloads.push(JSON.parse(b));
        res.writeHead(302, { location: '/echo' }); return res.end();
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true,"rows":6}');
    });
  }).listen(SHEET_PORT);

  const appEnv = (port) => ({
    ...process.env,
    FIRESTORE_EMULATOR_HOST: `127.0.0.1:${MOCK_PORT}`, FIREBASE_PROJECT_ID: 'demo-tradev', FIREBASE_SERVICE_ACCOUNT: '', FEED_ALLOW_HTTP: '1',
    FEED_URL_BINANCE: `${EX}/binance`, FEED_URL_BYBIT: `${EX}/bybit`, FEED_URL_OKX: `${EX}/okx`, FEED_URL_COINBASE: `${EX}/coinbase`, FEED_URL_KRAKEN: `${EX}/kraken`,
    JWT_SECRET: 'test-secret', ADMIN_EMAIL: 'admin@test.io', ADMIN_PASSWORD: 'AdminPass123', PORT: port, STARTING_BALANCE: '1000',
    CRON_SECRET: 'cron-secret', LOCAL_TICK_MS: '0', ADVANCE_MIN_SECONDS: '1',
    SHEETS_WEBHOOK_URL: `http://127.0.0.1:${SHEET_PORT}/exec`, SHEETS_SECRET: 'sheet-secret', SHEETS_SYNC_SECONDS: '1', SHEETS_INCLUDE_STATS: 'true',
  });
  // Two independent app instances on the same database = two serverless instances.
  procs.push(spawn('node', [path.join(ROOT, 'server/index.js')], { env: appEnv(APP_PORT), stdio: process.env.DEBUG ? 'inherit' : 'ignore' }));
  procs.push(spawn('node', [path.join(ROOT, 'server/index.js')], { env: appEnv(APP_PORT + 1), stdio: 'ignore' }));
  await waitFor(() => call('/api/markets').then((r) => r.status === 200 && r.data.length), 20000);
  await waitFor(() => fetch(`http://127.0.0.1:${APP_PORT + 1}/api/health`).then((r) => r.ok), 20000);

  admin = (await call('/api/auth/login', { method: 'POST', body: { email: 'admin@test.io', password: 'AdminPass123' } })).data.token;
  alice = (await call('/api/auth/register', { method: 'POST', body: { email: 'alice@test.io', name: 'Alice', password: 'alicepass1' } })).data.token;
  assert.ok(admin && alice);
  // customers must have a bank account before deposits, withdrawals and trading
  const b = await call('/api/me/bank', { method: 'PUT', token: alice, body: { bank_name: 'Kasikornbank', account_name: 'Alice Test', account_number: '123-4-56789-0' } });
  assert.equal(b.status, 200, JSON.stringify(b.data));
});

after(() => {
  for (const p of procs) p.kill();
  sheetServer.close();
});

const me = async (t) => (await call('/api/me', { token: t })).data;
const setPrice = (symbol, price) => call('/api/admin/markets', { token: admin }).then(({ data }) => {
  const m = data.find((x) => x.symbol === symbol);
  return call(`/api/admin/markets/${m.id}`, { method: 'PATCH', token: admin, body: { price, volatility: 0, drift: 0 } });
});

test('registration gives the starting balance; duplicate email is rejected', async () => {
  assert.equal((await me(alice)).balance, 1000);
  const dup = await call('/api/auth/register', { method: 'POST', body: { email: 'ALICE@test.io', name: 'A2', password: 'whatever12' } });
  assert.equal(dup.status, 400);
  const bad = await call('/api/auth/login', { method: 'POST', body: { email: 'alice@test.io', password: 'nope' } });
  assert.equal(bad.status, 401);
});

test('customers cannot use admin endpoints; anonymous users cannot trade', async () => {
  assert.equal((await call('/api/admin/users', { token: alice })).status, 403);
  assert.equal((await call('/api/orders', { method: 'POST', body: {} })).status, 401);
});

test('market long: open, close in profit -> win, balance settles exactly', async () => {
  await setPrice('ETH/USDT', 3000);
  const o = (await call('/api/orders', { method: 'POST', token: alice, body: { symbol: 'ETH/USDT', side: 'long', type: 'market', margin: 100, leverage: 10 } })).data;
  assert.equal(o.status, 'open');
  assert.equal(o.entry_price, 3000);
  assert.equal(o.fee, 0.5); // 100*10*0.0005
  assert.equal((await me(alice)).balance, 899.5);
  await setPrice('ETH/USDT', 3030); // +1% * 10x = +10
  const c = await call(`/api/orders/${o.id}/close`, { method: 'POST', token: alice });
  assert.equal(c.status, 200);
  assert.equal(c.data.pnl, 10);
  assert.equal(c.data.result, 'win');
  assert.equal((await me(alice)).balance, 1009.5);
  assert.equal((await call(`/api/orders/${o.id}/close`, { method: 'POST', token: alice })).status, 400); // already closed
});

test('short closed at a loss -> lose', async () => {
  await setPrice('ETH/USDT', 3000);
  const o = (await call('/api/orders', { method: 'POST', token: alice, body: { symbol: 'ETH/USDT', side: 'short', type: 'market', margin: 50, leverage: 5 } })).data;
  await setPrice('ETH/USDT', 3060); // +2% against a 5x short = -5
  const c = (await call(`/api/orders/${o.id}/close`, { method: 'POST', token: alice })).data;
  assert.equal(c.pnl, -5);
  assert.equal(c.result, 'lose');
});

test('take profit triggers automatically', async () => {
  await setPrice('SOL/USDT', 100);
  const o = (await call('/api/orders', { method: 'POST', token: alice, body: { symbol: 'SOL/USDT', side: 'long', type: 'market', margin: 20, leverage: 10, tp: 102, sl: 95 } })).data;
  await setPrice('SOL/USDT', 103);
  const closed = await waitFor(async () => (await call('/api/orders?scope=history', { token: alice })).data.find((x) => x.id === o.id));
  assert.equal(closed.close_reason, 'tp');
  assert.equal(closed.exit_price, 102);
  assert.equal(closed.pnl, 4);
  assert.equal(closed.result, 'win');
});

test('liquidation caps the loss at the margin', async () => {
  await setPrice('BNB/USDT', 500);
  const before = (await me(alice)).balance;
  const o = (await call('/api/orders', { method: 'POST', token: alice, body: { symbol: 'BNB/USDT', side: 'long', type: 'market', margin: 10, leverage: 50 } })).data;
  await setPrice('BNB/USDT', 400);
  const closed = await waitFor(async () => (await call('/api/orders?scope=history', { token: alice })).data.find((x) => x.id === o.id));
  assert.equal(closed.close_reason, 'liquidation');
  assert.equal(closed.pnl, -10);
  assert.equal(closed.result, 'lose');
  assert.equal(Math.round(((await me(alice)).balance - (before - 10 - o.fee)) * 100), 0);
});

test('limit order fills when price crosses, and pending orders can be cancelled for a refund', async () => {
  await setPrice('XAU/USD', 2000);
  const lim = (await call('/api/orders', { method: 'POST', token: alice, body: { symbol: 'XAU/USD', side: 'long', type: 'limit', margin: 10, leverage: 10, limitPrice: 1990 } })).data;
  assert.equal(lim.status, 'pending');
  await setPrice('XAU/USD', 1985);
  const filled = await waitFor(async () => (await call('/api/orders?scope=active', { token: alice })).data.find((x) => x.id === lim.id && x.status === 'open'));
  assert.equal(filled.entry_price, 1990);
  await call(`/api/orders/${lim.id}/close`, { method: 'POST', token: alice });

  const bal = (await me(alice)).balance;
  const p = (await call('/api/orders', { method: 'POST', token: alice, body: { symbol: 'XAU/USD', side: 'short', type: 'limit', margin: 30, leverage: 2, limitPrice: 2500 } })).data;
  assert.equal(Math.round(((await me(alice)).balance - (bal - 30 - p.fee)) * 100), 0);
  const c = await call(`/api/orders/${p.id}/cancel`, { method: 'POST', token: alice });
  assert.equal(c.data.status, 'cancelled');
  assert.equal((await me(alice)).balance, bal);
});

test('validation: insufficient balance, bad leverage, wrong-side TP', async () => {
  const big = await call('/api/orders', { method: 'POST', token: alice, body: { symbol: 'ETH/USDT', side: 'long', type: 'market', margin: 999999, leverage: 2 } });
  assert.equal(big.status, 400); assert.match(big.data.error, /Insufficient/);
  const lev = await call('/api/orders', { method: 'POST', token: alice, body: { symbol: 'ETH/USDT', side: 'long', type: 'market', margin: 10, leverage: 500 } });
  assert.equal(lev.status, 400);
  const tp = await call('/api/orders', { method: 'POST', token: alice, body: { symbol: 'ETH/USDT', side: 'long', type: 'market', margin: 10, leverage: 2, tp: 1 } });
  assert.equal(tp.status, 400); assert.match(tp.data.error, /Take profit/);
});

test('wallet: withdrawal is held then refunded on reject; deposit credited on approve', async () => {
  const b0 = (await me(alice)).balance;
  const w = (await call('/api/wallet/withdraw', { method: 'POST', token: alice, body: { amount: 100 } })).data;
  assert.equal(w.status, 'pending');
  assert.equal((await me(alice)).balance, Math.round((b0 - 100) * 100) / 100);
  const rej = await call(`/api/admin/transactions/${w.id}/reject`, { method: 'POST', token: admin });
  assert.equal(rej.data.status, 'rejected');
  assert.equal((await me(alice)).balance, b0);
  assert.equal((await call(`/api/admin/transactions/${w.id}/approve`, { method: 'POST', token: admin })).status, 400);

  const d = (await call('/api/wallet/deposit', { method: 'POST', token: alice, body: { amount: 250 } })).data;
  assert.equal((await me(alice)).balance, b0);
  await call(`/api/admin/transactions/${d.id}/approve`, { method: 'POST', token: admin });
  assert.equal((await me(alice)).balance, Math.round((b0 + 250) * 100) / 100);
});

test('admin: customer list with win/lose stats, detail, adjust balance, suspend', async () => {
  const users = (await call('/api/admin/users?q=alice', { token: admin })).data;
  assert.equal(users.length, 1);
  const u = users[0];
  assert.ok(u.wins === 2 && u.losses === 3, `wins ${u.wins} losses ${u.losses}`);
  const detail = (await call(`/api/admin/users/${u.id}`, { token: admin })).data;
  assert.ok(detail.orders.length >= 6 && detail.transactions.length > 5);

  const adj = (await call(`/api/admin/users/${u.id}/adjust`, { method: 'POST', token: admin, body: { amount: -50, note: 'correction' } })).data;
  assert.equal(adj.balance, Math.round((u.balance - 50) * 100) / 100);
  const tooMuch = await call(`/api/admin/users/${u.id}/adjust`, { method: 'POST', token: admin, body: { amount: -1e9 } });
  assert.equal(tooMuch.status, 400);

  await call(`/api/admin/users/${u.id}`, { method: 'PATCH', token: admin, body: { status: 'suspended' } });
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'alice@test.io', password: 'alicepass1' } })).status, 403);
  await call(`/api/admin/users/${u.id}`, { method: 'PATCH', token: admin, body: { status: 'active' } });
});

test('admin: order history filters by result, stats add up', async () => {
  const wins = (await call('/api/admin/orders?result=win', { token: admin })).data;
  const losses = (await call('/api/admin/orders?result=lose', { token: admin })).data;
  assert.ok(wins.every((o) => o.result === 'win') && losses.every((o) => o.result === 'lose'));
  const s = (await call('/api/admin/stats', { token: admin })).data;
  assert.equal(s.wins, wins.length);
  assert.equal(s.losses, losses.length);
  assert.equal(s.customers, 1);
});

test('admin: create, edit and disable markets; force-close a position', async () => {
  const created = await call('/api/admin/markets', { method: 'POST', token: admin, body: { symbol: 'doge/usdt', name: 'Dogecoin', price: 0.15, decimals: 5, max_leverage: 20 } });
  assert.equal(created.status, 200);
  assert.equal(created.data.symbol, 'DOGE/USDT');
  const candles = (await call('/api/candles?symbol=DOGE/USDT')).data;
  assert.ok(candles.length >= 120, 'new market has backfilled history');

  const o = (await call('/api/orders', { method: 'POST', token: alice, body: { symbol: 'DOGE/USDT', side: 'long', type: 'market', margin: 5, leverage: 20 } })).data;
  const fc = await call(`/api/admin/orders/${o.id}/close`, { method: 'POST', token: admin });
  assert.equal(fc.data.close_reason, 'admin');

  await call(`/api/admin/markets/${created.data.id}`, { method: 'PATCH', token: admin, body: { enabled: false } });
  assert.ok(!(await call('/api/markets')).data.find((m) => m.symbol === 'DOGE/USDT'));
  const closedMkt = await call('/api/orders', { method: 'POST', token: alice, body: { symbol: 'DOGE/USDT', side: 'long', type: 'market', margin: 5, leverage: 2 } });
  assert.equal(closedMkt.status, 400);
});

test('ledger integrity: balance equals the sum of completed/held transactions', async () => {
  const u = (await call('/api/admin/users?q=alice', { token: admin })).data[0];
  const { transactions } = (await call(`/api/admin/users/${u.id}`, { token: admin })).data;
  const sum = transactions.filter((t) => t.status === 'completed' || (t.status === 'pending' && t.type === 'withdrawal'))
    .reduce((s, t) => s + t.amount, 0);
  assert.equal(Math.round(sum * 100), Math.round(u.balance * 100));
});

test('Google Sheets sync sends public market data only, never customer data', async () => {
  assert.equal((await call('/api/cron?key=wrong')).status, 401);
  const cron = await call('/api/cron?key=cron-secret');
  assert.equal(cron.status, 200);
  await waitFor(() => sheetPayloads.length >= 1);
  await sleep(1100);
  await call('/api/ticker'); // any visitor can trigger the (claimed, rate-limited) sync
  await waitFor(() => sheetPayloads.length >= 2);
  const p = sheetPayloads[sheetPayloads.length - 1];
  assert.equal(p.secret, 'sheet-secret');
  assert.ok(p.markets.length >= 6);
  const btc = p.markets.find((m) => m.symbol === 'BTC/USDT');
  assert.ok(btc.price > 0 && typeof btc.change24h === 'number' && btc.high24h >= btc.low24h);
  assert.equal(p.stats.customers, 1);
  const raw = JSON.stringify(p);
  for (const leak of ['alice', '@test.io', 'balance', 'password', 'email']) assert.ok(!raw.includes(leak), `payload leaks "${leak}"`);

  const s = (await call('/api/admin/stats', { token: admin })).data.sheets;
  assert.ok(s.enabled && s.lastOk && !s.lastError);
  const manual = await call('/api/admin/sheets/sync', { method: 'POST', token: admin });
  assert.equal(manual.status, 200);
  assert.equal((await call('/api/admin/sheets/sync', { method: 'POST', token: alice })).status, 403);
});

// Simulate "nobody touched this market for N minutes" (and the order having been opened then).
async function backdate({ orderId, marketId, minutes, price }) {
  const at = { timestampValue: new Date(Date.now() - minutes * 60_000).toISOString() };
  const root = 'projects/demo-tradev/databases/(default)/documents';
  const res = await fetch(`http://127.0.0.1:${MOCK_PORT}/v1/${root}:commit`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ writes: [
      { update: { name: `${root}/orders/${fkey(orderId)}`, fields: { opened_at: at, created_at: at } }, updateMask: { fieldPaths: ['opened_at', 'created_at'] } },
      { update: { name: `${root}/markets/${fkey(marketId)}`, fields: { last_tick_at: at, price: { doubleValue: price } } }, updateMask: { fieldPaths: ['last_tick_at', 'price'] } },
    ] }),
  });
  assert.equal(res.status, 200, await res.text());
}

const setMarket = async (symbol, fields) => {
  const { data } = await call('/api/admin/markets', { token: admin });
  const m = data.find((x) => x.symbol === symbol);
  const r = await call(`/api/admin/markets/${m.id}`, { method: 'PATCH', token: admin, body: fields });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return m.id;
};

test('ticker is CDN-cacheable and returns live prices', async () => {
  const res = await fetch(URL_ + '/api/ticker');
  assert.match(res.headers.get('cache-control'), /s-maxage=1/);
  const t = await res.json();
  assert.ok(t.prices['BTC/USDT'].p > 0 && t.prices['BTC/USDT'].k.t > 0);
});

test('catch-up: a TP that hit while nobody was online settles at its price and time', async () => {
  const id = await setMarket('BNB/USDT', { price: 500, volatility: 0, drift: 0.0005 });
  const o = (await call('/api/orders', { method: 'POST', token: alice, body: { symbol: 'BNB/USDT', side: 'long', type: 'market', margin: 10, leverage: 2, tp: 525 } })).data;
  assert.equal(o.entry_price, 500);
  // Pretend the order was opened 10 minutes ago and no request has touched the market since.
  await backdate({ orderId: o.id, marketId: id, minutes: 10, price: 500 });
  await sleep(1100); // let the instance's 1s market cache expire (a real idle gap is much longer)
  const hist = (await call('/api/orders?scope=history', { token: alice })).data; // first request after the gap
  const c = hist.find((x) => x.id === o.id);
  assert.ok(c, 'order settled on the first request after the gap');
  assert.equal(c.close_reason, 'tp');
  assert.equal(c.exit_price, 525);
  const ago = (Date.now() - Date.parse(c.closed_at)) / 1000;
  assert.ok(ago > 420 && ago < 560, `closed ${ago}s ago, expected ≈ 502s (when +5% was reached)`);
  const candles = (await call('/api/candles?symbol=BNB/USDT&limit=30')).data.filter((k) => k.t > Date.now() - 11 * 60_000);
  assert.ok(candles.length >= 10, `history filled in: ${candles.length} candles`);
  await setMarket('BNB/USDT', { drift: 0, volatility: 0.0004 });
});

test('two instances advancing the same market at once never double-settle', async () => {
  const id = await setMarket('SOL/USDT', { price: 100, volatility: 0, drift: 0.0005 });
  const o = (await call('/api/orders', { method: 'POST', token: alice, body: { symbol: 'SOL/USDT', side: 'short', type: 'market', margin: 10, leverage: 5, sl: 103 } })).data;
  await backdate({ orderId: o.id, marketId: id, minutes: 5, price: 100 });
  await sleep(1100);
  const other = `http://127.0.0.1:${APP_PORT + 1}`;
  await Promise.all(Array.from({ length: 12 }, (_, i) => fetch((i % 2 ? other : URL_) + '/api/ticker')));
  const u = (await call('/api/admin/users?q=alice', { token: admin })).data[0];
  const { transactions, orders } = (await call(`/api/admin/users/${u.id}`, { token: admin })).data;
  const settles = transactions.filter((t) => t.order_id === o.id && t.type === 'trade_settle');
  assert.equal(settles.length, 1, 'settled exactly once');
  const closed = orders.find((x) => x.id === o.id);
  assert.equal(closed.close_reason, 'sl');
  assert.equal(closed.exit_price, 103);
  await setMarket('SOL/USDT', { drift: 0, volatility: 0.0006 });
});

test('login throttling is shared across instances', async () => {
  for (let i = 0; i < 10; i++) {
    const base = i % 2 ? `http://127.0.0.1:${APP_PORT + 1}` : URL_;
    await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nobody@test.io', password: 'x' }) });
  }
  const r = await call('/api/auth/login', { method: 'POST', body: { email: 'nobody@test.io', password: 'x' } });
  assert.equal(r.status, 429);
});

// ---------------- live price sources ----------------
const exSet = (symbol, price) => fetch(`${EX}/__set`, { method: 'POST', body: JSON.stringify({ symbol, price }) });
const exFail = (on) => fetch(`${EX}/__fail`, { method: 'POST', body: JSON.stringify({ on }) });
const liveId = async (symbol) => (await call('/api/admin/markets', { token: admin })).data.find((m) => m.symbol === symbol).id;

test('admin can test every exchange source and a custom JSON URL', async () => {
  await exSet('BTCUSDT', 70100); await exSet('BTC-USDT', 70200); await exSet('BTC-USD', 70300); await exSet('XBTUSD', 70400); await exSet('GOLD', 2650.5);
  const cases = [
    [{ source: 'binance', source_symbol: 'BTCUSDT' }, 70200], [{ source: 'bybit', source_symbol: 'BTCUSDT' }, 70200], // same series as BTC-USDT in the mock
    [{ source: 'okx', source_symbol: 'BTC-USDT' }, 70200], [{ source: 'coinbase', source_symbol: 'BTC-USD' }, 70300],
    [{ source: 'kraken', source_symbol: 'XBTUSD' }, 70400],
    [{ source: 'custom', source_url: `${EX}/custom/price?sym=GOLD`, source_path: 'data.price' }, 2650.5],
  ];
  for (const [body, price] of cases) {
    const r = await call('/api/admin/feeds/test', { method: 'POST', token: admin, body });
    assert.equal(r.status, 200, `${body.source}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.price, price, body.source);
  }
  const bad = await call('/api/admin/feeds/test', { method: 'POST', token: admin, body: { source: 'binance', source_symbol: 'NOPEUSDT' } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /Binance/);
  assert.equal((await call('/api/admin/feeds/test', { method: 'POST', token: alice, body: { source: 'binance', source_symbol: 'BTCUSDT' } })).status, 403);
});

test('live market: created from the exchange with real history, price follows the exchange', async () => {
  await exSet('LIVEUSDT', 250);
  const r = await call('/api/admin/markets', { method: 'POST', token: admin, body: { symbol: 'LIVE/USDT', name: 'Live coin', source: 'binance', source_symbol: 'LIVEUSDT', max_leverage: 20 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.price, 250);
  assert.equal(r.data.source, 'binance');
  assert.equal(r.data.decimals, 2);
  assert.ok((await call('/api/candles?symbol=LIVE/USDT&limit=1000')).data.length >= 600, 'real history imported');
  await exSet('LIVEUSDT', 262.5);
  await sleep(1100);
  const t = await waitFor(async () => { const d = (await call('/api/ticker')).data; return d.prices['LIVE/USDT'].p === 262.5 && d; });
  assert.equal(t.prices['LIVE/USDT'].k.c, 262.5);
  const manual = await call(`/api/admin/markets/${r.data.id}`, { method: 'PATCH', token: admin, body: { price: 1 } });
  assert.equal(manual.status, 400);
  assert.match(manual.data.error, /Binance/);
});

test('live market: TP uses the exchange high; extremes from before the order opened are ignored', async () => {
  await exSet('LIVEUSDT', 180); await exSet('LIVEUSDT', 200); // this minute already dipped to 180
  await sleep(1100);
  const o = (await call('/api/orders', { method: 'POST', token: alice, body: { symbol: 'LIVE/USDT', side: 'long', type: 'market', margin: 10, leverage: 5, sl: 190, tp: 210 } })).data;
  assert.equal(o.entry_price, 200);
  await sleep(1100);
  let active = (await call('/api/orders?scope=active', { token: alice })).data;
  assert.ok(active.find((x) => x.id === o.id && x.status === 'open'), 'not stopped out by the low from before it opened');
  await exSet('LIVEUSDT', 215);
  await sleep(1100);
  const closed = await waitFor(async () => (await call('/api/orders?scope=history', { token: alice })).data.find((x) => x.id === o.id));
  assert.equal(closed.close_reason, 'tp');
  assert.equal(closed.exit_price, 210);
});

test('switching an existing market to a live source and back', async () => {
  await exSet('ETHUSDT', 3333);
  const id = await liveId('ETH/USDT');
  const r = await call(`/api/admin/markets/${id}`, { method: 'PATCH', token: admin, body: { source: 'binance', source_symbol: 'ETHUSDT' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.price, 3333);
  const back = await call(`/api/admin/markets/${id}`, { method: 'PATCH', token: admin, body: { source: 'sim' } });
  assert.equal(back.data.source, 'sim');
  assert.equal((await call(`/api/admin/markets/${id}`, { method: 'PATCH', token: admin, body: { price: 3000, volatility: 0, drift: 0 } })).status, 200);
});

test('exchange outage: site keeps working, orders on that market are refused with a clear message', async () => {
  await exFail(true);
  await sleep(1100);
  try {
    const t = await call('/api/ticker');
    assert.equal(t.status, 200);
    const o = await call('/api/orders', { method: 'POST', token: alice, body: { symbol: 'LIVE/USDT', side: 'long', type: 'market', margin: 10, leverage: 2 } });
    assert.equal(o.status, 503);
    assert.match(o.data.error, /Live price unavailable/);
    const m = (await call('/api/admin/markets', { token: admin })).data.find((x) => x.symbol === 'LIVE/USDT');
    assert.ok(m.feed_error && m.feed_error.message);
  } finally { await exFail(false); }
});

// ---------------- bank accounts ----------------
test('no bank account: deposit, withdrawal and trading are refused with BANK_REQUIRED', async () => {
  const bob = (await call('/api/auth/register', { method: 'POST', body: { email: 'bob@test.io', name: 'Bob', password: 'bobpass12' } })).data.token;
  const me = (await call('/api/me', { token: bob })).data;
  assert.equal(me.has_bank, false);
  for (const [path, body] of [
    ['/api/orders', { symbol: 'BTC/USDT', side: 'long', type: 'market', margin: 10, leverage: 2 }],
    ['/api/wallet/deposit', { amount: 100 }], ['/api/wallet/withdraw', { amount: 10 }],
  ]) {
    const r = await call(path, { method: 'POST', token: bob, body });
    assert.equal(r.status, 403, path);
    assert.equal(r.data.code, 'BANK_REQUIRED', path);
  }
  const bad = await call('/api/me/bank', { method: 'PUT', token: bob, body: { bank_name: 'X', account_name: 'Bob', account_number: '12' } });
  assert.equal(bad.status, 400);
  const ok = await call('/api/me/bank', { method: 'PUT', token: bob, body: { bank_name: 'ABA Bank', account_name: 'Bob Builder', account_number: '000 123 456' } });
  assert.equal(ok.data.has_bank, true);
  assert.equal(ok.data.bank.account_number, '•••• 3456', 'customer sees a masked number');
  const o = await call('/api/orders', { method: 'POST', token: bob, body: { symbol: 'BTC/USDT', side: 'long', type: 'market', margin: 10, leverage: 2 } });
  assert.equal(o.status, 200);
  await call(`/api/orders/${o.data.id}/close`, { method: 'POST', token: bob });
});

test('withdrawals record the bank account; admin sees full details and can edit or remove them', async () => {
  const w = (await call('/api/wallet/withdraw', { method: 'POST', token: alice, body: { amount: 5 } })).data;
  assert.equal(w.bank.account_number, '1234567890');
  const mine = (await call('/api/transactions', { token: alice })).data.find((t) => t.id === w.id);
  assert.equal(mine.bank.account_number, '•••• 7890', 'masked in the customer view');
  const pending = (await call('/api/admin/transactions?status=pending', { token: admin })).data.find((t) => t.id === w.id);
  assert.deepEqual(pending.bank, { bank_name: 'Kasikornbank', account_name: 'Alice Test', account_number: '1234567890' });
  await call(`/api/admin/transactions/${w.id}/reject`, { method: 'POST', token: admin });

  const u = (await call('/api/admin/users?q=alice', { token: admin })).data[0];
  assert.equal(u.has_bank, true);
  assert.equal(u.bank.account_number, '1234567890');
  const edit = await call(`/api/admin/users/${u.id}`, { method: 'PATCH', token: admin, body: { bank: { bank_name: 'SCB', account_name: 'Alice Test', account_number: '9876543210' } } });
  assert.equal(edit.data.bank.account_number, '9876543210');
  // the earlier request keeps the account it was made to
  assert.equal((await call('/api/admin/transactions', { token: admin })).data.find((t) => t.id === w.id).bank.bank_name, 'Kasikornbank');
  await call(`/api/admin/users/${u.id}`, { method: 'PATCH', token: admin, body: { bank: null } });
  assert.equal((await call('/api/wallet/deposit', { method: 'POST', token: alice, body: { amount: 1 } })).data.code, 'BANK_REQUIRED');
  await call('/api/me/bank', { method: 'PUT', token: alice, body: { bank_name: 'Kasikornbank', account_name: 'Alice Test', account_number: '1234567890' } });
});
