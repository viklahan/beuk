import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mintProposalToken, type ProposalPayload } from '../src/aris/token.js';
import { Client, createTestDb, registerUser, startTestServer } from './helpers.js';

const SECRET = 'test-secret';
const MS_ID = '11111111-2222-4333-8444-555555555555';

async function boot() {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, { arisEnabled: true, arisKeySecret: SECRET });
  const client = new Client(server.base);
  await registerUser(client, 'aris-insert@example.com');
  await client.put('/api/aris/settings', { optedIn: true });
  const me = await db.query<{ id: string }>('select id from users where email = $1', ['aris-insert@example.com']);
  return { db, server, client, userId: String(me.rows[0].id) };
}

const payload = (userId: string, over: Partial<ProposalPayload> = {}): ProposalPayload => ({
  userId,
  manuscriptId: MS_ID,
  sectionId: 'sec-1',
  action: 'rewrite',
  kind: 'replaced-own-prose',
  provider: 'openrouter',
  model: 'x/served',
  proposalChars: 42,
  nonce: 'nonce-1',
  ts: Date.now(),
  ...over,
});
const rows = (db: Awaited<ReturnType<typeof boot>>['db']) => db.query<any>('select * from ai_writes order by created_at');

test('an accepted proposal lands one ai_writes row of facts', async () => {
  const { db, server, client, userId } = await boot();
  try {
    const token = mintProposalToken(SECRET, payload(userId));
    const r = await client.post('/api/aris/insert', { token, bytesBefore: 120, bytesAfter: 150, writerEdited: true });
    assert.equal(r.status, 202);
    assert.deepEqual(r.body, { recorded: true });
    const all = (await rows(db)).rows;
    assert.equal(all.length, 1);
    const w = all[0];
    assert.equal(String(w.user_id), userId);
    assert.equal(w.manuscript_id, MS_ID);
    assert.equal(w.section_id, 'sec-1');
    assert.equal(w.lens, 'draft');
    assert.equal(w.action, 'rewrite');
    assert.equal(w.kind, 'replaced-own-prose');
    assert.equal(w.provider, 'openrouter');
    assert.equal(w.model, 'x/served');
    assert.equal(w.proposal_chars, 42);
    assert.equal(w.bytes_before, 120);
    assert.equal(w.bytes_after, 150);
    assert.equal(w.writer_edited, true);
    assert.equal(w.nonce, 'nonce-1');
  } finally {
    await server.close();
  }
});

test('a replayed token is a 409 and one row remains', async () => {
  const { db, server, client, userId } = await boot();
  try {
    const token = mintProposalToken(SECRET, payload(userId));
    const b = { token, bytesBefore: 1, bytesAfter: 2, writerEdited: false };
    assert.equal((await client.post('/api/aris/insert', b)).status, 202);
    const again = await client.post('/api/aris/insert', b);
    assert.equal(again.status, 409);
    assert.deepEqual(again.body, { error: 'this proposal is already recorded' });
    assert.equal((await rows(db)).rows.length, 1);
  } finally {
    await server.close();
  }
});

test('a forged token is a 403 and no row', async () => {
  const { db, server, client, userId } = await boot();
  try {
    const forged = mintProposalToken('some-other-secret', payload(userId));
    const r = await client.post('/api/aris/insert', { token: forged, bytesBefore: 1, bytesAfter: 2, writerEdited: false });
    assert.equal(r.status, 403);
    const stale = mintProposalToken(SECRET, payload(userId, { nonce: 'old', ts: Date.now() - 25 * 3600 * 1000 }));
    assert.equal((await client.post('/api/aris/insert', { token: stale, bytesBefore: 1, bytesAfter: 2, writerEdited: false })).status, 403);
    assert.equal((await client.post('/api/aris/insert', { token: 'garbage', bytesBefore: 1, bytesAfter: 2, writerEdited: false })).status, 403);
    assert.equal((await rows(db)).rows.length, 0);
  } finally {
    await server.close();
  }
});

test('another user presenting a stolen token is a 403', async () => {
  const { db, server, userId } = await boot();
  try {
    const thief = new Client(server.base);
    await registerUser(thief, 'aris-thief@example.com');
    await thief.put('/api/aris/settings', { optedIn: true });
    const token = mintProposalToken(SECRET, payload(userId));
    const r = await thief.post('/api/aris/insert', { token, bytesBefore: 1, bytesAfter: 2, writerEdited: false });
    assert.equal(r.status, 403);
    assert.equal((await rows(db)).rows.length, 0);
  } finally {
    await server.close();
  }
});

test('multibyte spans count UTF-8 bytes', async () => {
  const { db, server, client, userId } = await boot();
  try {
    const before = 'नमस्ते'; // 6 code points x 3 bytes = 18
    const after = 'नमस्ते 🌊'; // 18 + 1 space + 4 (emoji) = 23
    assert.equal(Buffer.byteLength(before), 18);
    assert.equal(Buffer.byteLength(after), 23);
    assert.notEqual(before.length, 18); // UTF-16 length differs: the unit is bytes
    const token = mintProposalToken(SECRET, payload(userId));
    const r = await client.post('/api/aris/insert', {
      token,
      bytesBefore: Buffer.byteLength(before),
      bytesAfter: Buffer.byteLength(after),
      writerEdited: false,
    });
    assert.equal(r.status, 202);
    const w = (await rows(db)).rows[0];
    assert.equal(w.bytes_before, 18);
    assert.equal(w.bytes_after, 23);
  } finally {
    await server.close();
  }
});

test('a bad body is a 400 and no row', async () => {
  const { db, server, client, userId } = await boot();
  try {
    const token = mintProposalToken(SECRET, payload(userId));
    const good = { token, bytesBefore: 1, bytesAfter: 2, writerEdited: false };
    for (const bad of [
      { ...good, bytesBefore: -1 },
      { ...good, bytesBefore: 1e10 },
      { ...good, bytesAfter: 1e10 },
      { ...good, bytesAfter: 1.5 },
      { ...good, bytesAfter: '2' },
      { ...good, writerEdited: 'yes' },
      { ...good, writerEdited: undefined },
      { ...good, token: undefined },
    ]) {
      assert.equal((await client.post('/api/aris/insert', bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await rows(db)).rows.length, 0);
  } finally {
    await server.close();
  }
});
