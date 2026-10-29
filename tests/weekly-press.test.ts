import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { BACKUP_TABLES, classifyTables } from '../src/housekeeping/backup.js';
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
