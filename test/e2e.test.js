// End-to-end API tests against a real Postgres running the Supabase migration,
// fronted by the local PostgREST shim. Requires `psql` and a Postgres you can
// create databases on. Configure with PSQL_ARGS (default: "-h localhost -U postgres").
//   PSQL_ARGS="-h /tmp -p 5433 -U postgres" npm test
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BASE_ARGS = (process.env.PSQL_ARGS || '-h localhost -U postgres').split(' ').filter(Boolean);
const DB = `tradev_e2e_${process.pid}`;
const SHIM_PORT = 55000 + (process.pid % 1000);
const APP_PORT = 56000 + (process.pid % 1000);
const URL_ = `http://127.0.0.1:${APP_PORT}`;
const SHEET_PORT = 57000 + (process.pid % 1000);
const procs = [];
const sheetPayloads = [];
let sheetServer;

const psql = (args, input) => spawnSync('psql', [...BASE_ARGS, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], { input, encoding: 'utf8' });
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
  const ok = psql(['-c', 'select 1']);
  if (ok.status !== 0) throw new Error(`Cannot reach Postgres with PSQL_ARGS="${BASE_ARGS.join(' ')}": ${ok.stderr}`);
  psql(['-c', `create database ${DB}`]);
  // Supabase roles, so the migration's grants work on vanilla Postgres
  psql(['-d', DB, '-c', "do $$ begin create role anon nologin; exception when duplicate_object then null; end $$; do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$; do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;"]);
  for (const f of ['001_init.sql', '002_serverless.sql']) {
    const mig = psql(['-d', DB, '-f', path.join(ROOT, 'supabase/migrations', f)]);
    if (mig.status !== 0) throw new Error(mig.stderr);
  }

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

  const env = { ...process.env, PSQL_ARGS: [...BASE_ARGS, '-d', DB].join(' '), SHIM_PORT, SHIM_KEY: 'test-key' };
  procs.push(spawn('node', [path.join(ROOT, 'scripts/postgrest-shim.js')], { env, stdio: 'ignore' }));
  await waitFor(() => fetch(`http://127.0.0.1:${SHIM_PORT}/`).then(() => true));
  const appEnv = (port) => ({
    ...process.env, SUPABASE_URL: `http://127.0.0.1:${SHIM_PORT}`, SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    JWT_SECRET: 'test-secret', ADMIN_EMAIL: 'admin@test.io', ADMIN_PASSWORD: 'AdminPass123', PORT: port, STARTING_BALANCE: '1000',
    CRON_SECRET: 'cron-secret', LOCAL_TICK_MS: '0',
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
});

after(() => {
  for (const p of procs) p.kill();
  sheetServer.close();
  setTimeout(() => psql(['-c', `drop database if exists ${DB} with (force)`]), 300);
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
  psql(['-d', DB, '-c', `update orders set opened_at = now() - interval '10 minutes', created_at = now() - interval '10 minutes' where id = ${o.id};
                         update markets set last_tick_at = now() - interval '10 minutes', price = 500 where id = ${id};`]);
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
  psql(['-d', DB, '-c', `update orders set opened_at = now() - interval '5 minutes' where id = ${o.id};
                         update markets set last_tick_at = now() - interval '5 minutes', price = 100 where id = ${id};`]);
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
