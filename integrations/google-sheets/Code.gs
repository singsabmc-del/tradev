/**
 * TradeV → Google Sheets bridge (Google Apps Script)
 *
 * Paste this into the Sheet: Extensions → Apps Script → replace Code.gs → Save.
 * Then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * Put the web app URL in TradeV's SHEETS_WEBHOOK_URL and the same SECRET in SHEETS_SECRET.
 *
 * Tabs it maintains:
 *   Markets        – one row per market, overwritten every sync
 *   Price history  – one row per market per sync (oldest rows trimmed)
 *   Summary        – platform totals (only if TradeV sends SHEETS_INCLUDE_STATS=true)
 *
 * GET on the web app URL returns the current Markets tab as public JSON.
 */

// Must match SHEETS_SECRET in TradeV's .env. Use a long random string.
const SECRET = 'CHANGE-ME-to-the-same-value-as-SHEETS_SECRET';
const MAX_HISTORY_ROWS = 20000;

const MARKET_HEADERS = ['Symbol', 'Name', 'Price', '24h change', '24h high', '24h low', '24h volume', 'Max leverage', 'Fee', 'Updated'];

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Invalid JSON' });
  }
  if (!SECRET || SECRET.indexOf('CHANGE-ME') === 0) return json_({ ok: false, error: 'Set SECRET in the Apps Script first' });
  if (body.secret !== SECRET) return json_({ ok: false, error: 'Wrong secret' });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json_({ ok: false, error: 'Sheet busy, try again' });
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const at = new Date(body.sentAt || Date.now());
    writeMarkets_(ss, body.markets || [], at);
    appendHistory_(ss, body.markets || [], at);
    if (body.stats) writeSummary_(ss, body.stats, at);
    return json_({ ok: true, rows: (body.markets || []).length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Public read-only JSON of the Markets tab
function doGet() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Markets');
  if (!sh || sh.getLastRow() < 2) return json_({ ok: true, markets: [] });
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, MARKET_HEADERS.length).getValues();
  const markets = values.map(function (r) {
    return { symbol: r[0], name: r[1], price: r[2], change24h: r[3], high24h: r[4], low24h: r[5], volume24h: r[6], maxLeverage: r[7], feeRate: r[8], updated: r[9] };
  });
  return json_({ ok: true, markets: markets });
}

function writeMarkets_(ss, markets, at) {
  const sh = sheet_(ss, 'Markets', MARKET_HEADERS);
  const rows = markets.map(function (m) {
    return [m.symbol, m.name, m.price, m.change24h, m.high24h, m.low24h, m.volume24h, m.max_leverage, m.fee_rate, at];
  });
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, MARKET_HEADERS.length).clearContent();
  if (rows.length) {
    sh.getRange(2, 1, rows.length, MARKET_HEADERS.length).setValues(rows);
    sh.getRange(2, 4, rows.length, 1).setNumberFormat('+0.00%;-0.00%;0.00%');
    sh.getRange(2, 9, rows.length, 1).setNumberFormat('0.000%');
    sh.getRange(2, 10, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }
}

function appendHistory_(ss, markets, at) {
  if (!markets.length) return;
  const sh = sheet_(ss, 'Price history', ['Time', 'Symbol', 'Price']);
  const rows = markets.map(function (m) { return [at, m.symbol, m.price]; });
  const start = sh.getLastRow() + 1;
  sh.getRange(start, 1, rows.length, 3).setValues(rows);
  sh.getRange(start, 1, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  const extra = sh.getLastRow() - 1 - MAX_HISTORY_ROWS;
  if (extra > 0) sh.deleteRows(2, extra);
}

function writeSummary_(ss, s, at) {
  const sh = sheet_(ss, 'Summary', ['Metric', 'Value']);
  const rows = [
    ['Customers', s.customers],
    ['Open positions', s.open_positions],
    ['Closed trades', s.closed_trades],
    ['Wins', s.wins],
    ['Losses', s.losses],
    ['Win rate', s.win_rate],
    ['Trading volume (USDT)', s.volume],
    ['Updated', at],
  ];
  sh.getRange(2, 1, rows.length, 2).setValues(rows);
  sh.getRange(7, 2).setNumberFormat('0.0%');
  sh.getRange(9, 2).setNumberFormat('yyyy-mm-dd hh:mm:ss');
}

function sheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
