import { Router } from 'express';
import { readCookie, requireAuth, SESSION_COOKIE, tokenHash } from '../auth.js';
import type { Db } from '../db.js';
import { isUuid } from '../ids.js';

/**
 * Where you're signed in (account hardening). Signed in, mounted at
 * /api/account/sessions; never paused (NEVER_PAUSED):
 *
 *   GET  /              {sessions:[{id, label, createdAt, lastSeenAt, current}]}, every live
 *                       session of the account, newest lastSeenAt first
 *   POST /:id/revoke    204 for one of your own sessions other than this one; 400 for this one
 *                       (that's "Sign out"); 404 for another account's, an unknown or a
 *                       malformed id (the same answer, so ids reveal nothing)
 *
 * The label is the coarse device label kept at sign-in (deviceLabel,
 * src/account/device.ts). A session from before migration 025 has none
 * and is shown as UNLABELLED_SESSION; its lastSeenAt is null until its
 * next request. No IP address is kept, so none is shown.
 */

export const UNLABELLED_SESSION = 'An earlier sign-in';

const iso = (v: string | Date): string => new Date(v).toISOString();

export function sessionRoutes(db: Db): Router {
  const router = Router();
  router.use(requireAuth(db));

  router.get('/', async (req, res, next) => {
    try {
      const current = tokenHash(readCookie(req, SESSION_COOKIE) ?? '');
      const rows = await db.query<{ id: string; label: string | null; created_at: string | Date; last_seen_at: string | Date | null; token_hash: string }>(
        `select id, label, created_at, last_seen_at, token_hash from sessions
         where user_id = $1 and expires_at > now()
         order by coalesce(last_seen_at, created_at) desc, created_at desc, id`,
        [req.user!.id],
      );
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        sessions: rows.rows.map((r) => ({
          id: r.id,
          label: r.label ?? UNLABELLED_SESSION,
          createdAt: iso(r.created_at),
          lastSeenAt: r.last_seen_at ? iso(r.last_seen_at) : null,
          current: r.token_hash === current,
        })),
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/:id/revoke', async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const notFound = () => res.status(404).json({ error: 'no such session' });
      if (!isUuid(id)) return notFound();
      const current = tokenHash(readCookie(req, SESSION_COOKIE) ?? '');
      const row = (
        await db.query<{ token_hash: string }>(
          'select token_hash from sessions where id = $1 and user_id = $2 and expires_at > now()',
          [id, req.user!.id],
        )
      ).rows[0];
      if (!row) return notFound();
      if (row.token_hash === current) {
        return res.status(400).json({ error: "that's the device you're using — use Sign out instead" });
      }
      // Conditional on the owner and on not being this session, so a race changes nothing it shouldn't.
      await db.query('delete from sessions where id = $1 and user_id = $2 and token_hash <> $3', [id, req.user!.id, current]);
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
