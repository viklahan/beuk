import assert from 'node:assert/strict';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { after, before, test } from 'node:test';
import { verifyProposalToken } from '../src/aris/token.js';
import { Client, createTestDb, registerUser, startTestServer } from './helpers.js';

const SECRET = 'test-secret';
let stub: Server;
let base = '';
let seenBody: any = null;
let handler: (res: ServerResponse) => void = () => {};

before(async () => {
  stub = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seenBody = raw ? JSON.parse(raw) : null;
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
const ok = (text: string) => (res: ServerResponse) =>
  json(res, 200, { model: 'x/served', choices: [{ message: { content: text } }] });

const SECTION_ID = 'sec-1';
const DOC = {
  meta: { title: 'Salt Road', series: 'Salt  Road Saga' },
  sections: [{ id: SECTION_ID, title: 'One', content: 'The tide came in. Mara waited by the pier.' }],
};

async function boot(opts: { withKey?: boolean } = {}) {
  const withKey = opts.withKey ?? true;
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, {
    arisEnabled: true,
    arisKeySecret: SECRET,
    arisOpenrouterBase: `${base}/api/v1`,
  });
  const client = new Client(server.base);
  await registerUser(client, 'aris-draft@example.com');
  await client.put('/api/aris/settings', { optedIn: true });
  if (withKey) await client.put('/api/aris/key', { provider: 'openrouter', apiKey: 'sk-or-secret-1234' });
  const made = await client.post('/api/manuscripts', { title: 'Salt Road', doc: DOC });
  assert.equal(made.status, 201);
  const manuscriptId = (made.body.manuscript as { id?: string } | undefined)?.id ?? (made.body.id as string);
  assert.ok(manuscriptId, 'manuscript id');
  return { server, client, db, manuscriptId };
}

const body = (manuscriptId: string, over: Record<string, unknown> = {}) => ({
  manuscriptId,
  sectionId: SECTION_ID,
  action: 'beat',
  instruction: 'Mara sees a sail',
  provider: 'openrouter',
  model: 'x/y',
  ...over,
});

test('a beat drafts prose and mints a verifiable token', async () => {
  const { server, client, manuscriptId } = await boot();
  try {
    handler = ok('A sail cut the grey line of the horizon.');
    const r = await client.post('/api/aris/draft', body(manuscriptId));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.proposal, {
      text: 'A sail cut the grey line of the horizon.',
      model: 'x/served',
      provider: 'openrouter',
      action: 'beat',
    });
    const p = verifyProposalToken(SECRET, r.body.token as string);
    assert.ok(p);
    assert.equal(p.action, 'beat');
    assert.equal(p.kind, 'generated-new');
    assert.equal(p.provider, 'openrouter');
    assert.equal(p.model, 'x/served');
    assert.equal(p.proposalChars, 'A sail cut the grey line of the horizon.'.length);
    assert.equal(p.manuscriptId, manuscriptId);
    assert.equal(p.sectionId, SECTION_ID);
    assert.ok(p.nonce && p.userId && p.ts);
    // the stub saw the section text, so extraction ran server-side
    assert.match(JSON.stringify(seenBody), /Mara waited by the pier/);
  } finally {
    await server.close();
  }
});

test('no stored key is a clean 400 naming the /aris page', async () => {
  const { server, client, manuscriptId } = await boot({ withKey: false });
  try {
    const r = await client.post('/api/aris/draft', body(manuscriptId));
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: 'no openrouter key on your /aris page' });
  } finally {
    await server.close();
  }
});

test('an upstream 401 is a 502 carrying the provider words', async () => {
  const { server, client, manuscriptId } = await boot();
  try {
    handler = (res) => json(res, 401, { error: { message: 'No auth credentials found' } });
    const r = await client.post('/api/aris/draft', body(manuscriptId));
    assert.equal(r.status, 502);
    assert.equal(r.body.error, 'openrouter refused the request');
    assert.match(String(r.body.detail), /No auth credentials found/);
  } finally {
    await server.close();
  }
});

test("another writer's manuscript is a 404", async () => {
  const { server, client, manuscriptId } = await boot();
  try {
    const other = new Client(server.base);
    await registerUser(other, 'aris-other@example.com');
    await other.put('/api/aris/settings', { optedIn: true });
    await other.put('/api/aris/key', { provider: 'openrouter', apiKey: 'sk-or-other-5678' });
    const r = await other.post('/api/aris/draft', body(manuscriptId));
    assert.equal(r.status, 404);
    assert.deepEqual(r.body, { error: 'manuscript not found' });
    const missing = await client.post('/api/aris/draft', body('00000000-0000-4000-8000-000000000000'));
    assert.equal(missing.status, 404);
    const unknownSection = await client.post('/api/aris/draft', body(manuscriptId, { sectionId: 'nope' }));
    assert.equal(unknownSection.status, 404);
    assert.deepEqual(unknownSection.body, { error: 'section not found' });
  } finally {
    await server.close();
  }
});

test('summarize counts as generated-new, condense as replaced-own-prose', async () => {
  const { server, client, manuscriptId } = await boot();
  try {
    handler = ok('Mara waits.');
    const s = await client.post('/api/aris/draft', body(manuscriptId, { action: 'summarize', instruction: undefined }));
    assert.equal(s.status, 200);
    assert.equal(verifyProposalToken(SECRET, s.body.token as string)!.kind, 'generated-new');
    const c = await client.post(
      '/api/aris/draft',
      body(manuscriptId, { action: 'condense', instruction: undefined, selection: { text: 'The tide came in.' } }),
    );
    assert.equal(c.status, 200);
    assert.equal(verifyProposalToken(SECRET, c.body.token as string)!.kind, 'replaced-own-prose');
  } finally {
    await server.close();
  }
});

test("the covenant of the manuscript's series reaches the prompt", async () => {
  const { server, client, manuscriptId } = await boot();
  try {
    const put = await client.put(`/api/series-covenants/${encodeURIComponent('salt road saga')}`, {
      name: 'Salt Road Saga',
      doc: { entries: [{ id: 'e1', kind: 'character', name: 'Mara', note: 'one-eyed ferrywoman' }] },
    });
    assert.ok(put.status === 200 || put.status === 201, `covenant put ${put.status}`);
    handler = ok('x');
    const r = await client.post('/api/aris/draft', body(manuscriptId));
    assert.equal(r.status, 200);
    assert.match(JSON.stringify(seenBody), /one-eyed ferrywoman/);
  } finally {
    await server.close();
  }
});

test('a bad body is a 400 and a tampered token fails verification', async () => {
  const { server, client, manuscriptId } = await boot();
  try {
    const bad = await client.post('/api/aris/draft', body(manuscriptId, { action: 'sing' }));
    assert.equal(bad.status, 400);
    handler = ok('hello');
    const r = await client.post('/api/aris/draft', body(manuscriptId));
    const t = r.body.token as string;
    assert.equal(verifyProposalToken('other-secret', t), null);
    const [v, pl, mac] = t.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(pl, 'base64url').toString()), proposalChars: 1 }),
    ).toString('base64url');
    assert.equal(verifyProposalToken(SECRET, `${v}.${forged}.${mac}`), null);
  } finally {
    await server.close();
  }
});

test('a stored key the server cannot read is an honest 409, not a 500', async () => {
  const { server, client, db, manuscriptId } = await boot();
  try {
    await db.query("update aris_keys set key_ciphertext = 'not-a-real-ciphertext' where provider = 'openrouter'");
    const r = await client.post('/api/aris/draft', body(manuscriptId));
    assert.equal(r.status, 409);
    assert.deepEqual(r.body, { error: 'your openrouter key could not be read — re-enter it on your /aris page' });
  } finally {
    await server.close();
  }
});

test('an oversized selection is a 400 asking for less', async () => {
  const { server, client, manuscriptId } = await boot();
  try {
    const r = await client.post(
      '/api/aris/draft',
      body(manuscriptId, { action: 'rewrite', instruction: undefined, selection: { text: 'x'.repeat(25_000) } }),
    );
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: 'that selection is too large for one pass — select less' });
  } finally {
    await server.close();
  }
});

test("a key's stored model wins over the model the client sent", async () => {
  const { server, client, manuscriptId } = await boot({ withKey: false });
  try {
    const put = await client.put('/api/aris/key', {
      provider: 'openrouter',
      apiKey: 'sk-or-secret-1234',
      model: 'stored/model',
    });
    assert.equal(put.status, 200);
    handler = (res) => json(res, 200, { choices: [{ message: { content: 'Salt.' } }] });
    const r = await client.post('/api/aris/draft', body(manuscriptId, { model: 'client/default' }));
    assert.equal(r.status, 200);
    assert.equal(seenBody.model, 'stored/model');
    assert.equal(r.body.proposal.model, 'stored/model');
    const p = verifyProposalToken(SECRET, r.body.token as string);
    assert.equal(p?.model, 'stored/model');
  } finally {
    await server.close();
  }
});

test('a key with no stored model falls back to the client model', async () => {
  const { server, client, manuscriptId } = await boot();
  try {
    handler = (res) => json(res, 200, { choices: [{ message: { content: 'Salt.' } }] });
    const r = await client.post('/api/aris/draft', body(manuscriptId, { model: 'client/default' }));
    assert.equal(r.status, 200);
    assert.equal(seenBody.model, 'client/default');
  } finally {
    await server.close();
  }
});
