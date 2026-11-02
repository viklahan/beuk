import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import { collectUnusedPictures } from '../src/pictures.js';
import { readZip } from '../src/housekeeping/packages.js';
import { ACCOUNT_DELETED_TABLES } from '../src/account/data.js';
import { BACKUP_TABLES } from '../src/housekeeping/backup.js';
import type { Db } from '../src/db.js';

/* Per-user themes ("My themes", plan 2026-11-02 constraint 47): GET/PUT/DELETE /api/themes, owner-scoped, a revision
   and 409 on a stale write, caps, the carried fonts and flourishes named by hash and held in the account's own
   picture store, and the account's export / deletion / backup covering the table. */

let db: Db;
let server: TestServer;
let alice: Client;
let bob: Client;

const b64 = (s: string) => Buffer.from(s).toString('base64');
const sha = (data: string) => createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex');
/** A font's bytes (1.0 checks the TrueType magic; the server does not read fonts). */
const FONT = b64('\u0000\u0001\u0000\u0000 pretend truetype face for alice');
const FLOURISH = b64('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1"/></svg>');

const theme = (id: string, name: string, assets: unknown[] = []) => ({
  id,
  name,
  theme: { bodyFont: 'Harbour Serif', headFont: 'Libre Baskerville', fontSize: 18, ornament: 'fl:fl1', headingFlourish: 'fl1' },
  assets,
});
const fontAsset = { kind: 'font', sha256: sha(FONT), mediaType: 'font/ttf', id: 'f1', name: 'Harbour Serif.ttf', family: 'Harbour Serif', ext: 'ttf' };
const flourishAsset = { kind: 'flourish', sha256: sha(FLOURISH), mediaType: 'image/svg+xml', id: 'fl1', name: 'wave.svg', ext: 'svg' };

async function upload(c: Client, data: string, mediaType: string): Promise<number> {
  return (await c.put(`/api/pictures/${sha(data)}`, { mediaType, data })).status;
}

before(async () => {
  db = await createTestDb();
  server = await startTestServer(db, undefined, { pictureGcGraceSeconds: 0 });
  alice = new Client(server.base);
  bob = new Client(server.base);
  await registerUser(alice, 'alice@example.com');
  await registerUser(bob, 'bob@example.com');
});

after(async () => {
  await server.close();
});

test('create, read with an ETag, list, update with the revision, delete', async () => {
  const created = await alice.put('/api/themes/t1', { name: 'Harbour Lights', doc: theme('t1', 'Harbour Lights') });
  assert.equal(created.status, 201);
  const t = created.body.theme as { key: string; name: string; revision: number; doc: { id: string } };
  assert.equal(t.key, 't1');
  assert.equal(t.name, 'Harbour Lights');
  assert.equal(t.revision, 1);
  assert.equal(t.doc.id, 't1');
  assert.equal(created.headers.get('etag'), '"1"');

  const got = await alice.get('/api/themes/t1');
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('etag'), '"1"');
  assert.deepEqual((got.body.theme as { doc: unknown }).doc, theme('t1', 'Harbour Lights'));

  const list = await alice.get('/api/themes');
  assert.equal(list.status, 200);
  const rows = list.body.themes as { key: string; name: string; revision: number; updated_at: string; doc?: unknown }[];
  assert.deepEqual(rows.map((r) => [r.key, r.name, r.revision]), [['t1', 'Harbour Lights', 1]]);
  assert.ok(rows[0]!.updated_at);
  assert.equal(rows[0]!.doc, undefined, 'the list carries no docs');

  const upd = await alice.put('/api/themes/t1', { name: 'Harbour Lights II', doc: theme('t1', 'Harbour Lights II'), revision: 1 });
  assert.equal(upd.status, 200);
  assert.equal((upd.body.theme as { revision: number }).revision, 2);
  const viaHeader = await alice.put('/api/themes/t1', { name: 'Harbour Lights III', doc: theme('t1', 'Harbour Lights III') }, { 'if-match': '"2"' });
  assert.equal(viaHeader.status, 200);
  assert.equal(viaHeader.headers.get('etag'), '"3"');

  // a delete names the revision it saw: a stale one keeps the row (409 with the current copy)
  const staleDel = await alice.request('DELETE', '/api/themes/t1', undefined, { 'if-match': '"2"' });
  assert.equal(staleDel.status, 409);
  assert.equal((staleDel.body.theme as { revision: number }).revision, 3);
  assert.equal((await alice.get('/api/themes/t1')).status, 200);
  assert.equal((await alice.request('DELETE', '/api/themes/t1', undefined, { 'if-match': '"3"' })).status, 204);
  assert.equal((await alice.get('/api/themes/t1')).status, 404);
  assert.equal((await alice.delete('/api/themes/t1')).status, 404);
});

test('a stale write gets 409 with the current copy; no base on an existing row 428; a base on a missing row 404', async () => {
  await alice.put('/api/themes/stale1', { name: 'Stale', doc: theme('stale1', 'Stale') });
  assert.equal((await alice.put('/api/themes/stale1', { name: 'Stale', doc: theme('stale1', 'v2'), revision: 1 })).status, 200);
  const stale = await alice.put('/api/themes/stale1', { name: 'Stale', doc: theme('stale1', 'mine'), revision: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'BEUK-C803');
  assert.equal((stale.body.theme as { revision: number }).revision, 2);
  assert.equal(((stale.body.theme as { doc: { name: string } }).doc).name, 'v2');
  assert.equal(stale.headers.get('etag'), '"2"');
  const noBase = await alice.put('/api/themes/stale1', { name: 'Stale', doc: theme('stale1', 'blind') });
  assert.equal(noBase.status, 428);
  assert.equal(((noBase.body.theme as { doc: { name: string } }).doc).name, 'v2');
  assert.equal((await alice.put('/api/themes/never', { name: 'Never', doc: theme('never', 'Never'), revision: 4 })).status, 404);
  assert.equal((await alice.put('/api/themes/stale1', { name: 'Stale', doc: theme('stale1', 'x'), revision: 'x' })).status, 400);
});

test("owner isolation: bob can't list, read, write or delete alice's themes, nor learn their keys (404 like a missing row)", async () => {
  assert.equal(await upload(alice, FONT, 'font/ttf'), 201);
  const put = await alice.put('/api/themes/secret1', { name: 'Private Harbour', doc: theme('secret1', 'Private Harbour', [fontAsset]) });
  assert.equal(put.status, 201);
  const list = await bob.get('/api/themes');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.themes, []);
  const read = await bob.get('/api/themes/secret1');
  const missing = await bob.get('/api/themes/no-such-key');
  assert.equal(read.status, 404);
  assert.deepEqual(read.body, missing.body, 'the same answer as a key nobody has');
  const write = await bob.put('/api/themes/secret1', { name: 'x', doc: theme('secret1', 'x'), revision: 1 });
  assert.equal(write.status, 404);
  assert.equal(write.body.theme, undefined, 'no copy of alice\'s row');
  const blind = await bob.put('/api/themes/secret1', { name: 'x', doc: theme('secret1', 'x') }, { 'if-match': '*' });
  assert.equal(blind.status, 404);
  assert.equal((await bob.delete('/api/themes/secret1')).status, 404);
  assert.equal((await bob.request('DELETE', '/api/themes/secret1', undefined, { 'if-match': '*' })).status, 404);
  // bob's own theme under the same key is his own row; alice's is untouched
  const own = await bob.put('/api/themes/secret1', { name: 'Bob', doc: theme('secret1', 'Bob') });
  assert.equal(own.status, 201);
  const hers = await alice.get('/api/themes/secret1');
  assert.equal((hers.body.theme as { name: string; revision: number }).name, 'Private Harbour');
  assert.equal((hers.body.theme as { revision: number }).revision, 1);
  // the picture store's isolation covers the assets: bob can't read alice's font, nor name it in a theme of his
  assert.equal((await bob.get(`/api/pictures/${sha(FONT)}`)).status, 404);
  const borrowed = await bob.put('/api/themes/borrow', { name: 'Borrowed', doc: theme('borrow', 'Borrowed', [fontAsset]) });
  assert.equal(borrowed.status, 422);
  assert.deepEqual(borrowed.body.missingPictures, [sha(FONT)]);
  assert.equal((await bob.get('/api/themes/borrow')).status, 404);
  await bob.delete('/api/themes/secret1');
});

test('the carried assets: every hash must be held first (422 naming the missing ones), then the theme saves', async () => {
  const doc = theme('carry1', 'Carried', [fontAsset, flourishAsset]);
  const refused = await alice.put('/api/themes/carry1', { name: 'Carried', doc });
  assert.equal(refused.status, 422);
  assert.deepEqual(refused.body.missingPictures, [sha(FLOURISH)], 'only the flourish is missing (the font was uploaded above)');
  assert.equal((await alice.get('/api/themes/carry1')).status, 404, 'nothing written');
  assert.equal(await upload(alice, FLOURISH, 'image/svg+xml'), 201);
  const ok = await alice.put('/api/themes/carry1', { name: 'Carried', doc });
  assert.equal(ok.status, 201);
  assert.deepEqual((ok.body.theme as { doc: unknown }).doc, doc);
});

test("a picture a theme names is never collected; it goes once no theme or book names it", async () => {
  const uid = (await db.query<{ id: string }>("select id from users where email = 'alice@example.com'")).rows[0]!.id;
  await collectUnusedPictures(db, uid, 0);
  const held = async (h: string) => (await db.query('select 1 from pictures where user_id = $1 and sha256 = $2', [uid, h])).rows.length === 1;
  assert.ok(await held(sha(FONT)), 'named by secret1 and carry1');
  assert.ok(await held(sha(FLOURISH)), 'named by carry1');
  // a write that drops the flourish, then the delete of the other theme naming the font
  const cur = (await alice.get('/api/themes/carry1')).body.theme as { revision: number };
  assert.equal((await alice.put('/api/themes/carry1', { name: 'Carried', doc: theme('carry1', 'Carried', [fontAsset]), revision: cur.revision })).status, 200);
  assert.ok(!(await held(sha(FLOURISH))), 'the flourish no theme names any more is collected after the write');
  assert.equal((await alice.delete('/api/themes/secret1')).status, 204);
  assert.ok(await held(sha(FONT)), 'carry1 still names the font');
  assert.equal((await alice.delete('/api/themes/carry1')).status, 204);
  assert.ok(!(await held(sha(FONT))), 'collected once nothing names it');
});

test('input validation: key, name, doc, assets, sizes', async () => {
  const bad = async (path: string, body: unknown, status: number, what: string) => {
    const r = await alice.put(path, body);
    assert.equal(r.status, status, `${what}: ${JSON.stringify(r.body)}`);
    assert.equal((await alice.get(path)).status, 404, `${what}: nothing written`);
  };
  await bad('/api/themes/has%20space', { name: 'x', doc: theme('has space', 'x') }, 400, 'a key with a space');
  await bad('/api/themes/' + 'k'.repeat(65), { name: 'x', doc: theme('k'.repeat(65), 'x') }, 400, 'a key of 65 characters');
  await bad('/api/themes/%3Cb%3E', { name: 'x', doc: theme('<b>', 'x') }, 400, 'markup in the key');
  await bad('/api/themes/v1', { name: 'x', doc: theme('other', 'x') }, 400, "the path key is not the doc's id");
  await bad('/api/themes/v1', { name: '   ', doc: theme('v1', 'x') }, 400, 'a blank name');
  await bad('/api/themes/v1', { name: 'x'.repeat(121), doc: theme('v1', 'x') }, 400, 'a name of 121 characters');
  await bad('/api/themes/v1', { name: 'x', doc: [] }, 400, 'an array doc');
  await bad('/api/themes/v1', { name: 'x' }, 400, 'no doc');
  await bad('/api/themes/v1', { name: 'x', doc: { id: 'v1', name: 'x', theme: 'serif' } }, 400, 'a theme that is not an object');
  await bad('/api/themes/v1', { name: 'x', doc: theme('v1', 'x', [{ ...fontAsset, kind: 'cover' }]) }, 400, 'an asset kind 1.0 has no theme use for');
  await bad('/api/themes/v1', { name: 'x', doc: theme('v1', 'x', [{ ...fontAsset, sha256: 'abc' }]) }, 400, 'a hash that is not sha256 hex');
  await bad('/api/themes/v1', { name: 'x', doc: theme('v1', 'x', [{ ...fontAsset, mediaType: 'text/html' }]) }, 400, 'a font as HTML');
  await bad('/api/themes/v1', { name: 'x', doc: theme('v1', 'x', [{ ...fontAsset, mediaType: 'font/woff2' }]) }, 400, 'a font type 1.0 does not upload');
  await bad('/api/themes/v1', { name: 'x', doc: theme('v1', 'x', [{ ...flourishAsset, mediaType: 'image/jpeg' }]) }, 400, 'a flourish type 1.0 does not upload');
  await bad('/api/themes/v1', { name: 'x', doc: theme('v1', 'x', [{ ...fontAsset, family: 7 }]) }, 400, 'an asset field that is not a string');
  await bad('/api/themes/v1', { name: 'x', doc: theme('v1', 'x', [{ ...fontAsset, name: 'n'.repeat(201) }]) }, 400, 'an asset field of 201 characters');
  await bad('/api/themes/v1', { name: 'x', doc: theme('v1', 'x', Array.from({ length: 33 }, () => fontAsset)) }, 400, 'more than 32 assets');
  await bad('/api/themes/v1', { name: 'x', doc: theme('v1', 'x', [{ ...fontAsset, data: FONT }]) }, 400, 'asset bytes inside the row');
  const big = { ...theme('v1', 'x'), filler: 'f'.repeat(64 * 1024) };
  await bad('/api/themes/v1', { name: 'x', doc: big }, 413, 'a doc over 64 KB');
  // the largest doc allowed saves
  const room = 64 * 1024 - Buffer.byteLength(JSON.stringify({ ...theme('v1', 'x'), filler: '' }));
  assert.equal((await alice.put('/api/themes/v1', { name: 'x', doc: { ...theme('v1', 'x'), filler: 'f'.repeat(room) } })).status, 201);
  assert.equal((await alice.delete('/api/themes/v1')).status, 204);
});

test('at most 200 themes per account (413 with the limit); an update of an existing one still saves', async () => {
  const uid = (await db.query<{ id: string }>("select id from users where email = 'bob@example.com'")).rows[0]!.id;
  for (let i = 0; i < 200; i++)
    await db.query('insert into user_themes (user_id, theme_key, name, doc) values ($1, $2, $3, $4)', [uid, 'cap' + i, 'Cap ' + i, JSON.stringify(theme('cap' + i, 'Cap ' + i))]);
  const full = await bob.put('/api/themes/cap200', { name: 'One Too Many', doc: theme('cap200', 'One Too Many') });
  assert.equal(full.status, 413);
  assert.equal(full.body.limitThemes, 200);
  assert.equal((await bob.get('/api/themes/cap200')).status, 404);
  assert.equal((await bob.put('/api/themes/cap7', { name: 'Seven', doc: theme('cap7', 'Seven'), revision: 1 })).status, 200);
  await db.query('delete from user_themes where user_id = $1', [uid]);
});

test('signed out gets 401', async () => {
  const anon = new Client(server.base);
  assert.equal((await anon.get('/api/themes')).status, 401);
  assert.equal((await anon.get('/api/themes/x')).status, 401);
  assert.equal((await anon.put('/api/themes/x', { name: 'x', doc: theme('x', 'x') })).status, 401);
  assert.equal((await anon.delete('/api/themes/x')).status, 401);
});

test("Download all my data carries themes.json and each asset's bytes once as a file of its own, and the README's line; another account's themes never", async () => {
  const c = new Client(server.base);
  await registerUser(c, 'themes-zip@example.com');
  assert.equal(await upload(c, FONT, 'font/ttf'), 201);
  assert.equal((await c.put('/api/themes/z1', { name: 'Zip Theme', doc: theme('z1', 'Zip Theme', [fontAsset]) })).status, 201);
  assert.equal((await c.put('/api/themes/z2', { name: 'Zip Two', doc: theme('z2', 'Zip Two', [fontAsset]) })).status, 201);
  assert.equal((await alice.put('/api/themes/not-yours', { name: 'Not Yours Theme', doc: theme('not-yours', 'Not Yours Theme') })).status, 201);
  const res = await c.download('/api/account/export');
  assert.equal(res.status, 200);
  const entries = readZip(res.bytes);
  const get = (n: string) => entries.find((e) => e.name === n)?.data.toString('utf8');
  const file = JSON.parse(get('themes.json') ?? 'null') as {
    themes: { key: string; name: string; revision: number; createdAt: string; updatedAt: string; doc: { assets: { data?: string }[] } }[];
    assets: { sha256: string; mediaType: string; file: string }[];
  };
  assert.deepEqual(file.themes.map((x) => x.key), ['z1', 'z2']);
  assert.equal(file.themes[0]!.name, 'Zip Theme');
  assert.ok(file.themes[0]!.createdAt && file.themes[0]!.updatedAt);
  assert.equal(file.themes[0]!.doc.assets[0]!.data, undefined, 'the doc as stored: the bytes are not copied into each theme');
  // review (Important 3): each asset once, as a file of its own, however many themes name it
  assert.deepEqual(file.assets, [{ sha256: sha(FONT), mediaType: 'font/ttf', file: `themes/assets/${sha(FONT)}.ttf` }]);
  const bytesEntry = entries.find((e) => e.name === `themes/assets/${sha(FONT)}.ttf`);
  assert.ok(bytesEntry && bytesEntry.data.equals(Buffer.from(FONT, 'base64')), 'the font itself, byte for byte');
  assert.equal(entries.filter((e) => e.name.startsWith('themes/assets/')).length, 1);
  assert.match(get('README.txt') ?? '', /themes\.json\s+Your own themes \(My themes\) \(2\)/);
  assert.equal(JSON.parse(get('account.json') ?? '{}').counts.user_themes, 2);
  assert.ok(!entries.some((e) => e.data.toString('utf8').includes('Not Yours Theme')));
  await alice.delete('/api/themes/not-yours');
});

test('Delete my account removes its themes (counted) and their pictures; the table is owned, backed up and restorable', async () => {
  const c = new Client(server.base);
  await registerUser(c, 'themes-leaving@example.com');
  const uid = (await db.query<{ id: string }>("select id from users where email = 'themes-leaving@example.com'")).rows[0]!.id;
  assert.equal(await upload(c, FONT, 'font/ttf'), 201);
  assert.equal((await c.put('/api/themes/d1', { name: 'Leaving', doc: theme('d1', 'Leaving', [fontAsset]) })).status, 201);
  const del = await c.post('/api/account/delete', { currentPassword: 'correct horse battery', confirmPhrase: 'delete my account' });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((del.body.removed as Record<string, number>).user_themes, 1);
  assert.equal((await db.query('select 1 from user_themes where user_id = $1', [uid])).rows.length, 0);
  assert.equal((await db.query('select 1 from user_theme_pictures where user_id = $1', [uid])).rows.length, 0);
  assert.equal((await db.query('select 1 from pictures where user_id = $1', [uid])).rows.length, 0);
  assert.ok((ACCOUNT_DELETED_TABLES as readonly string[]).includes('user_themes'));
  const order = BACKUP_TABLES as readonly string[];
  assert.ok(order.includes('user_themes') && order.includes('user_theme_pictures'));
  assert.ok(order.indexOf('user_themes') < order.indexOf('user_theme_pictures'), 'parents before children');
  assert.ok(order.indexOf('pictures') < order.indexOf('user_theme_pictures'), 'parents before children');
});
