import { Router } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { hashPassword, verifyPassword } from '../password.js';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  requireAuth,
  setSessionCookie,
} from '../auth.js';
import { initStreakState } from '../streak.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
}

export function authRoutes(db: Db, config: Config): Router {
  const router = Router();

  router.post('/register', async (req, res, next) => {
    try {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid email' });
      if (password.length < 8)
        return res.status(400).json({ error: 'password must be at least 8 characters' });

      const existing = await db.query('select id from users where email = $1', [email]);
      if (existing.rows.length) return res.status(409).json({ error: 'email already registered' });

      const passwordHash = await hashPassword(password);
      const created = await db.query<UserRow>(
        'insert into users (email, password_hash) values ($1, $2) returning id, email',
        [email, passwordHash],
      );
      const user = created.rows[0];
      await initStreakState(db, user.id);
      const session = await createSession(db, user.id, config.sessionTtlDays);
      setSessionCookie(res, session.token, session.expiresAt, config.cookieSecure);
      return res.status(201).json({ user: { id: user.id, email: user.email } });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');
      const found = await db.query<UserRow>(
        'select id, email, password_hash from users where email = $1',
        [email],
      );
      const user = found.rows[0];
      // Same response for unknown email and wrong password.
      if (!user || !(await verifyPassword(user.password_hash, password))) {
        return res.status(401).json({ error: 'invalid email or password' });
      }
      const session = await createSession(db, user.id, config.sessionTtlDays);
      setSessionCookie(res, session.token, session.expiresAt, config.cookieSecure);
      return res.json({ user: { id: user.id, email: user.email } });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      await destroySession(db, req);
      clearSessionCookie(res, config.cookieSecure);
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  });

  router.get('/me', requireAuth(db), (req, res) => {
    return res.json({ user: req.user });
  });

  return router;
}
