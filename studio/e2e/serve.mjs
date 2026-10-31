/* A tiny static server for the e2e script: the repo's client/ tree the way
   production serves it, with the real security headers.
   - /studio            → client/index.html (1.0, as Caddy rewrites it)
   - /next              → 308 /next/
   - /next/<file>       → client/next/<file> (the 2.0 build)
   - /next/<route>      → client/next/index.html (the app's own routes)
   - /api/*             → 404 JSON (no shelf in these runs)
   - anything else      → client/<path>, else 404
   Every response carries the Content-Security-Policy (and the other
   default headers) copied from the Caddyfile at start, so the browser
   enforces exactly production's policy. */
import { createServer } from 'node:http';
import { readFileSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
};

/** The default headers the Caddyfile sets on every response ("header ?Name value"). */
export function caddyHeaders(caddyfile) {
  const out = {};
  for (const m of caddyfile.matchAll(/^\s*header \?([\w-]+) "((?:[^"\\]|\\.)*)"\s*$/gm)) out[m[1]] = m[2].replace(/\\"/g, '"');
  if (!out['Content-Security-Policy']) throw new Error('Caddyfile: no Content-Security-Policy header found');
  return out;
}

export function startServer({ repo, port = 0 }) {
  const client = path.join(repo, 'client');
  const next = path.join(client, 'next');
  const headers = caddyHeaders(readFileSync(path.join(repo, 'Caddyfile'), 'utf8'));
  const state = { requests: [], down: false };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    state.requests.push(p);
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    const send = (file) => {
      let st;
      try {
        st = statSync(file);
      } catch {
        st = null;
      }
      if (!st || !st.isFile()) return false;
      res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Content-Length', st.size);
      createReadStream(file).pipe(res);
      return true;
    };
    const notFound = () => {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end('not found');
    };
    const inside = (base, rel) => {
      const f = path.resolve(base, '.' + rel);
      return f === base || f.startsWith(base + path.sep) ? f : null;
    };
    if (p.startsWith('/api/')) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      return res.end('{"error":"not found"}');
    }
    if (p === '/studio') return send(path.join(client, 'index.html')) || notFound();
    if (p === '/next') {
      res.statusCode = 308;
      res.setHeader('Location', '/next/' + url.search);
      return res.end();
    }
    if (p.startsWith('/next/')) {
      const rel = p.slice('/next'.length);
      const f = inside(next, rel);
      if (f && send(f)) return;
      if (/\.[a-z0-9]+$/i.test(p)) return notFound();
      return send(path.join(next, 'index.html')) || notFound();
    }
    const f = inside(client, p);
    if (f && send(f)) return;
    return notFound();
  });
  // Track sockets so stop() really cuts the network (keep-alive included).
  const sockets = new Set();
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      resolve({
        origin,
        headers,
        state,
        stop: () =>
          new Promise((r) => {
            for (const s of sockets) s.destroy();
            server.close(() => r());
          }),
      });
    });
  });
}
