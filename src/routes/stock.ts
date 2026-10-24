import { Router } from 'express';
import { requireAuth } from '../auth.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';

/**
 * Stock photos — GET /api/stock/search?q=…&per_page=… (signed-in only).
 *
 * A thin proxy over the Pexels search API so the client's cover maker
 * can find background photos without the Pexels API key ever reaching
 * the browser. The key lives only in the server's config (.env); it is
 * sent to Pexels as the Authorization header and appears in no
 * response, log line or error this route produces — upstream bodies
 * are never forwarded, only fixed plain messages.
 *
 * Honest gating, in the billing tradition: while PEXELS_API_KEY is
 * unset the endpoint answers a clean 501 "stock photos not
 * configured" — never an error, never a fake result. An upstream
 * failure (network or non-200) answers 502.
 *
 * Abuse control mirrors the Founders' Shelf: an in-memory per-user
 * throttle (per app instance — the deployment is a single app
 * process, so this is proportional). It is deliberately generous;
 * it exists so one account can't burn the shared Pexels quota.
 */

const WINDOW_MS = 60 * 1000;
const MAX_SEARCHES_PER_WINDOW = 30;
const DEFAULT_PER_PAGE = 24;
const MAX_PER_PAGE = 40;

interface PexelsPhoto {
  id?: unknown;
  width?: unknown;
  height?: unknown;
  url?: unknown;
  photographer?: unknown;
  photographer_url?: unknown;
  src?: { large?: unknown; medium?: unknown; original?: unknown } | null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function stockRoutes(db: Db, config: Config): Router {
  const router = Router();
  // Per-instance search log: user id → timestamps inside the window.
  const searches = new Map<string, number[]>();

  function throttled(userId: string): boolean {
    const nowMs = Date.now();
    const recent = (searches.get(userId) ?? []).filter((t) => nowMs - t < WINDOW_MS);
    recent.push(nowMs);
    searches.set(userId, recent);
    // Opportunistic tidy so the map can't grow without bound.
    if (searches.size > 1000) {
      for (const [key, times] of searches) {
        if (!times.some((t) => nowMs - t < WINDOW_MS)) searches.delete(key);
      }
    }
    return recent.length > MAX_SEARCHES_PER_WINDOW;
  }

  router.get('/search', requireAuth(db), async (req, res, next) => {
    try {
      if (throttled(req.user!.id)) {
        return res.status(429).json({
          error: 'too many searches — please wait a little and try again',
        });
      }
      if (!config.pexelsApiKey) {
        return res.status(501).json({ error: 'stock photos not configured' });
      }
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (!q) {
        return res.status(400).json({ error: 'please give a search term (q)' });
      }
      const parsedPerPage = Number.parseInt(
        typeof req.query.per_page === 'string' ? req.query.per_page : '',
        10,
      );
      const perPage = Number.isNaN(parsedPerPage)
        ? DEFAULT_PER_PAGE
        : Math.min(MAX_PER_PAGE, Math.max(1, parsedPerPage));

      const url =
        `${config.pexelsApiBase}/search?query=${encodeURIComponent(q)}` +
        `&per_page=${perPage}`;
      let upstream: globalThis.Response;
      try {
        upstream = await fetch(url, {
          headers: { Authorization: config.pexelsApiKey },
        });
      } catch {
        return res
          .status(502)
          .json({ error: 'stock photo search is unavailable right now — please try again' });
      }
      if (!upstream.ok) {
        return res
          .status(502)
          .json({ error: 'stock photo search is unavailable right now — please try again' });
      }
      const data = (await upstream.json().catch(() => null)) as {
        photos?: PexelsPhoto[];
      } | null;
      if (!data || !Array.isArray(data.photos)) {
        return res
          .status(502)
          .json({ error: 'stock photo search is unavailable right now — please try again' });
      }

      const photos = data.photos.map((photo) => ({
        id: asNumber(photo?.id),
        width: asNumber(photo?.width),
        height: asNumber(photo?.height),
        photographer: asString(photo?.photographer),
        photographerUrl: asString(photo?.photographer_url),
        pageUrl: asString(photo?.url),
        src: {
          large: asString(photo?.src?.large),
          medium: asString(photo?.src?.medium),
          original: asString(photo?.src?.original),
        },
      }));
      return res.json({ photos });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
