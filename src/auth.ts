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

function tokenHash(token: string): string {
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

export async function createSession(
  db: Db,
  userId: string,
  ttlDays: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  await db.query('insert into sessions (user_id, token_hash, expires_at) values ($1, $2, $3)', [
    userId,
    tokenHash(token),
    expiresAt.toISOString(),
  ]);
  return { token, expiresAt };
}

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
 *  range delete (sessions_expires_at_idx). Returns rows removed. */
export async function purgeExpiredSessions(db: Db): Promise<number> {
  const result = await db.query<{ id: string }>(
    'delete from sessions where expires_at <= now() returning id',
  );
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
      const result = await db.query<{ id: string; email: string }>(
        `select u.id, u.email from sessions s
         join users u on u.id = s.user_id
         where s.token_hash = $1 and s.expires_at > now()`,
        [tokenHash(token)],
      );
      const user = result.rows[0];
      if (!user) {
        res.status(401).json({ error: 'session expired or invalid' });
        return;
      }
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}
