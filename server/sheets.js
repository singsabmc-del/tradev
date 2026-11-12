'use strict';
// Pushes PUBLIC data (market prices, optional platform totals) to a Google Sheet via an
// Apps Script web app. Never sends customer names, emails, balances or transactions.
const config = require('./config');
const engine = require('./engine');
const db = require('./supabase');

const status = { enabled: Boolean(config.sheetsUrl), lastOk: null, lastError: null, lastErrorAt: null, sends: 0 };
let timer = null;
let running = false;

const r = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

async function buildPayload() {
  const markets = [...engine.markets.values()].filter((m) => m.enabled).map((m) => {
    const p = engine.publicMarket(m);
    return {
      symbol: p.symbol, name: p.name, price: r(p.price, p.decimals),
      change24h: r(p.change24h, 6), high24h: r(p.high24h, p.decimals), low24h: r(p.low24h, p.decimals),
      volume24h: r(p.volume24h, 2), max_leverage: p.max_leverage, fee_rate: p.fee_rate,
    };
  });
  const payload = { secret: config.sheetsSecret, sentAt: new Date().toISOString(), markets };
  if (config.sheetsIncludeStats) {
    const s = await db.rpc('admin_stats');
    // aggregate platform numbers only — nothing that identifies a customer
    payload.stats = {
      customers: Number(s.customers), open_positions: Number(s.open_positions), closed_trades: Number(s.closed_trades),
      wins: Number(s.wins), losses: Number(s.losses),
      win_rate: s.wins + s.losses ? r(s.wins / (s.wins + s.losses), 4) : null,
      volume: r(Number(s.volume), 2),
    };
  }
  return payload;
}

async function syncOnce() {
  if (running) return;
  running = true;
  try {
    const res = await fetch(config.sheetsUrl, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' }, // Apps Script reads e.postData.contents
      body: JSON.stringify(await buildPayload()),
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Unexpected response (HTTP ${res.status}) — check the web app is deployed with access "Anyone"`); }
    if (!data.ok) throw new Error(data.error || 'Sheet rejected the update');
    status.lastOk = new Date().toISOString();
    status.sends++;
    if (status.lastError) { console.log('[sheets] sync recovered'); status.lastError = null; }
  } catch (e) {
    if (status.lastError !== e.message) console.error('[sheets] sync failed:', e.message);
    status.lastError = e.message;
    status.lastErrorAt = new Date().toISOString();
  } finally {
    running = false;
  }
}

function start() {
  if (!config.sheetsUrl) return;
  console.log(`[sheets] syncing public market data to Google Sheets every ${config.sheetsSyncSeconds}s`);
  setTimeout(syncOnce, 3000);
  timer = setInterval(syncOnce, config.sheetsSyncSeconds * 1000);
}

module.exports = { start, syncOnce, status, buildPayload, stop: () => clearInterval(timer) };
