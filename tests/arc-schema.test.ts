import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteAccount } from '../src/account/data.js';
import type { Db } from '../src/db.js';
import { createTestDb, testConfig } from './helpers.js';

/**
 * ARC campaigns, slice 1: the schema of migrations/031_arc.sql, row by
 * row through SQL. One test database for the file; every test makes its
 * own user, book, share and campaign, so the tests do not see each other.
 */

const db = await createTestDb();
let n = 0;
const next = () => (n += 1);

interface Campaign {
  userId: string;
  manuscriptId: string;
  shareId: string;
  campaignId: string;
  buildId: string;
}

async function one<T>(sql: string, params: unknown[]): Promise<T> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}

/** The Postgres SQLSTATE the promise rejects with. */
async function rejectsWith(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (err: unknown) => {
    assert.equal((err as { code?: string }).code, code, String(err));
    return true;
  });
}

async function newShare(d: Db, ownerId: string, manuscriptId: string, tokenHash: string | null): Promise<string> {
  const r = await d.query<{ id: string }>(
    `insert into shares (owner_id, manuscript_id, token_hash, title, snapshot)
     values ($1, $2, $3, 'ARC Book', '{}'::jsonb) returning id`,
    [ownerId, manuscriptId, tokenHash],
  );
  return r.rows[0].id;
}

async function insertCampaign(
  shareId: string,
  ownerId: string,
  manuscriptId: string,
  maxClaims = 50,
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into arc_campaigns (share_id, owner_id, manuscript_id, signup_token_hash, max_claims,
                                approval_mode, launch_date, closes_at, tz)
     values ($1, $2, $3, $4, $5, 'instant', '2026-12-15', now() + interval '14 days', 'Europe/London')
     returning id`,
    [shareId, ownerId, manuscriptId, `signup-${next()}`, maxClaims],
  );
  return r.rows[0].id;
}

/** A user, a book, a campaign share with no open link, a campaign and its version-1 build. */
async function campaign(): Promise<Campaign> {
  const k = next();
  const userId = (await one<{ id: string }>(
    `insert into users (email, password_hash) values ($1, 'x') returning id`,
    [`author${k}@example.com`],
  )).id;
  const manuscriptId = (await one<{ id: string }>(
    `insert into manuscripts (user_id, title, doc) values ($1, 'ARC Book', '{}'::jsonb) returning id`,
    [userId],
  )).id;
  const shareId = await newShare(db, userId, manuscriptId, null);
  const campaignId = await insertCampaign(shareId, userId, manuscriptId);
  const buildId = (await one<{ id: string }>(
    `insert into arc_builds (campaign_id, epub_base64, epub_sha256, epub_bytes, epub_filename)
     values ($1, 'UEsDBA==', 'sha', 4, 'arc-book-arc.epub') returning id`,
    [campaignId],
  )).id;
  return { userId, manuscriptId, shareId, campaignId, buildId };
}

function arcReader(shareId: string, name: string, email: string | null, status: string | null = 'pending', mailTokenHash: string | null = `mail-${next()}`) {
  return db.query<{ id: string }>(
    `insert into share_recipients (share_id, name, role, email, status, mail_token_hash)
     values ($1, $2, 'arc', $3, $4, $5) returning id`,
    [shareId, name, email, status, mailTokenHash],
  );
}

function betaReader(shareId: string, name: string, tokenHash: string | null, email: string | null = null) {
  return db.query<{ id: string }>(
    `insert into share_recipients (share_id, name, token_hash, email) values ($1, $2, $3, $4) returning id`,
    [shareId, name, tokenHash, email],
  );
}

async function countWhere(table: string, col: string, id: string): Promise<number> {
  const r = await db.query<{ n: string }>(`select count(*)::text as n from ${table} where ${col} = $1`, [id]);
  return Number(r.rows[0].n);
}

test('an arc reader needs an email, a status and a mail token; a beta reader needs a token and no email', async () => {
  const c = await campaign();
  const beta = await newShare(db, c.userId, c.manuscriptId, `beta-${next()}`);
  // The well-formed rows go in (so the refusals below are the shape check, nothing else).
  await arcReader(c.shareId, 'Sarah', 'sarah@example.com');
  await betaReader(beta, 'Ann', `token-${next()}`);
  const ok = await one<{ role: string; verify_attempts: number; codes_sent: number }>(
    `select role, verify_attempts, codes_sent from share_recipients where share_id = $1`,
    [beta],
  );
  assert.deepEqual(ok, { role: 'beta', verify_attempts: 0, codes_sent: 0 }, 'role defaults to beta');

  await rejectsWith(arcReader(c.shareId, 'No Email', null), '23514');
  // Decided by this task (the shape check's other two arms): no status, no mail token.
  await rejectsWith(arcReader(c.shareId, 'No Status', 'nostatus@example.com', null), '23514');
  await rejectsWith(arcReader(c.shareId, 'No Mail Token', 'notoken@example.com', 'pending', null), '23514');
  await rejectsWith(betaReader(beta, 'No Token', null), '23514');
  await rejectsWith(betaReader(beta, 'With Email', `token-${next()}`, 'ann@example.com'), '23514');
});

// Controller ruling T1a: the database refuses an ARC address that is not in normalised form.
test('an arc reader\'s email must be stored normalised', async () => {
  const c = await campaign();
  await rejectsWith(arcReader(c.shareId, 'Upper', 'Sarah@Example.com'), '23514');
  await rejectsWith(arcReader(c.shareId, 'Spaced', ' sarah@example.com '), '23514');
  assert.ok((await arcReader(c.shareId, 'Sarah', 'sarah@example.com')).rows[0].id);
});

test('two arc readers may share a name, never an email; beta names stay unique', async () => {
  const c = await campaign();
  await arcReader(c.shareId, 'Sarah', 'a@x.com');
  await arcReader(c.shareId, 'Sarah', 'b@x.com');
  await rejectsWith(arcReader(c.shareId, 'Another Sarah', 'a@x.com'), '23505');

  const beta = await newShare(db, c.userId, c.manuscriptId, `beta-${next()}`);
  await betaReader(beta, 'Ann', `token-${next()}`);
  await rejectsWith(betaReader(beta, 'ann', `token-${next()}`), '23505');
});

test('max_claims is 1 to 50', async () => {
  const c = await campaign();
  // A fresh book and share per insert, so only the check can refuse.
  const attempt = async (max: number) => {
    const m = (await one<{ id: string }>(
      `insert into manuscripts (user_id, title, doc) values ($1, 'Another', '{}'::jsonb) returning id`,
      [c.userId],
    )).id;
    return insertCampaign(await newShare(db, c.userId, m, null), c.userId, m, max);
  };
  await rejectsWith(attempt(0), '23514');
  await rejectsWith(attempt(51), '23514');
  assert.ok(await attempt(1));
  assert.ok(await attempt(50));
});

test('one running campaign per book', async () => {
  const c = await campaign();
  const second = await newShare(db, c.userId, c.manuscriptId, null);
  await rejectsWith(insertCampaign(second, c.userId, c.manuscriptId), '23505');
  await db.query('update arc_campaigns set ended_at = now() where id = $1', [c.campaignId]);
  assert.ok(await insertCampaign(second, c.userId, c.manuscriptId));
});

test('a book with a campaign cannot be deleted around the seam', async () => {
  const c = await campaign();
  await rejectsWith(db.query('delete from manuscripts where id = $1', [c.manuscriptId]), '23503');
  assert.equal(await countWhere('manuscripts', 'id', c.manuscriptId), 1);
});

test('deleting the campaign share takes the campaign, its build, its events and its readers', async () => {
  const c = await campaign();
  const reader = (await arcReader(c.shareId, 'Sarah', 'sarah@example.com')).rows[0].id;
  await db.query('update share_recipients set build_id = $2 where id = $1', [reader, c.buildId]);
  await db.query(`insert into arc_events (campaign_id, recipient_id, kind) values ($1, $2, 'claimed')`, [c.campaignId, reader]);
  await db.query('delete from shares where id = $1', [c.shareId]);
  assert.equal(await countWhere('arc_campaigns', 'id', c.campaignId), 0);
  assert.equal(await countWhere('arc_builds', 'campaign_id', c.campaignId), 0);
  assert.equal(await countWhere('arc_events', 'campaign_id', c.campaignId), 0);
  assert.equal(await countWhere('share_recipients', 'share_id', c.shareId), 0);
});

test('deleting one reader keeps their comment under the given name', async () => {
  const c = await campaign();
  const reader = (await arcReader(c.shareId, 'Sarah', 'sarah@example.com')).rows[0].id;
  const comment = (await one<{ id: string }>(
    `insert into share_comments (share_id, section_id, paragraph_index, body, reader_name, ip_hash, recipient_id)
     values ($1, 's1', 0, 'Loved it', 'Sarah', 'iphash', $2) returning id`,
    [c.shareId, reader],
  )).id;
  await db.query('delete from share_recipients where id = $1', [reader]);
  const kept = await one<{ reader_name: string; recipient_id: string | null }>(
    'select reader_name, recipient_id from share_comments where id = $1',
    [comment],
  );
  assert.deepEqual(kept, { reader_name: 'Sarah', recipient_id: null });
});

// Decided by this task: account-portal's deletion test owns no campaign,
// so without this the restrict on manuscript_id is only met with 0 rows.
test('deleting the account takes its campaign, its readers and its book; a suppression stays', async () => {
  const c = await campaign();
  const reader = (await arcReader(c.shareId, 'Sarah', 'sarah@example.com')).rows[0].id;
  await db.query(`insert into arc_events (campaign_id, recipient_id, kind) values ($1, $2, 'claimed')`, [c.campaignId, reader]);
  await db.query(`insert into mail_suppressions (hash, scope) values ('stop-hash', $1)`, [c.userId]);
  const result = await deleteAccount(db, testConfig(), c.userId, []);
  assert.equal(result.removed.arc_campaigns, 1);
  assert.equal(result.removed.manuscripts, 1);
  assert.equal(await countWhere('arc_campaigns', 'id', c.campaignId), 0);
  assert.equal(await countWhere('arc_builds', 'campaign_id', c.campaignId), 0);
  assert.equal(await countWhere('arc_events', 'campaign_id', c.campaignId), 0);
  assert.equal(await countWhere('share_recipients', 'id', reader), 0);
  assert.equal(await countWhere('manuscripts', 'id', c.manuscriptId), 0);
  assert.equal(await countWhere('mail_suppressions', 'scope', c.userId), 1, 'the opt-out outlives the account');
});

// Decided by this task (controller ruling F8): the cap is enforced by ONE
// conditional UPDATE. This proves the schema carries everything that
// statement needs: the campaign reached from the reader's share, and the
// claimed readers counted per campaign by share_id + role + status.
test('one statement counts a campaign\'s claimed readers against max_claims (F8)', async () => {
  const c = await campaign();
  await db.query('update arc_campaigns set max_claims = 1 where id = $1', [c.campaignId]);
  const first = (await arcReader(c.shareId, 'First', 'first@example.com', 'unverified')).rows[0].id;
  const second = (await arcReader(c.shareId, 'Second', 'second@example.com', 'unverified')).rows[0].id;
  const claim = (id: string) =>
    db.query<{ id: string }>(
      `update share_recipients r set status = 'claimed', claimed_at = now()
       from arc_campaigns a
       where r.id = $1 and a.share_id = r.share_id
         and (select count(*) from share_recipients x
              where x.share_id = a.share_id and x.role = 'arc' and x.status in ('pending', 'claimed')) < a.max_claims
       returning r.id`,
      [id],
    );
  assert.deepEqual((await claim(first)).rows, [{ id: first }]);
  assert.deepEqual((await claim(second)).rows, [], 'the cap holds: 0 rows means full');
  const statuses = await db.query<{ name: string; status: string }>(
    'select name, status from share_recipients where share_id = $1 order by name',
    [c.shareId],
  );
  assert.deepEqual(statuses.rows, [
    { name: 'First', status: 'claimed' },
    { name: 'Second', status: 'unverified' },
  ]);
});
