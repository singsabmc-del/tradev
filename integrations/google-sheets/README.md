# Google Sheets — public market data / ទិន្នន័យទីផ្សារ Public

TradeV can push **public** data to a Google Sheet every minute, which you then publish to the web.
Only market data (and optional platform totals) is sent — **never** customer names, emails,
balances, orders or transactions.

TradeV អាចបញ្ជូនទិន្នន័យ **public** ទៅ Google Sheet រៀងរាល់មួយនាទី ហើយអ្នកអាច publish វាជា public បាន។
បញ្ជូនតែទិន្នន័យទីផ្សារ (និងស្ថិតិសរុប បើបើក) ប៉ុណ្ណោះ — **មិនដែល**បញ្ជូនឈ្មោះ អ៊ីមែល សមតុល្យ order ឬប្រតិបត្តិការរបស់អតិថិជនទេ។

| Tab | Content / ខ្លឹមសារ |
|---|---|
| **Markets** | Symbol, name, price, 24h change, high, low, volume, max leverage, fee, updated time |
| **Price history** | Time, symbol, price — one row per market per sync (keeps the latest 20,000 rows ≈ 2 days) |
| **Summary** | Customers count, open positions, trades, wins, losses, win rate, volume — only if `SHEETS_INCLUDE_STATS=true` |

## Setup / ការដំឡើង (≈ 5 minutes)

1. **Create a Sheet / បង្កើត Sheet** — go to [sheets.new](https://sheets.new) and name it, e.g. `TradeV Public Prices`.

2. **Add the script / បញ្ចូល Script** — in the Sheet: **Extensions → Apps Script**. Delete everything in `Code.gs`,
   paste the contents of [`Code.gs`](Code.gs), and change the `SECRET` line to a long random password.
   Click 💾 **Save**.
   - Make a random secret / បង្កើតពាក្យសម្ងាត់: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`

3. **Deploy / Deploy ជា Web app** — **Deploy → New deployment → ⚙️ Select type → Web app**
   - Execute as / ដំណើរការជា: **Me**
   - Who has access / អ្នកណាអាចចូល: **Anyone**
   - Click **Deploy**, then **Authorize access** and allow it (choose your account → *Advanced* → *Go to … (unsafe)* → *Allow* — this is normal for your own script).
   - Copy the **Web app URL** (ends with `/exec`).

4. **Configure TradeV / កំណត់ TradeV** — in `.env`:
   ```
   SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/XXXXXXXX/exec
   SHEETS_SECRET=the-same-secret-as-in-Code.gs
   SHEETS_SYNC_SECONDS=60
   SHEETS_INCLUDE_STATS=false
   ```
   Redeploy (or restart) TradeV. The admin **Dashboard** shows `Google Sheets: synced …` and has a **Sync now** button.

5. **Make it public / ធ្វើឲ្យ Public** — choose one or both:
   - **Publish to web** (read-only, no Google login needed): **File → Share → Publish to web** → choose the
     `Markets` tab → *Web page* or *CSV* → **Publish**. Anyone with the link sees live data (refreshes about every 5 minutes).
   - **Share link** (people see the actual Sheet): **Share → General access → Anyone with the link → Viewer**.
   - **JSON API**: a `GET` request to the same Web app URL returns the Markets tab as JSON.

## Notes / កំណត់សម្គាល់
- If you edit `Code.gs` later, use **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**
  so the URL stays the same. / បើកែ Code.gs ក្រោយមក ត្រូវ deploy version ថ្មីលើ deployment ដដែល ដើម្បីឲ្យ URL មិនប្តូរ។
- `Wrong secret` in the dashboard = `SECRET` in Code.gs and `SHEETS_SECRET` don't match.
- `Unexpected response` = the web app access isn't set to **Anyone**.
- Google Apps Script has daily quotas; a sync every 60 seconds is well within them. Don't go below ~15 seconds.
