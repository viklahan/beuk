import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import nodemailer from 'nodemailer';
import { tokenHash } from '../src/auth.js';
import type { Config } from '../src/config.js';
import type { Db } from '../src/db.js';
import type { RenderedEmail } from '../src/email/layout.js';
import { smtpMessage, type MailMessage, type Mailer, type MailerStatus, type MailResult } from '../src/mailer.js';
import {
  arcActionUrl,
  arcApprovedEmail,
  arcAuthorWaitingEmail,
  arcCodeEmail,
  arcDeclinedEmail,
  arcPendingEmail,
  arcReadyEmail,
  type ArcMailContext,
} from '../src/arc/emails.js';
import {
  ARC_SALT_MIN_LENGTH,
  ARC_SEND_LIMITS,
  arcMailStatus,
  arcMailToken,
  arcMailTokenHash,
  createArcMailer,
  normalizeEmail,
  arcSignupToken,
  saltProblem,
  sendArcMail,
  suppress,
  suppressionHash,
  suppressionOf,
  type ArcMailKind,
  type ArcMailTo,
} from '../src/arc/mail.js';
import { arcOptOutReady } from '../src/arc/readers.js';
import { arcDir, arcLang, arcPlaceholderRe, arcT } from '../src/arc/strings.js';
import { SECRET_CONFIG_KEYS } from '../src/housekeeping/backup.js';
import { collectSecrets } from '../src/housekeeping/scrub.js';
import { createTestDb, testConfig } from './helpers.js';

/**
 * ARC slice 1, Task 2: the mail rails every reader email goes through.
 * The fixture sender is the real one (controller ruling F3). Nothing here
 * sends mail: the transport is a recording fake, and the one nodemailer
 * check uses its stream transport, which only builds the message.
 */

/** What a code email names and links (final review Important 1, ruling C6); the values are the test's. */
const CODE_ABOUT = { name: 'Sarah Reed', codePage: 'https://beuk.example/arc/signup-token-0123456789/check?r=ref-0123456789abcdef' };

/** A test salt of exactly ARC_SALT_MIN_LENGTH (32) characters. */
const SALT = 'salt-1-0123456789abcdef-0123456x';
const ARC = { mailFrom: 'Beuk readers <readers@beuk.studio>', smtpUrl: 'smtp://u:p@127.0.0.1:9', suppressionSalt: SALT };

/** A configured ARC mailer that records instead of sending. */
class RecordingMailer implements Mailer {
  sent: MailMessage[] = [];
  constructor(private answer: MailResult = { delivered: true, messageId: '<arc-test@example.com>' }) {}
  status(): MailerStatus {
    return { configured: true, transport: 'smtp', from: ARC.mailFrom, detail: 'recording mailer (test)' };
  }
  async send(message: MailMessage): Promise<MailResult> {
    this.sent.push(message);
    return this.answer;
  }
  async verify() {
    return { ok: true, detail: 'recording mailer (test)' };
  }
}

test('ARC mail is off until all three are set, and says which is missing', () => {
  assert.deepEqual(arcMailStatus(testConfig()), { configured: false, reason: 'ARC_MAIL_FROM is not set' });
  assert.equal(arcMailStatus(testConfig({ smtpUrl: 'smtp://x', mailFrom: 'a@b.c', arc: { ...ARC, mailFrom: null } })).configured, false);
  assert.equal(arcMailStatus(testConfig({ arc: { ...ARC, suppressionSalt: null } })).reason, 'ARC_SUPPRESSION_SALT is not set');
  // Decided by this task: the middle setting is named the same way.
  assert.equal(arcMailStatus(testConfig({ arc: { ...ARC, smtpUrl: null } })).reason, 'ARC_SMTP_URL is not set');
  assert.deepEqual(arcMailStatus(testConfig({ arc: ARC })), { configured: true, reason: null });
  // Fix round 1 (controller): a salt under 32 characters is never used.
  assert.equal(SALT.length, ARC_SALT_MIN_LENGTH);
  const short = testConfig({ arc: { ...ARC, suppressionSalt: SALT.slice(0, 31) } });
  assert.deepEqual(arcMailStatus(short), { configured: false, reason: 'ARC_SUPPRESSION_SALT is shorter than 32 characters' });
  assert.equal(createArcMailer(short), null);
  assert.throws(() => suppressionHash(short, 'sarah@example.com'), /shorter than 32 characters/);
  assert.throws(() => arcMailToken(short, 'r1'), /shorter than 32 characters/);
  // Never a fallback to account mail.
  assert.equal(createArcMailer(testConfig({ smtpUrl: 'smtp://x', mailFrom: 'hello@beuk.studio' })), null);
  assert.equal(createArcMailer(testConfig({ arc: ARC }))!.status().from, ARC.mailFrom);
});

// Final fix wave (final review minor 4): one salt rule for mail, opt-outs and the derived tokens.
test('one salt rule: saltProblem decides mail, the opt-outs and the signup token alike', () => {
  for (const [salt, why] of [
    [null, 'ARC_SUPPRESSION_SALT is not set'],
    ['', 'ARC_SUPPRESSION_SALT is not set'],
    [SALT.slice(0, 31), 'ARC_SUPPRESSION_SALT is shorter than 32 characters'],
    [SALT, null],
  ] as const) {
    const cfg = testConfig({ arc: { ...ARC, suppressionSalt: salt } });
    assert.equal(saltProblem(salt), why, String(salt));
    assert.equal(arcOptOutReady(cfg), why === null, `opt-outs: ${String(salt)}`);
    assert.equal(arcMailStatus(cfg).configured, why === null, `mail: ${String(salt)}`);
    if (why) assert.throws(() => arcSignupToken(cfg, 'c1', 0), /ARC mail is not configured/);
  }
  // The signup token: the HMAC of the campaign id and the rotation (final review Important 3).
  const cfg = testConfig({ arc: ARC });
  assert.equal(arcSignupToken(cfg, 'c1', 0), createHmac('sha256', SALT).update('arc-signup:c1:0').digest('base64url'));
  assert.notEqual(arcSignupToken(cfg, 'c1', 1), arcSignupToken(cfg, 'c1', 0), 'a new rotation, a new link');
  assert.match(arcSignupToken(cfg, 'c1', 0), /^[A-Za-z0-9_-]{43}$/);
});

// Final fix wave (final review minor 5): no shared /g regex carrying lastIndex between callers.
test('the placeholder pattern is a fresh regex each time', () => {
  const a = arcPlaceholderRe();
  assert.notEqual(a, arcPlaceholderRe());
  assert.ok(a.global);
  a.exec('{one} {two}');
  assert.equal(arcPlaceholderRe().lastIndex, 0, "one caller's position never reaches another");
  assert.equal(arcT('en')('arc.mail.code.subject', { title: 'T' }), 'Your code for T');
  assert.equal(arcT('en')('arc.mail.code.subject', { title: 'T' }), 'Your code for T', 'twice in a row');
});

// Decided by this task: the ARC secrets are scrubbed like SMTP_URL, and backups leave them out by name.
test('the ARC transport URL, its password and the salt are secrets', () => {
  const secrets = collectSecrets(testConfig({ arc: { ...ARC, smtpUrl: 'smtp://resend:re_arc_key_1@smtp.example.com:587', suppressionSalt: 'salt-long-enough-for-the-scrubber-0123' } }));
  for (const s of ['smtp://resend:re_arc_key_1@smtp.example.com:587', 're_arc_key_1', 'salt-long-enough-for-the-scrubber-0123']) assert.ok(secrets.includes(s), s);
  assert.ok((SECRET_CONFIG_KEYS as readonly string[]).includes('ARC_SMTP_URL'));
  assert.ok((SECRET_CONFIG_KEYS as readonly string[]).includes('ARC_SUPPRESSION_SALT'));
});

test('normalizeEmail and the hash ignore case and spaces', () => {
  assert.equal(normalizeEmail('  Sarah@Example.COM '), 'sarah@example.com');
  for (const bad of ['', 'a@b', 'a b@c.d', '@c.d', 'a@@c.d', 7]) assert.equal(normalizeEmail(bad), null);
  // Decided by this task: the length ceiling (254) and the other shapes refused.
  assert.equal(normalizeEmail(`${'a'.repeat(244)}@example.com`), null);
  assert.equal(normalizeEmail(`${'a'.repeat(242)}@example.com`), `${'a'.repeat(242)}@example.com`);
  for (const bad of [null, undefined, 'a@b.', 'a@.b', 'a@b\tc.d', 'a@b.c d']) assert.equal(normalizeEmail(bad), null);
  const cfg = testConfig({ arc: ARC });
  assert.equal(suppressionHash(cfg, 'sarah@example.com'), createHash('sha256').update('sarah@example.com' + SALT).digest('hex'));
  // Review Focus 3: the same address typed differently is one hash.
  assert.equal(suppressionHash(cfg, normalizeEmail('  Sarah@Example.COM ')!), suppressionHash(cfg, 'sarah@example.com'));
  assert.equal(suppressionHash(cfg, 'Sarah@Example.COM'), suppressionHash(cfg, 'sarah@example.com'));
});

test('the mail token is the HMAC of the recipient id, and only its hash is stored (F1)', () => {
  const cfg = testConfig({ arc: ARC });
  const id = '6f1c1c3e-8a59-4e8e-9d0b-2b1c7b4f3a10';
  const expected = createHmac('sha256', SALT).update('arc-mail:' + id).digest('base64url');
  assert.equal(arcMailToken(cfg, id), expected);
  assert.equal(arcMailToken(cfg, id), arcMailToken(cfg, id), 'the same reader always gets the same links');
  assert.notEqual(arcMailToken(cfg, id), arcMailToken(cfg, randomUUID()));
  assert.equal(arcMailTokenHash(cfg, id), tokenHash(expected));
  assert.throws(() => arcMailToken(testConfig(), id), /ARC_SUPPRESSION_SALT/);
});

test('smtpMessage passes headers through', async () => {
  const headers = { 'List-Unsubscribe': '<https://beuk.example/arc/m/tok/stop>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  const cfg = testConfig({ mailFrom: ARC.mailFrom });
  const msg = smtpMessage(cfg, { to: 'r@example.com', subject: 's', text: 't', headers });
  assert.deepEqual(msg.headers, headers);
  // nodemailer 10.0.13's stream transport only builds the message (it
  // connects to nothing): the two fields come out as written.
  const built = await nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' }).sendMail(msg);
  const raw = (built.message as Buffer).toString('utf8').replace(/\n[ \t]+/g, ' ');
  assert.match(raw, /^List-Unsubscribe: <https:\/\/beuk\.example\/arc\/m\/tok\/stop>$/m);
  assert.match(raw, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
});

/* ------------------------------------------------------------------ */
/* sendArcMail against a real (PGlite) database                        */

const db = await createTestDb();
let n = 0;

interface Fixture {
  ownerId: string;
  campaignId: string;
  shareId: string;
}

async function campaignFor(d: Db, ownerId?: string): Promise<Fixture> {
  const k = (n += 1);
  const owner =
    ownerId ??
    (await d.query<{ id: string }>(`insert into users (email, password_hash) values ($1, 'x') returning id`, [`arc-author${k}@example.com`])).rows[0].id;
  const m = (await d.query<{ id: string }>(`insert into manuscripts (user_id, title, doc) values ($1, 'ARC Book', '{}'::jsonb) returning id`, [owner])).rows[0].id;
  const shareId = (
    await d.query<{ id: string }>(
      `insert into shares (owner_id, manuscript_id, token_hash, title, snapshot) values ($1, $2, null, 'ARC Book', '{}'::jsonb) returning id`,
      [owner, m],
    )
  ).rows[0].id;
  const campaignId = (
    await d.query<{ id: string }>(
      `insert into arc_campaigns (share_id, owner_id, manuscript_id, signup_token_hash, max_claims, approval_mode, launch_date, closes_at, tz)
       values ($1, $2, $3, $4, 50, 'instant', '2027-02-14', now() + interval '30 days', 'Europe/London') returning id`,
      [shareId, owner, m, `signup-arc-mail-${k}`],
    )
  ).rows[0].id;
  return { ownerId: owner, campaignId, shareId };
}

async function readerIn(d: Db, cfg: Config, f: Fixture, email: string): Promise<ArcMailTo> {
  const id = randomUUID();
  await d.query(
    `insert into share_recipients (id, share_id, name, role, email, status, mail_token_hash) values ($1, $2, 'Sarah', 'arc', $3, 'unverified', $4)`,
    [id, f.shareId, email, arcMailTokenHash(cfg, id)],
  );
  return { campaignId: f.campaignId, ownerId: f.ownerId, recipientId: id, email, mailToken: arcMailToken(cfg, id) };
}

async function events(campaignId: string): Promise<string[]> {
  const r = await db.query<{ kind: string }>('select kind from arc_events where campaign_id = $1 order by at, kind', [campaignId]);
  return r.rows.map((x) => x.kind);
}

const NOW = new Date('2026-12-01T12:00:00Z');
const now = () => NOW;
const ctxFor = (to: ArcMailTo): ArcMailContext => ({ lang: 'en', title: 'The Salt Road', author: 'Ada Moss', mailToken: to.mailToken });

test('sendArcMail sends nothing when ARC mail is off', async () => {
  const cfg = testConfig({ arc: ARC });
  const f = await campaignFor(db);
  const to = await readerIn(db, cfg, f, 'off@example.com');
  const fake = new RecordingMailer();
  const off = await sendArcMail({ db, config: testConfig(), arcMailer: null, now }, to, 'code', arcCodeEmail(cfg, ctxFor(to), '123456', CODE_ABOUT));
  assert.equal(off.sent, false);
  assert.equal(off.sent === false && off.reason, 'not-configured');
  // Decided by this task: an injected transport without the salt cannot check suppression, so it is off too.
  const noSalt = await sendArcMail(
    { db, config: testConfig({ arc: { ...ARC, suppressionSalt: null } }), arcMailer: fake, now },
    to,
    'code',
    arcCodeEmail(cfg, ctxFor(to), '123456', CODE_ABOUT),
  );
  assert.deepEqual(noSalt, { sent: false, reason: 'not-configured', detail: 'ARC_SUPPRESSION_SALT is not set' });
  assert.equal(fake.sent.length, 0);
  assert.deepEqual(await events(f.campaignId), []);
});

// Fix round 1 (controller, F1): the one door guarantees working opt-out links.
test('sendArcMail derives the links itself: a wrong token throws, a body with other links is refused', async () => {
  const cfg = testConfig({ arc: ARC, appBaseUrl: 'https://beuk.example' });
  const f = await campaignFor(db);
  const to = await readerIn(db, cfg, f, 'links@example.com');
  const fake = new RecordingMailer();
  const deps = { db, config: cfg, arcMailer: fake, now };

  // A caller holding another reader's token: a programming error.
  const otherToken = arcMailToken(cfg, randomUUID());
  await assert.rejects(
    sendArcMail(deps, { ...to, mailToken: otherToken }, 'code', arcCodeEmail(cfg, { ...ctxFor(to), mailToken: otherToken }, '123456', CODE_ABOUT)),
    /not the token derived from to\.recipientId/,
  );
  // The right token in ArcMailTo, but a body built with another token: refused.
  const wrongBody = arcCodeEmail(cfg, { ...ctxFor(to), mailToken: otherToken }, '123456', CODE_ABOUT);
  assert.deepEqual(await sendArcMail(deps, to, 'code', wrongBody), {
    sent: false,
    reason: 'refused',
    detail: "the email does not carry this reader's Not me and Stop links",
  });
  // A body whose text is right but whose HTML lost the links: refused too.
  const right = arcCodeEmail(cfg, ctxFor(to), '123456', CODE_ABOUT);
  const htmlWithout = { ...right, html: right.html.replaceAll(to.mailToken, otherToken) };
  assert.equal((await sendArcMail(deps, to, 'code', htmlWithout)).sent, false);
  assert.equal(fake.sent.length, 0, 'nothing reached the transport');
  assert.deepEqual(await events(f.campaignId), [], 'nothing was recorded');

  // The happy path: an empty token is derived; the header uses the derived token.
  assert.deepEqual(await sendArcMail(deps, { ...to, mailToken: '' }, 'code', right), { sent: true });
  assert.equal(fake.sent[0].headers?.['List-Unsubscribe'], `<${arcActionUrl(cfg, arcMailToken(cfg, to.recipientId), 'stop')}>`);
});

test('Not me blocks every author; Stop blocks only that author', async () => {
  const cfg = testConfig({ arc: ARC });
  const a = await campaignFor(db);
  const b = await campaignFor(db);
  const fake = new RecordingMailer();
  const deps = { db, config: cfg, arcMailer: fake, now };

  // Stop (scope = author A): A's mail stops, B's still goes.
  const stopA = await readerIn(db, cfg, a, 'stop@example.com');
  const stopB = await readerIn(db, cfg, b, 'stop@example.com');
  await suppress(db, cfg, '  STOP@example.com ', { ownerId: a.ownerId });
  await suppress(db, cfg, 'stop@example.com', { ownerId: a.ownerId }); // twice: on conflict do nothing
  assert.equal(await suppressionOf(db, cfg, 'stop@example.com', a.ownerId), 'owner');
  assert.equal(await suppressionOf(db, cfg, 'stop@example.com', b.ownerId), null);
  const refused = await sendArcMail(deps, stopA, 'ready', arcReadyEmail(cfg, ctxFor(stopA), 'https://beuk.example/arc/r/x'));
  assert.equal(refused.sent === false && refused.reason, 'suppressed');
  assert.deepEqual(await sendArcMail(deps, stopB, 'ready', arcReadyEmail(cfg, ctxFor(stopB), 'https://beuk.example/arc/r/y')), { sent: true });
  assert.equal(fake.sent.length, 1);
  assert.equal(fake.sent[0].to, 'stop@example.com');

  // Not me (scope all): no author reaches the address.
  const nmA = await readerIn(db, cfg, a, 'notme@example.com');
  const nmB = await readerIn(db, cfg, b, 'notme@example.com');
  await suppress(db, cfg, 'NotMe@Example.com', 'all');
  assert.equal(await suppressionOf(db, cfg, 'notme@example.com', a.ownerId), 'all');
  assert.equal(await suppressionOf(db, cfg, 'notme@example.com', b.ownerId), 'all');
  for (const to of [nmA, nmB]) {
    const r = await sendArcMail(deps, to, 'code', arcCodeEmail(cfg, ctxFor(to), '000001', CODE_ABOUT));
    assert.equal(r.sent === false && r.reason, 'suppressed');
  }
  assert.equal(fake.sent.length, 1, 'nothing more was sent');
  assert.deepEqual(await events(a.campaignId), [], 'a refusal records nothing');
  assert.deepEqual(await events(b.campaignId), ['ready_sent']);

  // Only hashes are stored: the address is nowhere in the table.
  const rows = await db.query<{ hash: string; scope: string }>('select hash, scope from mail_suppressions');
  assert.ok(rows.rows.length >= 2);
  assert.ok(rows.rows.every((r) => /^[0-9a-f]{64}$/.test(r.hash) && !r.hash.includes('@')));
  assert.equal(rows.rows.filter((r) => r.hash === suppressionHash(cfg, 'stop@example.com')).length, 1);
});

test('the limits count delivered sends only', async () => {
  const cfg = testConfig({ arc: ARC });
  assert.deepEqual(ARC_SEND_LIMITS, { perCampaignHour: 100, perOwnerHour: 200, perOwnerDay: 1000 });

  // A refused send records no event, so it does not count.
  const f = await campaignFor(db);
  const to = await readerIn(db, cfg, f, 'limits@example.com');
  const refusing = new RecordingMailer({ delivered: false, reason: 'SMTP server accepted no recipients', loggedToConsole: false });
  const r = await sendArcMail({ db, config: cfg, arcMailer: refusing, now }, to, 'code', arcCodeEmail(cfg, ctxFor(to), '111111', CODE_ABOUT));
  assert.deepEqual(r, { sent: false, reason: 'refused', detail: 'SMTP server accepted no recipients' });
  assert.equal(refusing.sent.length, 1);
  assert.deepEqual(await events(f.campaignId), []);

  // 100 delivered sends this hour on the campaign → the 101st is refused before the transport.
  const fake = new RecordingMailer();
  const deps = { db, config: cfg, arcMailer: fake, now };
  await db.query(
    `insert into arc_events (campaign_id, recipient_id, kind, at)
     select $1, $2, 'code_sent', $3::timestamptz - interval '1 minute' from generate_series(1, 99)`,
    [f.campaignId, to.recipientId, NOW.toISOString()],
  );
  // Events that are not sends never count (F21: an explicit list of kinds).
  await db.query(
    `insert into arc_events (campaign_id, recipient_id, kind, at)
     select $1, $2, k, $3::timestamptz from unnest(array['claimed', 'downloaded', 'not_me', 'stopped', 'codexsent']) as k`,
    [f.campaignId, to.recipientId, NOW.toISOString()],
  );
  assert.deepEqual(await sendArcMail(deps, to, 'code', arcCodeEmail(cfg, ctxFor(to), '222222', CODE_ABOUT)), { sent: true }, 'the 100th');
  const limited = await sendArcMail(deps, to, 'code', arcCodeEmail(cfg, ctxFor(to), '333333', CODE_ABOUT));
  assert.equal(limited.sent === false && limited.reason, 'rate-limited');
  assert.equal(fake.sent.length, 1);
  // An hour later the campaign may send again.
  const later = await sendArcMail({ ...deps, now: () => new Date(NOW.getTime() + 61 * 60_000) }, to, 'ready', arcReadyEmail(cfg, ctxFor(to), 'https://beuk.example/arc/r/z'));
  assert.deepEqual(later, { sent: true });

  // The owner's limits count every campaign of that owner: 200 an hour, 1000 a day.
  const o1 = await campaignFor(db);
  const o2 = await campaignFor(db, o1.ownerId);
  const o3 = await campaignFor(db, o1.ownerId);
  const t3 = await readerIn(db, cfg, o3, 'owner@example.com');
  for (const c of [o1, o2])
    await db.query(
      `insert into arc_events (campaign_id, kind, at) select $1, 'ready_sent', $2::timestamptz - interval '5 minutes' from generate_series(1, 100)`,
      [c.campaignId, NOW.toISOString()],
    );
  const ownerHour = await sendArcMail(deps, t3, 'code', arcCodeEmail(cfg, ctxFor(t3), '444444', CODE_ABOUT));
  assert.equal(ownerHour.sent === false && ownerHour.reason, 'rate-limited');
  // Two hours on, the hour is clear, the day is not yet full: it goes.
  const twoHours = () => new Date(NOW.getTime() + 2 * 3_600_000);
  assert.deepEqual(await sendArcMail({ ...deps, now: twoHours }, t3, 'code', arcCodeEmail(cfg, ctxFor(t3), '555555', CODE_ABOUT)), { sent: true });
  await db.query(
    `insert into arc_events (campaign_id, kind, at) select $1, 'approved_sent', $2::timestamptz - interval '20 hours' from generate_series(1, 799)`,
    [o2.campaignId, NOW.toISOString()],
  );
  const ownerDay = await sendArcMail({ ...deps, now: twoHours }, t3, 'code', arcCodeEmail(cfg, ctxFor(t3), '666666', CODE_ABOUT));
  assert.equal(ownerDay.sent === false && ownerDay.reason, 'rate-limited');
  assert.match(ownerDay.sent === false ? ownerDay.detail : '', /1000/);
});

test('every reader email carries Not me, Stop, the unsubscribe headers, and no review pressure', async () => {
  const cfg = testConfig({ arc: ARC, appBaseUrl: 'https://beuk.example' });
  const f = await campaignFor(db);
  const to = await readerIn(db, cfg, f, 'every@example.com');
  const ctx = ctxFor(to);
  const notMe = arcActionUrl(cfg, to.mailToken, 'not-me');
  const stopUrl = arcActionUrl(cfg, to.mailToken, 'stop');
  assert.equal(notMe, `https://beuk.example/arc/m/${to.mailToken}/not-me`);
  assert.equal(stopUrl, `https://beuk.example/arc/m/${to.mailToken}/stop`);
  const copy = 'https://beuk.example/arc/r/copy-token';
  const builders: [ArcMailKind, RenderedEmail][] = [
    ['code', arcCodeEmail(cfg, ctx, '123456', CODE_ABOUT)],
    ['ready', arcReadyEmail(cfg, ctx, copy)],
    ['pending', arcPendingEmail(cfg, ctx)],
    ['approved', arcApprovedEmail(cfg, ctx, copy)],
    ['declined', arcDeclinedEmail(cfg, ctx)],
  ];
  // F13: word boundaries, so "however" or "allowed" never trip it.
  const PRESSURE = /\bexchange\b|\bin return\b|\bowe(d|s)?\b|\bmust review\b|\brequired to review\b/i;
  const fake = new RecordingMailer();
  for (const [kind, mail] of builders) {
    for (const body of [mail.text, mail.html]) {
      assert.ok(body.includes(notMe), `${kind}: Not me link`);
      assert.ok(body.includes(stopUrl), `${kind}: Stop link`);
      assert.ok(body.includes('through Beuk'), `${kind}: who it is from`);
      assert.ok(body.includes('Ada Moss'), `${kind}: the author named`);
      assert.ok(body.includes('someone asked for an advance copy of The Salt Road with this address'), `${kind}: why`);
      assert.doesNotMatch(body, PRESSURE, `${kind}: no review pressure`);
      assert.doesNotMatch(body, /Your account|\/account\b/, `${kind}: readers have no account`);
    }
    assert.doesNotMatch(mail.subject, PRESSURE);
    assert.match(mail.html, /^<!doctype html>/);
    assert.match(mail.html, /<html lang="en" dir="ltr">/);
    const out = await sendArcMail({ db, config: cfg, arcMailer: fake, now }, to, kind, mail);
    assert.deepEqual(out, { sent: true }, kind);
    const sent = fake.sent[fake.sent.length - 1];
    assert.equal(sent.to, 'every@example.com');
    assert.equal(sent.subject, mail.subject);
    assert.equal(sent.text, mail.text);
    assert.equal(sent.html, mail.html);
    assert.equal(sent.headers?.['List-Unsubscribe'], `<${stopUrl}>`);
    assert.equal(sent.headers?.['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  }
  assert.deepEqual((await events(f.campaignId)).sort(), ['approved_sent', 'code_sent', 'declined_sent', 'pending_sent', 'ready_sent']);
  for (const [kind, mail] of builders) {
    const offers = mail.text.includes("If you'd like to review it after reading, you're welcome to. It's never required.");
    assert.equal(offers, kind === 'ready' || kind === 'approved', `${kind}: the review line only with a copy`);
    if (kind === 'ready' || kind === 'approved') {
      assert.ok(mail.text.includes(copy) && mail.html.includes(copy), `${kind}: the copy link`);
      assert.ok(mail.text.includes('Your copy shows your name and email on its copyright page.'), `${kind}: the stamp note`);
    }
  }
  assert.ok(builders[0][1].text.includes('123456'), 'the code is in the code email');
});

test('reader emails escape the title and the author, and Arabic turns right to left', () => {
  const cfg = testConfig({ arc: ARC, appBaseUrl: 'https://beuk.example' });
  const hostile = '<b>Tom & "Jerry"</b>‮';
  const m = arcReadyEmail(cfg, { lang: 'en', title: hostile, author: hostile, mailToken: 'tok' }, 'https://beuk.example/arc/r/a?b=1&c=2');
  assert.doesNotMatch(m.html, /<b>Tom/);
  assert.ok(m.html.includes('&lt;b&gt;Tom &amp; &quot;Jerry&quot;&lt;/b&gt;'));
  assert.ok(m.html.includes('href="https://beuk.example/arc/r/a?b=1&amp;c=2"'));
  assert.ok(m.text.includes(hostile), 'plain text keeps the text as typed');
  const ar = arcPendingEmail(cfg, { lang: 'ar', title: 'T', author: 'A', mailToken: 'tok' });
  assert.match(ar.html, /<html lang="ar" dir="rtl">/);
});

test('the string table: languages, fallbacks and the fixed English lines', () => {
  assert.equal(arcLang('es-MX'), 'es');
  assert.equal(arcLang('zh-Hant'), 'zh-Hans');
  assert.equal(arcLang('zh'), 'zh-Hans');
  assert.equal(arcLang('en-GB'), 'en');
  assert.equal(arcLang('PT-br'), 'pt');
  // Rulings F17 + M8 (Task 9): Hindi and Marathi are interface languages
  // now, so 'hi' maps to itself (the plan's arcLang('hi') === 'en' is superseded).
  assert.equal(arcLang('hi'), 'hi');
  assert.equal(arcLang('sw'), 'en');
  assert.equal(arcLang(''), 'en');
  assert.equal(arcDir('ar'), 'rtl');
  assert.equal(arcDir('en'), 'ltr');
  const t = arcT('en');
  assert.equal(t('arc.stamp', { name: 'Sarah', email: 'sarah@example.com' }), 'Advance Review Copy prepared for Sarah (sarah@example.com)');
  assert.equal(t('arc.mail.review'), "If you'd like to review it after reading, you're welcome to. It's never required.");
  assert.equal(t('arc.mail.stampNote'), 'Your copy shows your name and email on its copyright page.');
  // A key a language's table lacks falls back to English (Task 9: every
  // table has every key but the English-only ones, such as the stamp, F16).
  assert.equal(arcT('de')('arc.stamp', { name: 'Sarah', email: 'sarah@example.com' }), 'Advance Review Copy prepared for Sarah (sarah@example.com)');
  // A value is filled once: a {placeholder} inside a value stays as typed.
  assert.equal(t('arc.stamp', { name: '{email}', email: 'x@y.z' }), 'Advance Review Copy prepared for {email} (x@y.z)');
});

test('the author is told a reader is waiting, in the account layout', () => {
  const cfg = testConfig({ appBaseUrl: 'https://beuk.example', mailFrom: 'Beuk <hello@beuk.studio>' });
  const one = arcAuthorWaitingEmail(cfg, 'The Salt Road', 1);
  const many = arcAuthorWaitingEmail(cfg, 'The Salt Road', 3);
  assert.match(one.subject, /The Salt Road/);
  assert.ok(one.text.includes('1 reader is waiting for your approval'), one.text);
  assert.ok(many.text.includes('3 readers are waiting for your approval'), many.text);
  assert.ok(one.text.includes('Your account: https://beuk.example/account'), 'account mail keeps its footer');
  assert.doesNotMatch(one.text + one.html, /\/arc\/m\//, 'no reader links in the author email');
});
