/* 本地静态服务器：node tools/serve.mjs [port] [--subpath]
   仅用于本地预览，与 GitHub Pages 的静态托管行为一致。
   --subpath 模拟部署在 https://<user>.github.io/<repo>/ 下的子路径。 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 8099);
const useSubpath = process.argv.includes('--subpath');
const PREFIX = '/Yumesumi-Index';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (useSubpath) {
    if (rel === PREFIX || rel === `${PREFIX}/`) rel = '/index.html';
    else if (rel.startsWith(`${PREFIX}/`)) rel = rel.slice(PREFIX.length);
    else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
  } else if (rel === '/') {
    rel = '/index.html';
  }
  const file = path.join(root, rel);
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end('403');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`YSI 预览服务器：http://127.0.0.1:${port}${useSubpath ? PREFIX : ''}/`);
});
