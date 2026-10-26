import { Router } from 'express';
import type { Config } from '../config.js';
import { getHelpContent } from '../help/content.js';

/**
 * The public site's crawler files, served by the app (Caddy proxies these
 * two paths to it — see the Caddyfile) because they carry the configured
 * origin (APP_BASE_URL):
 *
 *   GET /robots.txt    what may be crawled, and where the sitemap is
 *   GET /sitemap.xml   every public page: the landing page, Help (each
 *                      guide and each error entry), the legal pages,
 *                      the changelog and roadmap, and /support while
 *                      KOFI_URL is set (it is a 404 otherwise)
 *
 * Kept out of search: the studio's app shell (/studio, /index.html), the
 * API, reading copies (/read — private drafts behind a link), the
 * password-reset page and Help search results.
 */
export function siteRoutes(config: Config): Router {
  const router = Router();
  const base = config.appBaseUrl;

  router.get('/robots.txt', (_req, res) => {
    res.type('text/plain; charset=utf-8').setHeader('Cache-Control', 'public, max-age=3600');
    res.send(
      [
        'User-agent: *',
        'Disallow: /api/',
        'Disallow: /read/',
        'Disallow: /reset',
        'Disallow: /studio',
        'Disallow: /index.html',
        'Disallow: /help/search',
        '',
        `Sitemap: ${base}/sitemap.xml`,
        '',
      ].join('\n'),
    );
  });

  router.get('/sitemap.xml', (_req, res) => {
    const c = getHelpContent();
    const paths = [
      '/',
      '/help',
      ...c.guides.map((g) => `/help/${g.slug}`),
      '/help/errors',
      ...c.errors.map((e) => `/help/errors/${e.code}`),
      '/changelog',
      '/roadmap',
      '/privacy',
      '/terms',
      '/status',
      ...(config.kofiUrl ? ['/support'] : []),
    ];
    const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lastmod = new Map(c.guides.map((g) => [`/help/${g.slug}`, g.updated]));
    const urls = paths
      .map((p) => {
        const mod = lastmod.get(p);
        return `  <url><loc>${xmlEsc(base + p)}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ''}</url>`;
      })
      .join('\n');
    res.type('application/xml; charset=utf-8').setHeader('Cache-Control', 'public, max-age=3600');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  });

  return router;
}
