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

/**
 * M4 warmth pages, served by the app (Caddy proxies these paths to it —
 * see the Caddyfile) because their slots depend on server config:
 *
 *   GET /help/ + /help/<guide>   the static reading-room pages from
 *                                client/help/, slots filled per request
 *   GET /help/warmth.css         the shared Paper stylesheet (static)
 *   GET /thanks                  the post-export landing (client/thanks/)
 *   GET /support                 the "buy the maker a coffee" page
 *                                (client/support/) — served ONLY when
 *                                KOFI_URL is configured; 404 otherwise
 *   GET /changelog               rendered from CHANGELOG.md (repo root)
 *   GET /roadmap                 rendered from docs/roadmap.md — the same
 *                                source Housekeeping's Reference serves
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

  router.get(['/help', '/help/'], (_req, res, next) => {
    return sendPage(res, next, () => readClientPage(config, 'help', 'index.html'));
  });

  router.get('/help/:page', (req, res, next) => {
    const page = req.params.page;
    // Plain file names only — no traversal, no directories.
    if (!/^[a-z0-9-]+\.html$/.test(page)) return next();
    return sendPage(res, next, () => readClientPage(config, 'help', page));
  });

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

  return router;
}
