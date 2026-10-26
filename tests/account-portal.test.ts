import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { ACCOUNT_DELETED_TABLES } from '../src/account/data.js';
import { readZip } from '../src/housekeeping/packages.js';
import type { Db } from '../src/db.js';
import type { MailMessage, Mailer, MailerStatus, MailResult } from '../src/mailer.js';
import { DEFAULT_PORTAL_LIMITS, type PortalLimits } from '../src/routes/account-portal.js';
import type { BackgroundTasks } from '../src/routes/account.js';
import { Client, createTestDb, registerUser, testConfig } from './helpers.js';

/* ------------------------------------------------------------------ */
/* Test doubles + server                                               */

/** A configured mailer that records instead of sending. */
class RecordingMailer implements Mailer {
  sent: MailMessage[] = [];
  status(): MailerStatus {
    return { configured: true, transport: 'smtp', from: 'beuk@example.com', detail: 'recording mailer (test)' };
  }
  async send(message: MailMessage): Promise<MailResult> {
    this.sent.push(message);
    return { delivered: true, messageId: `<test-${this.sent.length}@example.com>` };
  }
  async verify() {
    return { ok: true, detail: 'recording mailer (test)' };
  }
  to(email: string): MailMessage[] {
    return this.sent.filter((m) => m.to === email);
  }
}

const ROOMY: PortalLimits = {
  resendPerUser: { max: 1000, windowMs: 60_000 },
  emailPerUser: { max: 1000, windowMs: 60_000 },
  exportPerUser: { max: 1000, windowMs: 60_000 },
  deletePerUser: { max: 1000, windowMs: 60_000 },
  confirmPerIp: { max: 1000, windowMs: 60_000 },
};

interface PortalServer {
  base: string;
  exportDir: string;
  settle: () => Promise<void>;
  close: () => Promise<void>;
}

async function start(db: Db, opts: { mailer?: Mailer; limits?: PortalLimits; supportEmail?: string | null } = {}): Promise<PortalServer> {
  const config = testConfig(opts.supportEmail === undefined ? {} : { supportEmail: opts.supportEmail });
  const app = buildApp({ db, config, mailer: opts.mailer, portalLimits: opts.limits ?? ROOMY });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  return {
    base: `http://127.0.0.1:${address.port}`,
    exportDir: config.exportDir,
    settle: () => (app.locals.accountTasks as BackgroundTasks).idle(),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** GET a page with the client's cookie jar; returns status + text. */
async function page(client: Client, base: string, p: string): Promise<{ status: number; text: string; headers: Headers }> {
  // Client.request parses JSON; pages are HTML, so borrow its cookie
  // header through a tiny JSON-free fetch.
  const cookie = (client as unknown as { cookieHeader(): Record<string, string> }).cookieHeader();
  const res = await fetch(base + p, { headers: cookie });
  return { status: res.status, text: await res.text(), headers: res.headers };
}

async function postForm(base: string, p: string, fields: Record<string, string>) {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: res.status, text: await res.text() };
}

function tokenIn(message: MailMessage): string {
  const m = /\/account\/confirm\?token=([A-Za-z0-9_-]+)/.exec(message.text);
  assert.ok(m, `no confirm link in: ${message.text}`);
  return m[1];
}

const BOOK = {
  meta: { title: 'The Salt Road', author: 'A. Writer', language: 'en' },
  sections: [
    { id: 'ch1', kind: 'body', type: 'chapter', title: 'One', content: 'One two three.\n\nFour *five* six.' },
    { id: 'ch2', kind: 'body', type: 'chapter', title: 'Two', content: 'Seven eight.' },
  ],
};

async function makeBook(c: Client, title = 'The Salt Road'): Promise<string> {
  const r = await c.post('/api/manuscripts', { title, doc: BOOK });
  assert.equal(r.status, 201);
  return (r.body.manuscript as { id: string }).id;
}

async function userId(db: Db, email: string): Promise<string> {
  const r = await db.query<{ id: string }>('select id from users where email = $1', [email]);
  assert.ok(r.rows[0], `no user ${email}`);
  return r.rows[0].id;
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */

test('signed out, /account is a calm page with Sign in and Create an account doors into the studio', async () => {
  const db = await createTestDb();
  const s = await start(db);
  try {
    const res = await fetch(`${s.base}/account`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    const html = await res.text();
    assert.match(html, /href="\/studio\?signin"/);
    assert.match(html, /href="\/studio\?signup"/);
    assert.match(html, /Writing never needs an account/);
    assert.ok(!html.replace(/<!doctype html>/i, '').includes('!'), 'no exclamation marks in the copy');
    // The page's own assets are served.
    assert.equal((await fetch(`${s.base}/account/account.css`)).status, 200);
    const js = await fetch(`${s.base}/account/account.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type') ?? '', /javascript/);
  } finally {
    await s.close();
  }
});

test('signed in, /account is the typesetting portal: email, shelf with words + studio links, archive, readers, streak, plan, security, data, delete', async () => {
  const db = await createTestDb();
  const mailer = new RecordingMailer();
  const s = await start(db, { mailer });
  try {
    const c = new Client(s.base);
    await registerUser(c, 'portal@example.com');
    const id = await makeBook(c);
    const up = await c.upload(`/api/exports?manuscriptId=${id}&format=epub&filename=salt-road.epub`, Buffer.from('PK fake epub bytes'));
    assert.equal(up.status, 201);
    const share = await c.post('/api/shares', { manuscriptId: id });
    assert.equal(share.status, 201);
    assert.equal((await c.post('/api/streak/heartbeat')).status, 200);
    await s.settle();

    const { status, text: html } = await page(c, s.base, '/account');
    assert.equal(status, 200);
    assert.match(html, /Your typesetting portal/);
    assert.match(html, /portal@example\.com/);
    // Shelf: title, a rough word count (tags stripped), last saved, open link.
    assert.match(html, /The Salt Road/);
    assert.match(html, /about 8 words/);
    assert.ok(html.includes(`href="/studio?book=${id}"`), 'Open in the studio link');
    assert.match(html, /last saved \d+ [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC/);
    // Archive, readers, streak.
    assert.match(html, /salt-road\.epub/);
    assert.match(html, /href="\/api\/exports\/[0-9a-f-]{36}\/download"/);
    assert.match(html, /1 reading link, 1 open/);
    assert.match(html, /1 day in a row, today included/);
    // Plan: billing is not configured in tests — said plainly, no price anywhere.
    assert.match(html, /data-plan-status="none"/);
    assert.match(html, /Plans are not switched on on this server yet/);
    assert.match(html, /export is always open/);
    assert.ok(!/[$€£]\s?\d|per month|\/month|per year/i.test(html), 'no price shown or implied');
    // Unconfirmed, with mail configured: the resend button.
    assert.match(html, /data-unconfirmed/);
    assert.match(html, /data-action="resend"/);
    // Security + data + delete.
    assert.match(html, /data-form="password"/);
    assert.match(html, /data-action="everywhere"/);
    assert.match(html, /href="\/api\/account\/export"/);
    assert.match(html, /Download all my data first/);
    assert.match(html, /data-form="delete"/);
    assert.match(html, /Type <b>delete my account<\/b> to confirm/);
    assert.match(html, /data-form="email"/);
  } finally {
    await s.close();
  }
});

/* ------------------------------------------------------------------ */
/* Email confirmation                                                  */

test('confirm flow (mail configured): sign-up sends a link; GET shows a button and changes nothing; POST confirms once; tokens stored hashed', async () => {
  const db = await createTestDb();
  const mailer = new RecordingMailer();
  const s = await start(db, { mailer });
  try {
    const c = new Client(s.base);
    const reg = await registerUser(c, 'new@example.com');
    assert.equal(reg.status, 201);
    assert.equal(reg.body.emailDelivery, 'email');
    await s.settle();
    const mails = mailer.to('new@example.com');
    assert.equal(mails.length, 1);
    assert.match(mails[0].subject, /Confirm your email address/);
    assert.ok(!mails[0].text.includes('!'), 'calm copy');
    const token = tokenIn(mails[0]);

    const stored = await db.query('select * from email_confirmations');
    assert.ok(!JSON.stringify(stored.rows).includes(token), 'plaintext token stored');

    let summary = await c.get('/api/account/summary');
    assert.equal(summary.body.emailConfirmed, false);

    // Looking at the link (a mail scanner) does not use it.
    const look = await fetch(`${s.base}/account/confirm?token=${token}`);
    assert.equal(look.status, 200);
    const lookHtml = await look.text();
    assert.ok(lookHtml.includes(`name="token" value="${token}"`));
    assert.match(lookHtml, /method="post" action="\/account\/confirm"/);
    summary = await c.get('/api/account/summary');
    assert.equal(summary.body.emailConfirmed, false);

    const done = await postForm(s.base, '/account/confirm', { token });
    assert.equal(done.status, 200);
    assert.match(done.text, /Your address is confirmed/);
    summary = await c.get('/api/account/summary');
    assert.equal(summary.body.emailConfirmed, true);
    const { text: html } = await page(c, s.base, '/account');
    assert.match(html, /Confirmed on/);
    assert.ok(!html.includes('data-unconfirmed'));

    // Single use.
    const again = await postForm(s.base, '/account/confirm', { token });
    assert.equal(again.status, 400);
    assert.match(again.text, /This link can’t be used/);
    // Resend once confirmed: nothing sent.
    const before = mailer.sent.length;
    const resend = await c.post('/api/account/confirm/resend');
    assert.equal(resend.body.alreadyConfirmed, true);
    assert.equal(mailer.sent.length, before);
  } finally {
    await s.close();
  }
});

test('resend makes a new link and retires the old one; an expired link is refused', async () => {
  const db = await createTestDb();
  const mailer = new RecordingMailer();
  const s = await start(db, { mailer });
  try {
    const c = new Client(s.base);
    await registerUser(c, 'again@example.com');
    await s.settle();
    const first = tokenIn(mailer.to('again@example.com')[0]);
    const r = await c.post('/api/account/confirm/resend');
    assert.equal(r.status, 200);
    assert.equal(r.body.sent, true);
    assert.equal(r.body.emailDelivery, 'email');
    const second = tokenIn(mailer.to('again@example.com')[1]);
    assert.notEqual(first, second);
    assert.equal((await postForm(s.base, '/account/confirm', { token: first })).status, 400);
    await db.query(`update email_confirmations set expires_at = now() - interval '1 second' where used_at is null`);
    assert.equal((await postForm(s.base, '/account/confirm', { token: second })).status, 400);
    assert.equal((await c.get('/api/account/summary')).body.emailConfirmed, false);
    // Garbage tokens are a plain refusal, not a 500.
    assert.equal((await postForm(s.base, '/account/confirm', { token: 'x'.repeat(500) })).status, 400);
    assert.equal((await postForm(s.base, '/account/confirm', {})).status, 400);
  } finally {
    await s.close();
  }
});

test('mail NOT configured: sign-up and the studio say "not-configured", nothing is claimed sent, and the account keeps working', async () => {
  const db = await createTestDb();
  const s = await start(db); // default mailer: unconfigured, MAIL_LOG_LINKS off
  try {
    const c = new Client(s.base);
    const reg = await registerUser(c, 'quiet@example.com');
    assert.equal(reg.status, 201);
    assert.equal(reg.body.emailDelivery, 'not-configured');
    await s.settle();
    const summary = await c.get('/api/account/summary');
    assert.equal(summary.body.emailConfirmed, false);
    assert.equal(summary.body.emailDelivery, 'not-configured');
    const resend = await c.post('/api/account/confirm/resend');
    assert.equal(resend.status, 200);
    assert.equal(resend.body.emailDelivery, 'not-configured');
    assert.equal(resend.body.sent, false);
    // Unconfirmed never blocks writing.
    await makeBook(c);
    const { text: html } = await page(c, s.base, '/account');
    assert.match(html, /Email isn’t set up on this server yet, so no confirmation link can be sent/);
    assert.ok(!html.includes('data-action="resend"'));
    assert.ok(!html.includes('data-form="email"'), 'no change-email form while it cannot work');
  } finally {
    await s.close();
  }
});

/* ------------------------------------------------------------------ */
/* Change email                                                        */

test('change email: needs the current password; link to the NEW address, notice to the OLD; changes only when confirmed', async () => {
  const db = await createTestDb();
  const mailer = new RecordingMailer();
  const s = await start(db, { mailer });
  try {
    const c = new Client(s.base);
    await registerUser(c, 'old@example.com');
    const other = new Client(s.base);
    await registerUser(other, 'taken@example.com');
    await s.settle();

    assert.equal((await c.post('/api/account/email', { currentPassword: 'wrong password!', newEmail: 'fresh@example.com' })).status, 403);
    assert.equal((await c.post('/api/account/email', { currentPassword: 'correct horse battery', newEmail: 'not-an-email' })).status, 400);
    assert.equal((await c.post('/api/account/email', { currentPassword: 'correct horse battery', newEmail: 'taken@example.com' })).status, 409);
    assert.equal((await c.post('/api/account/email', { currentPassword: 'correct horse battery', newEmail: 'old@example.com' })).status, 400);

    const ok = await c.post('/api/account/email', { currentPassword: 'correct horse battery', newEmail: 'Fresh@Example.com ' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.pendingEmail, 'fresh@example.com');
    await s.settle();
    const toNew = mailer.to('fresh@example.com');
    assert.equal(toNew.length, 1);
    assert.match(toNew[0].subject, /Confirm your new email address/);
    const notice = mailer.to('old@example.com').filter((m) => /about to change/.test(m.subject));
    assert.equal(notice.length, 1);
    assert.match(notice[0].text, /fresh@example\.com/);
    assert.ok(!/token=/.test(notice[0].text), 'the old address never gets the link');

    // Not changed yet.
    assert.equal(((await c.get('/api/auth/me')).body.user as { email: string }).email, 'old@example.com');
    const summary = await c.get('/api/account/summary');
    assert.equal(summary.body.pendingEmail, 'fresh@example.com');
    const { text: html } = await page(c, s.base, '/account');
    assert.match(html, /Waiting for you to open the link sent to <b>fresh@example\.com<\/b>/);

    const done = await postForm(s.base, '/account/confirm', { token: tokenIn(toNew[0]) });
    assert.equal(done.status, 200);
    assert.match(done.text, /now uses fresh@example\.com/);
    const me = await c.get('/api/auth/me');
    assert.equal((me.body.user as { email: string }).email, 'fresh@example.com');
    assert.equal((await c.get('/api/account/summary')).body.emailConfirmed, true);
    assert.equal((await c.get('/api/account/summary')).body.pendingEmail, null);
    // Sign in works with the new address only.
    assert.equal((await new Client(s.base).post('/api/auth/login', { email: 'fresh@example.com', password: 'correct horse battery' })).status, 200);
    assert.equal((await new Client(s.base).post('/api/auth/login', { email: 'old@example.com', password: 'correct horse battery' })).status, 401);
  } finally {
    await s.close();
  }
});

test('change email: a cancelled change, and an address taken before the link is opened, change nothing', async () => {
  const db = await createTestDb();
  const mailer = new RecordingMailer();
  const s = await start(db, { mailer });
  try {
    const c = new Client(s.base);
    await registerUser(c, 'stay@example.com');
    await c.post('/api/account/email', { currentPassword: 'correct horse battery', newEmail: 'later@example.com' });
    const cancelled = tokenIn(mailer.to('later@example.com')[0]);
    const cancel = await c.post('/api/account/email/cancel');
    assert.equal(cancel.body.cancelled, 1);
    assert.equal((await postForm(s.base, '/account/confirm', { token: cancelled })).status, 400);

    await c.post('/api/account/email', { currentPassword: 'correct horse battery', newEmail: 'race@example.com' });
    const raced = tokenIn(mailer.to('race@example.com')[0]);
    await registerUser(new Client(s.base), 'race@example.com');
    const r = await postForm(s.base, '/account/confirm', { token: raced });
    assert.equal(r.status, 400);
    assert.match(r.text, /already in use/);
    assert.equal(((await c.get('/api/auth/me')).body.user as { email: string }).email, 'stay@example.com');
  } finally {
    await s.close();
  }
});

test('change email without mail configured is refused honestly (501) and the address stays', async () => {
  const db = await createTestDb();
  const s = await start(db);
  try {
    const c = new Client(s.base);
    await registerUser(c, 'nomail@example.com');
    const r = await c.post('/api/account/email', { currentPassword: 'correct horse battery', newEmail: 'elsewhere@example.com' });
    assert.equal(r.status, 501);
    assert.equal(r.body.emailDelivery, 'not-configured');
    assert.match(String(r.body.error), /email isn't set up on this server/);
    assert.equal(((await c.get('/api/auth/me')).body.user as { email: string }).email, 'nomail@example.com');
    const rows = await db.query(`select 1 from email_confirmations where purpose = 'change'`);
    assert.equal(rows.rows.length, 0);
  } finally {
    await s.close();
  }
});

/* ------------------------------------------------------------------ */
/* Download all my data                                                */

test('download all my data: one ZIP with every book, export bytes + index, shares + comments, streak, jobs, account.json and a README — and nobody else\'s', async () => {
  const db = await createTestDb();
  const s = await start(db);
  try {
    const c = new Client(s.base);
    await registerUser(c, 'zip@example.com');
    const id = await makeBook(c);
    await makeBook(c, 'Second / Book');
    const epub = Buffer.from('PK\u0003\u0004 pretend epub');
    const md = Buffer.from('# The Salt Road\n\n'.repeat(50));
    assert.equal((await c.upload(`/api/exports?manuscriptId=${id}&format=epub&filename=salt.epub`, epub)).status, 201);
    assert.equal((await c.upload(`/api/exports?manuscriptId=${id}&format=markdown&filename=salt.md`, md)).status, 201);
    const share = await c.post('/api/shares', { manuscriptId: id });
    const token = String(share.body.token);
    const reader = new Client(s.base);
    const comment = await reader.post(`/read/${token}/comments`, { sectionId: 'ch1', body: 'Lovely opening line.', readerName: 'Ada' });
    assert.equal(comment.status, 201);
    await c.post('/api/streak/heartbeat');

    // Someone else's things must not appear.
    const other = new Client(s.base);
    await registerUser(other, 'other@example.com');
    await makeBook(other, 'Not Yours');

    const res = await c.download('/api/account/export');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/zip');
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment; filename="beuk-data-\d{4}-\d{2}-\d{2}\.zip"$/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const entries = readZip(res.bytes);
    const names = entries.map((e) => e.name).sort();
    const get = (n: string) => entries.find((e) => e.name === n)!.data;
    for (const n of ['README.txt', 'account.json', 'exports/index.json', 'exports/salt.epub', 'exports/salt.md', 'streak.json', 'jobs.json']) {
      assert.ok(names.includes(n), `${n} in ${names.join(', ')}`);
    }
    const books = names.filter((n) => n.startsWith('manuscripts/'));
    assert.equal(books.length, 2);
    assert.ok(books.some((n) => n.startsWith('manuscripts/Second Book (')), 'slashes never become folders');
    const book = JSON.parse(get(books.find((n) => n.startsWith('manuscripts/The Salt Road'))!).toString('utf8'));
    assert.deepEqual(book.doc, BOOK);
    assert.ok(get('exports/salt.epub').equals(epub));
    assert.ok(get('exports/salt.md').equals(md));
    assert.equal(entries.find((e) => e.name === 'exports/salt.md')!.method, 8, 'text is deflated');
    assert.equal(entries.find((e) => e.name === 'exports/salt.epub')!.method, 0, 'EPUB is stored as it is');
    const index = JSON.parse(get('exports/index.json').toString('utf8'));
    assert.equal(index.exports.length, 2);
    assert.ok(index.exports.every((x: { sha256: string; file: string }) => /^[0-9a-f]{64}$/.test(x.sha256) && x.file));
    const shareFile = names.find((n) => n.startsWith('shares/'))!;
    const shareJson = JSON.parse(get(shareFile).toString('utf8'));
    assert.equal(shareJson.comments.length, 1);
    assert.equal(shareJson.comments[0].body, 'Lovely opening line.');
    assert.equal(shareJson.comments[0].readerName, 'Ada');
    assert.ok(shareJson.readingCopy.sections.length >= 1);
    const streak = JSON.parse(get('streak.json').toString('utf8'));
    assert.equal(streak.daysWriting.length, 1);
    const account = JSON.parse(get('account.json').toString('utf8'));
    assert.equal(account.email, 'zip@example.com');
    assert.equal(account.counts.manuscripts, 2);
    assert.equal(account.counts.exports, 2);
    assert.equal(account.counts.comments, 1);
    const readme = get('README.txt').toString('utf8');
    assert.match(readme, /manuscripts\//);
    assert.match(readme, /Your password\. The server keeps only a one-way hash/);
    // Secrets and other people's data never leave.
    const all = entries.map((e) => e.data.toString('utf8')).join('\n');
    for (const secret of ['password_hash', 'token_hash', 'ip_hash', '$argon2', 'Not Yours', 'other@example.com', token]) {
      assert.ok(!all.includes(secret), `${secret} leaked into the export`);
    }

    // A file missing from storage is said so, not silently dropped.
    const uid = await userId(db, 'zip@example.com');
    const md5 = index.exports.find((x: { filename: string }) => x.filename === 'salt.md');
    const { rm } = await import('node:fs/promises');
    await rm(path.join(s.exportDir, uid, md5.id));
    const res2 = await c.download('/api/account/export');
    const e2 = readZip(res2.bytes);
    const idx2 = JSON.parse(e2.find((e) => e.name === 'exports/index.json')!.data.toString('utf8'));
    assert.equal(idx2.exports.filter((x: { missingFromStorage?: boolean }) => x.missingFromStorage).length, 1);
    assert.match(e2.find((e) => e.name === 'README.txt')!.data.toString('utf8'), /1 archived file\(s\) were listed but missing/);

    // Signed out: 401.
    assert.equal((await new Client(s.base).download('/api/account/export')).status, 401);
  } finally {
    await s.close();
  }
});

/* ------------------------------------------------------------------ */
/* Delete my account                                                   */

test('delete my account: phrase + password required; everything the account owns is gone (rows and files); others untouched; signed out', async () => {
  const db = await createTestDb();
  const mailer = new RecordingMailer();
  const s = await start(db, { mailer });
  try {
    const c = new Client(s.base);
    await registerUser(c, 'leaving@example.com');
    const id = await makeBook(c);
    await c.upload(`/api/exports?manuscriptId=${id}&format=epub&filename=leaving.epub`, Buffer.from('PK bytes'));
    const share = await c.post('/api/shares', { manuscriptId: id });
    await new Client(s.base).post(`/read/${share.body.token}/comments`, { sectionId: 'ch1', body: 'Hm.', readerName: 'Bo' });
    await c.post('/api/streak/heartbeat');
    await c.post('/api/auth/forgot', { email: 'leaving@example.com' });
    await s.settle();
    const uid = await userId(db, 'leaving@example.com');
    // A terminal subscription row (deleted) and a live one (left for the operator).
    await db.query(
      `insert into billing_subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, status_since, livemode)
       values ('sub_old', $1, 'cus_1', 'canceled', now(), false), ('sub_live', $1, 'cus_1', 'active', now(), false)`,
      [uid],
    );
    await db.query(
      `insert into billing_events (event_id, type, livemode, user_id) values ('evt_1', 'customer.subscription.updated', false, $1)`,
      [uid],
    );
    // A second device's session.
    const device2 = new Client(s.base);
    await device2.post('/api/auth/login', { email: 'leaving@example.com', password: 'correct horse battery' });

    // Someone who stays.
    const stay = new Client(s.base);
    await registerUser(stay, 'stays@example.com');
    const stayBook = await makeBook(stay, 'Still Here');
    await stay.upload(`/api/exports?manuscriptId=${stayBook}&format=epub&filename=stay.epub`, Buffer.from('PK stay'));
    const stayId = await userId(db, 'stays@example.com');
    assert.ok(existsSync(path.join(s.exportDir, uid)));

    assert.equal((await c.post('/api/account/delete', { currentPassword: 'correct horse battery', confirmPhrase: 'delete it' })).status, 400);
    assert.equal((await c.post('/api/account/delete', { currentPassword: 'nope nope nope', confirmPhrase: 'delete my account' })).status, 403);
    assert.ok((await db.query('select 1 from users where id = $1', [uid])).rows.length, 'nothing deleted by a refusal');

    const del = await c.post('/api/account/delete', { currentPassword: 'correct horse battery', confirmPhrase: '  Delete My Account ' });
    assert.equal(del.status, 200);
    assert.equal(del.body.subscriptionsLeftForOperator, 1);
    assert.equal(del.body.next, '/account/deleted?subscription=left');
    const removed = del.body.removed as Record<string, number>;
    assert.equal(removed.users, 1);
    assert.equal(removed.manuscripts, 1);
    assert.equal(removed.exports, 1);
    assert.equal(removed.share_comments, 1);
    assert.equal(removed.sessions, 2);

    // Every table that held this account's rows is empty of them.
    for (const table of ACCOUNT_DELETED_TABLES) {
      const col = table === 'shares' ? 'owner_id' : table === 'users' ? 'id' : 'user_id';
      const left = await db.query(`select 1 from ${table} where ${col} = $1`, [uid]);
      assert.equal(left.rows.length, 0, `${table} still holds rows`);
    }
    assert.equal((await db.query('select 1 from users where id = $1', [uid])).rows.length, 0);
    assert.equal((await db.query('select 1 from share_comments')).rows.length, 0);
    assert.equal((await db.query('select 1 from share_readers')).rows.length, 0);
    assert.ok(!existsSync(path.join(s.exportDir, uid)), 'export files removed from disk');
    // Billing: the live subscription stays, unattributed; the event keeps its id, no user.
    const subs = await db.query<{ stripe_subscription_id: string; user_id: string | null }>('select stripe_subscription_id, user_id from billing_subscriptions');
    assert.deepEqual(subs.rows, [{ stripe_subscription_id: 'sub_live', user_id: null }]);
    const ev = await db.query<{ user_id: string | null }>('select user_id from billing_events');
    assert.deepEqual(ev.rows, [{ user_id: null }]);

    // Signed out on every device; the address can't sign in.
    assert.equal((await c.get('/api/auth/me')).status, 401);
    assert.equal((await device2.get('/api/auth/me')).status, 401);
    assert.equal((await new Client(s.base).post('/api/auth/login', { email: 'leaving@example.com', password: 'correct horse battery' })).status, 401);

    // The one who stays keeps everything.
    assert.equal(((await stay.get('/api/manuscripts')).body.manuscripts as unknown[]).length, 1);
    assert.equal(((await stay.get('/api/exports')).body.exports as unknown[]).length, 1);
    assert.ok(existsSync(path.join(s.exportDir, stayId)));

    // The page after.
    const after = await fetch(`${s.base}/account/deleted?subscription=left`);
    const afterHtml = await after.text();
    assert.match(afterHtml, /Your account is deleted/);
    assert.match(afterHtml, /still running at Stripe/);
    assert.match(afterHtml, /shelf@example\.com/);
    assert.ok(!(await (await fetch(`${s.base}/account/deleted`)).text()).includes('Stripe'));
  } finally {
    await s.close();
  }
});

/* ------------------------------------------------------------------ */
/* Rate limits + owner scoping                                         */

test('rate limits: resend, email change, export, delete (per user) and the confirm page (per IP) answer 429 with Retry-After', async () => {
  const db = await createTestDb();
  const mailer = new RecordingMailer();
  const tight: PortalLimits = {
    resendPerUser: { max: 1, windowMs: 60_000 },
    emailPerUser: { max: 1, windowMs: 60_000 },
    exportPerUser: { max: 1, windowMs: 60_000 },
    deletePerUser: { max: 1, windowMs: 60_000 },
    confirmPerIp: { max: 1, windowMs: 60_000 },
  };
  const s = await start(db, { mailer, limits: tight });
  try {
    const c = new Client(s.base);
    await registerUser(c, 'limits@example.com');
    assert.equal((await c.post('/api/account/confirm/resend')).status, 200);
    const r1 = await c.post('/api/account/confirm/resend');
    assert.equal(r1.status, 429);
    assert.ok(Number(r1.headers.get('retry-after')) >= 1);

    await c.post('/api/account/email', { currentPassword: 'x', newEmail: 'a@example.com' });
    assert.equal((await c.post('/api/account/email', { currentPassword: 'x', newEmail: 'a@example.com' })).status, 429);

    assert.equal((await c.download('/api/account/export')).status, 200);
    const e2 = await c.download('/api/account/export');
    assert.equal(e2.status, 429);
    assert.ok(e2.headers.get('retry-after'));

    assert.equal((await c.post('/api/account/delete', { currentPassword: 'guess one', confirmPhrase: 'delete my account' })).status, 403);
    assert.equal((await c.post('/api/account/delete', { currentPassword: 'correct horse battery', confirmPhrase: 'delete my account' })).status, 429);
    assert.ok((await db.query(`select 1 from users where email = 'limits@example.com'`)).rows.length, 'still there');

    assert.equal((await postForm(s.base, '/account/confirm', { token: 'nope' })).status, 400);
    assert.equal((await postForm(s.base, '/account/confirm', { token: 'nope' })).status, 429);

    // Another user's buckets are their own.
    const d = new Client(s.base);
    await registerUser(d, 'other-limits@example.com');
    assert.equal((await d.post('/api/account/confirm/resend')).status, 200);
  } finally {
    await s.close();
  }
});

test('owner scoping: every /api/account route needs a session; one account never sees another\'s books, links or pending change', async () => {
  const db = await createTestDb();
  const mailer = new RecordingMailer();
  const s = await start(db, { mailer });
  try {
    const anon = new Client(s.base);
    for (const [m, p] of [
      ['GET', '/api/account/summary'],
      ['POST', '/api/account/confirm/resend'],
      ['POST', '/api/account/email'],
      ['POST', '/api/account/email/cancel'],
      ['POST', '/api/account/delete'],
    ] as const) {
      assert.equal((await anon.request(m, p, m === 'GET' ? undefined : {})).status, 401, `${m} ${p}`);
    }
    const a = new Client(s.base);
    await registerUser(a, 'a@example.com');
    await makeBook(a, 'Alpha Secret');
    await a.post('/api/account/email', { currentPassword: 'correct horse battery', newEmail: 'a-new@example.com' });
    const b = new Client(s.base);
    await registerUser(b, 'b@example.com');
    const { text } = await page(b, s.base, '/account');
    assert.ok(!text.includes('Alpha Secret'));
    assert.ok(!text.includes('a@example.com'));
    assert.equal((await b.get('/api/account/summary')).body.pendingEmail, null);
    // B cancelling does not cancel A's pending change.
    assert.equal((await b.post('/api/account/email/cancel')).body.cancelled, 0);
    assert.equal((await a.get('/api/account/summary')).body.pendingEmail, 'a-new@example.com');
    // B deleting B leaves A whole.
    await b.post('/api/account/delete', { currentPassword: 'correct horse battery', confirmPhrase: 'delete my account' });
    assert.equal(((await a.get('/api/manuscripts')).body.manuscripts as unknown[]).length, 1);
  } finally {
    await s.close();
  }
});

/* ------------------------------------------------------------------ */
/* Wiring: Caddy, workers, robots, studio strings                      */

const root = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => readFileSync(path.join(root, ...p), 'utf8');

test('wiring: Caddy sends /account* to the app; both workers leave it to the network; robots keeps it out of search', async () => {
  const caddy = read('Caddyfile');
  assert.ok(caddy.includes('handle /account* {\n\t\treverse_proxy app:3000\n\t}'));
  for (const p of [['client', 'sw.js'], ['client', 'assets', 'sw.js']]) {
    assert.match(read(...p), /\|sitemap\\\.xml\|account\)\(\\\/\|\$\)/, p.join('/'));
  }
  const db = await createTestDb();
  const s = await start(db);
  try {
    const robots = await (await fetch(`${s.base}/robots.txt`)).text();
    assert.ok(robots.includes('Disallow: /account\n'));
    const sitemap = await (await fetch(`${s.base}/sitemap.xml`)).text();
    assert.ok(!sitemap.includes('/account'));
  } finally {
    await s.close();
  }
});

test('studio: the shelf dialog links to /account, says "not confirmed" calmly, and every portal.* string ships in all 13 locales', () => {
  const html = read('client', 'index.html');
  assert.match(html, /<a href="\/account" target="_blank" rel="noopener" id="portalLink" data-i18n="portal.page">/);
  assert.match(html, /id="btnPortalResend"/);
  assert.match(html, /apiFetch\("\/api\/account\/summary"/);
  const enBlock = /Object\.assign\(UI_STRINGS\.en, \{ ("portal\.[^\n]*) \}\);/.exec(html);
  assert.ok(enBlock, 'English portal strings present');
  const keys = [...enBlock[1].matchAll(/"(portal\.[A-Za-z]+)":/g)].map((m) => m[1]);
  assert.equal(keys.length, 7);
  for (const k of keys) {
    const n = html.split(`"${k}":`).length - 1;
    assert.equal(n, 13, `${k} appears in ${n} locale packs, expected 13`);
  }
  for (const v of [...enBlock[1].matchAll(/: "([^"]*)"/g)].map((m) => m[1])) assert.ok(!v.includes('!'), `calm copy: ${v}`);
  // The bring-it offer: after a fresh sign-in too, never an empty desk or the untouched sample.
  assert.match(html, /portalFreshSignIn = true; \/\* BEUK:portal \*\/\n\s+cloudAfterSignIn\(\);/);
  assert.match(html, /const portalDeskHasWriting = !isEmptyDesk\(\) && !deskIsUntouchedSample\(\);/);
  assert.match(html, /!portalDeskHasWriting \|\| !\(cloud\.editedBeforeSignIn \|\| portalFresh\)/);
  // The account page's "Open in the studio" door.
  assert.match(html, /q\.delete\("signup"\); q\.delete\("signin"\); q\.delete\("book"\);/);
});

test('the default portal limits are proportionate (a few an hour for anything that sends mail or builds a ZIP)', () => {
  assert.ok(DEFAULT_PORTAL_LIMITS.resendPerUser.max <= 5);
  assert.ok(DEFAULT_PORTAL_LIMITS.emailPerUser.max <= 10);
  assert.ok(DEFAULT_PORTAL_LIMITS.exportPerUser.max <= 10);
});
