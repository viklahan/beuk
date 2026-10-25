import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import type { Db } from '../src/db.js';
import { setAdmin } from '../src/housekeeping/admin.js';
import {
  BACKUP_TABLES,
  classifyTables,
  createBackup,
  EXCLUDED_TABLES,
  executeRestore,
  previewRestore,
  RestoreRefused,
} from '../src/housekeeping/backup.js';
import {
  Client,
  createTestDb,
  registerUser,
  startTestServer,
  testConfig,
} from './helpers.js';

/**
 * Restore must bring back EVERY data table, not just manuscripts.
 * Before the Phase 0 fix, BACKUP_TABLES lacked jobs / shares /
 * share_comments / share_readers, and `delete from users` cascaded
 * into all four — a restore silently deleted every share link, reader
 * comment, reader record and job, and the pre-restore snapshot (same
 * table list) could not bring them back either.
 */

const ADMIN = 'admin@example.com';

async function userId(db: Db, email: string): Promise<string> {
  const r = await db.query<{ id: string }>('select id from users where email = $1', [email]);
  return r.rows[0].id;
}

async function count(db: Db, table: string): Promise<number> {
  const r = await db.query<{ n: string }>(`select count(*)::text as n from ${table}`);
  return Number(r.rows[0].n);
}

/** One share with 2 comments + 1 reader, and 1 job whose jsonb result
 *  is a top-level ARRAY (the plan's jsonb LEAD). */
async function seedShareAndJob(db: Db, ownerId: string): Promise<string> {
  const share = await db.query<{ id: string }>(
    `insert into shares (owner_id, token_hash, title, snapshot, images)
     values ($1, 'tokenhash-1', 'Shared Book', $2::jsonb, $3::jsonb) returning id`,
    [ownerId, JSON.stringify({ sections: [{ id: 's1', html: '<p>Hi</p>' }] }), JSON.stringify({})],
  );
  const shareId = share.rows[0].id;
  for (const body of ['Loved chapter one', 'Typo in line 3']) {
    await db.query(
      `insert into share_comments (share_id, section_id, paragraph_index, body, reader_name, ip_hash)
       values ($1, 's1', 0, $2, 'Reader R', 'iphash')`,
      [shareId, body],
    );
  }
  await db.query(`insert into share_readers (share_id, visitor_hash) values ($1, 'visitor-1')`, [shareId]);
  await db.query(
    `insert into jobs (user_id, kind, status, result) values ($1, 'epubcheck', 'done', '[1,2]'::jsonb)`,
    [ownerId],
  );
  return shareId;
}

test('restore brings back shares, comments, readers and jobs; the pre-restore snapshot holds them too', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, { restoreEnabled: true });
  try {
    const admin = new Client(server.base);
    await registerUser(admin, ADMIN);
    assert.equal(await setAdmin(db, ADMIN, true), 'granted');
    const owner = await userId(db, ADMIN);
    const shareId = await seedShareAndJob(db, owner);

    const backup = await admin.post('/api/housekeeping/backups', { name: 'with-shares' });
    assert.equal(backup.status, 201);

    // Mutate after the backup: one comment deleted, the share revoked,
    // a second job queued.
    await db.query(`delete from share_comments where body = 'Typo in line 3'`);
    await db.query(`update shares set revoked_at = now() where id = $1`, [shareId]);
    await db.query(`insert into jobs (user_id, kind, status) values ($1, 'pdfx', 'queued')`, [owner]);

    const preview = await admin.post('/api/housekeeping/restore/preview', { name: 'with-shares' });
    assert.equal(preview.status, 200);
    const restored = await admin.post('/api/housekeeping/restore', {
      name: 'with-shares',
      previewId: preview.body.previewId,
      confirmed: true,
    });
    assert.equal(restored.status, 200, JSON.stringify(restored.body));

    // Everything came back exactly as it was at backup time.
    assert.equal(await count(db, 'shares'), 1, 'share restored');
    assert.equal(await count(db, 'share_comments'), 2, 'both comments restored');
    assert.equal(await count(db, 'share_readers'), 1, 'reader restored');
    assert.equal(await count(db, 'jobs'), 1, 'job restored (the post-backup job is gone)');
    const share = await db.query<{ revoked_at: unknown; title: string }>(
      'select revoked_at, title from shares where id = $1',
      [shareId],
    );
    assert.equal(share.rows[0].title, 'Shared Book');
    assert.equal(share.rows[0].revoked_at, null, 'revocation rolled back with the restore');
    const job = await db.query<{ result: unknown }>('select result from jobs');
    assert.deepEqual(job.rows[0].result, [1, 2], 'jsonb array result round-tripped');

    // The pre-restore snapshot captured the mutated state, shares included.
    const snapshotName = (restored.body.restored as { snapshot: string }).snapshot;
    const snap = JSON.parse(
      await readFile(path.join(server.config.backupDir, snapshotName, 'db.json'), 'utf8'),
    ) as { tables: Record<string, unknown[]> };
    assert.equal(snap.tables.shares?.length, 1, 'snapshot holds the share');
    assert.equal(snap.tables.share_comments?.length, 1, 'snapshot holds the remaining comment');
    assert.equal(snap.tables.share_readers?.length, 1, 'snapshot holds the reader');
    assert.equal(snap.tables.jobs?.length, 2, 'snapshot holds both jobs');
  } finally {
    await server.close();
  }
});

test('jsonb LEAD: a jobs.result of [1,2] survives backup -> restore unchanged', async () => {
  const db = await createTestDb();
  const config = testConfig();
  await db.query(`insert into users (email, password_hash) values ('j@example.com', 'x')`);
  const owner = await userId(db, 'j@example.com');
  await db.query(
    `insert into jobs (user_id, kind, status, result) values ($1, 'epubcheck', 'done', '[1,2]'::jsonb)`,
    [owner],
  );
  await createBackup(db, config, { name: 'jsonb-lead', createdBy: 'test', secrets: [] });
  await db.query('update jobs set result = null');
  await executeRestore(db, config, { name: 'jsonb-lead', createdBy: 'test', secrets: [] });
  const r = await db.query<{ result: unknown; t: string }>(
    'select result, jsonb_typeof(result) as t from jobs',
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].t, 'array');
  assert.deepEqual(r.rows[0].result, [1, 2]);
});

/** A Db that serialises parameters exactly the way node-pg does
 *  for arrays (pg/lib/utils prepareValue: a JS array becomes a Postgres
 *  ARRAY literal) before handing them to PGlite. PGlite on its own encodes by
 *  the server-described type and so masks the production failure. */
function nodePgSerialising(inner: Db): Db {
  const prepare = createRequire(import.meta.url)('pg/lib/utils').prepareValue as (v: unknown) => unknown;
  const wrap = (d: Db): Db => ({
    // Only arrays are rewritten (the behaviour under test); scalars keep
    // their JS type because PGlite's own serialisers are strict about it.
    query: (text, params) => d.query(text, params?.map((p) => (Array.isArray(p) ? prepare(p) : p))),
    tx: (fn) => d.tx((t) => fn(wrap(t))),
  });
  return wrap(inner);
}

test('jsonb LEAD under node-pg parameter encoding: [1,2] round-trips (failed before the explicit ::jsonb fix)', async () => {
  const db = nodePgSerialising(await createTestDb());
  const config = testConfig();
  await db.query(`insert into users (email, password_hash) values ('k@example.com', 'x')`);
  const owner = await userId(db, 'k@example.com');
  await db.query(
    `insert into jobs (user_id, kind, status, result) values ($1, 'epubcheck', 'done', '[1,2]'::jsonb)`,
    [owner],
  );
  await db.query(
    `insert into shares (owner_id, token_hash, title, snapshot, images)
     values ($1, 'th', 'T', '[{"a":1}]'::jsonb, '{"img":[1]}'::jsonb)`,
    [owner],
  );
  await createBackup(db, config, { name: 'jsonb-nodepg', createdBy: 'test', secrets: [] });
  await executeRestore(db, config, { name: 'jsonb-nodepg', createdBy: 'test', secrets: [] });
  const job = await db.query<{ result: unknown }>('select result from jobs');
  assert.deepEqual(job.rows[0].result, [1, 2]);
  const share = await db.query<{ snapshot: unknown; images: unknown }>('select snapshot, images from shares');
  assert.deepEqual(share.rows[0].snapshot, [{ a: 1 }]);
  assert.deepEqual(share.rows[0].images, { img: [1] });
});

test('completeness guard: every public table is in exactly one of BACKUP_TABLES / EXCLUDED_TABLES', async () => {
  const db = await createTestDb();
  const c = await classifyTables(db);
  assert.deepEqual(c.unclassified, [], `unclassified tables: ${c.unclassified.join(', ')}`);
  assert.deepEqual(c.both, [], `tables in both lists: ${c.both.join(', ')}`);
  assert.deepEqual(c.missing, [], `listed tables the schema lacks: ${c.missing.join(', ')}`);
  assert.ok(c.total >= 17);
  assert.ok('password_resets' in EXCLUDED_TABLES, 'password_resets is excluded on purpose');

  // The guard bites: a new, unclassified table is reported.
  await db.query('create table future_feature (id int primary key)');
  const after = await classifyTables(db);
  assert.deepEqual(after.unclassified, ['future_feature']);
});

test('the dump runs in one repeatable-read read-only transaction; the manifest says so and lists password_resets with its reason', async () => {
  const db = await createTestDb();
  const config = testConfig();
  const manifest = await createBackup(db, config, { name: 'consistency', createdBy: 'test', secrets: [] });
  assert.deepEqual(manifest.consistency, { isolation: 'repeatable read', readOnly: true });
  assert.ok(manifest.excluded.some((line) => line.startsWith('password_resets (') && /reset/.test(line)));
  for (const table of BACKUP_TABLES) assert.equal(typeof manifest.tables[table], 'number', table);
});

test('restore deletes every password-reset token; a backup that predates the shares/jobs tables is refused by name', async () => {
  const db = await createTestDb();
  const config = testConfig();
  await db.query(`insert into users (email, password_hash) values ('p@example.com', 'x')`);
  const owner = await userId(db, 'p@example.com');
  await createBackup(db, config, { name: 'resets', createdBy: 'test', secrets: [] });
  await db.query(
    `insert into password_resets (user_id, token_hash, expires_at) values ($1, 'h', now() + interval '1 hour')`,
    [owner],
  );
  await executeRestore(db, config, { name: 'resets', createdBy: 'test', secrets: [] });
  assert.equal(await count(db, 'password_resets'), 0);

  // An old-format backup (no shares/jobs keys in db.json) is refused.
  await seedShareAndJob(db, owner);
  await createBackup(db, config, { name: 'old-format', createdBy: 'test', secrets: [] });
  const dbJsonPath = path.join(config.backupDir, 'old-format', 'db.json');
  const doc = JSON.parse(await readFile(dbJsonPath, 'utf8')) as { tables: Record<string, unknown> };
  for (const t of ['jobs', 'shares', 'share_comments', 'share_readers']) delete doc.tables[t];
  await writeFile(dbJsonPath, JSON.stringify(doc));
  const preview = await previewRestore(db, config, 'old-format');
  assert.deepEqual(preview?.missingTables, ['jobs', 'shares', 'share_comments', 'share_readers']);
  await assert.rejects(
    executeRestore(db, config, { name: 'old-format', createdBy: 'test', secrets: [] }),
    (err: unknown) => err instanceof RestoreRefused && /jobs, shares, share_comments, share_readers/.test(err.message),
  );
  assert.equal(await count(db, 'shares'), 1, 'nothing was touched');
  assert.equal(await count(db, 'share_comments'), 2);
});

// The export directory is a volume mount point in Compose, so restore
// must empty it rather than rmdir it (EBUSY). That failure only
// reproduces on a real mount: it was seen, and its fix proven, in the
// full-stack run (README "Off-site backups"). An inode check cannot
// stand in for it here: ext4 hands the recreated directory the same
// inode number, so it passed on the old rm+mkdir code too. This test
// pins the contents contract only.
test('restore replaces the export directory contents with the backup copy', async () => {
  const db = await createTestDb();
  const config = testConfig();
  await mkdir(path.join(config.exportDir, 'u1'), { recursive: true });
  await writeFile(path.join(config.exportDir, 'u1', 'kept-in-backup'), 'backed up bytes');
  await createBackup(db, config, { name: 'files', createdBy: 'test', secrets: [] });
  await writeFile(path.join(config.exportDir, 'u1', 'added-later'), 'post-backup bytes');
  await executeRestore(db, config, { name: 'files', createdBy: 'test', secrets: [] });
  assert.deepEqual((await readdir(path.join(config.exportDir, 'u1'))).sort(), ['kept-in-backup']);
  assert.equal(await readFile(path.join(config.exportDir, 'u1', 'kept-in-backup'), 'utf8'), 'backed up bytes');
});
