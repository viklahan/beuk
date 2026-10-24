import { Router } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { collectSecrets, scrubValue } from '../housekeeping/scrub.js';

/**
 * M4 public, unauthenticated read endpoints.
 *
 * GET /api/status — a plain health summary for humans (the Help page
 * shows it as a status line): app name, version, build stamp, whether
 * the database answers, and the latest Self-checks run's outcome.
 * Scrubbed like every Housekeeping output: names and stamps only,
 * never internals, never secrets.
 *
 * GET /api/config/public — the public configuration the static pages
 * and the web client may know: support contact + whether a Ko-fi tip
 * jar exists (and where it points). Nothing else is exposed here.
 */

export function statusRoutes(db: Db, config: Config): Router {
  const router = Router();
  const secrets = collectSecrets(config);

  router.get('/', async (_req, res) => {
    let dbUp = false;
    try {
      await db.query('select 1');
      dbUp = true;
    } catch {
      dbUp = false;
    }

    let selfChecks: {
      overall: string;
      at: string | null;
      passed: number;
      failed: number;
    } | null = null;
    if (dbUp) {
      try {
        const runs = await db.query<{
          overall: string | null;
          finished_at: string | null;
          started_at: string;
          pass_count: number;
          fail_count: number;
        }>(
          `select overall, finished_at, started_at, pass_count, fail_count
           from housekeeping_check_runs order by started_at desc limit 1`,
        );
        const run = runs.rows[0];
        if (run && run.overall) {
          selfChecks = {
            overall: run.overall,
            at: run.finished_at ?? run.started_at,
            passed: run.pass_count,
            failed: run.fail_count,
          };
        }
      } catch {
        // The summary simply omits self-checks if they can't be read.
        selfChecks = null;
      }
    }

    const payload = {
      app: 'Beuk',
      version: config.appVersion,
      build: config.buildStamp,
      ok: dbUp,
      health: { db: dbUp ? 'up' : 'down' },
      selfChecks,
      message: dbUp
        ? "All's well on the shelf."
        : 'The shelf is being tidied — something is down. Please try again shortly.',
    };
    return res.status(dbUp ? 200 : 503).json(scrubValue(payload, secrets));
  });

  return router;
}

export function publicConfigRoutes(config: Config): Router {
  const router = Router();

  router.get('/public', (_req, res) => {
    return res.json({
      app: 'Beuk',
      version: config.appVersion,
      support: {
        email: config.supportEmail,
        name: config.supportName,
        replyPromise: config.supportReplyPromise,
      },
      kofiUrl: config.kofiUrl,
    });
  });

  return router;
}
