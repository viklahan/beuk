import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { loadPersona } from '../aris/persona.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { getHelpContent } from '../help/content.js';
import { chrome } from '../help/render.js';
import { readShelfStatus } from '../help/status.js';
import { renderMarkdown } from '../warmth/markdown.js';
import { clientDir } from '../warmth/pages.js';

/**
 * /aris — the only page that explains Aris and the only place its opt-in
 * lives. The body is persona.md's "## Page" (single source: nothing of it
 * is repeated here) followed by a controls section the script
 * (client/aris/aris.js) fills from /api/aris/status: signed out, one quiet
 * line; signed in, the opt-in, the voice dial and the keys.
 *
 *   GET /aris            the page
 *   GET /aris/aris.js    the controls' script   (served like the account page's)
 *   GET /aris/aris.css   the controls' styles
 *
 * With ARIS_ENABLED unset none of these exist: they fall through to the
 * site's ordinary 404.
 */
export function arisPageRoutes(db: Db, config: Config): Router {
  const router = Router();

  const asset = (file: string, type: string) => async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (!config.arisEnabled) return next();
      const body = await readFile(path.join(clientDir(), 'aris', file), 'utf8');
      res.setHeader('Cache-Control', 'no-cache');
      return res.type(type).send(body);
    } catch (err) {
      return next(err as Error);
    }
  };
  router.get('/aris/aris.css', asset('aris.css', 'css'));
  router.get('/aris/aris.js', asset('aris.js', 'application/javascript'));

  router.get(['/aris', '/aris/'], async (_req, res, next) => {
    try {
      if (!config.arisEnabled) return next();
      const ctx = { config, content: getHelpContent(), status: await readShelfStatus(db, config) };
      const html = chrome(ctx, {
        title: 'Aris — Beuk',
        description: 'Aris, the optional writing companion in Beuk: who it is, what it will and will not do, and how to summon it.',
        body: `<link rel="stylesheet" href="/aris/aris.css" />
<article class="aris-page">
${renderMarkdown(loadPersona().page)}
<section class="aris-controls" id="summon" data-aris-controls aria-label="Summon Aris">
  <p class="aris-quiet" data-aris-signed-out>Aris is summoned from your account. <a href="/account">Sign in</a> to set it up.</p>
  <div data-aris-signed-in hidden></div>
  <p class="aris-msg" data-aris-msg role="status" hidden></p>
</section>
</article>
<script src="/aris/aris.js" defer></script>`,
      });
      res.type('html').send(html);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
