import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { BACKUP_TABLES, classifyTables } from '../src/housekeeping/backup.js';
import { approveAndPublish, createDraft, DraftConflict, DraftInvalid, DraftStateError, listDrafts, mondayOf, replaceDraft, sendBack, validateUpload, withdraw, type DraftUpload } from '../src/weekly/drafts.js';
import { createTestDb } from './helpers.js';

/* The Beuk Weekly press (spec 2026-10-29): a drafter on the Legion uploads
 * a draft, the server emails the editor a preview, and only an admin's
 * Approve publishes. */

const base = { DATABASE_URL: 'postgres://x' } as NodeJS.ProcessEnv;

test('press config: WEEKLY_DIR defaults to /data/weekly; a short token counts as none; the editor falls back to ALERT_EMAIL', () => {
  const c = loadConfig({ ...base });
  assert.equal(c.weeklyDir, '/data/weekly');
  assert.equal(c.weeklyDraftToken, null);
  assert.equal(c.weeklyEditorEmail, null);
  assert.equal(loadConfig({ ...base, WEEKLY_DRAFT_TOKEN: 'short' }).weeklyDraftToken, null, 'under 32 chars is no token');
  const t = 'x'.repeat(32);
  assert.equal(loadConfig({ ...base, WEEKLY_DRAFT_TOKEN: t }).weeklyDraftToken, t);
  assert.equal(loadConfig({ ...base, ALERT_EMAIL: 'ops@example.com' }).weeklyEditorEmail, 'ops@example.com');
  assert.equal(loadConfig({ ...base, ALERT_EMAIL: 'ops@example.com', WEEKLY_EDITOR_EMAIL: 'ed@example.com' }).weeklyEditorEmail, 'ed@example.com');
  assert.equal(loadConfig({ ...base, WEEKLY_DIR: '/srv/w' }).weeklyDir, '/srv/w');
});

test('press table: one open draft at a time, issue numbers unique, backed up', async () => {
  const db = await createTestDb();
  await db.query(`insert into weekly_drafts (status, source_commit) values ('drafted', 'abc')`);
  await assert.rejects(db.query(`insert into weekly_drafts (status, source_commit) values ('sent_back', 'abc')`), /unique|duplicate/i);
  await db.query(`insert into weekly_drafts (status, source_commit, issue_number) values ('published', 'abc', 2)`);
  await assert.rejects(db.query(`insert into weekly_drafts (status, source_commit, issue_number) values ('published', 'abc', 2)`), /unique|duplicate/i);
  await assert.rejects(db.query(`insert into weekly_drafts (status, source_commit) values ('live', 'abc')`), /check/i);
  assert.ok((BACKUP_TABLES as readonly string[]).includes('weekly_drafts'));
  assert.deepEqual((await classifyTables(db)).unclassified, []);
});

/* Task 3: the draft store and its state machine. */

const ISSUE1 = path.join(path.resolve(import.meta.dirname, '..'), 'content', 'weekly', 'en', '001');

/** A draft upload built from issue No. 1's folder, optionally edited. */
export function issueUpload(edit?: (files: Record<string, string>) => void): DraftUpload {
  const files: Record<string, string> = {};
  for (const f of readdirSync(ISSUE1)) files[f] = readFileSync(path.join(ISSUE1, f)).toString('base64');
  files['sources.json'] = Buffer.from('[]').toString('base64');
  edit?.(files);
  return { sourceCommit: 'a'.repeat(40), files, dropped: [{ title: 'A rumour', why: 'could not confirm' }], outlets: ['example.org'] };
}
const b64 = (s: string) => Buffer.from(s).toString('base64');
const OUTSIDE = '---\ntitle: KDP Changes A Rule\nsection: Stores\nplace: brief\nsources: [https://kdp.example/news]\n---\nA paragraph.\n';

async function pressSetup() {
  const db = await createTestDb();
  const dir = mkdtempSync(path.join(tmpdir(), 'press-'));
  const user = (await db.query<{ id: string }>(`insert into users (email, password_hash) values ('ed@example.com', 'x') returning id`)).rows[0].id;
  return { db, dir, user };
}

test('press store: refuses path escape', () => {
  const u = issueUpload((f) => {
    f['../x.md'] = b64('x');
  });
  const problems = validateUpload(u);
  assert.ok(problems.some((p) => p.includes('../x.md')), problems.join('; '));
  assert.ok(validateUpload(issueUpload((f) => (f['C:\\x.md'] = b64('x')))).length > 0);
  assert.ok(validateUpload(issueUpload((f) => (f['run.exe'] = b64('x')))).length > 0);
  assert.deepEqual(validateUpload(issueUpload()), [], 'issue No. 1 as it stands is a clean upload');
});

test('press store: refuses an outside story without a fetched quote', () => {
  const missing = validateUpload(issueUpload((f) => (f['kdp-rule.md'] = b64(OUTSIDE))));
  assert.ok(missing.some((p) => p.includes('kdp-rule') && p.includes('https://kdp.example/news')), missing.join('; '));
  const empty = validateUpload(
    issueUpload((f) => {
      f['kdp-rule.md'] = b64(OUTSIDE);
      f['sources.json'] = b64(JSON.stringify([{ url: 'https://kdp.example/news', fetchedAt: '2026-11-05T07:00:00Z', quote: '  ', story: 'kdp-rule' }]));
    }),
  );
  assert.ok(empty.some((p) => p.includes('quote')), empty.join('; '));
  const ok = validateUpload(
    issueUpload((f) => {
      f['kdp-rule.md'] = b64(OUTSIDE);
      f['sources.json'] = b64(JSON.stringify([{ url: 'https://kdp.example/news', fetchedAt: '2026-11-05T07:00:00Z', quote: 'The rule changes on 1 December.', story: 'kdp-rule' }]));
    }),
  );
  assert.deepEqual(ok, []);
  assert.ok(validateUpload(issueUpload((f) => delete f['issue.md'])).some((p) => p.includes('issue.md')));
  assert.ok(validateUpload(issueUpload((f) => delete f['sources.json'])).some((p) => p.includes('sources.json')));
});

test('press store: one draft at a time', async () => {
  const { db, dir } = await pressSetup();
  const { id } = await createDraft(db, dir, issueUpload());
  assert.ok(existsSync(path.join(dir, 'drafts', id, 'issue.md')));
  await assert.rejects(createDraft(db, dir, issueUpload()), (e: unknown) => e instanceof DraftConflict && e.id === id);
  await assert.rejects(createDraft(db, dir, issueUpload((f) => delete f['issue.md'])), (e: unknown) => e instanceof DraftInvalid);
});

test('press store: approve publishes as number 2 dated the publish Monday', async () => {
  const { db, dir, user } = await pressSetup();
  const { id } = await createDraft(db, dir, issueUpload());
  const r = await approveAndPublish(db, dir, id, user, new Date('2026-11-05T12:00:00Z'));
  assert.deepEqual(r, { number: 2, week: '2026-11-02' });
  assert.match(readFileSync(path.join(dir, 'published', '002', 'issue.md'), 'utf8'), /^week: 2026-11-02$/m);
  assert.ok(!existsSync(path.join(dir, 'drafts', id)));
  const [row] = await listDrafts(db);
  assert.equal(row.status, 'published');
  assert.equal(row.issueNumber, 2);
  assert.equal(row.approvedBy, user);
  // A Monday publish is dated that Monday; a Sunday publish the Monday before.
  assert.equal(mondayOf(new Date('2026-11-09T00:30:00Z')), '2026-11-09');
  assert.equal(mondayOf(new Date('2026-11-08T23:59:00Z')), '2026-11-02');
});

test('press store: approve is idempotent', async () => {
  const { db, dir, user } = await pressSetup();
  const { id } = await createDraft(db, dir, issueUpload());
  const now = new Date('2026-11-05T12:00:00Z');
  const [a, b] = await Promise.allSettled([approveAndPublish(db, dir, id, user, now), approveAndPublish(db, dir, id, user, now)]);
  assert.equal([a, b].filter((x) => x.status === 'fulfilled').length, 1, 'exactly one approve publishes');
  const loser = [a, b].find((x) => x.status === 'rejected') as PromiseRejectedResult;
  assert.ok(loser.reason instanceof DraftStateError, String(loser.reason));
  await assert.rejects(approveAndPublish(db, dir, id, user, now), DraftStateError);
  assert.deepEqual(readdirSync(path.join(dir, 'published')), ['002']);
});

test('press store: publish refuses a number git already has', async () => {
  const { db, dir, user } = await pressSetup();
  const git = mkdtempSync(path.join(tmpdir(), 'press-git-'));
  mkdirSync(path.join(git, '001'));
  mkdirSync(path.join(git, '002'));
  const { id } = await createDraft(db, dir, issueUpload());
  const r = await approveAndPublish(db, dir, id, user, new Date('2026-11-05T12:00:00Z'), { gitRoot: git });
  assert.equal(r.number, 3);
  assert.ok(existsSync(path.join(dir, 'published', '003', 'issue.md')));
});

test('press store: send back records notes, then replaceDraft returns it to drafted', async () => {
  const { db, dir, user } = await pressSetup();
  const { id } = await createDraft(db, dir, issueUpload());
  await assert.rejects(sendBack(db, id, ''), DraftStateError);
  await sendBack(db, id, 'Cut the second brief.');
  let [row] = await listDrafts(db, 'sent_back');
  assert.equal(row.notes, 'Cut the second brief.');
  await assert.rejects(approveAndPublish(db, dir, id, user, new Date()), DraftStateError, 'a sent-back draft cannot be approved');
  await assert.rejects(sendBack(db, id, 'again'), DraftStateError);
  await replaceDraft(db, dir, id, issueUpload((f) => delete f['brief-your-words.md']));
  [row] = await listDrafts(db, 'drafted');
  assert.equal(row.id, id);
  assert.ok(!existsSync(path.join(dir, 'drafts', id, 'brief-your-words.md')), 'the rewrite replaces the old files');
  await assert.rejects(replaceDraft(db, dir, id, issueUpload()), DraftStateError, 'only a sent-back draft is replaced');
});

test('press store: withdraw frees the slot', async () => {
  const { db, dir } = await pressSetup();
  const { id } = await createDraft(db, dir, issueUpload());
  await withdraw(db, dir, id);
  assert.ok(!existsSync(path.join(dir, 'drafts', id)));
  assert.equal((await listDrafts(db, 'withdrawn')).length, 1);
  await assert.rejects(withdraw(db, dir, id), DraftStateError);
  const again = await createDraft(db, dir, issueUpload());
  assert.notEqual(again.id, id);
});
