import { existsSync } from 'node:fs';
import path from 'node:path';
import { Router, type Response } from 'express';
import { getBowmarketContent } from '../bowmarket/content.js';
import { renderBowmarket, renderItem } from '../bowmarket/render.js';
import type { Config } from '../config.js';
import { getSchoolContent } from '../school/content.js';
import { renderSchoolNotFound } from '../school/render.js';

/**
 * Bowmarket (src/bowmarket/*): the School's bookshop. Mounted before the
 * School's own pages so /school/bowmarket is never read as a course slug.
 *   GET /school/bowmarket              the shop: box sets, then books
 *   GET /school/bowmarket/<slug>       one item
 *   GET /school/bowmarket/img/<file>   a picture from the content folder
 * The manuscripts (an item's `source`) are never served from here.
 */

const IMAGE_TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

export function bowmarketRoutes(config: Config): Router {
  const router = Router();
  const send = (res: Response, html: string, status = 200) => {
    res.status(status).type('html').set('Cache-Control', 'no-cache').send(html);
  };

  router.get('/school/bowmarket', (req, res) => {
    if (req.path.endsWith('/')) return res.redirect(301, '/school/bowmarket');
    return send(res, renderBowmarket(config, getBowmarketContent()));
  });

  router.get('/school/bowmarket/img/:file', (req, res) => {
    const file = req.params.file;
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
    if (!type || !/^[a-z0-9][a-z0-9._-]*$/i.test(file)) return res.status(404).type('text').send('not found');
    const full = path.join(getBowmarketContent().dir, file);
    if (!existsSync(full)) return res.status(404).type('text').send('not found');
    res.type(type).set('Cache-Control', 'public, max-age=86400');
    return res.sendFile(full);
  });

  router.get('/school/bowmarket/:slug', (req, res) => {
    const c = getBowmarketContent();
    const item = c.itemBySlug.get(req.params.slug);
    if (!item) return send(res, renderSchoolNotFound({ config, content: getSchoolContent() }, 'There is no book at that address.'), 404);
    return send(res, renderItem(config, c, item));
  });

  return router;
}
