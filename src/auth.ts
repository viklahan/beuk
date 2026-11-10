import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from './db.js';

export const SESSION_COOKIE = 'beuk_session';

export interface AuthedUser {
  id: string;
  email: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthedUser;
  }
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Parse the Cookie header by hand (keeps dependencies minimal). */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/** A new session for the user. `label` is the coarse device label
 *  (deviceLabel, src/account/device.ts); last_seen_at starts at creation,
 *  on the database clock like created_at. No IP address is ever stored. */
export async function createSession(
  db: Db,
  userId: string,
  ttlDays: number,
  label: string | null = null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  await db.query(
    'insert into sessions (user_id, token_hash, expires_at, label, last_seen_at) values ($1, $2, $3, $4, now())',
    [userId, tokenHash(token), expiresAt.toISOString(), label],
  );
  return { token, expiresAt };
}

/** requireAuth refreshes sessions.last_seen_at at most this often per session. */
export const LAST_SEEN_REFRESH_MINUTES = 10;

export function setSessionCookie(res: Response, token: string, expiresAt: Date, secure: boolean): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/', secure });
}

export async function destroySession(db: Db, req: Request): Promise<void> {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await db.query('delete from sessions where token_hash = $1', [tokenHash(token)]);
}

/** Delete sessions past their expiry. requireAuth already refuses
 *  them; this only stops the table growing forever. Cheap: one indexed
 *  range delete (sessions_expires_at_idx). Also deletes expired two-step
 *  sign-in challenges (sign_in_challenges_expires_at_idx), which
 *  /login/code already refuses, so an abandoned one is gone by the next
 *  run (index.ts: at boot, then every SESSION_PURGE_INTERVAL_MS, 1 hour
 *  by default). Returns the sessions removed. */
export async function purgeExpiredSessions(db: Db): Promise<number> {
  const result = await db.query<{ id: string }>(
    'delete from sessions where expires_at <= now() returning id',
  );
  await db.query('delete from sign_in_challenges where expires_at <= now()');
  return result.rows.length;
}

/** Express middleware: resolves the session cookie to req.user, else 401. */
export function requireAuth(db: Db) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = readCookie(req, SESSION_COOKIE);
      if (!token) {
        res.status(401).json({ error: 'not signed in' });
        return;
      }
      const result = await db.query<{ id: string; email: string; session_id: string; stale: boolean }>(
        `select u.id, u.email, s.id as session_id,
                (s.last_seen_at is null or s.last_seen_at < now() - make_interval(mins => $2)) as stale
         from sessions s
         join users u on u.id = s.user_id
         where s.token_hash = $1 and s.expires_at > now()`,
        [tokenHash(token), LAST_SEEN_REFRESH_MINUTES],
      );
      const row = result.rows[0];
      if (!row) {
        res.status(401).json({ error: 'session expired or invalid' });
        return;
      }
      // "Last active": one write per session per 10 minutes at most. A
      // failed write is logged and never refuses the request.
      if (row.stale) {
        try {
          await db.query(
            `update sessions set last_seen_at = now()
             where id = $1 and (last_seen_at is null or last_seen_at < now() - make_interval(mins => $2))`,
            [row.session_id, LAST_SEEN_REFRESH_MINUTES],
          );
        } catch (err) {
          console.error(JSON.stringify({ event: 'auth.last_seen_failed', at: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) }));
        }
      }
      req.user = { id: row.id, email: row.email };
      next();
    } catch (err) {
      next(err);
    }
  };
}
