import type { Server } from 'node:http';
import { buildApp } from './app.js';
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
app.listen(config.port, () => {
  console.log(`beuk-api listening on :${config.port} (timezone ${config.timeZone})`);
});
