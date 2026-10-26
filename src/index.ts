import type { Server } from 'node:http';
import { buildApp } from './app.js';
import { purgeExpiredSessions } from './auth.js';
import { createShutdown } from './shutdown.js';
import { loadConfig } from './config.js';
import { checkHelpContent, getHelpContent } from './help/content.js';
import { rebuildHelpIndex } from './help/search.js';
import { createPgDb, defaultMigrationsDir, runMigrations, type Db } from './db.js';
import type { BootCheck } from './housekeeping/context.js';
import { createPgScratchFactory } from './housekeeping/scratch.js';
import type { JobRunner } from './jobs/runner.js';
import type { BackupScheduler } from './housekeeping/offsite.js';
import type { OpsService } from './ops/service.js';
import type { TrialReminders } from './trial-mail.js';

const config = loadConfig();
if (!config.databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

// ADMIN_EMAILS used to grant admin by email match; it is ignored now.
if (process.env.ADMIN_EMAILS) {
  console.warn(
    'ADMIN_EMAILS is set but no longer grants admin. Grant it with: node dist/admin-cli.js grant <email>',
  );
}

const db = createPgDb(config.databaseUrl);
const applied = await runMigrations(db, defaultMigrationsDir());
if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`);

// H1/H2: check the help content and (re)build its search index from the
// content files. Problems are logged loudly; the server still boots so
// the studio and API stay up, and /help reports what it can.
try {
  const problems = checkHelpContent(getHelpContent());
  if (problems.length) console.error(`help content: ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  const idx = await rebuildHelpIndex(db);
  console.log(`help search index: ${idx.upserted} documents, ${idx.removed} removed`);
} catch (err) {
  console.error('help content could not be loaded or indexed', err);
}

/** Rehearse boot check: stand the real app up on an ephemeral port
 *  against the scratch database and probe its health endpoint. */
const bootCheck: BootCheck = async (scratchDb: Db) => {
  const scratchApp = buildApp({ db: scratchDb, config });
  const server: Server = await new Promise((resolve) => {
    const s = scratchApp.listen(0, () => resolve(s));
  });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      return { ok: false, detail: 'boot check could not bind a port' };
    }
    const res = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; db?: string };
    return {
      ok: res.status === 200 && body.ok === true && body.db === 'up',
      detail: `GET /api/health → ${res.status} ${JSON.stringify(body)}`,
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
};

const app = buildApp({
  db,
  config,
  housekeeping: {
    scratchFactory: createPgScratchFactory(config.databaseUrl),
    bootCheck,
  },
});
// M5: pick up any jobs a previous process left behind — jobs stuck
// `running` are failed honestly, jobs still `queued` are re-run.
const jobsRunner = app.locals.jobsRunner as JobRunner | undefined;
await jobsRunner?.recover().catch((err) => console.error('job recovery failed', err));

// Expired sessions: purge once at boot, then periodically (cheap
// indexed delete; requireAuth already refuses expired ones).
const purge = () =>
  purgeExpiredSessions(db)
    .then((n) => {
      if (n) console.log(`sessions: purged ${n} expired`);
    })
    .catch((err) => console.error('session purge failed', err));
await purge();
const purgeTimer = setInterval(purge, config.sessionPurgeIntervalMs);
purgeTimer.unref();

// Scheduled local backups (+ off-site copy + weekly restore drill when
// configured): a cheap due-check every 15 minutes, the work itself under
// the Housekeeping lock and audited (src/housekeeping/offsite.ts).
const backupScheduler = app.locals.backupScheduler as BackupScheduler;
// After each tick: local retention, backup alerts, error-report purge.
const ops = app.locals.ops as OpsService;
const backupTick = () => void backupScheduler.tick().then(() => ops.afterBackupTick());
const backupTimer = setInterval(backupTick, 15 * 60_000);
backupTimer.unref();
setTimeout(backupTick, 30_000).unref();

// The trial-ending email (once per account; only with email + billing on).
const trialReminders = app.locals.trialReminders as TrialReminders;
const trialTick = () =>
  void trialReminders
    .tick()
    .then((r) => {
      if (r.sent || r.failed) console.log(`trial reminders: ${r.sent} sent, ${r.failed} not sent`);
    })
    .catch((err) => console.error('trial reminder tick failed', err));
const trialTimer = setInterval(trialTick, 60 * 60_000);
trialTimer.unref();
setTimeout(trialTick, 90_000).unref();

const server = app.listen(config.port, () => {
  console.log(`beuk-api listening on :${config.port} (timezone ${config.timeZone})`);
});

const shutdown = createShutdown({
  server,
  graceMs: config.shutdownGraceMs,
  runner: jobsRunner,
  closeDb: () => db.end(),
  timers: [purgeTimer, backupTimer, trialTimer],
});
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
