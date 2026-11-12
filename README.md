# TradeV — trading web app with admin back office (Vercel + Firebase)

A leveraged trading platform (long / short perpetual-style contracts) with live charts, and an admin
back office to manage markets, customers, transactions and win/lose order history.

- **Hosting:** **Vercel** (static frontend + one Node.js function), or any Node host
- **Database:** **Firebase Cloud Firestore** (all balance changes in Firestore transactions) — or **Supabase** (Postgres), selectable with one setting
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

## 1. Set up the database
**Firebase (default):** follow [firebase/README.md](firebase/README.md) — create a project, a Firestore database
(production mode) and a service-account key. That's all: TradeV creates its data on first use.

**Or Supabase:** create a project, run [`001_init.sql`](supabase/migrations/001_init.sql) then
[`002_serverless.sql`](supabase/migrations/002_serverless.sql) in the SQL Editor, and use `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` instead of `FIREBASE_SERVICE_ACCOUNT` below.

## 2. Deploy to Vercel
1. On [vercel.com/new](https://vercel.com/new), import the GitHub repo. Framework preset: **Other** (the included `vercel.json` sets everything else).
2. Add these **Environment Variables** (Settings → Environment Variables):

   | Variable | Value |
   |---|---|
   | `FIREBASE_SERVICE_ACCOUNT` | the service-account key JSON (whole file, or base64) — server-side only |
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
cp .env.example .env   # fill in Firebase (or Supabase) + secrets
npm start              # http://localhost:3000   admin: /admin
```

## How it works (serverless)

```
Browser ──poll /api/ticker (CDN-cached 1s)──▶ Vercel Function (api/index.js → lib/)
        ──REST (service account)──────────▶ Firestore: transactions   (or Supabase Postgres: SQL functions)
                                                         └── Google Sheets (optional, public prices)
```

- **Catch-up market engine** (`lib/engine.js`). There is no always-running process. Each market stores its
  price at `last_tick_at`; any request advances it to "now", simulating the missed seconds (random walk using
  the admin's volatility and drift), filling in the 1-minute candles, and walking every open order along that
  path. TP / SL / liquidation / limit fills are settled **at their trigger price and at the moment they were
  hit**, even if the site was closed. Each advance is committed atomically (a Firestore transaction, or the
  `apply_tick()` SQL function) with `last_tick_at` as an optimistic lock, so parallel function instances never
  double-apply a tick or double-settle an order. On Firestore markets are saved at most every 5 seconds
  (`ADVANCE_MIN_SECONDS`) to keep reads/writes low — see [costs](firebase/README.md#costs--ថ្លៃចំណាយ).
- **Live updates by polling.** Pages poll `/api/ticker` (CDN-cached for 1 second, so many viewers cost about
  one function run per second) and `/api/updates` for their own fills / TP / SL notifications.
- **Security.** The browser never talks to the database. Firestore rules deny all client access (Supabase: RLS
  with no policies, `service_role`-only functions). Login throttling is stored in the database so it works
  across instances.
- **PnL:** `size = margin × leverage / entry`; long PnL `= (exit − entry) × size`, short is the reverse;
  loss is capped at the margin (liquidation). A trade is a **win** if PnL minus fee is positive.

Data: users, markets, 1-minute candles (pruned after 30 days), orders (entry, exit, PnL, **result win/lose**,
close reason), transactions (ledger of every balance change). Firestore layout: [firebase/README.md](firebase/README.md#data-layout--រចនាសម្ព័ន្ធទិន្នន័យ);
Postgres schema: [supabase/migrations](supabase/migrations).

## Tests
One end-to-end suite runs against **both** backends, each with **two** app instances to mimic serverless:
Firestore via an in-memory Firestore REST stand-in with optimistic transaction aborts
(`scripts/firestore-mock.js`), and Supabase via a real Postgres behind a PostgREST shim. It covers trading,
TP / liquidation, limit fills, catch-up after an idle gap, concurrent instances, wallet approvals, admin
features, Google Sheets (no customer data leaks) and ledger integrity.
```bash
npm run test:firestore                                   # no setup needed
PSQL_ARGS="-h localhost -U postgres" npm run test:supabase
```

## Project layout
```
api/index.js         Vercel Function — all /api/* requests (rewritten in vercel.json)
lib/                 api.js (routes), engine.js (catch-up market engine), sheets.js, auth.js, config.js, http.js
lib/store/           firestore.js, supabase.js — the two storage backends behind one interface
lib/firestore.js     dependency-free Firestore REST client (service-account auth, transactions)
firebase/            setup guide + firestore.rules
public/              trader app (index.html, app.js), admin (admin.html, admin.js), chart.js, styles
server/index.js      local dev server (same API + static files)
supabase/migrations/ 001_init.sql, 002_serverless.sql (only if you use Supabase)
integrations/google-sheets/  Apps Script + setup guide
test/                e2e.test.js
vercel.json          routing, function config, daily cron, security headers
```

## Notes
- This is a **simulated-price** demo exchange. Real market data or real payments need a price feed, KYC,
  a payment provider, and the licensing that comes with them.
- Change the admin password after first login and keep `JWT_SECRET`, `CRON_SECRET` and the Firebase key (or Supabase secret key) private.
