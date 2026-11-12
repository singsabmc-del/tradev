#!/usr/bin/env node
// In-memory stand-in for the Cloud Firestore REST API (v1), for TradeV's tests and offline dev.
// Implements: get, batchGet, runQuery (field/composite AND filters, IN, orderBy, limit,
// sub-collections), beginTransaction, commit (set / update+mask / create & exists
// preconditions / delete), rollback. Transactions are optimistic: committing after a
// document you read was changed by someone else fails with 409 ABORTED, like contention
// on real Firestore. NOT for production. Use like the official emulator:
//   node scripts/firestore-mock.js  ->  FIRESTORE_EMULATOR_HOST=127.0.0.1:8681 FIREBASE_PROJECT_ID=demo
'use strict';
const http = require('node:http');

const PORT = Number(process.env.MOCK_PORT || 8681);
const docs = new Map(); // full name -> { fields, version, createTime, updateTime }
const txs = new Map();  // id -> Map(name -> version|0)
let clock = 0, txSeq = 0;
const usage = { reads: 0, writes: 0 }; // billed-operation estimate, GET /__usage

const err = (status, code, message) => Object.assign(new Error(message), { http: status, code });
const now = () => new Date().toISOString();

function val(v) {
  if (!v || 'nullValue' in v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  return JSON.stringify(v);
}
function cmp(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
const docOut = (name, d) => ({ name, fields: d.fields, createTime: d.createTime, updateTime: d.updateTime });
function track(txId, name) {
  if (!txId) return;
  const t = txs.get(txId);
  if (!t) throw err(400, 'INVALID_ARGUMENT', 'Transaction is invalid or has expired');
  if (!t.has(name)) t.set(name, docs.has(name) ? docs.get(name).version : 0);
}

function matches(d, f) {
  if (!f) return true;
  if (f.compositeFilter) {
    const parts = f.compositeFilter.filters.map((x) => matches(d, x));
    return f.compositeFilter.op === 'OR' ? parts.some(Boolean) : parts.every(Boolean);
  }
  const { field, op, value } = f.fieldFilter;
  const have = field.fieldPath in d.fields ? val(d.fields[field.fieldPath]) : undefined;
  if (op === 'IN') return have !== undefined && (value.arrayValue.values || []).map(val).some((x) => cmp(x, have) === 0);
  if (have === undefined) return false;
  const c = cmp(have, val(value));
  return { EQUAL: c === 0, NOT_EQUAL: c !== 0, LESS_THAN: c < 0, LESS_THAN_OR_EQUAL: c <= 0, GREATER_THAN: c > 0, GREATER_THAN_OR_EQUAL: c >= 0 }[op];
}

function runQuery(parent, body) {
  const q = body.structuredQuery;
  const coll = q.from[0].collectionId;
  const prefix = `${parent}/${coll}/`;
  let rows = [...docs.entries()].filter(([n]) => n.startsWith(prefix) && !n.slice(prefix.length).includes('/'));
  rows = rows.filter(([, d]) => matches(d, q.where));
  const order = q.orderBy || [];
  rows.sort(([na, a], [nb, b]) => {
    for (const o of order) {
      const c = cmp(val(a.fields[o.field.fieldPath]), val(b.fields[o.field.fieldPath]));
      if (c) return o.direction === 'DESCENDING' ? -c : c;
    }
    return cmp(na, nb);
  });
  if (q.limit) rows = rows.slice(0, q.limit);
  usage.reads += Math.max(1, rows.length);
  for (const [n] of rows) track(body.transaction, n);
  return rows.length ? rows.map(([n, d]) => ({ document: docOut(n, d), readTime: now() })) : [{ readTime: now() }];
}

function commit(body) {
  const writes = body.writes || [];
  if (body.transaction) {
    const t = txs.get(body.transaction);
    if (!t) throw err(400, 'INVALID_ARGUMENT', 'Transaction is invalid or has expired');
    txs.delete(body.transaction);
    for (const [n, v] of t) {
      const cur = docs.has(n) ? docs.get(n).version : 0;
      if (cur !== v) throw err(409, 'ABORTED', 'Too much contention on these documents. Please try again.');
    }
  }
  // validate preconditions first so the commit is all-or-nothing
  for (const w of writes) {
    const name = w.update ? w.update.name : w.delete;
    const exists = docs.has(name);
    if (w.currentDocument && 'exists' in w.currentDocument) {
      if (w.currentDocument.exists && !exists) throw err(404, 'NOT_FOUND', `No document to update: ${name}`);
      if (!w.currentDocument.exists && exists) throw err(409, 'ALREADY_EXISTS', `Document already exists: ${name}`);
    }
  }
  const t = now();
  usage.writes += writes.length;
  for (const w of writes) {
    if (w.delete) { docs.delete(w.delete); continue; }
    const name = w.update.name;
    const prev = docs.get(name);
    let fields = w.update.fields || {};
    if (w.updateMask && prev) {
      fields = { ...prev.fields };
      for (const p of w.updateMask.fieldPaths) {
        if (p in (w.update.fields || {})) fields[p] = w.update.fields[p]; else delete fields[p];
      }
    }
    docs.set(name, { fields, version: ++clock, createTime: prev ? prev.createTime : t, updateTime: t });
  }
  return { commitTime: t, writeResults: writes.map(() => ({ updateTime: t })) };
}

function handle(method, path, body, search) {
  const m = path.match(/^\/v1\/(projects\/[^/]+\/databases\/[^/]+\/documents)(.*)$/);
  if (!m) throw err(404, 'NOT_FOUND', 'unknown path');
  const root = m[1];
  let rest = m[2];
  if (method === 'POST') {
    const action = rest.match(/:(\w+)$/);
    if (!action) throw err(400, 'INVALID_ARGUMENT', 'unsupported');
    rest = rest.slice(0, -action[0].length);
    const parent = rest ? `${root}${rest}` : root;
    switch (action[1]) {
      case 'beginTransaction': { const id = `tx${++txSeq}`; txs.set(id, new Map()); return { transaction: id }; }
      case 'rollback': txs.delete(body.transaction); return {};
      case 'commit': return commit(body);
      case 'runQuery': return runQuery(parent, body);
      case 'batchGet': usage.reads += body.documents.length; return body.documents.map((n) => {
        track(body.transaction, n);
        return docs.has(n) ? { found: docOut(n, docs.get(n)), readTime: now() } : { missing: n, readTime: now() };
      });
      default: throw err(400, 'INVALID_ARGUMENT', `unsupported action ${action[1]}`);
    }
  }
  if (method === 'GET') {
    const name = `${root}${rest}`;
    usage.reads += 1;
    track(search.get('transaction'), name);
    if (!docs.has(name)) throw err(404, 'NOT_FOUND', `Document not found: ${name}`);
    return docOut(name, docs.get(name));
  }
  throw err(405, 'INVALID_ARGUMENT', 'method not allowed');
}

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__usage') { res.writeHead(200); return res.end(JSON.stringify(usage)); }
    try {
      const out = handle(req.method, decodeURI(url.pathname), raw ? JSON.parse(raw) : {}, url.searchParams);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(e.http || 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: e.http || 500, status: e.code || 'INTERNAL', message: e.message } }));
    }
  });
}).listen(PORT, () => console.log(`Firestore mock on 127.0.0.1:${PORT}`));
