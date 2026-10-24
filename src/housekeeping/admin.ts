import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { readCookie, SESSION_COOKIE } from '../auth.js';
import type { Db } from '../db.js';
import { writeAudit } from './context.js';

/**
 * Admin is granted out-of-band only: an operator with shell access to the
 * server runs the admin CLI (src/admin-cli.ts) against an EXISTING account.
 * Nothing reachable over HTTP — registration, login, an email address
 * matching a list — can make anyone an admin, so owning or claiming an
 * email confers nothing.
 */
export type AdminChange = 'granted' | 'revoked' | 'unchanged' | 'no such user';

export async function setAdmin(db: Db, email: string, isAdmin: boolean): Promise<AdminChange> {
  const needle = email.trim().toLowerCase();
  const found = await db.query<{ id: string; is_admin: boolean }>(
    'select id, is_admin from users where email = $1',
    [needle],
  );
  const user = found.rows[0];
  if (!user) return 'no such user';
  if (user.is_admin === isAdmin) return 'unchanged';
  await db.query('update users set is_admin = $2 where id = $1', [user.id, isAdmin]);
  const change: AdminChange = isAdmin ? 'granted' : 'revoked';
  await writeAudit(db, {
    actorId: null,
    actorEmail: 'admin-cli',
    action: isAdmin ? 'admin.grant' : 'admin.revoke',
    params: { email: needle },
    result: change,
  });
  return change;
}

export async function listAdmins(db: Db): Promise<string[]> {
  const result = await db.query<{ email: string }>(
    'select email from users where is_admin order by email',
  );
  return result.rows.map((row) => row.email);
}

interface AdminRow {
  id: string;
  email: string;
  is_admin: boolean;
}

/**
 * The Housekeeping gate. Anyone who is not a signed-in admin — anonymous
 * callers AND ordinary users — gets a plain 404, identical to an unknown
 * route: the surface does not reveal that it exists (spec). The flag is
 * read live on every request, so a revoke takes effect immediately.
 */
export function requireAdmin(db: Db) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const deny = (): void => {
      res.status(404).json({ error: 'not found' });
    };
    try {
      const token = readCookie(req, SESSION_COOKIE);
      if (!token) return deny();
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const result = await db.query<AdminRow>(
        `select u.id, u.email, u.is_admin from sessions s
         join users u on u.id = s.user_id
         where s.token_hash = $1 and s.expires_at > now()`,
        [tokenHash],
      );
      const user = result.rows[0];
      if (!user || !user.is_admin) return deny();
      req.user = { id: user.id, email: user.email };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
