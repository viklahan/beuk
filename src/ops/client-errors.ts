import { createHash } from 'node:crypto';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { TokenBucketLimiter } from '../ratelimit.js';
import { addDaysIso, dayIn, opsSettings } from './settings.js';

/**
 * POST /api/client-errors — the studio's error reports.
 *
 * The studio's window "error" / "unhandledrejection" handlers send
 * { kind, message, stack, build, lang, device, at }. Never book text,
 * titles, file names or user ids — the studio does not put them in, and
 * this end scrubs again (the studio's copy of the scrubber is a courtesy;
 * the server never trusts it):
 *   - URL query strings and fragments are cut; /read/<token> becomes /read/:token;
 *   - anything shaped like an email address becomes [email];
 *   - UUIDs become [id]; runs of 24+ characters mixing letters and digits
 *     (tokens, hashes) become [token];
 *   - quoted strings longer than 24 characters become "[…]" (an error message
 *     can quote what it choked on, and that might be the writer's words);
 *   - names of book/picture files (.docx .epub .pdf .md .txt .jpg .png …) become [file]:
 *     a quoted name of any length ('The Lantern Coast.epub' → '[file]'), and an
 *     unquoted one together with up to five words before it that start with a
 *     capital or a digit ("open My Secret Novel.docx" → "open [file]").
 * It is a pattern filter, not a proof: a lower-case multi-word file name keeps
 * its first words, and an error message that quotes 24 characters or fewer of
 * the writer's words, or names a chapter without quotes, keeps them. The
 * studio's settings note says so; docs/privacy-inventory.md §12 has the detail.
 * Message ≤ 300 characters; stack ≤ 15 lines and 2000 characters.
 *
 * Requests are sent WITHOUT cookies (credentials: 'omit'), and nothing
 * about the sender is stored: no IP (only an in-memory rate-limit bucket
 * keyed by it, as everywhere else), no user agent, no user id. Reports are
 * aggregated as they arrive — one row per day per (fingerprint, UI language,
 * device class) with a count — and rows older than CLIENT_ERRORS_KEEP_DAYS
 * (default 30) are deleted. Abuse control: body cap (4 KB, before parsing),
 * a per-IP token bucket, and at most MAX_GROUPS_PER_DAY new groups a day.
 */

export const CLIENT_ERROR_MAX_BYTES = 4 * 1024;
export const MAX_GROUPS_PER_DAY = 1000;
const MESSAGE_MAX = 300;
const STACK_MAX = 2000;
const STACK_LINES = 15;

/** Scrub one free-text field. Exported for tests (and mirrored in the studio). */
export function scrubErrorText(raw: string): string {
  let s = raw;
  // URLs: drop query and fragment (keep scheme://host/path).
  s = s.replace(/\b((?:https?|blob|wss?):\/\/[^\s?#)'"`]*)[?#][^\s)'"`]*/gi, '$1');
  // Any remaining "?key=value…" fragment glued to a path.
  s = s.replace(/(\/[^\s?#)'"`]*)\?[^\s)'"`]+/g, '$1');
  s = s.replace(/\/read\/[^\s/)'"`:]+/g, '/read/:token');
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '[email]');
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]');
  // 24+ characters mixing letters and digits (a long function name has no digits).
  s = s.replace(/(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}/g, '[token]');
  // A quoted file name, whatever its length or spaces.
  s = s.replace(/"[^"\n]*?\.(?:docx?|epub|pdf|md|markdown|txt|rtf|odt|jpe?g|png|gif|webp|svg|tiff?|heic|mp3|wav|zip|beuk-backup\.json)"/gi, '"[file]"').replace(/'[^'\n]*?\.(?:docx?|epub|pdf|md|markdown|txt|rtf|odt|jpe?g|png|gif|webp|svg|tiff?|heic|mp3|wav|zip|beuk-backup\.json)'/gi, "'[file]'").replace(/“[^”\n]*?\.(?:docx?|epub|pdf|md|markdown|txt|rtf|odt|jpe?g|png|gif|webp|svg|tiff?|heic|mp3|wav|zip|beuk-backup\.json)”/gi, '“[file]”');
  s = s.replace(/"[^"\n]{25,}"/g, '"[…]"').replace(/'[^'\n]{25,}'/g, "'[…]'").replace(/“[^”\n]{25,}”/g, '“[…]”');
  s = s.replace(/[^\s/\\'"`()]+\.(?:docx?|epub|pdf|md|markdown|txt|rtf|odt|jpe?g|png|gif|webp|svg|tiff?|heic|mp3|wav|zip|beuk-backup\.json)\b/gi, '[file]');
  // An unquoted name with spaces: up to five capitalised (or numbered) words before it.
  s = s.replace(/(?:[\p{Lu}\p{N}][^\s/\\'"`()\[\]]*[ _]){1,5}\[file\]/gu, '[file]');
  return s;
}

export function cleanMessage(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  return scrubErrorText(s.replace(/\s+/g, ' ').trim()).slice(0, MESSAGE_MAX) || '(no message)';
}

export function cleanStack(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, STACK_LINES);
  return scrubErrorText(lines.join('\n')).slice(0, STACK_MAX);
}

const LANG_RE = /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/;
const BUILD_RE = /^[A-Za-z0-9._-]{1,40}$/;

export interface CleanReport {
  kind: 'error' | 'rejection';
  message: string;
  stack: string;
  studioBuild: string;
  uiLang: string;
  deviceClass: 'phone' | 'tablet' | 'desktop' | '-';
  fingerprint: string;
}

export function cleanReport(body: unknown): CleanReport | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.message !== 'string' && typeof b.stack !== 'string') return null;
  const kind = b.kind === 'rejection' ? 'rejection' : 'error';
  const message = cleanMessage(b.message);
  const stack = cleanStack(b.stack);
  const studioBuild = typeof b.build === 'string' && BUILD_RE.test(b.build) ? b.build : 'unknown';
  const uiLang = typeof b.lang === 'string' && LANG_RE.test(b.lang) ? b.lang : '-';
  const deviceClass = b.device === 'phone' || b.device === 'tablet' || b.device === 'desktop' ? b.device : '-';
  const firstFrame = stack.split('\n').find((l) => /:\d+/.test(l)) ?? '';
  const fingerprint = createHash('sha256').update(`${kind}\n${message}\n${firstFrame}\n${studioBuild}`).digest('hex').slice(0, 16);
  return { kind, message, stack, studioBuild, uiLang, deviceClass, fingerprint };
}

export async function purgeClientErrors(db: Db, config: Config, now: Date): Promise<number> {
  const cutoff = addDaysIso(dayIn(now, config.timeZone), -opsSettings(config).clientErrorsKeepDays);
  const r = await db.query<{ n: number }>(
    `with gone as (delete from client_errors where day < $1::date returning 1) select count(*)::int as n from gone`,
    [cutoff],
  );
  return r.rows[0]?.n ?? 0;
}

export type StoreOutcome = 'stored' | 'counted' | 'dropped-day-cap';

export async function storeClientError(db: Db, config: Config, r: CleanReport, now: Date): Promise<StoreOutcome> {
  const day = dayIn(now, config.timeZone);
  const hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString();
  const bumped = await db.query<{ id: string }>(
    `update client_errors set count = count + 1, last_seen_hour = $5
     where day = $1::date and fingerprint = $2 and ui_lang = $3 and device_class = $4 returning id`,
    [day, r.fingerprint, r.uiLang, r.deviceClass, hour],
  );
  if (bumped.rows.length) return 'counted';
  const groups = await db.query<{ n: number }>('select count(*)::int as n from client_errors where day = $1::date', [day]);
  if ((groups.rows[0]?.n ?? 0) >= MAX_GROUPS_PER_DAY) return 'dropped-day-cap';
  await db.query(
    `insert into client_errors (day, fingerprint, message, stack, studio_build, server_build, ui_lang, device_class, kind, count, last_seen_hour)
     values ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10)
     on conflict (day, fingerprint, ui_lang, device_class) do update set count = client_errors.count + 1, last_seen_hour = excluded.last_seen_hour`,
    [day, r.fingerprint, r.message, r.stack, r.studioBuild, config.buildStamp.slice(0, 80), r.uiLang, r.deviceClass, r.kind, hour],
  );
  return 'stored';
}

export interface ClientErrorGroup {
  message: string;
  kind: string;
  count: number;
  days: number;
  firstDay: string;
  lastSeenHour: string;
  studioBuilds: string[];
  languages: string[];
  devices: string[];
  stack: string;
}

/** Housekeeping: the kept reports grouped by message, most frequent first. */
export async function clientErrorSummary(db: Db, limit = 100): Promise<{ total: number; groups: ClientErrorGroup[] }> {
  const r = await db.query<{
    message: string; kind: string; count: number; days: number; first_day: string; last_seen: unknown;
    builds: string[] | string; langs: string[] | string; devices: string[] | string; stack: string;
  }>(
    `select message, min(kind) as kind, sum(count)::int as count, count(distinct day)::int as days,
            min(day)::text as first_day, max(last_seen_hour) as last_seen,
            array_agg(distinct studio_build) as builds, array_agg(distinct ui_lang) as langs,
            array_agg(distinct device_class) as devices, max(stack) as stack
     from client_errors group by message order by sum(count) desc, max(last_seen_hour) desc limit $1`,
    [limit],
  );
  const arr = (v: string[] | string): string[] => (Array.isArray(v) ? v : String(v).replace(/^\{|\}$/g, '').split(',').filter(Boolean));
  const groups = r.rows.map((row) => ({
    message: row.message,
    kind: row.kind,
    count: row.count,
    days: row.days,
    firstDay: row.first_day,
    lastSeenHour: row.last_seen instanceof Date ? row.last_seen.toISOString() : new Date(String(row.last_seen)).toISOString(),
    studioBuilds: arr(row.builds),
    languages: arr(row.langs),
    devices: arr(row.devices),
    stack: row.stack,
  }));
  const total = await db.query<{ n: number }>('select coalesce(sum(count), 0)::int as n from client_errors');
  return { total: total.rows[0]?.n ?? 0, groups };
}

export interface ClientErrorOptions {
  burst?: number;
  refillMs?: number;
  now?: () => Date;
}

export function clientErrorRoutes(db: Db, config: Config, opts: ClientErrorOptions = {}): Router {
  const router = Router();
  // 10 reports up front per address, then one a minute.
  const limiter = new TokenBucketLimiter({ burst: opts.burst ?? 10, refillMs: opts.refillMs ?? 60_000 });
  const now = opts.now ?? (() => new Date());
  let lastPurge = 0;

  router.post(
    '/',
    (req: Request, res: Response, next: NextFunction) => {
      const outcome = limiter.take(req.ip ?? 'unknown');
      if (outcome.ok) return next();
      res.setHeader('Retry-After', String(outcome.retryAfterSec));
      return res.status(429).end();
    },
    express.json({ limit: CLIENT_ERROR_MAX_BYTES, type: () => true }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const report = cleanReport(req.body);
        if (!report) return res.status(400).end();
        const t = now();
        if (t.getTime() - lastPurge > 3_600_000) {
          lastPurge = t.getTime();
          await purgeClientErrors(db, config, t).catch(() => 0);
        }
        await storeClientError(db, config, report, t);
        return res.status(204).end();
      } catch (err) {
        return next(err);
      }
    },
  );

  router.use((err: Error & { type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err.type === 'entity.too.large') return res.status(413).end();
    if (err.type === 'entity.parse.failed' || err.type === 'encoding.unsupported') return res.status(400).end();
    return next(err);
  });

  return router;
}
