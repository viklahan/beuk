import path from 'node:path';
import { existsSync } from 'node:fs';
import express, { Router } from 'express';
import { clientDir } from '../warmth/pages.js';

/**
 * Beuk 2.0 studio (React), at /next — unlinked while the port runs; 1.0
 * stays at /studio. Its build (studio/ → client/next/) is made in the
 * image's studio stage and is not committed, so Caddy's static ./client
 * mount never has it: Caddy proxies /next* here and the app serves it
 * from the image (see the Caddyfile and the Dockerfile).
 *
 * - /next redirects to /next/ (the service worker's scope is /next/).
 * - Hashed build files (/next/assets/*) are immutable for a year.
 * - index.html, sw.js and its precache list revalidate on every load,
 *   so a deploy reaches the writer at once.
 * - Any other path under /next/ without a file extension is the app's
 *   own route: it gets index.html. A missing file with an extension is
 *   a 404, never the page (a missing script must fail loudly).
 * - No build on disk (a dev box that never built it): 404 through next().
 */
export function nextStudioRoutes(dir: string = path.join(clientDir(), 'next')): Router {
  const router = Router();
  const indexFile = path.join(dir, 'index.html');
  router.get('/next', (req, res, next) => {
    // Express's default (non-strict) routing matches "/next/" here too.
    const q = req.originalUrl.indexOf('?');
    const pathname = q === -1 ? req.originalUrl : req.originalUrl.slice(0, q);
    if (pathname !== '/next') return next();
    return res.redirect(308, '/next/' + (q === -1 ? '' : req.originalUrl.slice(q)));
  });
  router.use(
    '/next',
    express.static(dir, {
      index: false,
      redirect: false,
      dotfiles: 'ignore',
      fallthrough: true,
      setHeaders(res, file) {
        const rel = path.relative(dir, file).split(path.sep).join('/');
        if (rel.startsWith('assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  router.get('/next/*', (req, res, next) => {
    if (/\.[a-z0-9]+$/i.test(req.path) && req.path !== '/next/index.html') return next();
    if (!existsSync(indexFile)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(indexFile);
  });
  return router;
}
