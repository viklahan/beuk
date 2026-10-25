import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Config } from '../src/config.js';
import type { Db } from '../src/db.js';
import { setAdmin } from '../src/housekeeping/admin.js';
import { HousekeepingLock } from '../src/housekeeping/lock.js';
import {
  BackupScheduler,
  drillHealth,
  offsiteFreshness,
  scheduleHealth,
  STATUS_FILES,
  type ResticOutcome,
  type ResticRunner,
} from '../src/housekeeping/offsite.js';
import { Client, createTestDb, registerUser, startTestServer, testConfig } from './helpers.js';

/**
 * Scheduled + off-site backups and the restore drill, against a FAKE
 * restic (the ResticRunner seam). It keeps an in-memory repository so
 * the drill restores real bytes. The real restic + S3 (MinIO standing
 * in for B2) path is proven end to end in the full-stack run recorded
 * in the README "Off-site backups" section; this suite proves the
 * app's logic: scheduling, audit, status, retention arguments,
 * freshness/drill verdicts and that secrets never leak.
 */

const PASSWORD = 'restic-pass-CANARY-77aa';
const APP_KEY = 'K005appkeyCANARY99zz';
const KEY_ID = '005keyidCANARY1234';

function offsiteConfig(extra: Partial<Config> = {}): Partial<Config> {
  const base = testConfig();
  return {
    backupIntervalHours: 24,
    offsite: {
      ...base.offsite,
      b2KeyId: KEY_ID,
      b2ApplicationKey: APP_KEY,
      b2Bucket: 'beuk-test-bucket',
      b2Endpoint: 'https://s3.example-region.backblazeb2.example',
      resticPassword: PASSWORD,
    },
    ...extra,
  };
}

interface FakeRepo {
  runner: ResticRunner;
  calls: { args: string[]; env: Record<string, string> }[];
  snapshots: { id: string; path: string; files: Map<string, Buffer>; time: number }[];
  initialised: boolean;
  failWith: string | null;
  tamper: ((files: Map<string, Buffer>) => void) | null;
}

async function readTree(dir: string, base = dir, out = new Map<string, Buffer>()): Promise<Map<string, Buffer>> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await readTree(full, base, out);
    else out.set(path.relative(base, full), await readFile(full));
  }
  return out;
}

function fakeRestic(): FakeRepo {
  const repo: FakeRepo = {
    calls: [],
    snapshots: [],
    initialised: false,
    failWith: null,
    tamper: null,
    runner: async (args, env): Promise<ResticOutcome> => {
      repo.calls.push({ args, env });
      if (repo.failWith) return { code: 1, stdout: '', stderr: repo.failWith };
      const [cmd] = args;
      if (cmd === 'cat') return repo.initialised ? { code: 0, stdout: '{}', stderr: '' } : { code: 10, stdout: '', stderr: 'Fatal: repository does not exist' };
      if (cmd === 'init') { repo.initialised = true; return { code: 0, stdout: 'created restic repository', stderr: '' }; }
      if (cmd === 'backup') {
        const dir = args[args.length - 1];
        const id = `snap${repo.snapshots.length + 1}`.padEnd(64, '0');
        repo.snapshots.push({ id, path: dir, files: await readTree(dir), time: Date.now() });
        return { code: 0, stdout: `{"message_type":"status"}\n{"message_type":"summary","snapshot_id":"${id}","data_added":1234}\n`, stderr: '' };
      }
      if (cmd === 'forget') return { code: 0, stdout: 'Applying Policy: keep 7 daily', stderr: '' };
      if (cmd === 'snapshots') {
        const last = repo.snapshots[repo.snapshots.length - 1];
        return { code: 0, stdout: JSON.stringify(last ? [{ id: last.id, short_id: last.id.slice(0, 8), paths: [last.path] }] : []), stderr: '' };
      }
      if (cmd === 'restore') {
        const snap = repo.snapshots.find((s) => s.id === args[1]);
        const target = args[args.indexOf('--target') + 1];
        if (!snap) return { code: 1, stdout: '', stderr: 'no such snapshot' };
        const files = new Map(snap.files);
        repo.tamper?.(files);
        for (const [rel, bytes] of files) {
          const dest = path.join(target, snap.path, rel);
          await mkdir(path.dirname(dest), { recursive: true });
          await writeFile(dest, bytes);
        }
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 1, stdout: '', stderr: `fake restic: unknown command ${cmd}` };
    },
  };
  return repo;
}

async function adminSetup(overrides: Partial<Config>, repo?: FakeRepo, now?: () => Date) {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, overrides, {
    runRestic: repo?.runner,
    now,
  });
  const admin = new Client(server.base);
  await registerUser(admin, 'admin@example.com');
  assert.equal(await setAdmin(db, 'admin@example.com', true), 'granted');
  return { db, server, admin };
}

async function auditRows(db: Db): Promise<string[]> {
  const r = await db.query<{ action: string; result: string; actor_email: string | null }>(
    'select action, result, actor_email from housekeeping_audit order by created_at',
  );
  return r.rows.map((x) => `${x.actor_email}:${x.action}:${x.result}`);
}

test('off-site not configured: self-checks say "not configured" (never pass), the run still passes, run/drill answer 409', async () => {
  const { server, admin } = await adminSetup({});
  try {
    const run = await admin.post('/api/housekeeping/self-checks/run');
    const body = run.body.run as { overall: string; counts: { notConfigured: number }; results: { id: string; status: string; detail: string }[] };
    assert.equal(body.overall, 'pass');
    for (const id of ['backup.offsite.fresh', 'backup.offsite.drill', 'backup.schedule.running']) {
      const r = body.results.find((x) => x.id === id);
      assert.equal(r?.status, 'not-configured', `${id}: ${r?.status} ${r?.detail}`);
    }
    assert.match(body.results.find((x) => x.id === 'backup.offsite.fresh')!.detail, /RESTIC_PASSWORD/);
    assert.ok(body.counts.notConfigured >= 3);
    assert.equal(body.results.find((x) => x.id === 'data.backup.tables-classified')?.status, 'pass');

    const status = await admin.get('/api/housekeeping/offsite');
    const o = status.body.offsite as { configured: boolean; missing: string[] };
    assert.equal(o.configured, false);
    assert.deepEqual(o.missing, ['OFFSITE_B2_KEY_ID', 'OFFSITE_B2_APPLICATION_KEY', 'OFFSITE_B2_BUCKET', 'OFFSITE_B2_ENDPOINT', 'RESTIC_PASSWORD']);
    assert.equal((await admin.post('/api/housekeeping/offsite/run')).status, 409);
    assert.equal((await admin.post('/api/housekeeping/offsite/drill')).status, 409);
  } finally {
    await server.close();
  }
});

test('scheduler: a due tick makes a local backup, pushes it with restic, applies retention, drills, audits each step; secrets stay out of argv and child env', async () => {
  const repo = fakeRestic();
  let clock = new Date('2026-10-25T03:00:00Z');
  const { db, server, admin } = await adminSetup(offsiteConfig(), repo, () => clock);
  try {
    const scheduler = new BackupScheduler({
      db, config: server.config, secrets: [PASSWORD, APP_KEY, KEY_ID], lock: new HousekeepingLock(), runRestic: repo.runner, now: () => clock,
    });
    assert.equal(await scheduler.tick(), 'ran');

    // Local backup exists, made by the scheduler.
    const names = (await readdir(server.config.backupDir)).filter((n) => n.startsWith('scheduled-'));
    assert.equal(names.length, 1);
    const manifest = JSON.parse(await readFile(path.join(server.config.backupDir, names[0], 'manifest.json'), 'utf8'));
    assert.equal(manifest.createdBy, 'scheduler');

    // restic: probe -> init -> backup -> forget -> snapshots -> restore.
    assert.deepEqual(repo.calls.map((c) => c.args[0]), ['cat', 'init', 'backup', 'forget', 'snapshots', 'restore']);
    const backupArgs = repo.calls[2].args;
    assert.deepEqual(backupArgs.slice(0, 6), ['backup', '--json', '--host', 'beuk', '--tag', 'beuk-backup']);
    assert.equal(backupArgs[6], path.join(server.config.backupDir, names[0]));
    const forget = repo.calls[3].args.join(' ');
    assert.equal(forget, 'forget --host beuk --tag beuk-backup --group-by host,tags --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune');
    for (const call of repo.calls) {
      assert.ok(!call.args.join(' ').includes(PASSWORD) && !call.args.join(' ').includes(APP_KEY), 'secret on argv');
      assert.deepEqual(Object.keys(call.env).sort(), ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'HOME', 'PATH', 'RESTIC_CACHE_DIR', 'RESTIC_PASSWORD', 'RESTIC_REPOSITORY']);
      assert.equal(call.env.RESTIC_REPOSITORY, 's3:https://s3.example-region.backblazeb2.example/beuk-test-bucket/beuk');
    }

    // Audited as the scheduler, step by step.
    const audit = await auditRows(db);
    assert.ok(audit.includes('scheduler:backups.scheduled:created'), audit.join('\n'));
    assert.ok(audit.includes('scheduler:offsite.backup:pushed'));
    assert.ok(audit.includes('scheduler:offsite.drill:pass'));

    // Verdicts: all three pass now.
    assert.equal((await scheduleHealth(server.config, clock)).status, 'pass');
    assert.equal((await offsiteFreshness(server.config, clock)).status, 'pass');
    const drill = await drillHealth(server.config, clock);
    assert.equal(drill.status, 'pass', drill.detail);
    assert.match(drill.detail, /file hashes match/);
    assert.match(drill.detail, /manifest identical to the local copy/);

    // Not due again within the interval; due after it.
    clock = new Date(clock.getTime() + 2 * 3_600_000);
    assert.equal(await scheduler.tick(), 'not-due');
    clock = new Date(clock.getTime() + 23 * 3_600_000);
    assert.equal(await scheduler.tick(), 'ran');
    assert.equal(repo.snapshots.length, 2);

    // A freshness check 37 h after the last success fails with the age.
    const stale = await offsiteFreshness(server.config, new Date(clock.getTime() + 37 * 3_600_000));
    assert.equal(stale.status, 'fail');
    assert.match(stale.detail, /h old \(limit 36 h\)/);

    // The housekeeping API reports the same, with no secret in it.
    const status = await admin.get('/api/housekeeping/offsite');
    const text = JSON.stringify(status.body);
    assert.ok(!text.includes(PASSWORD) && !text.includes(APP_KEY) && !text.includes(KEY_ID), 'secret in /offsite');
    assert.equal((status.body.offsite as { configured: boolean }).configured, true);
  } finally {
    await server.close();
  }
});

test('broken credential: the run is recorded as error with restic\'s message and the freshness check goes red; nothing secret is stored', async () => {
  const repo = fakeRestic();
  const { db, server, admin } = await adminSetup(offsiteConfig(), repo);
  try {
    const ok = await admin.post('/api/housekeeping/offsite/run');
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    repo.failWith = `Fatal: unable to open config file: Stat: The access key ID you provided does not exist (key ${APP_KEY})`;
    const failed = await admin.post('/api/housekeeping/offsite/run');
    assert.equal(failed.status, 502);
    const verdict = await offsiteFreshness(server.config);
    assert.equal(verdict.status, 'fail');
    assert.match(verdict.detail, /access key ID you provided does not exist/);
    assert.ok(!verdict.detail.includes(APP_KEY), 'the key was scrubbed');
    assert.match(verdict.detail, /\[redacted\]/);

    const run = await admin.post('/api/housekeeping/self-checks/run');
    const results = (run.body.run as { overall: string; results: { id: string; status: string }[] });
    assert.equal(results.overall, 'fail');
    assert.equal(results.results.find((r) => r.id === 'backup.offsite.fresh')?.status, 'fail');

    const audit = await auditRows(db);
    assert.ok(audit.includes('admin@example.com:offsite.run:error'), audit.join('\n'));
    for (const file of Object.values(STATUS_FILES)) {
      const raw = await readFile(path.join(server.config.backupDir, file), 'utf8').catch(() => '');
      assert.ok(!raw.includes(APP_KEY) && !raw.includes(PASSWORD), `secret in ${file}`);
    }
    const auditText = JSON.stringify((await admin.get('/api/housekeeping/audit')).body);
    assert.ok(!auditText.includes(APP_KEY) && !auditText.includes(PASSWORD));
  } finally {
    await server.close();
  }
});

test('restore drill: a tampered snapshot fails the drill and its self-check, naming the mismatch', async () => {
  const repo = fakeRestic();
  const { server, admin } = await adminSetup(offsiteConfig(), repo);
  try {
    assert.equal((await admin.post('/api/housekeeping/offsite/run')).status, 200);
    repo.tamper = (files) => files.set('db.json', Buffer.from('{"tables":{}}'));
    const drill = await admin.post('/api/housekeeping/offsite/drill');
    assert.equal(drill.status, 502);
    const d = drill.body.drill as { ok: boolean; detail: string };
    assert.equal(d.ok, false);
    assert.match(d.detail, /db\.json sha256 mismatch/);
    assert.match(d.detail, /users: manifest \d+ rows, db\.json -1/);
    const verdict = await drillHealth(server.config);
    assert.equal(verdict.status, 'fail');
    assert.match(verdict.detail, /last restore drill failed/);
  } finally {
    await server.close();
  }
});

test('scheduler: a backup that cannot be written is audited as error and the schedule check fails', async () => {
  const blocker = path.join(mkdtempSync(path.join(os.tmpdir(), 'beuk-block-')), 'not-a-dir');
  writeFileSync(blocker, 'a file where the backup dir should be');
  const db = await createTestDb();
  const config = testConfig({ backupIntervalHours: 24, backupDir: path.join(blocker, 'backups') });
  const scheduler = new BackupScheduler({ db, config, secrets: [], lock: new HousekeepingLock() });
  assert.equal(await scheduler.tick(), 'ran');
  const audit = await auditRows(db);
  assert.deepEqual(audit, ['scheduler:backups.scheduled:error']);
  const verdict = await scheduleHealth(config);
  assert.equal(verdict.status, 'fail');
});

test('scheduler: the lock is honoured (a running housekeeping action makes the tick wait)', async () => {
  const db = await createTestDb();
  const config = testConfig({ backupIntervalHours: 24 });
  const lock = new HousekeepingLock();
  const scheduler = new BackupScheduler({ db, config, secrets: [], lock });
  assert.ok(lock.tryAcquire('restore.execute'));
  assert.equal(await scheduler.tick(), 'lock-held');
  assert.deepEqual(await readdir(config.backupDir), []);
  lock.release();
  assert.equal(await scheduler.tick(), 'ran');
  assert.equal((await readdir(config.backupDir)).filter((n) => n.startsWith('scheduled-')).length, 1);
});

test('a restic that keeps retrying a bad key is stopped by the probe timeout and the error it retried on is reported', async () => {
  const repo = fakeRestic();
  const retrying: ResticRunner = async (args, env, timeoutMs) => {
    repo.calls.push({ args, env });
    return {
      code: 124,
      stdout: '',
      stderr: 'Stat(<config/>) returned error, retrying after 1.2s: Stat: The request signature we calculated does not match the signature you provided. Check your key and signing method.\nsignal terminated received, cleaning up\nFatal: unable to open config file: context canceled\n' + `(timeout ${timeoutMs})`,
    };
  };
  const { server, admin } = await adminSetup(offsiteConfig(), { ...repo, runner: retrying });
  try {
    const failed = await admin.post('/api/housekeeping/offsite/run');
    assert.equal(failed.status, 502);
    assert.equal(repo.calls[0].args.join(' '), 'cat config');
    const verdict = await offsiteFreshness(server.config);
    assert.equal(verdict.status, 'fail');
    assert.match(verdict.detail, /gave up after the timeout; it kept retrying on: Stat: The request signature we calculated does not match/);
  } finally {
    await server.close();
  }
});
