import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import { issueOAuthToken, registerClient } from '../src/oauth/model.js';
import type { Db } from '../src/db.js';

/* Phase 3 (PHASE3.md item 4): every bearer-authed manuscript UPDATE —
   the MCP update_chapter path — leaves one audit row in mcp_writes,
   written by the app itself. A session write (the writer's own hands)
   leaves none, and a bearer CREATE leaves none: the audit is about an
   app changing existing author text. */

let db: Db;
let server: TestServer;
let alice: Client;
let userId: string;
let clientId: string;
let access: string;
let manuscriptId: string;

const docV1 = {
  title: 'Audited',
  sections: [
    { id: 'ch1', kind: 'body', type: 'chapter', title: 'One', content: 'Short words.' },
    { id: 'ch2', kind: 'body', type: 'chapter', title: 'Two', content: 'Stays the same.' },
  ],
};

async function bearer(method: string, pathName: string, body: unknown) {
  const res = await fetch(`${server.base}${pathName}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function auditRows() {
  const r = await db.query<{
    user_id: string;
    client_id: string;
    token_id: string;
    manuscript_id: string;
    changed_sections: unknown;
    bytes_before: number;
    bytes_after: number;
  }>('select user_id, client_id, token_id, manuscript_id, changed_sections, bytes_before, bytes_after from mcp_writes order by created_at');
  return r.rows;
}

before(async () => {
  db = await createTestDb();
  server = await startTestServer(db);
  alice = new Client(server.base);
  await registerUser(alice, 'audit@example.com');
  userId = (await db.query<{ id: string }>("select id from users where email = 'audit@example.com'")).rows[0].id;
  const created = await alice.post('/api/manuscripts', { doc: docV1 });
  assert.equal(created.status, 201);
  manuscriptId = (created.body.manuscript as { id: string }).id;
  clientId = (await registerClient(db, 'Claude', ['https://claude.ai/api/mcp/auth_callback'])).id;
  access = await issueOAuthToken(db, {
    kind: 'access',
    userId,
    clientId,
    scopes: 'beuk:read beuk:write',
    ttlMs: 3_600_000,
  });
});

after(async () => {
  await server.close();
});

test('a bearer update leaves one audit row: writer, client, token, book, changed section, byte sizes', async () => {
  const docV2 = {
    ...docV1,
    sections: [
      { id: 'ch1', kind: 'body', type: 'chapter', title: 'One', content: 'Much longer replacement words for chapter one, written through MCP.' },
      docV1.sections[1],
    ],
  };
  const updated = await bearer('PUT', `/api/manuscripts/${manuscriptId}`, { doc: docV2, revision: 1 });
  assert.equal(updated.status, 200);

  const rows = await auditRows();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.user_id, userId);
  assert.equal(row.client_id, clientId);
  assert.ok(row.token_id, 'token_id recorded');
  assert.equal(row.manuscript_id, manuscriptId);
  assert.deepEqual(row.changed_sections, ['ch1']);
  assert.ok(row.bytes_before > 0);
  assert.ok(row.bytes_after > row.bytes_before, 'longer doc recorded as more bytes');
});

test('a session write leaves no audit row', async () => {
  const current = await alice.get(`/api/manuscripts/${manuscriptId}`);
  const revision = (current.body.manuscript as { revision: number }).revision;
  const res = await alice.request('PUT', `/api/manuscripts/${manuscriptId}`, {
    doc: docV1,
    revision,
  });
  assert.equal(res.status, 200);
  assert.equal((await auditRows()).length, 1, 'still only the bearer write');
});

test('a bearer create is not audited: the audit is about changing existing text', async () => {
  const created = await bearer('POST', '/api/manuscripts', { doc: { title: 'New via MCP', sections: [] } });
  assert.equal(created.status, 201);
  assert.equal((await auditRows()).length, 1);
});
