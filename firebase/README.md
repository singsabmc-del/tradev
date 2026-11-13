# Firebase (Firestore) setup / ការដំឡើង Firebase

TradeV stores everything (users, markets, candles, orders, transactions) in **Cloud Firestore**.
Only the TradeV server talks to Firestore, using a service account. No indexes, no Cloud Functions and
no Blaze plan are required to start.

TradeV រក្សាទុកទិន្នន័យទាំងអស់ក្នុង **Cloud Firestore**។ មានតែ server TradeV ប៉ុណ្ណោះដែលភ្ជាប់ទៅ Firestore
ដោយប្រើ service account។ មិនចាំបាច់បង្កើត index ឬ Cloud Functions ទេ។

## 1. Create the project / បង្កើត project
1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Create a project** (e.g. `tradev`). Google Analytics is optional.
2. **Build → Firestore Database → Create database**
   - Edition: **Standard**
   - Location: close to your users, e.g. **asia-southeast1 (Singapore)** — this can't be changed later
   - Rules: **Start in production mode** (denies all browser access — what TradeV wants)
3. Optional: replace the rules with [`firestore.rules`](firestore.rules) (same effect, documented).

## 2. Create a service account key / បង្កើត service account key
1. ⚙️ **Project settings → Service accounts → Generate new private key → Generate key**. A `.json` file downloads.
2. Keep this file secret. Never commit it to GitHub. / រក្សាឯកសារនេះជាការសម្ងាត់ កុំ commit ទៅ GitHub។

## 3. Configure TradeV / កំណត់ TradeV
Set **one** environment variable (Vercel → Project → Settings → Environment Variables, or `.env` locally):

```
FIREBASE_SERVICE_ACCOUNT=<paste the whole JSON file content>
```
Base64 of the file also works: `base64 -w0 key.json` (macOS: `base64 -i key.json`).
> The web `firebaseConfig` (apiKey, authDomain, …) is **not** this key. It's for browser SDKs and can't give the server access.

On first request TradeV creates the admin account (`ADMIN_EMAIL` / `ADMIN_PASSWORD`), the 6 default markets and their chart history.

## Costs / ថ្លៃចំណាយ
Firestore bills per document read/write. Its free quota is **50,000 reads and 20,000 writes per day**; when it
runs out, every request fails with "Database error" until the quota resets at midnight Pacific time
(15:00 in Thailand / Cambodia).

Prices are **computed, not stored**, so watching the site writes nothing. Measured with one trading page open
continuously: about **20 reads per minute and no writes** (≈ 29,000 reads a day), well inside the free quota.
Writes happen only when money moves: orders, fills, TP / SL / liquidations, deposits, withdrawals.
Pages also stop polling while their tab is hidden or after 10 minutes without use.

Settings that trade freshness for fewer reads:
- `ORDER_CHECK_SECONDS` (default 10): how often active orders are checked. TP / SL / liquidation are still
  settled at the exact price and second they were hit; this only changes how soon the customer sees it.
- `MARKETS_REV_SECONDS` (default 10): how soon other server instances notice an admin's market change.

For heavier traffic switch the Firebase project to the **Blaze** (pay-as-you-go) plan and set a budget alert.

## Data layout / រចនាសម្ព័ន្ធទិន្នន័យ
| Collection | Contents |
|---|---|
| `users` | accounts, balance, running stats (trades, wins, losses, PnL, fees, volume) |
| `emails` | uniqueness index for emails |
| `markets` (+ `candleHours` sub-collection) | market settings, live price, 1-minute candles grouped per hour |
| `market_stats` | per-market trading totals |
| `orders`, `transactions` | every order / position and every balance change |
| `counters`, `app_state`, `login_failures` | id sequences, background-job state, login throttling |

Document IDs are 10-digit "reversed" numbers so the newest records come first without extra indexes.
All balance changes run inside Firestore transactions.
