'use strict';
// Minimal Cloud Firestore REST client (no SDK, no dependencies).
// - Auth: service-account JWT (RS256) exchanged for an OAuth token, cached ~1h.
//   With FIRESTORE_EMULATOR_HOST set, talks to the emulator without auth.
// - Values: JS <-> Firestore typed values. Dates are written as timestamps and read back as ISO strings.
// - runTransaction(fn): read-write transaction with automatic retry on contention.
const crypto = require('node:crypto');
const config = require('./config');
const { DbError } = require('./errors');

const fb = config.firebase;
const ROOT = `projects/${fb.projectId}/databases/${fb.databaseId}/documents`;
const BASE = fb.emulatorHost ? `http://${fb.emulatorHost}/v1` : 'https://firestore.googleapis.com/v1';

// ---------- auth ----------
// Signed assertion for Google's OAuth "JWT bearer" flow (service accounts).
function serviceAccountJwt(clientEmail, privateKey, nowSec = Math.floor(Date.now() / 1000)) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: clientEmail, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: nowSec, exp: nowSec + 3600,
  })}`;
  return `${unsigned}.${crypto.createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url')}`;
}
let token = { value: null, exp: 0, pending: null };
async function accessToken() {
  if (fb.emulatorHost) return 'owner';
  if (token.value && Date.now() < token.exp - 60_000) return token.value;
  if (token.pending) return token.pending;
  token.pending = (async () => {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: serviceAccountJwt(fb.clientEmail, fb.privateKey) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new DbError(`Firebase auth failed: ${data.error_description || data.error || res.status}`, 503, 'AUTH');
    token = { value: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000, pending: null };
    return token.value;
  })().finally(() => { token.pending = null; });
  return token.pending;
}

// ---------- values ----------
function encode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { nullValue: null };
    return Number.isInteger(v) && Math.abs(v) < Number.MAX_SAFE_INTEGER ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  if (typeof v === 'object') return { mapValue: { fields: encodeFields(v) } };
  throw new Error(`Cannot store value of type ${typeof v}`);
}
function encodeFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = encode(v);
  return out;
}
function decode(v) {
  if (!v || 'nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return new Date(v.timestampValue).toISOString();
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decode(v);
  return out;
}
const docName = (path) => `${ROOT}/${path}`;
const fromDoc = (d) => (d ? { ...decodeFields(d.fields), _path: d.name.slice(ROOT.length + 1), _updateTime: d.updateTime } : null);

// ---------- HTTP ----------
async function call(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    if (e instanceof DbError) throw e;
    throw new DbError(`Database unreachable: ${e.message}`, 503, 'NETWORK');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = (Array.isArray(data) ? data[0] : data).error || {};
    throw new DbError(err.message || `Firestore HTTP ${res.status}`, res.status, err.status || String(res.status));
  }
  return data;
}

async function get(path, { transaction } = {}) {
  try {
    const q = transaction ? `?transaction=${encodeURIComponent(transaction)}` : '';
    return fromDoc(await call('GET', `${BASE}/${docName(path)}${q}`));
  } catch (e) {
    if (e.status === 404 || e.code === 'NOT_FOUND') return null;
    throw e;
  }
}

async function batchGet(paths, { transaction } = {}) {
  const uniq = [...new Set(paths)];
  const out = new Map();
  if (!uniq.length) return out;
  const res = await call('POST', `${BASE}/${ROOT}:batchGet`, { documents: uniq.map(docName), ...(transaction ? { transaction } : {}) });
  for (const r of res) {
    if (r.found) { const d = fromDoc(r.found); out.set(d._path, d); }
    else if (r.missing) out.set(r.missing.slice(ROOT.length + 1), null);
  }
  return out;
}

const OPS = { '==': 'EQUAL', '!=': 'NOT_EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL', in: 'IN' };
// query({ collection, parent?, where: [[field, op, value]], orderBy: [[field, 'asc'|'desc']], limit, transaction })
async function query({ collection, parent, where = [], orderBy = [], limit, transaction }) {
  const filters = where.filter((w) => w[2] !== undefined).map(([field, op, value]) => ({
    fieldFilter: { field: { fieldPath: field }, op: OPS[op], value: encode(value) },
  }));
  const structuredQuery = { from: [{ collectionId: collection }] };
  if (filters.length === 1) structuredQuery.where = filters[0];
  if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters } };
  if (orderBy.length) structuredQuery.orderBy = orderBy.map(([f, d]) => ({ field: { fieldPath: f }, direction: d === 'desc' ? 'DESCENDING' : 'ASCENDING' }));
  if (limit) structuredQuery.limit = limit;
  const url = `${BASE}/${parent ? docName(parent) : ROOT}:runQuery`;
  const res = await call('POST', url, { structuredQuery, ...(transaction ? { transaction } : {}) });
  return res.filter((r) => r.document).map((r) => fromDoc(r.document));
}

// ---------- writes ----------
const W = {
  set: (path, data) => ({ update: { name: docName(path), fields: encodeFields(data) } }),
  create: (path, data) => ({ update: { name: docName(path), fields: encodeFields(data) }, currentDocument: { exists: false } }),
  update: (path, data) => ({ update: { name: docName(path), fields: encodeFields(data) }, updateMask: { fieldPaths: Object.keys(data).filter((k) => data[k] !== undefined) }, currentDocument: { exists: true } }),
  delete: (path) => ({ delete: docName(path) }),
};
async function commit(writes, transaction) {
  if (!writes.length && !transaction) return;
  for (let i = 0; i < Math.max(writes.length, 1); i += 500) {
    await call('POST', `${BASE}/${ROOT}:commit`, { writes: writes.slice(i, i + 500), ...(transaction ? { transaction } : {}) });
    if (transaction) break; // a transaction must commit all writes at once
  }
}

// ---------- transactions ----------
const RETRYABLE = /ABORTED|contention|Transaction (lock )?timeout|transaction.*(expired|invalid|has been)/i;
async function runTransaction(fn, { retries = 8 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { transaction } = await call('POST', `${BASE}/${ROOT}:beginTransaction`, { options: { readWrite: {} } });
    const writes = [];
    const tx = {
      get: (path) => get(path, { transaction }),
      batchGet: (paths) => batchGet(paths, { transaction }),
      query: (q) => query({ ...q, transaction }),
      set: (path, data) => writes.push(W.set(path, data)),
      create: (path, data) => writes.push(W.create(path, data)),
      update: (path, data) => writes.push(W.update(path, data)),
      delete: (path) => writes.push(W.delete(path)),
    };
    try {
      const result = await fn(tx);
      await commit(writes, transaction);
      return result;
    } catch (e) {
      lastErr = e;
      call('POST', `${BASE}/${ROOT}:rollback`, { transaction }).catch(() => {});
      if (!(e instanceof DbError) || !(e.status === 409 || RETRYABLE.test(`${e.code} ${e.message}`))) throw e;
      await new Promise((r) => setTimeout(r, Math.min(1000, 25 * 2 ** attempt) * (0.5 + Math.random())));
    }
  }
  throw lastErr;
}

module.exports = { serviceAccountJwt, get, batchGet, query, commit, runTransaction, W, encode, decode, accessToken, ROOT };
