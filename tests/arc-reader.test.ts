import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { NEVER_PAUSED } from '../src/access.js';
import { suppressionHash } from '../src/arc/mail.js';
import { ARC_EN, arcT } from '../src/arc/strings.js';
import { BuildQueue } from '../src/book/studio/queue.js';
import type { Db } from '../src/db.js';
import { escapeHtml } from '../src/email/layout.js';
import { readZip, type ZipEntry } from '../src/housekeeping/packages.js';
import type { MailMessage, Mailer, MailerStatus, MailResult } from '../src/mailer.js';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';

/*
 * ARC slice 1, Task 7: each claimed reader's copy page (/arc/r/:token),
 * the stamped EPUB download (/arc/r/:token/epub: stamped per download,
 * never stored; one at a time per reader, 10 an hour), and the mail
 * links' Not me and Stop (/arc/m/:mailToken/:action): a GET is a page
 * with one POST button and changes nothing; the POST acts; a body
 * 'List-Unsubscribe=One-Click' (RFC 8058, urlencoded or multipart) is the
 * button. Readers are made through the claim flow of Task 6; the mail
 * token is read out of the reader's own email.
 */

const SALT = 'salt-7-0123456789abcdef-0123456x'; // exactly 32 characters (ARC_SALT_MIN_LENGTH)
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
/** The claim limits loosened; the download limit stays the default (10 an hour). */
const LOOSE = {
  claimPerIp: { max: 100_000, windowMs: HOUR },
  checkPerIp: { max: 100_000, windowMs: HOUR },
  codesPerAddress: { max: 100_000, windowMs: HOUR },
};
const STAMP_LINE = 'Advance Review Copy prepared for';

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  status(): MailerStatus {
    return { configured: true, transport: 'smtp', from: 'fake', detail: 'fake mailer (test)' };
  }
  async send(message: MailMessage): Promise<MailResult> {
    this.sent.push(message);
    return { delivered: true, messageId: '<arc-reader@example.com>' };
  }
  async verify() {
    return { ok: true, detail: 'fake mailer (test)' };
  }
  to(email: string, since = 0) {
    return this.sent.slice(since).filter((m) => m.to === email);
  }
}

const studioDoc = (meta: Record<string, unknown> = {}) => ({
  meta: { title: 'The Salt Road', author: 'Ada Moss', language: 'en', description: 'A tide story.', ...meta },
  sections: [
    { id: 'sec-copy', kind: 'front', type: 'copyright', title: 'Copyright', content: 'Copyright © Ada Moss.' },
    { id: 'sec-one', kind: 'body', type: 'chapter', number: 'One', title: 'First Light', content: 'It began with the tide.' },
  ],
});

let db: Db;
let arcOn: TestServer;
let arcOff: TestServer;
let paid: TestServer;
const arcMail = new FakeMailer();
const paidMail = new FakeMailer();
const downloads = new BuildQueue(2, 8);
let clock = new Date();
let seq = 0;
let ipSeq = 0;

before(async () => {
  db = await createTestDb();
  const now = () => clock;
  arcOn = await startTestServer(db, now, { arc: ARC }, undefined, { arcMailer: arcMail, mailer: new FakeMailer(), arcLimits: LOOSE, arcDownloads: downloads });
  arcOff = await startTestServer(db, now, undefined, undefined, { arcLimits: LOOSE });
  paid = await startTestServer(db, now, { ...ON, arc: ARC }, undefined, { arcMailer: paidMail, mailer: new FakeMailer(), arcLimits: LOOSE });
});

after(async () => {
  for (const s of [arcOn, arcOff, paid]) await s.close();
});

const count = async (sql: string, params: unknown[] = []) =>
  Number((await db.query<{ n: string }>(`select count(*)::text as n from ${sql}`, params)).rows[0].n);

async function writer(base: string) {
  const email = `arc-reader-${++seq}@example.com`;
  const c = new Client(base);
  assert.equal((await registerUser(c, email, PASSWORD)).status, 201);
  const id = (await db.query<{ id: string }>('select id from users where email = $1', [email])).rows[0]!.id;
  return { c, id, email };
}

type Campaign = { id: string; shareId: string };
type Writer = Awaited<ReturnType<typeof writer>>;

/** A book and a running campaign for `w` on `base`. */
async function campaignFor(w: Writer, meta: Record<string, unknown> = {}) {
  const m = await w.c.post('/api/manuscripts', { doc: studioDoc(meta) });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  const mid = (m.body.manuscript as { id: string }).id;
  const r = await w.c.post('/api/arc', {
    manuscriptId: mid,
    launchDate: '2027-02-14',
    closesAt: new Date(clock.getTime() + 30 * DAY).toISOString(),
    tz: 'Europe/London',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { mid, campaign: r.body.campaign as Campaign, signup: r.body.signupToken as string };
}

async function campaignOn(base: string, meta: Record<string, unknown> = {}) {
  const w = await writer(base);
  return { w, ...(await campaignFor(w, meta)) };
}

const freshIp = () => `10.7.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

interface Answer {
  status: number;
  location: string | null;
  text: string;
  headers: Headers;
}

async function answer(r: globalThis.Response): Promise<Answer> {
  return { status: r.status, location: r.headers.get('location'), text: await r.text(), headers: r.headers };
}

const get = async (base: string, p: string): Promise<Answer> => answer(await fetch(`${base}${p}`, { redirect: 'manual' }));

async function postForm(base: string, p: string, fields: Record<string, string>): Promise<Answer> {
  return answer(
    await fetch(`${base}${p}`, { method: 'POST', body: new URLSearchParams(fields), headers: { 'x-forwarded-for': freshIp() }, redirect: 'manual' }),
  );
}

/** The newest email to `email` whose subject starts with `subject`. */
function mailTo(mailer: FakeMailer, email: string, subject: string): MailMessage {
  const all = mailer.to(email).filter((m) => m.subject.startsWith(subject));
  assert.ok(all.length, `an email "${subject}…" went to ${email}`);
  return all[all.length - 1];
}

interface Reader {
  token: string;
  mailToken: string;
  id: string;
  email: string;
}

/** Claim and confirm `email` on the campaign; returns the copy token (from
 *  the redirect), the mail token (from the "ready" email) and the row id. */
async function claimed(base: string, mailer: FakeMailer, signup: string, shareId: string, name: string, email: string): Promise<Reader> {
  const a = await postForm(base, `/arc/${signup}`, { name, email });
  assert.equal(a.status, 303, a.text.slice(0, 400));
  const ref = new URL(a.location!, 'http://x').searchParams.get('r')!;
  const code = /Your code is (\d{6})\./.exec(mailTo(mailer, email, 'Your code for').text)![1];
  const b = await postForm(base, `/arc/${signup}/check`, { r: ref, code });
  assert.equal(b.status, 303, b.text.slice(0, 400));
  const token = /^\/arc\/r\/([A-Za-z0-9_-]{20,64})$/.exec(b.location ?? '')![1];
  const ready = mailTo(mailer, email, 'Your advance copy of');
  const mailToken = /\/arc\/m\/([A-Za-z0-9_-]+)\/not-me/.exec(ready.text)![1];
  const id = (await db.query<{ id: string }>('select id from share_recipients where share_id = $1 and email = $2', [shareId, email])).rows[0]!.id;
  return { token, mailToken, id, email };
}

const hrefs = (html: string) => [...html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => m[1]);

async function download(base: string, token: string) {
  const r = await fetch(`${base}/arc/r/${token}/epub`);
  return { status: r.status, headers: r.headers, bytes: Buffer.from(await r.arrayBuffer()) };
}

const isZip = (b: Buffer) => b.length > 4 && b.readUInt32LE(0) === 0x04034b50;
const textOf = (xml: string) => xml.replace(/<[^>]*>/g, '');
const opfOf = (entries: ZipEntry[]) => entries.find((e) => e.name.endsWith('.opf'))!;
const stampedOf = (entries: ZipEntry[]) => entries.filter((e) => e.name.endsWith('.xhtml') && e.data.toString('utf8').includes(STAMP_LINE));

/** A page line as the html tag writes it. */
const esc = (key: keyof typeof ARC_EN, vars?: Record<string, string>) => escapeHtml(arcT('en')(key, vars));

/** Run `body` while the download queue holds a place for each key; the
 *  places are given back whatever happens (a red must not hang the file). */
async function holding(keys: string[], body: () => Promise<void>) {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const held = keys.map((k) => downloads.run(k, undefined, () => gate));
  try {
    await body();
  } finally {
    open();
    await Promise.all(held);
  }
}

async function rowOf(id: string) {
  return (await db.query<Record<string, unknown>>('select * from share_recipients where id = $1', [id])).rows[0] ?? null;
}

/* One database for every test: a "Not me" blocks its address for every
   author, so each test that says Not me uses an address of its own. */

/* ------------------------------------------------------------------ */

test("the copy page offers the EPUB and today's reader", async () => {
  const { campaign, signup } = await campaignOn(arcOn.base);
  const sarah = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Sarah', 'sarah@example.com');
  const a = await get(arcOn.base, `/arc/r/${sarah.token}`);
  assert.equal(a.status, 200, a.text.slice(0, 400));
  assert.equal(a.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(a.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(a.headers.get('cache-control'), 'no-store');
  assert.match(a.headers.get('content-security-policy') ?? '', /^default-src 'none'/);
  assert.match(a.text, /<meta name="robots" content="noindex, nofollow"/);
  assert.ok(a.text.includes(esc('arc.copy.title', { title: 'The Salt Road' })));
  assert.ok(ARC_EN['arc.copy.title'] === '{title} — your advance copy' && ARC_EN['arc.copy.for'] === 'Prepared for {name}');
  assert.ok(a.text.includes('Prepared for Sarah'));
  assert.equal(ARC_EN['arc.copy.keep'], "Keep this page: it's your link to your copy.");
  assert.ok(a.text.includes(esc('arc.copy.keep')));
  assert.ok(a.text.includes(esc('arc.copy.stampNote')));
  const links = hrefs(a.text);
  const dl = links.indexOf(`/arc/r/${sarah.token}/epub`);
  const rd = links.indexOf(`/read/${sarah.token}`);
  assert.ok(dl !== -1 && rd !== -1, JSON.stringify(links));
  assert.ok(dl < rd, 'the device copy comes first; the browser is the fallback (spec)');
  assert.ok(a.text.includes(ARC_EN['arc.copy.download']) && a.text.includes(ARC_EN['arc.copy.read']));
  // R4a: a claimed ARC reader reads in today's web reader.
  assert.equal((await get(arcOn.base, `/read/${sarah.token}`)).status, 200);
  // An unknown or malformed token: the calm 404 page.
  for (const t of ['A'.repeat(32), 'nope', `${sarah.token}x`]) {
    const u = await get(arcOn.base, `/arc/r/${t}`);
    assert.equal(u.status, 404, t);
    assert.ok(u.text.includes(esc('arc.page.unknownTitle')));
    assert.equal((await download(arcOn.base, t)).status, 404);
  }
});

test("the download is this reader's stamped copy", async () => {
  const { campaign, signup } = await campaignOn(arcOn.base);
  const sarah = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Sarah', 'sarah@example.com');
  const d = await download(arcOn.base, sarah.token);
  assert.equal(d.status, 200, d.bytes.toString('utf8').slice(0, 300));
  assert.equal(d.headers.get('content-type'), 'application/epub+zip');
  const filename = (await db.query<{ f: string }>('select epub_filename as f from arc_builds where campaign_id = $1', [campaign.id])).rows[0].f;
  const ascii = filename.replace(/[^A-Za-z0-9._-]/g, '_');
  assert.equal(d.headers.get('content-disposition'), `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  assert.equal(d.headers.get('cache-control'), 'no-store');
  assert.equal(d.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(d.headers.get('x-robots-tag'), 'noindex, nofollow');
  const row = await rowOf(sarah.id);
  const entries = readZip(d.bytes);
  assert.equal(entries[0].name, 'mimetype');
  assert.ok(opfOf(entries).data.toString('utf8').includes(`<meta property="beuk:arc-recipient">${row!.public_id}</meta>`));
  const stamped = stampedOf(entries);
  assert.equal(stamped.length, 1);
  assert.ok(textOf(stamped[0].data.toString('utf8')).includes('Advance Review Copy prepared for Sarah (sarah@example.com)'));
  assert.equal(await count(`arc_events where campaign_id = $1 and recipient_id = $2 and kind = 'downloaded'`, [campaign.id, sarah.id]), 1);
  // Stamped per download, never stored: the build is the unstamped EPUB.
  const base = (await db.query<{ b: string }>('select epub_base64 as b from arc_builds where campaign_id = $1', [campaign.id])).rows[0].b;
  assert.equal(stampedOf(readZip(Buffer.from(base, 'base64'))).length, 0);
});

test('two readers get copies that differ only in the stamp and the OPF', async () => {
  const { campaign, signup } = await campaignOn(arcOn.base);
  const sarah = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Sarah', 'sarah@example.com');
  const tom = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Tom', 'tom@example.com');
  const a = readZip((await download(arcOn.base, sarah.token)).bytes);
  const b = readZip((await download(arcOn.base, tom.token)).bytes);
  assert.deepEqual(a.map((e) => e.name), b.map((e) => e.name));
  const differ = a.filter((e, i) => !e.data.equals(b[i].data)).map((e) => e.name);
  assert.deepEqual(differ.sort(), [opfOf(a).name, stampedOf(a)[0].name].sort());
  assert.ok(textOf(stampedOf(b)[0].data.toString('utf8')).includes('Advance Review Copy prepared for Tom (tom@example.com)'));
});

test('a revoked or closed copy answers 410 and no bytes', async () => {
  const { w, campaign, signup } = await campaignOn(arcOn.base);
  const sarah = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Sarah', 'sarah@example.com');
  const tom = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Tom', 'tom@example.com');
  const una = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Una', 'una@example.com');
  // "Close this copy" (F9: a revoked copy never downloads).
  assert.equal((await w.c.post(`/api/arc/${campaign.id}/readers/${sarah.id}/revoke`)).status, 200);
  const page = await get(arcOn.base, `/arc/r/${sarah.token}`);
  assert.equal(page.status, 410);
  assert.ok(page.text.includes(esc('arc.copy.goneTitle')));
  const d = await download(arcOn.base, sarah.token);
  assert.equal(d.status, 410);
  assert.match(d.headers.get('content-type') ?? '', /^text\/html/);
  assert.ok(!isZip(d.bytes), 'no EPUB bytes');
  assert.equal(await count(`arc_events where recipient_id = $1 and kind = 'downloaded'`, [sarah.id]), 0);
  // Closing the campaign leaves the copies already given working (F13).
  assert.equal((await w.c.post(`/api/arc/${campaign.id}/close`)).status, 200);
  assert.equal((await get(arcOn.base, `/arc/r/${una.token}`)).status, 200);
  assert.equal((await download(arcOn.base, una.token)).status, 200);
  // The whole copy closed (the share): every reader's link answers 410.
  await db.query('update shares set revoked_at = now() where id = $1', [campaign.shareId]);
  for (const r of [tom, una]) {
    assert.equal((await get(arcOn.base, `/arc/r/${r.token}`)).status, 410);
    const x = await download(arcOn.base, r.token);
    assert.equal(x.status, 410);
    assert.ok(!isZip(x.bytes));
  }
});

test('downloads are limited per reader', async () => {
  const { campaign, signup } = await campaignOn(arcOn.base);
  const sarah = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Sarah', 'sarah@example.com');
  const tom = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Tom', 'tom@example.com');
  for (let i = 0; i < 10; i++) assert.equal((await download(arcOn.base, sarah.token)).status, 200, `download ${i + 1}`);
  const r = await fetch(`${arcOn.base}/arc/r/${sarah.token}/epub`);
  const text = await r.text();
  assert.equal(r.status, 429);
  assert.match(r.headers.get('content-type') ?? '', /^text\/html/);
  assert.ok(Number(r.headers.get('retry-after')) > 0, 'Retry-After in seconds');
  assert.ok(text.includes(esc('arc.copy.err.limit')));
  assert.equal(await count(`arc_events where recipient_id = $1 and kind = 'downloaded'`, [sarah.id]), 10);
  // Per reader: another reader of the same campaign still downloads.
  assert.equal((await download(arcOn.base, tom.token)).status, 200);
  // An hour later the reader can download again.
  clock = new Date(clock.getTime() + HOUR + MIN);
  assert.equal((await download(arcOn.base, sarah.token)).status, 200);
});

test('one download at a time per reader (429, Retry-After 10); a full queue is 503 (Retry-After 30)', async () => {
  // Ruling F20. The download queue is held busy by the test.
  const { campaign, signup } = await campaignOn(arcOn.base);
  const sarah = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Sarah', 'sarah@example.com');
  await holding([sarah.id], async () => {
    const r = await fetch(`${arcOn.base}/arc/r/${sarah.token}/epub`);
    const text = await r.text();
    assert.equal(r.status, 429);
    assert.equal(r.headers.get('retry-after'), '10');
    assert.ok(text.includes(esc('arc.copy.err.busy')));
  });
  // Every place taken (2 running, 8 waiting) by other readers.
  await holding(Array.from({ length: 10 }, (_, i) => `someone-${i}`), async () => {
    const full = await fetch(`${arcOn.base}/arc/r/${sarah.token}/epub`);
    const fullText = await full.text();
    assert.equal(full.status, 503);
    assert.equal(full.headers.get('retry-after'), '30');
    assert.ok(fullText.includes(esc('arc.copy.err.serverBusy')));
  });
  // Neither refusal used up a download: ten still go, the eleventh is the limit.
  for (let i = 0; i < 10; i++) assert.equal((await download(arcOn.base, sarah.token)).status, 200, `download ${i + 1}`);
  assert.equal((await download(arcOn.base, sarah.token)).status, 429);
});

test('a copy that cannot be stamped is a calm, logged 500 page', async (t) => {
  // Ruling F20.
  const { campaign, signup } = await campaignOn(arcOn.base);
  const sarah = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Sarah', 'sarah@example.com');
  await db.query('update arc_builds set epub_base64 = $2 where campaign_id = $1', [campaign.id, Buffer.from('not a zip at all').toString('base64')]);
  const logged = t.mock.method(console, 'error', () => {});
  const r = await fetch(`${arcOn.base}/arc/r/${sarah.token}/epub`);
  const text = await r.text();
  logged.mock.restore();
  assert.equal(r.status, 500);
  assert.match(r.headers.get('content-type') ?? '', /^text\/html/);
  assert.ok(text.includes(esc('arc.copy.err.failed')));
  assert.ok(!/StampError|at \S+ \(/.test(text), 'no error details on the page');
  assert.ok(logged.mock.calls.length >= 1, 'logged');
  assert.equal(await count(`arc_events where recipient_id = $1 and kind = 'downloaded'`, [sarah.id]), 0);
});

test('GET on a mail link never acts', async () => {
  // Review Focus 4: a scanner or link preview fetching every link changes nothing.
  const { campaign, signup } = await campaignOn(arcOn.base);
  const sarah = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Sarah', 'sarah@example.com');
  const before = await rowOf(sarah.id);
  const hash = suppressionHash(arcOn.config, sarah.email);
  const events = await count(`arc_events where campaign_id = $1`, [campaign.id]);
  for (const action of ['not-me', 'stop'] as const) {
    for (let i = 0; i < 3; i++) {
      const a = await get(arcOn.base, `/arc/m/${sarah.mailToken}/${action}`);
      assert.equal(a.status, 200, a.text.slice(0, 300));
      assert.equal(a.headers.get('x-robots-tag'), 'noindex, nofollow');
      assert.match(a.text, new RegExp(`<form method="post" action="/arc/m/${sarah.mailToken}/${action}"`));
      const h = await fetch(`${arcOn.base}/arc/m/${sarah.mailToken}/${action}`, { method: 'HEAD' });
      assert.equal(h.status, 200);
    }
  }
  const notMe = await get(arcOn.base, `/arc/m/${sarah.mailToken}/not-me`);
  assert.ok(notMe.text.includes(esc('arc.notMe.body', { title: 'The Salt Road' })));
  assert.equal(
    ARC_EN['arc.notMe.body'],
    "If you didn't ask for a copy of {title}, press the button. Beuk deletes your name and email from this book, closes this copy, and won't send this address mail from any author on Beuk again.",
  );
  const stop = await get(arcOn.base, `/arc/m/${sarah.mailToken}/stop`);
  assert.ok(stop.text.includes(esc('arc.stop.body', { author: 'Ada Moss' })));
  assert.equal(ARC_EN['arc.stop.body'], "Press the button and Beuk won't send you any more email about {author}'s books. Your copy keeps working.");
  assert.deepEqual(await rowOf(sarah.id), before, 'the row is unchanged');
  assert.equal(await count(`mail_suppressions where hash = $1`, [hash]), 0, 'no suppression');
  assert.equal(await count(`arc_events where campaign_id = $1`, [campaign.id]), events, 'no event');
  assert.equal((await download(arcOn.base, sarah.token)).status, 200);
});

test('Not me removes the reader, closes the copy, and blocks the address for every author', async () => {
  const { campaign, signup } = await campaignOn(arcOn.base);
  const sarah = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Sarah', 'sarah.n@example.com');
  // An earlier comment through the web reader.
  const sectionId = (await db.query<{ id: string }>(`select snapshot->'sections'->0->>'id' as id from shares where id = $1`, [campaign.shareId])).rows[0].id;
  const posted = await fetch(`${arcOn.base}/read/${sarah.token}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'A lovely first line.', sectionId }),
  });
  assert.equal(posted.status, 201, await posted.clone().text());
  const commentId = ((await posted.json()) as { comment: { id: string } }).comment.id;

  const done = await postForm(arcOn.base, `/arc/m/${sarah.mailToken}/not-me`, { confirm: '1' });
  assert.equal(done.status, 200, done.text.slice(0, 400));
  assert.ok(done.text.includes(esc('arc.notMe.done', { title: 'The Salt Road' })));
  assert.equal(await count(`share_recipients where id = $1`, [sarah.id]), 0, 'the row is gone');
  assert.equal(await count(`share_recipients where email = 'sarah.n@example.com' and share_id = $1`, [campaign.shareId]), 0, 'and the address with it');
  assert.equal((await get(arcOn.base, `/arc/r/${sarah.token}`)).status, 404);
  assert.equal((await download(arcOn.base, sarah.token)).status, 404);
  assert.equal((await get(arcOn.base, `/read/${sarah.token}`)).status, 404);
  const hash = suppressionHash(arcOn.config, 'sarah.n@example.com');
  assert.deepEqual((await db.query(`select hash, scope from mail_suppressions where hash = $1`, [hash])).rows, [{ hash, scope: 'all' }]);
  const comment = (await db.query<{ reader_name: string; recipient_id: string | null }>(`select reader_name, recipient_id from share_comments where id = $1`, [commentId])).rows[0];
  assert.deepEqual(comment, { reader_name: 'Sarah', recipient_id: null }, 'the comment stays under the given name');
  assert.equal(await count(`arc_events where campaign_id = $1 and kind = 'not_me' and recipient_id is null`, [campaign.id]), 1);
  assert.equal(await count(`arc_events where recipient_id = $1`, [sarah.id]), 0);

  // Another author's campaign: the same address, typed differently, is blocked; nothing is sent.
  const other = await campaignOn(arcOn.base, { title: 'Another Book', author: 'Bo Lind' });
  const sent = arcMail.sent.length;
  const a = await postForm(arcOn.base, `/arc/${other.signup}`, { name: 'Sarah', email: ' SARAH.N@example.com' });
  assert.equal(a.status, 409);
  assert.ok(a.text.includes(esc('arc.claim.err.blocked')));
  assert.equal(arcMail.sent.length, sent, 'nothing sent');
});

test('Stop ends mail from this author only; the copy keeps working', async () => {
  const { w, campaign, signup } = await campaignOn(arcOn.base);
  const sarah = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Sarah', 'sarah@example.com');
  const done = await postForm(arcOn.base, `/arc/m/${sarah.mailToken}/stop`, { confirm: '1' });
  assert.equal(done.status, 200, done.text.slice(0, 400));
  assert.ok(done.text.includes(esc('arc.stop.done', { author: 'Ada Moss' })));
  const row = await rowOf(sarah.id);
  assert.ok(row && row.mail_stopped_at != null, 'mail_stopped_at set');
  const hash = suppressionHash(arcOn.config, 'sarah@example.com');
  assert.deepEqual((await db.query(`select hash, scope from mail_suppressions where hash = $1`, [hash])).rows, [{ hash, scope: w.id }]);
  assert.equal(await count(`arc_events where recipient_id = $1 and kind = 'stopped'`, [sarah.id]), 1);
  assert.equal((await get(arcOn.base, `/arc/r/${sarah.token}`)).status, 200);
  assert.equal((await download(arcOn.base, sarah.token)).status, 200);
  const readers = await w.c.get(`/api/arc/${campaign.id}/readers`);
  assert.equal(readers.status, 200);
  assert.equal((readers.body.readers as Array<{ id: string; mailStopped: boolean }>).find((r) => r.id === sarah.id)?.mailStopped, true);
  // Stop again: still done, nothing new recorded.
  assert.equal((await postForm(arcOn.base, `/arc/m/${sarah.mailToken}/stop`, { confirm: '1' })).status, 200);
  assert.equal(await count(`arc_events where recipient_id = $1 and kind = 'stopped'`, [sarah.id]), 1);
  // The same author's next book: blocked, nothing sent.
  const own = await campaignFor(w, { title: 'The Second Tide' });
  let sent = arcMail.sent.length;
  const blocked = await postForm(arcOn.base, `/arc/${own.signup}`, { name: 'Sarah', email: 'sarah@example.com' });
  assert.equal(blocked.status, 409);
  assert.equal(arcMail.sent.length, sent);
  // Another author: the code is sent.
  const other = await campaignOn(arcOn.base, { title: 'Another Book', author: 'Bo Lind' });
  sent = arcMail.sent.length;
  const a = await postForm(arcOn.base, `/arc/${other.signup}`, { name: 'Sarah', email: 'sarah@example.com' });
  assert.equal(a.status, 303, a.text.slice(0, 300));
  assert.equal(arcMail.to('sarah@example.com', sent).filter((m) => m.subject.startsWith('Your code for')).length, 1, 'code sent');
});

test('one-click unsubscribe works without the page', async () => {
  // RFC 8058 §3.2: the receiver POSTs 'List-Unsubscribe=One-Click' to the
  // List-Unsubscribe URI (the Stop link); SHOULD multipart, MAY urlencoded (F22).
  const { w, campaign, signup } = await campaignOn(arcOn.base);
  const sarah = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Sarah', 'sarah@example.com');
  const tom = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Tom', 'tom@example.com');
  const una = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Una', 'una@example.com');
  // The header names the Stop link.
  assert.equal(mailTo(arcMail, 'sarah@example.com', 'Your advance copy of').headers?.['List-Unsubscribe'], `<${arcOn.config.appBaseUrl}/arc/m/${sarah.mailToken}/stop>`);
  const url = await fetch(`${arcOn.base}/arc/m/${sarah.mailToken}/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
  assert.equal(url.status, 200);
  assert.ok((await rowOf(sarah.id))!.mail_stopped_at != null, 'urlencoded: stopped');
  const form = new FormData();
  form.set('List-Unsubscribe', 'One-Click');
  const multi = await fetch(`${arcOn.base}/arc/m/${tom.mailToken}/stop`, { method: 'POST', body: form });
  assert.equal(multi.status, 200);
  assert.ok((await rowOf(tom.id))!.mail_stopped_at != null, 'multipart: stopped');
  assert.equal(await count(`mail_suppressions where hash = $1 and scope = $2`, [suppressionHash(arcOn.config, 'tom@example.com'), w.id]), 1);
  // Decided by this task: a POST that is neither the button nor the one-click pair changes nothing.
  for (const body of [new URLSearchParams({ 'List-Unsubscribe': 'Something-Else' }), new URLSearchParams()]) {
    const r = await fetch(`${arcOn.base}/arc/m/${una.mailToken}/stop`, { method: 'POST', body });
    assert.equal(r.status, 400);
  }
  const odd = new FormData();
  odd.set('other', 'One-Click');
  assert.equal((await fetch(`${arcOn.base}/arc/m/${una.mailToken}/stop`, { method: 'POST', body: odd })).status, 400);
  assert.equal((await rowOf(una.id))!.mail_stopped_at, null, 'nothing changed');
});

test('a used or unknown mail link answers calmly', async () => {
  const { campaign, signup } = await campaignOn(arcOn.base);
  const sarah = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Sarah', 'sarah.u@example.com');
  assert.equal((await postForm(arcOn.base, `/arc/m/${sarah.mailToken}/not-me`, { confirm: '1' })).status, 200);
  for (const a of [
    await postForm(arcOn.base, `/arc/m/${sarah.mailToken}/not-me`, { confirm: '1' }),
    await postForm(arcOn.base, `/arc/m/${sarah.mailToken}/stop`, { 'List-Unsubscribe': 'One-Click' }),
    await get(arcOn.base, `/arc/m/${sarah.mailToken}/not-me`),
    await get(arcOn.base, `/arc/m/${'B'.repeat(43)}/stop`),
    await postForm(arcOn.base, `/arc/m/${'B'.repeat(43)}/stop`, { confirm: '1' }),
    await get(arcOn.base, `/arc/m/short/stop`),
  ]) {
    assert.equal(a.status, 404, a.text.slice(0, 300));
    assert.ok(a.text.includes(esc('arc.mail.gone')));
  }
  // An action that does not exist.
  const tom = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Tom', 'tom@example.com');
  assert.equal((await get(arcOn.base, `/arc/m/${tom.mailToken}/delete`)).status, 404);
  assert.equal((await postForm(arcOn.base, `/arc/m/${tom.mailToken}/delete`, { confirm: '1' })).status, 404);
  assert.ok(await rowOf(tom.id));
});

test('without the opt-out salt, Not me and Stop change nothing and say so', async () => {
  // Decided by this task: the suppression hash needs ARC_SUPPRESSION_SALT;
  // without it the promise on the page cannot be kept, so nothing is done.
  const { w, campaign, signup } = await campaignOn(arcOn.base);
  const sarah = await claimed(arcOn.base, arcMail, signup, campaign.shareId, 'Sarah', 'sarah@example.com');
  const before = await rowOf(sarah.id);
  assert.equal((await get(arcOff.base, `/arc/m/${sarah.mailToken}/not-me`)).status, 200);
  for (const action of ['not-me', 'stop']) {
    const a = await postForm(arcOff.base, `/arc/m/${sarah.mailToken}/${action}`, { confirm: '1' });
    assert.equal(a.status, 503, a.text.slice(0, 300));
    assert.ok(a.text.includes(esc('arc.mail.unavailable')));
  }
  assert.deepEqual(await rowOf(sarah.id), before);
  // (Earlier tests' Stops for other authors are theirs; none here, and no Not me.)
  assert.equal(await count(`mail_suppressions where hash = $1 and scope in ('all', $2)`, [suppressionHash(arcOn.config, sarah.email), w.id]), 0);
});

test('a hostile name, title or author is escaped on every page this task adds', async () => {
  // Ruling F13: the copy page and its refusals, the closed copy, the mail
  // pages, their done pages and the used-link page.
  const evil = '<script>x</script>';
  const { w, campaign, signup } = await campaignOn(arcOn.base, { title: '<i>Salt</i> & "Road"', author: '<b>Ada</b>' });
  const clean = (html: string) => assert.ok(!html.includes('<script>x') && !html.includes('<b>') && !html.includes('<i>Salt'), html.slice(0, 600));
  const r1 = await claimed(arcOn.base, arcMail, signup, campaign.shareId, evil, 'evil1@example.com');
  const r2 = await claimed(arcOn.base, arcMail, signup, campaign.shareId, evil, 'evil2@example.com');
  const page = await get(arcOn.base, `/arc/r/${r1.token}`);
  assert.equal(page.status, 200);
  clean(page.text);
  assert.ok(page.text.includes('&lt;i&gt;Salt&lt;/i&gt; &amp; &quot;Road&quot; — your advance copy'));
  assert.ok(page.text.includes('Prepared for &lt;script&gt;x&lt;/script&gt;'));
  // A refusal page (one at a time).
  await holding([r1.id], async () => {
    const busy = await fetch(`${arcOn.base}/arc/r/${r1.token}/epub`);
    assert.equal(busy.status, 429);
    clean(await busy.text());
  });
  for (const action of ['not-me', 'stop']) {
    const a = await get(arcOn.base, `/arc/m/${r1.mailToken}/${action}`);
    assert.equal(a.status, 200);
    clean(a.text);
  }
  const stopped = await postForm(arcOn.base, `/arc/m/${r1.mailToken}/stop`, { confirm: '1' });
  assert.equal(stopped.status, 200);
  clean(stopped.text);
  assert.ok(stopped.text.includes('&lt;b&gt;Ada&lt;/b&gt;'));
  assert.equal((await w.c.post(`/api/arc/${campaign.id}/readers/${r2.id}/revoke`)).status, 200);
  const gone = await get(arcOn.base, `/arc/r/${r2.token}`);
  assert.equal(gone.status, 410);
  clean(gone.text);
  const notMe = await postForm(arcOn.base, `/arc/m/${r1.mailToken}/not-me`, { confirm: '1' });
  assert.equal(notMe.status, 200);
  clean(notMe.text);
  assert.ok(notMe.text.includes('&lt;i&gt;Salt&lt;/i&gt;'));
  const used = await postForm(arcOn.base, `/arc/m/${r1.mailToken}/not-me`, { confirm: '1' });
  assert.equal(used.status, 404);
  clean(used.text);
});

test("a paused author's readers still download", async () => {
  const w = await writer(paid.base);
  await db.query('update users set trial_ends_at = $2 where id = $1', [w.id, new Date(clock.getTime() + 7 * DAY)]);
  const { campaign, signup } = await campaignFor(w);
  const sarah = await claimed(paid.base, paidMail, signup, campaign.shareId, 'Sarah', 'sarah@example.com');
  await db.query('update users set trial_ends_at = $2 where id = $1', [w.id, new Date(clock.getTime() - DAY)]);
  assert.equal((await w.c.post('/api/manuscripts', { doc: studioDoc() })).status, 402, 'the account is paused');
  assert.equal((await get(paid.base, `/arc/r/${sarah.token}`)).status, 200);
  const d = await download(paid.base, sarah.token);
  assert.equal(d.status, 200);
  assert.ok(isZip(d.bytes));
  assert.equal((await get(paid.base, `/arc/m/${sarah.mailToken}/stop`)).status, 200);
  assert.equal((await postForm(paid.base, `/arc/m/${sarah.mailToken}/stop`, { confirm: '1' })).status, 200);
  for (const [method, p] of [
    ['GET', '/arc/r/:token'],
    ['GET', '/arc/r/:token/epub'],
    ['GET', '/arc/m/:mailToken/:action'],
    ['POST', '/arc/m/:mailToken/:action'],
  ]) {
    assert.ok(NEVER_PAUSED.some((x) => x.method === method && x.path === p), `${method} ${p} is in NEVER_PAUSED`);
  }
});

test("1.0's service worker leaves /arc/ to the network", () => {
  // An old 1.0 install must never cache a stamped download or a copy page.
  const sw = readFileSync('client/assets/sw.js', 'utf8');
  const read = sw.indexOf('if (url.pathname.indexOf("/read/") === 0) return;');
  const arc = sw.indexOf('if (url.pathname.indexOf("/arc/") === 0) return;');
  assert.ok(read !== -1 && arc !== -1, 'both bypasses');
  // Before the first respondWith in the fetch handler.
  const fetchAt = sw.indexOf('self.addEventListener("fetch"');
  assert.ok(fetchAt < arc && arc < sw.indexOf('event.respondWith', fetchAt));
});
