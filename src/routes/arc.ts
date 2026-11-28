import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../auth.js';
import {
  approveReader,
  ArcError,
  campaignsForManuscript,
  campaignJson,
  closeCampaign,
  createCampaign,
  declineReader,
  deleteCampaign,
  listReaders,
  loadOwnedCampaign,
  parseCreateInput,
  parseUpdateInput,
  revokeReader,
  rotateSignup,
  signupUrl,
  updateCampaign,
  type ArcDeps,
  type CampaignRow,
} from '../arc/campaigns.js';
import { arcMailStatus } from '../arc/mail.js';
import { isUuid, uuidParam } from '../ids.js';
import { sendEpubError } from './epub.js';

/**
 * ARC campaigns, the owner surface (signed in, /api/arc — every query
 * owner-scoped by the session's user id, never the request; another
 * writer's book or campaign answers as if it did not exist (404), so
 * existence is not leaked, as src/routes/shares.ts does):
 *   GET    /api/arc?manuscriptId=   { mail: arcMailStatus, campaign | null, campaigns, signupUrl | null }
 *                                   campaigns: every one of the book's campaigns, the one not
 *                                   ended first (ruling P8); campaign: campaigns[0] ?? null;
 *                                   signupUrl: the not-ended one's link (derived again, never
 *                                   stored: final review Important 3), else null
 *   POST   /api/arc                 start a campaign → 201 { campaign, signupToken, signupUrl }
 *   GET    /api/arc/:id/readers     { readers } (waiting, claimed, declined; oldest first)
 *   POST   /api/arc/:id/readers/:rid/approve   { reader, mail } — 503/429 { error, mail } when the email can't go
 *   POST   /api/arc/:id/readers/:rid/decline   { reader, mail }
 *   POST   /api/arc/:id/readers/:rid/revoke    { reader } ("Close this copy")
 *   POST   /api/arc/:id/close       { campaign } (copies already given keep working)
 *   PUT    /api/arc/:id             { maxClaims?, closesAt? } → { campaign }
 *   POST   /api/arc/:id/signup-link { signupToken, signupUrl } (the old link dies; 409 once ended)
 *   DELETE /api/arc/:id             204
 * POST /api/arc is gated as shares.create (src/access.ts); every other route
 * is never paused: a running campaign keeps delivering.
 */
export function arcOwnerRoutes(deps: ArcDeps): Router {
  const router = Router();
  router.use(requireAuth(deps.db));
  router.param('id', uuidParam('campaign not found'));
  router.param('rid', uuidParam('reader not found'));

  const fail = (res: Response, next: NextFunction, err: unknown) => {
    if (err instanceof ArcError) return res.status(err.status).json({ error: err.message, ...err.extra });
    return next(err);
  };

  /** The campaign in the path, if it is this writer's; else 404 sent. */
  const owned = async (req: Request, res: Response): Promise<CampaignRow | null> => {
    const c = await loadOwnedCampaign(deps.db, req.user!.id, req.params.id);
    if (!c) res.status(404).json({ error: 'campaign not found' });
    return c;
  };

  router.get('/', async (req, res, next) => {
    try {
      const mid = typeof req.query.manuscriptId === 'string' ? req.query.manuscriptId : '';
      if (!isUuid(mid)) return res.status(400).json({ error: 'manuscriptId is required: the book to show the campaign of' });
      const { campaigns, signupUrl: link } = await campaignsForManuscript(deps, req.user!.id, mid);
      return res.json({ mail: arcMailStatus(deps.config), campaign: campaigns[0] ?? null, campaigns, signupUrl: link });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const input = parseCreateInput(req.body, deps.now());
      if (input instanceof ArcError) return res.status(input.status).json({ error: input.message, ...input.extra });
      /* A writer who goes away while the EPUB waits leaves the line (as POST /api/epub). */
      const gone = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) gone.abort();
      });
      const { campaign, signupToken } = await createCampaign(deps, req.user!.id, input, gone.signal);
      return res.status(201).json({ campaign, signupToken, signupUrl: signupUrl(deps.config, signupToken) });
    } catch (err) {
      if (err instanceof ArcError) return res.status(err.status).json({ error: err.message, ...err.extra });
      if (sendEpubError(res, err)) return;
      return next(err);
    }
  });

  router.get('/:id/readers', async (req, res, next) => {
    try {
      const c = await owned(req, res);
      if (!c) return;
      return res.json({ readers: await listReaders(deps.db, c) });
    } catch (err) {
      return fail(res, next, err);
    }
  });

  router.post('/:id/readers/:rid/approve', async (req, res, next) => {
    try {
      const c = await owned(req, res);
      if (!c) return;
      return res.json(await approveReader(deps, c, req.params.rid));
    } catch (err) {
      return fail(res, next, err);
    }
  });

  router.post('/:id/readers/:rid/decline', async (req, res, next) => {
    try {
      const c = await owned(req, res);
      if (!c) return;
      return res.json(await declineReader(deps, c, req.params.rid));
    } catch (err) {
      return fail(res, next, err);
    }
  });

  router.post('/:id/readers/:rid/revoke', async (req, res, next) => {
    try {
      const c = await owned(req, res);
      if (!c) return;
      return res.json({ reader: await revokeReader(deps.db, c, req.params.rid, deps.now()) });
    } catch (err) {
      return fail(res, next, err);
    }
  });

  router.post('/:id/close', async (req, res, next) => {
    try {
      const c = await owned(req, res);
      if (!c) return;
      const now = deps.now();
      const closed = await closeCampaign(deps.db, c, now);
      return res.json({ campaign: await campaignJson(deps.db, closed, now) });
    } catch (err) {
      return fail(res, next, err);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const c = await owned(req, res);
      if (!c) return;
      const now = deps.now();
      const patch = parseUpdateInput(req.body, now);
      if (patch instanceof ArcError) return res.status(patch.status).json({ error: patch.message, ...patch.extra });
      const changed = await updateCampaign(deps.db, c, patch, now);
      return res.json({ campaign: await campaignJson(deps.db, changed, now) });
    } catch (err) {
      return fail(res, next, err);
    }
  });

  router.post('/:id/signup-link', async (req, res, next) => {
    try {
      const c = await owned(req, res);
      if (!c) return;
      const signupToken = await rotateSignup(deps.db, deps.config, c);
      return res.json({ signupToken, signupUrl: signupUrl(deps.config, signupToken) });
    } catch (err) {
      return fail(res, next, err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const c = await owned(req, res);
      if (!c) return;
      await deleteCampaign(deps.db, c);
      return res.status(204).end();
    } catch (err) {
      return fail(res, next, err);
    }
  });

  return router;
}
