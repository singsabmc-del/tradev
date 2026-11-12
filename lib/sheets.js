'use strict';
// Pushes PUBLIC data (market prices, optional platform totals) to a Google Sheet via an
// Apps Script web app. Never sends customer names, emails, balances or transactions.
// Serverless-friendly: any request may call maybeSync(); a database claim makes sure only
// one instance syncs per SHEETS_SYNC_SECONDS, and status is stored in app_state.
const config = require('./config');
const engine = require('./engine');
const store = require('./store');

const r = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const enabled = () => Boolean(config.sheetsUrl);

async function buildPayload() {
  const markets = (await engine.publicMarkets()).map((p) => ({
    symbol: p.symbol, name: p.name, price: r(p.price, p.decimals),
    change24h: r(p.change24h, 6), high24h: r(p.high24h, p.decimals), low24h: r(p.low24h, p.decimals),
    volume24h: r(p.volume24h, 2), max_leverage: p.max_leverage, fee_rate: p.fee_rate,
  }));
  const payload = { secret: config.sheetsSecret, sentAt: new Date().toISOString(), markets };
  if (config.sheetsIncludeStats) {
    const s = await store.adminStats();
    payload.stats = {
      customers: Number(s.customers), open_positions: Number(s.open_positions), closed_trades: Number(s.closed_trades),
      wins: Number(s.wins), losses: Number(s.losses),
      win_rate: s.wins + s.losses ? r(s.wins / (s.wins + s.losses), 4) : null,
      volume: r(Number(s.volume), 2),
    };
  }
  return payload;
}

async function getStatus() {
  if (!enabled()) return { enabled: false };
  return { enabled: true, ...((await store.getState('sheets_status')) || {}) };
}

async function syncNow() {
  const prev = await getStatus();
  const status = { lastOk: prev.lastOk || null, lastError: null, lastErrorAt: prev.lastErrorAt || null, sends: (prev.sends || 0) };
  try {
    const res = await fetch(config.sheetsUrl, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' }, // Apps Script reads e.postData.contents
      body: JSON.stringify(await buildPayload()),
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Unexpected response (HTTP ${res.status}) — check the web app is deployed with access "Anyone"`); }
    if (!data.ok) throw new Error(data.error || 'Sheet rejected the update');
    status.lastOk = new Date().toISOString();
    status.sends++;
  } catch (e) {
    console.error('[sheets] sync failed:', e.message);
    status.lastError = e.message;
    status.lastErrorAt = new Date().toISOString();
  }
  await store.setState('sheets_status', status);
  return { enabled: true, ...status };
}

// Sync if this instance wins the claim for the current interval. Never throws.
async function maybeSync() {
  if (!enabled()) return null;
  try {
    const claimed = await store.claimJob('sheets_sync', config.sheetsSyncSeconds);
    if (!claimed) return null;
    return await syncNow();
  } catch (e) {
    console.error('[sheets] maybeSync:', e.message);
    return null;
  }
}

module.exports = { enabled, buildPayload, getStatus, syncNow, maybeSync };
