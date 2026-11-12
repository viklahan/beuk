import path from 'node:path';
import { existsSync } from 'node:fs';
import express, { Router, type Request } from 'express';
import { clientDir } from '../warmth/pages.js';

/**
 * The studio: Beuk 2.0 (React) at /studio/ (spec 2026-11-12-studio-2-cutover, D1–D3). Its build
 * (studio/ → client/next/) is made in the image's studio stage and is not committed, so Caddy's static
 * ./client mount never has it: Caddy proxies /studio, /studio/* and /next* here and the app serves it
 * from the image (see the Caddyfile and the Dockerfile). The build directory keeps its name client/next/
 * (fewer moving parts); only its address changed.
 *
 * - /studio redirects (308) to /studio/, the query kept (?signin, ?signup, ?book=<uuid>): the service
 *   worker's scope is /studio/, and every link 1.0's pages and emails carry names /studio.
 * - Hashed build files (/studio/assets/*) are immutable for a year.
 * - index.html, sw.js and its precache list revalidate on every load, so a deploy reaches the writer at once.
 * - Any other path under /studio/ without a file extension is the app's own route: it gets index.html.
 *   A missing file with an extension is a 404, never the page (a missing script must fail loudly).
 * - No build on disk (a dev box that never built it): 404 through next().
 * - The old address: /next and /next/* redirect (308) to the same path under /studio/ (D2), the query kept.
 *
 * classic (STUDIO_CLASSIC=true, the emergency rollback, D3): /studio serves 1.0's client/index.html with
 * the header Caddy sent for it before the switch (Cache-Control: no-cache); /studio/ and every other
 * extensionless /studio/* path redirect (308) back to /studio, the query kept; 2.0's files are not served.
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

  // D2: the old address. "/next" is the studio's root; "/next/<rest>" is "/studio/<rest>".
  router.get(['/next', '/next/*'], (req, res, next) => {
    const [pathname, query] = split(req);
    if (pathname !== '/next' && !pathname.startsWith('/next/')) return next();
    return res.redirect(308, '/studio/' + pathname.slice(pathname === '/next' ? '/next'.length : '/next/'.length) + query);
  });

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
      return res.redirect(308, '/studio' + query);
    });
    return router;
  }

  router.get('/studio', (req, res, next) => {
    // Express's default (non-strict) routing matches "/studio/" here too.
    const [pathname, query] = split(req);
    if (pathname !== '/studio') return next();
    return res.redirect(308, '/studio/' + query);
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
      },
    }),
  );
  router.get(['/studio/', '/studio/*'], (req, res, next) => {
    if (hasExtension(req.path) && req.path !== '/studio/index.html') return next();
    if (!existsSync(indexFile)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(indexFile);
  });
  return router;
}
