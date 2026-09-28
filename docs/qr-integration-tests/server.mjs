// Test server that emulates GitHub Pages hosting of the project (the production host:
// CNAME + _config.yml + 404.html redirects): existing files are served as-is, anything
// else returns 404.html with HTTP 404 (which redirects /c/{id} and /d/{id}).
// /__storage/* is an in-memory stand-in for Firebase Storage (no CORS headers on purpose).
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json', '.ico': 'image/x-icon' };
const storage = new Map();
const EXCLUDED = [/^docs\//, /^functions\//, /^tools\//, /\.(md|txt|ps1|log)$/i, /^firebase\.json$/, /^firestore\./, /^storage\.rules$/, /(^|\/)\./];

export function startServer(port = 0) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    if (p.startsWith('/__storage/')) {
      const key = p.slice('/__storage/'.length);
      if (req.method === 'PUT') { const chunks = []; for await (const c of req) chunks.push(c); storage.set(key, { body: Buffer.concat(chunks), type: req.headers['content-type'] || 'application/octet-stream' }); res.writeHead(200).end('{}'); return; }
      if (req.method === 'DELETE') { storage.delete(key); res.writeHead(204).end(); return; }
      const f = storage.get(key); if (!f) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': f.type }).end(f.body); return;
    }
    const rel = normalize(p).replace(/^([/\\])+/, '');
    let file = resolve(join(root, rel));
    const relPath = file.slice(root.length + 1).replace(/\\/g, '/');
    const isMock = relPath.startsWith('docs/qr-integration-tests/');
    try {
      if (!file.startsWith(root) || (!isMock && EXCLUDED.some((r) => r.test(relPath)))) throw new Error('excluded');
      const st = await stat(file);
      if (st.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
    } catch {
      const body = await readFile(join(root, '404.html'));
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }).end(body);
    }
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({ server, port: server.address().port, storage })));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) startServer(Number(process.argv[2] || 5300)).then(({ port }) => console.log(`http://127.0.0.1:${port}/`));
