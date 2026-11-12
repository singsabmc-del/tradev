'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const engine = require('./engine');
const { dispatch, ensureAdmin, auth } = require('./api');

const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'",
};

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const aliases = { '/': '/index.html', '/admin': '/admin.html', '/admin/': '/admin.html' };
  const rel = aliases[pathname] || pathname;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', ...SECURITY_HEADERS });
    res.end(buf);
  });
}

// Server-Sent Events: live prices for everyone, plus order updates for the signed-in user.
function stream(req, res, query) {
  const payload = auth.verify(query.get('token'));
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write('retry: 3000\n\n');
  const onTick = (t) => res.write(`event: tick\ndata: ${JSON.stringify(t)}\n\n`);
  const onOrder = (o) => {
    if (payload && (o.user_id === payload.sub || payload.role === 'admin')) res.write(`event: order\ndata: ${JSON.stringify(o)}\n\n`);
  };
  engine.events.on('tick', onTick);
  engine.events.on('order', onOrder);
  req.on('close', () => { engine.events.off('tick', onTick); engine.events.off('order', onOrder); });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { pathname, searchParams: query } = url;
  if (pathname === '/api/stream') return stream(req, res, query);
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 1e6) { req.destroy(); }
  });
  req.on('end', async () => {
    let body = {};
    if (raw) {
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
    }
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const { status, data } = await dispatch({ req, method: req.method, pathname, query, body, ip });
    send(res, status, data);
  });
});

async function main() {
  await ensureAdmin();
  await engine.start();
  require('./sheets').start();
  server.listen(config.port, () => {
    console.log(`TradeV running → http://localhost:${config.port}   (admin: http://localhost:${config.port}/admin)`);
  });
}

main().catch((e) => {
  console.error('Failed to start:', e.message);
  if (/relation|does not exist|Could not find/i.test(e.message)) {
    console.error('Did you run supabase/migrations/001_init.sql in your Supabase project?');
  }
  process.exit(1);
});

module.exports = server;
