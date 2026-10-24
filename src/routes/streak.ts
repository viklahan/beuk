import { Router } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { requireAuth } from '../auth.js';
import { getStreak, heartbeat, pauseStreak } from '../streak.js';

/** `now` is injectable so tests can walk the clock across day boundaries;
 *  in production it is the real server clock — clients never supply dates. */
export function streakRoutes(db: Db, config: Config, now: () => Date = () => new Date()): Router {
  const router = Router();
  router.use(requireAuth(db));

  router.get('/', async (req, res, next) => {
    try {
      return res.json({ streak: await getStreak(db, req.user!.id, now(), config.timeZone) });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/heartbeat', async (req, res, next) => {
    try {
      return res.json({ streak: await heartbeat(db, req.user!.id, now(), config.timeZone) });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/pause', async (req, res, next) => {
    try {
      const start = String(req.body?.start ?? '');
      const days = Number(req.body?.days);
      const streak = await pauseStreak(db, req.user!.id, now(), config.timeZone, start, days);
      return res.json({ streak });
    } catch (err) {
      if (err instanceof Error && /must be|cannot start/.test(err.message)) {
        return res.status(400).json({ error: err.message });
      }
      return next(err);
    }
  });

  return router;
}
