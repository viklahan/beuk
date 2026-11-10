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

async function start(overrides: Parameters<typeof testConfig>[0] = {}, useDb: Db = db): Promise<Srv> {
  const config = testConfig(overrides);
  const app = buildApp({ db: useDb, config, now });
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

test('clock skew: a code from step +1 is accepted, from step +2 refused', async () => {
  const w = await writer();
  const { secret } = await turnOn(w.c);
  tick();
  const ch = await challengeFor(open.base, w.email);
  assert.equal((await new Client(open.base).post('/api/auth/login/code', { challenge: ch, code: codeAt(secret, 2) })).status, 401);
  assert.equal((await new Client(open.base).post('/api/auth/login/code', { challenge: ch, code: codeAt(secret, 1) })).status, 200);
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

/* ---------------- review round 1 ---------------- */

/** A Db whose next transaction, once committed, runs `then` before the
 *  caller continues: a deterministic stand-in for a second tab acting
 *  between two steps of a route. */
function hookedDb(inner: Db): Db & { afterNextTx: (then: () => Promise<void>) => void } {
  let pending: (() => Promise<void>) | null = null;
  return {
    query: (text, params) => inner.query(text, params),
    tx: async (fn) => {
      const result = await inner.tx(fn);
      const then = pending;
      pending = null;
      if (then) await then();
      return result;
    },
    afterNextTx: (then) => {
      pending = then;
    },
  };
}

test('per-account limit under a concurrent burst: at most 10 attempts get past it, known or unknown address', async () => {
  const w = await writer();
  const unknown = `burst-nobody-${++seq}@example.com`;
  const bodies: string[] = [];
  for (const email of [w.email, unknown]) {
    const rs = await Promise.all(
      Array.from({ length: 40 }, (_, i) => rawPost(open.base, '/api/auth/login', { email, password: `wrong ${i} wrong` })),
    );
    const notLimited = rs.filter((r) => r.status !== 429);
    assert.ok(notLimited.length <= 10, `${email}: ${notLimited.length} attempts got past the limit`);
    assert.ok(notLimited.every((r) => r.status === 401));
    const limited = rs.find((r) => r.status === 429)!;
    const b = JSON.parse(limited.text) as Record<string, unknown>;
    bodies.push(`${b.error}|${Object.keys(b).sort().join(',')}`);
  }
  assert.equal(bodies[0], bodies[1], 'the 429 is the same for an unknown address');
});

test('per-account limit: a success gives its attempt back (9 failures + a sign-in leave one more try)', async () => {
  const w = await writer();
  for (let i = 0; i < 9; i++) assert.equal((await rawPost(open.base, '/api/auth/login', { email: w.email, password: `nope ${i} nope` })).status, 401);
  assert.equal((await rawPost(open.base, '/api/auth/login', { email: w.email, password: PASSWORD })).status, 200);
  assert.equal((await rawPost(open.base, '/api/auth/login', { email: w.email, password: 'nope again' })).status, 401, '10th failure');
  assert.equal((await rawPost(open.base, '/api/auth/login', { email: w.email, password: PASSWORD })).status, 429);
});

test('per-account limit: /reset works while the limit is on, and clears it: the new password then signs in', async () => {
  const w = await writer();
  for (let i = 0; i < 10; i++) await rawPost(open.base, '/api/auth/login', { email: w.email, password: `nope ${i} nope` });
  assert.equal((await rawPost(open.base, '/api/auth/login', { email: w.email, password: PASSWORD })).status, 429);
  const token = `reset-token-${seq}-${'x'.repeat(30)}`;
  const { tokenHash } = await import('../src/auth.js');
  await db.query(`insert into password_resets (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 hour')`, [w.id, tokenHash(token)]);
  const r = await new Client(open.base).post('/api/auth/reset', { token, password: 'a brand new password' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  // Whoever controls the inbox is never locked out: the reset lifted the limit.
  const back = await rawPost(open.base, '/api/auth/login', { email: w.email.toUpperCase(), password: 'a brand new password' });
  assert.equal(back.status, 200, back.text);
  assert.match(back.setCookie ?? '', /beuk_session=/);
});

test('per-account limit: a reset with a bad token clears nothing', async () => {
  const w = await writer();
  for (let i = 0; i < 10; i++) await rawPost(open.base, '/api/auth/login', { email: w.email, password: `nope ${i} nope` });
  const r = await new Client(open.base).post('/api/auth/reset', { token: 'not-a-real-token-' + 'y'.repeat(30), password: 'a brand new password' });
  assert.equal(r.status, 400);
  assert.equal((await rawPost(open.base, '/api/auth/login', { email: w.email, password: PASSWORD })).status, 429);
});

/* ---------------- final review: challenges die with sessions ---------------- */

test('housekeeping: purgeExpiredSessions also deletes expired sign-in challenges; live ones stay', async () => {
  const w = await writer();
  await db.query(
    `insert into sign_in_challenges (user_id, token_hash, expires_at, created_at) values
       ($1, $2, now() - interval '1 second', now() - interval '301 seconds'),
       ($1, $3, now() + interval '4 minutes', now())`,
    [w.id, `purge-old-${seq}`, `purge-live-${seq}`],
  );
  const { purgeExpiredSessions } = await import('../src/auth.js');
  await purgeExpiredSessions(db);
  const left = await db.query<{ token_hash: string }>('select token_hash from sign_in_challenges where user_id = $1', [w.id]);
  assert.deepEqual(left.rows.map((r) => r.token_hash), [`purge-live-${seq}`]);
});

test('a two-step password sign-in sweeps every expired challenge (not only day-old ones)', async () => {
  const other = await writer();
  await db.query(
    'insert into sign_in_challenges (user_id, token_hash, expires_at, created_at) values ($1, $2, $3, $4)',
    [other.id, `sweep-old-${seq}`, new Date(clockMs - 1000), new Date(clockMs - 301_000)],
  );
  const g = await writer();
  await turnOn(g.c);
  await challengeFor(open.base, g.email);
  assert.equal(await pendingChallenges(other.id), 0, 'an expired challenge is gone at the next sweep');
});

async function pendingChallenges(userId: string): Promise<number> {
  return (await db.query('select 1 from sign_in_challenges where user_id = $1', [userId])).rows.length;
}

test('a password reset deletes the pending sign-in challenges: the old challenge gets 410', async () => {
  const w = await writer();
  const { recoveryCodes } = await turnOn(w.c);
  const ch = await challengeFor(open.base, w.email);
  assert.equal(await pendingChallenges(w.id), 1);
  const token = `reset-ch-${seq}-${'x'.repeat(30)}`;
  const { tokenHash } = await import('../src/auth.js');
  await db.query(`insert into password_resets (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 hour')`, [w.id, tokenHash(token)]);
  assert.equal((await new Client(open.base).post('/api/auth/reset', { token, password: 'a brand new password' })).status, 200);
  assert.equal(await pendingChallenges(w.id), 0);
  const late = await rawPost(open.base, '/api/auth/login/code', { challenge: ch, code: recoveryCodes[0] });
  assert.equal(late.status, 410);
});

test('a password change deletes the pending sign-in challenges: the old challenge gets 410', async () => {
  const w = await writer();
  const { recoveryCodes } = await turnOn(w.c);
  const ch = await challengeFor(open.base, w.email);
  assert.equal(await pendingChallenges(w.id), 1);
  const r = await w.c.post('/api/auth/password', { currentPassword: PASSWORD, newPassword: 'a brand new password' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await pendingChallenges(w.id), 0);
  assert.equal((await rawPost(open.base, '/api/auth/login/code', { challenge: ch, code: recoveryCodes[0] })).status, 410);
});

test('"Sign out everywhere" deletes the pending sign-in challenges: the old challenge gets 410', async () => {
  const w = await writer();
  const { recoveryCodes } = await turnOn(w.c);
  const ch = await challengeFor(open.base, w.email);
  assert.equal(await pendingChallenges(w.id), 1);
  assert.equal((await w.c.post('/api/auth/sessions/revoke-all', {})).status, 200);
  assert.equal(await pendingChallenges(w.id), 0);
  assert.equal((await rawPost(open.base, '/api/auth/login/code', { challenge: ch, code: recoveryCodes[0] })).status, 410);
});

test('the challenge is claimed before the code is spent: a racing second code gets 410 and is not burned', async () => {
  const hooked = hookedDb(db);
  const srv = await start({}, hooked);
  try {
    const w = await writer(srv.base);
    const { recoveryCodes } = await turnOn(w.c);
    const ch = await challengeFor(srv.base, w.email);
    let second: { status: number } | null = null;
    // Right after the first request spends its code, a second tab sends another code on the same challenge.
    hooked.afterNextTx(async () => {
      second = await new Client(srv.base).post('/api/auth/login/code', { challenge: ch, code: recoveryCodes[1] });
    });
    const first = await new Client(srv.base).post('/api/auth/login/code', { challenge: ch, code: recoveryCodes[0] });
    assert.ok(second, 'the second tab ran');
    assert.deepEqual([first.status, (second as { status: number }).status].sort(), [200, 410]);
    assert.equal((await twoStepStatus(db, w.id)).recoveryLeft, 9, 'only one recovery code was spent');
  } finally {
    await srv.close();
  }
});

/** A Db whose transactions run `then(tx)` right after the first query
 *  matching `match` inside them (once): a deterministic stand-in for a
 *  second tab changing the row in the middle of a route's transaction. */
function midTxDb(inner: Db, match: RegExp, then: (tx: Db) => Promise<void>): Db {
  let fired = false;
  return {
    query: (text, params) => inner.query(text, params),
    tx: (fn) =>
      inner.tx((tx) =>
        fn({
          query: async (text, params) => {
            const result = await tx.query(text, params);
            if (!fired && match.test(text)) {
              fired = true;
              await then(tx);
            }
            return result as never;
          },
          tx: tx.tx.bind(tx),
        }),
      ),
  };
}

test('enable confirms the secret it enables: a secret swapped between the code check and the switch gives 409 and stays off', async () => {
  const swapped = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  let userId = '';
  let swaps = 0;
  // Right after the code check has spent its step (inside the enable
  // transaction), the pending secret is replaced, as another tab's /start would.
  const srv = await start(
    {},
    midTxDb(db, /set last_step/, async (tx) => {
      const r = await tx.query('update user_two_step set secret = $2 where user_id = $1 and enabled_at is null returning user_id', [userId, swapped]);
      swaps += r.rows.length;
    }),
  );
  try {
    const w = await writer(srv.base);
    userId = w.id;
    const s = await w.c.post('/api/account/two-step/start', { currentPassword: PASSWORD });
    const confirmed = s.body.secret as string;
    tick();
    const e = await w.c.post('/api/account/two-step/enable', { code: codeAt(confirmed) });
    assert.equal(swaps, 1, 'the swap ran inside the enable transaction');
    assert.equal(e.status, 409, JSON.stringify(e.body));
    assert.equal(e.body.error, 'two-step sign-in changed in another tab — start again');
    const row = (await db.query<{ secret: string; enabled_at: Date | null }>('select secret, enabled_at from user_two_step where user_id = $1', [w.id])).rows[0];
    assert.equal(row.enabled_at, null, 'never turned on with a secret nobody confirmed');
    assert.equal(row.secret, swapped);
    assert.equal((await db.query('select 1 from two_step_recovery_codes where user_id = $1', [w.id])).rows.length, 0);
  } finally {
    await srv.close();
  }
});

test('a throwing hook never breaks the sign-in: 200 with the cookie on both paths', async () => {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/auth',
    authRoutes(
      db,
      testConfig(),
      {
        onSignedIn: () => {
          throw new Error('hook boom (test)');
        },
        onRecoveryUsed: () => {
          throw new Error('hook boom (test)');
        },
      },
      undefined,
      { now },
    ),
  );
  let lateError: unknown = null;
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    lateError = err;
    if (!res.headersSent) res.status(500).json({ error: 'internal error' });
  });
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
    assert.match(r.setCookie ?? '', /beuk_session=/);
    const g = await writer();
    const { recoveryCodes } = await turnOn(g.c);
    const ch = await challengeFor(base, g.email);
    const c = await rawPost(base, '/api/auth/login/code', { challenge: ch, code: recoveryCodes[0] });
    assert.equal(c.status, 200);
    assert.match(c.setCookie ?? '', /beuk_session=/);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(lateError, null, 'no hook error reaches the error handler');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
