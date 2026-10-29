import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { weeklyDraftEmail, weeklyDraftFailedEmail } from '../email/weekly-draft.js';
import type { Mailer, MailResult } from '../mailer.js';
import { loadIssueFolder } from '../weekly/content.js';
import { createDraft, DraftConflict, DraftInvalid, DraftStateError, listDrafts, replaceDraft, type DraftUpload } from '../weekly/drafts.js';

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
    if (req.query.status !== 'sent_back') return res.status(400).json({ error: 'only status=sent_back is listed' });
    try {
      const rows = await listDrafts(db, 'sent_back');
      return res.json(rows.map((r) => ({ id: r.id, notes: r.notes, sourceCommit: r.sourceCommit })));
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
