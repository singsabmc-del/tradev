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
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
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
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const badge = (t, extra = '') => `<span class="badge ${esc(t)} ${extra}">${esc(String(t ?? '—').replace('_', ' '))}</span>`;

  function toast(msg, kind = 'ok') {
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = `toast ${kind === 'err' ? 'err' : kind === 'warn' ? 'warn' : ''}`;
    el.textContent = msg;
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

  const ICONS = {
    trade: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 17l5-5 4 4 7-8"/><path d="M15 8h5v5"/></svg>',
    markets: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="9" r="5"/><circle cx="15" cy="15" r="5"/></svg>',
    portfolio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="7" width="18" height="13" rx="3"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
    wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 012-2h13v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="16.5" cy="13.5" r="1.3"/></svg>',
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0114 0"/><path d="M16 4a4 4 0 010 8M22 21a7 7 0 00-4-6.3"/></svg>',
    tx: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 4L3 8l4 4"/><path d="M3 8h14"/><path d="M17 20l4-4-4-4"/><path d="M21 16H7"/></svg>',
    orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/></svg>',
  };

  return { api, store, fmt, money, signed, pct, cls, time, esc, badge, toast, modal, confirmBox, poll, withBusy, ICONS };
})();
