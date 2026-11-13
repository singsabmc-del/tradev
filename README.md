# TradeV — trading web app with admin back office (Vercel + Firebase)

A leveraged trading platform (long / short perpetual-style contracts) with live charts, and an admin
back office to manage markets, customers, transactions and win/lose order history.

- **Hosting:** **Vercel** (static frontend + one Node.js function), or any Node host
- **Database:** **Firebase Cloud Firestore** — all balance changes run in Firestore transactions
- **Public data:** optional **Google Sheets** sync of market prices
- **Zero npm dependencies** — nothing to install

## Features

**Trader app** (`/`)
- Sign up / log in with **email or phone number** (local or international format, e.g. `081 234 5678` = `+66 81 234 5678`)
- **Demo account**: one click on the sign-in screen, virtual funds for practice, no bank account, no deposits or withdrawals
- Live candlestick chart (1m / 5m / 15m / 1h, zoom & pan) with entry / TP / SL / limit lines
- Market & limit orders, long or short, adjustable leverage, take-profit and stop-loss
- Automatic TP / SL / liquidation and limit-order fills, with notifications
- Positions with live PnL, open orders, trade history with **win / lose** result, transactions
- Portfolio (equity, realized & open PnL, win rate) and wallet (deposit / withdrawal requests)
- **Account** page: name, phone, date of birth, country, address, change password, 6-digit **withdrawal code** (required for every withdrawal, locked after 5 wrong tries)
- **Notifications** bell with unread dot and pop-ups; **daylight / dark mode**; English / Thai

**Admin panel** (`/admin`)
- **Dashboard:** customers, balances, open positions, live unrealized PnL, win/lose & win rate, fees, house result, volume, per-market breakdown, Google Sheets sync status
- **Markets:** create markets, edit price / volatility / trend (drift) / max leverage / fees / min margin, enable or disable
- **Customers:** search by name, email or phone; full profile (phone, date of birth, country, address, internal note) & stats; edit, reset password, suspend, **deposit / withdraw on the customer's behalf**, credit/debit adjustments (customer is notified), bank account, every order and transaction; Real / Demo filter
- **Notifications:** send a message to one customer or everyone; deposits, withdrawals and balance adjustments notify automatically
- **Settings:** site name, **theme colour** (picker + presets, live preview, both apps), announcement, support contact, registration / trading / demo switches, bank-account requirement, deposit & withdrawal limits, company deposit account
- **Transactions:** all money movements; review each pending deposit or withdrawal (customer, amount, bank details) and approve or reject it with a reason that is sent to the customer
- **Orders:** every order filtered by status, **win / lose**, market and side; force-close positions, cancel pending orders

## 1. Set up the database
Follow [firebase/README.md](firebase/README.md): create a project, a Firestore database (production mode) and a
**service-account key**. That's all — TradeV creates its data (admin, markets, chart history) on first use.

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
cp .env.example .env   # fill in the Firebase service account + secrets
npm start              # http://localhost:3000   admin: /admin
```

## How it works (serverless)

```
Browser ──poll /api/ticker (CDN-cached 1s)──▶ Vercel Function (api/index.js → lib/)
        ──REST (service account)──────────▶ Firebase Cloud Firestore (transactions)
                                                         └── Google Sheets (optional, public prices)
```

- **Computed prices.** A simulated market's price is a pure function of a few stored numbers (start time, start
  price, volatility, drift, random seed): every second takes a seeded random step, so any server instance computes
  the same price and candles at any moment without storing ticks. Admin changes start a new segment. Live
  markets read the exchange (cached in memory). Active orders are walked along that path and TP / SL /
  liquidation / limit fills are settled **at their trigger price and at the second they were hit**, even if the
  site was closed — in a transaction that re-checks each order, so parallel instances never double-settle.
  The database is written only when money moves — see [costs](firebase/README.md#costs--ថ្លៃចំណាយ).
- **Live updates by polling.** Pages poll `/api/ticker` (CDN-cached for 1 second, so many viewers cost about
  one function run per second) and `/api/updates` for their own fills / TP / SL notifications.
- **Security.** The browser never talks to the database: Firestore rules deny all client access and only the
  server's service account can read or write. Login throttling is stored in the database so it works
  across instances.
- **PnL:** `size = margin × leverage / entry`; long PnL `= (exit − entry) × size`, short is the reverse;
  loss is capped at the margin (liquidation). A trade is a **win** if PnL minus fee is positive.

Data: users, markets, 1-minute candles (pruned after 30 days), orders (entry, exit, PnL, **result win/lose**,
close reason), transactions (ledger of every balance change). Layout: [firebase/README.md](firebase/README.md#data-layout--រចនាសម្ព័ន្ធទិន្នន័យ).

## Tests
The end-to-end suite runs **two** app instances (to mimic serverless) against an in-memory Firestore REST
stand-in with optimistic transaction aborts (`scripts/firestore-mock.js`). It covers trading,
TP / liquidation, limit fills, catch-up after an idle gap, concurrent instances, wallet approvals, admin
features, Google Sheets (no customer data leaks) and ledger integrity.
```bash
npm test        # no setup needed
```

## Project layout
```
api/index.js         Vercel Function — all /api/* requests (rewritten in vercel.json)
lib/                 api.js (routes), engine.js (catch-up market engine), sheets.js, auth.js, config.js, http.js
lib/store/           firestore.js — all database operations (transactions)
lib/firestore.js     dependency-free Firestore REST client (service-account auth, transactions)
firebase/            setup guide + firestore.rules
public/              trader app (index.html, app.js), admin (admin.html, admin.js), chart.js, styles
server/index.js      local dev server (same API + static files)
integrations/google-sheets/  Apps Script + setup guide
test/                e2e.test.js
vercel.json          routing, function config, daily cron, security headers
```

## Live prices from exchanges
Each market has a **price source** (Admin → Markets → Edit / New market):

| Source | Symbol example | Notes |
|---|---|---|
| Simulated | — | random walk with your volatility / trend |
| Binance | `BTCUSDT` | via the public market-data endpoint `data-api.binance.vision` |
| Bybit | `BTCUSDT` | spot |
| OKX | `BTC-USDT` | |
| Coinbase | `BTC-USD` | |
| Kraken | `XBTUSD` | |
| Custom JSON URL | any `https://` URL + path such as `data.price` | for forex, gold, stocks or your own API |

No API keys are needed. Live markets import real 1-minute history when created, and every update pulls the
exchange's real candles since the last one, so TP / SL / liquidation trigger on real highs and lows even after
nobody was online (catch-up is limited to the last 5–16 hours depending on the exchange). The admin can't set the
price of a live market; switch it back to Simulated for that. If an exchange is unreachable the site keeps
working, new orders on that market are refused with a clear message, and the Markets page shows the error.

`vercel.json` runs the function in **Singapore (`sin1`)**: several exchanges block US servers, and it is close to
Firestore in asia-southeast.

## Icons
UI icons are from [Lucide](https://lucide.dev) (ISC license), packed into `public/icons.js` by
`scripts/build-icons.js` — no runtime CDN. To add an icon, add its name to the list in that script and re-run it.

## Notes
- This is a **simulated-price** demo exchange. Real market data or real payments need a price feed, KYC,
  a payment provider, and the licensing that comes with them.
- Change the admin password after first login and keep `JWT_SECRET`, `CRON_SECRET` and the Firebase service-account key private.
