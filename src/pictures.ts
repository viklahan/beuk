import { createHash } from 'node:crypto';
import type { Db } from './db.js';

/**
 * Shelf pictures, stored once (migrations/017_pictures.sql).
 *
 * A shelf doc may name a stored picture in place of its bytes: any
 * string value in the doc that is exactly `beuk-pic:<sha256>` (64
 * lowercase hex) stands for the canonical base64 of those bytes. The
 * studio puts the name where the base64 was (an image's, cover's or
 * font's `data`), so a doc read back with its pictures filled in
 * ("hydrated") is exactly the doc that was saved.
 *
 * Every function here is owner-scoped: user_id always comes from the
 * caller's session, and a hash the account does not hold is unknown.
 */

export const PIC_REF_PREFIX = 'beuk-pic:';
export const SHA256_RE = /^[0-9a-f]{64}$/;
const REF_RE = /^beuk-pic:([0-9a-f]{64})$/;

/** What a stored picture may be: images and the uploaded fonts a book
 *  carries, and the research files its Notebook keeps (BEUK:research —
 *  PDFs, recordings, clips, plain/Markdown/CSV text). Never HTML: the
 *  store hands bytes back as JSON, but nothing that renders as a page
 *  is kept. */
export const PICTURE_MEDIA_RE = /^(?:(?:image|font|audio|video)\/[a-z0-9][a-z0-9.+-]{0,60}|application\/pdf|text\/(?:plain|markdown|csv))$/;

/** The sha256 a doc string names, or null. */
export function picRefOf(value: unknown): string | null {
  if (typeof value !== 'string' || value.length !== PIC_REF_PREFIX.length + 64) return null;
  const m = REF_RE.exec(value);
  return m ? m[1] : null;
}

/** Every picture a doc names (deduplicated, in first-seen order). */
export function collectPicRefs(doc: unknown): string[] {
  const seen = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      const h = picRefOf(v);
      if (h) seen.add(h);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k]);
    }
  };
  walk(doc);
  return [...seen];
}

/** A copy of `doc` with every name replaced by `lookup(sha)` (names the
 *  lookup does not know are left as they are). */
export function replacePicRefs(doc: unknown, lookup: (sha: string) => string | undefined): unknown {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const h = picRefOf(v);
      if (!h) return v;
      const data = lookup(h);
      return data === undefined ? v : data;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v)) out[k] = walk((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  return walk(doc);
}

/** The doc with its pictures filled back in from the account's store —
 *  for every reader that needs the whole book: a studio that did not ask
 *  for names, the account export, beta-reader share snapshots. */
export async function hydrateDoc(db: Db, userId: string, doc: unknown): Promise<unknown> {
  const refs = collectPicRefs(doc);
  if (!refs.length) return doc;
  const r = await db.query<{ sha256: string; data: string }>(
    'select sha256, data from pictures where user_id = $1 and sha256 = any($2::text[])',
    [userId, refs],
  );
  const byHash = new Map(r.rows.map((row) => [row.sha256, row.data]));
  return replacePicRefs(doc, (h) => byHash.get(h));
}

/** The names in `refs` this account does not hold. */
export async function missingPictures(db: Db, userId: string, refs: string[]): Promise<string[]> {
  if (!refs.length) return [];
  const r = await db.query<{ sha256: string }>(
    'select sha256 from pictures where user_id = $1 and sha256 = any($2::text[])',
    [userId, refs],
  );
  const have = new Set(r.rows.map((row) => row.sha256));
  return refs.filter((h) => !have.has(h));
}

/** Rewrite which pictures one book names (inside the doc write's
 *  transaction). The foreign key refuses a name the account lost. */
export async function writePictureRefs(tx: Db, manuscriptId: string, userId: string, refs: string[]): Promise<void> {
  await tx.query('delete from manuscript_pictures where manuscript_id = $1', [manuscriptId]);
  if (refs.length)
    await tx.query(
      `insert into manuscript_pictures (manuscript_id, user_id, sha256)
       select $1, $2, h from unnest($3::text[]) as h on conflict do nothing`,
      [manuscriptId, userId, refs],
    );
}

/** Postgres foreign_key_violation (a doc named a picture the account
 *  does not hold, e.g. collected between the check and the write). */
export function isMissingPictureError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === '23503';
}

/** Collect this account's pictures no shelf book names any more and
 *  nobody has touched for `graceSeconds` (a save in progress uploads
 *  its pictures before its doc, so a fresh one is never taken). The
 *  NOT EXISTS and the foreign key both protect a picture still named. */
export async function collectUnusedPictures(db: Db, userId: string, graceSeconds: number): Promise<number> {
  const r = await db.query<{ sha256: string }>(
    `delete from pictures p
     where p.user_id = $1
       and p.touched_at < now() - make_interval(secs => $2::double precision)
       and not exists (
         select 1 from manuscript_pictures r where r.user_id = p.user_id and r.sha256 = p.sha256
       )
     returning p.sha256`,
    [userId, Math.max(0, graceSeconds)],
  );
  return r.rows.length;
}

/** sha256 hex of a canonical base64 string's bytes, or null when the
 *  string is not canonical base64 (it would not read back identical). */
export function canonicalBase64Sha(data: string): { sha256: string; bytes: number } | null {
  if (typeof data !== 'string' || !data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null;
  const buf = Buffer.from(data, 'base64');
  if (buf.toString('base64') !== data) return null;
  return { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}
