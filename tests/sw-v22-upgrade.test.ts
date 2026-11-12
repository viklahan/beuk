import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

/* Review M4: what the OLD worker does on the first visit after the switch. A browser that still holds 1.0's v22
   root worker (scope /) is controlled by it until its update check fetches v23 (tests/sw-retire.test.ts). Spec D4:
   "It must never get the cached 1.0 page". tests/fixtures/sw-v22.js is client/sw.js as it was at 1847837, byte for
   byte, run as-is in a node:vm context. It shows the D4 check holds ONLINE (the network answer passes through and is
   not stored as the shell), and pins the one gap new code cannot reach: offline before any online visit after the
   deploy, v22 still answers a navigation with its cached 1.0 page (review M1, accepted and documented). */

const SRC = readFileSync(path.join(import.meta.dirname, 'fixtures', 'sw-v22.js'), 'utf8');
const ORIGIN = 'https://beuk.example';
const CACHED_SHELL = { cachedOne: true };

type Listener = (e: unknown) => void;
type Res = { ok: boolean; status: number; type: string; headers: { get: (k: string) => string | null }; clone: () => Res };
const res = (status: number, type = 'basic', headers: Record<string, string> = {}): Res => {
  const r: Res = { ok: status >= 200 && status < 300, status, type, headers: { get: (k) => headers[k] ?? null }, clone: () => r };
  return r;
};

function load(network: (url: string) => Promise<Res>) {
  const puts: string[] = [];
  const listeners: Record<string, Listener[]> = {};
  const cache = { put: async (k: unknown) => void puts.push(String(k)), add: async () => {}, match: async () => undefined, keys: async () => [] };
  const caches = {
    open: async () => cache,
    match: async (k: unknown) => (String(k) === './index.html' ? CACHED_SHELL : undefined),
    keys: async () => [],
    delete: async () => true,
    has: async () => false,
  };
  const self = {
    location: { href: ORIGIN + '/sw.js', origin: ORIGIN },
    addEventListener: (t: string, f: Listener) => (listeners[t] ??= []).push(f),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: async () => {}, matchAll: async () => [] },
  };
  vm.runInContext(SRC, vm.createContext({ self, caches, URL, Request: class {}, console, fetch: (req: { url: string }) => network(req.url) }), { filename: 'sw-v22.js' });
  async function navigate(url: string) {
    let answered: Promise<unknown> | null = null;
    for (const f of listeners.fetch ?? []) f({ request: { url, mode: 'navigate', method: 'GET' }, respondWith: (p: Promise<unknown>) => (answered = p), waitUntil: () => {} });
    assert.ok(answered, 'v22 answers navigations');
    const out = await answered;
    await new Promise((r) => setTimeout(r, 0)); // its cache.put runs after the answer
    return out;
  }
  return { puts, navigate };
}

test('online: /studio/ is the network answer (2.0), passed through, never stored as the shell', async () => {
  const two = res(200, 'basic', { 'content-type': 'text/html' });
  const w = load(async () => two);
  assert.equal(await w.navigate(ORIGIN + '/studio/'), two);
  assert.equal(await w.navigate(ORIGIN + '/studio/?signin'), two);
  assert.deepEqual(w.puts, [], 'not cached as ./index.html');
});

test("online: /index.html's 308 (an opaque redirect to a navigation) passes through and is not stored", async () => {
  const redirect = res(0, 'opaqueredirect');
  const w = load(async () => redirect);
  assert.equal(await w.navigate(ORIGIN + '/index.html'), redirect); // review C1: Caddy's 308 to /studio
  assert.deepEqual(w.puts, []);
});

test('online: /studio answers 2.0 with a 200 (final fix C2), which v22 serves, and may store as its shell', async () => {
  // Final re-review N1: v22 treats /studio as its shell and stores a 200 for it. That copy is never served again
  // (v23 retires v22, and 2.0's worker then controls /studio), and 2.0's worker deletes beuk-shell-* on activate
  // (tests/studio-sw.test.ts). What matters here: the writer is shown 2.0's page, the network's answer.
  const two = res(200, 'basic', { 'content-type': 'text/html' });
  const w = load(async () => two);
  assert.equal(await w.navigate(ORIGIN + '/studio'), two);
});

test('online during a deploy: a 502 passes through (it resolves), the cached 1.0 page is not served', async () => {
  const bad = res(502);
  const w = load(async () => bad);
  assert.equal(await w.navigate(ORIGIN + '/studio/'), bad);
  assert.deepEqual(w.puts, []);
});

test('offline before any online visit after the deploy: v22 still serves its cached 1.0 page (review M1, accepted)', async () => {
  const w = load(async () => {
    throw new TypeError('Failed to fetch');
  });
  assert.equal(await w.navigate(ORIGIN + '/studio/'), CACHED_SHELL);
});
