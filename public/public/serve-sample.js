const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/card-sample.html';
  const f = path.join(root, p);
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(d);
  });
}).listen(8099, '127.0.0.1', () => console.log('serving 8099'));
