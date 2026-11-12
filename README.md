# TradeV — trading web app with admin back office (Node.js + Supabase)

A leveraged trading platform (long / short perpetual-style contracts) with live charts, and an admin
back office to manage markets, customers, transactions and win/lose order history.

- **Backend:** Node.js 20+ with **zero npm dependencies** (`node:http`, `fetch`, `crypto`)
- **Database:** **Supabase** (Postgres). All balance changes run inside Postgres functions, so they are atomic.
- **Frontend:** plain HTML/CSS/JS, canvas candlestick chart, live updates over Server-Sent Events

## Features

**Trader app** (`/`)
- Sign up / log in (demo balance on signup, configurable)
- Live candlestick chart (1m / 5m / 15m / 1h, zoom & pan) with entry / TP / SL / limit lines
- Market & limit orders, long or short, adjustable leverage, take-profit and stop-loss
- Automatic TP / SL / liquidation and limit-order fills
- Positions with live PnL, open orders, trade history with **win / lose** result, transactions
- Portfolio (equity, realized & open PnL, win rate) and wallet (deposit / withdrawal requests)

**Admin panel** (`/admin`)
- **Dashboard:** customers, balances, open positions, live unrealized PnL, win/lose counts & win rate, fees, house result, volume, per-market breakdown
- **Markets:** create markets, edit price / volatility / trend (drift) / max leverage / fees / min margin, enable or disable trading
- **Customers:** search, full profile & stats, edit name/email/role/status, reset password, suspend, credit/debit balance, view every order and transaction
- **Transactions:** all money movements; approve or reject pending deposits and withdrawals
- **Orders:** every order filtered by status, **win / lose**, market and side; force-close positions, cancel pending orders

## Setup

### 1. Create the database in Supabase
1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste the contents of [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql) and run it.
   (Or with the Supabase CLI: `supabase link` then `supabase db push`.)

### 2. Configure
```bash
cp .env.example .env
```
Fill in from **Project Settings → API**:
- `SUPABASE_URL` — the project URL
- `SUPABASE_SERVICE_ROLE_KEY` — the **secret** key (`service_role` or `sb_secret_…`). Keep it server-side only.
- `JWT_SECRET` — any long random string (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — the admin account created on first start

### 3. Run
```bash
npm start          # http://localhost:3000   admin: http://localhost:3000/admin
```
No `npm install` needed.

## How it works

```
Browser ──HTTP/SSE──▶ Node server (server/) ──REST (service key)──▶ Supabase Postgres
                         │  market engine: price simulation,             tables + RLS
                         │  candles, TP/SL/liquidation watcher           atomic SQL functions
```

- The browser never talks to Supabase. **RLS is enabled with no policies** and all functions are
  `service_role`-only, so the public anon key can't read or change anything.
- Prices are simulated (random walk). Admins control each market's volatility and trend, or set the
  price directly. Candles are stored in the `candles` table.
- **PnL:** `size = margin × leverage / entry`; long PnL `= (exit − entry) × size`, short is the reverse;
  loss is capped at the margin (liquidation). A trade is a **win** if PnL minus fee is positive.
- Fee = `margin × leverage × fee_rate`, charged on open.

| Table | Purpose |
|---|---|
| `app_users` | customers & admins, balance, status |
| `markets` | tradable symbols and their settings |
| `candles` | 1-minute OHLCV history |
| `orders` | every order / position with entry, exit, PnL, **result (win/lose)**, close reason |
| `transactions` | ledger of every balance change (deposits, withdrawals, margin, fees, settlements, adjustments) |

## Tests

The end-to-end suite runs the real migration on a local Postgres behind a small PostgREST-compatible
shim (`scripts/postgrest-shim.js`), then exercises trading, TP/liquidation, limit fills, wallet
approvals, admin features and ledger integrity.

```bash
PSQL_ARGS="-h localhost -U postgres" npm test
```

## Project layout
```
server/      index.js (HTTP + SSE), api.js (routes), engine.js (market sim), supabase.js, auth.js, config.js
public/      index.html + app.js (trader), admin.html + admin.js, chart.js, styles
supabase/    migrations/001_init.sql
scripts/     postgrest-shim.js (local dev/test only)
test/        e2e.test.js
```

## Production notes
- This is a **simulated-price** demo exchange. Connecting real market data or real payments needs a
  price feed, KYC, and a payment provider — and the legal licensing that comes with them.
- Run a single server instance (the market engine lives in memory), behind HTTPS.
- Change the default admin password and set a strong `JWT_SECRET`.
