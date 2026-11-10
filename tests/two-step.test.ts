import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import express from 'express';
import { buildApp } from '../src/app.js';
import { NEVER_PAUSED, ACCESS_RULES, PAUSABLE_FEATURES, pausedBody } from '../src/access.js';
import type { Db } from '../src/db.js';
import { authRoutes } from '../src/routes/auth.js';
import {
  base32Decode,
  base32Encode,
  newRecoveryCodes,
  normalizeRecovery,
  totpCode,
  totpStep,
} from '../src/twostep/totp.js';
import { turnTwoStepOff, twoStepStatus, verifySecondFactor } from '../src/twostep/store.js';
import { Client, createTestDb, registerUser, testConfig } from './helpers.js';

/*
 * Two-step sign-in (account hardening, migration 025): TOTP (RFC 6238),
 * recovery codes, the login code step and the per-account sign-in limit.
 * The server runs on an injected clock (deps.now), so every code here is
 * computed for a known 30-second step; the clock only moves forward.
 */

const PASSWORD = 'correct horse battery';
const DAY = 86_400_000;
let clockMs = Date.parse('2026-11-09T12:00:00Z');
const now = () => new Date(clockMs);
/** Move to the next 30 s step, so the next code is always unused. */
const tick = () => {
  clockMs += 30_000;
};

let db: Db;
interface Srv {
  base: string;
  close: () => Promise<void>;
}
let open: Srv; // billing off: everything open
let paid: Srv; // billing on (test keys, no network needed for the gate)

async function start(overrides: Parameters<typeof testConfig>[0] = {}): Promise<Srv> {
  const config = testConfig(overrides);
  const app = buildApp({ db, config, now });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

before(async () => {
  db = await createTestDb();
  open = await start();
  paid = await start({
    stripeWebhookSecret: 'whsec_test_placeholder_not_a_real_key',
    stripeSecretKey: 'sk_test_placeholder_not_a_real_key',
    stripePriceId: 'price_fixture_one',
    stripeApiBase: 'http://127.0.0.1:9',
  });
});

after(async () => {
  await open.close();
  await paid.close();
});

let seq = 0;
async function writer(base = open.base, label = 'w'): Promise<{ c: Client; email: string; id: string }> {
  const email = `${label}-${++seq}@example.com`;
  const c = new Client(base);
  const r = await registerUser(c, email, PASSWORD);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = (await db.query<{ id: string }>('select id from users where email = $1', [email])).rows[0].id;
  return { c, email, id };
}

const codeAt = (secretB32: string, offset = 0) => totpCode(base32Decode(secretB32), totpStep(clockMs) + offset);

/** start + enable: returns the base32 secret and the recovery codes. */
async function turnOn(c: Client): Promise<{ secret: string; recoveryCodes: string[] }> {
  const s = await c.post('/api/account/two-step/start', { currentPassword: PASSWORD });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const secret = s.body.secret as string;
  tick();
  const e = await c.post('/api/account/two-step/enable', { code: codeAt(secret) });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  return { secret, recoveryCodes: e.body.recoveryCodes as string[] };
}

/** Raw POST (status, text, set-cookie), for byte-level checks. */
async function rawPost(base: string, p: string, body: unknown): Promise<{ status: number; text: string; setCookie: string | null }> {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, text: await r.text(), setCookie: r.headers.get('set-cookie') };
}

async function challengeFor(base: string, email: string): Promise<string> {
  const r = await rawPost(base, '/api/auth/login', { email, password: PASSWORD });
  assert.equal(r.status, 200, r.text);
  const body = JSON.parse(r.text) as { twoStep?: boolean; challenge?: string };
  assert.equal(body.twoStep, true);
  assert.equal(typeof body.challenge, 'string');
  return body.challenge!;
}

/* ---------------- pure pieces ---------------- */

test('TOTP: RFC 6238 Appendix B SHA1 vectors (last 6 digits)', () => {
  const secret = Buffer.from('12345678901234567890', 'ascii');
  const vectors: Array<[number, string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ];
  for (const [t, want] of vectors) assert.equal(totpCode(secret, totpStep(t * 1000)), want, `T=${t}`);
});

test('base32 (RFC 4648, no padding) round-trips', () => {
  assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
  assert.equal(base32Encode(Buffer.from('f')), 'MY');
  assert.deepEqual(base32Decode('MZXW6YTBOI'), Buffer.from('foobar'));
  assert.deepEqual(base32Decode('mzxw 6ytb oi'), Buffer.from('foobar'), 'case and spaces ignored');
  for (let n = 0; n <= 25; n++) {
    const b = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + n) & 255));
    const enc = base32Encode(b);
    assert.ok(!enc.includes('='), 'no padding');
    assert.deepEqual(base32Decode(enc), b, `length ${n}`);
  }
  assert.equal(base32Encode(Buffer.alloc(20)).length, 32, '20 bytes → 32 characters');
});

test('recovery codes: 10 codes, XXXXX-XXXXX from the alphabet; input shape does not matter', () => {
  const codes = newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{5}-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{5}$/);
  const want = normalizeRecovery('ABCDE-FGHJK');
  assert.equal(want, 'ABCDEFGHJK');
  assert.equal(normalizeRecovery('abcde fghjk'), want);
  assert.equal(normalizeRecovery('abcdefghjk'), want);
});

test('access: twoStep.setup pauses start + enable; disable, recovery codes and the login code step are never paused', () => {
  assert.equal(PAUSABLE_FEATURES['twoStep.setup'], 'turning on two-step sign-in');
  const gated = ACCESS_RULES.filter((r) => r.feature === 'twoStep.setup').map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(gated, ['POST /api/account/two-step/start', 'POST /api/account/two-step/enable']);
  for (const p of ['/api/account/two-step/disable', '/api/account/two-step/recovery-codes', '/api/auth/login/code', '/api/auth/login']) {
    assert.ok(NEVER_PAUSED.some((r) => r.method === 'POST' && r.path === p), `${p} is never paused`);
  }
});

/* ---------------- setup ---------------- */

test('start: needs the password, gives secret + otpauth URI + inline SVG; replaces a pending setup', async () => {
  const w = await writer();
  assert.equal((await new Client(open.base).post('/api/account/two-step/start', { currentPassword: PASSWORD })).status, 401);
  const bad = await w.c.post('/api/account/two-step/start', { currentPassword: 'not the password' });
  assert.equal(bad.status, 403);
  assert.equal(bad.body.error, 'current password is incorrect');

  const s = await w.c.post('/api/account/two-step/start', { currentPassword: PASSWORD });
  assert.equal(s.status, 200);
  const secret = s.body.secret as string;
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.equal(base32Decode(secret).length, 20);
  assert.equal(
    s.body.otpauthUri,
    `otpauth://totp/Beuk:${encodeURIComponent(w.email)}?secret=${secret}&issuer=Beuk&algorithm=SHA1&digits=6&period=30`,
  );
  assert.match(String(s.body.qrSvg), /^<svg[\s\S]*<\/svg>\s*$/);

  // Still off while pending.
  assert.deepEqual(await twoStepStatus(db, w.id), { on: false, since: null, recoveryLeft: 0 });
  const again = await w.c.post('/api/account/two-step/start', { currentPassword: PASSWORD });
  assert.equal(again.status, 200);
  assert.notEqual(again.body.secret, secret, 'a new start replaces the pending secret');
  tick();
  // The first secret no longer finishes setup.
  assert.equal((await w.c.post('/api/account/two-step/enable', { code: codeAt(secret) })).status, 400);
});

test('enable: no pending setup 409, wrong code 400, right code gives 10 recovery codes; start again 409', async () => {
  const w = await writer();
  assert.equal((await w.c.post('/api/account/two-step/enable', { code: '123456' })).status, 409);
  const s = await w.c.post('/api/account/two-step/start', { currentPassword: PASSWORD });
  const secret = s.body.secret as string;
  tick();
  const wrongCode = codeAt(secret) === '000000' ? '111111' : '000000';
  const wrong = await w.c.post('/api/account/two-step/enable', { code: wrongCode });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, "that code didn't work");
  const ok = await w.c.post('/api/account/two-step/enable', { code: codeAt(secret) });
  assert.equal(ok.status, 200);
  const codes = ok.body.recoveryCodes as string[];
  assert.equal(codes.length, 10);
  const st = await twoStepStatus(db, w.id);
  assert.equal(st.on, true);
  assert.equal(st.recoveryLeft, 10);
  assert.equal(st.since, now().toISOString());
  // Only hashes are stored.
  const stored = await db.query<{ code_hash: string }>('select code_hash from two_step_recovery_codes where user_id = $1', [w.id]);
  assert.equal(stored.rows.length, 10);
  for (const r of stored.rows) assert.match(r.code_hash, /^[0-9a-f]{64}$/);
  assert.ok(!stored.rows.some((r) => codes.includes(r.code_hash)));

  const startAgain = await w.c.post('/api/account/two-step/start', { currentPassword: PASSWORD });
  assert.equal(startAgain.status, 409);
});

/* ---------------- signing in ---------------- */

test('start → enable → login: password step gives a challenge and no cookie; the code gives {user} + cookie; replay 401', async () => {
  const w = await writer();
  const { secret } = await turnOn(w.c);

  const r = await rawPost(open.base, '/api/auth/login', { email: w.email, password: PASSWORD });
  assert.equal(r.status, 200);
  assert.equal(r.setCookie, null, 'no session cookie before the code');
  const body = JSON.parse(r.text) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ['challenge', 'twoStep']);
  assert.equal(body.twoStep, true);
  assert.match(String(body.challenge), /^[A-Za-z0-9_-]{43}$/, '32 random bytes, base64url');
  // Stored hashed, with a 5-minute expiry.
  const row = (
    await db.query<{ token_hash: string; expires_at: Date }>('select token_hash, expires_at from sign_in_challenges where user_id = $1', [w.id])
  ).rows[0];
  assert.notEqual(row.token_hash, body.challenge);
  assert.equal(new Date(row.expires_at).getTime(), clockMs + 5 * 60_000);

  tick();
  const code = codeAt(secret);
  const c = new Client(open.base);
  const ok = await c.post('/api/auth/login/code', { challenge: body.challenge, code });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body, { user: { id: w.id, email: w.email } });
  assert.match(ok.headers.get('set-cookie') ?? '', /beuk_session=/);
  assert.equal((await c.get('/api/auth/me')).status, 200);
  // The challenge is single use.
  assert.equal((await c.post('/api/auth/login/code', { challenge: body.challenge, code })).status, 410);

  // The same code on a fresh challenge: a replay.
  const ch2 = await challengeFor(open.base, w.email);
  const replay = await new Client(open.base).post('/api/auth/login/code', { challenge: ch2, code });
  assert.equal(replay.status, 401);
  assert.deepEqual(replay.body, { error: "that code didn't work" });
  assert.equal(replay.headers.get('set-cookie'), null);
});

test('clock skew: a code from step −1 is accepted, from step −2 refused', async () => {
  const w = await writer();
  const { secret } = await turnOn(w.c);
  tick();
  tick();
  tick();
  const ch = await challengeFor(open.base, w.email);
  assert.equal((await new Client(open.base).post('/api/auth/login/code', { challenge: ch, code: codeAt(secret, -2) })).status, 401);
  assert.equal((await new Client(open.base).post('/api/auth/login/code', { challenge: ch, code: codeAt(secret, -1) })).status, 200);
});

test('two tabs racing one code: one success, one 401', async () => {
  const w = await writer();
  const { secret } = await turnOn(w.c);
  tick();
  const [a, b] = [await challengeFor(open.base, w.email), await challengeFor(open.base, w.email)];
  const code = codeAt(secret);
  const results = await Promise.all([
    new Client(open.base).post('/api/auth/login/code', { challenge: a, code }),
    new Client(open.base).post('/api/auth/login/code', { challenge: b, code }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);

  // The same race one level down, both checks started in the same tick.
  tick();
  const same = codeAt(secret);
  const kinds = await Promise.all([
    verifySecondFactor(db, w.id, same, clockMs),
    verifySecondFactor(db, w.id, same, clockMs),
  ]);
  assert.deepEqual(kinds.map(String).sort(), ['null', 'totp']);
});

test('recovery codes: any input shape works once; recoveryLeft drops; the hook says how many are left', async () => {
  const w = await writer();
  const { recoveryCodes } = await turnOn(w.c);
  const shapes = [
    recoveryCodes[1].toLowerCase().replace('-', ' '), // abcde fghjk
    recoveryCodes[2], // ABCDE-FGHJK
    recoveryCodes[3].toLowerCase().replace('-', ''), // abcdefghjk
  ];
  for (const [i, shape] of shapes.entries()) {
    const ch = await challengeFor(open.base, w.email);
    const r = await new Client(open.base).post('/api/auth/login/code', { challenge: ch, code: shape });
    assert.equal(r.status, 200, `shape ${i}: ${shape}`);
  }
  // A used code fails afterwards, in any shape.
  const ch = await challengeFor(open.base, w.email);
  assert.equal((await new Client(open.base).post('/api/auth/login/code', { challenge: ch, code: recoveryCodes[1] })).status, 401);
  const summary = await w.c.get('/api/account/summary');
  assert.deepEqual(summary.body.twoStep, { on: true, since: (await twoStepStatus(db, w.id)).since, recoveryLeft: 7 });

  // One more, checking the summary drops to 9 for a fresh account.
  const v = await writer();
  const on = await turnOn(v.c);
  const vch = await challengeFor(open.base, v.email);
  assert.equal((await new Client(open.base).post('/api/auth/login/code', { challenge: vch, code: on.recoveryCodes[0] })).status, 200);
  assert.equal(((await v.c.get('/api/account/summary')).body.twoStep as { recoveryLeft: number }).recoveryLeft, 9);
});

test('the challenge: five wrong codes then the right one gives 410; an expired challenge gives 410', async () => {
  const w = await writer();
  const { secret } = await turnOn(w.c);
  tick();
  const ch = await challengeFor(open.base, w.email);
  const right = codeAt(secret);
  const wrong = right === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    assert.equal((await new Client(open.base).post('/api/auth/login/code', { challenge: ch, code: wrong })).status, 401, `wrong ${i + 1}`);
  }
  const dead = await new Client(open.base).post('/api/auth/login/code', { challenge: ch, code: right });
  assert.equal(dead.status, 410);
  assert.deepEqual(dead.body, { error: 'sign in again' });

  const ch2 = await challengeFor(open.base, w.email);
  clockMs += 5 * 60_000 + 1000;
  const late = await new Client(open.base).post('/api/auth/login/code', { challenge: ch2, code: codeAt(secret) });
  assert.equal(late.status, 410);
  assert.deepEqual(late.body, { error: 'sign in again' });

  const unknown = await new Client(open.base).post('/api/auth/login/code', { challenge: 'x'.repeat(43), code: codeAt(secret) });
  assert.equal(unknown.status, 410);
});

test('the wrong-password 401 is byte-identical with two-step on or off', async () => {
  const plain = await writer();
  const guarded = await writer();
  await turnOn(guarded.c);
  const a = await rawPost(open.base, '/api/auth/login', { email: plain.email, password: 'wrong wrong wrong' });
  const b = await rawPost(open.base, '/api/auth/login', { email: guarded.email, password: 'wrong wrong wrong' });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.text, '{"error":"invalid email or password"}');
  assert.equal(b.text, a.text);
});

test('per-account limit: the 11th failure for one address gives 429 (unknown address too); /forgot still 200', async () => {
  const w = await writer();
  const unknown = `nobody-${++seq}@example.com`;
  const bodies: string[] = [];
  for (const email of [w.email, unknown]) {
    for (let i = 0; i < 10; i++) {
      const r = await rawPost(open.base, '/api/auth/login', { email, password: `wrong ${i} wrong` });
      assert.equal(r.status, 401, `${email} attempt ${i + 1}`);
    }
    const limited = await rawPost(open.base, '/api/auth/login', { email: email.toUpperCase(), password: PASSWORD });
    assert.equal(limited.status, 429, `${email}: even the right password waits`);
    const body = JSON.parse(limited.text) as { error: string; retryAfterSeconds: number };
    assert.equal(body.error, 'too many sign-in attempts — please wait and try again');
    assert.ok(body.retryAfterSeconds > 0 && body.retryAfterSeconds <= 900);
    bodies.push(body.error + Object.keys(body).sort().join(','));
    assert.equal(limited.setCookie, null);
    const forgot = await new Client(open.base).post('/api/auth/forgot', { email });
    assert.equal(forgot.status, 200);
  }
  assert.equal(bodies[0], bodies[1], 'the 429 says nothing about whether the account exists');
  // Another address is unaffected.
  const other = await writer();
  assert.equal((await rawPost(open.base, '/api/auth/login', { email: other.email, password: PASSWORD })).status, 200);
});

test('per-account limit: wrong codes count too', async () => {
  const w = await writer();
  const { secret } = await turnOn(w.c);
  tick();
  const wrong = codeAt(secret) === '000000' ? '111111' : '000000';
  for (let round = 0; round < 2; round++) {
    const ch = await challengeFor(open.base, w.email);
    for (let i = 0; i < 5; i++) {
      assert.equal((await new Client(open.base).post('/api/auth/login/code', { challenge: ch, code: wrong })).status, 401);
    }
  }
  const limited = await rawPost(open.base, '/api/auth/login', { email: w.email, password: PASSWORD });
  assert.equal(limited.status, 429);
});

/* ---------------- turning it off, new codes ---------------- */

test('disable: wrong password 403, wrong code 400, the right pair 200 and the login is plain again', async () => {
  const w = await writer();
  const { secret } = await turnOn(w.c);
  tick();
  const bad = await w.c.post('/api/account/two-step/disable', { currentPassword: 'nope nope nope', code: codeAt(secret) });
  assert.equal(bad.status, 403);
  assert.equal(bad.body.error, 'current password is incorrect');
  const wrong = codeAt(secret) === '000000' ? '111111' : '000000';
  assert.equal((await w.c.post('/api/account/two-step/disable', { currentPassword: PASSWORD, code: wrong })).status, 400);
  const ok = await w.c.post('/api/account/two-step/disable', { currentPassword: PASSWORD, code: codeAt(secret) });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true });
  assert.equal((await db.query('select 1 from user_two_step where user_id = $1', [w.id])).rows.length, 0);
  assert.equal((await db.query('select 1 from two_step_recovery_codes where user_id = $1', [w.id])).rows.length, 0);
  const plain = await new Client(open.base).post('/api/auth/login', { email: w.email, password: PASSWORD });
  assert.equal(plain.status, 200);
  assert.deepEqual(plain.body, { user: { id: w.id, email: w.email } });
  assert.match(plain.headers.get('set-cookie') ?? '', /beuk_session=/);
  // Turning off does not sign this device out.
  assert.equal((await w.c.get('/api/auth/me')).status, 200);
  // Off already: 409.
  assert.equal((await w.c.post('/api/account/two-step/disable', { currentPassword: PASSWORD, code: '123456' })).status, 409);
});

test('recovery-codes: password + code gives a new set; the old ones die', async () => {
  const w = await writer();
  const { secret, recoveryCodes } = await turnOn(w.c);
  tick();
  assert.equal((await w.c.post('/api/account/two-step/recovery-codes', { currentPassword: 'nope nope nope', code: codeAt(secret) })).status, 403);
  const r = await w.c.post('/api/account/two-step/recovery-codes', { currentPassword: PASSWORD, code: codeAt(secret) });
  assert.equal(r.status, 200);
  const fresh = r.body.recoveryCodes as string[];
  assert.equal(fresh.length, 10);
  const ch = await challengeFor(open.base, w.email);
  assert.equal((await new Client(open.base).post('/api/auth/login/code', { challenge: ch, code: recoveryCodes[0] })).status, 401, 'old set is dead');
  assert.equal((await new Client(open.base).post('/api/auth/login/code', { challenge: ch, code: fresh[0] })).status, 200);
});

/* ---------------- access ---------------- */

test('day 22 unpaid: start and enable pause; disable and recovery-codes still work', async () => {
  const w = await writer(paid.base, 'd22');
  await db.query('update users set trial_ends_at = $2 where id = $1', [w.id, new Date(clockMs + 3 * DAY)]);
  const { secret } = await turnOn(w.c);
  await db.query('update users set trial_ends_at = $2 where id = $1', [w.id, new Date(clockMs - DAY)]);

  const s = await w.c.post('/api/account/two-step/start', { currentPassword: PASSWORD });
  assert.equal(s.status, 402);
  assert.deepEqual(s.body, pausedBody('twoStep.setup'));
  assert.equal((await w.c.post('/api/account/two-step/enable', { code: '123456' })).status, 402);

  tick();
  const codes = await w.c.post('/api/account/two-step/recovery-codes', { currentPassword: PASSWORD, code: codeAt(secret) });
  assert.equal(codes.status, 200);
  // Signing in with two-step keeps working.
  tick();
  const ch = await challengeFor(paid.base, w.email);
  assert.equal((await new Client(paid.base).post('/api/auth/login/code', { challenge: ch, code: codeAt(secret) })).status, 200);
  tick();
  const off = await w.c.post('/api/account/two-step/disable', { currentPassword: PASSWORD, code: codeAt(secret) });
  assert.equal(off.status, 200);
});

/* ---------------- support ---------------- */

test('admin-cli two-step-off clears it (the exported function)', async () => {
  const w = await writer();
  await turnOn(w.c);
  await challengeFor(open.base, w.email);
  assert.equal(await turnTwoStepOff(db, w.email.toUpperCase()), 'turned off');
  assert.deepEqual(await twoStepStatus(db, w.id), { on: false, since: null, recoveryLeft: 0 });
  assert.equal((await db.query('select 1 from two_step_recovery_codes where user_id = $1', [w.id])).rows.length, 0);
  assert.equal((await db.query('select 1 from sign_in_challenges where user_id = $1', [w.id])).rows.length, 0);
  assert.equal(await turnTwoStepOff(db, w.email), 'was off');
  assert.equal(await turnTwoStepOff(db, 'nobody-at-all@example.com'), 'no such user');
  const plain = await new Client(open.base).post('/api/auth/login', { email: w.email, password: PASSWORD });
  assert.deepEqual(plain.body, { user: { id: w.id, email: w.email } });
});

/* ---------------- hooks ---------------- */

test('authRoutes hooks: onSignedIn on both sign-in paths, onRecoveryUsed with the count left', async () => {
  const signedIn: Array<{ email: string; token: string; ua: string | undefined }> = [];
  const recovery: Array<{ email: string; left: number }> = [];
  const app = express();
  app.use(express.json());
  app.use(
    '/api/auth',
    authRoutes(
      db,
      testConfig(),
      {
        onSignedIn: (user, req, token) => signedIn.push({ email: user.email, token, ua: req.headers['user-agent'] }),
        onRecoveryUsed: (user, left) => recovery.push({ email: user.email, left }),
      },
      undefined,
      { now },
    ),
  );
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const plain = await writer();
    const r = await rawPost(base, '/api/auth/login', { email: plain.email, password: PASSWORD });
    assert.equal(r.status, 200);
    assert.equal(signedIn.length, 1);
    assert.equal(signedIn[0].email, plain.email);
    const tokenHash = (await import('../src/auth.js')).tokenHash;
    assert.equal((await db.query('select 1 from sessions where token_hash = $1', [tokenHash(signedIn[0].token)])).rows.length, 1);

    const g = await writer();
    const { recoveryCodes } = await turnOn(g.c);
    const ch = await challengeFor(base, g.email);
    assert.equal(signedIn.length, 1, 'no sign-in before the code');
    assert.equal((await rawPost(base, '/api/auth/login/code', { challenge: ch, code: recoveryCodes[0] })).status, 200);
    assert.equal(signedIn.length, 2);
    assert.equal(signedIn[1].email, g.email);
    assert.deepEqual(recovery, [{ email: g.email, left: 9 }]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
