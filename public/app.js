/* TradeV trader app */
'use strict';
(() => {
  const { api, store, fmt, money, signed, pct, cls, time, esc, badge, toast, confirmBox, withBusy, ICONS } = TV;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const S = {
    user: null, markets: [], symbol: localStorage.getItem('tv_symbol') || 'BTC/USDT',
    raw: [], tf: 1, side: 'long', type: 'market', leverage: 10,
    active: [], history: [], tx: [], tab: 'positions', view: 'trade',
  };
  let chart, live;

  const mkt = () => S.markets.find((m) => m.symbol === S.symbol) || S.markets[0];
  const pfmt = (v, m = mkt()) => fmt(v, m ? m.decimals : 2);
  const COIN_COLORS = { BTC: ['#f7b52b', '#f08a1c'], ETH: ['#8aa2ff', '#5c6bd8'], SOL: ['#b77bff', '#2fe3c0'], BNB: ['#ffd84d', '#e8b30b'], XAU: ['#ffe08a', '#c99a2e'], EUR: ['#6fb7ff', '#2f6fd8'] };

  // ---------------- auth ----------------
  let authMode = 'login';
  $$('[data-auth]').forEach((b) => b.addEventListener('click', () => {
    authMode = b.dataset.auth;
    $$('[data-auth]').forEach((x) => x.classList.toggle('active', x === b));
    $('#nameField').classList.toggle('hidden', authMode === 'login');
    $('#authBtn').textContent = authMode === 'login' ? 'Log in' : 'Create account';
    $('#authLead').textContent = authMode === 'login' ? 'Sign in to start trading' : 'Open a demo account in seconds';
    $('#authErr').textContent = '';
  }));
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    $('#authErr').textContent = '';
    try {
      await withBusy($('#authBtn'), async () => {
        const r = await api(`/api/auth/${authMode}`, { method: 'POST', body: Object.fromEntries(f) });
        store.set(r.token);
        await boot();
      });
    } catch (err) { $('#authErr').textContent = err.message; }
  });
  $('#logout').addEventListener('click', () => { store.clear(); location.reload(); });
  window.addEventListener('tv:logout', () => location.reload());

  // ---------------- navigation ----------------
  const NAV = { trade: ['trade', 'Trade'], markets: ['markets', 'Markets'], portfolio: ['portfolio', 'Portfolio'], wallet: ['wallet', 'Wallet'] };
  for (const [v, [icon, label]] of Object.entries(NAV)) {
    const b = $(`[data-view="${v}"]`);
    b.innerHTML = `${ICONS[icon]}<span>${label}</span>`;
    b.addEventListener('click', () => { location.hash = v; });
  }
  $('#adminLink').innerHTML = `${ICONS.admin}<span>Admin</span>`;
  function showView() {
    const v = (location.hash || '#trade').slice(1);
    S.view = NAV[v] ? v : 'trade';
    $$('.view').forEach((s) => s.classList.toggle('hidden', s.id !== `view-${S.view}`));
    $$('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === S.view));
    if (S.view === 'markets') renderMarkets();
    if (S.view === 'portfolio') loadHistory().then(renderPortfolio);
    if (S.view === 'wallet') loadTx().then(renderWallet);
    if (S.view === 'trade' && chart) chart.resize();
  }
  window.addEventListener('hashchange', showView);
  window.addEventListener('tv:lang', () => { if (S.user) { showView(); renderBottom(); } });
  window.addEventListener('tv:theme', () => { if (S.user && chart) renderChartLines(); });

  // ---------------- data ----------------
  // ---------------- system settings ----------------
  S.settings = { require_bank_account: true, trading_enabled: true, registration_open: true };
  const needBank = () => S.settings.require_bank_account !== false && S.user && !S.user.has_bank;
  async function loadSettings() {
    try { S.settings = await api('/api/settings'); } catch { /* keep defaults */ }
    applySettings();
  }
  function applySettings() {
    const st = S.settings;
    for (const el of $$('.announce')) {
      el.classList.toggle('hidden', !st.announcement);
      el.innerHTML = st.announcement ? `${icon('info')}<span>${esc(st.announcement)}</span>` : '';
    }
    const reg = $('[data-auth=register]');
    reg.classList.toggle('hidden', !st.registration_open);
    $('#regClosed').classList.toggle('hidden', st.registration_open !== false);
    if (st.registration_open === false && authMode === 'register') $('[data-auth=login]').click();
    if (!S.user) return;
    $('#bankNeeded').classList.toggle('hidden', !needBank());
    $('#tradingPaused').classList.toggle('hidden', st.trading_enabled !== false);
    $('#submitOrder').disabled = st.trading_enabled === false;
    $('#supportLine').classList.toggle('hidden', !st.support_contact);
    $('#supportLine').innerHTML = st.support_contact ? `${icon('info')}<span>Support:</span> <b>${esc(st.support_contact)}</b>` : '';
    renderWalletMode();
  }
  function renderWalletMode() {
    const st = S.settings, dep = wMode === 'deposit';
    const enabled = dep ? st.deposits_enabled !== false : st.withdrawals_enabled !== false;
    const min = dep ? st.min_deposit : st.min_withdrawal, max = dep ? st.max_deposit : st.max_withdrawal;
    const limits = [min ? `min ${fmt(min)}` : '', max ? `max ${fmt(max)}` : ''].filter(Boolean).join(' · ');
    let html = '';
    if (!enabled) html = `<div class="notice warn">${icon('info')}<span>${dep ? 'Deposits are currently disabled' : 'Withdrawals are currently disabled'}</span></div>`;
    else if (dep && st.deposit_bank) {
      const b = st.deposit_bank;
      html = `<div class="pay-to"><div class="lbl small muted">${icon('landmark')}<span>Transfer to</span></div>
        <div class="bank-line"><b>${esc(b.bank_name)}</b><span>${esc(b.account_name)}</span><span class="num big-num">${esc(b.account_number)}</span></div>
        ${b.instructions ? `<p class="muted small">${esc(b.instructions)}</p>` : ''}</div>`;
    } else if (!dep && S.user && S.user.bank) html = `<p class="muted small">${icon('landmark')} <span>Paid to</span> ${esc(S.user.bank.bank_name)} · ${esc(S.user.bank.account_number)}</p>`;
    $('#walletInfo').innerHTML = html + (limits && enabled ? `<p class="dim small">${limits} USDT</p>` : '');
    $('#wForm').classList.toggle('locked', !enabled || needBank());
  }

  async function refreshUser() {
    S.user = await api('/api/me');
    $('#uName').textContent = S.user.name || 'Trader';
    $('#uEmail').textContent = S.user.email;
    $('#uBal').textContent = money(S.user.balance);
    $('#avail').textContent = `${fmt(S.user.balance)} USDT`;
    $('#wBal').textContent = money(S.user.balance);
    $('#adminLink').classList.toggle('hidden', S.user.role !== 'admin');
    $('#bankNeeded').classList.toggle('hidden', !needBank());
    renderBank();
    updateSummary();
  }

  // ---------------- bank account ----------------
  let bankEditing = false;
  function goBank(msg) {
    if (msg) toast(msg, 'warn');
    bankEditing = true;
    location.hash = 'wallet';
    renderBank();
    setTimeout(() => { const f = $('#bankCard input'); if (f) f.focus(); }, 50);
  }
  function renderBank() {
    const box = $('#bankCard');
    if (!box || !S.user) return;
    const b = S.user.bank;
    if ($('#walletInfo')) renderWalletMode();
    if (b && !bankEditing) {
      box.classList.remove('needed');
      box.innerHTML = `<div class="row between"><h3 class="lbl" style="margin:0">${icon('landmark')}<span>Bank account</span></h3>
        <button class="btn btn-sm btn-icon" id="bankEdit">${icon('pencil')}<span>Change</span></button></div>
        <div class="bank-line"><b>${esc(b.bank_name)}</b><span>${esc(b.account_name)}</span><span class="num">${esc(b.account_number)}</span></div>`;
      $('#bankEdit').onclick = () => { bankEditing = true; renderBank(); };
      return;
    }
    box.classList.toggle('needed', needBank());
    box.innerHTML = `<h3 class="lbl">${icon('landmark')}<span>${b ? 'Change bank account' : 'Add your bank account'}</span></h3>
      ${b ? '' : needBank() ? '<p class="muted small" style="margin-top:-4px">Required before you can deposit, withdraw or trade. Withdrawals are paid to this account.</p>' : '<p class="muted small" style="margin-top:-4px">Withdrawals are paid to this account.</p>'}
      <form id="bankForm">
        <label class="field"><span>Bank name</span><input class="input" name="bank_name" list="bankList" required maxlength="60" value="${esc(b ? b.bank_name : '')}" autocomplete="off" /></label>
        <label class="field"><span>Account holder name</span><input class="input" name="account_name" required maxlength="80" value="${esc(b ? b.account_name : S.user.name || '')}" /></label>
        <label class="field"><span>Account number</span><input class="input num" name="account_number" required maxlength="40" inputmode="numeric" placeholder="${b ? esc(b.account_number) : '123-4-56789-0'}" autocomplete="off" /></label>
        <div class="row">${b ? '<button type="button" class="btn" id="bankCancel">Cancel</button>' : ''}<button class="btn btn-green btn-icon" id="bankSave" style="flex:1">${icon('check')}<span>Save bank account</span></button></div>
      </form>`;
    if (b) $('#bankCancel').onclick = () => { bankEditing = false; renderBank(); };
    $('#bankForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        S.user = await withBusy($('#bankSave'), () => api('/api/me/bank', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }));
        bankEditing = false;
        toast('Bank account saved');
        await refreshUser();
      } catch (err) { toast(err.message, 'err'); }
    });
  }
  async function loadActive() { S.active = await api('/api/orders?scope=active'); renderBottom(); }
  async function loadHistory() { S.history = await api('/api/orders?scope=history'); if (S.tab === 'history') renderBottom(); }
  async function loadTx() { S.tx = await api('/api/transactions'); if (S.tab === 'tx') renderBottom(); }

  async function selectMarket(symbol) {
    S.symbol = symbol;
    localStorage.setItem('tv_symbol', symbol);
    const m = mkt();
    if (!m) return;
    $('#symName').textContent = m.symbol;
    $('#symLabel').textContent = m.symbol;
    const [a, b] = COIN_COLORS[m.base] || ['#3ee7a0', '#139e6a'];
    $('#coinIcon').style.background = `linear-gradient(135deg, ${a}, ${b})`;
    $('#coinIcon').textContent = m.base[0];
    $('#limitQuote').textContent = m.quote;
    document.title = `${pfmt(m.price)} ${m.symbol} — ${S.settings.site_name || 'TradeV'}`;
    renderLeverage();
    S.raw = await api(`/api/candles?symbol=${encodeURIComponent(symbol)}&limit=1500`);
    chart.setData(aggregateCandles(S.raw, S.tf), m.decimals);
    renderHeader();
    renderChartLines();
    updateSummary();
  }

  // ---------------- market picker ----------------
  $('#pickerBtn').addEventListener('click', (e) => { e.stopPropagation(); renderPicker(); $('#pickerList').classList.toggle('hidden'); });
  document.addEventListener('click', () => $('#pickerList').classList.add('hidden'));
  function renderPicker() {
    $('#pickerList').innerHTML = S.markets.map((m) => `
      <button class="picker-item ${m.symbol === S.symbol ? 'active' : ''}" data-sym="${esc(m.symbol)}">
        <span><b>${esc(m.symbol)}</b><small>${esc(m.name)} · up to ${m.max_leverage}x</small></span>
        <span class="num r">${pfmt(m.price, m)}</span>
        <span class="num r ${cls(m.change24h)}">${pct(m.change24h)}</span>
      </button>`).join('');
    $$('.picker-item').forEach((b) => b.addEventListener('click', () => selectMarket(b.dataset.sym)));
  }

  function renderHeader() {
    const m = mkt();
    if (!m) return;
    const el = $('#lastPrice');
    const prev = el.dataset.v ? +el.dataset.v : m.price;
    el.textContent = pfmt(m.price);
    el.style.color = m.price > prev ? 'var(--green)' : m.price < prev ? 'var(--red)' : '';
    el.dataset.v = m.price;
    $('#chg').textContent = pct(m.change24h); $('#chg').className = `num ${cls(m.change24h)}`;
    $('#hi').textContent = pfmt(m.high24h); $('#lo').textContent = pfmt(m.low24h);
    $('#vol').textContent = fmt(m.volume24h, 0);
  }

  // ---------------- order form ----------------
  $$('[data-side]').forEach((b) => b.addEventListener('click', () => {
    S.side = b.dataset.side;
    $$('[data-side]').forEach((x) => x.classList.toggle('active', x === b));
    const btn = $('#submitOrder');
    btn.className = `btn btn-block btn-icon ${S.side === 'long' ? 'btn-green' : 'btn-red'}`;
    btn.innerHTML = `${icon(S.side === 'long' ? 'trending-up' : 'trending-down')}<span>${S.side === 'long' ? 'Buy / Long' : 'Sell / Short'}</span>`;
    updateSummary();
  }));
  $$('[data-type]').forEach((b) => b.addEventListener('click', () => {
    S.type = b.dataset.type;
    $$('[data-type]').forEach((x) => x.classList.toggle('active', x === b));
    $('#limitField').classList.toggle('hidden', S.type !== 'limit');
    if (S.type === 'limit' && !$('#limitPrice').value) $('#limitPrice').value = mkt().price.toFixed(mkt().decimals);
    updateSummary();
  }));
  function renderLeverage() {
    const max = mkt().max_leverage;
    const opts = [2, 5, 10, 20, 50, 100, 200].filter((x) => x < max).slice(-4).concat(max);
    S.leverage = Math.min(S.leverage, max);
    $('#levSeg').innerHTML = opts.map((x) => `<button data-lev="${x}">${x}x</button>`).join('');
    $$('[data-lev]').forEach((b) => b.addEventListener('click', () => setLev(+b.dataset.lev)));
    $('#levRange').max = max;
    setLev(S.leverage);
  }
  function setLev(v) {
    S.leverage = v;
    $('#levRange').value = v;
    $('#levLabel').textContent = `${v}x`;
    $$('[data-lev]').forEach((b) => b.classList.toggle('active', +b.dataset.lev === v));
    updateSummary();
  }
  $('#levRange').addEventListener('input', (e) => setLev(+e.target.value));
  $$('[data-pct]').forEach((b) => b.addEventListener('click', () => {
    const m = mkt();
    const bal = S.user ? S.user.balance : 0;
    // leave room for the fee: margin * (1 + lev * fee) <= balance
    const max = bal / (1 + S.leverage * m.fee_rate);
    $('#margin').value = Math.max(0, Math.floor(max * +b.dataset.pct * 100) / 100).toFixed(2);
    updateSummary();
  }));
  for (const k of ['tp', 'sl']) {
    $(`#${k}On`).addEventListener('change', (e) => {
      $(`#${k}Box`).classList.toggle('hidden', !e.target.checked);
      if (e.target.checked && !$(`#${k}`).value) {
        const p = entryPrice();
        const up = (k === 'tp') === (S.side === 'long');
        $(`#${k}`).value = (p * (up ? 1.01 : 0.99)).toFixed(mkt().decimals);
      }
      updateSummary();
    });
  }
  ['margin', 'limitPrice', 'tp', 'sl'].forEach((id) => $(`#${id}`).addEventListener('input', updateSummary));

  const entryPrice = () => (S.type === 'limit' && +$('#limitPrice').value > 0 ? +$('#limitPrice').value : mkt().price);
  function updateSummary() {
    const m = mkt();
    if (!m) return;
    const margin = +$('#margin').value || 0;
    const p = entryPrice();
    const value = margin * S.leverage;
    const fee = value * m.fee_rate;
    const liq = S.side === 'long' ? p * (1 - 1 / S.leverage) : p * (1 + 1 / S.leverage);
    $('#sEntry').textContent = S.type === 'market' ? `≈ ${pfmt(p)}` : pfmt(p);
    $('#sSize').textContent = margin ? `${fmt(value / p, 6)} ${m.base}` : '—';
    $('#sValue').textContent = margin ? `${fmt(value)} ${m.quote}` : '—';
    $('#sLiq').textContent = margin ? pfmt(liq) : '—';
    $('#sFee').textContent = margin ? fmt(fee) : '—';
    $('#sCost').textContent = margin ? `${fmt(margin + fee)} USDT` : '—';
    for (const k of ['tp', 'sl']) {
      const v = +$(`#${k}`).value;
      const on = $(`#${k}On`).checked;
      if (on && v && margin) {
        const pnl = (S.side === 'long' ? v - p : p - v) / p * value;
        $(`#${k}Pct`).innerHTML = `<span class="${cls(pnl)}">${signed(pnl)} (${pct(pnl / margin, 0)})</span>`;
      } else $(`#${k}Pct`).textContent = '';
    }
    const insufficient = S.user && margin + fee > S.user.balance;
    $('#orderHint').textContent = insufficient ? 'Insufficient balance' : `${m.symbol} · ${S.type} · ${S.leverage}x · fee ${(m.fee_rate * 100).toFixed(3)}%`;
    $('#orderHint').className = `small center ${insufficient ? 'down' : 'dim'}`;
  }

  $('#submitOrder').addEventListener('click', async () => {
    const m = mkt();
    const body = {
      symbol: m.symbol, side: S.side, type: S.type, leverage: S.leverage,
      margin: $('#margin').value, limitPrice: $('#limitPrice').value,
      tp: $('#tpOn').checked ? $('#tp').value : null, sl: $('#slOn').checked ? $('#sl').value : null,
    };
    if (needBank()) return goBank('Add your bank account first');
    if (S.settings.trading_enabled === false) return toast('Trading is paused', 'warn');
    if (!(+body.margin > 0)) return toast('Enter a margin amount', 'err');
    try {
      await withBusy($('#submitOrder'), async () => {
        const o = await api('/api/orders', { method: 'POST', body });
        toast(o.status === 'open'
          ? `${o.side === 'long' ? 'Long' : 'Short'} ${m.symbol} opened at ${pfmt(o.entry_price)}`
          : `Limit order placed at ${pfmt(o.limit_price)}`);
        $('#margin').value = '';
        await Promise.all([refreshUser(), loadActive()]);
        renderChartLines();
      });
    } catch (e) { if (e.code === 'BANK_REQUIRED') goBank(e.message); else toast(e.message, 'err'); }
  });

  // ---------------- bottom tables ----------------
  $$('#bottomTabs .tab').forEach((b) => b.addEventListener('click', async () => {
    S.tab = b.dataset.tab;
    $$('#bottomTabs .tab').forEach((x) => x.classList.toggle('active', x === b));
    if (S.tab === 'history') await loadHistory();
    if (S.tab === 'tx') await loadTx();
    renderBottom();
  }));

  function livePnl(o) {
    const m = S.markets.find((x) => x.id === o.market_id);
    if (!m || o.status !== 'open') return { pnl: null, mark: m && m.price };
    const pnl = Math.max((o.side === 'long' ? m.price - o.entry_price : o.entry_price - m.price) * o.size, -o.margin);
    return { pnl, mark: m.price };
  }

  function positionsTable(rows) {
    if (!rows.length) return '<div class="empty">No open positions</div>';
    return `<table class="tbl"><thead><tr><th>Market</th><th>Side</th><th class="r">Size</th><th class="r">Margin</th><th class="r">Entry</th><th class="r">Mark</th><th class="r">Liq.</th><th class="r">TP / SL</th><th class="r">PnL (ROE)</th><th></th></tr></thead><tbody>
      ${rows.map((o) => {
        const m = S.markets.find((x) => x.id === o.market_id) || { decimals: 2, base: '' };
        const d = m.decimals;
        return `<tr data-id="${o.id}"><td><b>${esc(o.symbol)}</b></td><td>${badge(o.side)} <span class="dim">${o.leverage}x</span></td>
        <td class="r num">${fmt(o.size, 5)}</td><td class="r num">${fmt(o.margin)}</td><td class="r num">${fmt(o.entry_price, d)}</td>
        <td class="r num" data-mark>${fmt(livePnl(o).mark, d)}</td><td class="r num down">${fmt(o.liq_price, d)}</td>
        <td class="r num">${o.tp ? fmt(o.tp, d) : '—'} / ${o.sl ? fmt(o.sl, d) : '—'}</td>
        <td class="r num" data-pnl></td><td class="r"><button class="btn btn-sm" data-close="${o.id}">Close</button></td></tr>`;
      }).join('')}</tbody></table>`;
  }
  function openOrdersTable(rows) {
    if (!rows.length) return '<div class="empty">No pending limit orders</div>';
    return `<table class="tbl"><thead><tr><th>Market</th><th>Side</th><th class="r">Limit price</th><th class="r">Margin</th><th class="r">TP / SL</th><th>Placed</th><th></th></tr></thead><tbody>
      ${rows.map((o) => `<tr><td><b>${esc(o.symbol)}</b></td><td>${badge(o.side)} <span class="dim">${o.leverage}x</span></td>
        <td class="r num">${fmt(o.limit_price, o.decimals)}</td><td class="r num">${fmt(o.margin)}</td>
        <td class="r num">${o.tp ? fmt(o.tp, o.decimals) : '—'} / ${o.sl ? fmt(o.sl, o.decimals) : '—'}</td>
        <td class="muted">${time(o.created_at)}</td><td class="r"><button class="btn btn-sm btn-ghost-red" data-cancel="${o.id}">Cancel</button></td></tr>`).join('')}</tbody></table>`;
  }
  function historyTable(rows) {
    if (!rows.length) return '<div class="empty">No closed trades yet</div>';
    return `<table class="tbl"><thead><tr><th>Closed</th><th>Market</th><th>Side</th><th class="r">Entry</th><th class="r">Exit</th><th class="r">Margin</th><th class="r">PnL</th><th class="r">Fee</th><th>Result</th><th>Reason</th></tr></thead><tbody>
      ${rows.map((o) => `<tr><td class="muted">${time(o.closed_at)}</td><td><b>${esc(o.symbol)}</b></td><td>${badge(o.side)} <span class="dim">${o.leverage}x</span></td>
        <td class="r num">${o.entry_price ? fmt(o.entry_price, o.decimals) : '—'}</td><td class="r num">${o.exit_price ? fmt(o.exit_price, o.decimals) : '—'}</td>
        <td class="r num">${fmt(o.margin)}</td><td class="r num ${cls(o.pnl)}">${o.pnl === null ? '—' : signed(o.pnl)}</td><td class="r num dim">${fmt(o.fee)}</td>
        <td>${o.status === 'cancelled' ? badge('cancelled') : badge(o.result)}</td><td>${o.close_reason ? badge(o.close_reason) : '—'}</td></tr>`).join('')}</tbody></table>`;
  }
  function txTable(rows) {
    if (!rows.length) return '<div class="empty">No transactions</div>';
    return `<table class="tbl"><thead><tr><th>Time</th><th>Type</th><th class="r">Amount</th><th class="r">Balance after</th><th>Status</th><th>Note</th></tr></thead><tbody>
      ${rows.map((t) => `<tr><td class="muted">${time(t.created_at)}</td><td>${badge(t.type)}</td><td class="r num ${cls(t.amount)}">${signed(t.amount)}</td>
        <td class="r num">${t.status === 'pending' ? '—' : fmt(t.balance_after)}</td><td>${badge(t.status)}</td><td class="muted">${esc(t.note || '')}${t.bank ? `<div class="dim small">${icon('landmark')} ${esc(t.bank.bank_name)} · ${esc(t.bank.account_number)}</div>` : ''}</td></tr>`).join('')}</tbody></table>`;
  }

  function renderBottom() {
    const pos = S.active.filter((o) => o.status === 'open');
    const pend = S.active.filter((o) => o.status === 'pending');
    $('#cPos').textContent = pos.length; $('#cOpen').textContent = pend.length;
    const box = $('#bottomTable');
    box.innerHTML = S.tab === 'positions' ? positionsTable(pos) : S.tab === 'open' ? openOrdersTable(pend) : S.tab === 'history' ? historyTable(S.history) : txTable(S.tx);
    box.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closePos(+b.dataset.close, b)));
    box.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => cancelOrder(+b.dataset.cancel, b)));
    updateLiveCells();
  }
  function updateLiveCells() {
    for (const tr of $$('#bottomTable tr[data-id]')) {
      const o = S.active.find((x) => x.id === +tr.dataset.id);
      if (!o) continue;
      const { pnl, mark } = livePnl(o);
      const m = S.markets.find((x) => x.id === o.market_id);
      tr.querySelector('[data-mark]').textContent = fmt(mark, m ? m.decimals : 2);
      const c = tr.querySelector('[data-pnl]');
      c.className = `r num ${cls(pnl)}`;
      c.textContent = `${signed(pnl)} (${pct(pnl / o.margin, 1)})`;
    }
  }
  async function closePos(id, btn) {
    try {
      await withBusy(btn, async () => {
        const o = await api(`/api/orders/${id}/close`, { method: 'POST' });
        toast(`Closed ${o.symbol}: ${signed(o.pnl)} USDT (${o.result})`, o.result === 'lose' ? 'warn' : 'ok');
      });
    } catch (e) { toast(e.message, 'err'); }
    await Promise.all([refreshUser(), loadActive()]);
    renderChartLines();
  }
  async function cancelOrder(id, btn) {
    try { await withBusy(btn, () => api(`/api/orders/${id}/cancel`, { method: 'POST' })); toast('Order cancelled'); }
    catch (e) { toast(e.message, 'err'); }
    await Promise.all([refreshUser(), loadActive()]);
    renderChartLines();
  }

  function renderChartLines() {
    const m = mkt();
    const lines = [];
    for (const o of S.active.filter((x) => x.market_id === m.id)) {
      if (o.status === 'pending') { lines.push({ price: o.limit_price, color: THEME.css('--amber'), label: `Limit ${o.side}` }); continue; }
      lines.push({ price: o.entry_price, color: THEME.css(o.side === 'long' ? '--green' : '--red'), label: `${o.side === 'long' ? 'Long' : 'Short'} ${o.leverage}x` });
      if (o.tp) lines.push({ price: o.tp, color: THEME.css('--blue'), label: 'TP' });
      if (o.sl) lines.push({ price: o.sl, color: '#ff9f43', label: 'SL' });
    }
    chart.setLines(lines);
  }

  // ---------------- timeframe ----------------
  $$('#tfSeg button').forEach((b) => b.addEventListener('click', () => {
    S.tf = +b.dataset.tf;
    $$('#tfSeg button').forEach((x) => x.classList.toggle('active', x === b));
    chart.setData(aggregateCandles(S.raw, S.tf));
  }));

  // ---------------- other views ----------------
  function renderMarkets() {
    $('#marketsTable').innerHTML = `<table class="tbl"><thead><tr><th>Market</th><th class="r">Price</th><th class="r">24h change</th><th class="r">24h high</th><th class="r">24h low</th><th class="r">Max leverage</th><th class="r">Fee</th><th></th></tr></thead><tbody>
      ${S.markets.map((m) => `<tr class="clickable" data-sym="${esc(m.symbol)}"><td><b>${esc(m.symbol)}</b> <span class="dim">${esc(m.name)}</span></td>
      <td class="r num">${pfmt(m.price, m)}</td><td class="r num ${cls(m.change24h)}">${pct(m.change24h)}</td>
      <td class="r num">${pfmt(m.high24h, m)}</td><td class="r num">${pfmt(m.low24h, m)}</td><td class="r num">${m.max_leverage}x</td>
      <td class="r num">${(m.fee_rate * 100).toFixed(3)}%</td><td class="r"><button class="btn btn-sm btn-ghost-green">Trade</button></td></tr>`).join('')}</tbody></table>`;
    $$('#marketsTable tr[data-sym]').forEach((tr) => tr.addEventListener('click', () => { selectMarket(tr.dataset.sym); location.hash = 'trade'; }));
  }

  function renderPortfolio() {
    const closed = S.history.filter((o) => o.status === 'closed');
    const wins = closed.filter((o) => o.result === 'win').length;
    const losses = closed.filter((o) => o.result === 'lose').length;
    const realized = closed.reduce((s, o) => s + o.pnl - o.fee, 0);
    const open = S.active.filter((o) => o.status === 'open');
    const upnl = open.reduce((s, o) => s + (livePnl(o).pnl || 0), 0);
    const locked = S.active.reduce((s, o) => s + o.margin, 0);
    const equity = S.user.balance + locked + upnl;
    const k = (label, value, sub = '', c = '', ic = '') => `<div class="card kpi"><div class="label">${ic ? icon(ic, 'kpi-i') : ''}<span>${label}</span></div><div class="value ${c}">${value}</div><div class="sub">${sub}</div></div>`;
    $('#pfKpis').innerHTML = [
      k('Equity', money(equity), 'Balance + margin + open PnL', '', 'landmark'),
      k('Available balance', money(S.user.balance), '', '', 'wallet'),
      k('Open PnL', signed(upnl), `${open.length} open position(s)`, cls(upnl), 'activity'),
      k('Realized PnL (net of fees)', signed(realized), `${closed.length} closed trades`, cls(realized), 'coins'),
      k('Win rate', closed.length ? `${((wins / closed.length) * 100).toFixed(1)}%` : '—', `<span class="up">${wins} win</span> · <span class="down">${losses} lose</span>`, '', 'trophy'),
    ].join('');
    $('#pfHistory').innerHTML = historyTable(S.history);
  }

  let wMode = 'deposit';
  $$('[data-w]').forEach((b) => b.addEventListener('click', () => {
    wMode = b.dataset.w;
    $$('[data-w]').forEach((x) => x.classList.toggle('active', x === b));
    $('#wBtn').textContent = wMode === 'deposit' ? 'Request deposit' : 'Request withdrawal';
    renderWalletMode();
  }));
  $('#wForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (needBank()) return goBank('Add your bank account first');
    try {
      await withBusy($('#wBtn'), () => api(`/api/wallet/${wMode}`, { method: 'POST', body: { amount: $('#wAmount').value, note: $('#wNote').value } }));
      toast(wMode === 'deposit' ? 'Deposit requested — pending admin approval' : 'Withdrawal requested — funds on hold until processed');
      $('#wAmount').value = ''; $('#wNote').value = '';
      await Promise.all([refreshUser(), loadTx()]);
      renderWallet();
    } catch (err) { if (err.code === 'BANK_REQUIRED') goBank(err.message); else toast(err.message, 'err'); }
  });
  function renderWallet() { $('#wTx').innerHTML = txTable(S.tx); }

  // ---------------- live prices ----------------
  function onTick({ prices }) {
    for (const m of S.markets) {
      const p = prices[m.symbol];
      if (!p) continue;
      m.price = p.p;
      m.high24h = Math.max(m.high24h, p.p); m.low24h = Math.min(m.low24h, p.p);
      if (m.symbol === S.symbol) {
        const last = S.raw[S.raw.length - 1];
        if (last && p.k.t - last.t > 120_000) { if (!S.reloading) { S.reloading = true; selectMarket(S.symbol).finally(() => { S.reloading = false; }); } continue; }
        if (last && last.t === p.k.t) Object.assign(last, p.k); else S.raw.push({ ...p.k });
        if (S.tf === 1) chart.update(p.k);
        else {
          const size = S.tf * 60_000, start = Math.floor(p.k.t / size) * size;
          const agg = aggregateCandles(S.raw.filter((c) => c.t >= start), S.tf)[0];
          if (agg) chart.update(agg);
        }
      }
    }
    const m = mkt();
    if (m) document.title = `${pfmt(m.price)} ${m.symbol} — ${S.settings.site_name || 'TradeV'}`;
    renderHeader();
    updateLiveCells();
    if (S.type === 'market') updateSummary();
    if (S.view === 'markets' && Math.random() < 0.34) renderMarkets();
  }
  // Order updates (fills, TP/SL, liquidations) by polling /api/updates.
  const seen = new Set();
  let updatesSince = Date.now();
  let updatesTimer;
  async function pollUpdates() {
    clearTimeout(updatesTimer);
    try {
      const u = await api(`/api/updates?since=${updatesSince - 2000}`);
      updatesSince = u.t;
      if (S.user && u.balance !== S.user.balance) { S.user.balance = u.balance; refreshUser().catch(() => {}); }
      let changed = false;
      for (const o of u.orders.slice().reverse()) {
        const key = `${o.id}:${o.status}`;
        if (seen.has(key)) continue;
        seen.add(key);
        changed = true;
        if (o.status === 'closed' && o.close_reason !== 'manual') {
          const why = { tp: 'Take profit hit', sl: 'Stop loss hit', liquidation: 'Liquidated', admin: 'Closed by admin' }[o.close_reason] || 'Closed';
          toast(`${why}: ${o.symbol} ${signed(o.pnl)} USDT`, o.result === 'win' ? 'ok' : 'warn');
        }
        if (o.status === 'open' && o.type === 'limit') toast(`Limit order filled: ${o.symbol} at ${fmt(o.entry_price, o.decimals)}`);
      }
      if (changed) {
        await Promise.all([loadActive(), S.tab === 'history' || S.view === 'portfolio' ? loadHistory() : null]);
        renderChartLines();
        if (S.view === 'portfolio') renderPortfolio();
      }
    } catch { /* offline: try again later */ }
    updatesTimer = setTimeout(pollUpdates, document.hidden ? 15000 : 3000);
  }

  // ---------------- boot ----------------
  async function boot() {
    await loadSettings();
    if (!store.get()) { $('#auth').classList.remove('hidden'); $('#app').classList.add('hidden'); return; }
    try { await refreshUser(); } catch { store.clear(); $('#auth').classList.remove('hidden'); return; }
    await loadSettings(); // signed-in view adds deposit account, limits, support contact
    $('#auth').classList.add('hidden');
    $('#app').classList.remove('hidden');
    if (!chart) chart = new CandleChart($('#chart'));
    S.markets = await api('/api/markets');
    if (!S.markets.find((m) => m.symbol === S.symbol)) S.symbol = S.markets[0]?.symbol;
    await selectMarket(S.symbol);
    await loadActive();
    renderChartLines();
    showView();
    // mark what we already know so the first poll doesn't toast old events
    for (const o of S.active) seen.add(`${o.id}:${o.status}`);
    if (live) live.close();
    live = TV.poll({ tick: onTick, status: (ok) => $('#liveDot').classList.toggle('on', ok) });
    if (needBank() && !sessionStorage.getItem('tv_bank_prompted')) {
      sessionStorage.setItem('tv_bank_prompted', '1');
      goBank('Add your bank account to start trading');
    }
    pollUpdates();
    setInterval(loadSettings, 60_000);
  }
  boot();
})();
