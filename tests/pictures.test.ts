import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import type { Db } from '../src/db.js';
import { readZip } from '../src/housekeeping/packages.js';
import { collectPicRefs, PIC_REF_PREFIX } from '../src/pictures.js';

/**
 * Shelf pictures stored once (perf.autosave-sends-whole-book): a save
 * names each picture by the sha256 of its bytes instead of carrying
 * them, pictures are uploaded once per account, read back owner-scoped,
 * and collected only when no book names them.
 */

let db: Db;
let server: TestServer; // grace 0: an unnamed picture is collected at once
let alice: Client;
let bob: Client;

const REF = { 'beuk-pictures': 'ref' };
const MINIMAL = { prefer: 'return=minimal' };

function picture(n = 3000) {
  const bytes = randomBytes(n);
  return { data: bytes.toString('base64'), sha: createHash('sha256').update(bytes).digest('hex') };
}
const ref = (sha: string) => PIC_REF_PREFIX + sha;

/** A studio-shaped book whose one picture is a chapter plate. */
function book(title: string, imageData: string, coverData?: string) {
  return {
    meta: { title, author: 'A. Writer', language: 'en' },
    sections: [
      { id: 'ch1', type: 'chapter', kind: 'body', title: 'One', content: 'It began with the tide.', plateId: 'im1', plateAlt: 'A gull on a post' },
    ],
    images: [{ id: 'im1', name: 'gull.png', mediaType: 'image/png', ext: 'png', data: imageData }],
    cover: coverData ? { data: coverData, mediaType: 'image/jpeg', ext: 'jpg', name: 'cover.jpg' } : null,
    history: [],
  };
}

async function upload(c: Client, p: { data: string; sha: string }, mediaType = 'image/png') {
  return c.put(`/api/pictures/${p.sha}`, { mediaType, data: p.data });
}
async function pictureRows(userEmail?: string): Promise<number> {
  const r = userEmail
    ? await db.query<{ n: string }>('select count(*)::text as n from pictures p join users u on u.id = p.user_id where u.email = $1', [userEmail])
    : await db.query<{ n: string }>('select count(*)::text as n from pictures');
  return Number(r.rows[0].n);
}

before(async () => {
  db = await createTestDb();
  server = await startTestServer(db, undefined, { pictureGcGraceSeconds: 0 });
  alice = new Client(server.base);
  bob = new Client(server.base);
  await registerUser(alice, 'alice-pics@example.com');
  await registerUser(bob, 'bob-pics@example.com');
});

after(async () => {
  await server.close();
});

test('ownership isolation: another account can never read, find or name a picture (404, existence not leaked)', async () => {
  const p = picture();
  assert.equal((await upload(alice, p)).status, 201);
  const own = await alice.get(`/api/pictures/${p.sha}`);
  assert.equal(own.status, 200);
  const got = own.body.picture as { data: string; mediaType: string; bytes: number };
  assert.equal(got.data, p.data);
  assert.equal(got.mediaType, 'image/png');
  assert.equal(got.bytes, 3000);
  assert.equal(own.headers.get('cache-control'), 'no-store');

  // Bob: the same 404 as a hash nobody has.
  const theirs = await bob.get(`/api/pictures/${p.sha}`);
  assert.equal(theirs.status, 404);
  assert.deepEqual(theirs.body, (await bob.get(`/api/pictures/${'0'.repeat(64)}`)).body);
  assert.equal(theirs.body.picture, undefined);
  // "Do you hold it?" answers for Bob's own store only.
  const ask = await bob.post('/api/pictures/missing', { hashes: [p.sha] });
  assert.deepEqual(ask.body.missing, [p.sha]);
  // Bob cannot name Alice's picture in a doc of his own (it would read back empty for him anyway).
  const named = await bob.request('POST', '/api/manuscripts', { doc: book('Borrowed', ref(p.sha)) }, REF);
  assert.equal(named.status, 422);
  assert.deepEqual(named.body.missingPictures, [p.sha]);
  // Signed out: 401.
  assert.equal((await new Client(server.base).get(`/api/pictures/${p.sha}`)).status, 401);
  // A malformed name is "not found", never a 500.
  assert.equal((await alice.get('/api/pictures/not-a-hash')).status, 404);
});

test('uploads are verified: the name must be the sha256 of the bytes, base64 canonical, an image or font type', async () => {
  const p = picture();
  const q = picture();
  assert.equal((await alice.put(`/api/pictures/${q.sha}`, { mediaType: 'image/png', data: p.data })).status, 400, 'sha mismatch');
  assert.equal((await alice.put(`/api/pictures/${p.sha}`, { mediaType: 'text/html', data: p.data })).status, 400, 'media type');
  assert.equal((await alice.put(`/api/pictures/${p.sha}`, { mediaType: 'image/png', data: p.data.slice(0, -1) + '\n' })).status, 400, 'not canonical');
  assert.equal(await pictureRows('alice-pics@example.com'), 1, 'nothing stored by a refusal (only the first test\'s picture)');
});

test('research files ride the picture store: a PDF, a recording, a clip and plain text are kept; HTML and other text never', async () => {
  for (const mediaType of ['application/pdf', 'audio/mpeg', 'audio/mp4', 'video/webm', 'text/plain', 'text/markdown', 'text/csv']) {
    const p = picture(1500);
    assert.equal((await bob.put(`/api/pictures/${p.sha}`, { mediaType, data: p.data })).status, 201, mediaType);
    const back = await bob.get(`/api/pictures/${p.sha}`);
    assert.equal(back.body.picture.mediaType, mediaType);
    assert.equal(back.body.picture.data, p.data);
  }
  for (const mediaType of ['text/html', 'application/xhtml+xml', 'text/javascript', 'application/octet-stream', 'application/pdfx']) {
    const p = picture(1500);
    assert.equal((await bob.put(`/api/pictures/${p.sha}`, { mediaType, data: p.data })).status, 400, mediaType);
  }
});

test('size and quota limits: one picture over PICTURE_MAX_BYTES, or an account over PICTURE_QUOTA_BYTES, is 413', async () => {
  const db2 = await createTestDb();
  const s = await startTestServer(db2, undefined, { pictureMaxBytes: 4000, pictureQuotaBytes: 7000, pictureGcGraceSeconds: 3600 });
  try {
    const c = new Client(s.base);
    await registerUser(c, 'small@example.com');
    const big = picture(4001);
    const tooBig = await upload(c, big);
    assert.equal(tooBig.status, 413);
    assert.equal(tooBig.body.limitBytes, 4000);
    assert.equal((await upload(c, picture(3600))).status, 201);
    const second = picture(3600);
    const full = await upload(c, second);
    assert.equal(full.status, 413, 'quota');
    assert.equal(full.body.quotaBytes, 7000);
  } finally {
    await s.close();
  }
});

test('dedupe: the same bytes are stored once per account, however many uploads and books name them', async () => {
  const p = picture();
  assert.equal((await upload(alice, p)).status, 201);
  const again = await upload(alice, p);
  assert.equal(again.status, 200);
  assert.equal((again.body.picture as { stored: boolean }).stored, false);
  const a = await alice.request('POST', '/api/manuscripts', { doc: book('Book A', ref(p.sha)) }, REF);
  const b = await alice.request('POST', '/api/manuscripts', { doc: book('Book B', ref(p.sha), ref(p.sha)) }, REF);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const rows = await db.query<{ n: string }>('select count(*)::text as n from pictures where sha256 = $1', [p.sha]);
  assert.equal(rows.rows[0].n, '1');
  const ask = await alice.post('/api/pictures/missing', { hashes: [p.sha, p.sha, picture().sha] });
  assert.equal((ask.body.missing as string[]).length, 1, 'held once, asked twice: only the unknown one is missing');
});

test('an old doc with inline pictures still loads, and is migrated on its next save: the shelf then holds no picture bytes in the doc', async () => {
  const p = picture(5000);
  const c = picture(4000);
  const inline = book('Inline Book', p.data, c.data);
  const created = await alice.post('/api/manuscripts', { doc: inline });
  assert.equal(created.status, 201);
  const id = (created.body.manuscript as { id: string }).id;
  // Old shape, both ways of asking: nothing is named, so both get the bytes.
  assert.deepEqual(((await alice.get(`/api/manuscripts/${id}`)).body.manuscript as { doc: unknown }).doc, inline);
  assert.deepEqual(((await alice.request('GET', `/api/manuscripts/${id}`, undefined, REF)).body.manuscript as { doc: unknown }).doc, inline);

  // The studio's next save: upload what the shelf lacks, then the doc with names.
  const ask = await alice.post('/api/pictures/missing', { hashes: [p.sha, c.sha] });
  assert.deepEqual([...(ask.body.missing as string[])].sort(), [p.sha, c.sha].sort());
  assert.equal((await upload(alice, p)).status, 201);
  assert.equal((await upload(alice, c, 'image/jpeg')).status, 201);
  const named = book('Inline Book', ref(p.sha), ref(c.sha));
  const saved = await alice.request('PUT', `/api/manuscripts/${id}`, { doc: named }, { ...REF, ...MINIMAL, 'if-match': '"1"' });
  assert.equal(saved.status, 200);
  assert.equal((saved.body.manuscript as { revision: number }).revision, 2);
  assert.equal((saved.body.manuscript as { doc?: unknown }).doc, undefined, 'Prefer: return=minimal leaves the doc out');

  const stored = await db.query<{ doc: unknown; len: number }>('select doc, octet_length(doc::text) as len from manuscripts where id = $1', [id]);
  assert.ok(!JSON.stringify(stored.rows[0].doc).includes(p.data.slice(0, 200)), 'no picture bytes in the stored doc');
  assert.deepEqual(collectPicRefs(stored.rows[0].doc).sort(), [p.sha, c.sha].sort());
  assert.ok(Number(stored.rows[0].len) < 1000, `stored doc is ${stored.rows[0].len} bytes`);

  // Any reader that did not ask for names gets the book exactly as it was.
  assert.deepEqual(((await alice.get(`/api/manuscripts/${id}`)).body.manuscript as { doc: unknown }).doc, inline);
  // The studio asking for names gets the names.
  assert.deepEqual(((await alice.request('GET', `/api/manuscripts/${id}`, undefined, REF)).body.manuscript as { doc: unknown }).doc, named);

  // Beta-reader share snapshot and the account export still carry the pictures.
  const share = await alice.post('/api/shares', { manuscriptId: id });
  assert.equal(share.status, 201, JSON.stringify(share.body));
  const shareImages = await db.query<{ images: Record<string, { data: string }> }>('select images from shares where manuscript_id = $1', [id]);
  assert.equal(shareImages.rows[0].images.im1?.data, p.data, 'the reading copy holds the picture');
  const zip = await alice.download('/api/account/export');
  assert.equal(zip.status, 200);
  const entry = readZip(zip.bytes).find((e) => e.name.startsWith('manuscripts/') && e.name.includes(`(${id.slice(0, 8)})`));
  assert.ok(entry, 'the book is in the export: ' + readZip(zip.bytes).map((e) => e.name).join(', '));
  const backup = JSON.parse(entry!.data.toString('utf8')) as { book: { images: Array<{ data: string }>; cover: { data: string } } };
  assert.equal(backup.book.images[0].data, p.data, 'the export backup holds the picture bytes');
  assert.equal(backup.book.cover.data, c.data, 'and the cover');
});

test('revision / 409 semantics are unchanged with named pictures; a doc naming a missing picture is 422 and writes nothing', async () => {
  const p = picture();
  assert.equal((await upload(alice, p)).status, 201);
  const created = await alice.request('POST', '/api/manuscripts', { doc: book('Rev Book', ref(p.sha)) }, { ...REF, ...MINIMAL });
  assert.equal(created.status, 201);
  assert.equal((created.body.manuscript as { doc?: unknown }).doc, undefined);
  const id = (created.body.manuscript as { id: string }).id;
  assert.equal(created.headers.get('etag'), '"1"');

  const a = await alice.request('PUT', `/api/manuscripts/${id}`, { doc: { ...book('Device A', ref(p.sha)) } }, { ...REF, 'if-match': '"1"' });
  assert.equal(a.status, 200);
  assert.equal(a.headers.get('etag'), '"2"');

  // Stale base: 409 with the current shelf copy — named for the studio, whole for anyone else.
  const stale = await alice.request('PUT', `/api/manuscripts/${id}`, { doc: book('Device B', ref(p.sha)) }, { ...REF, 'if-match': '"1"' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'BEUK-C801');
  const m409 = stale.body.manuscript as { revision: number; doc: ReturnType<typeof book> };
  assert.equal(m409.revision, 2);
  assert.equal(m409.doc.meta.title, 'Device A');
  assert.equal(m409.doc.images[0].data, ref(p.sha));
  const staleWhole = await alice.put(`/api/manuscripts/${id}`, { doc: book('Device B', ref(p.sha)) }, { 'if-match': '"1"' });
  assert.equal(staleWhole.status, 409);
  assert.equal((staleWhole.body.manuscript as { doc: ReturnType<typeof book> }).doc.images[0].data, p.data);
  // No base: 428 with the copy, as before.
  const noBase = await alice.request('PUT', `/api/manuscripts/${id}`, { doc: book('No base', ref(p.sha)) }, REF);
  assert.equal(noBase.status, 428);
  assert.equal((noBase.body.manuscript as { revision: number }).revision, 2);

  // Naming a picture the shelf lacks: 422, revision and doc untouched.
  const lost = picture();
  const refused = await alice.request('PUT', `/api/manuscripts/${id}`, { doc: book('Lost picture', ref(lost.sha)) }, { ...REF, 'if-match': '"2"' });
  assert.equal(refused.status, 422);
  assert.deepEqual(refused.body.missingPictures, [lost.sha]);
  const after422 = await alice.request('GET', `/api/manuscripts/${id}`, undefined, REF);
  assert.equal((after422.body.manuscript as { revision: number }).revision, 2);
  assert.equal((after422.body.manuscript as { doc: ReturnType<typeof book> }).doc.meta.title, 'Device A');
  // Upload it, save again on the same base: lands as revision 3.
  assert.equal((await upload(alice, lost)).status, 201);
  const ok = await alice.request('PUT', `/api/manuscripts/${id}`, { doc: book('Found picture', ref(lost.sha)) }, { ...REF, 'if-match': '"2"' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('etag'), '"3"');
  // Bob still cannot touch it.
  assert.equal((await bob.request('PUT', `/api/manuscripts/${id}`, { doc: book('x', ref(lost.sha)) }, { ...REF, 'if-match': '"3"' })).status, 422);
  assert.equal((await bob.request('PUT', `/api/manuscripts/${id}`, { doc: book('x', 'inline') }, { 'if-match': '"3"' })).status, 404);
});

test('collection is safe: a picture two books name survives deleting one, and goes with the last', async () => {
  const p = picture();
  const solo = picture();
  assert.equal((await upload(alice, p)).status, 201);
  assert.equal((await upload(alice, solo)).status, 201);
  const one = await alice.request('POST', '/api/manuscripts', { doc: book('Shared One', ref(p.sha), ref(solo.sha)) }, REF);
  const two = await alice.request('POST', '/api/manuscripts', { doc: book('Shared Two', ref(p.sha)) }, REF);
  const id1 = (one.body.manuscript as { id: string }).id;
  const id2 = (two.body.manuscript as { id: string }).id;
  const has = async (sha: string) => (await db.query('select 1 from pictures where sha256 = $1', [sha])).rows.length === 1;

  assert.equal((await alice.delete(`/api/manuscripts/${id1}`)).status, 204);
  assert.ok(await has(p.sha), 'the picture Shared Two still names survives');
  assert.ok(!(await has(solo.sha)), 'the picture only Shared One named is collected');
  const read = await alice.get(`/api/manuscripts/${id2}`);
  assert.equal((read.body.manuscript as { doc: ReturnType<typeof book> }).doc.images[0].data, p.data, 'and Shared Two still reads whole');

  // A save that drops the picture lets it go too (nothing else names it).
  const dropped = await alice.request('PUT', `/api/manuscripts/${id2}`, { doc: { ...book('Shared Two', ''), images: [] } }, { ...REF, 'if-match': '"1"' });
  assert.equal(dropped.status, 200);
  assert.ok(!(await has(p.sha)), 'unnamed by every book: collected');

  // Bob's books never protect or collect Alice's pictures, and the reverse.
  const q = picture();
  assert.equal((await upload(alice, q)).status, 201);
  assert.equal((await upload(bob, q)).status, 201);
  const bobBook = await bob.request('POST', '/api/manuscripts', { doc: book('Bob', ref(q.sha)) }, REF);
  const bobId = (bobBook.body.manuscript as { id: string }).id;
  const aliceBook = await alice.request('POST', '/api/manuscripts', { doc: book('Alice', ref(q.sha)) }, REF);
  assert.equal((await alice.delete(`/api/manuscripts/${(aliceBook.body.manuscript as { id: string }).id}`)).status, 204);
  const left = await db.query<{ email: string }>('select u.email from pictures p join users u on u.id = p.user_id where p.sha256 = $1', [q.sha]);
  assert.deepEqual(left.rows.map((r) => r.email), ['bob-pics@example.com'], "Alice's copy collected, Bob's kept");
  assert.equal(((await bob.get(`/api/manuscripts/${bobId}`)).body.manuscript as { doc: ReturnType<typeof book> }).doc.images[0].data, q.data);

  // The database itself refuses to drop a picture a book names.
  await assert.rejects(db.query('delete from pictures where sha256 = $1', [q.sha]));
});

test('a fresh upload no book names yet is kept through the grace window (a save in progress)', async () => {
  const db2 = await createTestDb();
  const s = await startTestServer(db2, undefined, { pictureGcGraceSeconds: 3600 });
  try {
    const c = new Client(s.base);
    await registerUser(c, 'grace@example.com');
    const p = picture();
    const kept = picture();
    assert.equal((await upload(c, p)).status, 201);
    const m = await c.request('POST', '/api/manuscripts', { doc: book('Grace', ref(p.sha)) }, REF);
    // Uploaded, not yet named (the doc save is still to come):
    assert.equal((await upload(c, kept)).status, 201);
    assert.equal((await c.delete(`/api/manuscripts/${(m.body.manuscript as { id: string }).id}`)).status, 204);
    const left = await db2.query<{ sha256: string }>('select sha256 from pictures order by sha256');
    assert.deepEqual(left.rows.map((r) => r.sha256).sort(), [p.sha, kept.sha].sort(), 'both inside the grace window');
  } finally {
    await s.close();
  }
});

test('deleting the account deletes its pictures', async () => {
  const c = new Client(server.base);
  await registerUser(c, 'leaving-pics@example.com');
  assert.equal((await upload(c, picture())).status, 201);
  assert.equal(await pictureRows('leaving-pics@example.com'), 1);
  const del = await c.post('/api/account/delete', { currentPassword: 'correct horse battery', confirmPhrase: 'delete my account' });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((del.body.removed as Record<string, number>).pictures, 1);
  assert.equal(await pictureRows('leaving-pics@example.com'), 0);
});
