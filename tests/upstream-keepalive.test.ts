// The second-device sign-in refusal (simulation run 1): Caddy reuses an
// idle pooled connection to the app for up to 2 minutes, Node closed idle
// keep-alive sockets after 5 s, and a request written onto a socket at the
// moment Node closed it came back 502 "connection reset by peer" — for a
// sign-in, with the right password. These tests pin the rule that the app
// keeps idle sockets open longer than the proxy, and that the real
// entry point applies it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import {
  APP_HEADERS_TIMEOUT_MS,
  APP_KEEP_ALIVE_MS,
  PROXY_IDLE_MS,
  applyUpstreamKeepAlive,
} from '../src/http-server.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));
}

/** One raw HTTP/1.1 keep-alive connection, the way a proxy pool holds it. */
function pooled(port: number) {
  const sock: Socket = connect(port, '127.0.0.1');
  let buf = '';
  let closedAt: number | null = null;
  sock.setEncoding('utf8');
  sock.on('data', (d) => { buf += d; });
  sock.on('close', () => { closedAt = Date.now(); });
  sock.on('error', () => { /* reset is what we measure */ });
  return {
    async request(p: string): Promise<string> {
      buf = '';
      sock.write(`GET ${p} HTTP/1.1\r\nHost: app\r\nConnection: keep-alive\r\n\r\n`);
      for (let i = 0; i < 200 && !/\r\n\r\n[\s\S]*ok$/.test(buf); i++) await sleep(10);
      return buf;
    },
    closed: () => closedAt !== null,
    end: () => sock.destroy(),
  };
}

const handler = (_req: unknown, res: { setHeader: (k: string, v: string) => void; end: (b: string) => void }) => {
  res.setHeader('Content-Length', '2');
  res.end('ok');
};

test('the app keeps idle keep-alive sockets open longer than the proxy pool does', () => {
  assert.ok(APP_KEEP_ALIVE_MS > PROXY_IDLE_MS, `keepAliveTimeout ${APP_KEEP_ALIVE_MS} must exceed the proxy idle ${PROXY_IDLE_MS}`);
  assert.ok(APP_HEADERS_TIMEOUT_MS > APP_KEEP_ALIVE_MS);
  // Caddy's reverse_proxy transport keeps idle upstream connections 2 min
  // by default; the Caddyfile does not shorten it.
  const caddy = readFileSync(path.resolve(import.meta.dirname, '..', 'Caddyfile'), 'utf8');
  assert.ok(!/keepalive\s+\d/.test(caddy), 'Caddyfile sets its own upstream keepalive — re-check PROXY_IDLE_MS');
  assert.equal(PROXY_IDLE_MS, 120_000);
  const s = applyUpstreamKeepAlive(createServer(handler));
  assert.equal(s.keepAliveTimeout, APP_KEEP_ALIVE_MS);
  assert.equal(s.headersTimeout, APP_HEADERS_TIMEOUT_MS);
});

test('the real entry point (src/index.ts) applies it to the listening server', () => {
  const src = readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8');
  assert.match(src, /const server = applyUpstreamKeepAlive\(\s*app\.listen\(/);
});

test('a pooled connection idle past 5 s is still open and answers the next request', async (t) => {
  const fixed = applyUpstreamKeepAlive(createServer(handler));
  const plain = createServer(handler); // what src/index.ts listened with before the fix
  const [pf, pp] = await Promise.all([listen(fixed), listen(plain)]);
  const a = pooled(pf);
  const b = pooled(pp);
  try {
    assert.match(await a.request('/one'), /^HTTP\/1\.1 200/);
    assert.match(await b.request('/one'), /^HTTP\/1\.1 200/);
    await sleep(6_000); // longer than Node's 5 s default, far shorter than the proxy's 2 min
    t.diagnostic(`Node defaults: idle socket closed by the app after 6 s = ${b.closed()} (the proxy would still reuse it -> 502)`);
    assert.equal(a.closed(), false, 'the app closed an idle socket the proxy still holds in its pool');
    assert.match(await a.request('/two'), /^HTTP\/1\.1 200/);
  } finally {
    a.end(); b.end();
    fixed.closeAllConnections(); plain.closeAllConnections();
    await Promise.all([new Promise((r) => fixed.close(r)), new Promise((r) => plain.close(r))]);
  }
});
