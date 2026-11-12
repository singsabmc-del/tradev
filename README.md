# TradeV — trading web app with admin back office (Vercel + Supabase)

A leveraged trading platform (long / short perpetual-style contracts) with live charts, and an admin
back office to manage markets, customers, transactions and win/lose order history.

- **Hosting:** **Vercel** (static frontend + one Node.js function), or any Node host
- **Database:** **Supabase** (Postgres). All balance changes run inside Postgres functions, so they are atomic.
- **Public data:** optional **Google Sheets** sync of market prices
- **Zero npm dependencies** — nothing to install

## Features

**Trader app** (`/`)
- Sign up / log in (demo balance on signup, configurable)
- Live candlestick chart (1m / 5m / 15m / 1h, zoom & pan) with entry / TP / SL / limit lines
- Market & limit orders, long or short, adjustable leverage, take-profit and stop-loss
- Automatic TP / SL / liquidation and limit-order fills, with notifications
- Positions with live PnL, open orders, trade history with **win / lose** result, transactions
- Portfolio (equity, realized & open PnL, win rate) and wallet (deposit / withdrawal requests)

**Admin panel** (`/admin`)
- **Dashboard:** customers, balances, open positions, live unrealized PnL, win/lose & win rate, fees, house result, volume, per-market breakdown, Google Sheets sync status
- **Markets:** create markets, edit price / volatility / trend (drift) / max leverage / fees / min margin, enable or disable
- **Customers:** search, full profile & stats, edit name/email/role/status, reset password, suspend, credit/debit balance, every order and transaction
- **Transactions:** all money movements; approve or reject pending deposits and withdrawals
- **Orders:** every order filtered by status, **win / lose**, market and side; force-close positions, cancel pending orders

## 1. Set up Supabase
1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql), then
   [`supabase/migrations/002_serverless.sql`](supabase/migrations/002_serverless.sql).
3. From **Project Settings → API**, copy the project URL and the **secret** key (`service_role` or `sb_secret_…`).

## 2. Deploy to Vercel
1. On [vercel.com/new](https://vercel.com/new), import the GitHub repo. Framework preset: **Other** (the included `vercel.json` sets everything else).
2. Add these **Environment Variables** (Settings → Environment Variables):

   | Variable | Value |
   |---|---|
   | `SUPABASE_URL` | your project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | the secret key — server-side only |
   | `JWT_SECRET` | long random string: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `ADMIN_EMAIL` / `ADMIN_PASSWORD` | the admin account, created on first request |
   | `CRON_SECRET` | long random string (protects `/api/cron`) |
   | `SHEETS_WEBHOOK_URL` / `SHEETS_SECRET` | optional — see [Google Sheets](integrations/google-sheets/README.md) |
   | `STARTING_BALANCE` | optional, default `10000` |

3. Deploy. Open `https://<your-app>.vercel.app` (traders) and `/admin` (back office).

**Optional — keep things moving when nobody is online.** Markets advance whenever anyone opens the site,
and anything that triggered in between is settled at the right price and time, so nothing is lost.
To also keep Google Sheets fresh with no visitors, ping `https://<your-app>.vercel.app/api/cron?key=<CRON_SECRET>`
every minute from a free scheduler (e.g. cron-job.org). The included Vercel Cron runs it once a day,
which is the Hobby plan's limit; on Pro you can change `vercel.json` to `* * * * *`.

## Run locally
```bash
cp .env.example .env   # fill in Supabase + secrets
npm start              # http://localhost:3000   admin: /admin
```

## How it works (serverless)

```
Browser ──poll /api/ticker (CDN-cached 1s)──▶ Vercel Function (api/index.js → lib/)
        ──REST (service key)──────────────▶ Supabase Postgres: tables + RLS + atomic SQL functions
                                                         └── Google Sheets (optional, public prices)
```

- **Catch-up market engine** (`lib/engine.js`). There is no always-running process. Each market stores its
  price at `last_tick_at`; any request advances it to "now", simulating the missed seconds (random walk using
  the admin's volatility and drift), filling in the 1-minute candles, and walking every open order along that
  path. TP / SL / liquidation / limit fills are settled **at their trigger price and at the moment they were
  hit**, even if the site was closed. `apply_tick()` commits each advance atomically, using `last_tick_at` as
  an optimistic lock, so parallel function instances never double-apply a tick or double-settle an order.
- **Live updates by polling.** Pages poll `/api/ticker` (CDN-cached for 1 second, so many viewers cost about
  one function run per second) and `/api/updates` for their own fills / TP / SL notifications.
- **Security.** The browser never talks to Supabase. RLS is on with no policies and all functions are
  `service_role`-only, so the public anon key can't read or change anything. Login throttling is stored in
  the database so it works across instances.
- **PnL:** `size = margin × leverage / entry`; long PnL `= (exit − entry) × size`, short is the reverse;
  loss is capped at the margin (liquidation). A trade is a **win** if PnL minus fee is positive.

| Table | Purpose |
|---|---|
| `app_users` | customers & admins, balance, status |
| `markets` | tradable symbols, settings, and `last_tick_at` for the catch-up engine |
| `candles` | 1-minute OHLCV history (pruned after 30 days by the cron job) |
| `orders` | every order / position: entry, exit, PnL, **result (win/lose)**, close reason |
| `transactions` | ledger of every balance change |
| `app_state`, `login_failures` | background-job claims & status; shared login throttling |

## Tests
The end-to-end suite runs both migrations on a local Postgres behind a small PostgREST-compatible shim
(`scripts/postgrest-shim.js`) and starts **two** app instances to mimic serverless. It covers trading, TP /
liquidation, limit fills, catch-up after an idle gap, concurrent instances, wallet approvals, admin features,
Google Sheets (no customer data leaks) and ledger integrity.
```bash
PSQL_ARGS="-h localhost -U postgres" npm test
```

## Project layout
```
api/index.js         Vercel Function — all /api/* requests (rewritten in vercel.json)
lib/                 api.js (routes), engine.js (catch-up market engine), sheets.js, supabase.js, auth.js, config.js, http.js
public/              trader app (index.html, app.js), admin (admin.html, admin.js), chart.js, styles
server/index.js      local dev server (same API + static files)
supabase/migrations/ 001_init.sql, 002_serverless.sql
integrations/google-sheets/  Apps Script + setup guide
test/                e2e.test.js
vercel.json          routing, function config, daily cron, security headers
```

## Notes
- This is a **simulated-price** demo exchange. Real market data or real payments need a price feed, KYC,
  a payment provider, and the licensing that comes with them.
- Change the admin password after first login and keep `JWT_SECRET`, `CRON_SECRET` and the Supabase secret key private.
