import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';
import type { Db } from '../src/db.js';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';

/* BEUK:savesync (round 7) — two overlapping shelf saves never raise a
   false "changed in two places". The server's If-Match contract is
   unchanged (it was already right); these tests pin it under a real
   race, and guard the client's single-flight queue, its per-book
   answer guard and the self-checks' registration. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const IDS = ['shelf.save.single-flight', 'shelf.save.identical-409-silent'];

let server: TestServer;
let alice: Client;

before(async () => {
  const db: Db = await createTestDb();
  server = await startTestServer(db);
  alice = new Client(server.base);
  await registerUser(alice, 'savesync@example.com');
});

after(async () => {
  await server.close();
});

test('savesync: two PUTs racing on the same If-Match — exactly one lands, the other gets 409 with the winner’s copy', async () => {
  const created = await alice.post('/api/manuscripts', { doc: { title: 'Race', sections: [] } });
  const id = (created.body.manuscript as { id: string }).id;
  const docA = { title: 'Race', sections: [], words: 'first save' };
  const docB = { title: 'Race', sections: [], words: 'second save' };
  const [a, b] = await Promise.all([
    alice.put(`/api/manuscripts/${id}`, { doc: docA }, { 'if-match': '"1"' }),
    alice.put(`/api/manuscripts/${id}`, { doc: docB }, { 'if-match': '"1"' }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409], `statuses ${a.status} / ${b.status}`);
  const won = a.status === 200 ? a : b;
  const lost = a.status === 200 ? b : a;
  assert.equal((won.body.manuscript as { revision: number }).revision, 2);
  const shelf = lost.body.manuscript as { revision: number; doc: unknown };
  assert.equal(shelf.revision, 2, 'the 409 carries the current revision');
  assert.deepEqual(shelf.doc, (won.body.manuscript as { doc: unknown }).doc, 'the 409 carries the winner’s copy');
  // A save that names the revision the first answer returned lands.
  const next = await alice.put(`/api/manuscripts/${id}`, { doc: docB }, { 'if-match': '"2"' });
  assert.equal(next.status, 200);
  assert.equal((next.body.manuscript as { revision: number }).revision, 3);
});

test('savesync: the new self-checks exist in the client and are registered client-only with a reason', async () => {
  const html = await clientHtml();
  for (const id of IDS) {
    assert.ok(html.includes(`{ id: "${id}"`), `${id} present in the client self-checks`);
    const c = SELF_CHECK_CASES.find((x) => x.id === id);
    assert.ok(c, `${id} registered`);
    assert.equal(c!.kind, 'client-only', id);
    assert.ok(c!.reason && c!.reason.length > 10, `${id} has a reason`);
  }
  // Both are async (they wait on a stand-in shelf's answers).
  const asyncStart = html.indexOf('const SELF_CHECKS_ASYNC = [');
  for (const id of IDS) assert.ok(html.indexOf(`{ id: "${id}"`) > asyncStart, `${id} is an async check`);
});

test('savesync: saves stay single-flight, and an answer only lands on the book it was sent for', async () => {
  const html = await clientHtml();
  const now = html.slice(html.indexOf('function cloudSaveNow() {'), html.indexOf('async function cloudSaveRun() {'));
  assert.match(now, /if \(!cloudSaveInFlight\) \{/);
  assert.match(now, /cloudSaveFollowUp = cloudSaveInFlight\.catch\(\(\) => \{\}\)\.then\(/);
  const run = html.slice(html.indexOf('async function cloudSaveRun() {'), html.indexOf('function setSyncStatus(status) {'));
  const sent = run.indexOf('const sentFor = cloudSaveOwner();');
  const fetchAt = run.indexOf('await apiFetch(');
  const guard = run.indexOf('if (cloudSaveOwner() !== sentFor');
  const lands = run.indexOf('if (res && res.manuscript) {');
  assert.ok(sent > 0 && sent < fetchAt, 'the owner is taken before the request leaves');
  assert.ok(guard > fetchAt && guard < lands, 'the owner is checked before any answer is applied');
  // Every early way out settles the status line.
  assert.match(run, /if \(!cloud\.user \|\| !cloud\.available \|\| !cloudDirty\) \{ cloudSettleStatus\(\); return; \}/);
  assert.match(run, /if \(cloud\.conflict\) \{ cloudSettleStatus\(\); return; \}/);
});

test('savesync: reconnect trusts the revision and forgives only a whole-document match; the real conflict branch remains', async () => {
  const html = await clientHtml();
  const flush = html.slice(html.indexOf('async function cloudReconnectFlush() {'), html.indexOf('function raiseConflict(manuscript) {'));
  assert.match(flush, /m\.revision === cloud\.baseRevision/);
  assert.match(flush, /bookDocsSame\(m\.doc, serializeBook\(\)\)/);
  assert.ok(flush.indexOf('bookDocsSame(m.doc, serializeBook())') < flush.indexOf('raiseConflict(r.manuscript)'), 'the same-book agreement comes before the real conflict');
});
