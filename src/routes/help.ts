import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { helpAssetFor } from '../help/assets.js';
import { getHelpContent } from '../help/content.js';
import {
  renderErrorPage,
  renderErrorsIndex,
  renderGuide,
  renderHome,
  renderNotFound,
  renderSearchPage,
  type PageCtx,
} from '../help/render.js';
import { logSearchClick, searchHelp, type SearchResult } from '../help/search.js';
import { readShelfStatus } from '../help/status.js';
import { TokenBucketLimiter } from '../ratelimit.js';

/**
 * H1 + H2 routes.
 *
 * Pages (Caddy proxies /help* to the app):
 *   GET /help/                 home: search, paths, guides, dictionary, status
 *   GET /help/<slug>           one guide (content/help/guides/<slug>.md)
 *   GET /help/<slug>.html      301 → /help/<slug> (the pre-H1 static URLs)
 *   GET /help/index.html       301 → /help/
 *   GET /help/errors           the error dictionary
 *   GET /help/errors/<code>    one entry (lower-case codes 301 to upper)
 *   GET /help/search?q=        server-rendered results (works without JS);
 *   POST /help/search          the same, from the form (q in the body)
 *   GET /help/static/<file>    help.css / help.js / theme.js, content-hashed
 * API:
 *   GET  /api/help/search?q=   { q, codes, errors, guides, sections, total, trigram, logId }
 *   POST /api/help/search      { q } — the same, for a long pasted message
 *   POST /api/help/search/click { logId, ref } — which result a search led to
 * Both search entry points share one per-IP token bucket; over it the
 * answer is 429 with Retry-After (the page says so in words).
 */

export interface HelpSearchLimits {
  burst: number;
  refillMs: number;
}
export const DEFAULT_HELP_SEARCH_LIMITS: HelpSearchLimits = { burst: 30, refillMs: 2_000 };

/** q from the query string (GET) or the body (POST form / JSON). */
function queryOf(req: Request): string {
  const body = req.body as { q?: unknown } | undefined;
  if (req.method === 'POST' && body && typeof body.q === 'string') return body.q;
  return typeof req.query.q === 'string' ? req.query.q : '';
}

export function helpRoutes(
  db: Db,
  config: Config,
  limits: HelpSearchLimits = DEFAULT_HELP_SEARCH_LIMITS,
): { pages: Router; api: Router } {
  const limiter = new TokenBucketLimiter({ burst: limits.burst, refillMs: limits.refillMs });
  const pages = Router();
  const api = Router();

  const ctx = async (): Promise<PageCtx> => ({
    config,
    content: getHelpContent(),
    status: await readShelfStatus(db, config),
  });
  const send = (res: Response, html: string, status = 200) => {
    res.status(status).type('html').set('Cache-Control', 'no-cache').send(html);
  };
  const wrap =
    (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      fn(req, res, next).catch(next);
    };

  pages.get('/help/static/:file', (req, res) => {
    const asset = helpAssetFor(req.params.file);
    if (!asset) return res.status(404).type('text').send('not found');
    res.type(asset.type);
    // A current hash is immutable; a stale one gets today's bytes, uncached.
    res.set('Cache-Control', asset.current ? 'public, max-age=31536000, immutable' : 'no-cache');
    return res.send(asset.body);
  });

  pages.get(['/help', '/help/'], wrap(async (_req, res) => send(res, renderHome(await ctx()))));
  pages.get('/help/index.html', (_req, res) => res.redirect(301, '/help/'));

  pages.get(['/help/errors', '/help/errors/'], wrap(async (_req, res) => send(res, renderErrorsIndex(await ctx()))));
  pages.get(
    '/help/errors/:code',
    wrap(async (req, res) => {
      const raw = req.params.code;
      const code = raw.toUpperCase();
      const c = await ctx();
      const entry = c.content.errorByCode.get(code);
      if (!entry) return send(res, renderNotFound(c, `There is no error code ${raw} in the dictionary.`), 404);
      if (raw !== code) return res.redirect(301, `/help/errors/${code}`);
      return send(res, renderErrorPage(c, entry));
    }),
  );

  const runSearch = async (req: Request, res: Response): Promise<{ result: SearchResult; limited: { retryAfterSec: number } | null }> => {
    const q = queryOf(req);
    const empty: SearchResult = { q: '', codes: [], errors: [], guides: [], sections: [], total: 0, trigram: 'not-needed', logId: null };
    if (!q.trim()) return { result: empty, limited: null };
    const take = limiter.take(req.ip ?? 'unknown');
    if (!take.ok) {
      res.setHeader('Retry-After', String(take.retryAfterSec));
      return { result: { ...empty, q: q.trim() }, limited: { retryAfterSec: take.retryAfterSec } };
    }
    return { result: await searchHelp(db, q), limited: null };
  };

  const searchPage = wrap(async (req, res) => {
    const { result, limited } = await runSearch(req, res);
    return send(res, renderSearchPage(await ctx(), result, limited), limited ? 429 : 200);
  });
  pages.get('/help/search', searchPage);
  // The search form posts (a pasted report can be longer than a URL may be).
  pages.post('/help/search', express.urlencoded({ extended: false, limit: '96kb' }), searchPage);

  pages.get(
    '/help/:page',
    wrap(async (req, res, next) => {
      const page = req.params.page;
      const html = /^([a-z0-9-]+)\.html$/.exec(page);
      const content = getHelpContent();
      if (html) {
        if (content.guideBySlug.has(html[1])) return res.redirect(301, `/help/${html[1]}`);
        return send(res, renderNotFound(await ctx(), 'That guide is not on the shelf.'), 404);
      }
      if (!/^[a-z0-9-]+$/.test(page)) return next();
      const guide = content.guideBySlug.get(page);
      if (!guide) return send(res, renderNotFound(await ctx(), 'That guide is not on the shelf.'), 404);
      return send(res, renderGuide(await ctx(), guide));
    }),
  );

  const apiSearch = wrap(async (req, res) => {
      const q = queryOf(req);
      if (!q.trim()) return res.status(400).json({ error: 'q is required' });
      const take = limiter.take(req.ip ?? 'unknown');
      if (!take.ok) {
        res.setHeader('Retry-After', String(take.retryAfterSec));
        return res.status(429).json({ error: 'too many searches; please wait a moment', retryAfterSeconds: take.retryAfterSec });
      }
      res.set('Cache-Control', 'no-store');
      return res.json(await searchHelp(db, q));
    });
  api.get('/search', apiSearch);
  // Same search for a long pasted message: { q } as JSON.
  api.post('/search', apiSearch);

  api.post(
    '/search/click',
    wrap(async (req, res) => {
      const body = (req.body ?? {}) as { logId?: unknown; ref?: unknown };
      if (typeof body.logId !== 'string' || typeof body.ref !== 'string') return res.status(400).json({ error: 'logId and ref are required' });
      const ok = await logSearchClick(db, body.logId, body.ref);
      return res.status(ok ? 204 : 404).end();
    }),
  );

  return { pages, api };
}
