import type { Db } from '../db.js';
import { readBook, type ReadResult } from './index.js';
import { STEPS } from './upgrade.js';

/* BEUK:book-observe — observe mode for the book format. After a
   manuscript save the server reads the saved doc with readBook and keeps
   the LATEST observation per book (book_format_observations, migration
   020). It only watches: it never rejects, delays or changes a save, and
   it never throws — a failure is logged and swallowed. */

/* PRIVACY: a stored observation must hold no book text. A warning's
   `detail` quotes writer strings, so it is never stored: only {code, path}.
   Paths and unknown key names are writer-chosen, so they are cut short,
   and both lists are capped. When the warnings list is capped, one
   synthetic {code: 'truncated', path: '<N more>'} warning records how
   many were dropped; for unknown_keys the dropped count is the last
   element, '<N more>', the same marker the 'truncated' warning's path uses. */
export const MAX_PATH = 120;
export const MAX_UNKNOWN_KEY = 80;
export const MAX_WARNINGS = 200;
export const MAX_UNKNOWN_KEYS = 50;

export function privacySafe(all: { code: string; path: string }[]): { warnings: { code: string; path: string }[]; unknownKeys: string[] } {
  const warnings = all.slice(0, MAX_WARNINGS).map((w) => ({ code: w.code, path: w.path.slice(0, MAX_PATH) }));
  if (all.length > MAX_WARNINGS) warnings.push({ code: 'truncated', path: `${all.length - MAX_WARNINGS} more` });
  const keys = all.filter((w) => w.code === 'unknown-key').map((w) => w.path);
  const unknownKeys = keys.slice(0, MAX_UNKNOWN_KEYS).map((k) => k.slice(0, MAX_UNKNOWN_KEY));
  if (keys.length > MAX_UNKNOWN_KEYS) unknownKeys.push(`${keys.length - MAX_UNKNOWN_KEYS} more`);
  return { warnings, unknownKeys };
}

/** Read the doc and upsert the book's observation. Never throws. `read` is a seam for tests. */
export async function observeBook(
  db: Db,
  manuscriptId: string,
  doc: unknown,
  now: Date,
  read: (input: unknown) => ReadResult = readBook,
): Promise<void> {
  try {
    const t0 = performance.now();
    const result = read(doc);
    const readMs = performance.now() - t0;
    const { warnings, unknownKeys } = privacySafe(result.warnings);
    await db.query(
      `insert into book_format_observations (manuscript_id, observed_at, status, upgrades, warnings, unknown_keys, read_ms)
       values ($1, $2, $3, $4::text[], $5::jsonb, $6::text[], $7)
       on conflict (manuscript_id) do update set
         observed_at = excluded.observed_at, status = excluded.status, upgrades = excluded.upgrades,
         warnings = excluded.warnings, unknown_keys = excluded.unknown_keys, read_ms = excluded.read_ms`,
      [manuscriptId, now.toISOString(), result.status, result.upgrades, JSON.stringify(warnings), unknownKeys, readMs],
    );
  } catch (err) {
    console.error('book format: observing a saved book failed', err);
  }
}

export interface BookFormatSummary {
  books: number;
  withWarnings: number;
  byCode: Record<string, number>;
  /** Steps that changed a book. */
  byUpgrade: Record<string, number>;
  /** `defaults:<key>` entries: a key the reader filled. */
  byDefault: Record<string, number>;
  /** Record-only steps: they describe a shape and change nothing. */
  byRecord: Record<string, number>;
  slowestMs: number;
}

const RECORD_ONLY = new Set(STEPS.filter((s) => s.recordOnly).map((s) => s.name));

const list = (v: string[] | string | null): string[] =>
  Array.isArray(v) ? v : String(v ?? '').replace(/^\{|\}$/g, '').split(',').filter(Boolean).map((s) => s.replace(/^"|"$/g, ''));

/** Housekeeping: what the latest observation of each book found. Counts books, not occurrences. */
export async function bookFormatSummary(db: Db, limit = 10_000): Promise<BookFormatSummary> {
  const r = await db.query<{ upgrades: string[] | string; warnings: { code: string }[] | string; read_ms: number }>(
    'select upgrades, warnings, read_ms from book_format_observations order by observed_at desc limit $1',
    [limit],
  );
  const out: BookFormatSummary = { books: r.rows.length, withWarnings: 0, byCode: {}, byUpgrade: {}, byDefault: {}, byRecord: {}, slowestMs: 0 };
  for (const row of r.rows) {
    const warnings = typeof row.warnings === 'string' ? (JSON.parse(row.warnings) as { code: string }[]) : row.warnings;
    const codes = new Set(warnings.map((w) => w.code));
    if (codes.size) out.withWarnings++;
    for (const c of codes) out.byCode[c] = (out.byCode[c] ?? 0) + 1;
    for (const u of new Set(list(row.upgrades))) {
      const bucket = u.startsWith('defaults:') ? out.byDefault : RECORD_ONLY.has(u) ? out.byRecord : out.byUpgrade;
      bucket[u] = (bucket[u] ?? 0) + 1;
    }
    out.slowestMs = Math.max(out.slowestMs, Number(row.read_ms));
  }
  return out;
}
