const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
process.env.SITE_ORIGIN ||= 'http://127.0.0.1:8080';
const handler = require('./api/inquiries');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg' };
http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/inquiries') { handler(req, res).catch(() => { if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unable to submit. Please try again.' })); } }); return; }
  // Allowlist public assets: never serve environment files or server source.
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!['index.html', 'form.js'].includes(relative) && !/^images\/[a-z0-9-]+\.jpg$/.test(relative)) { res.writeHead(404); res.end(); return; }
  fs.readFile(path.join(__dirname, relative), (err, bytes) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(relative)], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : bytes);
  });
}).listen(8080, '127.0.0.1', () => console.log('Blue Haven: http://127.0.0.1:8080'));
