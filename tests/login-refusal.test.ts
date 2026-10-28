// A refused sign-in leaves one structured log line with its precise reason
// (no email, no password, no hash), so the next unexplained 401 explains
// itself. The response stays identical for every reason.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';

let server: TestServer;
before(async () => {
  server = await startTestServer(await createTestDb());
});
after(async () => {
  await server.close();
});

async function captureLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const real = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = real;
  }
}

test('refusals log their reason; success logs no refusal; nothing secret is written', async () => {
  const c = new Client(server.base);
  const reg = await registerUser(c, 'refusal@example.com');
  const userId = (reg.body.user as { id: string }).id;
  const password = 'correct horse battery';

  const wrong = await captureLog(() => new Client(server.base).post('/api/auth/login', { email: 'refusal@example.com', password: 'not the password at all' }));
  const unknown = await captureLog(() => new Client(server.base).post('/api/auth/login', { email: 'nobody-here@example.com', password }));
  const right = await captureLog(() => new Client(server.base).post('/api/auth/login', { email: 'refusal@example.com', password }));

  assert.equal(wrong.result.status, 401);
  assert.equal(unknown.result.status, 401);
  assert.deepEqual(wrong.result.body, unknown.result.body, 'same answer for every reason');
  assert.equal(right.result.status, 200);

  const parse = (lines: string[]) => lines.filter((l) => l.includes('auth.login.refused')).map((l) => JSON.parse(l));
  const w = parse(wrong.lines);
  const u = parse(unknown.lines);
  assert.equal(w.length, 1);
  assert.equal(u.length, 1);
  assert.equal(parse(right.lines).length, 0);
  assert.equal(w[0].reason, 'mismatch');
  assert.equal(w[0].userId, userId);
  assert.equal(u[0].reason, 'no_account');
  assert.equal(u[0].userId, null);
  for (const l of [...wrong.lines, ...unknown.lines]) {
    assert.ok(!l.includes('example.com'), 'no email in the log');
    assert.ok(!l.includes('not the password') && !l.includes(password), 'no password in the log');
    assert.ok(!l.includes('$argon2'), 'no hash in the log');
  }
});
