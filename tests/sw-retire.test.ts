import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

/* Spec D4: 1.0's root worker (client/sw.js, scope /, last shell beuk-shell-v22) becomes v23, a worker that
   retires itself. A browser holding v22 fetches the new bytes on its next update check (any navigation in
   scope /), and v23 then: skips waiting; on activate deletes 1.0's own caches (beuk-shell-* and its sound
   cache), keeps every beuk-next-* cache (2.0's worker, scope /studio/, owns them), claims the open pages and
   unregisters. While it lives its fetch handler answers nothing, so every request goes to the network and a
   cached 1.0 page is never served again. The file is run as it is, in a node:vm context with a fake
   ServiceWorkerGlobalScope. */

const SRC = readFileSync(path.join(import.meta.dirname, '..', 'client', 'sw.js'), 'utf8');

type Listener = (e: unknown) => void;

function load(cacheNames: string[]) {
  const calls: string[] = [];
  const listeners: Record<string, Listener[]> = {};
  const names = new Set(cacheNames);
  const caches = {
    keys: async () => [...names],
    delete: async (k: string) => {
      calls.push('caches.delete ' + k);
      return names.delete(k);
    },
    open: async (k: string) => {
      calls.push('caches.open ' + k);
      names.add(k);
      return { add: async () => {}, put: async () => {}, match: async () => undefined, keys: async () => [] };
    },
    match: async () => undefined,
    has: async (k: string) => names.has(k),
  };
  const self = {
    location: { href: 'https://beuk.example/sw.js', origin: 'https://beuk.example' },
    addEventListener: (type: string, f: Listener) => (listeners[type] ??= []).push(f),
    skipWaiting: () => {
      calls.push('skipWaiting');
      return Promise.resolve();
    },
    clients: {
      claim: async () => {
        calls.push('clients.claim');
      },
      matchAll: async () => [],
    },
    registration: {
      scope: 'https://beuk.example/',
      unregister: async () => {
        calls.push('registration.unregister');
        return true;
      },
    },
  };
  const ctx = vm.createContext({
    self,
    caches,
    clients: self.clients,
    registration: self.registration,
    URL,
    Request: class {},
    Response: class {},
    console,
    fetch: () => {
      calls.push('fetch');
      return Promise.reject(new Error('no network in this test'));
    },
    importScripts: () => {
      throw new Error('the retiring worker imports nothing');
    },
  });
  vm.runInContext(SRC, ctx, { filename: 'client/sw.js' });
  /** Fire an extendable event; resolves once every waitUntil promise has. */
  async function fire(type: string, extra: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    const responded: unknown[] = [];
    const e = { ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (r: unknown) => responded.push(r) };
    for (const f of listeners[type] ?? []) f(e);
    await Promise.all(waits);
    return { responded };
  }
  return { calls, listeners, names, fire };
}

test('install: skipWaiting at once (the retiring worker never waits for the update bar)', async () => {
  const w = load([]);
  assert.ok((w.listeners.install ?? []).length > 0, 'an install listener');
  await w.fire('install');
  assert.ok(w.calls.includes('skipWaiting'), w.calls.join(', '));
  assert.ok(!w.calls.some((c) => c.startsWith('caches.open')), 'it caches nothing');
});

test("activate: deletes 1.0's shell and sound caches, keeps every beuk-next-* cache, claims, then unregisters", async () => {
  const w = load(['beuk-shell-v22', 'beuk-shell-v21', 'beuk-sound-v2', 'beuk-next-abc123def456', 'beuk-next-000000000000']);
  await w.fire('activate');
  assert.deepEqual([...w.names].sort(), ['beuk-next-000000000000', 'beuk-next-abc123def456']);
  for (const k of ['beuk-shell-v22', 'beuk-shell-v21', 'beuk-sound-v2']) assert.ok(w.calls.includes('caches.delete ' + k), k);
  assert.ok(!w.calls.some((c) => c.startsWith('caches.delete beuk-next-')), 'no beuk-next-* cache touched');
  const claim = w.calls.indexOf('clients.claim');
  const unreg = w.calls.indexOf('registration.unregister');
  const lastDelete = Math.max(...w.calls.map((c, i) => (c.startsWith('caches.delete') ? i : -1)));
  assert.ok(claim !== -1 && unreg !== -1, w.calls.join(', '));
  assert.ok(lastDelete < claim && claim < unreg, `order: deletes, then claim, then unregister (${w.calls.join(', ')})`);
  assert.ok(!w.calls.some((c) => c.startsWith('caches.open')), 'no cache re-created');
});

test('fetch: never answered (respondWith is never called), so everything goes to the network', async () => {
  const w = load(['beuk-shell-v22']);
  const reqs = [
    { url: 'https://beuk.example/studio', mode: 'navigate', method: 'GET' },
    { url: 'https://beuk.example/studio/', mode: 'navigate', method: 'GET' },
    { url: 'https://beuk.example/', mode: 'navigate', method: 'GET' },
    { url: 'https://beuk.example/index.html', mode: 'navigate', method: 'GET' },
    { url: 'https://beuk.example/assets/vendor/jszip.min.js', mode: 'no-cors', method: 'GET' },
    { url: 'https://beuk.example/assets/sound/rain.mp3', mode: 'cors', method: 'GET' },
    { url: 'https://beuk.example/api/books', mode: 'cors', method: 'GET' },
    { url: 'https://beuk.example/api/books', mode: 'cors', method: 'POST' },
  ];
  for (const r of reqs) {
    const { responded } = await w.fire('fetch', { request: r });
    assert.equal(responded.length, 0, r.url);
  }
  assert.ok(!w.calls.includes('fetch'), 'the worker itself fetches nothing');
});

test("an open 1.0 page's messages are harmless: no cache is opened or re-created", async () => {
  const w = load([]);
  for (const type of ['SKIP_WAITING', 'BEUK_PING', 'BEUK_SAMPLE_CACHE', 'BEUK_CACHE_URLS']) {
    await w.fire('message', { data: { type, urls: ['https://beuk.example/assets/fonts/x.woff2'] }, source: { postMessage: () => {} } });
  }
  assert.ok(!w.calls.some((c) => c.startsWith('caches.open')), w.calls.join(', '));
  assert.deepEqual([...w.names], []);
});

test('the file says what it is: v23, retiring, no shell list', () => {
  assert.match(SRC, /beuk-shell-v23/);
  assert.ok(!SRC.includes('BEUK_SHELL = ['), 'no precache list');
  assert.ok(!/respondWith\s*\(/.test(SRC), 'no respondWith anywhere');
});
