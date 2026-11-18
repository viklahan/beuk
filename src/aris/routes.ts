import { Router } from 'express';
import { requireAuth } from '../auth.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { encryptKey } from './vault.js';

const PROVIDERS = ['openrouter', 'anthropic', 'openai-compat'] as const;
const API_KEY_MAX = 512;

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

  // optedIn and voice become real in Task 4; the shape is fixed now.
  router.get('/status', async (req, res, next) => {
    try {
      const rows = await db.query<{ provider: string; key_last4: string; base_url: string | null }>(
        'select provider, key_last4, base_url from aris_keys where user_id = $1 order by provider',
        [req.user!.id],
      );
      const keys = rows.rows.map((r) => ({
        provider: r.provider,
        last4: r.key_last4,
        ...(r.base_url ? { baseUrl: r.base_url } : {}),
      }));
      res.json({ enabled: true, optedIn: false, voice: 'laconic', keys });
    } catch (err) {
      next(err);
    }
  });

  // Show-once: the response carries the last four characters, never the key.
  router.put('/key', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { provider?: unknown; apiKey?: unknown; baseUrl?: unknown };
      const provider = body.provider;
      if (typeof provider !== 'string' || !(PROVIDERS as readonly string[]).includes(provider)) {
        res.status(400).json({ error: 'provider must be one of: openrouter, anthropic, openai-compat' });
        return;
      }
      const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
      if (!apiKey || apiKey.length > API_KEY_MAX) {
        res.status(400).json({ error: 'apiKey is required' });
        return;
      }
      let baseUrl: string | null = null;
      if (body.baseUrl !== undefined && body.baseUrl !== null) {
        if (provider !== 'openai-compat') {
          res.status(400).json({ error: 'baseUrl is only accepted for openai-compat' });
          return;
        }
        let parsed: URL;
        try {
          parsed = new URL(String(body.baseUrl));
        } catch {
          res.status(400).json({ error: 'baseUrl must be an https URL' });
          return;
        }
        if (parsed.protocol !== 'https:') {
          res.status(400).json({ error: 'baseUrl must be an https URL' });
          return;
        }
        baseUrl = parsed.toString();
      }
      const last4 = apiKey.slice(-4);
      await db.query(
        `insert into aris_keys (user_id, provider, key_ciphertext, key_last4, base_url)
         values ($1, $2, $3, $4, $5)
         on conflict (user_id, provider) do update
           set key_ciphertext = excluded.key_ciphertext,
               key_last4 = excluded.key_last4,
               base_url = excluded.base_url`,
        [req.user!.id, provider, encryptKey(config.arisKeySecret!, apiKey), last4, baseUrl],
      );
      res.json({ provider, last4 });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/key/:provider', async (req, res, next) => {
    try {
      await db.query('delete from aris_keys where user_id = $1 and provider = $2', [req.user!.id, req.params.provider]);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
