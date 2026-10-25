import type { Server } from 'node:http';
import { buildApp } from './app.js';
import { purgeExpiredSessions } from './auth.js';
import { createShutdown } from './shutdown.js';
import { loadConfig } from './config.js';
import { createPgDb, defaultMigrationsDir, runMigrations, type Db } from './db.js';
import type { BootCheck } from './housekeeping/context.js';
import { createPgScratchFactory } from './housekeeping/scratch.js';
import type { JobRunner } from './jobs/runner.js';

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

const server = app.listen(config.port, () => {
  console.log(`beuk-api listening on :${config.port} (timezone ${config.timeZone})`);
});

const shutdown = createShutdown({
  server,
  graceMs: config.shutdownGraceMs,
  runner: jobsRunner,
  closeDb: () => db.end(),
  timers: [purgeTimer],
});
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
