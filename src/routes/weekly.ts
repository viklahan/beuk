import { existsSync } from 'node:fs';
import path from 'node:path';
import { Router, type Response } from 'express';
import type { Config } from '../config.js';
import { getSchoolContent } from '../school/content.js';
import { renderSchoolNotFound } from '../school/render.js';
import { getWeeklyContent } from '../weekly/content.js';
import { renderIssue, renderStory, renderWeeklyEmpty } from '../weekly/render.js';

/**
 * Beuk Weekly (src/weekly/*): the School's newspaper. Mounted before the
 * School's own pages so /school/weekly is never read as a course slug.
 *   GET /school/weekly                 the latest issue
 *   GET /school/weekly/<n>             issue n
 *   GET /school/weekly/<n>/<story>     a story with a page of its own
 *   GET /school/weekly/<n>/img/<file>  a picture from issue n's folder
 */
const IMAGE_TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

export function weeklyRoutes(config: Config): Router {
  const router = Router();
  const send = (res: Response, html: string, status = 200) => {
    res.status(status).type('html').set('Cache-Control', 'no-cache').send(html);
  };
  const notFound = (res: Response, message: string) =>
    send(res, renderSchoolNotFound({ config, content: getSchoolContent() }, message), 404);

  router.get('/school/weekly', (req, res) => {
    if (req.path.endsWith('/')) return res.redirect(301, '/school/weekly');
    const w = getWeeklyContent();
    return send(res, w.latest ? renderIssue(config, w, w.latest) : renderWeeklyEmpty(config));
  });

  router.get('/school/weekly/:n', (req, res) => {
    if (!/^\d{1,4}$/.test(req.params.n)) return notFound(res, 'There is no issue at that address.');
    const w = getWeeklyContent();
    const issue = w.issueByNumber.get(Number(req.params.n));
    if (!issue) return notFound(res, 'There is no issue with that number yet.');
    return send(res, renderIssue(config, w, issue));
  });

  router.get('/school/weekly/:n/img/:file', (req, res) => {
    const issue = /^\d{1,4}$/.test(req.params.n) ? getWeeklyContent().issueByNumber.get(Number(req.params.n)) : undefined;
    const file = req.params.file;
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
    if (!issue || !type || !/^[a-z0-9][a-z0-9._-]*$/i.test(file)) return res.status(404).type('text').send('not found');
    const full = path.join(issue.dir, file);
    if (!existsSync(full)) return res.status(404).type('text').send('not found');
    res.type(type).set('Cache-Control', 'public, max-age=86400');
    return res.sendFile(full);
  });

  router.get('/school/weekly/:n/:story', (req, res) => {
    const w = getWeeklyContent();
    const issue = /^\d{1,4}$/.test(req.params.n) ? w.issueByNumber.get(Number(req.params.n)) : undefined;
    const story = issue?.storyBySlug.get(req.params.story);
    if (!issue || !story || !story.hasPage) return notFound(res, 'There is no story at that address.');
    return send(res, renderStory(config, issue, story));
  });

  return router;
}
