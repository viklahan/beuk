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
  /**
   * The one-line summary. "well" (the green "All's well") is said ONLY
   * when every component was checked and is fine: db up, queue read,
   * EPUBCheck installed, and the latest self-check run passed. A failed
   * self-check is "tidy"; db down is "down"; anything unchecked or
   * missing is "partial" — a neutral line naming the gaps.
   */
  headline: 'well' | 'partial' | 'tidy' | 'down';
  /** What keeps a "partial" headline from being "well", in plain words. */
  gaps: string[];
}

export function shelfHeadline(s: Omit<ShelfStatus, 'headline' | 'gaps' | 'checkedAt'>): { headline: ShelfStatus['headline']; gaps: string[] } {
  if (s.db !== 'up') return { headline: 'down', gaps: ['the database did not answer'] };
  if (s.selfChecks && s.selfChecks.overall !== 'pass') return { headline: 'tidy', gaps: [] };
  const gaps: string[] = [];
  if (!s.queue) gaps.push('job queue unreadable');
  if (s.epubcheck !== 'installed') gaps.push('EPUBCheck not installed');
  if (s.selfChecksUnreadable) gaps.push('self-check history unreadable');
  else if (!s.selfChecks) gaps.push('no self-check run yet');
  return { headline: gaps.length ? 'partial' : 'well', gaps };
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
  const parts = {
    db: (dbUp ? 'up' : 'down') as ShelfStatus['db'],
    queue,
    epubcheck: (epubcheckProblem(config) ? 'not-installed' : 'installed') as ShelfStatus['epubcheck'],
    selfChecks,
    selfChecksUnreadable,
  };
  const value: ShelfStatus = { checkedAt: now().toISOString(), ...parts, ...shelfHeadline(parts) };
  cache = { at: Date.now(), value, db };
  return value;
}

/** Tests: forget the cached reading. */
export function resetShelfStatusCache(): void {
  cache = null;
}
