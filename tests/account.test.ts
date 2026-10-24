import assert from 'node:assert/strict';
import net from 'node:net';
import { after, before, test } from 'node:test';
import type { Db } from '../src/db.js';
import { setAdmin } from '../src/housekeeping/admin.js';
import { createMailer, type MailMessage, type Mailer, type MailerStatus, type MailResult } from '../src/mailer.js';
import { DEFAULT_ACCOUNT_LIMITS, FORGOT_MESSAGE, type AccountLimits } from '../src/routes/account.js';
import { Client, createTestDb, registerUser, startTestServer, testConfig, type TestServer } from './helpers.js';

/* ------------------------------------------------------------------ */
/* Test doubles                                                        */

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

function tokenFrom(message: MailMessage): string {
  const match = /\/reset\?token=([A-Za-z0-9_-]+)/.exec(message.text);
  assert.ok(match, `no reset link in: ${message.text}`);
  return match[1];
}

/** Just enough SMTP (RFC 5321 command/reply shape) for nodemailer to
 *  hand a message over: EHLO, MAIL, RCPT, DATA, QUIT. No TLS, no AUTH. */
async function startSmtpStub(): Promise<{ port: number; messages: string[]; close: () => Promise<void> }> {
  const messages: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.setEncoding('utf8');
    let buf = '';
    let inData = false;
    let data = '';
    sock.write('220 stub.example ESMTP\r\n');
    sock.on('data', (chunk: string) => {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            messages.push(data);
            data = '';
            sock.write('250 2.0.0 queued\r\n');
          } else {
            data += (line.startsWith('..') ? line.slice(1) : line) + '\n';
          }
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-stub.example\r\n250 8BITMIME\r\n');
        else if (cmd === 'MAIL' || cmd === 'RCPT' || cmd === 'RSET' || cmd === 'NOOP') sock.write('250 2.1.0 ok\r\n');
        else if (cmd === 'DATA') {
          inData = true;
          sock.write('354 go ahead\r\n');
        } else if (cmd === 'QUIT') {
          sock.write('221 bye\r\n');
          sock.end();
        } else sock.write('502 5.5.2 not implemented\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as net.AddressInfo;
  return {
    port: address.port,
    messages,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Undo quoted-printable soft breaks and =XX escapes. */
function qpDecode(s: string): string {
  return s.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

const ROOMY: AccountLimits = {
  forgotPerIp: { max: 1000, windowMs: 60_000 },
  forgotPerEmail: { max: 1000, windowMs: 60_000 },
  resetPerIp: { max: 1000, windowMs: 60_000 },
  passwordPerUser: { max: 1000, windowMs: 60_000 },
};

/* ------------------------------------------------------------------ */

let db: Db;
let server: TestServer;
let mailer: RecordingMailer;

before(async () => {
  db = await createTestDb();
  mailer = new RecordingMailer();
  server = await startTestServer(db, undefined, undefined, undefined, { mailer, accountLimits: ROOMY });
});

after(async () => {
  await server.close();
});

async function forgot(email: string, client = new Client(server.base)) {
  const res = await client.post('/api/auth/forgot', { email });
  await server.settle();
  return res;
}

async function login(email: string, password: string): Promise<Client> {
  const c = new Client(server.base);
  const r = await c.post('/api/auth/login', { email, password });
  assert.equal(r.status, 200, `login ${email}`);
  return c;
}

test('forgot: known and unknown addresses get the identical response (no enumeration)', async () => {
  await registerUser(new Client(server.base), 'known@example.com');
  const known = await forgot('known@example.com');
  const unknown = await forgot('nobody-here@example.com');

  assert.equal(known.status, 200);
  assert.equal(unknown.status, known.status);
  assert.deepEqual(unknown.body, known.body);
  assert.deepEqual(known.body, { ok: true, message: FORGOT_MESSAGE, emailDelivery: 'email' });
  // Neither response sets a cookie or otherwise differs in headers that matter.
  assert.equal(known.headers.get('set-cookie'), null);
  assert.equal(unknown.headers.get('set-cookie'), null);
  assert.equal(known.headers.get('content-length'), unknown.headers.get('content-length'));

  // Only the real account got a message.
  assert.equal(mailer.to('known@example.com').length, 1);
  assert.equal(mailer.to('nobody-here@example.com').length, 0);
  const rows = await db.query<{ n: number }>(
    `select count(*)::int as n from password_resets r join users u on u.id = r.user_id where u.email = 'known@example.com'`,
  );
  assert.equal(Number(rows.rows[0].n), 1);
});

test('forgot: a malformed address is a 400 whether or not anyone has it', async () => {
  const res = await new Client(server.base).post('/api/auth/forgot', { email: 'not-an-email' });
  assert.equal(res.status, 400);
});

test('reset: token is stored hashed, sets the new password and revokes ALL sessions', async () => {
  const email = 'reset-me@example.com';
  const deviceA = new Client(server.base);
  await registerUser(deviceA, email, 'old password one');
  const deviceB = await login(email, 'old password one');
  assert.equal((await deviceA.get('/api/auth/me')).status, 200);
  assert.equal((await deviceB.get('/api/auth/me')).status, 200);

  await forgot(email);
  const message = mailer.to(email).at(-1)!;
  assert.match(message.subject, /reset/i);
  assert.ok(message.text.includes(`${server.config.appBaseUrl}/reset?token=`));
  const token = tokenFrom(message);

  // Stored hashed: the plaintext token appears nowhere in the table.
  const stored = await db.query<Record<string, unknown>>(
    `select r.* from password_resets r join users u on u.id = r.user_id where u.email = $1`,
    [email],
  );
  assert.equal(stored.rows.length, 1);
  assert.ok(!JSON.stringify(stored.rows).includes(token), 'plaintext token found in password_resets');
  assert.match(String(stored.rows[0].token_hash), /^[0-9a-f]{64}$/);

  const reset = await new Client(server.base).post('/api/auth/reset', { token, password: 'brand new password' });
  assert.equal(reset.status, 200);
  assert.deepEqual(reset.body, { ok: true, sessionsRevoked: 2 });

  // Every session of the account is gone.
  assert.equal((await deviceA.get('/api/auth/me')).status, 401);
  assert.equal((await deviceB.get('/api/auth/me')).status, 401);
  const sessions = await db.query<{ n: number }>(
    `select count(*)::int as n from sessions s join users u on u.id = s.user_id where u.email = $1`,
    [email],
  );
  assert.equal(Number(sessions.rows[0].n), 0);

  // Old password dead, new password works, stored as argon2id.
  const old = await new Client(server.base).post('/api/auth/login', { email, password: 'old password one' });
  assert.equal(old.status, 401);
  await login(email, 'brand new password');
  const hash = await db.query<{ password_hash: string }>('select password_hash from users where email = $1', [email]);
  assert.match(hash.rows[0].password_hash, /^\$argon2id\$/);
});

test('reset: a token works once — reuse is rejected', async () => {
  const email = 'once@example.com';
  await registerUser(new Client(server.base), email, 'first password');
  await forgot(email);
  const token = tokenFrom(mailer.to(email).at(-1)!);

  const first = await new Client(server.base).post('/api/auth/reset', { token, password: 'second password' });
  assert.equal(first.status, 200);
  const again = await new Client(server.base).post('/api/auth/reset', { token, password: 'third password' });
  assert.equal(again.status, 400);
  assert.match(String(again.body.error), /invalid, already used, or expired/);
  // The second attempt changed nothing.
  await login(email, 'second password');
});

test('reset: tokens expire after 60 minutes', async () => {
  const email = 'expiry@example.com';
  await registerUser(new Client(server.base), email, 'expiry password');
  await forgot(email);
  const token = tokenFrom(mailer.to(email).at(-1)!);

  const window = await db.query<{ minutes: number }>(
    `select extract(epoch from (r.expires_at - r.created_at))::int / 60 as minutes
     from password_resets r join users u on u.id = r.user_id where u.email = $1`,
    [email],
  );
  assert.equal(Number(window.rows[0].minutes), 60);

  // Walk the token past its expiry.
  await db.query(
    `update password_resets set expires_at = now() - interval '1 second'
     where user_id = (select id from users where email = $1)`,
    [email],
  );
  const late = await new Client(server.base).post('/api/auth/reset', { token, password: 'too late password' });
  assert.equal(late.status, 400);
  await login(email, 'expiry password');
});

test('reset: a too-short password is refused without burning the token; junk tokens are refused', async () => {
  const email = 'short@example.com';
  await registerUser(new Client(server.base), email, 'short test password');
  await forgot(email);
  const token = tokenFrom(mailer.to(email).at(-1)!);

  const short = await new Client(server.base).post('/api/auth/reset', { token, password: 'short' });
  assert.equal(short.status, 400);
  const ok = await new Client(server.base).post('/api/auth/reset', { token, password: 'long enough now' });
  assert.equal(ok.status, 200);

  const junk = await new Client(server.base).post('/api/auth/reset', { token: 'not-a-real-token', password: 'long enough now' });
  assert.equal(junk.status, 400);
  const missing = await new Client(server.base).post('/api/auth/reset', { password: 'long enough now' });
  assert.equal(missing.status, 400);
});

test('reset: using one link kills the other outstanding links for that account', async () => {
  const email = 'two-links@example.com';
  await registerUser(new Client(server.base), email, 'two links password');
  await forgot(email);
  await forgot(email);
  const [first, second] = mailer.to(email).map(tokenFrom);
  assert.notEqual(first, second);
  assert.equal((await new Client(server.base).post('/api/auth/reset', { token: second, password: 'from link two' })).status, 200);
  assert.equal((await new Client(server.base).post('/api/auth/reset', { token: first, password: 'from link one' })).status, 400);
  await login(email, 'from link two');
});

test('change password: requires the current password; revokes the OTHER sessions only', async () => {
  const email = 'changer@example.com';
  const here = new Client(server.base);
  await registerUser(here, email, 'current password');
  const elsewhere = await login(email, 'current password');

  const anon = await new Client(server.base).post('/api/auth/password', {
    currentPassword: 'current password',
    newPassword: 'whatever password',
  });
  assert.equal(anon.status, 401);

  const wrong = await here.post('/api/auth/password', { currentPassword: 'not it at all', newPassword: 'next password' });
  assert.equal(wrong.status, 403);
  const short = await here.post('/api/auth/password', { currentPassword: 'current password', newPassword: 'short' });
  assert.equal(short.status, 400);

  const changed = await here.post('/api/auth/password', { currentPassword: 'current password', newPassword: 'next password' });
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.body, { ok: true, otherSessionsRevoked: 1 });

  assert.equal((await here.get('/api/auth/me')).status, 200, 'the session that changed it stays signed in');
  assert.equal((await elsewhere.get('/api/auth/me')).status, 401, 'other devices are signed out');
  const old = await new Client(server.base).post('/api/auth/login', { email, password: 'current password' });
  assert.equal(old.status, 401);
  await login(email, 'next password');
});

test('change password: outstanding reset links die with the old password', async () => {
  const email = 'change-kills-links@example.com';
  const here = new Client(server.base);
  await registerUser(here, email, 'before change');
  await forgot(email);
  const token = tokenFrom(mailer.to(email).at(-1)!);
  assert.equal((await here.post('/api/auth/password', { currentPassword: 'before change', newPassword: 'after change' })).status, 200);
  assert.equal((await new Client(server.base).post('/api/auth/reset', { token, password: 'sneaky reset' })).status, 400);
});

test('sign out everywhere: every session (this one included) is revoked', async () => {
  const email = 'everywhere@example.com';
  const here = new Client(server.base);
  await registerUser(here, email, 'everywhere password');
  const two = await login(email, 'everywhere password');
  const three = await login(email, 'everywhere password');

  assert.equal((await new Client(server.base).post('/api/auth/sessions/revoke-all')).status, 401);

  const revoked = await here.post('/api/auth/sessions/revoke-all');
  assert.equal(revoked.status, 200);
  assert.deepEqual(revoked.body, { ok: true, revoked: 3 });
  for (const c of [here, two, three]) assert.equal((await c.get('/api/auth/me')).status, 401);
  // Another account is untouched.
  const other = new Client(server.base);
  await registerUser(other, 'bystander@example.com');
  assert.equal((await other.get('/api/auth/me')).status, 200);
  // Signing in again works normally.
  await login(email, 'everywhere password');
});

test('rate limits: per-IP answers 429; per-address stays a silent, identical 200', async () => {
  const tightDb = await createTestDb();
  const tightMailer = new RecordingMailer();
  const tight = await startTestServer(tightDb, undefined, undefined, undefined, {
    mailer: tightMailer,
    accountLimits: {
      ...DEFAULT_ACCOUNT_LIMITS,
      forgotPerIp: { max: 4, windowMs: 60_000 },
      forgotPerEmail: { max: 2, windowMs: 60_000 },
    },
  });
  try {
    await registerUser(new Client(tight.base), 'target@example.com');
    const c = new Client(tight.base);
    const bodies = [];
    for (let i = 0; i < 4; i++) {
      const r = await c.post('/api/auth/forgot', { email: 'target@example.com' });
      assert.equal(r.status, 200, `request ${i + 1}`);
      bodies.push(r.body);
    }
    await tight.settle();
    // Same body every time, but only the first two produced a message.
    for (const b of bodies) assert.deepEqual(b, bodies[0]);
    assert.equal(tightMailer.to('target@example.com').length, 2);

    const fifth = await c.post('/api/auth/forgot', { email: 'someone-else@example.com' });
    assert.equal(fifth.status, 429);
    assert.ok(Number(fifth.headers.get('retry-after')) > 0);
  } finally {
    await tight.close();
  }
});

test('the default limits are what the README documents', () => {
  assert.deepEqual(DEFAULT_ACCOUNT_LIMITS, {
    forgotPerIp: { max: 10, windowMs: 15 * 60_000 },
    forgotPerEmail: { max: 3, windowMs: 60 * 60_000 },
    resetPerIp: { max: 20, windowMs: 15 * 60_000 },
    passwordPerUser: { max: 10, windowMs: 15 * 60_000 },
  });
});

/* ---------------- the unconfigured path: honest, never "sent" ---------------- */

test('email not configured: forgot says so (same for every address); the link only reaches the console log', async () => {
  const logged: string[] = [];
  const noMailDb = await createTestDb();
  const cfg = testConfig({ mailLogLinks: true });
  const consoleMailer = createMailer(cfg, { log: (l) => logged.push(l) });
  const s = await startTestServer(noMailDb, undefined, { mailLogLinks: true }, undefined, { mailer: consoleMailer });
  try {
    await registerUser(new Client(s.base), 'local@example.com');
    const known = await new Client(s.base).post('/api/auth/forgot', { email: 'local@example.com' });
    const unknown = await new Client(s.base).post('/api/auth/forgot', { email: 'ghost@example.com' });
    await s.settle();
    assert.equal(known.status, 200);
    assert.deepEqual(known.body, { ok: true, message: FORGOT_MESSAGE, emailDelivery: 'not-configured' });
    assert.deepEqual(unknown.body, known.body);
    assert.equal(logged.length, 1, 'only the real account produced a (console) message');
    assert.match(logged[0], /NOT SENT: email not configured/);
    assert.match(logged[0], /To: local@example\.com/);
    const token = /\/reset\?token=([A-Za-z0-9_-]+)/.exec(logged[0])?.[1];
    assert.ok(token, 'console message carries the reset link');
    const reset = await new Client(s.base).post('/api/auth/reset', { token, password: 'reset via console link' });
    assert.equal(reset.status, 200);
  } finally {
    await s.close();
  }
});

test('mailer: unconfigured never reports delivery, and logs no link when MAIL_LOG_LINKS is off', async () => {
  const logged: string[] = [];
  const m = createMailer(testConfig({ mailLogLinks: false }), { log: (l) => logged.push(l) });
  assert.equal(m.status().configured, false);
  assert.match(m.status().detail, /^email not configured — SMTP_URL and MAIL_FROM are not set/);
  const r = await m.send({ to: 'x@example.com', subject: 'Reset', text: 'https://h/reset?token=SECRET' });
  assert.equal(r.delivered, false);
  assert.equal(logged.length, 1);
  assert.ok(!logged[0].includes('SECRET'), 'link must not be logged with MAIL_LOG_LINKS off');
  assert.equal((await m.verify()).ok, false);

  const half = createMailer(testConfig({ smtpUrl: 'smtp://127.0.0.1:1' }), { log: () => {} });
  assert.equal(half.status().configured, false);
  assert.match(half.status().detail, /SMTP_URL is set but MAIL_FROM is not/);
});

test('mailer: real SMTP hand-off through nodemailer (stub server), and an honest failure when it is down', async () => {
  const smtp = await startSmtpStub();
  try {
    const cfg = testConfig({ smtpUrl: `smtp://127.0.0.1:${smtp.port}`, mailFrom: 'Beuk <no-reply@example.com>' });
    const m = createMailer(cfg);
    assert.equal(m.status().configured, true);
    assert.equal(m.status().detail, `SMTP via smtp://127.0.0.1:${smtp.port}, from Beuk <no-reply@example.com>`);
    assert.equal((await m.verify()).ok, true);

    // The whole forgot flow over the real transport.
    const smtpDb = await createTestDb();
    const s = await startTestServer(smtpDb, undefined, { smtpUrl: cfg.smtpUrl, mailFrom: cfg.mailFrom }, undefined, { mailer: m });
    try {
      await registerUser(new Client(s.base), 'smtp-user@example.com');
      const res = await new Client(s.base).post('/api/auth/forgot', { email: 'smtp-user@example.com' });
      assert.equal(res.body.emailDelivery, 'email');
      await s.settle();
      assert.equal(smtp.messages.length, 1);
      const raw = qpDecode(smtp.messages[0]);
      assert.match(raw, /^To: smtp-user@example\.com$/m);
      assert.match(raw, /^From: Beuk <no-reply@example\.com>$/m);
      const token = /\/reset\?token=([A-Za-z0-9_-]+)/.exec(raw)?.[1];
      assert.ok(token, 'the delivered email carries the reset link');
      assert.equal((await new Client(s.base).post('/api/auth/reset', { token, password: 'reset over smtp' })).status, 200);
    } finally {
      await s.close();
    }
  } finally {
    await smtp.close();
  }

  // Nothing listening: delivered=false with the reason, never a fake success.
  const down = createMailer(testConfig({ smtpUrl: `smtp://127.0.0.1:${smtp.port}`, mailFrom: 'no-reply@example.com' }));
  const r = await down.send({ to: 'x@example.com', subject: 's', text: 't' });
  assert.equal(r.delivered, false);
  assert.match((r as { reason: string }).reason, /^SMTP send failed/);
  assert.equal((await down.verify()).ok, false);
});

/* ---------------- the reset page + Housekeeping ---------------- */

test('GET /reset serves the reset page uncached, without a referrer', async () => {
  const res = await fetch(`${server.base}/reset?token=abc`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  const html = await res.text();
  assert.match(html, /Choose a new password/);
  assert.match(html, /\/api\/auth\/reset/);
  assert.match(html, /history\.replaceState/);
});

test('Housekeeping reports "email not configured" honestly (status, self-check, test send)', async () => {
  const hkDb = await createTestDb();
  const s = await startTestServer(hkDb);
  try {
    const admin = new Client(s.base);
    await registerUser(admin, 'hk-admin@example.com');
    assert.equal(await setAdmin(hkDb, 'hk-admin@example.com', true), 'granted');
    const nobody = new Client(s.base);
    await registerUser(nobody, 'not-admin@example.com');
    assert.equal((await nobody.get('/api/housekeeping/mail')).status, 404);
    assert.equal((await nobody.post('/api/housekeeping/mail/test')).status, 404);

    const status = await admin.get('/api/housekeeping/mail');
    assert.equal(status.status, 200);
    const mail = status.body.mail as MailerStatus;
    assert.equal(mail.configured, false);
    assert.match(mail.detail, /^email not configured/);

    const test = await admin.post('/api/housekeeping/mail/test');
    assert.equal(test.status, 409);
    assert.equal(test.body.sent, false);

    const run = await admin.post('/api/housekeeping/self-checks/run');
    const results = (run.body.run as { results: { id: string; status: string; detail: string }[] }).results;
    const byId = new Map(results.map((r) => [r.id, r]));
    const mailCase = byId.get('auth.mail.delivery-state-honest');
    assert.equal(mailCase?.status, 'pass');
    assert.match(mailCase!.detail, /email not configured/);
    assert.match(mailCase!.detail, /NOT being sent/);
    assert.equal(byId.get('auth.reset.page-in-deploy-tree')?.status, 'pass');
    assert.equal(byId.get('auth.reset.tokens-hashed-single-use')?.status, 'pass');
    assert.equal(byId.get('auth.ui.forgot-and-account-controls')?.status, 'client-only');

    const catalog = await admin.get('/api/housekeeping/actions');
    const names = (catalog.body.actions as { name: string }[]).map((a) => a.name);
    assert.ok(names.includes('mail.status') && names.includes('mail.test'));
  } finally {
    await s.close();
  }
});

test('Housekeeping: SMTP configured but unreachable fails the mail self-check; credentials are scrubbed', async () => {
  const hkDb = await createTestDb();
  const s = await startTestServer(hkDb, undefined, {
    smtpUrl: 'smtp://mailuser:Sup3rSecretMailPw@127.0.0.1:1',
    mailFrom: 'no-reply@example.com',
  });
  try {
    const admin = new Client(s.base);
    await registerUser(admin, 'hk2@example.com');
    await setAdmin(hkDb, 'hk2@example.com', true);
    const status = await admin.get('/api/housekeeping/mail');
    assert.ok(!JSON.stringify(status.body).includes('Sup3rSecretMailPw'));
    assert.equal((status.body.mail as MailerStatus).detail, 'SMTP via smtp://127.0.0.1:1, from no-reply@example.com');
    const run = await admin.post('/api/housekeeping/self-checks/run');
    assert.ok(!JSON.stringify(run.body).includes('Sup3rSecretMailPw'));
    const results = (run.body.run as { results: { id: string; status: string; detail: string }[] }).results;
    const mailCase = results.find((r) => r.id === 'auth.mail.delivery-state-honest');
    assert.equal(mailCase?.status, 'fail');
    assert.match(mailCase!.detail, /did not accept the connection/);
  } finally {
    await s.close();
  }
});
