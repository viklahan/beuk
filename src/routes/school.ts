import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../auth.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { getSchoolContent } from '../school/content.js';
import { listProgress, setLessonDone } from '../school/progress.js';
import { renderCourse, renderLesson, renderSchoolHome, renderSchoolNotFound, type SchoolCtx } from '../school/render.js';

/**
 * Beuk School (V, 2026-10-28: free, at beuk.studio/school, English first).
 *
 * Pages (Caddy proxies /school* to the app, except /school/media/*, which
 * it serves itself from SCHOOL_MEDIA_DIR):
 *   GET /school                     home: every course
 *   GET /school/<course>            one course and its lessons
 *   GET /school/<course>/<lesson>   one lesson: Watch / Listen / Read
 * API (signed in only — an anonymous visitor's progress is never kept):
 *   GET  /api/school/progress       { done: [{ course, lesson, completedAt }] }
 *   POST /api/school/progress       { course, lesson, done } → { done: [...] }
 */
export function schoolRoutes(db: Db, config: Config): { pages: Router; api: Router } {
  const pages = Router();
  const api = Router();
  const ctx = (): SchoolCtx => ({ config, content: getSchoolContent() });
  const send = (res: Response, html: string, status = 200) => {
    res.status(status).type('html').set('Cache-Control', 'no-cache').send(html);
  };

  // Express routing is not strict, so /school/ lands here too: send it to the one address.
  pages.get('/school', (req, res) => (req.path.endsWith('/') ? res.redirect(301, '/school') : send(res, renderSchoolHome(ctx()))));
  pages.get('/school/:course', (req, res, next) => {
    if (!/^[a-z0-9-]+$/.test(req.params.course)) return next();
    const c = ctx();
    const course = c.content.courseBySlug.get(req.params.course);
    if (!course) return send(res, renderSchoolNotFound(c, 'There is no course at that address.'), 404);
    return send(res, renderCourse(c, course));
  });
  pages.get('/school/:course/:lesson', (req, res, next) => {
    if (!/^[a-z0-9-]+$/.test(req.params.course) || !/^[a-z0-9-]+$/.test(req.params.lesson)) return next();
    const c = ctx();
    const course = c.content.courseBySlug.get(req.params.course);
    const lesson = course?.lessonBySlug.get(req.params.lesson);
    if (!course || !lesson) return send(res, renderSchoolNotFound(c, 'There is no lesson at that address.'), 404);
    return send(res, renderLesson(c, course, lesson));
  });

  api.use(requireAuth(db));
  const wrap =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      fn(req, res).catch(next);
    };
  api.get(
    '/progress',
    wrap(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      return res.json({ done: await listProgress(db, req.user!.id) });
    }),
  );
  api.post(
    '/progress',
    wrap(async (req, res) => {
      const body = (req.body ?? {}) as { course?: unknown; lesson?: unknown; done?: unknown };
      if (typeof body.course !== 'string' || typeof body.lesson !== 'string' || typeof body.done !== 'boolean') {
        return res.status(400).json({ error: 'course, lesson and done (true or false) are required' });
      }
      const course = getSchoolContent().courseBySlug.get(body.course);
      if (!course || !course.lessonBySlug.has(body.lesson)) {
        return res.status(404).json({ error: 'there is no such lesson' });
      }
      await setLessonDone(db, req.user!.id, body.course, body.lesson, body.done);
      res.set('Cache-Control', 'no-store');
      return res.json({ done: await listProgress(db, req.user!.id) });
    }),
  );

  return { pages, api };
}
