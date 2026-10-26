import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import type { Config } from '../src/config.js';
import type { Db } from '../src/db.js';
import { setAdmin } from '../src/housekeeping/admin.js';
import { createBackup } from '../src/housekeeping/backup.js';
import { HousekeepingLock } from '../src/housekeeping/lock.js';
import { STATUS_FILES } from '../src/housekeeping/offsite.js';
import { collectSecrets } from '../src/housekeeping/scrub.js';
import { createMailer, type MailMessage, type Mailer, type MailerStatus, type MailResult } from '../src/mailer.js';
import { BackupAlerts } from '../src/ops/alerts.js';
import { cleanReport, MAX_GROUPS_PER_DAY, purgeClientErrors, scrubErrorText } from '../src/ops/client-errors.js';
import { applyRetention, chooseDeletions, retentionPolicy } from '../src/ops/retention.js';
import { DEFAULT_OPS, dayIn, addDaysIso } from '../src/ops/settings.js';
import { readPublicStatus, StatusCache } from '../src/ops/status.js';
import { rollupUsage, usageSummary } from '../src/ops/usage.js';
import { Client, createTestDb, registerUser, startTestServer, testConfig } from './helpers.js';

/* Production ops: the public status page and JSON, backup alerts (once per
   incident, email + webhook), local backup retention, studio error reports
   and the daily usage counters. */

const root = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => readFile(path.join(root, ...p), 'utf8');

class RecordingMailer implements Mailer {
  sent: MailMessage[] = [];
  constructor(private readonly configured = true) {}
  status(): MailerStatus {
    return { configured: this.configured, transport: this.configured ? 'smtp' : 'none', from: 'beuk@example.com', detail: 'recording mailer (test)' };
  }
  async send(message: MailMessage): Promise<MailResult> {
    if (!this.configured) return { delivered: false, reason: 'email not configured', loggedToConsole: false };
    this.sent.push(message);
    return { delivered: true, messageId: `<t-${this.sent.length}@example.com>` };
  }
  async verify() {
    return { ok: this.configured, detail: 'test' };
  }
}

/** A local HTTP sink standing in for a Slack/Discord-style webhook. */
async function startSink(status = 200): Promise<{ url: string; bodies: unknown[]; close: () => Promise<void>; setStatus: (n: number) => void }> {
  const bodies: unknown[] = [];
  let current = status;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { bodies.push(JSON.parse(raw)); } catch { bodies.push(raw); }
      res.statusCode = current;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${addr.port}/hooks/T000/B000/CANARYwebhookTOKEN123456`,
    bodies,
    close: () => new Promise((r) => server.close(() => r())),
    setStatus: (n: number) => { current = n; },
  };
}

async function waitFor(fn: () => Promise<boolean>, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('condition not met in time');
}

async function adminClient(db: Db, base: string, email = 'admin@example.com'): Promise<Client> {
  const c = new Client(base);
  await registerUser(c, email);
  await setAdmin(db, email, true);
  return c;
}

/* ------------------------------ status ------------------------------ */

test('status JSON: honest states, 30 s cache header, no internals or secrets', async () => {
  const db = await createTestDb();
  const CANARY = 'smtp-pass-CANARY-4242';
  const server = await startTestServer(db, undefined, { smtpUrl: `smtp://user:${CANARY}@mail.example.com:587`, mailFrom: 'Beuk <a@example.com>' });
  try {
    const res = await fetch(`${server.base}/api/status/public`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control') ?? '', /max-age=30/);
    const body = (await res.json()) as { ok: boolean; overall: string; components: { id: string; state: string; summary: string; checkedAt: string }[] };
    assert.equal(body.ok, true);
    const by = Object.fromEntries(body.components.map((c) => [c.id, c]));
    assert.deepEqual(Object.keys(by).sort(), ['backups', 'email', 'help', 'serverChecks', 'shelf', 'studio']);
    assert.equal(by.shelf.state, 'ok');
    assert.equal(by.studio.state, 'ok');
    assert.equal(by.email.state, 'ok', 'SMTP_URL + MAIL_FROM set: configured');
    assert.equal(by.serverChecks.state, 'off', 'no EPUBCheck / PDF/X tools in tests: not installed, never "working"');
    assert.match(by.serverChecks.summary, /EPUBCheck not installed/);
    assert.equal(by.backups.state, 'off', 'BACKUP_INTERVAL_HOURS=0 in tests: scheduled backups off');
    assert.match(by.backups.summary, /No backup has been made yet/);
    assert.match(by.backups.summary, /No off-site copy is set up yet/);
    for (const c of body.components) assert.ok(!Number.isNaN(Date.parse(c.checkedAt)), `${c.id} has a reading time`);
    const text = JSON.stringify(body);
    for (const bad of [CANARY, 'mail.example.com', server.config.backupDir, server.config.exportDir, 'test-build-1']) {
      assert.ok(!text.includes(bad), `must not show ${bad}`);
    }
    // Switched-off parts are not failures, but the headline never says "everything is working".
    assert.equal(body.overall, 'ok');
    assert.match((body as unknown as { headline: string }).headline, /Some parts are not set up on this server yet/);
  } finally {
    await server.close();
  }
});

test('status: email not set up is said plainly; the page renders in Paper style without JS', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    const json = (await (await fetch(`${server.base}/api/status/public`)).json()) as { components: { id: string; state: string; summary: string }[] };
    const email = json.components.find((c) => c.id === 'email')!;
    assert.equal(email.state, 'off');
    assert.match(email.summary, /Email isn't set up on this server/);
    const page = await fetch(`${server.base}/status`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<body class="help">/);
    assert.match(html, /<title>Status — Beuk<\/title>/);
    for (const name of ['Studio', 'Shelf', 'Help', 'Server checks', 'Email', 'Backups']) assert.ok(html.includes(name), name);
    assert.match(html, /Not set up/);
    assert.match(html, /when the server is down it does not load at all/);
    assert.doesNotMatch(html, /!</, 'no exclamation marks in the copy');
  } finally {
    await server.close();
  }
});

test('status: a database that does not answer is "down" with 503; readings are cached 30 s', async () => {
  const db = await createTestDb();
  const broken: Db = { query: async () => { throw new Error('connection refused at 10.0.0.5'); }, tx: async () => { throw new Error('down'); } };
  const config = testConfig();
  const s = await readPublicStatus(broken, config, createMailer(config));
  assert.equal(s.ok, false);
  assert.equal(s.overall, 'down');
  assert.equal(s.components.find((c) => c.id === 'shelf')!.state, 'down');
  assert.ok(!JSON.stringify(s).includes('10.0.0.5'), 'no error text');

  let reads = 0;
  let clock = 1_000;
  const cache = new StatusCache(async () => { reads += 1; return readPublicStatus(db, config, createMailer(config)); }, () => clock);
  await cache.get();
  clock += 29_000;
  await cache.get();
  assert.equal(reads, 1);
  clock += 2_000;
  await cache.get();
  assert.equal(reads, 2);
});

test('status: Caddy routes /status to the app, both workers leave it to the network, sitemap lists it', async () => {
  const caddy = await read('Caddyfile');
  assert.ok(caddy.includes('handle /status* {\n\t\treverse_proxy app:3000\n\t}'));
  for (const p of [['client', 'sw.js'], ['client', 'assets', 'sw.js']]) {
    const sw = await read(...p);
    // Other server pages share the group (account, features, …): status must be one of them.
    assert.match(sw, /sitemap\\\.xml(\|[a-z-]+)*\|status(\|[a-z-]+)*\)\(\\\/\|\$\)/, p.join('/'));
  }
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, { appBaseUrl: 'https://beuk.studio' });
  try {
    const xml = await (await fetch(`${server.base}/sitemap.xml`)).text();
    assert.ok(xml.includes('<loc>https://beuk.studio/status</loc>'));
  } finally {
    await server.close();
  }
});

/* ------------------------------ alerts ------------------------------ */

function alertConfig(extra: Partial<Config['ops']> = {}, base: Partial<Config> = {}): Config {
  return testConfig({ backupIntervalHours: 24, ops: { ...DEFAULT_OPS, ...extra }, ...base });
}

test('alerts: once per incident on both channels, once on recovery, never every tick', async () => {
  const db = await createTestDb();
  const sink = await startSink();
  try {
    const config = alertConfig({ alertEmail: 'ops@example.com', alertWebhookUrl: sink.url });
    const mailer = new RecordingMailer();
    let now = new Date('2026-10-26T10:00:00Z');
    const alerts = new BackupAlerts({ db, config, mailer, secrets: collectSecrets(config), now: () => now });

    // No scheduled backup has run: backup.schedule.running is red.
    const first = await alerts.evaluate();
    assert.equal(first.action, 'opened');
    assert.deepEqual(first.failing.map((f) => f.id), ['backup.schedule.running']);
    assert.equal(mailer.sent.length, 1);
    assert.equal(mailer.sent[0].to, 'ops@example.com');
    assert.equal(mailer.sent[0].subject, 'Beuk: backups need attention');
    assert.equal(sink.bodies.length, 1);
    const hook = sink.bodies[0] as { event: string; state: string; text: string; content: string; failing: { id: string }[] };
    assert.equal(hook.event, 'beuk.backups.alert');
    assert.equal(hook.state, 'open');
    assert.ok(hook.text.length > 0 && hook.content.length <= 2000);
    assert.equal(hook.failing[0].id, 'backup.schedule.running');
    assert.ok(!JSON.stringify(sink.bodies).includes('CANARYwebhookTOKEN'), 'the webhook URL is a secret');

    // Four more ticks while still red: no new alert.
    for (let i = 0; i < 4; i++) {
      now = new Date(now.getTime() + 15 * 60_000);
      const again = await alerts.evaluate();
      assert.notEqual(again.action, 'opened');
    }
    assert.equal(mailer.sent.length, 1);
    assert.equal(sink.bodies.length, 1);

    // The state survives a restart (a new instance reads the table).
    const fresh = new BackupAlerts({ db, config, mailer, secrets: collectSecrets(config), now: () => now });
    assert.equal((await fresh.evaluate()).action === 'opened', false);
    assert.equal(mailer.sent.length, 1);

    // A good scheduled backup: green again -> one recovery message each.
    await writeFile(path.join(config.backupDir, STATUS_FILES.schedule), JSON.stringify({
      lastAttemptAt: now.toISOString(), lastSuccessAt: now.toISOString(), lastBackupName: 'scheduled-x', lastError: null,
    }));
    const healed = await fresh.evaluate();
    assert.equal(healed.action, 'resolved');
    assert.equal(mailer.sent.length, 2);
    assert.equal(mailer.sent[1].subject, 'Beuk: backups are working again');
    assert.equal(sink.bodies.length, 2);
    assert.equal((sink.bodies[1] as { state: string }).state, 'resolved');
    assert.equal((await fresh.evaluate()).action, 'none');

    const row = await db.query<{ open: boolean; last_alert_kind: string; last_alert_result: string }>('select open, last_alert_kind, last_alert_result from ops_alerts');
    assert.equal(row.rows[0].open, false);
    assert.equal(row.rows[0].last_alert_kind, 'resolved');
    assert.match(row.rows[0].last_alert_result, /email ok/);
    assert.ok(!row.rows[0].last_alert_result.includes('CANARYwebhookTOKEN'));
  } finally {
    await sink.close();
  }
});

test('alerts: without email set up nothing is claimed as sent; slack/discord formats; failing webhook is reported', async () => {
  const db = await createTestDb();
  const sink = await startSink();
  const bad = await startSink(500);
  try {
    const noMail = alertConfig({ alertEmail: 'ops@example.com' });
    const r1 = await new BackupAlerts({ db, config: noMail, mailer: new RecordingMailer(false), secrets: [] }).evaluate();
    assert.equal(r1.action, 'opened');
    assert.equal(r1.channels.length, 1);
    assert.equal(r1.channels[0].ok, false);
    assert.match(r1.channels[0].detail, /email isn't set up on this server/);

    const db2 = await createTestDb();
    const nothing = await new BackupAlerts({ db: db2, config: alertConfig(), mailer: new RecordingMailer(), secrets: [] }).evaluate();
    assert.equal(nothing.action, 'opened');
    assert.match(nothing.state.lastAlertResult ?? '', /no alert channel is configured/);

    const slack = alertConfig({ alertWebhookUrl: sink.url, alertWebhookFormat: 'slack' });
    await new BackupAlerts({ db: await createTestDb(), config: slack, mailer: new RecordingMailer(), secrets: [] }).sendTest();
    assert.deepEqual(Object.keys(sink.bodies[0] as object), ['text']);
    const discord = alertConfig({ alertWebhookUrl: sink.url, alertWebhookFormat: 'discord' });
    await new BackupAlerts({ db: await createTestDb(), config: discord, mailer: new RecordingMailer(), secrets: [] }).sendTest();
    assert.deepEqual(Object.keys(sink.bodies[1] as object), ['content']);

    const failing = alertConfig({ alertWebhookUrl: bad.url });
    const [res] = await new BackupAlerts({ db: await createTestDb(), config: failing, mailer: new RecordingMailer(), secrets: [] }).sendTest();
    assert.equal(res.ok, false);
    assert.match(res.detail, /answered 500/);

    // Off-site / drill not configured are never an incident.
    const off = alertConfig({}, { backupIntervalHours: 0 });
    const quiet = await new BackupAlerts({ db: await createTestDb(), config: off, mailer: new RecordingMailer(), secrets: [] }).evaluate();
    assert.equal(quiet.action, 'none');
  } finally {
    await sink.close();
    await bad.close();
  }
});

test('alerts: an opening alert that never arrived is tried again (gap, cap), and reaches a channel added mid-incident', async () => {
  const sink = await startSink(500);
  try {
    // 1. The webhook fails once, then works: one retry delivers it, then silence.
    const db = await createTestDb();
    const config = alertConfig({ alertWebhookUrl: sink.url });
    let now = new Date('2026-10-26T10:00:00Z');
    const alerts = new BackupAlerts({ db, config, mailer: new RecordingMailer(), secrets: collectSecrets(config), now: () => now });
    const first = await alerts.evaluate();
    assert.equal(first.action, 'opened');
    assert.equal(first.state.delivered, false);
    assert.equal(first.state.openAttempts, 1);
    assert.match(first.state.lastAlertResult ?? '', /webhook failed: the webhook answered 500; not delivered yet \(attempt 1 of 4\)/);
    now = new Date(now.getTime() + 5 * 60_000);
    assert.ok(!['opened', 'retried'].includes((await alerts.evaluate()).action), 'no retry sooner than the gap');
    assert.equal(sink.bodies.length, 1);
    sink.setStatus(200);
    now = new Date(now.getTime() + 10 * 60_000);
    const retried = await alerts.evaluate();
    assert.equal(retried.action, 'retried');
    assert.equal(retried.state.delivered, true);
    assert.equal(retried.state.openAttempts, 2);
    assert.equal(sink.bodies.length, 2);
    assert.equal((sink.bodies[1] as { state: string }).state, 'open');
    for (let i = 0; i < 3; i++) {
      now = new Date(now.getTime() + 15 * 60_000);
      assert.ok(!['opened', 'retried'].includes((await alerts.evaluate()).action));
    }
    assert.equal(sink.bodies.length, 2, 'delivered once: no more alerts for this incident');
    const row = await db.query<{ delivered: boolean; open_attempts: number }>('select delivered, open_attempts from ops_alerts');
    assert.equal(row.rows[0].delivered, true);
    assert.equal(row.rows[0].open_attempts, 2);

    // 2. A webhook that never works: at most 4 attempts, then it stops and says so.
    sink.setStatus(500);
    const before = sink.bodies.length;
    const db2 = await createTestDb();
    let t = new Date('2026-10-26T10:00:00Z');
    const stubborn = new BackupAlerts({ db: db2, config, mailer: new RecordingMailer(), secrets: collectSecrets(config), now: () => t });
    let last = await stubborn.evaluate();
    for (let i = 0; i < 8; i++) {
      t = new Date(t.getTime() + 15 * 60_000);
      last = await stubborn.evaluate();
    }
    assert.equal(sink.bodies.length - before, 4);
    assert.equal(last.state.openAttempts, 4);
    const kept = await stubborn.readState();
    assert.match(kept.lastAlertResult ?? '', /not delivered after 4 attempts, no further tries for this incident/);

    // 3. No channel when the incident opened; a webhook is configured later (restart).
    sink.setStatus(200);
    const db3 = await createTestDb();
    let u = new Date('2026-10-26T10:00:00Z');
    const bare = new BackupAlerts({ db: db3, config: alertConfig(), mailer: new RecordingMailer(), secrets: [], now: () => u });
    const opened = await bare.evaluate();
    assert.equal(opened.action, 'opened');
    assert.equal(opened.state.openAttempts, 0, 'no channel: no attempt used up');
    u = new Date(u.getTime() + 15 * 60_000);
    assert.ok(!['opened', 'retried'].includes((await bare.evaluate()).action));
    const n = sink.bodies.length;
    u = new Date(u.getTime() + 15 * 60_000);
    const later = new BackupAlerts({ db: db3, config, mailer: new RecordingMailer(), secrets: collectSecrets(config), now: () => u });
    const told = await later.evaluate();
    assert.equal(told.action, 'retried');
    assert.equal(told.state.delivered, true);
    assert.equal(sink.bodies.length, n + 1);
  } finally {
    await sink.close();
  }
});

test('alerts + retention in Housekeeping: admins only, policy and channels shown, test alert', async () => {
  const db = await createTestDb();
  const sink = await startSink();
  const server = await startTestServer(db, undefined, { ops: { ...DEFAULT_OPS, alertWebhookUrl: sink.url } });
  try {
    const anon = await new Client(server.base).get('/api/housekeeping/ops');
    assert.equal(anon.status, 404);
    const user = new Client(server.base);
    await registerUser(user, 'writer@example.com');
    assert.equal((await user.get('/api/housekeeping/ops')).status, 404);
    assert.equal((await user.get('/api/housekeeping/client-errors')).status, 404);

    const admin = await adminClient(db, server.base);
    const ops = await admin.get('/api/housekeeping/ops');
    assert.equal(ops.status, 200);
    const body = ops.body as { alerts: { channels: { webhook: { set: boolean } } }; retention: { policy: { keepAll: boolean; description: string } } };
    assert.equal(body.alerts.channels.webhook.set, true);
    assert.equal(body.retention.policy.keepAll, true);
    assert.match(body.retention.policy.description, /keep everything/);
    assert.ok(!JSON.stringify(ops.body).includes('CANARYwebhookTOKEN'), 'webhook URL never shown');

    const t = await admin.post('/api/housekeeping/alerts/test');
    assert.equal(t.status, 200);
    assert.equal(sink.bodies.length, 1);
    assert.equal((sink.bodies[0] as { state: string }).state, 'test');

    const prune = await admin.post('/api/housekeeping/backups/prune');
    assert.equal(prune.status, 409, 'retention unset: nothing to prune, by design');

    const catalog = await admin.get('/api/housekeeping/actions');
    const names = (catalog.body.actions as { name: string }[]).map((a) => a.name);
    for (const n of ['ops.status', 'alerts.test', 'backups.prune', 'client-errors.list', 'usage.list']) assert.ok(names.includes(n), n);
    const offsite = await admin.get('/api/housekeeping/offsite');
    assert.match(String((offsite.body.offsite as { localRetention: string }).localRetention), /keep everything/);
  } finally {
    await server.close();
    await sink.close();
  }
});

/* ------------------------------ retention ------------------------------ */

async function makeBackups(db: Db, config: Config, ages: number[], now: Date): Promise<string[]> {
  const names: string[] = [];
  for (let i = 0; i < ages.length; i++) {
    const name = `b-${i}`;
    await createBackup(db, config, { name, createdBy: 'test', secrets: [] });
    const file = path.join(config.backupDir, name, 'manifest.json');
    const m = JSON.parse(await readFile(file, 'utf8'));
    m.createdAt = new Date(now.getTime() - ages[i] * 86_400_000).toISOString();
    await writeFile(file, JSON.stringify(m));
    names.push(name);
  }
  return names;
}

const dirs = async (config: Config) => (await readdir(config.backupDir)).filter((n) => !n.startsWith('.')).sort();

test('retention: unset keeps everything; count and days keep the newest; unfinished dirs are left alone', async () => {
  const db = await createTestDb();
  const now = new Date('2026-10-26T12:00:00Z');

  const keepAll = testConfig();
  await makeBackups(db, keepAll, [10, 5, 1, 0.1], now);
  const r0 = await applyRetention(keepAll, new HousekeepingLock(), now);
  assert.equal(r0.outcome, 'keep-all');
  assert.equal((await dirs(keepAll)).length, 4);

  const byCount = testConfig({ ops: { ...DEFAULT_OPS, backupKeepCount: 2 } });
  await makeBackups(db, byCount, [10, 5, 1, 0.1], now);
  await mkdir(path.join(byCount.backupDir, 'half-written')); // no manifest: not ours to judge
  const r1 = await applyRetention(byCount, new HousekeepingLock(), now);
  assert.equal(r1.outcome, 'pruned');
  assert.deepEqual(r1.deleted.sort(), ['b-0', 'b-1']);
  assert.deepEqual(await dirs(byCount), ['b-2', 'b-3', 'half-written']);

  const byDays = testConfig({ ops: { ...DEFAULT_OPS, backupKeepDays: 3 } });
  await makeBackups(db, byDays, [40, 30, 20], now); // all older than 3 days
  const r2 = await applyRetention(byDays, new HousekeepingLock(), now);
  assert.deepEqual(r2.kept, ['b-2'], 'the newest complete backup is never deleted');
  assert.deepEqual(await dirs(byDays), ['b-2']);

  // Both set: kept if either rule keeps it.
  const both = chooseDeletions(
    [{ name: 'a', createdAt: '2026-10-01T00:00:00Z' }, { name: 'b', createdAt: '2026-10-20T00:00:00Z' }, { name: 'c', createdAt: '2026-10-25T00:00:00Z' }, { name: 'd', createdAt: '2026-10-26T00:00:00Z' }],
    retentionPolicy(testConfig({ ops: { ...DEFAULT_OPS, backupKeepCount: 2, backupKeepDays: 10 } })),
    now,
  );
  assert.deepEqual(both.remove, ['a']);
});

test('retention: never prunes while a backup (the Housekeeping lock) is running', async () => {
  const db = await createTestDb();
  const now = new Date('2026-10-26T12:00:00Z');
  const config = testConfig({ ops: { ...DEFAULT_OPS, backupKeepCount: 1 } });
  await makeBackups(db, config, [3, 2, 1], now);
  const lock = new HousekeepingLock();
  assert.ok(lock.tryAcquire('backups.scheduled'));
  const r = await applyRetention(config, lock, now);
  assert.equal(r.outcome, 'skipped-busy');
  assert.equal((await dirs(config)).length, 3);
  assert.equal(lock.heldBy, 'backups.scheduled', 'the backup keeps its lock');
  lock.release();
  const r2 = await applyRetention(config, lock, now);
  assert.equal(r2.outcome, 'pruned');
  assert.deepEqual(await dirs(config), ['b-2']);
  assert.equal(lock.heldBy, null);
});

/* ------------------------------ client errors ------------------------------ */

test('client errors: scrubbing on the server', () => {
  const out = scrubErrorText(
    'TypeError at https://beuk.studio/studio?token=abc#frag and /reset?token=zzz, /read/Qm9vay1zZWNyZXQ/ch1, ' +
      'writer@example.com, 123e4567-e89b-12d3-a456-426614174000, sk_live_51HxQabcdefghijklmnop12, ' +
      '"It was a dark and stormy night, the rain fell" My-Book.docx cover.png renderInsightsNamesOnStage',
  );
  for (const bad of ['token=abc', '#frag', 'zzz', 'Qm9vay1zZWNyZXQ', 'writer@example.com', '123e4567', 'sk_live_51Hx', 'stormy night', 'My-Book.docx', 'cover.png']) {
    assert.ok(!out.includes(bad), `${bad} must be scrubbed: ${out}`);
  }
  for (const keep of ['https://beuk.studio/studio', '/reset', '/read/:token', '[email]', '[id]', '[token]', '"[…]"', '[file]', 'renderInsightsNamesOnStage']) {
    assert.ok(out.includes(keep), `${keep} kept: ${out}`);
  }
  const r = cleanReport({ message: 'x'.repeat(5000), stack: Array.from({ length: 40 }, (_, i) => `at f${i} (https://beuk.studio/studio:1:${i})`).join('\n'), lang: 'zh-Hans', device: 'phone', build: 'beuk-shell-v7', userId: 'u1', title: 'My Book' });
  assert.ok(r);
  assert.equal(r.message.length, 300);
  assert.equal(r.stack.split('\n').length, 15);
  assert.equal(r.uiLang, 'zh-Hans');
  assert.equal(cleanReport({ message: 'm', lang: '<script>', device: 'fridge', build: 'a b' })!.uiLang, '-');
  assert.equal(cleanReport('nope'), null);
});

test('client errors: file names with spaces and quoted file names are removed whole; the known limits stay as documented', () => {
  assert.equal(scrubErrorText('Could not open My Secret Novel.docx'), 'Could not open [file]');
  assert.equal(scrubErrorText("Failed to read 'The Lantern Coast.epub'"), "Failed to read '[file]'");
  assert.equal(scrubErrorText('Failed to read "The Lantern Coast.epub" now'), 'Failed to read "[file]" now');
  assert.equal(scrubErrorText('\u201cA Long Night.pdf\u201d'), '\u201c[file]\u201d');
  assert.equal(scrubErrorText('Draft 3 Final_v2.docx failed'), '[file] failed');
  assert.equal(scrubErrorText('"It was a dark and stormy night, the rain fell" My-Book.docx'), '"[…]" [file]');
  // Ordinary error text and stack frames are untouched.
  assert.equal(scrubErrorText("TypeError: Cannot read properties of undefined (reading 'x')"), "TypeError: Cannot read properties of undefined (reading 'x')");
  assert.equal(scrubErrorText('at render (https://beuk.studio/studio:12:5)'), 'at render (https://beuk.studio/studio:12:5)');
  // Known limits (docs/privacy-inventory.md §12; the studio note does not promise more).
  assert.equal(scrubErrorText('could not open my secret novel.docx'), 'could not open my secret [file]');
  assert.equal(scrubErrorText('Bad chapter: The Night My Father Left'), 'Bad chapter: The Night My Father Left');
});

test('client errors: the studio scrubber matches the server one', async () => {
  const html = await read('client', 'index.html');
  const a = html.indexOf('/* BEUK:errscrub */');
  const b = html.indexOf('/* /BEUK:errscrub */');
  assert.ok(a > 0 && b > a);
  const studioScrub = new Function(`${html.slice(a, b)}; return beukErrScrub;`)() as (s: string) => string;
  for (const sample of [
    'Failed https://beuk.studio/api/x?y=1 for a.b@c.co',
    'at /read/abcdef123/x:1:2 "a quoted sentence that is long enough"',
    'id 123e4567-e89b-12d3-a456-426614174000 tok ghp_abcdefghijklmnop0123456789 Chapter One.docx',
    'Could not open My Secret Novel.docx',
    "Failed to read 'The Lantern Coast.epub'",
    'Failed to read "The Lantern Coast.epub" now and \u201cDraft 3 Final.pdf\u201d',
    'could not open my secret novel.docx',
  ]) {
    assert.equal(studioScrub(sample), scrubErrorText(sample), sample);
  }
});

test('client errors: endpoint stores aggregates only, caps bodies, rate-limits, keeps 30 days; Housekeeping groups them', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, undefined, undefined, undefined);
  const post = (body: unknown, ip = '203.0.113.9') =>
    fetch(`${server.base}/api/client-errors`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  try {
    const report = { kind: 'error', message: 'Cannot read properties of undefined (reading \'x\') for writer@example.com', stack: 'at f (https://beuk.studio/studio?s=1:10:5)', build: 'beuk-shell-v7', lang: 'fr', device: 'desktop', at: '2026-10-26T10:00:00.000Z' };
    assert.equal((await post(report)).status, 204);
    assert.equal((await post(report, '203.0.113.10')).status, 204);
    assert.equal((await post({ ...report, lang: 'de' }, '203.0.113.11')).status, 204);
    const rows = await db.query<Record<string, unknown>>('select * from client_errors order by ui_lang');
    assert.equal(rows.rows.length, 2, 'one row per (fingerprint, language, device) per day');
    assert.equal(rows.rows.find((r) => r.ui_lang === 'fr')!.count, 2);
    const all = JSON.stringify(rows.rows);
    for (const bad of ['writer@example.com', '203.0.113', '?s=1']) assert.ok(!all.includes(bad), bad);
    const cols = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'client_errors'`);
    for (const c of cols.rows.map((r) => r.column_name)) assert.ok(!/ip|user|email|agent|title/.test(c), `no identifying column: ${c}`);

    assert.equal((await post({ message: 'x', stack: 'y'.repeat(5000) }, '203.0.113.12')).status, 413);
    assert.equal((await post('{not json', '203.0.113.13')).status, 400);
    assert.equal((await post({ nothing: true }, '203.0.113.14')).status, 400);

    // Per-IP bucket (10 up front).
    let limited = 0;
    for (let i = 0; i < 12; i++) if ((await post({ message: `m${i}` }, '198.51.100.7')).status === 429) limited += 1;
    assert.equal(limited, 2);

    // Retention: an old row is purged.
    await db.query(`insert into client_errors (day, fingerprint, message, last_seen_hour) values ('2026-01-01', 'old', 'old error', now())`);
    const removed = await purgeClientErrors(db, server.config, new Date());
    assert.equal(removed, 1);

    const admin = await adminClient(db, server.base);
    const list = await admin.get('/api/housekeeping/client-errors');
    assert.equal(list.status, 200);
    const groups = list.body.groups as { message: string; count: number; languages: string[] }[];
    const g = groups.find((x) => x.message.startsWith('Cannot read properties'))!;
    assert.equal(g.count, 3);
    assert.deepEqual([...g.languages].sort(), ['de', 'fr']);
    assert.ok(g.message.includes('[email]'));
    assert.equal(list.body.keepDays, 30);
  } finally {
    await server.close();
  }
  assert.ok(MAX_GROUPS_PER_DAY >= 100);
});

test('client errors: the studio sends them without cookies, deduped and capped, with a setting in 13 locales', async () => {
  const html = await read('client', 'index.html');
  const block = html.slice(html.indexOf('/* ==== BEUK:errors ===='), html.indexOf('/* ==== /BEUK:errors ==== */'));
  assert.match(block, /window\.addEventListener\("error"/);
  assert.match(block, /window\.addEventListener\("unhandledrejection"/);
  assert.match(block, /credentials: "omit"/);
  assert.match(block, /const BEUK_ERR_MAX = 5;/);
  assert.match(block, /beukErrSeen\[key\]/);
  assert.match(block, /"beuk\.errors\.v1"/);
  // Opt-in: nothing is sent until the writer turns reports on (the privacy page promises
  // nothing is sent while signed out; V and the lawyer decide before this changes).
  assert.match(block, /localStorage\.getItem\(BEUK_ERRORS_KEY\) === "on"; \} catch \(e\) \{ return false; \}/);
  assert.doesNotMatch(block, /state\.(doc|book|title)|activeSection\(|\.content\b/, 'no book data near the reporter');
  assert.match(html, /<input type="checkbox" id="setErrReports" \/>/);
  for (const k of ['errs.toggle', 'errs.note']) {
    assert.equal(html.split(`"${k}": "`).length - 1, 13, `${k} in 13 locales`);
  }
  // The toggle is a device preference: in "Beuk on this device", not in the book-metadata form.
  const modal = html.slice(html.indexOf('<div class="modal-back" id="modalSettings">'));
  const about = modal.indexOf('<div class="about-box">');
  const row = modal.indexOf('id="errReportsRow"');
  assert.ok(about > 0 && row > about && row < modal.indexOf('<div class="modal-actions">'), 'toggle sits in the about box');
  // The note neither over-promises nor names a retention number the server may change.
  const notes = html.split('"errs.note": "').slice(1).map((x) => x.slice(0, x.indexOf('"')));
  assert.equal(notes.length, 13);
  for (const n of notes) {
    assert.doesNotMatch(n, /30/, 'no fixed day count');
    assert.doesNotMatch(n, /never your book|file names or your account/i);
  }
  assert.match(notes[0], /most file names/);
  assert.match(notes[0], /could still carry them/);
});

/* ------------------------------ usage ------------------------------ */

test('usage: counts sign-ups, sign-ins, first shelf save, exports, EPUBCheck runs, share links; no identifiers stored', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  const today = dayIn(new Date(), 'UTC');
  const count = async (counter: string) =>
    (await db.query<{ count: number }>(`select count from usage_daily where day = $1::date and counter = $2`, [today, counter])).rows[0]?.count ?? 0;
  try {
    const c = new Client(server.base);
    await registerUser(c, 'w1@example.com');
    await waitFor(async () => (await count('sign_ups')) === 1);
    await c.post('/api/auth/login', { email: 'w1@example.com', password: 'correct horse battery' });
    await c.post('/api/auth/login', { email: 'w1@example.com', password: 'wrong password!' });
    await waitFor(async () => (await count('sign_ins')) === 1);

    const m1 = await c.post('/api/manuscripts', { title: 'One', doc: { title: 'One' } });
    assert.equal(m1.status, 201);
    await waitFor(async () => (await count('first_shelf_saves')) === 1);
    await c.post('/api/manuscripts', { title: 'Two', doc: { title: 'Two' } });
    const id = (m1.body.manuscript as { id: string }).id;
    const up = await c.upload(`/api/exports?manuscriptId=${id}&format=epub&filename=one.epub`, Buffer.from('PK fake epub'));
    assert.equal(up.status, 201);
    await waitFor(async () => (await count('exports_archived')) === 1);
    const exportId = (up.body.export as { id: string }).id;
    const job = await c.post('/api/jobs/epubcheck', { exportId });
    assert.ok(job.status >= 200 && job.status < 300, `job ${job.status}`);
    await waitFor(async () => (await count('epubcheck_runs')) === 1);
    const share = await c.post('/api/shares', { manuscriptId: id });
    if (share.status === 201) await waitFor(async () => (await count('share_links_created')) === 1);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(await count('first_shelf_saves'), 1, 'the second book is not a first save');

    const cols = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'usage_daily' order by ordinal_position`);
    assert.deepEqual(cols.rows.map((r) => r.column_name), ['day', 'counter', 'count', 'final']);
    const dump = JSON.stringify((await db.query('select * from usage_daily')).rows);
    assert.ok(!dump.includes('w1@example.com') && !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(dump), 'no emails, no ids');

    const admin = await adminClient(db, server.base);
    await waitFor(async () => (await count('sign_ups')) === 2);
    const u = await admin.get('/api/housekeeping/usage');
    assert.equal(u.status, 200);
    const days = u.body.days as { day: string; counts: Record<string, number> }[];
    assert.equal(days.length, 30);
    assert.equal(days[0].day, today);
    assert.equal(days[0].counts.sign_ups, 2, 'the writer and the admin');
  } finally {
    await server.close();
  }
});

test('usage: "came back after 7 days" comes from writing days; a past day is computed once', async () => {
  const db = await createTestDb();
  const config = testConfig();
  const now = new Date('2026-10-26T12:00:00Z');
  const today = dayIn(now, 'UTC');
  const u = async (email: string) => (await db.query<{ id: string }>(`insert into users (email, password_hash) values ($1, 'x') returning id`, [email])).rows[0].id;
  const a = await u('a@example.com');
  const b = await u('b@example.com');
  const c = await u('c@example.com');
  const day = (id: string, d: string) => db.query(`insert into streak_days (user_id, day) values ($1, $2::date)`, [id, d]);
  await day(a, addDaysIso(today, -9)); await day(a, today); // back after 9 days
  await day(b, addDaysIso(today, -3)); await day(b, today); // only 3 days
  await day(c, today); // first ever day: not "came back"
  await rollupUsage(db, config, now, 30);
  const s = await usageSummary(db, config, now, 30);
  assert.equal(s.days[0].counts.came_back_after_7_days, 1);

  // The day after, that day is computed one last time and marked final;
  // later changes to the data do not rewrite it.
  const tomorrow = new Date(now.getTime() + 86_400_000);
  await rollupUsage(db, config, tomorrow, 30);
  await day(c, addDaysIso(today, -20));
  await rollupUsage(db, config, tomorrow, 30);
  const s2 = await usageSummary(db, config, new Date(now.getTime() + 86_400_000), 30);
  assert.equal(s2.days[1].day, today);
  assert.equal(s2.days[1].counts.came_back_after_7_days, 1);
});

test('ops tables are excluded from backups and carry no identifying columns', async () => {
  const { EXCLUDED_TABLES, SECRET_CONFIG_KEYS } = await import('../src/housekeeping/backup.js');
  for (const t of ['client_errors', 'usage_daily', 'ops_alerts']) assert.ok(t in EXCLUDED_TABLES, t);
  assert.ok((SECRET_CONFIG_KEYS as readonly string[]).includes('ALERT_WEBHOOK_URL'));
  const secrets = collectSecrets(testConfig({ ops: { ...DEFAULT_OPS, alertWebhookUrl: 'https://hooks.example/T/B/secretTOKEN' } }));
  assert.ok(secrets.includes('https://hooks.example/T/B/secretTOKEN'));
});
