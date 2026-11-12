'use strict';
// Admin-editable system settings, stored in the database (app_state "system_settings")
// and enforced by the API. Cached briefly per instance.
const store = require('./store');
const config = require('./config');

const DEFAULTS = {
  site_name: 'TradeV',
  announcement: '',
  support_contact: '',
  theme_color: '#19e37d', // brand colour for both apps
  registration_open: true,
  trading_enabled: true,
  require_bank_account: true,
  deposits_enabled: true,
  withdrawals_enabled: true,
  require_withdrawal_code: true, // customers set a 6-digit code and enter it for every withdrawal
  starting_balance: config.startingBalance,
  max_open_positions: 0, // per customer, 0 = no limit
  demo_enabled: true, // "Try a demo account" on the sign-in screen
  demo_balance: 10000,
  min_deposit: 0, // 0 = no minimum
  max_deposit: 0, // 0 = no limit
  min_withdrawal: 0,
  max_withdrawal: 0,
  deposit_bank: { bank_name: '', account_name: '', account_number: '', instructions: '' },
};

class SettingsError extends Error {}
const bool = (v) => v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
const str = (max) => (v) => String(v ?? '').trim().slice(0, max);
const amount = (name) => (v) => {
  const n = Number(v === '' || v === null || v === undefined ? 0 : v);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new SettingsError(`${name} must be 0 or more`);
  return Math.round(n * 100) / 100;
};
const int = (name, max) => (v) => {
  const n = Number(v === '' || v === null || v === undefined ? 0 : v);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new SettingsError(`${name} must be a whole number from 0 to ${max}`);
  return n;
};
const FIELDS = {
  site_name: (v) => str(40)(v) || 'TradeV',
  announcement: str(300),
  support_contact: str(120),
  theme_color: (v) => {
    const c = String(v || '').trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(c)) throw new SettingsError('Theme colour must be a hex colour like #19e37d');
    return c;
  },
  registration_open: bool,
  trading_enabled: bool,
  require_bank_account: bool,
  deposits_enabled: bool,
  withdrawals_enabled: bool,
  require_withdrawal_code: bool,
  starting_balance: amount('Welcome balance'),
  max_open_positions: int('Max open positions', 1000),
  demo_enabled: bool,
  demo_balance: amount('Demo balance'),
  min_deposit: amount('Minimum deposit'),
  max_deposit: amount('Maximum deposit'),
  min_withdrawal: amount('Minimum withdrawal'),
  max_withdrawal: amount('Maximum withdrawal'),
  deposit_bank: (v) => ({
    bank_name: str(60)(v && v.bank_name),
    account_name: str(80)(v && v.account_name),
    account_number: str(40)(v && v.account_number),
    instructions: str(300)(v && v.instructions),
  }),
};

let cache = { at: 0, value: null };
async function get() {
  if (cache.value && Date.now() - cache.at < 5000) return cache.value;
  const saved = (await store.getState('system_settings')) || {};
  const value = { ...DEFAULTS, ...saved, deposit_bank: { ...DEFAULTS.deposit_bank, ...(saved.deposit_bank || {}) } };
  cache = { at: Date.now(), value };
  return value;
}

async function save(patch, adminId) {
  cache = { at: 0, value: null }; // start from the saved copy, not a possibly stale cache
  const current = await get();
  const next = { ...current };
  for (const [k, fn] of Object.entries(FIELDS)) if (patch[k] !== undefined) next[k] = fn(patch[k]);
  if (next.max_deposit && next.max_deposit < next.min_deposit) throw new SettingsError('Maximum deposit must be above the minimum');
  if (next.max_withdrawal && next.max_withdrawal < next.min_withdrawal) throw new SettingsError('Maximum withdrawal must be above the minimum');
  next.updated_at = new Date().toISOString();
  next.updated_by = adminId || null;
  await store.setState('system_settings', next);
  cache = { at: Date.now(), value: next };
  return next;
}

// What customers (and visitors) may see.
function publicView(s, { loggedIn = false } = {}) {
  const out = {
    site_name: s.site_name, theme_color: s.theme_color, announcement: s.announcement, registration_open: s.registration_open,
    trading_enabled: s.trading_enabled, require_bank_account: s.require_bank_account,
    demo_enabled: s.demo_enabled, demo_balance: s.demo_balance,
  };
  if (loggedIn) {
    Object.assign(out, {
      support_contact: s.support_contact, deposits_enabled: s.deposits_enabled, withdrawals_enabled: s.withdrawals_enabled, require_withdrawal_code: s.require_withdrawal_code,
      min_deposit: s.min_deposit, max_deposit: s.max_deposit, min_withdrawal: s.min_withdrawal, max_withdrawal: s.max_withdrawal,
      max_open_positions: s.max_open_positions,
      deposit_bank: s.deposit_bank && s.deposit_bank.account_number ? s.deposit_bank : null,
    });
  }
  return out;
}

module.exports = { DEFAULTS, get, save, publicView, SettingsError, invalidate: () => { cache = { at: 0, value: null }; } };
