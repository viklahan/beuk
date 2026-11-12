import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

/* Final review C2 + I1: 2.0's worker (studio/public/sw.js) is registered at /studio/sw.js with scope /studio (no
   slash), so it covers both addresses the app answers with 2.0's page: /studio (every 1.0 bookmark, link and
   installed shortcut) and /studio/. A navigation to either is network first, the precached shell when the network
   fails (offline) or answers a server error. Anything else that the scope /studio matches by prefix (/studiofoo) is
   not the studio: the worker leaves it alone. The file is run as it is, in a node:vm context with a fake
   ServiceWorkerGlobalScope. */

const SRC = readFileSync(path.join(import.meta.dirname, '..', 'studio', 'public', 'sw.js'), 'utf8');
const ORIGIN = 'https://beuk.example';
const SHELL = '/studio/index.html';
const SHELL_BODY = '<!doctype html><div id="root"></div>';

type Listener = (e: unknown) => void;
type Res = { status: number; body: string };

function load(network: (url: string) => Promise<Res>) {
  const listeners: Record<string, Listener[]> = {};
  const store = new Map<string, Res>([[SHELL, { status: 200, body: SHELL_BODY }]]);
  const cache = {
    match: async (k: string) => store.get(k),
    addAll: async () => {},
    add: async () => {},
    put: async () => {},
  };
  const self = {
    BEUK_NEXT: { cache: 'beuk-next-abc', shell: SHELL, assets: ['/studio/assets/index-1.js'], optional: [] as string[] },
    location: { href: ORIGIN + '/studio/sw.js', origin: ORIGIN },
    addEventListener: (type: string, f: Listener) => (listeners[type] ??= []).push(f),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: async () => {} },
    registration: { scope: ORIGIN + '/studio' },
  };
  const ctx = vm.createContext({
    self,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    URL,
    Response: { error: () => ({ status: 0, body: 'network error' }) },
    console,
    fetch: (req: { url: string }) => network(req.url),
    importScripts: () => {},
  });
  vm.runInContext(SRC, ctx, { filename: 'studio/public/sw.js' });
  async function navigate(p: string): Promise<Res | 'untouched'> {
    const responded: Promise<Res>[] = [];
    const e = { request: { url: ORIGIN + p, mode: 'navigate', method: 'GET' }, waitUntil: () => {}, respondWith: (r: Promise<Res>) => responded.push(r) };
    for (const f of listeners.fetch ?? []) f(e);
    if (responded.length === 0) return 'untouched';
    assert.equal(responded.length, 1);
    return responded[0]!;
  }
  return { navigate };
}

const offline = () => Promise.reject(new TypeError('Failed to fetch'));

test('offline: a navigation to /studio, /studio?… and /studio/… gets the precached shell', async () => {
  const w = load(offline);
  for (const p of ['/studio', '/studio?book=abc&x=1', '/studio?signin', '/studio/', '/studio/?signup', '/studio/book/abc']) {
    const r = await w.navigate(p);
    assert.notEqual(r, 'untouched', p);
    assert.equal((r as Res).body, SHELL_BODY, p);
  }
});

test('online: /studio is network first (the app answers 2.0, or 1.0 under STUDIO_CLASSIC)', async () => {
  const w = load(async (url) => ({ status: 200, body: 'from the network ' + new URL(url).pathname }));
  assert.deepEqual(await w.navigate('/studio?x=1'), { status: 200, body: 'from the network /studio' });
  assert.deepEqual(await w.navigate('/studio/'), { status: 200, body: 'from the network /studio/' });
  // a server error (the app down during a deploy): the shell, at both addresses
  const down = load(async () => ({ status: 502, body: 'Bad Gateway' }));
  assert.equal(((await down.navigate('/studio')) as Res).body, SHELL_BODY);
  assert.equal(((await down.navigate('/studio/')) as Res).body, SHELL_BODY);
});

test('what the scope /studio also matches by prefix (/studiofoo, /studio.html) is not the studio: untouched', async () => {
  const w = load(offline);
  for (const p of ['/studiofoo', '/studio.html', '/studio-x/', '/', '/account']) assert.equal(await w.navigate(p), 'untouched', p);
});
