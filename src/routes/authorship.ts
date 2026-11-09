import { Router } from 'express';
import { requireAuth } from '../auth.js';
import type { Db } from '../db.js';

/**
 * The authorship record (premium feature 3, migration 024).
 *
 * Signed in, /api/authorship. Every query is scoped to the session's
 * user id, never the request: another account's rows answer exactly
 * like rows that do not exist (the same status, the same bytes), so the
 * routes are no oracle for someone else's fingerprint.
 *
 *   POST /api/authorship/stamps            {bookId, title, sha256, kind} → 201 {id, createdAt}
 *                                          (pausable: authorship.stamp; 60 per account per rolling hour)
 *   GET  /api/authorship/stamps?bookId=    {stamps:[{id,kind,title,sha256,createdAt}]}, newest first, ≤ 200
 *   GET  /api/authorship/check?sha256=     {recorded:[{createdAt,kind,title}]}, oldest first, ≤ 20
 *
 * A stamp holds the fingerprint (SHA-256 of the book text the studio
 * wrote), the title, the kind of file and the time. Never the text.
 */

export const STAMP_BOOK_ID_MAX = 200;
export const STAMP_TITLE_MAX = 300;
export const STAMPS_PER_HOUR = 60;
export const STAMPS_LIST_MAX = 200;
export const CHECK_LIST_MAX = 20;
const HOUR_MS = 3_600_000;

const SHA256_RE = /^[0-9a-f]{64}$/;
// Control characters (C0, DEL, C1), as cleanRecipientName refuses them.
const CONTROL_RE = /\p{Cc}/u;
const KINDS = new Set(['backup', 'docx']);

/** A bookId is 1–200 characters (code points), with no control characters. */
function validBookId(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const len = [...v].length;
  return len >= 1 && len <= STAMP_BOOK_ID_MAX && !CONTROL_RE.test(v);
}

const iso = (v: string | Date): string => new Date(v).toISOString();

export function authorshipRoutes(db: Db, now: () => Date = () => new Date()): Router {
  const router = Router();
  router.use(requireAuth(db));

  router.post('/stamps', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!validBookId(body.bookId))
        return res.status(400).json({ error: `bookId is 1 to ${STAMP_BOOK_ID_MAX} characters, with no control characters` });
      if (typeof body.sha256 !== 'string' || !SHA256_RE.test(body.sha256))
        return res.status(400).json({ error: 'sha256 must be 64 lowercase hex characters' });
      if (typeof body.kind !== 'string' || !KINDS.has(body.kind))
        return res.status(400).json({ error: "kind must be 'backup' or 'docx'" });
      if (body.title !== undefined && body.title !== null && typeof body.title !== 'string')
        return res.status(400).json({ error: 'title must be text' });
      const title = [...(typeof body.title === 'string' ? body.title.trim() : '')].slice(0, STAMP_TITLE_MAX).join('');

      const at = now();
      const since = new Date(at.getTime() - HOUR_MS);
      const recent = await db.query<{ n: number; oldest: string | Date | null }>(
        `select count(*)::int as n, min(created_at) as oldest
         from authorship_stamps where user_id = $1 and created_at > $2`,
        [req.user!.id, since],
      );
      const { n, oldest } = recent.rows[0] ?? { n: 0, oldest: null };
      if (Number(n) >= STAMPS_PER_HOUR) {
        const wait = oldest ? Math.ceil((new Date(oldest).getTime() + HOUR_MS - at.getTime()) / 1000) : 3600;
        res.setHeader('Retry-After', String(Math.max(1, wait)));
        return res.status(429).json({ error: 'too many authorship stamps in the last hour — please wait a little and try again' });
      }

      const r = await db.query<{ id: string; created_at: string | Date }>(
        `insert into authorship_stamps (user_id, book_id, title, sha256, kind, created_at)
         values ($1, $2, $3, $4, $5, $6) returning id, created_at`,
        [req.user!.id, body.bookId, title, body.sha256, body.kind, at],
      );
      const row = r.rows[0];
      res.status(201).json({ id: row.id, createdAt: iso(row.created_at) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/stamps', async (req, res, next) => {
    try {
      const bookId = req.query.bookId;
      if (!validBookId(bookId))
        return res.status(400).json({ error: `bookId is 1 to ${STAMP_BOOK_ID_MAX} characters, with no control characters` });
      const r = await db.query<{ id: string; kind: string; title: string; sha256: string; created_at: string | Date }>(
        `select id, kind, title, sha256, created_at from authorship_stamps
         where user_id = $1 and book_id = $2
         order by created_at desc, id desc limit ${STAMPS_LIST_MAX}`,
        [req.user!.id, bookId],
      );
      res.json({
        stamps: r.rows.map((s) => ({ id: s.id, kind: s.kind, title: s.title, sha256: s.sha256, createdAt: iso(s.created_at) })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/check', async (req, res, next) => {
    try {
      const sha = req.query.sha256;
      if (typeof sha !== 'string' || !SHA256_RE.test(sha))
        return res.status(400).json({ error: 'sha256 must be 64 lowercase hex characters' });
      const r = await db.query<{ kind: string; title: string; created_at: string | Date }>(
        `select kind, title, created_at from authorship_stamps
         where user_id = $1 and sha256 = $2
         order by created_at asc, id asc limit ${CHECK_LIST_MAX}`,
        [req.user!.id, sha],
      );
      res.json({ recorded: r.rows.map((s) => ({ createdAt: iso(s.created_at), kind: s.kind, title: s.title })) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
