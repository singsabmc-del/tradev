/* Shared helpers for the trader app and admin panel. */
'use strict';

const TV = (() => {
  const TOKEN_KEY = document.body.dataset.tokenKey || 'tradev_token';
  const store = {
    get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
    set: (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch {} },
    clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch {} },
  };

  async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'content-type': 'application/json' };
    const t = store.get();
    if (t) headers.authorization = `Bearer ${t}`;
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && t) { store.clear(); window.dispatchEvent(new Event('tv:logout')); }
    if (!res.ok) { const err = new Error(data.error || `Request failed (${res.status})`); err.code = data.code; throw err; }
    return data;
  }

  const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(+v)) ? '—'
    : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const money = (v, d = 2) => (v === null || v === undefined) ? '—' : `${v < 0 ? '-' : ''}$${fmt(Math.abs(v), d)}`;
  const signed = (v, d = 2) => (v === null || v === undefined) ? '—' : `${v > 0 ? '+' : v < 0 ? '-' : ''}${fmt(Math.abs(v), d)}`;
  const pct = (v, d = 2) => (v === null || v === undefined) ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`;
  const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const time = (s) => {
    if (!s) return '—';
    const d = new Date(s);
    const locale = window.I18N ? I18N.locale : undefined;
    return d.toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const badge = (t, extra = '') => `<span class="badge ${esc(t)} ${extra}">${esc(String(t ?? '—').replace('_', ' '))}</span>`;

  function toast(msg, kind = 'ok') {
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = `toast ${kind === 'err' ? 'err' : kind === 'warn' ? 'warn' : ''}`;
    el.innerHTML = icon(kind === 'err' ? 'circle-exclamation-point' : kind === 'warn' ? 'info' : 'circle-check', 'toast-i');
    const span = document.createElement('span'); span.textContent = msg; el.appendChild(span);
    box.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function modal(html, onMount) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="modal">${html}</div>`;
    const close = () => ov.remove();
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
    document.body.appendChild(ov);
    ov.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    if (onMount) onMount(ov.querySelector('.modal'), close);
    return close;
  }

  function confirmBox(title, text, { okText = 'Confirm', danger = false } = {}) {
    return new Promise((resolve) => {
      let done = false;
      modal(`<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
        <div class="actions"><button class="btn" data-close>Cancel</button>
        <button class="btn ${danger ? 'btn-red' : 'btn-green'}" data-ok>${esc(okText)}</button></div>`, (m, close) => {
        m.querySelector('[data-ok]').onclick = () => { done = true; close(); resolve(true); };
        const obs = new MutationObserver(() => { if (!document.body.contains(m)) { obs.disconnect(); if (!done) resolve(false); } });
        obs.observe(document.body, { childList: true });
      });
    });
  }

  // Live prices by polling /api/ticker (works on serverless hosts; the CDN caches it for 1s).
  // Slows down while the tab is hidden.
  function poll(handlers, { every = 1500, hiddenEvery = 10000 } = {}) {
    let timer = null, stopped = false, busy = false;
    const run = async () => {
      if (stopped) return;
      if (!busy) {
        busy = true;
        try {
          const res = await fetch('/api/ticker');
          if (!res.ok) throw new Error(res.status);
          handlers.tick && handlers.tick(await res.json());
          handlers.status && handlers.status(true);
        } catch { handlers.status && handlers.status(false); }
        busy = false;
      }
      timer = setTimeout(run, document.hidden ? hiddenEvery : every);
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !stopped) { clearTimeout(timer); run(); } });
    run();
    return { close: () => { stopped = true; clearTimeout(timer); } };
  }

  async function withBusy(btn, fn) {
    const prev = btn.innerHTML;
    btn.disabled = true;
    try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = prev; }
  }

  // Lucide icons (public/icons.js)
  const ICONS = {
    trade: icon('chart-candlestick'), markets: icon('chart-line'), portfolio: icon('chart-pie'), wallet: icon('wallet'),
    dashboard: icon('layout-dashboard'), users: icon('users'), tx: icon('arrow-left-right'), orders: icon('receipt-text'),
    admin: icon('shield-check'), logout: icon('log-out'), settings: icon('settings'), notify: icon('bell'), account: icon('user-round'),
  };

  return { api, store, fmt, money, signed, pct, cls, time, esc, badge, toast, modal, confirmBox, poll, withBusy, ICONS };
})();
