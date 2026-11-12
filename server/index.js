'use strict';
// Local development server: serves public/ and the same API as the Vercel function.
//   npm start            -> http://localhost:3000
// Set LOCAL_TICK_MS=1000 to also advance markets in the background (not needed: pages poll).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../lib/config');
const { handle, SECURITY_HEADERS } = require('../lib/http');
const engine = require('../lib/engine');
const sheets = require('../lib/sheets');
const { bootstrap } = require('../lib/api');

const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'";

function serveStatic(req, res, pathname) {
  const aliases = { '/': '/index.html', '/admin': '/admin.html', '/admin/': '/admin.html' };
  const rel = aliases[pathname] || pathname;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'content-security-policy': CSP, ...SECURITY_HEADERS });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname.startsWith('/api/')) {
    return handle(req, res).catch((e) => { console.error(e); res.statusCode = 500; res.end('{"error":"Server error"}'); });
  }
  serveStatic(req, res, pathname);
});

async function main() {
  if (config.problems.length) {
    console.error(`\n  ${config.problems.join('\n  ')}\n  Copy .env.example to .env and fill it in.\n`);
    process.exit(1);
  }
  await bootstrap();
  if (config.localTickMs > 0) {
    setInterval(() => { engine.advanceAll().then(() => sheets.maybeSync()).catch((e) => console.error(e.message)); }, config.localTickMs);
  }
  server.listen(config.port, () => {
    console.log(`TradeV running → http://localhost:${config.port}   (admin: http://localhost:${config.port}/admin)`);
  });
}

main().catch((e) => {
  console.error('Failed to start:', e.message);
  if (/relation|does not exist|Could not find/i.test(e.message)) console.error('Run supabase/migrations/001_init.sql and 002_serverless.sql in your Supabase project.');
  process.exit(1);
});
