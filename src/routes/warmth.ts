import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import { readReferenceDoc } from '../housekeeping/reference.js';
import {
  clientDir,
  pageChrome,
  readClientPage,
  renderDocPage,
  repoRoot,
} from '../warmth/pages.js';
import { renderMarkdown } from '../warmth/markdown.js';
import { renderLegalPage } from '../legal/render.js';

/**
 * M4 warmth pages, served by the app (Caddy proxies these paths to it —
 * see the Caddyfile) because their slots depend on server config:
 *
 *   (GET /help/, /help/<slug>, /help/errors… — see routes/help.ts)
 *   GET /help/warmth.css         the shared Paper stylesheet (static)
 *   GET /help/billing-gate.js    hides the Ko-fi jar once billing is live
 *   GET /thanks                  the post-export landing (client/thanks/)
 *   GET /support                 the "buy the maker a caife" page
 *                                (client/support/) — served ONLY when
 *                                KOFI_URL is configured; 404 otherwise
 *   GET /changelog               rendered from CHANGELOG.md (repo root)
 *   GET /roadmap                 rendered from docs/roadmap.md — the same
 *                                source Housekeeping's Reference serves
 *   GET /privacy, GET /terms     the legal pages, from content/legal/
 *                                (src/legal/render.ts; operator details
 *                                from the LEGAL_* settings)
 *
 * Everything else under the site root remains Caddy's static mount.
 */
export function warmthRoutes(config: Config): Router {
  const router = Router();

  const sendPage = async (
    res: import('express').Response,
    next: import('express').NextFunction,
    load: () => Promise<string | null>,
  ): Promise<void> => {
    try {
      const html = await load();
      if (html === null) return next();
      res.type('html').send(html);
    } catch (err) {
      return next(err as Error);
    }
  };

  router.get('/help/warmth.css', async (_req, res, next) => {
    try {
      const css = await readFile(path.join(clientDir(), 'help', 'warmth.css'), 'utf8');
      return res.type('css').send(css);
    } catch (err) {
      return next(err as Error);
    }
  });

  // The Ko-fi gate (client/help/billing-gate.js) — included only on
  // pages that carry a tip jar; see billingGateHtml in warmth/pages.ts.
  router.get('/help/billing-gate.js', async (_req, res, next) => {
    try {
      const js = await readFile(path.join(clientDir(), 'help', 'billing-gate.js'), 'utf8');
      return res.type('application/javascript').send(js);
    } catch (err) {
      return next(err as Error);
    }
  });

  // /help/, the guides, /help/errors and /help/search are H1/H2's
  // server-rendered pages: src/routes/help.ts.

  router.get(['/thanks', '/thanks/'], (req, res, next) => {
    return sendPage(res, next, () => readClientPage(config, 'thanks', 'index.html'));
  });

  router.get(['/support', '/support/'], (_req, res, next) => {
    if (!config.kofiUrl) return next();
    return sendPage(res, next, () => readClientPage(config, 'support', 'index.html'));
  });

  router.get('/changelog', async (_req, res, next) => {
    try {
      const html = await renderDocPage(
        config,
        path.join(repoRoot(), 'CHANGELOG.md'),
        'Changelog',
      );
      return res.type('html').send(html);
    } catch (err) {
      return next(err as Error);
    }
  });

  router.get('/roadmap', async (_req, res, next) => {
    try {
      // Same source as Housekeeping's Reference pillar (docs/roadmap.md);
      // the public page presents it in the warmth chrome.
      const doc = await readReferenceDoc('roadmap');
      const body = renderMarkdown(doc.content);
      const html = pageChrome(config, doc.title, body);
      return res.type('html').send(html);
    } catch (err) {
      return next(err as Error);
    }
  });

  router.get(['/privacy', '/privacy/', '/terms', '/terms/'], async (req, res, next) => {
    try {
      const page = req.path.startsWith('/privacy') ? 'privacy' : 'terms';
      const html = await renderLegalPage(page, config);
      return res.type('html').set('Cache-Control', 'no-cache').send(html);
    } catch (err) {
      return next(err as Error);
    }
  });

  return router;
}
