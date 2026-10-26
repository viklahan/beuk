import type { NextFunction, Request, Response } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { addDaysIso, dayIn } from './settings.js';

/**
 * Privacy-friendly usage counts: ONE number per day per counter in
 * usage_daily (day, counter, count). No cookies, no IP addresses, no
 * user ids, no per-user event log — a counter is incremented and that
 * is all that is written.
 *
 * Counted as the server answers (a successful response only):
 *   sign_ups             POST /api/auth/register answered 201
 *   sign_ins             POST /api/auth/login answered 200
 *   first_shelf_saves    POST /api/manuscripts answered 201 and the account
 *                        now has exactly one book on the shelf (an account
 *                        that deletes every book and saves again counts again)
 *   exports_archived     POST /api/exports answered 201
 *   epubcheck_runs       POST /api/jobs/epubcheck answered 2xx (a job queued;
 *                        whether the tool is installed is not part of it)
 *   share_links_created  POST /api/shares answered 201
 * Computed from data the server already keeps:
 *   came_back_after_7_days  accounts with a writing day (streak_days) on that
 *                        day whose previous writing day was 7 or more days
 *                        earlier. A past day is computed once and kept.
 * Days are in APP_TIMEZONE, the streak's own day boundary.
 */

export const COUNTERS = [
  'sign_ups',
  'sign_ins',
  'first_shelf_saves',
  'exports_archived',
  'epubcheck_runs',
  'share_links_created',
  'came_back_after_7_days',
] as const;
export type Counter = (typeof COUNTERS)[number];

export async function bumpUsage(db: Db, config: Config, counter: Counter, now: Date = new Date()): Promise<void> {
  const day = dayIn(now, config.timeZone);
  await db.query(
    `insert into usage_daily (day, counter, count) values ($1::date, $2, 1)
     on conflict (day, counter) do update set count = usage_daily.count + 1`,
    [day, counter],
  );
}

/** Express middleware: watches responses and bumps the matching counter.
 *  Mounted once in app.ts, before the routes; it never delays or fails a
 *  request (a counting error is logged and dropped). */
export function usageCounter(db: Db, config: Config, now: () => Date = () => new Date()) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'POST') return next();
    const p = req.path;
    let pick: ((status: number) => Counter | 'first-save' | null) | null = null;
    if (p === '/api/auth/register') pick = (s) => (s === 201 ? 'sign_ups' : null);
    else if (p === '/api/auth/login') pick = (s) => (s === 200 ? 'sign_ins' : null);
    else if (p === '/api/manuscripts' || p === '/api/manuscripts/') pick = (s) => (s === 201 ? 'first-save' : null);
    else if (p === '/api/exports' || p === '/api/exports/') pick = (s) => (s === 201 ? 'exports_archived' : null);
    else if (p === '/api/jobs/epubcheck') pick = (s) => (s >= 200 && s < 300 ? 'epubcheck_runs' : null);
    else if (p === '/api/shares' || p === '/api/shares/') pick = (s) => (s === 201 ? 'share_links_created' : null);
    if (!pick) return next();
    const choose = pick;
    res.on('finish', () => {
      const which = choose(res.statusCode);
      if (!which) return;
      const at = now();
      void (async () => {
        if (which === 'first-save') {
          const userId = req.user?.id;
          if (!userId) return;
          const r = await db.query<{ n: number }>('select count(*)::int as n from manuscripts where user_id = $1', [userId]);
          if ((r.rows[0]?.n ?? 0) !== 1) return;
          await bumpUsage(db, config, 'first_shelf_saves', at);
          return;
        }
        await bumpUsage(db, config, which, at);
      })().catch((err) => console.error('usage count failed', err instanceof Error ? err.message : err));
    });
    return next();
  };
}

/** came_back_after_7_days for one day, from streak_days. */
export async function cameBackCount(db: Db, day: string): Promise<number> {
  const r = await db.query<{ n: number }>(
    `select count(*)::int as n from streak_days d
     where d.day = $1::date
       and exists (select 1 from streak_days p where p.user_id = d.user_id and p.day < d.day)
       and (select max(p.day) from streak_days p where p.user_id = d.user_id and p.day < d.day) <= ($1::date - 7)`,
    [day],
  );
  return r.rows[0]?.n ?? 0;
}

/** Compute the derived counter for the last `days` days: today is
 *  refreshed, a past day is written once (final) and then left alone. */
export async function rollupUsage(db: Db, config: Config, now: Date = new Date(), days = 30): Promise<void> {
  const today = dayIn(now, config.timeZone);
  const done = await db.query<{ day: string }>(
    `select day::text as day from usage_daily where counter = 'came_back_after_7_days' and final and day >= $1::date`,
    [addDaysIso(today, -(days - 1))],
  );
  const finals = new Set(done.rows.map((r) => r.day));
  for (let i = 0; i < days; i++) {
    const day = addDaysIso(today, -i);
    if (finals.has(day)) continue;
    const n = await cameBackCount(db, day);
    const final = day !== today;
    await db.query(
      `insert into usage_daily (day, counter, count, final) values ($1::date, 'came_back_after_7_days', $2, $3)
       on conflict (day, counter) do update set count = excluded.count, final = excluded.final`,
      [day, n, final],
    );
  }
}

export interface UsageDay {
  day: string;
  counts: Record<Counter, number>;
}

/** The last `days` days, newest first, every counter present (0 when none). */
export async function usageSummary(db: Db, config: Config, now: Date = new Date(), days = 30): Promise<{ days: UsageDay[]; totals: Record<Counter, number> }> {
  const today = dayIn(now, config.timeZone);
  const from = addDaysIso(today, -(days - 1));
  const r = await db.query<{ day: string; counter: Counter; count: number }>(
    `select day::text as day, counter, count from usage_daily where day >= $1::date and day <= $2::date`,
    [from, today],
  );
  const zero = () => Object.fromEntries(COUNTERS.map((c) => [c, 0])) as Record<Counter, number>;
  const byDay = new Map<string, Record<Counter, number>>();
  const totals = zero();
  for (const row of r.rows) {
    if (!byDay.has(row.day)) byDay.set(row.day, zero());
    byDay.get(row.day)![row.counter] = row.count;
    totals[row.counter] += row.count;
  }
  const out: UsageDay[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDaysIso(today, -i);
    out.push({ day, counts: byDay.get(day) ?? zero() });
  }
  return { days: out, totals };
}
