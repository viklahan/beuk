import { Router } from 'express';
import { requireAuth } from '../auth.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';

/**
 * Aris — the AI addon's server surface, mounted at /api/aris.
 *
 * House style: mounted always, config checked per request. The gate runs
 * before requireAuth, so a disabled deployment answers an unauthenticated
 * probe with the same plain 404 as any unknown /api path (byte-identical
 * to the catch-all in app.ts). Enabled without ARIS_KEY_SECRET is an
 * honest 503, never a half-working addon.
 */
export function arisRoutes(db: Db, config: Config): Router {
  const router = Router();

  router.use((_req, res, next) => {
    if (!config.arisEnabled) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (!config.arisKeySecret) {
      res.status(503).json({ error: 'aris misconfigured: ARIS_KEY_SECRET is not set' });
      return;
    }
    next();
  });

  router.use(requireAuth(db));

  // optedIn and keys become real in later tasks; the shape is fixed now.
  router.get('/status', (_req, res) => {
    res.json({ enabled: true, optedIn: false, voice: 'laconic', keys: [] });
  });

  return router;
}
