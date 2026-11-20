import path from 'node:path';
import { existsSync } from 'node:fs';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { clientDir } from '../warmth/pages.js';

/**
 * The studio: Beuk 2.0 (React) at /studio/ (spec 2026-11-12-studio-2-cutover, D1–D3). Its build
 * (studio/ → client/next/) is made in the image's studio stage and is not committed, so Caddy's static
 * ./client mount never has it: Caddy proxies /studio and /studio/* here and the app serves it
 * from the image (see the Caddyfile and the Dockerfile). The build directory keeps its name client/next/
 * (fewer moving parts); only its address changed.
 *
 * - 2.0's page answers at /studio AND at /studio/, the query kept (?signin, ?signup, ?book=<uuid>), with no
 *   redirect between the two (final review C2: a browser keeps a permanent redirect for ever, so one between
 *   these two addresses loops the moment the other mode or an older Caddy sent the opposite one). The page
 *   tidies /studio to /studio/ itself (studio/index.html). Every link 1.0's pages and emails carry names /studio.
 * - The service worker's scope is /studio (both addresses, offline too: final review I1), wider than its
 *   folder, so /studio/sw.js carries Service-Worker-Allowed: /studio.
 * - Hashed build files (/studio/assets/*) are immutable for a year.
 * - index.html, sw.js and its precache list revalidate on every load, so a deploy reaches the writer at once.
 * - Any other path under /studio/ without a file extension is the app's own route: it gets index.html.
 *   A missing file with an extension is a 404, never the page (a missing script must fail loudly).
 * - No build on disk (a dev box that never built it): 404 through next().
 * - The old address /next is gone (2026-11-20): the app has no route for it, so it is an unknown path here.
 *
 * classic (STUDIO_CLASSIC=true, the emergency rollback, D3): /studio serves 1.0's client/index.html with
 * the header Caddy sent for it before the switch (Cache-Control: no-cache); /studio/ and every other
 * extensionless /studio/* path redirect (302, Cache-Control: no-store: never kept, so flipping back can't loop)
 * to /studio, the query kept; 2.0's files are not served.
 */
export function studioRoutes(opts: { dir?: string; classic?: boolean; classicFile?: string } = {}): Router {
  const dir = opts.dir ?? path.join(clientDir(), 'next');
  const classicFile = opts.classicFile ?? path.join(clientDir(), 'index.html');
  const indexFile = path.join(dir, 'index.html');
  const router = Router();

  const split = (req: Request): [string, string] => {
    const q = req.originalUrl.indexOf('?');
    return q === -1 ? [req.originalUrl, ''] : [req.originalUrl.slice(0, q), req.originalUrl.slice(q)];
  };
  const hasExtension = (p: string) => /\.[a-z0-9]+$/i.test(p);

  if (opts.classic) {
    router.get(['/studio', '/studio/*'], (req, res, next) => {
      const [pathname, query] = split(req);
      if (pathname === '/studio') {
        res.setHeader('Cache-Control', 'no-cache');
        return res.sendFile(classicFile);
      }
      // Express's default (non-strict) routing matches "/studio/" on "/studio" too: it lands here.
      if (!pathname.startsWith('/studio/')) return next();
      if (hasExtension(pathname)) return next();
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(302, '/studio' + query);
    });
    return router;
  }

  const sendIndex = (res: Response, next: NextFunction) => {
    if (!existsSync(indexFile)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(indexFile);
  };
  router.get('/studio', (req, res, next) => {
    // Express's default (non-strict) routing matches "/studio/" here too: that one goes on below.
    const [pathname] = split(req);
    if (pathname !== '/studio') return next();
    return sendIndex(res, next);
  });
  router.use(
    '/studio',
    express.static(dir, {
      index: false,
      redirect: false,
      dotfiles: 'ignore',
      fallthrough: true,
      setHeaders(res, file) {
        const rel = path.relative(dir, file).split(path.sep).join('/');
        if (rel.startsWith('assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'no-cache');
        if (rel === 'sw.js') res.setHeader('Service-Worker-Allowed', '/studio');
      },
    }),
  );
  router.get(['/studio/', '/studio/*'], (req, res, next) => {
    if (hasExtension(req.path) && req.path !== '/studio/index.html') return next();
    return sendIndex(res, next);
  });
  return router;
}
