#!/usr/bin/env node
// Local development/test stand-in for Supabase's REST API (PostgREST).
// It implements only the subset of PostgREST that TradeV's server uses and runs
// SQL through the `psql` CLI, so the real schema & Postgres functions are exercised
// without needing a Supabase project. NOT for production.
//
//   PGURL=postgresql://postgres@localhost:5432/tradev node scripts/postgrest-shim.js
//   -> SUPABASE_URL=http://localhost:54321  SUPABASE_SERVICE_ROLE_KEY=local-dev-key
'use strict';
const http = require('node:http');
const { spawn } = require('node:child_process');

const PORT = Number(process.env.SHIM_PORT || 54321);
const KEY = process.env.SHIM_KEY || 'local-dev-key';
const PSQL_ARGS = (process.env.PSQL_ARGS || '').split(' ').filter(Boolean);
if (process.env.PGURL) PSQL_ARGS.push(process.env.PGURL);

const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw httpErr(400, `bad identifier: ${s}`);
  return `"${s}"`;
};
const lit = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }

function runSql(sql) {
  return new Promise((resolve, reject) => {
    const p = spawn('psql', [...PSQL_ARGS, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => {
      if (code === 0) return resolve(out.trim());
      const m = err.match(/ERROR:\s+(.*)/);
      reject(httpErr(400, m ? m[1].trim() : err.trim()));
    });
    p.stdin.end(sql);
  });
}

const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'LIKE', ilike: 'ILIKE' };
function cond(col, expr) {
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot), val = expr.slice(dot + 1);
  if (op === 'in') {
    const items = val.replace(/^\(|\)$/g, '').split(',').filter((x) => x !== '');
    return items.length ? `${ident(col)} IN (${items.map(lit).join(',')})` : 'false';
  }
  if (op === 'is') {
    const v = { null: 'NULL', true: 'TRUE', false: 'FALSE' }[val];
    if (!v) throw httpErr(400, 'bad is value');
    return `${ident(col)} IS ${v}`;
  }
  if (!OPS[op]) throw httpErr(400, `unsupported operator ${op}`);
  const v = op.endsWith('like') ? val.replace(/\*/g, '%') : val;
  return `${ident(col)} ${OPS[op]} ${lit(v)}`;
}

function where(params) {
  const parts = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
    if (k === 'or') {
      const inner = v.replace(/^\(|\)$/g, '').split(',').map((c) => {
        const i = c.indexOf('.');
        return cond(c.slice(0, i), c.slice(i + 1));
      });
      parts.push(`(${inner.join(' OR ')})`);
    } else parts.push(cond(k, v));
  }
  return parts.length ? ` WHERE ${parts.join(' AND ')}` : '';
}

function orderLimit(params) {
  let s = '';
  const order = params.get('order');
  if (order) {
    s += ' ORDER BY ' + order.split(',').map((o) => {
      const [col, dir, nulls] = o.split('.');
      return `${ident(col)} ${dir === 'desc' ? 'DESC' : 'ASC'}${nulls === 'nullslast' ? ' NULLS LAST' : nulls === 'nullsfirst' ? ' NULLS FIRST' : ''}`;
    }).join(', ');
  }
  if (params.get('limit')) s += ` LIMIT ${parseInt(params.get('limit'), 10)}`;
  if (params.get('offset')) s += ` OFFSET ${parseInt(params.get('offset'), 10)}`;
  return s;
}

function columns(params) {
  const sel = params.get('select') || '*';
  return sel === '*' ? '*' : sel.split(',').map(ident).join(', ');
}

async function handle(req, body) {
  const url = new URL(req.url, 'http://x');
  const key = req.headers.apikey;
  if (key !== KEY) throw httpErr(401, 'Invalid API key');
  const m = url.pathname.match(/^\/rest\/v1\/(rpc\/)?([a-z_][a-z0-9_]*)$/i);
  if (!m) throw httpErr(404, 'not found');
  const [, isRpc, name] = m;
  const p = url.searchParams;
  const json = body ? JSON.parse(body) : null;

  if (isRpc) {
    const args = Object.entries(json || {}).map(([k, v]) => `${ident(k)} => ${typeof v === 'object' && v !== null ? lit(JSON.stringify(v)) : lit(v)}`);
    return runSql(`SELECT to_jsonb(${ident(name)}(${args.join(', ')}));`).then((o) => (o === '' ? 'null' : o));
  }
  const t = `public.${ident(name)}`;
  if (req.method === 'GET') {
    return runSql(`SELECT coalesce(json_agg(x), '[]') FROM (SELECT ${columns(p)} FROM ${t}${where(p)}${orderLimit(p)}) x;`);
  }
  if (req.method === 'POST') {
    const rows = Array.isArray(json) ? json : [json];
    if (!rows.length) return '[]';
    const cols = Object.keys(rows[0]);
    const colList = cols.map(ident).join(', ');
    let sql = `WITH ins AS (INSERT INTO ${t} (${colList}) SELECT ${colList} FROM json_populate_recordset(NULL::${t}, ${lit(JSON.stringify(rows))})`;
    const oc = p.get('on_conflict');
    if (oc && /merge-duplicates/.test(req.headers.prefer || '')) {
      const keys = oc.split(',').map(ident);
      const upd = cols.filter((c) => !oc.split(',').includes(c)).map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`);
      sql += ` ON CONFLICT (${keys.join(', ')}) ${upd.length ? `DO UPDATE SET ${upd.join(', ')}` : 'DO NOTHING'}`;
    }
    sql += ` RETURNING *) SELECT coalesce(json_agg(ins), '[]') FROM ins;`;
    return runSql(sql);
  }
  if (req.method === 'PATCH') {
    const cols = Object.keys(json);
    if (!cols.length) throw httpErr(400, 'empty patch');
    const colList = cols.map(ident).join(', ');
    return runSql(`WITH u AS (UPDATE ${t} SET (${colList}) = (SELECT ${colList} FROM json_populate_record(NULL::${t}, ${lit(JSON.stringify(json))}))${where(p)} RETURNING *) SELECT coalesce(json_agg(u), '[]') FROM u;`);
  }
  if (req.method === 'DELETE') {
    return runSql(`WITH d AS (DELETE FROM ${t}${where(p)} RETURNING *) SELECT coalesce(json_agg(d), '[]') FROM d;`);
  }
  throw httpErr(405, 'method not allowed');
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', async () => {
    try {
      const out = await handle(req, body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(out);
    } catch (e) {
      res.writeHead(e.status || 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: e.message, code: 'P0001' }));
    }
  });
}).listen(PORT, () => console.log(`PostgREST shim on http://localhost:${PORT} (key: ${KEY})`));
