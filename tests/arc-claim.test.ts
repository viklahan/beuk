import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { NEVER_PAUSED } from '../src/access.js';
import { ARC_CLAIM_RULES, CODES_WINDOW_MS, DEFAULT_ARC_PUBLIC_LIMITS, purgeArcUnverified } from '../src/arc/claims.js';
import { ARC_SEND_LIMITS, arcMailTokenHash, suppress } from '../src/arc/mail.js';
import { ARC_EN } from '../src/arc/strings.js';
import type { Db } from '../src/db.js';
import { readZip } from '../src/housekeeping/packages.js';
import type { MailMessage, Mailer, MailerStatus, MailResult } from '../src/mailer.js';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';

/*
 * ARC slice 1, Task 6: the public, unlisted claim page and its 6-digit
 * email code. Campaigns are made through POST /api/arc; the fake ARC mailer
 * keeps every reader email (codes are read out of the code email's text);
 * the main fake mailer keeps the author's account mail; the clock is
 * injectable; the public limits are loosened except where a limit is under
 * test (the `tight` server runs the defaults).
 */

const SALT = 'salt-6-0123456789abcdef-0123456x'; // exactly 32 characters (ARC_SALT_MIN_LENGTH)
const ARC = { mailFrom: 'Beuk readers <readers@beuk.studio>', smtpUrl: 'smtp://u:p@127.0.0.1:9', suppressionSalt: SALT };
const ON = {
  stripeWebhookSecret: 'whsec_test_placeholder_not_a_real_key',
  stripeSecretKey: 'sk_test_placeholder_not_a_real_key',
  stripePriceId: 'price_fixture_one',
  stripeApiBase: 'http://127.0.0.1:9',
};
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const PASSWORD = 'correct horse battery';
const LOOSE = {
  claimPerIp: { max: 100_000, windowMs: HOUR },
  checkPerIp: { max: 100_000, windowMs: HOUR },
  codesPerAddress: { max: 100_000, windowMs: HOUR },
  downloadsPerReader: { max: 100_000, windowMs: HOUR },
};
/** Amazon's rule, with word boundaries (ruling F13b). */
const REVIEW_PRESSURE = /\b(exchange|in return|owed?|must review|required to review)\b/i;

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  /** The mail server refuses the next sends ("not delivered"). */
  refuse = false;
  /** The transport throws (a bug or a dead socket). */
  explode = false;
  status(): MailerStatus {
    return { configured: true, transport: 'smtp', from: 'fake', detail: 'fake mailer (test)' };
  }
  async send(message: MailMessage): Promise<MailResult> {
    if (this.explode) throw new Error('the test transport blew up');
    if (this.refuse) return { delivered: false, reason: 'the test mail server refused it', loggedToConsole: false };
    this.sent.push(message);
    return { delivered: true, messageId: '<arc-claim@example.com>' };
  }
  async verify() {
    return { ok: true, detail: 'fake mailer (test)' };
  }
  to(email: string, since = 0) {
    return this.sent.slice(since).filter((m) => m.to === email);
  }
}

const studioDoc = (meta: Record<string, unknown> = {}) => ({
  meta: { title: 'The Salt Road', author: 'Ada Moss', language: 'en', description: 'A tide story.\n\nIt ends at sea.', ...meta },
  sections: [
    { id: 'sec-copy', kind: 'front', type: 'copyright', title: 'Copyright', content: 'Copyright © Ada Moss.' },
    { id: 'sec-one', kind: 'body', type: 'chapter', number: 'One', title: 'First Light', content: 'It began with the tide.' },
  ],
});

let db: Db;
let arcOn: TestServer;
let arcOff: TestServer;
let tight: TestServer;
let paid: TestServer;
const arcMail = new FakeMailer();
const tightMail = new FakeMailer();
const paidMail = new FakeMailer();
const authorMail = new FakeMailer();
let clock = new Date();
let seq = 0;
let ipSeq = 0;

before(async () => {
  db = await createTestDb();
  const now = () => clock;
  arcOn = await startTestServer(db, now, { arc: ARC }, undefined, { arcMailer: arcMail, mailer: authorMail, arcLimits: LOOSE });
  arcOff = await startTestServer(db, now, undefined, undefined, { arcLimits: LOOSE });
  tight = await startTestServer(db, now, { arc: ARC }, undefined, { arcMailer: tightMail, mailer: new FakeMailer() });
  paid = await startTestServer(db, now, { ...ON, arc: ARC }, undefined, { arcMailer: paidMail, mailer: new FakeMailer(), arcLimits: LOOSE });
});

after(async () => {
  for (const s of [arcOn, arcOff, tight, paid]) await s.close();
});

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const count = async (sql: string, params: unknown[] = []) =>
  Number((await db.query<{ n: string }>(`select count(*)::text as n from ${sql}`, params)).rows[0].n);

async function writer(base: string) {
  const email = `arc-claim-${++seq}@example.com`;
  const c = new Client(base);
  assert.equal((await registerUser(c, email, PASSWORD)).status, 201);
  const id = (await db.query<{ id: string }>('select id from users where email = $1', [email])).rows[0]!.id;
  return { c, id, email };
}

type Campaign = { id: string; shareId: string; launchDate: string; counts: { claimed: number; pending: number; declined: number; revoked: number } };

/** A writer, a book and a running campaign on `base`. */
async function campaignOn(base: string, extra: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) {
  const w = await writer(base);
  const m = await w.c.post('/api/manuscripts', { doc: studioDoc(meta) });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  const mid = (m.body.manuscript as { id: string }).id;
  const closes = new Date(clock.getTime() + 30 * DAY);
  const r = await w.c.post('/api/arc', {
    manuscriptId: mid,
    launchDate: '2027-02-14',
    closesAt: closes.toISOString(),
    tz: 'Europe/London',
    ...extra,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { w, mid, campaign: r.body.campaign as Campaign, signup: r.body.signupToken as string };
}

const freshIp = () => `10.6.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

interface Answer {
  status: number;
  location: string | null;
  text: string;
  headers: Headers;
}

async function answer(r: globalThis.Response): Promise<Answer> {
  return { status: r.status, location: r.headers.get('location'), text: await r.text(), headers: r.headers };
}

async function get(base: string, p: string): Promise<Answer> {
  return answer(await fetch(`${base}${p}`, { redirect: 'manual' }));
}

async function postForm(base: string, p: string, fields: Record<string, string>, ip = freshIp()): Promise<Answer> {
  return answer(
    await fetch(`${base}${p}`, {
      method: 'POST',
      body: new URLSearchParams(fields),
      headers: { 'x-forwarded-for': ip },
      redirect: 'manual',
    }),
  );
}

const claim = (base: string, signup: string, fields: Record<string, string>, ip?: string) => postForm(base, `/arc/${signup}`, fields, ip);
const check = (base: string, signup: string, ref: string, code: string, ip?: string) => postForm(base, `/arc/${signup}/check`, { r: ref, code }, ip);

function refOf(a: Answer, signup: string): string {
  assert.equal(a.status, 303, a.text.slice(0, 400));
  const loc = new URL(a.location!, 'http://x');
  assert.equal(loc.pathname, `/arc/${signup}/check`);
  const r = loc.searchParams.get('r');
  assert.ok(r);
  return r;
}

/** The code from the newest code email to `email`. */
function codeFor(mailer: FakeMailer, email: string): string {
  const codes = mailer.to(email).filter((m) => m.subject.startsWith('Your code for'));
  assert.ok(codes.length, `a code email went to ${email}`);
  const m = /Your code is (\d{6})\./.exec(codes[codes.length - 1].text);
  assert.ok(m, 'the code email carries the code');
  return m[1];
}

/** Claim and confirm on `base`; returns the check's answer. */
async function claimAndCheck(base: string, mailer: FakeMailer, signup: string, name: string, email: string, extra: Record<string, string> = {}) {
  const ref = refOf(await claim(base, signup, { name, email, ...extra }), signup);
  return { ref, answer: await check(base, signup, ref, codeFor(mailer, email.trim().toLowerCase())) };
}

async function rowOfEmail(shareId: string, email: string) {
  return (
    await db.query<{ id: string; name: string; status: string; public_id: string | null; build_id: string | null; token_hash: string | null; profile_link: string | null; email_verified_at: unknown; tz: string | null }>(
      `select id, name, status, public_id, build_id, token_hash, profile_link, email_verified_at, tz from share_recipients where share_id = $1 and email = $2`,
      [shareId, email],
    )
  ).rows;
}

const counts = async (w: { c: Client }, mid: string) => {
  const r = await w.c.get(`/api/arc?manuscriptId=${mid}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return (r.body.campaign as Campaign).counts;
};

const copyToken = (a: Answer) => {
  assert.equal(a.status, 303, a.text.slice(0, 400));
  const m = /^\/arc\/r\/([A-Za-z0-9_-]{20,64})$/.exec(a.location ?? '');
  assert.ok(m, `redirected to the copy page: ${a.location}`);
  return m[1];
};

const hrefs = (html: string) => [...html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => m[1]);

/* ------------------------------------------------------------------ */

test('the claim page is unlisted, says who is giving the copy, and asks for no review', async () => {
  const { signup } = await campaignOn(arcOn.base);
  const a = await get(arcOn.base, `/arc/${signup}`);
  assert.equal(a.status, 200);
  assert.equal(a.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(a.headers.get('content-security-policy') ?? '', /^default-src 'none'/);
  assert.equal(a.headers.get('referrer-policy'), 'no-referrer');
  assert.match(a.text, /<meta name="robots" content="noindex, nofollow"/);
  assert.ok(a.text.includes('The Salt Road — an advance copy from Ada Moss'));
  const date = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date('2027-02-14T00:00:00Z'));
  assert.ok(a.text.includes(`Ada Moss is giving early copies to readers before ${date}.`), date);
  assert.ok(a.text.includes('If you&#39;d like to review it after reading'), 'the review line, escaped as HTML');
  assert.ok(a.text.includes(ARC_EN['arc.claim.submit']) && ARC_EN['arc.claim.submit'] === 'Get my copy');
  assert.ok(a.text.includes('Your copy will show your name and email on its copyright page.'));
  assert.ok(a.text.includes('<p>A tide story.</p>') && a.text.includes('<p>It ends at sea.</p>'), 'the blurb, as paragraphs');
  assert.doesNotMatch(a.text, /exchange/i);
  assert.doesNotMatch(a.text.replace(/<[^>]*>/g, ' '), REVIEW_PRESSURE);
  assert.ok(!a.text.includes('name="profile"'), 'instant mode asks for no profile link');
  // No Beuk marketing: the footer is Privacy and Terms, and nothing else links anywhere.
  assert.deepEqual(hrefs(a.text), ['/privacy', '/terms']);
  // The one script fills the hidden tz field, under the page's nonce.
  const nonce = /'nonce-([^']+)'/.exec(a.headers.get('content-security-policy') ?? '')?.[1];
  assert.ok(nonce && a.text.includes(`<script nonce="${nonce}">`) && a.text.includes('name="tz"'));

  const approval = await campaignOn(arcOn.base, { approvalMode: 'approval' });
  const b = await get(arcOn.base, `/arc/${approval.signup}`);
  assert.equal(b.status, 200);
  assert.ok(b.text.includes('name="profile"') && b.text.includes('A Goodreads or Amazon profile link'));
  assert.doesNotMatch(b.text.replace(/<[^>]*>/g, ' '), REVIEW_PRESSURE);
});

test('a book with no author is "the author"; the cover is served as a picture', async () => {
  const { campaign, signup } = await campaignOn(arcOn.base, {}, { author: '' });
  const a = await get(arcOn.base, `/arc/${signup}`);
  assert.ok(a.text.includes('The Salt Road — an advance copy from the author'));
  assert.ok(!a.text.includes('/cover"'), 'no cover, no picture');
  assert.equal((await get(arcOn.base, `/arc/${signup}/cover`)).status, 404);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  await db.query(`update arc_builds set cover = $2 where campaign_id = $1`, [campaign.id, JSON.stringify({ mediaType: 'image/png', data: png })]);
  const page = await get(arcOn.base, `/arc/${signup}`);
  assert.ok(page.text.includes(`src="/arc/${signup}/cover"`));
  const r = await fetch(`${arcOn.base}/arc/${signup}/cover`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('content-security-policy'), "default-src 'none'");
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), Buffer.from(png, 'base64'));
});

test('unknown, closed and ended signups answer calmly', async () => {
  const unknown = await get(arcOn.base, `/arc/${'x'.repeat(32)}`);
  assert.equal(unknown.status, 404);
  assert.ok(unknown.text.includes(ARC_EN['arc.page.unknownTitle'].replace("'", '&#39;')));
  assert.equal(unknown.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await get(arcOn.base, '/arc/short')).status, 404);

  const dated = await campaignOn(arcOn.base, { closesAt: new Date(clock.getTime() + HOUR).toISOString() });
  clock = new Date(clock.getTime() + 2 * HOUR);
  const past = await get(arcOn.base, `/arc/${dated.signup}`);
  assert.equal(past.status, 410);
  assert.ok(past.text.includes(ARC_EN['arc.claim.err.closed']));
  assert.equal((await claim(arcOn.base, dated.signup, { name: 'Sarah', email: 'sarah@example.com' })).status, 410);

  const owned = await campaignOn(arcOn.base);
  assert.equal((await owned.w.c.post(`/api/arc/${owned.campaign.id}/close`)).status, 200);
  const ended = await get(arcOn.base, `/arc/${owned.signup}`);
  assert.equal(ended.status, 410);
  assert.ok(ended.text.includes(ARC_EN['arc.claim.err.closed']));
});

test('a claim sends a code and does not use up a copy', async () => {
  const { w, mid, campaign, signup } = await campaignOn(arcOn.base);
  const before = arcMail.sent.length;
  const ref = refOf(await claim(arcOn.base, signup, { name: 'Sarah', email: '  Sarah@Example.COM ', tz: 'America/Chicago' }), signup);
  const sent = arcMail.sent.slice(before);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'sarah@example.com');
  assert.match(sent[0].subject, /^Your code for The Salt Road$/);
  const rows = await rowOfEmail(campaign.shareId, 'sarah@example.com');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'unverified');
  assert.equal(rows[0].email_verified_at, null);
  assert.equal(rows[0].token_hash, null, 'no copy link yet');
  assert.equal(rows[0].tz, 'America/Chicago');
  assert.deepEqual(await counts(w, mid), { claimed: 0, pending: 0, declined: 0, revoked: 0 });
  // Only hashes are kept: the code and the ref are nowhere in the row.
  const code = codeFor(arcMail, 'sarah@example.com');
  const stored = (await db.query<Record<string, unknown>>('select * from share_recipients where id = $1', [rows[0].id])).rows[0];
  assert.ok(!JSON.stringify(stored).includes(ref) && !JSON.stringify(stored).includes(`"${code}"`));
  assert.equal(stored.verify_code_hash, sha256(`${rows[0].id}:${code}`));
  assert.equal(stored.verify_ref_hash, sha256(ref));
  // The code page names where the code went.
  const page = await get(arcOn.base, `/arc/${signup}/check?r=${ref}`);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes('sarah@example.com') && page.text.includes(`It works for ${ARC_CLAIM_RULES.codeTtlMs / MIN} minutes.`));
  // A bad tz is dropped, not refused.
  refOf(await claim(arcOn.base, signup, { name: 'Tom', email: 'tom@example.com', tz: 'Not/AZone' }), signup);
  assert.equal((await rowOfEmail(campaign.shareId, 'tom@example.com'))[0].tz, null);
});

test('names, emails and profile links that could spoof or overflow are refused', async () => {
  const { campaign, signup } = await campaignOn(arcOn.base, { approvalMode: 'approval' });
  const profile = 'https://www.goodreads.com/user/show/1-sarah';
  const before = arcMail.sent.length;
  for (const [fields, why] of [
    [{ name: 'Sa‮rah', email: 'a@example.com', profile }, 'bad-name'],
    [{ name: 'Sarah⁦', email: 'a@example.com', profile }, 'bad-name'],
    [{ name: 'x'.repeat(61), email: 'a@example.com', profile }, 'bad-name'],
    [{ name: '', email: 'a@example.com', profile }, 'bad-name'],
    [{ name: 'Sarah', email: 'a‮@example.com', profile }, 'bad-email'],
    [{ name: 'Sarah', email: 'not-an-email', profile }, 'bad-email'],
    [{ name: 'Sarah', email: 'a@example.com' }, 'bad-profile'],
    [{ name: 'Sarah', email: 'a@example.com', profile: 'javascript:alert(1)' }, 'bad-profile'],
    [{ name: 'Sarah', email: 'a@example.com', profile: `https://example.com/${'x'.repeat(300)}` }, 'bad-profile'],
  ] as const) {
    const a = await claim(arcOn.base, signup, fields as Record<string, string>);
    assert.equal(a.status, 400, `${why}: ${JSON.stringify(fields).slice(0, 80)}`);
    const key = why === 'bad-name' ? 'arc.claim.err.badName' : why === 'bad-email' ? 'arc.claim.err.badEmail' : 'arc.claim.err.badProfile';
    assert.ok(a.text.includes(ARC_EN[key]), why);
  }
  assert.equal(arcMail.sent.length, before, 'nothing sent');
  assert.equal(await count(`share_recipients where share_id = $1`, [campaign.shareId]), 0, 'nothing stored');
});

test('a leaked link cannot use up the cap without verified emails', async () => {
  const { w, mid, signup } = await campaignOn(arcOn.base, { maxClaims: 2 });
  for (let i = 0; i < 20; i++) refOf(await claim(arcOn.base, signup, { name: `Bot ${i}`, email: `bot${i}@example.com` }), signup);
  assert.deepEqual(await counts(w, mid), { claimed: 0, pending: 0, declined: 0, revoked: 0 });
  // Three real readers ask; the first two confirm; the third's right code finds it full.
  const refs: string[] = [];
  for (const who of ['ana', 'ben', 'cy']) refs.push(refOf(await claim(arcOn.base, signup, { name: who, email: `${who}@example.com` }), signup));
  copyToken(await check(arcOn.base, signup, refs[0], codeFor(arcMail, 'ana@example.com')));
  copyToken(await check(arcOn.base, signup, refs[1], codeFor(arcMail, 'ben@example.com')));
  const third = await check(arcOn.base, signup, refs[2], codeFor(arcMail, 'cy@example.com'));
  assert.equal(third.status, 409);
  assert.ok(third.text.includes(ARC_EN['arc.claim.err.full']));
  assert.equal((await counts(w, mid)).claimed, 2);
  // A new claim once full is told so at once, and no code is sent.
  const before = arcMail.sent.length;
  const late = await claim(arcOn.base, signup, { name: 'Dee', email: 'dee@example.com' });
  assert.equal(late.status, 409);
  assert.ok(late.text.includes(ARC_EN['arc.claim.err.full']));
  assert.equal(arcMail.sent.length, before);
});

test('the right code claims the copy and lands on it', async () => {
  const { campaign, signup } = await campaignOn(arcOn.base);
  const since = arcMail.sent.length;
  const { ref, answer: a } = await claimAndCheck(arcOn.base, arcMail, signup, 'Sarah', 'sarah@example.com');
  const usedCode = codeFor(arcMail, 'sarah@example.com');
  const token = copyToken(a);
  const [row] = await rowOfEmail(campaign.shareId, 'sarah@example.com');
  assert.equal(row.status, 'claimed');
  assert.ok(row.public_id && row.build_id && row.email_verified_at);
  assert.equal(row.token_hash, sha256(token));
  const build = (await db.query<{ id: string }>('select id from arc_builds where campaign_id = $1', [campaign.id])).rows[0].id;
  assert.equal(row.build_id, build);
  const ready = arcMail.to('sarah@example.com', since).filter((m) => m.subject === 'Your advance copy of The Salt Road');
  assert.equal(ready.length, 1);
  assert.ok(ready[0].text.includes(`${arcOn.config.appBaseUrl}/arc/r/${token}`));
  // The copy reads in today's reader (ruling R4a: claimed ARC readers use /read/:token).
  assert.equal((await get(arcOn.base, `/read/${token}`)).status, 200);
  // The code is single-use: the same ref and code again find nothing.
  const again = await check(arcOn.base, signup, ref, usedCode);
  assert.equal(again.status, 404);
  assert.ok(again.text.includes(ARC_EN['arc.code.err.unknown']));
  assert.equal(arcMail.to('sarah@example.com', since).filter((m) => m.subject.startsWith('Your advance copy')).length, 1, 'no second copy');
});

test('five wrong codes end that code', async () => {
  const { campaign, signup } = await campaignOn(arcOn.base);
  const ref = refOf(await claim(arcOn.base, signup, { name: 'Sarah', email: 'sarah@example.com' }), signup);
  const right = codeFor(arcMail, 'sarah@example.com');
  const wrong = right === '000000' ? '111111' : '000000';
  for (let i = 0; i < ARC_CLAIM_RULES.codeAttempts; i++) {
    const a = await check(arcOn.base, signup, ref, wrong);
    assert.equal(a.status, 400);
    assert.ok(a.text.includes(ARC_EN['arc.code.err.wrong'].replace("'", '&#39;')));
  }
  const sixth = await check(arcOn.base, signup, ref, right);
  assert.equal(sixth.status, 410);
  assert.ok(sixth.text.includes(ARC_EN['arc.code.err.expired']));
  assert.equal((await rowOfEmail(campaign.shareId, 'sarah@example.com'))[0].status, 'unverified');
});

test('a code expires after 30 minutes', async () => {
  const { campaign, signup } = await campaignOn(arcOn.base);
  const ref = refOf(await claim(arcOn.base, signup, { name: 'Sarah', email: 'sarah@example.com' }), signup);
  const code = codeFor(arcMail, 'sarah@example.com');
  clock = new Date(clock.getTime() + 31 * MIN);
  const a = await check(arcOn.base, signup, ref, code);
  assert.equal(a.status, 410);
  assert.ok(a.text.includes(ARC_EN['arc.code.err.expired']));
  assert.equal((await rowOfEmail(campaign.shareId, 'sarah@example.com'))[0].status, 'unverified');
  // Asking again sends a fresh code that works.
  const fresh = await claimAndCheck(arcOn.base, arcMail, signup, 'Sarah', 'sarah@example.com');
  copyToken(fresh.answer);
});

test('the last copy goes to exactly one of two racing claims', async () => {
  // Ruling F8: the give is ONE conditional UPDATE (mintCopy); there is no
  // count-then-insert anywhere on this path for the race to slip through.
  const { campaign, signup } = await campaignOn(arcOn.base, { maxClaims: 1 });
  const a = refOf(await claim(arcOn.base, signup, { name: 'Ana', email: 'ana@example.com' }), signup);
  const b = refOf(await claim(arcOn.base, signup, { name: 'Ben', email: 'ben@example.com' }), signup);
  const [ca, cb] = [codeFor(arcMail, 'ana@example.com'), codeFor(arcMail, 'ben@example.com')];
  const answers = await Promise.all([check(arcOn.base, signup, a, ca), check(arcOn.base, signup, b, cb)]);
  const won = answers.filter((x) => x.status === 303 && /^\/arc\/r\//.test(x.location ?? ''));
  const full = answers.filter((x) => x.status === 409 && x.text.includes(ARC_EN['arc.claim.err.full']));
  assert.equal(won.length, 1, `one copy given: ${answers.map((x) => x.status).join(', ')}`);
  assert.equal(full.length, 1, 'the other is told every copy is claimed');
  assert.equal(await count(`share_recipients where share_id = $1 and status = 'claimed'`, [campaign.shareId]), 1);
});

test('the close date passing between claim and code refuses the code', async () => {
  // Sign-ups close 20 minutes from now; the code still has 10 of its 30 minutes left when it is entered.
  const { campaign, signup } = await campaignOn(arcOn.base, { closesAt: new Date(clock.getTime() + 20 * MIN).toISOString() });
  const ref = refOf(await claim(arcOn.base, signup, { name: 'Sarah', email: 'sarah@example.com' }), signup);
  const code = codeFor(arcMail, 'sarah@example.com');
  clock = new Date(clock.getTime() + 21 * MIN);
  const a = await check(arcOn.base, signup, ref, code);
  assert.equal(a.status, 410);
  assert.ok(a.text.includes(ARC_EN['arc.claim.err.closed']));
  assert.equal(await count(`share_recipients where share_id = $1 and status = 'claimed'`, [campaign.shareId]), 0);
});

test('the same address in another case is the same reader', async () => {
  const { campaign, signup } = await campaignOn(arcOn.base);
  const first = refOf(await claim(arcOn.base, signup, { name: 'Sarah', email: 'sarah@example.com' }), signup);
  const firstCode = codeFor(arcMail, 'sarah@example.com');
  const before = arcMail.to('sarah@example.com').length;
  const second = refOf(await claim(arcOn.base, signup, { name: 'Sally', email: 'SARAH@example.com' }), signup);
  assert.equal(arcMail.to('sarah@example.com').length, before + 1, 'a new code');
  const rows = await rowOfEmail(campaign.shareId, 'sarah@example.com');
  assert.equal(rows.length, 1, 'no second row');
  // Final fix wave (final review Important 1): an unverified row takes the name typed with its newest code.
  assert.equal(rows[0].name, 'Sally', 'the newest claim names the row while it is unverified');
  assert.equal(await count(`share_recipients where share_id = $1`, [campaign.shareId]), 1);
  // The newer code replaces the older one.
  assert.equal((await check(arcOn.base, signup, first, firstCode)).status, 404, 'the first ref is gone');
  copyToken(await check(arcOn.base, signup, second, codeFor(arcMail, 'sarah@example.com')));
});

/** The stamped copy's copyright page text, downloaded through the copy link. */
async function stampOf(base: string, token: string): Promise<string> {
  const r = await fetch(`${base}/arc/r/${token}/epub`);
  assert.equal(r.status, 200);
  const entries = readZip(Buffer.from(await r.arrayBuffer()));
  const page = entries.find((e) => e.name.endsWith('.xhtml') && e.data.toString('utf8').includes('Advance Review Copy prepared for'));
  assert.ok(page, 'a stamped page');
  return page.data.toString('utf8').replace(/<\/?bdi>/g, '');
}

// Final fix wave (final review Important 1): a stranger's earlier claim on an address
// must never name the copy its real owner confirms.
test('a second claim on an unverified address binds its own name: the code email, the stamp and the author all say it', async () => {
  const { w, campaign, signup } = await campaignOn(arcOn.base);
  const email = 'vera@example.com';
  const since = arcMail.sent.length;
  const first = refOf(await claim(arcOn.base, signup, { name: 'Mallory', email }), signup);
  const firstMail = arcMail.to(email, since).at(-1)!;
  assert.ok(firstMail.text.includes('This code is for Mallory.'), firstMail.text);
  assert.ok((firstMail.html ?? '').includes('This code is for <bdi>Mallory</bdi>.'));
  const second = refOf(await claim(arcOn.base, signup, { name: 'Vera', email }), signup);
  const secondMail = arcMail.to(email, since).at(-1)!;
  assert.ok(secondMail.text.includes('This code is for Vera.'), secondMail.text);
  assert.equal((await rowOfEmail(campaign.shareId, email))[0].name, 'Vera');
  assert.equal((await check(arcOn.base, signup, first, codeFor(arcMail, email))).status, 404, "the first claim's ref is gone");
  const token = copyToken(await check(arcOn.base, signup, second, codeFor(arcMail, email)));
  const stamp = await stampOf(arcOn.base, token);
  assert.ok(stamp.includes('Advance Review Copy prepared for Vera (vera@example.com)'), stamp);
  assert.ok(!stamp.includes('Mallory'));
  const readers = (await w.c.get(`/api/arc/${campaign.id}/readers`)).body.readers as Array<{ email: string; name: string }>;
  assert.equal(readers.find((r) => r.email === email)?.name, 'Vera', "the author's view");
  // A reader who holds a copy keeps their name: a later claim with another name changes nothing.
  const again = refOf(await claim(arcOn.base, signup, { name: 'Mallory', email }), signup);
  assert.ok(arcMail.to(email).at(-1)!.text.includes('This code is for Vera.'), 'the code names the copy holder');
  copyToken(await check(arcOn.base, signup, again, codeFor(arcMail, email)));
  assert.equal((await rowOfEmail(campaign.shareId, email))[0].name, 'Vera');
  assert.ok((await stampOf(arcOn.base, copyToken(await check(arcOn.base, signup, refOf(await claim(arcOn.base, signup, { name: 'X', email }), signup), codeFor(arcMail, email))))).includes('prepared for Vera ('));
});

// Ruling C6 (final fix wave): the code email carries its own code page, ref and all.
test("the code email links the code page, so the address's owner can use a code someone else asked for", async () => {
  const { campaign, signup } = await campaignOn(arcOn.base);
  const email = 'owner-of-address@example.com';
  const ref = refOf(await claim(arcOn.base, signup, { name: 'Ola', email }, '10.6.250.1'), signup);
  const mail = arcMail.to(email).at(-1)!;
  const link = `${arcOn.config.appBaseUrl}/arc/${signup}/check?r=${ref}`;
  assert.ok(mail.text.includes(`Or enter it on this page: ${link}`), mail.text);
  assert.ok((mail.html ?? '').includes(`href="${link}"`), 'a link in the HTML too');
  // The real owner, elsewhere, follows the link and enters the code.
  const page = await get(arcOn.base, new URL(link).pathname + new URL(link).search);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(email), 'the code page names the address');
  copyToken(await check(arcOn.base, signup, ref, codeFor(arcMail, email), '10.6.250.2'));
  assert.equal((await rowOfEmail(campaign.shareId, email))[0].status, 'claimed');
});

// Final review minor 1 (final fix wave): copies keep working after a close (F13), so a
// reader who holds one can still get its link back; nobody else can claim.
test('after sign-ups close, a reader who holds a copy gets a lost link back; no one else gets anything', async () => {
  for (const how of ['ended', 'past-close'] as const) {
    const { w, campaign, signup } = await campaignOn(arcOn.base, how === 'past-close' ? { closesAt: new Date(clock.getTime() + HOUR).toISOString() } : {});
    const old = copyToken((await claimAndCheck(arcOn.base, arcMail, signup, 'Sarah', 'sarah@example.com')).answer);
    copyToken((await claimAndCheck(arcOn.base, arcMail, signup, 'Tom', 'tom@example.com')).answer);
    const tom = (await rowOfEmail(campaign.shareId, 'tom@example.com'))[0];
    assert.equal((await w.c.post(`/api/arc/${campaign.id}/readers/${tom.id}/revoke`)).status, 200);
    if (how === 'ended') assert.equal((await w.c.post(`/api/arc/${campaign.id}/close`)).status, 200);
    else clock = new Date(clock.getTime() + 2 * HOUR);
    const closed = await get(arcOn.base, `/arc/${signup}`);
    assert.equal(closed.status, 410, how);
    assert.ok(closed.text.includes(ARC_EN['arc.claim.err.closed']));
    assert.ok(closed.text.includes(ARC_EN['arc.page.closedRecover']), `${how}: the lost-link form`);
    assert.ok(closed.text.includes(`<form method="post" action="/arc/${signup}"`));
    // The holder asks again: a code, the code page, a new link; the old one stops.
    const ref = refOf(await claim(arcOn.base, signup, { name: 'Sarah', email: 'sarah@example.com' }), signup);
    assert.equal((await get(arcOn.base, `/arc/${signup}/check?r=${ref}`)).status, 200, `${how}: the code page`);
    const fresh = copyToken(await check(arcOn.base, signup, ref, codeFor(arcMail, 'sarah@example.com')));
    assert.notEqual(fresh, old);
    assert.equal((await get(arcOn.base, `/read/${old}`)).status, 404, `${how}: the old link stops`);
    assert.equal((await get(arcOn.base, `/read/${fresh}`)).status, 200);
    // A stranger, and a reader whose copy was closed: the closed page, and no mail.
    for (const email of ['stranger@example.com', 'tom@example.com']) {
      const before = arcMail.to(email).length;
      const a = await claim(arcOn.base, signup, { name: 'Who', email });
      assert.equal(a.status, 410, `${how} ${email}`);
      assert.ok(a.text.includes(ARC_EN['arc.claim.err.closed']));
      assert.equal(arcMail.to(email).length, before, `${how} ${email}: nothing sent`);
    }
    assert.equal((await rowOfEmail(campaign.shareId, 'stranger@example.com')).length, 0, 'no row');
    // A bad request through the lost-link form is told on the closed page.
    const bad = await claim(arcOn.base, signup, { name: '', email: 'sarah@example.com' });
    assert.equal(bad.status, 410);
    assert.ok(bad.text.includes(ARC_EN['arc.claim.err.badName']));
    assert.equal(await count(`share_recipients where share_id = $1 and status = 'claimed'`, [campaign.shareId]), 2);
  }
});

test('a reader who lost the link claims again: a new link, the old one stops', async () => {
  const { campaign, signup } = await campaignOn(arcOn.base, { maxClaims: 1 });
  const since = arcMail.sent.length;
  const old = copyToken((await claimAndCheck(arcOn.base, arcMail, signup, 'Sarah', 'sarah@example.com')).answer);
  // At the cap, the reader who holds the copy still gets it back.
  const fresh = copyToken((await claimAndCheck(arcOn.base, arcMail, signup, 'Sarah', 'sarah@example.com')).answer);
  assert.notEqual(fresh, old);
  assert.equal((await get(arcOn.base, `/read/${old}`)).status, 404, 'the old link stops');
  assert.equal((await get(arcOn.base, `/read/${fresh}`)).status, 200);
  assert.equal(arcMail.to('sarah@example.com', since).filter((m) => m.subject.startsWith('Your advance copy')).length, 2);
  assert.equal(await count(`share_recipients where share_id = $1 and status = 'claimed'`, [campaign.shareId]), 1);
});

test('approval mode: verified readers wait, and the author hears once a day', async () => {
  const { w, mid, campaign, signup } = await campaignOn(arcOn.base, { approvalMode: 'approval' });
  const profile = 'https://www.goodreads.com/user/show/1-sarah';
  const toAuthor = () => authorMail.to(w.email).filter((m) => /waiting for your approval/.test(m.subject));
  const since = arcMail.sent.length;
  const a = (await claimAndCheck(arcOn.base, arcMail, signup, 'Sarah', 'sarah@example.com', { profile })).answer;
  assert.equal(a.status, 200);
  assert.ok(a.text.includes('Your request is with Ada Moss') && a.text.includes('Thank you, Sarah.'));
  const [row] = await rowOfEmail(campaign.shareId, 'sarah@example.com');
  assert.equal(row.status, 'pending');
  assert.equal(row.token_hash, null, 'no copy while waiting');
  assert.equal(row.profile_link, profile, 'stored as typed');
  assert.equal(arcMail.to('sarah@example.com', since).filter((m) => m.subject === 'Your request for The Salt Road is waiting for Ada Moss').length, 1);
  assert.equal(toAuthor().length, 1, 'the author hears');
  assert.match(toAuthor()[0].subject, /The Salt Road/);
  assert.deepEqual(await counts(w, mid), { claimed: 0, pending: 1, declined: 0, revoked: 0 });
  // A second waiting reader within 24 hours: still one author email.
  clock = new Date(clock.getTime() + HOUR);
  assert.equal((await claimAndCheck(arcOn.base, arcMail, signup, 'Tom', 'tom@example.com', { profile: 'https://www.amazon.com/gp/profile/x' })).answer.status, 200);
  assert.equal(toAuthor().length, 1);
  // A day later the next one is told again.
  clock = new Date(clock.getTime() + DAY);
  assert.equal((await claimAndCheck(arcOn.base, arcMail, signup, 'Priya', 'priya@example.com', { profile: 'https://www.goodreads.com/p' })).answer.status, 200);
  assert.equal(toAuthor().length, 2);
  assert.match(toAuthor()[1].text, /3 readers are waiting/);
  // Waiting readers count against the cap, like claimed ones.
  assert.equal((await counts(w, mid)).pending, 3);
});

// Final review ledger (final fix wave): "a reader is waiting" goes to the author at most once a
// day; author_notified_at is set first and put back when that account email does not go.
test('the author email that does not go puts author_notified_at back as it was', async () => {
  const { campaign, signup } = await campaignOn(arcOn.base, { approvalMode: 'approval' });
  const notified = async () =>
    (await db.query<{ t: Date | null }>('select author_notified_at as t from arc_campaigns where id = $1', [campaign.id])).rows[0].t;
  const profile = { profile: 'https://www.goodreads.com/user/show/9' };
  assert.equal(await notified(), null);
  authorMail.refuse = true;
  try {
    assert.equal((await claimAndCheck(arcOn.base, arcMail, signup, 'Ann', 'ann.w@example.com', profile)).answer.status, 200);
    assert.equal(await notified(), null, 'refused: back to never');
    // An earlier time (over a day ago) is what it goes back to.
    const earlier = new Date(clock.getTime() - 2 * DAY);
    await db.query('update arc_campaigns set author_notified_at = $2 where id = $1', [campaign.id, earlier.toISOString()]);
    assert.equal((await claimAndCheck(arcOn.base, arcMail, signup, 'Ben', 'ben.w@example.com', profile)).answer.status, 200);
    assert.equal(new Date((await notified())!).toISOString(), earlier.toISOString(), 'refused: back to the earlier time');
    authorMail.refuse = false;
    authorMail.explode = true;
    assert.equal((await claimAndCheck(arcOn.base, arcMail, signup, 'Cy', 'cy.w@example.com', profile)).answer.status, 200);
    assert.equal(new Date((await notified())!).toISOString(), earlier.toISOString(), 'thrown: back to the earlier time');
  } finally {
    authorMail.refuse = false;
    authorMail.explode = false;
  }
  assert.equal((await claimAndCheck(arcOn.base, arcMail, signup, 'Di', 'di.w@example.com', profile)).answer.status, 200);
  assert.equal(new Date((await notified())!).toISOString(), clock.toISOString(), 'delivered: set to now');
});

test('a profile link is shown to the author as typed and never fetched', async () => {
  let hits = 0;
  const trap: Server = createServer((_req, res) => {
    hits++;
    res.end('no');
  });
  await new Promise<void>((resolve) => trap.listen(0, '127.0.0.1', () => resolve()));
  try {
    const port = (trap.address() as { port: number }).port;
    const link = `http://127.0.0.1:${port}/user/Sarah?x=1&y=2`;
    const { w, campaign, signup } = await campaignOn(arcOn.base, { approvalMode: 'approval' });
    assert.equal((await claimAndCheck(arcOn.base, arcMail, signup, 'Sarah', 'sarah@example.com', { profile: `  ${link}  ` })).answer.status, 200);
    const r = await w.c.get(`/api/arc/${campaign.id}/readers`);
    const readers = r.body.readers as { profileLink: string | null }[];
    assert.equal(readers.length, 1);
    assert.equal(readers[0].profileLink, link, 'the text the reader typed');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(hits, 0, 'Beuk never opened the link');
  } finally {
    await new Promise<void>((resolve) => trap.close(() => resolve()));
  }
});

test('a suppressed address is told plainly and gets nothing', async () => {
  const { w, campaign, signup } = await campaignOn(arcOn.base);
  await suppress(db, arcOn.config, 'gone@example.com', 'all');
  const before = arcMail.sent.length;
  const a = await claim(arcOn.base, signup, { name: 'Gone', email: '  Gone@Example.com' });
  assert.equal(a.status, 409);
  assert.ok(a.text.includes('Beuk can&#39;t email this address'));
  assert.equal(arcMail.sent.length, before, '0 sent');
  assert.equal(await count(`share_recipients where share_id = $1`, [campaign.shareId]), 0, 'no row');
  // "Stop" for this author is refused the same way.
  await suppress(db, arcOn.config, 'stopped@example.com', { ownerId: w.id });
  const b = await claim(arcOn.base, signup, { name: 'Stopped', email: 'stopped@example.com' });
  assert.equal(b.status, 409);
  assert.ok(b.text.includes('Beuk can&#39;t email this address'));
  assert.equal(arcMail.sent.length, before);
});

test('a declined address is told the author has answered; a closed copy is never reopened', async () => {
  const ap = await campaignOn(arcOn.base, { approvalMode: 'approval' });
  assert.equal((await claimAndCheck(arcOn.base, arcMail, ap.signup, 'Sarah', 'sarah@example.com', { profile: 'https://www.goodreads.com/s' })).answer.status, 200);
  const sarah = (await rowOfEmail(ap.campaign.shareId, 'sarah@example.com'))[0];
  assert.equal((await ap.w.c.post(`/api/arc/${ap.campaign.id}/readers/${sarah.id}/decline`)).status, 200);
  let before = arcMail.to('sarah@example.com').length;
  const a = await claim(arcOn.base, ap.signup, { name: 'Sarah', email: 'sarah@example.com', profile: 'https://www.goodreads.com/s' });
  assert.equal(a.status, 409);
  assert.ok(a.text.includes('Ada Moss has already answered a request from this address.'));
  assert.equal(arcMail.to('sarah@example.com').length, before, 'no mail');

  // Ruling F9: a reader whose copy the author closed claims again → refused, no mail,
  // in the SAME words as a decline (fix round 1: the page reveals nothing more).
  const inst = await campaignOn(arcOn.base);
  copyToken((await claimAndCheck(arcOn.base, arcMail, inst.signup, 'Tom', 'tom@example.com')).answer);
  const tom = (await rowOfEmail(inst.campaign.shareId, 'tom@example.com'))[0];
  assert.equal((await inst.w.c.post(`/api/arc/${inst.campaign.id}/readers/${tom.id}/revoke`)).status, 200);
  before = arcMail.to('tom@example.com').length;
  const b = await claim(arcOn.base, inst.signup, { name: 'Tom', email: 'tom@example.com' });
  assert.equal(b.status, 409);
  assert.ok(b.text.includes('Ada Moss has already answered a request from this address.'));
  assert.ok(!/closed the copy/i.test(b.text));
  const errBox = (html: string) => /<p class="err" role="alert">([^<]*)<\/p>/.exec(html)?.[1];
  assert.equal(errBox(b.text), errBox(a.text), 'a closed copy and a decline read the same');
  assert.equal(arcMail.to('tom@example.com').length, before, 'no mail');
  const after = (await db.query<{ revoked_at: unknown; status: string }>('select revoked_at, status from share_recipients where id = $1', [tom.id])).rows[0];
  assert.ok(after.revoked_at, 'revoked_at is never cleared');
});

test('ARC mail switched off mid-campaign: no claim is taken', async () => {
  const { campaign, signup } = await campaignOn(arcOn.base);
  const a = await claim(arcOff.base, signup, { name: 'Sarah', email: 'sarah@example.com' });
  assert.equal(a.status, 503);
  assert.ok(a.text.includes(ARC_EN['arc.claim.err.mailOff'].replace("'", '&#39;')));
  assert.equal(await count(`share_recipients where share_id = $1`, [campaign.shareId]), 0, 'no row');
});

test('limits: per IP and per address', async () => {
  assert.deepEqual(DEFAULT_ARC_PUBLIC_LIMITS, {
    claimPerIp: { max: 10, windowMs: 10 * MIN },
    checkPerIp: { max: 30, windowMs: 10 * MIN },
    codesPerAddress: { max: 3, windowMs: HOUR },
    downloadsPerReader: { max: 10, windowMs: HOUR },
  });
  const { signup } = await campaignOn(tight.base);
  const ip = '10.66.0.1';
  for (let i = 0; i < 10; i++) refOf(await claim(tight.base, signup, { name: `R${i}`, email: `r${i}@example.com` }, ip), signup);
  const before = tightMail.sent.length;
  const eleventh = await claim(tight.base, signup, { name: 'R10', email: 'r10@example.com' }, ip);
  assert.equal(eleventh.status, 429);
  assert.ok(eleventh.text.includes(ARC_EN['arc.claim.err.busy']));
  assert.equal(tightMail.sent.length, before, 'nothing sent');
  // Per address: three codes an hour, from anywhere.
  for (let i = 0; i < 3; i++) refOf(await claim(tight.base, signup, { name: 'Sarah', email: 'sarah@example.com' }, `10.67.0.${i + 1}`), signup);
  const sent = tightMail.to('sarah@example.com').length;
  assert.equal(sent, 3);
  const fourth = await claim(tight.base, signup, { name: 'Sarah', email: 'SARAH@example.com' }, '10.67.0.9');
  assert.equal(fourth.status, 429);
  assert.equal(tightMail.to('sarah@example.com').length, 3, 'nothing sent');
  // Checking codes from one IP: 30 in 10 minutes.
  const ref = refOf(await claim(tight.base, signup, { name: 'Ann', email: 'ann@example.com' }, '10.68.0.1'), signup);
  for (let i = 0; i < 30; i++) await check(tight.base, signup, 'y'.repeat(32), '123456', '10.68.0.2');
  const blocked = await check(tight.base, signup, ref, codeFor(tightMail, 'ann@example.com'), '10.68.0.2');
  assert.equal(blocked.status, 429);
  copyToken(await check(tight.base, signup, ref, codeFor(tightMail, 'ann@example.com'), '10.68.0.3'));
});

test('codes per request count in a 24-hour window: a stranger cannot lock a reader out of their link for good', async () => {
  // Fix round 1: codes_sent starts again once the row's last delivered code is older than CODES_WINDOW_MS.
  assert.equal(CODES_WINDOW_MS, DAY);
  const { campaign, signup } = await campaignOn(arcOn.base);
  const email = 'locked-out@example.com';
  copyToken((await claimAndCheck(arcOn.base, arcMail, signup, 'Lee', email)).answer);
  // Someone else, who knows the address, asks for codes until the request limit.
  for (let i = 0; i < ARC_CLAIM_RULES.codesPerRow; i++) refOf(await claim(arcOn.base, signup, { name: 'Lee', email }), signup);
  const before = arcMail.to(email).length;
  const refused = await claim(arcOn.base, signup, { name: 'Lee', email });
  assert.equal(refused.status, 429, 'the reader\'s own limit');
  assert.ok(refused.text.includes(ARC_EN['arc.claim.err.busy']));
  clock = new Date(clock.getTime() + DAY - HOUR);
  assert.equal((await claim(arcOn.base, signup, { name: 'Lee', email })).status, 429, 'still inside the window');
  assert.equal(arcMail.to(email).length, before, 'nothing sent while refused');
  // Past the window the reader recovers their link.
  clock = new Date(clock.getTime() + 2 * HOUR);
  const back = await claimAndCheck(arcOn.base, arcMail, signup, 'Lee', email);
  const token = copyToken(back.answer);
  assert.equal((await get(arcOn.base, `/read/${token}`)).status, 200);
  assert.equal(await count(`share_recipients where share_id = $1 and status = 'claimed'`, [campaign.shareId]), 1);
});

test('a code email that does not go for reasons not the reader\'s is told honestly, not as too many tries', async () => {
  const { campaign, signup } = await campaignOn(arcOn.base);
  const failed = ARC_EN['arc.claim.err.mailFailed'].replace("'", '&#39;');
  const tooMany = ARC_EN['arc.claim.err.busy'];
  const expectFailed = async (email: string, why: string) => {
    const before = arcMail.sent.length;
    const a = await claim(arcOn.base, signup, { name: 'Sam', email });
    assert.equal(a.status, 503, why);
    assert.ok(a.text.includes(failed), why);
    assert.ok(!a.text.includes(tooMany), why);
    assert.equal(arcMail.sent.length, before, `${why}: nothing sent`);
    const [row] = await rowOfEmail(campaign.shareId, email);
    const code = (await db.query<{ verify_code_hash: string | null; codes_sent: number }>('select verify_code_hash, codes_sent from share_recipients where id = $1', [row.id])).rows[0];
    assert.equal(code.verify_code_hash, null, `${why}: the code is cleared`);
    assert.equal(code.codes_sent, 0, `${why}: an undelivered code is not counted`);
  };
  arcMail.refuse = true;
  try {
    await expectFailed('refused@example.com', 'the mail server refused it');
  } finally {
    arcMail.refuse = false;
  }
  arcMail.explode = true;
  try {
    await expectFailed('thrown@example.com', 'the transport threw');
  } finally {
    arcMail.explode = false;
  }
  // The campaign's hourly send limit (ARC_SEND_LIMITS.perCampaignHour, counted from arc_events).
  await db.query(
    `insert into arc_events (campaign_id, kind, at) select $1, 'code_sent', $2 from generate_series(1, $3::int)`,
    [campaign.id, clock.toISOString(), ARC_SEND_LIMITS.perCampaignHour],
  );
  await expectFailed('limited@example.com', "the campaign's send limit");
  await db.query(`delete from arc_events where campaign_id = $1 and recipient_id is null and kind = 'code_sent'`, [campaign.id]);
  refOf(await claim(arcOn.base, signup, { name: 'Sam', email: 'refused@example.com' }), signup);
});

test('a campaign full of unconfirmed requests says sign-ups are busy, not too many tries', async () => {
  const { campaign, signup } = await campaignOn(arcOn.base);
  const early = 'early@example.com';
  refOf(await claim(arcOn.base, signup, { name: 'Early', email: early }), signup);
  await db.query(
    `insert into share_recipients (id, share_id, role, name, email, status, mail_token_hash, created_at)
     select x.id, $1, 'arc', 'Bot', 'bot-' || x.n || '@example.com', 'unverified', md5(x.id::text), $2
     from (select gen_random_uuid() as id, n from generate_series(1, $3::int) n) x`,
    [campaign.shareId, clock.toISOString(), ARC_CLAIM_RULES.unverifiedPerCampaign - 1],
  );
  const before = arcMail.sent.length;
  const a = await claim(arcOn.base, signup, { name: 'Late', email: 'late@example.com' });
  assert.equal(a.status, 503);
  assert.ok(a.text.includes(ARC_EN['arc.claim.err.signupsBusy']));
  assert.ok(!a.text.includes(ARC_EN['arc.claim.err.busy']));
  assert.equal(arcMail.sent.length, before, 'nothing sent');
  assert.equal((await rowOfEmail(campaign.shareId, 'late@example.com')).length, 0, 'no row');
  // A reader already asking can still get a new code.
  refOf(await claim(arcOn.base, signup, { name: 'Early', email: early }), signup);
});

test('the honeypot looks fine and stores nothing', async () => {
  const { campaign, signup } = await campaignOn(arcOn.base);
  const before = arcMail.sent.length;
  const a = await claim(arcOn.base, signup, { name: 'Bot', email: 'bot@example.com', website: 'https://spam.example' });
  const ref = refOf(a, signup);
  const page = await get(arcOn.base, `/arc/${signup}/check?r=${ref}`);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(ARC_EN['arc.code.title']));
  assert.equal(arcMail.sent.length, before, 'nothing sent');
  assert.equal(await count(`share_recipients where share_id = $1`, [campaign.shareId]), 0, 'nothing stored');
  assert.equal(await count(`share_recipients where verify_ref_hash = $1`, [sha256(ref)]), 0, 'the ref matches no row');
});

test('a hostile name, email, title or author is escaped on every page', async () => {
  // Ruling F13c: the claim page (a refused claim keeps the typed values),
  // the code page, the waiting page, the closed page. The copy page is
  // Task 7's (arc-reader.test.ts).
  const evil = '<script>x</script>';
  const evilEmail = '"<b>x</b>"@example.com';
  const { w, campaign, signup } = await campaignOn(arcOn.base, { approvalMode: 'approval' }, { title: '<i>Salt</i> & "Road"', author: '<b>Ada</b>' });
  const clean = (html: string) => {
    assert.ok(!html.includes('<script>x') && !html.includes('<b>') && !html.includes('<i>Salt'), html.slice(0, 600));
  };
  const claimPage = await get(arcOn.base, `/arc/${signup}`);
  clean(claimPage.text);
  assert.ok(claimPage.text.includes('&lt;i&gt;Salt&lt;/i&gt; &amp; &quot;Road&quot; — an advance copy from &lt;b&gt;Ada&lt;/b&gt;'));
  const refused = await claim(arcOn.base, signup, { name: evil, email: evilEmail }); // no profile → refused, values kept
  assert.equal(refused.status, 400);
  clean(refused.text);
  assert.ok(refused.text.includes('value="&lt;script&gt;x&lt;/script&gt;"') && refused.text.includes('value="&quot;&lt;b&gt;x&lt;/b&gt;&quot;@example.com"'));
  const ref = refOf(await claim(arcOn.base, signup, { name: evil, email: evilEmail, profile: 'https://www.goodreads.com/e' }), signup);
  const codePage = await get(arcOn.base, `/arc/${signup}/check?r=${ref}`);
  clean(codePage.text);
  assert.ok(codePage.text.includes('&quot;&lt;b&gt;x&lt;/b&gt;&quot;@example.com'));
  const wrong = await check(arcOn.base, signup, ref, '99999x');
  clean(wrong.text);
  const waiting = await check(arcOn.base, signup, ref, codeFor(arcMail, evilEmail));
  assert.equal(waiting.status, 200);
  clean(waiting.text);
  assert.ok(waiting.text.includes('&lt;script&gt;'));
  assert.equal((await w.c.post(`/api/arc/${campaign.id}/close`)).status, 200);
  const closed = await get(arcOn.base, `/arc/${signup}`);
  assert.equal(closed.status, 410);
  clean(closed.text);
});

test('unverified claims older than 24 hours are purged, nothing else', async () => {
  const { campaign, signup } = await campaignOn(arcOn.base);
  const at = (ms: number) => new Date(clock.getTime() - ms).toISOString();
  const add = async (email: string, status: string, createdMs: number) => {
    const id = randomUUID();
    await db.query(
      `insert into share_recipients (id, share_id, role, name, email, status, mail_token_hash, created_at)
       values ($1, $2, 'arc', $3, $4, $5, $6, $7)`,
      [id, campaign.shareId, email, email, status, arcMailTokenHash(arcOn.config, id), at(createdMs)],
    );
    return id;
  };
  const old = await add('old@example.com', 'unverified', DAY + MIN);
  await add('young@example.com', 'unverified', DAY - MIN);
  // Final fix wave (final review minor 2): an old row asked again lately keeps its live code;
  // one whose newest code ran out more than 24 hours ago goes.
  const asked = await add('asked@example.com', 'unverified', 3 * DAY);
  await db.query('update share_recipients set verify_expires_at = $2 where id = $1', [asked, new Date(clock.getTime() + 20 * MIN).toISOString()]);
  const stale = await add('stale@example.com', 'unverified', 3 * DAY);
  await db.query('update share_recipients set verify_expires_at = $2 where id = $1', [stale, at(DAY + MIN)]);
  await add('wait@example.com', 'pending', 3 * DAY);
  await add('held@example.com', 'declined', 3 * DAY);
  copyToken((await claimAndCheck(arcOn.base, arcMail, signup, 'Sarah', 'sarah@example.com')).answer);
  await db.query(`update share_recipients set created_at = $2 where share_id = $1 and email = 'sarah@example.com'`, [campaign.shareId, at(3 * DAY)]);
  const beta = await count(`share_recipients where role = 'beta'`);
  const n = await purgeArcUnverified(db, clock);
  assert.ok(n >= 1);
  assert.equal(await count(`share_recipients where id = $1`, [old]), 0, 'the old unverified claim is gone');
  assert.equal(await count(`share_recipients where id = $1`, [stale]), 0, 'its newest code ran out over 24 hours ago');
  assert.deepEqual(
    (await db.query<{ email: string }>(`select email from share_recipients where share_id = $1 order by email`, [campaign.shareId])).rows.map((r) => r.email),
    ['asked@example.com', 'held@example.com', 'sarah@example.com', 'wait@example.com', 'young@example.com'],
  );
  assert.equal(await count(`share_recipients where role = 'beta'`), beta);
  assert.equal(
    await count(`share_recipients where role = 'arc' and status = 'unverified' and greatest(created_at, verify_expires_at) < $1`, [at(DAY)]),
    0,
  );
});

test("a paused author's campaign keeps taking claims", async () => {
  const w = await writer(paid.base);
  await db.query('update users set trial_ends_at = $2 where id = $1', [w.id, new Date(clock.getTime() + 7 * DAY)]);
  const m = await w.c.post('/api/manuscripts', { doc: studioDoc() });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  const mid = (m.body.manuscript as { id: string }).id;
  const r = await w.c.post('/api/arc', { manuscriptId: mid, launchDate: '2027-02-14', closesAt: new Date(clock.getTime() + 30 * DAY).toISOString(), tz: 'Europe/London' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const signup = r.body.signupToken as string;
  await db.query('update users set trial_ends_at = $2 where id = $1', [w.id, new Date(clock.getTime() - DAY)]);
  assert.equal((await w.c.post('/api/manuscripts', { doc: studioDoc() })).status, 402, 'the account is paused');
  assert.equal((await get(paid.base, `/arc/${signup}`)).status, 200);
  copyToken((await claimAndCheck(paid.base, paidMail, signup, 'Sarah', 'sarah@example.com')).answer);
  for (const [method, p] of [['GET', '/arc/:signup'], ['POST', '/arc/:signup'], ['GET', '/arc/:signup/check'], ['POST', '/arc/:signup/check'], ['GET', '/arc/:signup/cover']]) {
    assert.ok(NEVER_PAUSED.some((x) => x.method === method && x.path === p), `${method} ${p} is in NEVER_PAUSED`);
  }
});

test('Caddy proxies /arc to the app', () => {
  const caddy = readFileSync('Caddyfile', 'utf8');
  assert.match(caddy, /@arc path \/arc \/arc\/\*\s+handle @arc \{\s*reverse_proxy app:3000/);
  // Ruling F19: the comment sits above the matcher line.
  assert.match(caddy, /#[^\n]*\n\t@arc path \/arc \/arc\/\*/);
});
