'use strict';
// Adapter: Node (req, res) -> platform-neutral dispatch(). Used on Vercel and locally.
const { dispatch } = require('./api');

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
};

function readBody(req) {
  // Vercel's Node helpers may have parsed it already
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === 'string') return Promise.resolve(req.body ? JSON.parse(req.body) : {});
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.length ? JSON.parse(req.body.toString()) : {});
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

async function handle(req, res, pathnameOverride) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = pathnameOverride || url.pathname;
  // Vercel rewrite passes the original path as ?__path=...
  const rewritten = url.searchParams.get('__path');
  if (rewritten !== null) { pathname = `/api/${rewritten}`; url.searchParams.delete('__path'); }

  let body = {};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try { body = await readBody(req); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
  }
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  const ip = (headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';

  const out = await dispatch({ method: req.method, pathname, query: url.searchParams, headers, body, ip });
  send(res, out.status, out.data, out.headers);
}

function send(res, status, data, extra = {}) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

module.exports = { handle, SECURITY_HEADERS };
