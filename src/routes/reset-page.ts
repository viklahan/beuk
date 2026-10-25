import { Router } from 'express';
import type { Config } from '../config.js';
import { readClientPage } from '../warmth/pages.js';

/**
 * P0 #5: GET /reset?token=… — the small static "choose a new password"
 * page (client/reset/index.html), served by the app like the warmth
 * pages (Caddy proxies /reset* here — see the Caddyfile). The page's
 * own script reads the token, strips it from the address bar, and
 * POSTs it to /api/auth/reset. The token never touches this route's
 * logic; the headers keep it out of caches, referrers and indexes.
 */
export function resetPageRoutes(config: Config): Router {
  const router = Router();
  router.get(['/reset', '/reset/'], async (_req, res, next) => {
    try {
      const html = await readClientPage(config, 'reset', 'index.html');
      if (html === null) return next();
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Robots-Tag', 'noindex');
      return res.type('html').send(html);
    } catch (err) {
      return next(err as Error);
    }
  });
  return router;
}
