import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { weeklyDraftEmail, weeklyDraftFailedEmail } from '../email/weekly-draft.js';
import { readCookie, SESSION_COOKIE } from '../auth.js';
import { writeAudit } from '../housekeeping/context.js';
import type { Mailer, MailResult } from '../mailer.js';
import { getWeeklyContent, loadIssueFolder } from '../weekly/content.js';
import {
  approveAndPublish,
  createDraft,
  DraftConflict,
  DraftInvalid,
  DraftStateError,
  getDraft,
  listDrafts,
  replaceDraft,
  sendBack,
  withdraw,
  type DraftRow,
  type DraftUpload,
} from '../weekly/drafts.js';
import { pressBar, PRESS_ROBOTS, PRESS_SCRIPTS, renderPressSignIn, renderPressStatus } from '../weekly/preview.js';
import { renderIssue, renderStory } from '../weekly/render.js';

/**
 * The Beuk Weekly press's drafter API (spec 2026-10-29), used only by the
 * drafter on V's Legion with WEEKLY_DRAFT_TOKEN as a bearer token:
 *
 *   POST /api/weekly/drafts          upload a draft ({ replaces: id } to
 *                                    resubmit a sent-back one); emails
 *                                    the editor the preview link
 *   POST /api/weekly/drafts/failed   "no draft this week, here's why"
 *   GET  /api/weekly/drafts?status=sent_back
 *                                    drafts the editor sent back, with notes
 *   GET  /api/weekly/drafts?status=published
 *                                    published issues and the commit each was
 *                                    written from (newest first): where the
 *                                    next run's "what shipped" starts
 *
 * With no token configured (unset or under 32 characters) every call is
 * refused. Nothing here publishes: only an admin's Approve on the preview
 * page does (src/weekly/preview.ts).
 */

const digest = (s: string) => createHash('sha256').update(s).digest();

export const previewUrl = (config: Config, id: string) => `${config.appBaseUrl}/school/weekly/draft/${id}`;

/** The draft's headlines and sources, read back from its stored folder. */
function draftSummary(config: Config, id: string) {
  const issue = loadIssueFolder(path.join(config.weeklyDir, 'drafts', id), 1);
  const stories = [issue.lead, ...issue.front, ...issue.briefs, ...issue.fold, ...issue.notices];
  return {
    banner: issue.banner,
    headlines: stories.map((s) => (s === issue.lead ? `${s.title} (lead)` : s.title)),
    sources: stories.map((s) => ({ title: s.title, urls: s.sources })),
  };
}

export function weeklyPressApi(db: Db, config: Config, mailer: Mailer): Router {
  const router = Router();

  const requireToken = (req: Request, res: Response, next: NextFunction) => {
    const header = req.get('authorization') ?? '';
    const given = /^Bearer (.+)$/.exec(header)?.[1] ?? '';
    if (!config.weeklyDraftToken || !given || !timingSafeEqual(digest(given), digest(config.weeklyDraftToken))) {
      return res.status(401).json({ error: 'the press token is missing or wrong' });
    }
    return next();
  };
  router.use(requireToken);

  /** What became of the editor's email: sent, not configured (no editor
   *  address, or no SMTP — then the console has it), or failed. */
  const outcome = async (send: (to: string) => Promise<MailResult>): Promise<'sent' | 'not-configured' | 'failed'> => {
    if (!config.weeklyEditorEmail) return 'not-configured';
    try {
      return (await send(config.weeklyEditorEmail)).delivered ? 'sent' : 'not-configured';
    } catch (err) {
      console.error('weekly press: the editor email could not be sent', err);
      return 'failed';
    }
  };

  router.post('/drafts', async (req, res, next) => {
    const body = (req.body ?? {}) as DraftUpload & { replaces?: unknown; noPictures?: unknown };
    const upload: DraftUpload = { sourceCommit: body.sourceCommit, files: body.files, dropped: body.dropped, outlets: body.outlets };
    const noPictures = Array.isArray(body.noPictures) ? body.noPictures.filter((x): x is string => typeof x === 'string') : [];
    try {
      let id: string;
      if (typeof body.replaces === 'string') {
        await replaceDraft(db, config.weeklyDir, body.replaces, upload);
        id = body.replaces;
      } else {
        id = (await createDraft(db, config.weeklyDir, upload)).id;
      }
      const url = previewUrl(config, id);
      const message = weeklyDraftEmail(config, {
        previewUrl: url,
        sourceCommit: upload.sourceCommit,
        dropped: upload.dropped,
        outlets: upload.outlets,
        noPictures,
        ...draftSummary(config, id),
      });
      const email = await outcome((to) =>
        // email-kind: weekly-draft-ready
        mailer.send({ to, ...message }),
      );
      return res.status(201).json({ id, previewUrl: url, email });
    } catch (err) {
      if (err instanceof DraftInvalid) return res.status(400).json({ problems: err.problems });
      if (err instanceof DraftConflict) return res.status(409).json({ error: 'a draft is already waiting', id: err.id, previewUrl: previewUrl(config, err.id) });
      if (err instanceof DraftStateError) return res.status(409).json({ error: err.message });
      return next(err);
    }
  });

  router.post('/drafts/failed', async (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason || reason.length > 2000) return res.status(400).json({ error: 'reason is 1–2000 characters' });
    const message = weeklyDraftFailedEmail(config, reason);
    const email = await outcome((to) =>
      // email-kind: weekly-draft-failed
      mailer.send({ to, ...message }),
    );
    return res.status(202).json({ email });
  });

  router.get('/drafts', async (req, res, next) => {
    const status = req.query.status;
    if (status !== 'sent_back' && status !== 'published') return res.status(400).json({ error: 'status is sent_back or published' });
    try {
      const rows = await listDrafts(db, status);
      if (status === 'published') {
        rows.sort((a, b) => (b.issueNumber ?? 0) - (a.issueNumber ?? 0));
        return res.json(rows.map((r) => ({ id: r.id, issueNumber: r.issueNumber, sourceCommit: r.sourceCommit })));
      }
      return res.json(rows.map((r) => ({ id: r.id, notes: r.notes, sourceCommit: r.sourceCommit })));
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

/* ------------------------- the preview page ------------------------- */

const IMAGE_TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

type Viewer = { kind: 'anonymous' } | { kind: 'user' } | { kind: 'admin'; id: string; email: string };

/** Who is asking: read live from the session on every request, like requireAdmin. */
async function viewer(db: Db, req: Request): Promise<Viewer> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return { kind: 'anonymous' };
  const r = await db.query<{ id: string; email: string; is_admin: boolean }>(
    `select u.id, u.email, u.is_admin from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [createHash('sha256').update(token).digest('hex')],
  );
  const u = r.rows[0];
  if (!u) return { kind: 'anonymous' };
  return u.is_admin ? { kind: 'admin', id: u.id, email: u.email } : { kind: 'user' };
}

/**
 *   GET  /school/weekly/draft/:id              the preview (admin), a sign-in box (signed out), else 404
 *   GET  /school/weekly/draft/:id/:story       one story of the draft (admin)
 *   GET  /school/weekly/draft/:id/img/:file    a picture of the draft (admin)
 *   POST /school/weekly/draft/:id/approve      publish (admin, our Origin)
 *   POST /school/weekly/draft/:id/send-back    { notes } (admin, our Origin)
 *   POST /school/weekly/draft/:id/withdraw     discard (admin, our Origin)
 * Every answer is noindex and no-store. Mounted before the Weekly's own
 * pages, so "draft" is never read as an issue number.
 */
export function weeklyPressPages(db: Db, config: Config): Router {
  const router = Router();
  router.use('/school/weekly/draft', (_req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, nofollow').set('Cache-Control', 'no-store');
    next();
  });
  const notFound = (res: Response) => res.status(404).type('text').send('not found');
  const html = (res: Response, body: string) => res.status(200).type('html').send(body);
  const base = (id: string) => `/school/weekly/draft/${id}`;

  /** The draft and the admin, or a response already sent. */
  const load = async (req: Request, res: Response, signInPage: boolean): Promise<{ d: DraftRow; admin: { id: string; email: string } } | null> => {
    const v = await viewer(db, req);
    if (v.kind === 'anonymous' && signInPage && /^[0-9a-f-]{36}$/i.test(String(req.params.id))) {
      html(res, renderPressSignIn(config, String(req.params.id)));
      return null;
    }
    if (v.kind !== 'admin') {
      notFound(res);
      return null;
    }
    const d = await getDraft(db, String(req.params.id));
    if (!d) {
      notFound(res);
      return null;
    }
    return { d, admin: { id: v.id, email: v.email } };
  };
  const folder = (d: DraftRow) => path.join(config.weeklyDir, 'drafts', d.id);
  const open = (d: DraftRow) => (d.status === 'drafted' || d.status === 'sent_back') && existsSync(path.join(folder(d), 'issue.md'));

  router.get('/school/weekly/draft/:id', async (req, res, next) => {
    try {
      const got = await load(req, res, true);
      if (!got) return;
      const { d } = got;
      if (!open(d)) return html(res, renderPressStatus(config, d));
      const issue = loadIssueFolder(folder(d), 0);
      const page = renderIssue(config, getWeeklyContent(), issue, {
        base: base(d.id),
        preview: pressBar(d),
        robots: PRESS_ROBOTS,
        scripts: PRESS_SCRIPTS,
      });
      return html(res, page);
    } catch (err) {
      return next(err);
    }
  });

  router.get('/school/weekly/draft/:id/img/:file', async (req, res, next) => {
    try {
      const got = await load(req, res, false);
      if (!got) return;
      const file = req.params.file;
      const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
      if (!open(got.d) || !type || !/^[a-z0-9][a-z0-9._-]*$/i.test(file)) return notFound(res);
      const full = path.join(folder(got.d), file);
      if (!existsSync(full)) return notFound(res);
      res.type(type);
      return res.sendFile(full);
    } catch (err) {
      return next(err);
    }
  });

  router.get('/school/weekly/draft/:id/:story', async (req, res, next) => {
    try {
      const got = await load(req, res, false);
      if (!got) return;
      if (!open(got.d)) return notFound(res);
      const issue = loadIssueFolder(folder(got.d), 0);
      const story = issue.storyBySlug.get(req.params.story);
      if (!story || !story.hasPage) return notFound(res);
      return html(res, renderStory(config, issue, story, { base: base(got.d.id), preview: pressBar(got.d), robots: PRESS_ROBOTS, scripts: PRESS_SCRIPTS }));
    } catch (err) {
      return next(err);
    }
  });

  /** Admin + our own Origin, or a response already sent. */
  const guard = async (req: Request, res: Response) => {
    const v = await viewer(db, req);
    if (v.kind !== 'admin') {
      res.status(404).json({ error: 'not found' });
      return null;
    }
    if (req.get('origin') !== config.appBaseUrl) {
      res.status(403).json({ error: 'this action must come from the preview page' });
      return null;
    }
    return v;
  };
  const audit = (admin: { id: string; email: string }, action: string, id: string, result: string, params: Record<string, unknown> = {}) =>
    writeAudit(db, { actorId: admin.id, actorEmail: admin.email, action, params: { draft: id, ...params }, result });

  const act = (name: string, run: (id: string, admin: { id: string; email: string }, body: Record<string, unknown>) => Promise<unknown>) =>
    router.post(`/school/weekly/draft/:id/${name}`, async (req, res, next) => {
      try {
        const admin = await guard(req, res);
        if (!admin) return;
        const id = String(req.params.id);
        if (!(await getDraft(db, id))) return res.status(404).json({ error: 'not found' });
        try {
          const out = await run(id, admin, (req.body ?? {}) as Record<string, unknown>);
          return res.json(out ?? { ok: true });
        } catch (err) {
          if (err instanceof DraftStateError) {
            const bad = name === 'send-back' && /notes are/.test(err.message);
            return res.status(bad ? 400 : 409).json({ error: err.message });
          }
          throw err;
        }
      } catch (err) {
        return next(err);
      }
    });

  act('approve', async (id, admin) => {
    const r = await approveAndPublish(db, config.weeklyDir, id, admin.id, new Date());
    await audit(admin, 'weekly.approve', id, 'published', { number: r.number, week: r.week });
    return { url: `/school/weekly/${r.number}` };
  });
  act('send-back', async (id, admin, body) => {
    await sendBack(db, id, typeof body.notes === 'string' ? body.notes : '');
    await audit(admin, 'weekly.send-back', id, 'sent_back');
  });
  act('withdraw', async (id, admin) => {
    await withdraw(db, config.weeklyDir, id);
    await audit(admin, 'weekly.withdraw', id, 'withdrawn');
  });

  return router;
}
