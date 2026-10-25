import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { epubcheckProblem } from '../jobs/tools.js';

/**
 * The shelf-status strip on the Help pages — every value read live,
 * server-side, at request time (cached for a few seconds so a burst of
 * page views is one query, not fifty). Nothing is hard-coded and nothing
 * is shown as "up" that was not checked:
 *
 *   app        — this page was rendered by the app process, so it is up
 *                by construction (that is the only claim made).
 *   db         — `select 1` answered, or it didn't.
 *   queue      — jobs queued or running right now (only when db is up).
 *   epubcheck  — whether EPUBCheck is INSTALLED on this server
 *                (EPUBCHECK_JAR set and the file present). Whether it
 *                runs is only known when a job runs it, so it is never
 *                called "up".
 *   selfChecks — the latest Housekeeping self-check run: outcome, when
 *                it finished, and its pass/fail counts; or "none yet".
 */

export interface ShelfStatus {
  checkedAt: string;
  db: 'up' | 'down';
  queue: { queued: number; running: number } | null;
  epubcheck: 'installed' | 'not-installed';
  selfChecks: { overall: string; at: string; passed: number; failed: number } | null;
  /** True when the self-check table could not be read (db up, query failed). */
  selfChecksUnreadable: boolean;
  headline: 'well' | 'tidy' | 'down';
}

const TTL_MS = 5_000;
let cache: { at: number; value: ShelfStatus; db: Db } | null = null;

export async function readShelfStatus(db: Db, config: Config, now: () => Date = () => new Date()): Promise<ShelfStatus> {
  if (cache && cache.db === db && Date.now() - cache.at < TTL_MS) return cache.value;
  let dbUp = false;
  try {
    await db.query('select 1');
    dbUp = true;
  } catch {
    dbUp = false;
  }
  let queue: ShelfStatus['queue'] = null;
  let selfChecks: ShelfStatus['selfChecks'] = null;
  let selfChecksUnreadable = false;
  if (dbUp) {
    try {
      const q = await db.query<{ queued: number; running: number }>(
        `select count(*) filter (where status = 'queued')::int as queued,
                count(*) filter (where status = 'running')::int as running
         from jobs where status in ('queued', 'running')`,
      );
      queue = q.rows[0] ?? { queued: 0, running: 0 };
    } catch {
      queue = null;
    }
    try {
      const r = await db.query<{ overall: string | null; finished_at: string | Date | null; started_at: string | Date; pass_count: number; fail_count: number }>(
        `select overall, finished_at, started_at, pass_count, fail_count
         from housekeeping_check_runs order by started_at desc limit 1`,
      );
      const run = r.rows[0];
      if (run && run.overall) {
        const at = run.finished_at ?? run.started_at;
        selfChecks = {
          overall: run.overall,
          at: (at instanceof Date ? at : new Date(at)).toISOString(),
          passed: run.pass_count,
          failed: run.fail_count,
        };
      }
    } catch {
      selfChecksUnreadable = true;
    }
  }
  const value: ShelfStatus = {
    checkedAt: now().toISOString(),
    db: dbUp ? 'up' : 'down',
    queue,
    epubcheck: epubcheckProblem(config) ? 'not-installed' : 'installed',
    selfChecks,
    selfChecksUnreadable,
    headline: !dbUp ? 'down' : selfChecks && selfChecks.overall !== 'pass' ? 'tidy' : 'well',
  };
  cache = { at: Date.now(), value, db };
  return value;
}

/** Tests: forget the cached reading. */
export function resetShelfStatusCache(): void {
  cache = null;
}
