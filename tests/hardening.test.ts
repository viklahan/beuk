import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http, { type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { purgeExpiredSessions } from '../src/auth.js';
import { createPgDb, type Db } from '../src/db.js';
import { setAdmin } from '../src/housekeeping/admin.js';
import { isUuid } from '../src/ids.js';
import { JobRunner } from '../src/jobs/runner.js';
import { TokenBucketLimiter } from '../src/ratelimit.js';
import { createShutdown } from '../src/shutdown.js';
import { Client, createTestDb, registerUser, startTestServer, testConfig } from './helpers.js';

/** POST JSON as a given client address (the test server trusts one
 *  proxy hop, exactly as production trusts Caddy). */
async function postAs(base: string, ip: string, p: string, body: unknown) {
  const res = await fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : {} };
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

test('token bucket: burst, refusal with retry-after, refill over time, per key', () => {
  let t = 0;
  const limiter = new TokenBucketLimiter({ burst: 2, refillMs: 10_000, now: () => t });
  assert.equal(limiter.take('a').ok, true);
  assert.equal(limiter.take('a').ok, true);
  const refused = limiter.take('a');
  assert.equal(refused.ok, false);
  assert.equal(refused.retryAfterSec, 10);
  assert.equal(limiter.take('b').ok, true, 'another key has its own bucket');
  t = 5_000;
  const half = limiter.take('a');
  assert.equal(half.ok, false);
  assert.equal(half.retryAfterSec, 5);
  t = 10_000;
  assert.equal(limiter.take('a').ok, true, 'one token back after refillMs');
  assert.equal(limiter.take('a').ok, false);
});

test('login and register are rate-limited per real client IP with 429 + Retry-After', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, { authRateBurst: 3, authRateRefillMs: 60_000 });
  try {
    const creds = { email: 'nobody@example.com', password: 'wrong password here' };
    for (let i = 0; i < 3; i++) {
      const r = await postAs(server.base, '203.0.113.1', '/api/auth/login', creds);
      assert.equal(r.status, 401, `attempt ${i + 1} is answered normally`);
    }
    const limited = await postAs(server.base, '203.0.113.1', '/api/auth/login', creds);
    assert.equal(limited.status, 429);
    const retryAfter = Number(limited.headers.get('retry-after'));
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60, `Retry-After ${retryAfter}`);

    // A spoofed left-most X-Forwarded-For entry does not buy a new
    // bucket: only the address the trusted hop appended counts.
    const spoofed = await postAs(server.base, '198.51.100.9, 203.0.113.1', '/api/auth/login', creds);
    assert.equal(spoofed.status, 429);

    // A different client is unaffected.
    const other = await postAs(server.base, '203.0.113.2', '/api/auth/login', creds);
    assert.equal(other.status, 401);

    // Register has its own bucket (sign-ups never starve sign-ins).
    for (let i = 0; i < 3; i++) {
      const r = await postAs(server.base, '203.0.113.1', '/api/auth/register', {
        email: `reg${i}@example.com`,
        password: 'correct horse battery',
      });
      assert.equal(r.status, 201);
    }
    const regLimited = await postAs(server.base, '203.0.113.1', '/api/auth/register', {
      email: 'reg9@example.com',
      password: 'correct horse battery',
    });
    assert.equal(regLimited.status, 429);
    assert.ok(regLimited.headers.get('retry-after'));
  } finally {
    await server.close();
  }
});

test("founders throttle keys on the corrected client IP and sends Retry-After", async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    const apply = (ip: string, i: number) =>
      postAs(server.base, ip, '/api/founders/apply', {
        name: `Writer ${i}`,
        email: `w${i}@example.com`,
        about: 'I write quiet novels.',
      });
    for (let i = 0; i < 10; i++) assert.equal((await apply('192.0.2.10', i)).status, 201);
    const limited = await apply('192.0.2.10', 10);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    // Before trust proxy every request came from the proxy's address, so
    // one busy visitor throttled everyone. Now another client is fine.
    assert.equal((await apply('192.0.2.11', 11)).status, 201);
  } finally {
    await server.close();
  }
});

test('login: an unknown email spends the same argon2 work as a wrong password', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    const client = new Client(server.base);
    await registerUser(client, 'known@example.com');
    const time = async (email: string) => {
      const t0 = performance.now();
      const r = await client.post('/api/auth/login', { email, password: 'not the password' });
      assert.equal(r.status, 401);
      return performance.now() - t0;
    };
    // Warm up both paths (dummy hash computation, JIT).
    await time('known@example.com');
    await time('ghost@example.com');
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 5; i++) {
      known.push(await time('known@example.com'));
      unknown.push(await time(`ghost${i}@example.com`));
    }
    const k = median(known);
    const u = median(unknown);
    // Without the dummy verify an unknown email answers in ~1 ms while
    // a wrong password costs a full argon2id verify (tens of ms).
    assert.ok(k > 5, `wrong-password login should cost real argon2 work (median ${k.toFixed(1)} ms)`);
    assert.ok(u >= k * 0.5, `unknown-email median ${u.toFixed(1)} ms vs wrong-password ${k.toFixed(1)} ms`);
  } finally {
    await server.close();
  }
});

test('concurrent duplicate registration: one 201, one 409 (never a 500)', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    const a = new Client(server.base);
    const b = new Client(server.base);
    const results = await Promise.all([
      registerUser(a, 'twin@example.com'),
      registerUser(b, 'twin@example.com'),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    const loser = results.find((r) => r.status === 409)!;
    assert.equal(loser.body.error, 'email already registered');
  } finally {
    await server.close();
  }
});

test('non-UUID ids are 404 on every :id route (and id-bearing bodies), not a Postgres 500', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    assert.equal(isUuid(NIL_UUID), true);
    assert.equal(isUuid('nope'), false);
    const alice = new Client(server.base);
    await registerUser(alice, 'alice-ids@example.com');
    await setAdmin(db, 'alice-ids@example.com', true);
    const bad = ['not-a-uuid', '123', "1' or '1'='1"];
    for (const id of bad) {
      const enc = encodeURIComponent(id);
      for (const [method, p] of [
        ['GET', `/api/manuscripts/${enc}`],
        ['PUT', `/api/manuscripts/${enc}`],
        ['DELETE', `/api/manuscripts/${enc}`],
        ['GET', `/api/exports/${enc}/download`],
        ['DELETE', `/api/exports/${enc}`],
        ['GET', `/api/jobs/${enc}`],
        ['GET', `/api/housekeeping/self-checks/runs/${enc}`],
      ] as const) {
        const r = await alice.request(method, p, method === 'PUT' ? { doc: {} } : undefined);
        assert.equal(r.status, 404, `${method} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
      }
    }
    const job = await alice.post('/api/jobs/epubcheck', { exportId: 'not-a-uuid' });
    assert.equal(job.status, 404);
    const up = await alice.upload('/api/exports?format=epub&manuscriptId=not-a-uuid', Buffer.from('x'));
    assert.equal(up.status, 404);
    // A well-formed but absent id is still the ordinary 404.
    assert.equal((await alice.get(`/api/manuscripts/${NIL_UUID}`)).status, 404);
    // Unauthenticated callers still get 401 first (no existence leak).
    assert.equal((await new Client(server.base).get('/api/manuscripts/nope')).status, 401);
  } finally {
    await server.close();
  }
});

test('download of an export whose file vanished/unreadable after stat: 500 JSON, server survives', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    const alice = new Client(server.base);
    const reg = await registerUser(alice, 'alice-dl@example.com');
    const userId = (reg.body.user as { id: string }).id;
    const ms = await alice.post('/api/manuscripts', {
      doc: { title: 'T', sections: { frontMatter: [], body: [], backMatter: [] } },
    });
    const manuscriptId = (ms.body.manuscript as { id: string }).id;
    const saved = await alice.upload(
      `/api/exports?format=epub&manuscriptId=${manuscriptId}&filename=a.epub`,
      Buffer.from('PK fake epub bytes'),
    );
    assert.equal(saved.status, 201);
    const exportId = (saved.body.export as { id: string }).id;
    // stat() succeeds on a directory but reading it fails (EISDIR) —
    // the same code path as a file deleted between stat and open,
    // without a race. Before the fix this crashed the Node process.
    const file = path.join(server.config.exportDir, userId, exportId);
    rmSync(file);
    mkdirSync(file);
    const dl = await alice.download(`/api/exports/${exportId}/download`);
    assert.equal(dl.status, 500);
    assert.match(dl.headers.get('content-type') ?? '', /application\/json/);
    assert.match(dl.bytes.toString('utf8'), /missing from storage/);
    const health = await alice.get('/api/health');
    assert.equal(health.status, 200, 'the server is still up');
  } finally {
    await server.close();
  }
});

test("pg pool: an idle-client 'error' is handled, not an uncaught crash", async () => {
  // Nothing listens on port 1; the pool never connects (no query runs).
  const pgDb = createPgDb('postgres://u:p@127.0.0.1:1/none');
  try {
    assert.ok(pgDb.pool.listenerCount('error') >= 1);
    // An EventEmitter 'error' with no listener throws; with ours it is logged.
    assert.doesNotThrow(() => pgDb.pool.emit('error', new Error('terminating connection due to administrator command')));
  } finally {
    await pgDb.end();
  }
});

test('expired sessions are purged; live ones stay', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    const alice = new Client(server.base);
    await registerUser(alice, 'alice-purge@example.com');
    const user = await db.query<{ id: string }>("select id from users where email = 'alice-purge@example.com'");
    await db.query(
      `insert into sessions (user_id, token_hash, expires_at) values ($1, 'old-1', now() - interval '1 day'), ($1, 'old-2', now() - interval '1 second')`,
      [user.rows[0].id],
    );
    assert.equal(await purgeExpiredSessions(db), 2);
    assert.equal(await purgeExpiredSessions(db), 0);
    assert.equal((await alice.get('/api/auth/me')).status, 200, 'the live session survives');
  } finally {
    await server.close();
  }
});

async function seedJob(db: Db, base: string, exportDir: string) {
  const alice = new Client(base);
  const reg = await registerUser(alice, `job-${Math.random().toString(36).slice(2)}@example.com`);
  const userId = (reg.body.user as { id: string }).id;
  const ms = await alice.post('/api/manuscripts', {
    doc: { title: 'J', sections: { frontMatter: [], body: [], backMatter: [] } },
  });
  const manuscriptId = (ms.body.manuscript as { id: string }).id;
  const saved = await alice.upload(
    `/api/exports?format=epub&manuscriptId=${manuscriptId}&filename=j.epub`,
    Buffer.from('PK epub'),
  );
  const exportId = (saved.body.export as { id: string }).id;
  assert.ok(exportDir);
  const insert = async () =>
    (
      await db.query<{ id: string }>(
        `insert into jobs (user_id, kind, source_export_id) values ($1, 'epubcheck', $2) returning id`,
        [userId, exportId],
      )
    ).rows[0].id;
  return { first: await insert(), second: await insert() };
}

test('graceful shutdown: a job that outlives the grace period is failed honestly; queued jobs stay queued', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beuk-hard-tools-'));
  const sleepy = path.join(dir, 'sleepy-java.sh');
  writeFileSync(sleepy, '#!/bin/sh\nsleep 30\n');
  chmodSync(sleepy, 0o755);
  const jar = path.join(dir, 'epubcheck.jar');
  writeFileSync(jar, 'stub');
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    const { first, second } = await seedJob(db, server.base, server.config.exportDir);
    const runner = new JobRunner(db, {
      ...server.config,
      epubcheckJar: jar,
      javaBin: sleepy,
      jobTimeoutMs: 1_500,
    });
    runner.enqueue(first);
    runner.enqueue(second);
    const status = async (id: string) =>
      (await db.query<{ status: string; result: { error?: string } | null }>('select status, result from jobs where id = $1', [id])).rows[0];
    const deadline = Date.now() + 5_000;
    while ((await status(first)).status !== 'running') {
      assert.ok(Date.now() < deadline, 'job never started');
      await new Promise((r) => setTimeout(r, 20));
    }
    const outcome = await runner.shutdown(100);
    assert.deepEqual(outcome, { finished: false, failedJobId: first });
    const failed = await status(first);
    assert.equal(failed.status, 'failed');
    assert.match(failed.result?.error ?? '', /shutting down/);
    assert.equal((await status(second)).status, 'queued', 'recover() re-runs it next boot');
    // When the tool finally exits (timeout kill), its late result must
    // not overwrite the shutdown record, and the queue must not resume.
    await new Promise((r) => setTimeout(r, 2_000));
    assert.match((await status(first)).result?.error ?? '', /shutting down/);
    assert.equal((await status(second)).status, 'queued');
  } finally {
    await server.close();
  }
});

test('graceful shutdown: in-flight requests finish, new connections are refused, pool closed, exit 0', async () => {
  const server: Server = http.createServer((_req, res) => {
    setTimeout(() => res.end('finished'), 300);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  let dbClosed = false;
  let exitCode: number | null = null;
  const logs: string[] = [];
  const shutdown = createShutdown({
    server,
    graceMs: 5_000,
    closeDb: async () => {
      dbClosed = true;
    },
    log: (m) => logs.push(m),
    exit: (c) => {
      exitCode = c;
    },
  });
  const inflight = fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
  await new Promise((r) => setTimeout(r, 50));
  const done = shutdown('SIGTERM');
  assert.equal(shutdown('SIGTERM'), done, 'a second signal reuses the same sequence');
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`), 'new connections are refused');
  assert.equal(await inflight, 'finished');
  assert.equal(await done, 0);
  assert.equal(dbClosed, true);
  assert.equal(exitCode, 0);
  assert.ok(logs.some((l) => l.startsWith('SIGTERM')));
});

test('testConfig keeps the auth limiter out of the way of other suites', () => {
  assert.ok(testConfig().authRateBurst >= 1000);
});
