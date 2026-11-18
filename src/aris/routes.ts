import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../auth.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { encryptKey } from './vault.js';

const PROVIDERS = ['openrouter', 'anthropic', 'openai-compat'] as const;
const API_KEY_MAX = 512;
const VOICES = ['laconic', 'homeric'] as const;
type Voice = (typeof VOICES)[number];

interface ArisStatus {
  enabled: true;
  optedIn: boolean;
  voice: Voice;
  keys: { provider: string; last4: string; baseUrl?: string }[];
}

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

  // No aris_settings row means the defaults (not opted in, laconic).
  async function loadStatus(userId: number | string): Promise<ArisStatus> {
    const [keyRows, settings] = await Promise.all([
      db.query<{ provider: string; key_last4: string; base_url: string | null }>(
        'select provider, key_last4, base_url from aris_keys where user_id = $1 order by provider',
        [userId],
      ),
      db.query<{ opted_in: boolean; voice: Voice }>('select opted_in, voice from aris_settings where user_id = $1', [
        userId,
      ]),
    ]);
    const keys = keyRows.rows.map((r) => ({
      provider: r.provider,
      last4: r.key_last4,
      ...(r.base_url ? { baseUrl: r.base_url } : {}),
    }));
    const row = settings.rows[0];
    return { enabled: true, optedIn: row?.opted_in ?? false, voice: row?.voice ?? 'laconic', keys };
  }

  // Engine routes (draft, review) sit behind this until the user has opted in on /aris.
  async function requireOptIn(req: Request, res: Response, next: NextFunction) {
    try {
      const r = await db.query<{ opted_in: boolean }>('select opted_in from aris_settings where user_id = $1', [
        req.user!.id,
      ]);
      if (!r.rows[0]?.opted_in) {
        res.status(403).json({ error: 'summon Aris on your /aris page first' });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  }

  router.get('/status', async (req, res, next) => {
    try {
      res.json(await loadStatus(req.user!.id));
    } catch (err) {
      next(err);
    }
  });

  router.put('/settings', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { optedIn?: unknown; voice?: unknown };
      if (body.optedIn !== undefined && typeof body.optedIn !== 'boolean') {
        res.status(400).json({ error: 'optedIn must be a boolean' });
        return;
      }
      if (body.voice !== undefined && !(VOICES as readonly unknown[]).includes(body.voice)) {
        res.status(400).json({ error: 'voice must be one of: laconic, homeric' });
        return;
      }
      // Omitted fields keep their stored value (or the column default on first write).
      await db.query(
        `insert into aris_settings (user_id, opted_in, voice)
         values ($1, coalesce($2::boolean, false), coalesce($3::text, 'laconic'))
         on conflict (user_id) do update
           set opted_in = coalesce($2::boolean, aris_settings.opted_in),
               voice = coalesce($3::text, aris_settings.voice),
               updated_at = now()`,
        [req.user!.id, body.optedIn ?? null, body.voice ?? null],
      );
      res.json(await loadStatus(req.user!.id));
    } catch (err) {
      next(err);
    }
  });

  // Placeholder: replaced by the real draft handler in Task 7.
  router.post('/draft', requireOptIn, (_req, res) => {
    res.status(501).json({ error: 'not yet' });
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
