import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { setAdmin } from '../src/housekeeping/admin.js';
import { BACKUP_TABLES, classifyTables } from '../src/housekeeping/backup.js';
import { approveAndPublish, createDraft, DraftConflict, DraftInvalid, DraftStateError, listDrafts, mondayOf, replaceDraft, sendBack, validateUpload, withdraw, type DraftUpload } from '../src/weekly/drafts.js';
import type { MailMessage, Mailer, MailerStatus, MailResult } from '../src/mailer.js';
import { createTestDb, startTestServer } from './helpers.js';

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

/* Task 4: the drafter API and the editor's email. */

/** A configured mailer that records instead of sending. */
class RecordingMailer implements Mailer {
  sent: MailMessage[] = [];
  status(): MailerStatus {
    return { configured: true, transport: 'smtp', from: 'Beuk <hello@example.com>', detail: 'recording mailer (test)' };
  }
  async send(message: MailMessage): Promise<MailResult> {
    this.sent.push(message);
    return { delivered: true, messageId: `<test-${this.sent.length}@example.com>` };
  }
  async verify() {
    return { ok: true, detail: 'recording mailer (test)' };
  }
}

const TOKEN = 't'.repeat(40);
const EDITOR = 'editor@example.com';

async function pressServer(overrides: Record<string, unknown> = {}) {
  const db = await createTestDb();
  const mailer = new RecordingMailer();
  const s = await startTestServer(db, undefined, { weeklyDraftToken: TOKEN, weeklyEditorEmail: EDITOR, ...overrides }, undefined, { mailer });
  const call = (method: string, p: string, body?: unknown, token: string | null = TOKEN) =>
    fetch(`${s.base}${p}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { db, s, mailer, call };
}

function sourcedUpload(): DraftUpload {
  return issueUpload((f) => {
    f['kdp-rule.md'] = b64(OUTSIDE);
    f['sources.json'] = b64(JSON.stringify([{ url: 'https://kdp.example/news', fetchedAt: '2026-11-05T07:00:00Z', quote: 'The rule changes on 1 December.', story: 'kdp-rule' }]));
  });
}

test('press API: no token, a wrong token, or a server with no token configured → 401', async () => {
  const { s, call } = await pressServer();
  try {
    assert.equal((await call('POST', '/api/weekly/drafts', sourcedUpload(), null)).status, 401);
    assert.equal((await call('POST', '/api/weekly/drafts', sourcedUpload(), 'x'.repeat(40))).status, 401);
    assert.equal((await call('GET', '/api/weekly/drafts?status=sent_back', undefined, null)).status, 401);
    assert.equal((await call('POST', '/api/weekly/drafts/failed', { reason: 'x' }, null)).status, 401);
  } finally {
    await s.close();
  }
  const off = await pressServer({ weeklyDraftToken: null });
  try {
    assert.equal((await off.call('POST', '/api/weekly/drafts', sourcedUpload(), TOKEN)).status, 401);
  } finally {
    await off.s.close();
  }
});

test('press API: a valid upload is stored and the editor is emailed the preview, every source and every dropped story', async () => {
  const { s, mailer, call } = await pressServer();
  try {
    const bad = await call('POST', '/api/weekly/drafts', issueUpload((f) => (f['../x.md'] = b64('x'))));
    assert.equal(bad.status, 400);
    assert.ok(((await bad.json()) as { problems: string[] }).problems.some((p) => p.includes('../x.md')));
    assert.equal(mailer.sent.length, 0, 'a refused upload mails nobody');

    const res = await call('POST', '/api/weekly/drafts', { ...sourcedUpload(), noPictures: ['Beuk School Opens Its Doors: local image model not installed'] });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { id: string; previewUrl: string; email: string };
    assert.equal(body.previewUrl, `${s.config.appBaseUrl}/school/weekly/draft/${body.id}`);
    assert.equal(body.email, 'sent');
    assert.equal(mailer.sent.length, 1);
    const m = mailer.sent[0];
    assert.equal(m.to, EDITOR);
    assert.equal(m.subject, 'Beuk Weekly draft ready: Beuk School Opens Its Doors');
    for (const part of [m.text, m.html!]) {
      assert.ok(part.includes(body.previewUrl), 'the preview link');
      assert.ok(part.includes('https://kdp.example/news'), 'every source URL');
      assert.ok(part.includes('A rumour') && part.includes('could not confirm'), 'every dropped story and why');
      assert.ok(part.includes('example.org'), 'every outlet, so the editor can veto one');
      assert.ok(part.includes('local image model not installed'), 'stories without a picture');
      assert.ok(part.includes('a'.repeat(40)), 'the commit it was written from');
    }
    assert.ok(m.text.includes('Nothing goes live until you press Approve and publish'));

    const again = await call('POST', '/api/weekly/drafts', sourcedUpload());
    assert.equal(again.status, 409);
    const conflict = (await again.json()) as { error: string; id: string; previewUrl: string };
    assert.equal(conflict.error, 'a draft is already waiting');
    assert.equal(conflict.id, body.id);
    assert.equal(conflict.previewUrl, body.previewUrl);
  } finally {
    await s.close();
  }
});

test('press API: failed mails the reason; sent_back lists notes; replaces resubmits a sent-back draft', async () => {
  const { db, s, mailer, call } = await pressServer();
  try {
    const f = await call('POST', '/api/weekly/drafts/failed', { reason: 'claude: not logged in' });
    assert.equal(f.status, 202);
    assert.equal(mailer.sent.at(-1)!.subject, 'Beuk Weekly: no draft this week');
    assert.ok(mailer.sent.at(-1)!.text.includes('claude: not logged in'));
    assert.equal((await call('POST', '/api/weekly/drafts/failed', { reason: 'x'.repeat(2001) })).status, 400);

    const { id } = (await (await call('POST', '/api/weekly/drafts', sourcedUpload())).json()) as { id: string };
    assert.deepEqual(await (await call('GET', '/api/weekly/drafts?status=sent_back')).json(), []);
    await sendBack(db, id, 'Shorter lead, please.');
    const back = (await (await call('GET', '/api/weekly/drafts?status=sent_back')).json()) as { id: string; notes: string; sourceCommit: string }[];
    assert.deepEqual(back, [{ id, notes: 'Shorter lead, please.', sourceCommit: 'a'.repeat(40) }]);

    const before = mailer.sent.length;
    const re = await call('POST', '/api/weekly/drafts', { replaces: id, ...sourcedUpload() });
    assert.equal(re.status, 201);
    assert.equal(((await re.json()) as { id: string }).id, id);
    assert.equal(mailer.sent.length, before + 1, 'a fresh preview email for the rewrite');
    assert.equal((await listDrafts(db, 'drafted'))[0].id, id);
  } finally {
    await s.close();
  }
});

/* Task 5: the preview page — approve, send back, withdraw. */

/** Register an account and return its session cookie ("name=value"). */
async function signIn(base: string, email: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct horse battery' }),
  });
  assert.ok(res.status < 300, `register ${email}: ${res.status}`);
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

async function previewSetup() {
  const p = await pressServer();
  const { id } = (await (await p.call('POST', '/api/weekly/drafts', sourcedUpload())).json()) as { id: string };
  const admin = await signIn(p.s.base, 'admin@example.com');
  assert.equal(await setAdmin(p.db, 'admin@example.com', true), 'granted');
  const writer = await signIn(p.s.base, 'writer@example.com');
  const page = (url: string, cookie?: string) => fetch(`${p.s.base}${url}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  const act = (action: string, cookie: string, body: unknown = {}, origin = p.s.config.appBaseUrl) =>
    fetch(`${p.s.base}/school/weekly/draft/${id}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin },
      body: JSON.stringify(body),
    });
  return { ...p, id, admin, writer, page, act };
}

test('press preview: signed out sees only a sign-in box; a writer or an unknown id gets 404; every answer is noindex and no-store', async () => {
  const { s, id, writer, admin, page } = await previewSetup();
  try {
    const out = await page(`/school/weekly/draft/${id}`);
    assert.equal(out.status, 200);
    const html = await out.text();
    assert.match(html, /Sign in/);
    assert.ok(!html.includes('Beuk School Opens Its Doors'), 'no draft content for a signed-out visitor');
    assert.match(html, /<meta name="robots" content="noindex/);
    assert.match(out.headers.get('x-robots-tag') ?? '', /noindex/);
    assert.equal(out.headers.get('cache-control'), 'no-store');

    const w = await page(`/school/weekly/draft/${id}`, writer);
    assert.equal(w.status, 404);
    assert.match(w.headers.get('x-robots-tag') ?? '', /noindex/);
    assert.equal((await page(`/school/weekly/draft/${id}/img/desk.jpg`, writer)).status, 404);
    assert.equal((await page(`/school/weekly/draft/${id}/img/desk.jpg`)).status, 404);
    assert.equal((await page('/school/weekly/draft/00000000-0000-0000-0000-000000000000', admin)).status, 404);
    assert.equal((await page('/school/weekly/draft/not-a-uuid', admin)).status, 404);
  } finally {
    await s.close();
  }
});

test('press preview: an admin sees the issue with the press bar; stories and pictures are under the draft', async () => {
  const { s, id, admin, page } = await previewSetup();
  try {
    const res = await page(`/school/weekly/draft/${id}`, admin);
    assert.equal(res.status, 200);
    const html = await res.text();
    for (const t of ['Beuk School Opens Its Doors', 'Approve and publish', 'Send back', 'Withdraw', 'a'.repeat(40), 'example.org', 'A rumour']) assert.ok(html.includes(t), t);
    assert.match(html, /<meta name="robots" content="noindex/);
    assert.ok(html.includes(`href="/school/weekly/draft/${id}/school-opens"`));
    assert.ok(!/href="\/school\/weekly\/1\//.test(html), 'no link into the live issue');
    assert.equal(res.headers.get('cache-control'), 'no-store');

    const story = await page(`/school/weekly/draft/${id}/twenty-four-trims`, admin);
    assert.equal(story.status, 200);
    assert.match(await story.text(), /Twenty-Four Trims, Measured to the Hundredth/);
    const img = await page(`/school/weekly/draft/${id}/img/trims.jpg`, admin);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.equal((await page(`/school/weekly/draft/${id}/img/..%2Fissue.md`, admin)).status, 404);
    assert.equal((await page(`/school/weekly/draft/${id}/brief-your-words`, admin)).status, 404, 'briefs have no page');
  } finally {
    await s.close();
  }
});

test('press preview: approve needs our Origin, publishes exactly once, and the issue is live', async () => {
  const { s, db, id, admin, writer, act, page } = await previewSetup();
  try {
    assert.equal((await act('approve', admin, {}, 'https://evil.example')).status, 403);
    assert.equal((await act('approve', writer)).status, 404);
    assert.equal((await listDrafts(db, 'drafted')).length, 1, 'nothing changed');

    const ok = await act('approve', admin);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { url: '/school/weekly/2' });
    assert.equal((await act('approve', admin)).status, 409, 'a second approve publishes nothing');
    const live = await page('/school/weekly/2');
    assert.equal(live.status, 200);
    assert.match(await live.text(), /Beuk School Opens Its Doors/);
    assert.ok(!existsSync(path.join(s.config.weeklyDir, 'drafts', id)));
    // The old preview link still answers, and says where the issue went.
    const after = await (await page(`/school/weekly/draft/${id}`, admin)).text();
    assert.match(after, /Published as No\. 2/);
    assert.ok(!after.includes('Approve and publish'));

    const xml = await (await fetch(`${s.base}/sitemap.xml`)).text();
    assert.ok(!xml.includes('/draft/'), 'drafts are never in the sitemap');
    const audit = await db.query<{ action: string }>(`select action from housekeeping_audit where action like 'weekly.%'`);
    assert.deepEqual(audit.rows.map((r) => r.action), ['weekly.approve']);
  } finally {
    await s.close();
  }
});

test('press preview: send back records the notes; withdraw discards the draft', async () => {
  const { s, db, id, admin, act, page, call } = await previewSetup();
  try {
    assert.equal((await act('send-back', admin, { notes: '' })).status, 400);
    assert.equal((await act('send-back', admin, { notes: 'Shorter lead.' }, 'https://evil.example')).status, 403);
    assert.equal((await act('send-back', admin, { notes: 'Shorter lead.' })).status, 200);
    assert.equal((await listDrafts(db, 'sent_back'))[0].notes, 'Shorter lead.');
    const html = await (await page(`/school/weekly/draft/${id}`, admin)).text();
    assert.match(html, /Shorter lead\./);
    assert.ok(!html.includes('Approve and publish'), 'a sent-back draft waits for the rewrite');

    assert.equal((await act('withdraw', admin)).status, 200);
    assert.equal((await listDrafts(db, 'withdrawn')).length, 1);
    assert.equal((await act('withdraw', admin)).status, 409);
    assert.equal((await call('POST', '/api/weekly/drafts', sourcedUpload())).status, 201, 'the slot is free again');
  } finally {
    await s.close();
  }
});

test('press API: published lists issue numbers and their source commits, newest first, for the next run to start from', async () => {
  const { db, s, call } = await pressServer();
  try {
    assert.deepEqual(await (await call('GET', '/api/weekly/drafts?status=published')).json(), []);
    const { id } = (await (await call('POST', '/api/weekly/drafts', sourcedUpload())).json()) as { id: string };
    const user = (await db.query<{ id: string }>(`insert into users (email, password_hash) values ('ed2@example.com', 'x') returning id`)).rows[0].id;
    await approveAndPublish(db, s.config.weeklyDir, id, user, new Date('2026-11-05T12:00:00Z'));
    assert.deepEqual(await (await call('GET', '/api/weekly/drafts?status=published')).json(), [{ id, issueNumber: 2, sourceCommit: 'a'.repeat(40) }]);
    assert.equal((await call('GET', '/api/weekly/drafts?status=drafted')).status, 400);
  } finally {
    await s.close();
  }
});
