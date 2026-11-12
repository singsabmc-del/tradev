'use strict';
// Tiny Supabase (PostgREST) client built on fetch — no npm dependencies.
const config = require('./config');

const { DbError } = require('./errors');

function headers(extra = {}) {
  const h = { apikey: config.supabaseKey, 'content-type': 'application/json', ...extra };
  // Legacy service_role keys are JWTs and go in Authorization too. New `sb_secret_...`
  // keys are sent only in the apikey header.
  if (config.supabaseKey.startsWith('eyJ')) h.authorization = `Bearer ${config.supabaseKey}`;
  return h;
}

// filters: array of [column, operator, value] e.g. ['status','eq','open'], ['id','in',[1,2]]
function buildQuery({ select, filters = [], or, order, limit, offset, onConflict } = {}) {
  const q = new URLSearchParams();
  if (select) q.set('select', select);
  for (const [col, op, val] of filters) {
    if (val === undefined) continue;
    const v = op === 'in' ? `(${val.join(',')})` : String(val);
    q.append(col, `${op}.${v}`);
  }
  if (or) q.set('or', `(${or})`);
  if (order) q.set('order', order);
  if (limit) q.set('limit', String(limit));
  if (offset) q.set('offset', String(offset));
  if (onConflict) q.set('on_conflict', onConflict);
  const s = q.toString();
  return s ? `?${s}` : '';
}

async function request(method, path, body, extraHeaders) {
  let res;
  try {
    res = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
      method,
      headers: headers(extraHeaders),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new DbError(`Database unreachable: ${e.message}`, 503, 'NETWORK');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    throw new DbError(msg, res.status, data && data.code);
  }
  return data;
}

const db = {
  select: (table, opts) => request('GET', table + buildQuery(opts)),
  one: async (table, opts) => (await request('GET', table + buildQuery({ ...opts, limit: 1 })))[0] || null,
  insert: (table, rows, { onConflict } = {}) =>
    request('POST', table + buildQuery({ onConflict }), rows, {
      prefer: `return=representation${onConflict ? ',resolution=merge-duplicates' : ''}`,
    }),
  update: (table, patch, filters) =>
    request('PATCH', table + buildQuery({ filters }), patch, { prefer: 'return=representation' }),
  rpc: (fn, args = {}) => request('POST', `rpc/${fn}`, args),
  DbError,
};

module.exports = db;
