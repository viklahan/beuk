import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { NEVER_PAUSED } from '../src/access.js';
import type { Db } from '../src/db.js';
import { readZip } from '../src/housekeeping/packages.js';
import { SELF_CHECK_CASES, type CheckContext } from '../src/housekeeping/registry.js';
import type { MailMessage, Mailer, MailerStatus, MailResult } from '../src/mailer.js';
import { base32Decode, totpCode, totpStep } from '../src/twostep/totp.js';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';

/*
 * Account hardening, Task 2: where you're signed in (the session list,
 * device labels, signing one device out, last_seen_at), the security
 * emails, security.json in Download all my data, the registry check and
 * the privacy text. The server runs on an injected clock (TOTP steps);
 * last_seen_at follows the database clock, so its test backdates rows.
 */

const PASSWORD = 'correct horse battery';
let clockMs = Date.parse('2026-11-09T12:00:00Z');
const now = () => new Date(clockMs);
const tick = () => {
  clockMs += 30_000;
};

const UA = {
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68',
  winOpera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:132.0) Gecko/20100101 Firefox/132.0',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/130.2849.80 Mobile/15E148 Safari/605.1.15',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.102 Mobile Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

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

/** The security emails by subject (the copy V signs off). */
const SUBJECTS: Record<string, string> = {
  'New sign-in to your Beuk account': 'security-new-sign-in',
  'Two-step sign-in is on for your Beuk account': 'security-two-step-on',
  'Two-step sign-in is off for your Beuk account': 'security-two-step-off',
  'A recovery code was used on your Beuk account': 'security-recovery-used',
  'New recovery codes for your Beuk account': 'security-recovery-new',
};

let db: Db;
let server: TestServer;
const mailer = new RecordingMailer();

before(async () => {
  db = await createTestDb();
  server = await startTestServer(db, now, {}, undefined, { mailer });
});

after(async () => {
  await server.close();
});

let seq = 0;
async function writer(ua = UA.winChrome): Promise<{ c: Client; email: string; id: string }> {
  const email = `s-${++seq}@example.com`;
  const c = new Client(server.base);
  const r = await c.request('POST', '/api/auth/register', { email, password: PASSWORD }, { 'user-agent': ua });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = (await db.query<{ id: string }>('select id from users where email = $1', [email])).rows[0].id;
  return { c, email, id };
}

async function signIn(email: string, ua = UA.winChrome): Promise<Client> {
  const c = new Client(server.base);
  const r = await c.request('POST', '/api/auth/login', { email, password: PASSWORD }, { 'user-agent': ua });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!r.body.twoStep, 'plain sign-in');
  return c;
}

/** Security emails sent to `to` since the mark, as kinds (in order). */
async function securityMailSince(mark: number, to: string): Promise<{ kind: string; m: MailMessage }[]> {
  await server.settle();
  return mailer.sent
    .slice(mark)
    .filter((m) => m.to === to && SUBJECTS[m.subject])
    .map((m) => ({ kind: SUBJECTS[m.subject], m }));
}

const codeAt = (secretB32: string) => totpCode(base32Decode(secretB32), totpStep(clockMs));

async function turnOn(c: Client): Promise<{ secret: string; recoveryCodes: string[] }> {
  const s = await c.post('/api/account/two-step/start', { currentPassword: PASSWORD });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const secret = s.body.secret as string;
  tick();
  const e = await c.post('/api/account/two-step/enable', { code: codeAt(secret) });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  return { secret, recoveryCodes: e.body.recoveryCodes as string[] };
}

interface SessionRow {
  id: string;
  label: string;
  createdAt: string;
  lastSeenAt: string | null;
  current: boolean;
}

/* ---------------- device labels ---------------- */

test('deviceLabel: "{Browser} on {OS}", coarse buckets, no versions; empty is "A browser on another system"', async () => {
  const { deviceLabel } = await import('../src/account/device.js');
  const table: Array<[string, string]> = [
    [UA.winChrome, 'Chrome on Windows'],
    [UA.winEdge, 'Edge on Windows'],
    [UA.winOpera, 'Opera on Windows'],
    [UA.macSafari, 'Safari on macOS'],
    [UA.macFirefox, 'Firefox on macOS'],
    [UA.iphoneSafari, 'Safari on iPhone'],
    [UA.iphoneChrome, 'Chrome on iPhone'],
    [UA.iphoneFirefox, 'Firefox on iPhone'],
    [UA.iphoneEdge, 'Edge on iPhone'],
    [UA.ipad, 'Safari on iPad'],
    [UA.androidChrome, 'Chrome on Android'],
    [UA.linuxFirefox, 'Firefox on Linux'],
    [UA.chromeOs, 'Chrome on ChromeOS'],
    ['', 'A browser on another system'],
    ['curl/8.4.0', 'A browser on another system'],
    ['node', 'A browser on another system'],
  ];
  for (const [ua, want] of table) {
    const got = deviceLabel(ua);
    assert.equal(got, want, ua || '(empty)');
    assert.doesNotMatch(got, /\d/, 'no version numbers');
  }
  // A hostile or giant header still gives one of the buckets.
  assert.equal(deviceLabel('x'.repeat(10_000) + ' Firefox/1'), 'Firefox on another system');
  assert.equal(deviceLabel(undefined as unknown as string), 'A browser on another system');
});

/* ---------------- the session list ---------------- */

test('sessions: two sign-ins list two sessions, newest first, current true on exactly one', async () => {
  const w = await writer(UA.winChrome); // register: session 1, labelled too
  const anon = await new Client(server.base).get('/api/account/sessions');
  assert.equal(anon.status, 401);
  const phone = await signIn(w.email, UA.iphoneSafari);
  const list = await phone.get('/api/account/sessions');
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const sessions = list.body.sessions as SessionRow[];
  assert.equal(sessions.length, 2);
  assert.equal(sessions.filter((s) => s.current).length, 1);
  for (const s of sessions) {
    assert.deepEqual(Object.keys(s).sort(), ['createdAt', 'current', 'id', 'label', 'lastSeenAt']);
    assert.match(s.id, /^[0-9a-f-]{36}$/);
    assert.ok(!Number.isNaN(Date.parse(s.createdAt)));
    assert.ok(s.lastSeenAt && !Number.isNaN(Date.parse(s.lastSeenAt)), 'last_seen_at is set at creation');
  }
  const mine = sessions.find((s) => s.current)!;
  assert.equal(mine.label, 'Safari on iPhone');
  assert.equal(sessions.find((s) => !s.current)!.label, 'Chrome on Windows', 'the sign-up session has a label');
  assert.equal(sessions[0].current, true, 'the newest lastSeenAt first');
  // The other device sees the same two, with its own row current.
  const fromPc = (await w.c.get('/api/account/sessions')).body.sessions as SessionRow[];
  assert.equal(fromPc.length, 2);
  assert.equal(fromPc.find((s) => s.current)!.label, 'Chrome on Windows');
  // Newest lastSeenAt first, by the stored value (the PC's row is not refreshed within 10 minutes).
  const stored = await db.query<{ id: string; last_seen_at: Date }>(
    'select id, last_seen_at from sessions where user_id = $1 order by last_seen_at desc, created_at desc',
    [w.id],
  );
  assert.deepEqual(fromPc.map((s) => s.id), stored.rows.map((r) => r.id));
});

test('sessions: revoking the other one gives 204 and its cookie then gets 401 on /api/auth/me', async () => {
  const w = await writer();
  const other = await signIn(w.email, UA.linuxFirefox);
  const list = (await w.c.get('/api/account/sessions')).body.sessions as SessionRow[];
  const target = list.find((s) => !s.current)!;
  const r = await w.c.post(`/api/account/sessions/${target.id}/revoke`);
  assert.equal(r.status, 204);
  assert.equal((await other.get('/api/auth/me')).status, 401);
  assert.equal((await w.c.get('/api/auth/me')).status, 200, 'this device stays signed in');
  const after = (await w.c.get('/api/account/sessions')).body.sessions as SessionRow[];
  assert.equal(after.length, 1);
  // Revoking it again: it is gone, so 404.
  assert.equal((await w.c.post(`/api/account/sessions/${target.id}/revoke`)).status, 404);
});

test('sessions: revoking the current one gives 400 and you stay signed in', async () => {
  const w = await writer();
  const list = (await w.c.get('/api/account/sessions')).body.sessions as SessionRow[];
  const current = list.find((s) => s.current)!;
  const r = await w.c.post(`/api/account/sessions/${current.id}/revoke`);
  assert.equal(r.status, 400);
  assert.equal(typeof r.body.error, 'string');
  assert.equal((await w.c.get('/api/auth/me')).status, 200);
  assert.equal(((await w.c.get('/api/account/sessions')).body.sessions as SessionRow[]).length, 1);
});

test("sessions: another user's session id, an unknown id and a malformed id give 404", async () => {
  const a = await writer();
  const b = await writer();
  const bList = (await b.c.get('/api/account/sessions')).body.sessions as SessionRow[];
  const r = await a.c.post(`/api/account/sessions/${bList[0].id}/revoke`);
  assert.equal(r.status, 404);
  assert.equal((await b.c.get('/api/auth/me')).status, 200, "b's session is untouched");
  assert.equal((await a.c.post('/api/account/sessions/00000000-0000-4000-8000-000000000000/revoke')).status, 404);
  assert.equal((await a.c.post('/api/account/sessions/not-a-uuid/revoke')).status, 404);
  assert.equal((await new Client(server.base).post(`/api/account/sessions/${bList[0].id}/revoke`)).status, 401);
});

test('sessions: the list and single sign-out are never paused', () => {
  assert.ok(NEVER_PAUSED.some((r) => r.method === 'GET' && r.path === '/api/account/sessions'));
  assert.ok(NEVER_PAUSED.some((r) => r.method === 'POST' && r.path === '/api/account/sessions/:id/revoke'));
});

test('last_seen_at: not rewritten within 10 minutes, rewritten after 10 minutes', async () => {
  const w = await writer();
  const row = async () =>
    (await db.query<{ id: string; last_seen_at: Date | string }>('select id, last_seen_at from sessions where user_id = $1', [w.id])).rows[0];
  const first = await row();
  assert.ok(first.last_seen_at, 'set at creation');
  // 9 minutes ago: a request does not rewrite it.
  await db.query(`update sessions set last_seen_at = now() - interval '9 minutes' where id = $1`, [first.id]);
  const nine = new Date((await row()).last_seen_at).getTime();
  assert.equal((await w.c.get('/api/auth/me')).status, 200);
  assert.equal(new Date((await row()).last_seen_at).getTime(), nine, 'unchanged within 10 minutes');
  // 11 minutes ago: the next request refreshes it.
  await db.query(`update sessions set last_seen_at = now() - interval '11 minutes' where id = $1`, [first.id]);
  const eleven = new Date((await row()).last_seen_at).getTime();
  assert.equal((await w.c.get('/api/auth/me')).status, 200);
  const refreshed = new Date((await row()).last_seen_at).getTime();
  assert.ok(refreshed > eleven + 10 * 60_000, `refreshed (${refreshed - eleven} ms later)`);
  // A session from before migration 025 (null) is filled in on its next request.
  await db.query('update sessions set last_seen_at = null where id = $1', [first.id]);
  assert.equal((await w.c.get('/api/auth/me')).status, 200);
  assert.ok((await row()).last_seen_at);
});

test('sessions: no IP address column exists', async () => {
  const cols = (
    await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'sessions'`,
    )
  ).rows.map((r) => r.column_name);
  assert.ok(cols.includes('label') && cols.includes('last_seen_at'), cols.join(', '));
  for (const c of cols) assert.doesNotMatch(c, /(^|_)ip(_|$)|address|user_agent/, `sessions.${c}`);
});

/* ---------------- security emails ---------------- */

test('emails: a second sign-in with the same label sends none; a new label sends security-new-sign-in', async () => {
  const w = await writer(UA.winChrome);
  let mark = mailer.sent.length;
  await signIn(w.email, UA.winChrome);
  assert.deepEqual(await securityMailSince(mark, w.email), [], 'same device label as a live session: no email');

  mark = mailer.sent.length;
  await signIn(w.email, UA.androidChrome);
  const got = await securityMailSince(mark, w.email);
  assert.deepEqual(got.map((g) => g.kind), ['security-new-sign-in']);
  const m = got[0].m;
  assert.ok(m.text.includes('Chrome on Android'), m.text);
  assert.ok(m.text.includes("If this wasn't you, change your password and sign out everywhere."), m.text);
  assert.ok(m.text.includes(`${server.config.appBaseUrl}/account`));
  assert.ok(m.html && m.html.includes(`href="${server.config.appBaseUrl}/account"`));
  assert.doesNotMatch(m.text, /!/);

  // A revoked device's label no longer counts: signing in from it again mails again.
  mark = mailer.sent.length;
  const list = (await w.c.get('/api/account/sessions')).body.sessions as SessionRow[];
  const android = list.find((s) => s.label === 'Chrome on Android')!;
  assert.equal((await w.c.post(`/api/account/sessions/${android.id}/revoke`)).status, 204);
  await signIn(w.email, UA.androidChrome);
  assert.deepEqual((await securityMailSince(mark, w.email)).map((g) => g.kind), ['security-new-sign-in']);
});

test('emails: sign-up itself sends no new-sign-in email (the welcome covers it)', async () => {
  const mark = mailer.sent.length;
  const w = await writer(UA.macSafari);
  assert.deepEqual(await securityMailSince(mark, w.email), []);
});

test('emails: two-step on and off each send their kind; a recovery code sends security-recovery-used with "9"', async () => {
  const w = await writer(UA.winChrome);
  let mark = mailer.sent.length;
  const { secret, recoveryCodes } = await turnOn(w.c);
  let got = await securityMailSince(mark, w.email);
  assert.deepEqual(got.map((g) => g.kind), ['security-two-step-on']);
  assert.ok(got[0].m.text.includes("If this wasn't you, change your password and sign out everywhere."));

  // Sign in with a recovery code, from the same kind of device: only the recovery email.
  mark = mailer.sent.length;
  const c = new Client(server.base);
  const login = await c.request('POST', '/api/auth/login', { email: w.email, password: PASSWORD }, { 'user-agent': UA.winChrome });
  assert.equal(login.body.twoStep, true);
  const code = await c.request('POST', '/api/auth/login/code', { challenge: login.body.challenge, code: recoveryCodes[0] }, { 'user-agent': UA.winChrome });
  assert.equal(code.status, 200, JSON.stringify(code.body));
  got = await securityMailSince(mark, w.email);
  assert.deepEqual(got.map((g) => g.kind), ['security-recovery-used']);
  assert.match(got[0].m.text, /\b9\b/);
  assert.ok(got[0].m.text.includes('9 recovery codes are left'), got[0].m.text);

  // The code step from a new device label: the new-sign-in email as well.
  mark = mailer.sent.length;
  const d = new Client(server.base);
  const l2 = await d.request('POST', '/api/auth/login', { email: w.email, password: PASSWORD }, { 'user-agent': UA.ipad });
  tick();
  const c2 = await d.request('POST', '/api/auth/login/code', { challenge: l2.body.challenge, code: codeAt(secret) }, { 'user-agent': UA.ipad });
  assert.equal(c2.status, 200, JSON.stringify(c2.body));
  got = await securityMailSince(mark, w.email);
  assert.deepEqual(got.map((g) => g.kind), ['security-new-sign-in']);
  assert.ok(got[0].m.text.includes('Safari on iPad'));

  // New recovery codes with an authenticator code: only the new-codes email.
  mark = mailer.sent.length;
  tick();
  const fresh = await w.c.post('/api/account/two-step/recovery-codes', { currentPassword: PASSWORD, code: codeAt(secret) });
  assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
  assert.deepEqual((await securityMailSince(mark, w.email)).map((g) => g.kind), ['security-recovery-new']);

  // New recovery codes paid for with a recovery code: both emails (T1-M4).
  mark = mailer.sent.length;
  const newCodes = fresh.body.recoveryCodes as string[];
  const again = await w.c.post('/api/account/two-step/recovery-codes', { currentPassword: PASSWORD, code: newCodes[0] });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  got = await securityMailSince(mark, w.email);
  assert.deepEqual(got.map((g) => g.kind).sort(), ['security-recovery-new', 'security-recovery-used']);
  assert.ok(got.find((g) => g.kind === 'security-recovery-used')!.m.text.includes('10 recovery codes are left'));

  // Turning it off with a recovery code: only the off email (T1-M4: off covers it).
  mark = mailer.sent.length;
  const lastCodes = again.body.recoveryCodes as string[];
  const off = await w.c.post('/api/account/two-step/disable', { currentPassword: PASSWORD, code: lastCodes[0] });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  got = await securityMailSince(mark, w.email);
  assert.deepEqual(got.map((g) => g.kind), ['security-two-step-off']);
  assert.ok(got[0].m.text.includes("If this wasn't you, change your password and sign out everywhere."));

  // A refused change sends nothing.
  mark = mailer.sent.length;
  assert.equal((await w.c.post('/api/account/two-step/disable', { currentPassword: 'wrong password', code: '123456' })).status, 403);
  assert.deepEqual(await securityMailSince(mark, w.email), []);
});

test('emails: a failing mailer is logged, never surfaced', async () => {
  const failing = new RecordingMailer();
  failing.send = async () => {
    throw new Error('smtp down');
  };
  const s = await startTestServer(db, now, {}, undefined, { mailer: failing });
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => {
    errors.push(a);
  };
  try {
    const email = `fail-${++seq}@example.com`;
    const c = new Client(s.base);
    assert.equal((await c.request('POST', '/api/auth/register', { email, password: PASSWORD }, { 'user-agent': UA.winChrome })).status, 201);
    await s.settle();
    errors.length = 0; // the welcome email's failure; only the sign-in's counts below
    const d = new Client(s.base);
    const r = await d.request('POST', '/api/auth/login', { email, password: PASSWORD }, { 'user-agent': UA.linuxFirefox });
    assert.equal(r.status, 200);
    await s.settle();
    assert.equal((await d.get('/api/auth/me')).status, 200);
    assert.ok(errors.length >= 1, 'the new-sign-in email failure was logged');
  } finally {
    console.error = orig;
    await s.close();
  }
});

/* ---------------- Download all my data ---------------- */

test('export: security.json has {twoStep:{on,since,recoveryLeft}, sessions:[{label,createdAt,lastSeenAt}]} and no secret, hash or token', async () => {
  const w = await writer(UA.winChrome);
  await signIn(w.email, UA.macSafari);
  const { secret, recoveryCodes } = await turnOn(w.c);
  const res = await w.c.download('/api/account/export');
  assert.equal(res.status, 200);
  const entries = readZip(res.bytes);
  const entry = entries.find((e) => e.name === 'security.json');
  assert.ok(entry, `security.json in ${entries.map((e) => e.name).join(', ')}`);
  const sec = JSON.parse(entry.data.toString('utf8'));
  assert.deepEqual(Object.keys(sec).sort(), ['sessions', 'twoStep']);
  assert.deepEqual(Object.keys(sec.twoStep).sort(), ['on', 'recoveryLeft', 'since']);
  assert.equal(sec.twoStep.on, true);
  assert.equal(sec.twoStep.recoveryLeft, 10);
  assert.ok(!Number.isNaN(Date.parse(sec.twoStep.since)));
  assert.equal(sec.sessions.length, 2);
  for (const s of sec.sessions) assert.deepEqual(Object.keys(s).sort(), ['createdAt', 'label', 'lastSeenAt']);
  assert.deepEqual(sec.sessions.map((s: { label: string }) => s.label).sort(), ['Chrome on Windows', 'Safari on macOS']);

  const readme = entries.find((e) => e.name === 'README.txt')!.data.toString('utf8');
  assert.match(readme, /security\.json/);

  // Neither the raw ZIP bytes nor any unpacked entry carries a key.
  const hashes = [
    ...(await db.query<{ h: string }>('select code_hash as h from two_step_recovery_codes where user_id = $1', [w.id])).rows.map((r) => r.h),
    ...(await db.query<{ h: string }>('select token_hash as h from sessions where user_id = $1', [w.id])).rows.map((r) => r.h),
  ];
  const needles = [secret, secret.toLowerCase(), ...recoveryCodes, ...recoveryCodes.map((c) => c.replace('-', '')), ...hashes, 'code_hash', 'token_hash', 'secret'];
  const unpacked = entries.map((e) => e.data.toString('utf8')).join('\n');
  const rawText = res.bytes.toString('latin1');
  for (const n of needles) {
    assert.ok(!rawText.includes(n), `${n} in the ZIP bytes`);
    assert.ok(!unpacked.includes(n), `${n} in an unpacked entry`);
  }
  assert.equal(entry.method, 8, 'security.json is deflated, so the raw-bytes check alone would prove nothing');
});

/* ---------------- housekeeping ---------------- */

test('registry: the account-hardening check passes on a live schema and names the three tables', async () => {
  const c = SELF_CHECK_CASES.find((x) => x.id === 'account.hardening.tables-and-export');
  assert.ok(c && c.kind === 'server' && c.run, 'the check is registered');
  assert.match(c.title, /user_two_step/);
  const detail = String(await c.run!({ db } as CheckContext));
  for (const t of ['user_two_step', 'two_step_recovery_codes', 'sign_in_challenges', 'security.json']) assert.match(detail, new RegExp(t.replace('.', '\\.')));
});

/* ---------------- privacy ---------------- */

test('legal: privacy.md mentions the device label, "no IP address", two-step and the security emails', () => {
  const md = readFileSync(path.resolve(import.meta.dirname, '..', 'content', 'legal', 'privacy.md'), 'utf8');
  const section = md.slice(md.indexOf('## Signing in safely'));
  assert.ok(md.includes('## Signing in safely'), 'the section exists');
  for (const words of ['device label', 'no IP address', 'two-step', 'recovery codes', 'security emails', 'Firefox on Windows']) {
    assert.ok(section.includes(words), `the section mentions ${words}`);
  }
  assert.ok(md.indexOf('## Signing in safely') > md.indexOf('## Your authorship record'), 'beside the authorship record');
  assert.ok(!md.includes('with no IP address and no device details'), 'the cookie bullet no longer says no device details');
});
