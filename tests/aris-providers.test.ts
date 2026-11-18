import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { after, before, test } from 'node:test';
import { testConfig } from './helpers.js';
import { ArisUpstreamError, providerFor } from '../src/aris/providers.js';

type Seen = { method: string; url: string; headers: IncomingMessage['headers']; body: any };
let stub: Server;
let base = '';
let seen: Seen | null = null;
let handler: (res: ServerResponse) => void = () => {};

before(async () => {
  stub = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : null };
      handler(res);
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', () => r()));
  const a = stub.address();
  if (!a || typeof a === 'string') throw new Error('no stub address');
  base = `http://127.0.0.1:${a.port}`;
});
after(async () => {
  stub.closeAllConnections();
  await new Promise<void>((r) => stub.close(() => r()));
});

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const MSGS = [
  { role: 'system' as const, content: 'be brief' },
  { role: 'user' as const, content: 'hi' },
  { role: 'assistant' as const, content: 'hello' },
  { role: 'user' as const, content: 'again' },
];

test('openrouter adapter speaks chat-completions', async () => {
  handler = (res) => json(res, 200, { model: 'x/y-served', choices: [{ message: { content: 'pong' } }] });
  const p = providerFor('openrouter', testConfig({ arisOpenrouterBase: `${base}/api/v1` }));
  assert.equal(p.id, 'openrouter');
  const r = await p.chat({ apiKey: 'k-or', model: 'x/y', messages: MSGS, maxTokens: 123 });
  assert.deepEqual(r, { text: 'pong', model: 'x/y-served' });
  assert.equal(seen!.method, 'POST');
  assert.equal(seen!.url, '/api/v1/chat/completions');
  assert.equal(seen!.headers.authorization, 'Bearer k-or');
  assert.deepEqual(seen!.body, { model: 'x/y', max_tokens: 123, messages: MSGS });
});

test('anthropic adapter speaks messages', async () => {
  handler = (res) => json(res, 200, { model: 'claude-served', content: [{ type: 'text', text: 'pong' }] });
  const p = providerFor('anthropic', testConfig({ arisAnthropicBase: base }));
  assert.equal(p.id, 'anthropic');
  const r = await p.chat({ apiKey: 'k-an', model: 'claude-x', messages: MSGS, maxTokens: 77 });
  assert.deepEqual(r, { text: 'pong', model: 'claude-served' });
  assert.equal(seen!.method, 'POST');
  assert.equal(seen!.url, '/v1/messages');
  assert.equal(seen!.headers['x-api-key'], 'k-an');
  assert.equal(seen!.headers['anthropic-version'], '2023-06-01');
  assert.match(String(seen!.headers['content-type']), /application\/json/);
  assert.deepEqual(seen!.body, {
    model: 'claude-x',
    max_tokens: 77,
    system: 'be brief',
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'again' },
    ],
  });
});

test('openai-compat uses the stored baseUrl', async () => {
  handler = (res) => json(res, 200, { choices: [{ message: { content: 'pong' } }] });
  const p = providerFor('openai-compat', testConfig(), { allowPrivateHosts: true });
  assert.equal(p.id, 'openai-compat');
  const r = await p.chat({ apiKey: 'k-oc', model: 'local', messages: MSGS, maxTokens: 5, baseUrl: `${base}/v1/` });
  assert.deepEqual(r, { text: 'pong', model: 'local' }); // no model echoed → requested model
  assert.equal(seen!.url, '/v1/chat/completions');
  assert.equal(seen!.headers.authorization, 'Bearer k-oc');
  assert.deepEqual(seen!.body, { model: 'local', max_tokens: 5, messages: MSGS });
  await assert.rejects(
    () => p.chat({ apiKey: 'k', model: 'm', messages: MSGS, maxTokens: 5 }),
    (e: unknown) => e instanceof ArisUpstreamError && e.provider === 'openai-compat' && e.status === null,
  );
});

test('an upstream 401 surfaces as an ArisUpstreamError carrying the upstream words', async () => {
  handler = (res) => json(res, 401, { error: { message: 'No auth credentials found' } });
  const p = providerFor('openrouter', testConfig({ arisOpenrouterBase: base }));
  await assert.rejects(
    () => p.chat({ apiKey: 'bad', model: 'm', messages: MSGS, maxTokens: 5 }),
    (e: unknown) =>
      e instanceof ArisUpstreamError && e.provider === 'openrouter' && e.status === 401 && e.detail.includes('No auth credentials found'),
  );
  handler = (res) => json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
  const a = providerFor('anthropic', testConfig({ arisAnthropicBase: base }));
  await assert.rejects(
    () => a.chat({ apiKey: 'bad', model: 'm', messages: MSGS, maxTokens: 5 }),
    (e: unknown) => e instanceof ArisUpstreamError && e.status === 401 && e.detail.includes('invalid x-api-key'),
  );
});

test('upstream error detail is truncated to 300 chars', async () => {
  handler = (res) => json(res, 500, { error: { message: 'x'.repeat(1000) } });
  const p = providerFor('openrouter', testConfig({ arisOpenrouterBase: base }));
  await assert.rejects(
    () => p.chat({ apiKey: 'k', model: 'm', messages: MSGS, maxTokens: 5 }),
    (e: unknown) => e instanceof ArisUpstreamError && e.status === 500 && e.detail.length === 300,
  );
});

test('a malformed 200 reply is an ArisUpstreamError', async () => {
  handler = (res) => json(res, 200, { nope: true });
  for (const [id, cfg] of [
    ['openrouter', testConfig({ arisOpenrouterBase: base })],
    ['anthropic', testConfig({ arisAnthropicBase: base })],
  ] as const) {
    await assert.rejects(
      () => providerFor(id, cfg).chat({ apiKey: 'k', model: 'm', messages: MSGS, maxTokens: 5 }),
      (e: unknown) => e instanceof ArisUpstreamError && e.status === 200,
    );
  }
});

test('a hung upstream times out as an ArisUpstreamError', async () => {
  handler = () => {}; // never answers
  const p = providerFor('openrouter', testConfig({ arisOpenrouterBase: base }), { timeoutMs: 150 });
  await assert.rejects(
    () => p.chat({ apiKey: 'k', model: 'm', messages: MSGS, maxTokens: 5 }),
    (e: unknown) => e instanceof ArisUpstreamError && e.status === null && /timed out|abort/i.test(e.detail),
  );
});

test('providerFor rejects an unknown provider id', () => {
  assert.throws(() => providerFor('nope', testConfig()), /unknown/i);
});

test('openai-compat refuses a baseUrl that resolves to a private address', async () => {
  seen = null;
  const p = providerFor('openai-compat', testConfig());
  for (const baseUrl of ['https://127.0.0.1:1', 'http://10.0.0.5', 'http://[::1]/v1', 'http://169.254.169.254', 'http://[::ffff:192.168.1.1]', 'http://localhost:1']) {
    await assert.rejects(
      () => p.chat({ apiKey: 'k', model: 'm', messages: MSGS, maxTokens: 5, baseUrl }),
      (e: unknown) =>
        e instanceof ArisUpstreamError && e.status === null && e.detail === 'base url resolves to a private address',
    );
  }
  // Even pointed at the live local stub, nothing is sent.
  await assert.rejects(() => p.chat({ apiKey: 'k', model: 'm', messages: MSGS, maxTokens: 5, baseUrl: base }));
  assert.equal(seen, null);
});

test('a redirecting upstream is refused, not followed', async () => {
  seen = null;
  let hits = 0;
  handler = (res) => {
    hits++;
    res.writeHead(302, { location: `${base}/elsewhere` });
    res.end();
  };
  const cases: Array<[Parameters<typeof providerFor>[0], ReturnType<typeof testConfig>, string | undefined]> = [
    ['openrouter', testConfig({ arisOpenrouterBase: base }), undefined],
    ['anthropic', testConfig({ arisAnthropicBase: base }), undefined],
    ['openai-compat', testConfig(), base],
  ];
  for (const [id, cfg, baseUrl] of cases) {
    await assert.rejects(
      () => providerFor(id, cfg, { allowPrivateHosts: true }).chat({ apiKey: 'k', model: 'm', messages: MSGS, maxTokens: 5, baseUrl }),
      (e: unknown) => e instanceof ArisUpstreamError && e.status === 302 && e.detail === 'redirects are not followed',
    );
  }
  assert.equal(hits, 3); // one request each, the Location was never fetched
});
