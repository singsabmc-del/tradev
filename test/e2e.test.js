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
const procs = [];

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
  const mig = psql(['-d', DB, '-f', path.join(ROOT, 'supabase/migrations/001_init.sql')]);
  if (mig.status !== 0) throw new Error(mig.stderr);

  const env = { ...process.env, PSQL_ARGS: [...BASE_ARGS, '-d', DB].join(' '), SHIM_PORT, SHIM_KEY: 'test-key' };
  procs.push(spawn('node', [path.join(ROOT, 'scripts/postgrest-shim.js')], { env, stdio: 'ignore' }));
  await waitFor(() => fetch(`http://127.0.0.1:${SHIM_PORT}/`).then(() => true));
  procs.push(spawn('node', [path.join(ROOT, 'server/index.js')], {
    env: {
      ...process.env, SUPABASE_URL: `http://127.0.0.1:${SHIM_PORT}`, SUPABASE_SERVICE_ROLE_KEY: 'test-key',
      JWT_SECRET: 'test-secret', ADMIN_EMAIL: 'admin@test.io', ADMIN_PASSWORD: 'AdminPass123', PORT: APP_PORT, TICK_MS: '200', STARTING_BALANCE: '1000',
    },
    stdio: process.env.DEBUG ? 'inherit' : 'ignore',
  }));
  await waitFor(() => call('/api/markets').then((r) => r.status === 200 && r.data.length));

  admin = (await call('/api/auth/login', { method: 'POST', body: { email: 'admin@test.io', password: 'AdminPass123' } })).data.token;
  alice = (await call('/api/auth/register', { method: 'POST', body: { email: 'alice@test.io', name: 'Alice', password: 'alicepass1' } })).data.token;
  assert.ok(admin && alice);
});

after(() => {
  for (const p of procs) p.kill();
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
  assert.equal((await call(`/api/orders/${o.id}/close`, { method: 'POST', token: alice })).status, 404);
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
