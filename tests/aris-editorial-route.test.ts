import assert from 'node:assert/strict';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { after, before, test } from 'node:test';
import { DIGEST_MAX_CHARS } from '../src/aris/editorial.js';
import { Client, createTestDb, registerUser, startTestServer } from './helpers.js';

const SECRET = 'test-secret';
let stub: Server;
let base = '';
let upstreamCalls = 0;
let handler: (res: ServerResponse) => void = () => {};

before(async () => {
  stub = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      upstreamCalls++;
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
const replies = (content: string) => (res: ServerResponse) =>
  json(res, 200, { model: 'x/served', choices: [{ message: { content } }] });

const DOC = {
  meta: { title: 'Salt Road' },
  sections: [
    { id: 'sec-0', title: 'Blank', content: '   ' },
    { id: 'sec-1', title: 'One', content: 'The tide came in. Mara waited by the pier with four ships.' },
  ],
};

async function boot(opts: { optIn?: boolean } = {}) {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, {
    arisEnabled: true,
    arisKeySecret: SECRET,
    arisOpenrouterBase: `${base}/api/v1`,
  });
  const client = new Client(server.base);
  await registerUser(client, 'aris-editorial@example.com');
  if (opts.optIn ?? true) await client.put('/api/aris/settings', { optedIn: true });
  await client.put('/api/aris/key', { provider: 'openrouter', apiKey: 'sk-or-secret-1234' });
  const made = await client.post('/api/manuscripts', { title: 'Salt Road', doc: DOC });
  assert.equal(made.status, 201);
  const manuscriptId = (made.body.manuscript as { id?: string } | undefined)?.id ?? (made.body.id as string);
  return { server, client, manuscriptId };
}

const batchBody = (manuscriptId: string, over: Record<string, unknown> = {}) => ({
  manuscriptId,
  sectionIndex: 1,
  provider: 'openrouter',
  model: 'x/y',
  ...over,
});

const LENS_REPLY = JSON.stringify({
  digest: 'Mara at the pier; four ships.',
  findings: [
    {
      severity: 'major',
      category: 'prose',
      location: 'One, first line',
      quote: 'The tide came in.',
      why: 'repeated opening',
      fix: 'vary it',
    },
  ],
  claims: {
    counts: [{ chapter: 'One', subject: 'ships', op: 'set', amount: 4, quote: 'four ships' }],
    travel: [],
    calendar: [],
  },
});

test('a batch reads one section: findings surface, digest and count come back', async () => {
  const { server, client, manuscriptId } = await boot();
  try {
    handler = replies(LENS_REPLY);
    const r = await client.post('/api/aris/editorial', batchBody(manuscriptId));
    assert.equal(r.status, 200);
    const section = r.body.section as { index: number; count: number; label: string };
    assert.deepEqual(section, { index: 1, count: 2, label: 'One' });
    const report = r.body.report as { findings: unknown[]; digest: string; rejected: number };
    assert.equal(report.findings.length, 1);
    assert.equal(report.rejected, 0);
    assert.match(report.digest, /four ships/);
  } finally {
    await server.close();
  }
});

test('an empty section short-circuits with no provider call', async () => {
  const { server, client, manuscriptId } = await boot();
  try {
    const seen = upstreamCalls;
    const r = await client.post('/api/aris/editorial', batchBody(manuscriptId, { sectionIndex: 0 }));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.section, { index: 0, count: 2, label: 'Blank', empty: true });
    assert.equal(r.body.report, undefined);
    assert.equal(upstreamCalls, seen);
  } finally {
    await server.close();
  }
});

test('a prose reply from the provider is a 502, never an empty pass', async () => {
  const { server, client, manuscriptId } = await boot();
  try {
    handler = replies('Looks fine to me, great book.');
    const r = await client.post('/api/aris/editorial', batchBody(manuscriptId));
    assert.equal(r.status, 502);
    assert.match(r.body.error as string, /unreadable report/);
  } finally {
    await server.close();
  }
});

test('sectionIndex out of range is a 400; an oversized digest never reaches the provider', async () => {
  const { server, client, manuscriptId } = await boot();
  try {
    const out = await client.post('/api/aris/editorial', batchBody(manuscriptId, { sectionIndex: 9 }));
    assert.equal(out.status, 400);
    const seen = upstreamCalls;
    const fat = await client.post('/api/aris/editorial', batchBody(manuscriptId, { digest: 'd'.repeat(DIGEST_MAX_CHARS + 1) }));
    assert.equal(fat.status, 400);
    assert.equal(upstreamCalls, seen);
  } finally {
    await server.close();
  }
});

test('the verdict endpoint runs the ledger math and gates deterministically', async () => {
  const { server, client, manuscriptId } = await boot();
  void manuscriptId;
  try {
    const r = await client.post('/api/aris/editorial/verdict', {
      findings: [],
      claims: {
        counts: [
          { chapter: '1', subject: 'ships', op: 'set', amount: 100, quote: 'a hundred ships' },
          { chapter: '2', subject: 'ships', op: 'loss', amount: 30, quote: 'thirty burned' },
          { chapter: '4', subject: 'ships', op: 'set', amount: 80, quote: 'eighty ships' },
        ],
        travel: [],
        calendar: [],
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.gate, 'PASS'); // one major ledger finding: below the gate bar
    const ledgerFindings = r.body.ledgerFindings as { why: string }[];
    assert.equal(ledgerFindings.length, 1);
    assert.match(ledgerFindings[0].why, /70/);
    const crit = await client.post('/api/aris/editorial/verdict', {
      findings: [{ severity: 'critical', category: 'continuity', location: 'x', quote: 'q', why: 'w', fix: 'f' }],
      claims: { counts: [], travel: [], calendar: [] },
    });
    assert.equal(crit.body.gate, 'FAIL — DO NOT SHIP');
  } finally {
    await server.close();
  }
});

test('editorial routes refuse before opt-in', async () => {
  const { server, client, manuscriptId } = await boot({ optIn: false });
  try {
    const r = await client.post('/api/aris/editorial', batchBody(manuscriptId));
    assert.equal(r.status, 403);
    const v = await client.post('/api/aris/editorial/verdict', { findings: [], claims: { counts: [], travel: [], calendar: [] } });
    assert.equal(v.status, 403);
  } finally {
    await server.close();
  }
});
