/* TradeV admin back office */
'use strict';
(() => {
  const { api, store, fmt, money, signed, pct, cls, time, esc, badge, toast, modal, confirmBox, withBusy, ICONS } = TV;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const main = $('#main');
  const S = { me: null, view: 'dashboard', markets: [], prices: {}, orders: [], drawerUser: null };
  let refreshTimer;

  // ---------- auth ----------
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#authErr').textContent = '';
    try {
      await withBusy($('#authBtn'), async () => {
        const r = await api('/api/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        if (r.user.role !== 'admin') throw new Error('This account is not an administrator');
        store.set(r.token);
        await boot();
      });
    } catch (err) { $('#authErr').textContent = err.message; }
  });
  $('#logout').addEventListener('click', () => { store.clear(); location.reload(); });
  window.addEventListener('tv:logout', () => location.reload());

  // ---------- nav ----------
  const NAV = { dashboard: ['dashboard', 'Dashboard'], markets: ['markets', 'Markets'], customers: ['users', 'Customers'], transactions: ['tx', 'Transactions'], orders: ['orders', 'Orders'] };
  for (const [v, [icon, label]] of Object.entries(NAV)) {
    const b = $(`[data-view="${v}"]`);
    b.innerHTML = `${ICONS[icon]}<span>${label}</span><span class="badge pending hidden" data-badge="${v}"></span>`;
    b.addEventListener('click', () => { location.hash = v; });
  }
  $('#toApp').innerHTML = `${ICONS.trade}<span>Trading app</span>`;
  window.addEventListener('hashchange', route);
  window.addEventListener('tv:lang', () => { if (S.me) route(); });
  function route() {
    const v = (location.hash || '#dashboard').slice(1);
    S.view = NAV[v] ? v : 'dashboard';
    $$('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === S.view));
    clearInterval(refreshTimer);
    ({ dashboard: viewDashboard, markets: viewMarkets, customers: viewCustomers, transactions: viewTransactions, orders: viewOrders })[S.view]();
  }

  const title = (t, right = '') => `<h1 class="page-title">${t}<span style="margin-left:auto" class="row">${right}</span></h1>`;
  const kpi = (label, value, sub = '', c = '', ic = '') => `<div class="card kpi"><div class="label">${ic ? icon(ic, 'kpi-i') : ''}<span>${label}</span></div><div class="value ${c}">${value}</div><div class="sub">${sub}</div></div>`;
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const dec = (o) => (o.decimals ?? 2);

  // ---------- shared tables ----------
  function ordersTable(rows, { showUser = true } = {}) {
    if (!rows.length) return '<div class="empty">No orders match</div>';
    return `<table class="tbl"><thead><tr><th>#</th>${showUser ? '<th>Customer</th>' : ''}<th>Market</th><th>Side</th><th>Status</th><th class="r">Margin</th><th class="r">Entry</th><th class="r">Exit / Mark</th><th class="r">PnL</th><th>Result</th><th>Reason</th><th>Opened</th><th>Closed</th><th></th></tr></thead><tbody>
    ${rows.map((o) => {
      const isOpen = o.status === 'open';
      const pnl = isOpen ? o.unrealized_pnl : o.pnl;
      return `<tr data-oid="${o.id}"><td class="dim">${o.id}</td>
      ${showUser ? `<td><a href="#" data-user="${o.user_id}">${esc(o.user_name || o.user_email)}</a><div class="dim small">${esc(o.user_email)}</div></td>` : ''}
      <td><b>${esc(o.symbol)}</b></td><td>${badge(o.side)} <span class="dim">${o.leverage}x · ${o.type}</span></td><td>${badge(o.status)}</td>
      <td class="r num">${fmt(o.margin)}</td>
      <td class="r num">${o.entry_price ? fmt(o.entry_price, dec(o)) : o.limit_price ? `<span class="dim">lmt</span> ${fmt(o.limit_price, dec(o))}` : '—'}</td>
      <td class="r num" data-mark>${isOpen ? fmt(o.mark_price, dec(o)) : o.exit_price ? fmt(o.exit_price, dec(o)) : '—'}</td>
      <td class="r num ${cls(pnl)}" data-pnl>${pnl === null || pnl === undefined ? '—' : signed(pnl)}</td>
      <td>${o.result ? badge(o.result) : isOpen ? '<span class="dim">live</span>' : '—'}</td><td>${o.close_reason ? badge(o.close_reason) : '—'}</td>
      <td class="muted">${time(o.opened_at || o.created_at)}</td><td class="muted">${time(o.closed_at)}</td>
      <td class="r">${isOpen ? `<button class="btn btn-sm btn-ghost-red btn-icon" data-fclose="${o.id}">${icon('circle-x')}<span>Force close</span></button>` : o.status === 'pending' ? `<button class="btn btn-sm" data-fcancel="${o.id}">Cancel</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  function txTable(rows, { showUser = true } = {}) {
    if (!rows.length) return '<div class="empty">No transactions match</div>';
    return `<table class="tbl"><thead><tr><th>#</th><th>Time</th>${showUser ? '<th>Customer</th>' : ''}<th>Type</th><th class="r">Amount</th><th class="r">Balance after</th><th>Status</th><th>Note</th><th></th></tr></thead><tbody>
    ${rows.map((t) => `<tr><td class="dim">${t.id}</td><td class="muted">${time(t.created_at)}</td>
      ${showUser ? `<td><a href="#" data-user="${t.user_id}">${esc(t.user_name || t.user_email)}</a><div class="dim small">${esc(t.user_email)}</div></td>` : ''}
      <td>${badge(t.type)}</td><td class="r num ${cls(t.amount)}">${signed(t.amount)}</td>
      <td class="r num">${t.status === 'pending' ? '—' : fmt(t.balance_after)}</td><td>${badge(t.status)}</td><td class="muted">${esc(t.note || '')}</td>
      <td class="r">${t.status === 'pending' ? `<button class="btn btn-sm btn-ghost-green btn-icon" data-approve="${t.id}">${icon('check')}<span>Approve</span></button> <button class="btn btn-sm btn-ghost-red btn-icon" data-reject="${t.id}">${icon('x')}<span>Reject</span></button>` : ''}</td></tr>`).join('')}</tbody></table>`;
  }
  // Wire actions inside a container; `after` reloads the current data.
  function wire(el, after) {
    el.querySelectorAll('[data-user]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openCustomer(+a.dataset.user); }));
    el.querySelectorAll('[data-approve],[data-reject]').forEach((b) => b.addEventListener('click', async () => {
      const approve = !!b.dataset.approve;
      const id = b.dataset.approve || b.dataset.reject;
      if (!(await confirmBox(`${approve ? 'Approve' : 'Reject'} transaction #${id}?`, approve ? 'Deposits are credited to the customer balance. Withdrawals are marked as paid out.' : 'Deposits are discarded. Withdrawals are refunded to the customer balance.', { okText: approve ? 'Approve' : 'Reject', danger: !approve }))) return;
      try { await api(`/api/admin/transactions/${id}/${approve ? 'approve' : 'reject'}`, { method: 'POST' }); toast(`Transaction #${id} ${approve ? 'approved' : 'rejected'}`); }
      catch (e) { toast(e.message, 'err'); }
      after(); loadBadges();
    }));
    el.querySelectorAll('[data-fclose]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmBox(`Force close position #${b.dataset.fclose}?`, 'It will be settled at the current market price.', { okText: 'Close position', danger: true }))) return;
      try { const o = await api(`/api/admin/orders/${b.dataset.fclose}/close`, { method: 'POST' }); toast(`Closed #${o.id}: ${signed(o.pnl)} (${o.result})`); }
      catch (e) { toast(e.message, 'err'); }
      after();
    }));
    el.querySelectorAll('[data-fcancel]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/api/admin/orders/${b.dataset.fcancel}/cancel`, { method: 'POST' }); toast('Order cancelled and refunded'); }
      catch (e) { toast(e.message, 'err'); }
      after();
    }));
  }

  // ---------- dashboard ----------
  async function viewDashboard() {
    main.innerHTML = title('Dashboard', '<span class="dim small" id="sheetsStatus"></span><span class="dim small">Auto-refreshes every 10s</span>') + '<div id="dash" class="empty">Loading…</div>';
    const load = async () => {
      const [s, pending, recent] = await Promise.all([
        api('/api/admin/stats'), api('/api/admin/transactions?status=pending'), api('/api/admin/orders?status=closed'),
      ]);
      if (S.view !== 'dashboard') return;
      const wr = s.wins + s.losses ? s.wins / (s.wins + s.losses) : 0;
      const house = Number(s.fees) - Number(s.customer_pnl) - Number(s.unrealized_pnl);
      $('#dash').outerHTML = `<div id="dash">
        <div class="kpis">
          ${kpi('Customers', fmt(s.customers, 0), `${s.active_customers} active`, '', 'users')}
          ${kpi('Customer balances', money(s.customer_balances), `+ ${money(s.open_margin)} in open margin`, '', 'wallet')}
          ${kpi('Open positions', fmt(s.open_positions, 0), `${s.pending_orders} pending limit orders`, '', 'layers')}
          ${kpi('Unrealized customer PnL', signed(s.unrealized_pnl), 'live, marked to market', cls(s.unrealized_pnl), 'activity')}
          ${kpi('Closed trades', fmt(s.closed_trades, 0), `<span class="up">${s.wins} win</span> · <span class="down">${s.losses} lose</span><div class="winbar"><div style="width:${(wr * 100).toFixed(1)}%"></div></div>`, '', 'receipt-text')}
          ${kpi('Customer win rate', s.wins + s.losses ? `${(wr * 100).toFixed(1)}%` : '—', '', '', 'trophy')}
          ${kpi('Realized customer PnL', signed(s.customer_pnl), 'before fees', cls(s.customer_pnl), 'coins')}
          ${kpi('Fees collected', money(s.fees), '', '', 'percent')}
          ${kpi('House result', signed(house), 'fees − customer PnL (incl. open)', cls(house), 'scale')}
          ${kpi('Trading volume', money(s.volume, 0), 'notional, all time', '', 'chart-column')}
        </div>
        <div class="two">
          <div class="card"><div class="card-pad"><h3>Pending requests (${pending.length})</h3></div><div class="table-wrap tbl-scroll" id="dPend">${txTable(pending)}</div></div>
          <div class="card"><div class="card-pad"><h3>By market</h3></div><div class="table-wrap">
            <table class="tbl"><thead><tr><th>Market</th><th class="r">Trades</th><th class="r">Volume</th><th class="r">Win / Lose</th><th class="r">Customer PnL</th></tr></thead><tbody>
            ${s.by_market.map((m) => `<tr><td><b>${esc(m.symbol)}</b></td><td class="r num">${m.trades}</td><td class="r num">${fmt(m.volume, 0)}</td>
              <td class="r num"><span class="up">${m.wins}</span> / <span class="down">${m.losses}</span></td><td class="r num ${cls(m.customer_pnl)}">${signed(m.customer_pnl)}</td></tr>`).join('')}
            </tbody></table></div></div>
        </div>
        <div class="card mt"><div class="card-pad"><h3>Latest closed trades</h3></div><div class="table-wrap tbl-scroll" id="dRecent">${ordersTable(recent.slice(0, 25))}</div></div>
      </div>`;
      wire($('#dash'), load);
      renderSheets(s.sheets);
    };
    await load().catch((e) => toast(e.message, 'err'));
    refreshTimer = setInterval(() => load().catch(() => {}), 10_000);
  }

  function renderSheets(st) {
    const el = $('#sheetsStatus');
    if (!el || !st) return;
    if (!st.enabled) { el.innerHTML = 'Google Sheets: <span class="dim">not configured</span> ·'; return; }
    const state = st.lastError
      ? `<span class="down" title="${esc(st.lastError)}">error</span>`
      : st.lastOk ? `<span class="up">synced ${time(st.lastOk)}</span>` : '<span class="dim">waiting…</span>';
    el.innerHTML = `Google Sheets: ${state} <button class="btn btn-sm btn-icon" id="syncNow">${icon('refresh-cw')}<span>Sync now</span></button> ·`;
    $('#syncNow').onclick = async (e) => {
      try { renderSheets(await withBusy(e.target, () => api('/api/admin/sheets/sync', { method: 'POST' }))); toast('Google Sheet updated'); }
      catch (err) { toast(err.message, 'err'); }
    };
  }

  // ---------- markets ----------
  async function viewMarkets() {
    main.innerHTML = title('Markets', `<button class="btn btn-green btn-icon" id="newMarket">${icon('plus')}<span>New market</span></button>`) +
      '<p class="hint">Volatility is the per-second standard deviation of price moves; drift biases the trend (positive = up). Changing the price moves the live market instantly.</p>' +
      '<div class="card"><div class="table-wrap" id="mTable"><div class="empty">Loading…</div></div></div>';
    $('#newMarket').addEventListener('click', () => marketForm());
    S.markets = await api('/api/admin/markets');
    renderMarkets();
  }
  function renderMarkets() {
    const box = $('#mTable');
    if (!box) return;
    box.innerHTML = `<table class="tbl"><thead><tr><th>Market</th><th class="r">Price</th><th class="r">24h</th><th class="r">Volatility</th><th class="r">Drift</th><th class="r">Max lev.</th><th class="r">Fee</th><th class="r">Min margin</th><th>Status</th><th></th></tr></thead><tbody>
      ${S.markets.map((m) => `<tr><td><b>${esc(m.symbol)}</b> <span class="dim">${esc(m.name)}</span></td>
        <td class="r num" data-mp="${esc(m.symbol)}">${fmt(m.price, m.decimals)}</td><td class="r num ${cls(m.change24h)}">${pct(m.change24h)}</td>
        <td class="r num">${m.volatility}</td><td class="r num ${cls(m.drift)}">${m.drift}</td><td class="r num">${m.max_leverage}x</td>
        <td class="r num">${(m.fee_rate * 100).toFixed(3)}%</td><td class="r num">${fmt(m.min_margin)}</td>
        <td>${badge(m.enabled ? 'active' : 'suspended')}</td>
        <td class="r"><button class="btn btn-sm btn-icon" data-edit="${m.id}">${icon('pencil')}<span>Edit</span></button>
          <button class="btn btn-sm ${m.enabled ? 'btn-ghost-red' : 'btn-ghost-green'}" data-toggle="${m.id}">${m.enabled ? 'Disable' : 'Enable'}</button></td></tr>`).join('')}
      </tbody></table>`;
    box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => marketForm(S.markets.find((m) => m.id === +b.dataset.edit))));
    box.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      const m = S.markets.find((x) => x.id === +b.dataset.toggle);
      try { await api(`/api/admin/markets/${m.id}`, { method: 'PATCH', body: { enabled: !m.enabled } }); toast(`${m.symbol} ${m.enabled ? 'disabled' : 'enabled'}`); }
      catch (e) { toast(e.message, 'err'); }
      S.markets = await api('/api/admin/markets'); renderMarkets();
    }));
  }
  function marketForm(m) {
    const f = (name, label, val, attrs = '') => `<label class="field"><span>${label}</span><input class="input num" name="${name}" value="${esc(val ?? '')}" ${attrs} /></label>`;
    modal(`<h2>${m ? `Edit ${esc(m.symbol)}` : 'New market'}</h2><form id="mf">
      ${m ? '' : f('symbol', 'Symbol (BASE/QUOTE)', '', 'placeholder="DOGE/USDT" required')}
      ${f('name', 'Display name', m?.name)}
      <div class="grid2">${f('price', m ? 'Price (set to move market)' : 'Starting price', m ? m.price : '', 'required')}${f('decimals', 'Price decimals', m?.decimals ?? 2)}</div>
      <div class="grid2">${f('volatility', 'Volatility (per second)', m?.volatility ?? 0.0005)}${f('drift', 'Drift / trend (per second)', m?.drift ?? 0)}</div>
      <div class="grid2">${f('max_leverage', 'Max leverage', m?.max_leverage ?? 50)}${f('fee_rate', 'Fee rate (0.0005 = 0.05%)', m?.fee_rate ?? 0.0005)}</div>
      ${f('min_margin', 'Minimum margin (USDT)', m?.min_margin ?? 1)}
      <label class="row mb"><label class="switch"><input type="checkbox" name="enabled" ${!m || m.enabled ? 'checked' : ''}/><span></span></label> Enabled for trading</label>
      <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-green" id="mSave">${m ? 'Save changes' : 'Create market'}</button></div></form>`,
    (el, close) => {
      $('#mf', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target));
        body.enabled = !!e.target.enabled.checked;
        if (m && Number(body.price) === Number(m.price)) delete body.price;
        try {
          await withBusy($('#mSave', el), () => api(m ? `/api/admin/markets/${m.id}` : '/api/admin/markets', { method: m ? 'PATCH' : 'POST', body }));
          toast(m ? 'Market updated' : 'Market created');
          close();
          S.markets = await api('/api/admin/markets'); renderMarkets();
        } catch (err) { toast(err.message, 'err'); }
      });
    });
  }

  // ---------- customers ----------
  async function viewCustomers() {
    main.innerHTML = title('Customers') + `<div class="toolbar">
      <label class="search">${icon('search')}<input class="input" id="q" placeholder="Search name or email…" /></label>
      <select class="input" id="fRole">${opts([['', 'All roles'], ['customer', 'Customers'], ['admin', 'Admins']], 'customer')}</select>
      <select class="input" id="fStatus">${opts([['', 'Any status'], ['active', 'Active'], ['suspended', 'Suspended']])}</select>
      <button class="btn btn-icon" id="addUser">${icon('user-plus')}<span>Add customer</span></button></div>
      <div class="card"><div class="table-wrap tbl-scroll" id="uTable"><div class="empty">Loading…</div></div></div>`;
    let t;
    $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(loadUsers, 250); });
    $('#fRole').addEventListener('change', loadUsers);
    $('#fStatus').addEventListener('change', loadUsers);
    $('#addUser').addEventListener('click', addUser);
    await loadUsers();
  }
  async function loadUsers() {
    const qs = new URLSearchParams({ q: $('#q').value, role: $('#fRole').value, status: $('#fStatus').value });
    const users = await api(`/api/admin/users?${qs}`);
    if (!$('#uTable')) return;
    $('#uTable').innerHTML = users.length ? `<table class="tbl"><thead><tr><th>#</th><th>Name</th><th>Email</th><th class="r">Balance</th><th class="r">Trades</th><th class="r">Win / Lose</th><th class="r">Win rate</th><th class="r">Total PnL</th><th class="r">Open</th><th>Status</th><th>Joined</th><th>Last login</th></tr></thead><tbody>
      ${users.map((u) => `<tr class="clickable" data-uid="${u.id}"><td class="dim">${u.id}</td><td><b>${esc(u.name)}</b> ${u.role === 'admin' ? badge('admin') : ''}</td><td class="muted">${esc(u.email)}</td>
        <td class="r num">${fmt(u.balance)}</td><td class="r num">${u.trades}</td><td class="r num"><span class="up">${u.wins}</span> / <span class="down">${u.losses}</span></td>
        <td class="r num">${u.wins + u.losses ? `${((u.wins / (u.wins + u.losses)) * 100).toFixed(0)}%` : '—'}</td>
        <td class="r num ${cls(u.total_pnl)}">${signed(u.total_pnl)}</td><td class="r num">${u.open_positions}</td><td>${badge(u.status)}</td>
        <td class="muted">${time(u.created_at)}</td><td class="muted">${time(u.last_login_at)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No customers found</div>';
    $$('#uTable [data-uid]').forEach((tr) => tr.addEventListener('click', () => openCustomer(+tr.dataset.uid)));
  }
  function addUser() {
    modal(`<h2>Add customer</h2><form id="af">
      <label class="field"><span>Full name</span><input class="input" name="name" required /></label>
      <label class="field"><span>Email</span><input class="input" name="email" type="email" required /></label>
      <label class="field"><span>Temporary password</span><input class="input" name="password" minlength="8" required /></label>
      <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-green" id="aSave">Create</button></div></form>`, (el, close) => {
      $('#af', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          // register through the public endpoint without touching the admin session
          const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          toast(`Customer ${data.user.email} created`); close(); loadUsers();
        } catch (err) { toast(err.message, 'err'); }
      });
    });
  }

  async function openCustomer(id) {
    let drawer = $('.drawer');
    if (!drawer) {
      const ov = document.createElement('div');
      ov.className = 'overlay'; ov.style.justifyContent = 'flex-end';
      ov.innerHTML = '<div class="drawer"></div>';
      ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeDrawer(); });
      document.body.appendChild(ov);
      drawer = $('.drawer', ov);
    }
    drawer.innerHTML = '<div class="empty">Loading…</div>';
    const { user: u, orders, transactions } = await api(`/api/admin/users/${id}`);
    S.drawerUser = id;
    const wr = u.wins + u.losses ? `${((u.wins / (u.wins + u.losses)) * 100).toFixed(1)}%` : '—';
    const mk = (l, v, c = '') => `<div class="card"><div class="label">${l}</div><div class="value ${c}">${v}</div></div>`;
    drawer.innerHTML = `
      <div class="row"><div><h2>${esc(u.name)} ${badge(u.role === 'admin' ? 'admin' : 'customer')} ${badge(u.status)}</h2><div class="muted">${esc(u.email)} · #${u.id} · joined ${time(u.created_at)} · last login ${time(u.last_login_at)}</div></div>
      <button class="btn close-x btn-icon" id="dClose" title="Close">${icon('x')}</button></div>
      <div class="mini-kpis">${mk('Balance', fmt(u.balance))}${mk('Closed trades', u.trades)}${mk('Wins', u.wins, 'up')}${mk('Losses', u.losses, 'down')}${mk('Win rate', wr)}${mk('Total PnL', signed(u.total_pnl), cls(u.total_pnl))}${mk('Open positions', u.open_positions)}</div>
      <div class="two">
        <form class="card card-pad" id="pf"><h3>Profile</h3>
          <div class="grid2"><label class="field"><span>Name</span><input class="input" name="name" value="${esc(u.name)}" /></label>
          <label class="field"><span>Email</span><input class="input" name="email" value="${esc(u.email)}" /></label></div>
          <div class="grid2"><label class="field"><span>Status</span><select class="input" name="status">${opts([['active', 'Active'], ['suspended', 'Suspended']], u.status)}</select></label>
          <label class="field"><span>Role</span><select class="input" name="role">${opts([['customer', 'Customer'], ['admin', 'Admin']], u.role)}</select></label></div>
          <label class="field"><span>New password (leave blank to keep)</span><input class="input" name="password" type="text" autocomplete="off" /></label>
          <button class="btn btn-green" id="pSave">Save profile</button></form>
        <form class="card card-pad" id="bf"><h3>Adjust balance</h3>
          <p class="hint" style="margin:0 0 12px">Positive to credit, negative to debit. Recorded as an "adjustment" transaction.</p>
          <label class="field"><span>Amount (USDT)</span><input class="input num" name="amount" placeholder="e.g. 500 or -200" required /></label>
          <label class="field"><span>Reason</span><input class="input" name="note" placeholder="Bonus, correction, …" maxlength="80" /></label>
          <button class="btn btn-green" id="bSave">Apply adjustment</button></form>
      </div>
      <div class="tabs mt" id="dTabs"><button class="tab active" data-t="orders">Orders (${orders.length})</button><button class="tab" data-t="tx">Transactions (${transactions.length})</button></div>
      <div class="card"><div class="table-wrap tbl-scroll" id="dBody"></div></div>`;
    const showTab = (t) => {
      $$('#dTabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.t === t));
      $('#dBody').innerHTML = t === 'orders' ? ordersTable(orders, { showUser: false }) : txTable(transactions, { showUser: false });
      wire($('#dBody'), () => openCustomer(id));
    };
    $$('#dTabs .tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.t)));
    showTab('orders');
    $('#dClose').addEventListener('click', closeDrawer);
    $('#pf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      if (!body.password) delete body.password;
      try { await withBusy($('#pSave'), () => api(`/api/admin/users/${id}`, { method: 'PATCH', body })); toast('Profile saved'); openCustomer(id); refreshList(); }
      catch (err) { toast(err.message, 'err'); }
    });
    $('#bf').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await withBusy($('#bSave'), () => api(`/api/admin/users/${id}/adjust`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) })); toast('Balance adjusted'); openCustomer(id); refreshList(); }
      catch (err) { toast(err.message, 'err'); }
    });
  }
  function closeDrawer() { const d = $('.drawer'); if (d) d.parentElement.remove(); S.drawerUser = null; }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('.modal')) closeDrawer(); });
  function refreshList() { if (S.view === 'customers') loadUsers(); }

  // ---------- transactions ----------
  async function viewTransactions() {
    main.innerHTML = title('Transactions') + `<div class="toolbar">
      <select class="input" id="tType">${opts([['', 'All types'], ['deposit', 'Deposit'], ['withdrawal', 'Withdrawal'], ['adjustment', 'Adjustment'], ['bonus', 'Bonus'], ['trade_margin', 'Trade margin'], ['trade_fee', 'Trade fee'], ['trade_settle', 'Trade settlement'], ['order_refund', 'Order refund']])}</select>
      <select class="input" id="tStatus">${opts([['', 'Any status'], ['pending', 'Pending'], ['completed', 'Completed'], ['rejected', 'Rejected']], location.search.includes('pending') ? 'pending' : '')}</select></div>
      <div class="card"><div class="table-wrap tbl-scroll" id="tTable"><div class="empty">Loading…</div></div></div>`;
    const load = async () => {
      const rows = await api(`/api/admin/transactions?${new URLSearchParams({ type: $('#tType').value, status: $('#tStatus').value })}`);
      if (!$('#tTable')) return;
      $('#tTable').innerHTML = txTable(rows);
      wire($('#tTable'), load);
    };
    $('#tType').addEventListener('change', load);
    $('#tStatus').addEventListener('change', load);
    await load();
  }

  // ---------- orders ----------
  async function viewOrders() {
    main.innerHTML = title('Orders & positions') + `<div class="toolbar">
      <select class="input" id="oStatus">${opts([['', 'Any status'], ['open', 'Open positions'], ['pending', 'Pending limit'], ['closed', 'Closed'], ['cancelled', 'Cancelled']])}</select>
      <select class="input" id="oResult">${opts([['', 'Win & lose'], ['win', 'Win only'], ['lose', 'Lose only'], ['even', 'Break-even']])}</select>
      <select class="input" id="oSymbol"><option value="">All markets</option></select>
      <select class="input" id="oSide">${opts([['', 'Long & short'], ['long', 'Long'], ['short', 'Short']])}</select>
      <span class="muted" id="oSummary"></span></div>
      <div class="card"><div class="table-wrap tbl-scroll" id="oTable"><div class="empty">Loading…</div></div></div>`;
    S.markets = await api('/api/admin/markets');
    $('#oSymbol').innerHTML += S.markets.map((m) => `<option>${esc(m.symbol)}</option>`).join('');
    const load = async () => {
      const qs = new URLSearchParams({ status: $('#oStatus').value, result: $('#oResult').value, symbol: $('#oSymbol').value, side: $('#oSide').value });
      S.orders = await api(`/api/admin/orders?${qs}`);
      if (!$('#oTable')) return;
      const closed = S.orders.filter((o) => o.status === 'closed');
      const wins = closed.filter((o) => o.result === 'win').length, losses = closed.filter((o) => o.result === 'lose').length;
      const net = closed.reduce((s, o) => s + o.pnl, 0);
      $('#oSummary').innerHTML = `${S.orders.length} orders · <span class="up">${wins} win</span> · <span class="down">${losses} lose</span> · customer PnL <span class="${cls(net)}">${signed(net)}</span>`;
      $('#oTable').innerHTML = ordersTable(S.orders);
      wire($('#oTable'), load);
    };
    for (const id of ['oStatus', 'oResult', 'oSymbol', 'oSide']) $(`#${id}`).addEventListener('change', load);
    await load();
    refreshTimer = setInterval(() => { if (!$('.overlay')) load().catch(() => {}); }, 15_000);
  }

  // ---------- live ----------
  function onTick({ prices }) {
    S.prices = prices;
    if (S.view === 'markets') {
      for (const m of S.markets) {
        const p = prices[m.symbol]; if (!p) continue;
        m.price = p.p;
        const c = $(`[data-mp="${CSS.escape(m.symbol)}"]`); if (c) c.textContent = fmt(p.p, m.decimals);
      }
    }
    // live PnL on any visible open-order rows
    for (const tr of $$('tr[data-oid]')) {
      const o = (S.orders || []).find((x) => x.id === +tr.dataset.oid);
      if (!o || o.status !== 'open') continue;
      const p = prices[o.symbol]; if (!p) continue;
      const pnl = Math.max((o.side === 'long' ? p.p - o.entry_price : o.entry_price - p.p) * o.size, -o.margin);
      tr.querySelector('[data-mark]').textContent = fmt(p.p, dec(o));
      const c = tr.querySelector('[data-pnl]'); c.textContent = signed(pnl); c.className = `r num ${cls(pnl)}`;
    }
  }
  async function loadBadges() {
    try {
      const pend = await api('/api/admin/transactions?status=pending');
      const b = $('[data-badge="transactions"]');
      b.textContent = pend.length; b.classList.toggle('hidden', !pend.length);
    } catch {}
  }

  // ---------- boot ----------
  async function boot() {
    if (!store.get()) { $('#auth').classList.remove('hidden'); return; }
    try {
      S.me = await api('/api/me');
      if (S.me.role !== 'admin') throw new Error('not admin');
    } catch { store.clear(); $('#auth').classList.remove('hidden'); return; }
    $('#auth').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#uName').textContent = S.me.name; $('#uEmail').textContent = S.me.email;
    route();
    loadBadges();
    setInterval(loadBadges, 20_000);
    TV.poll({ tick: onTick }, { every: 2000 });
  }
  boot();
})();
