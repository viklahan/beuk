import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { ArcError, campaignForManuscript, createCampaign, parseCreateInput, signupUrl, type ArcDeps } from '../arc/campaigns.js';
import { arcMailStatus } from '../arc/mail.js';
import { isUuid } from '../ids.js';
import { sendEpubError } from './epub.js';

/**
 * ARC campaigns, the owner surface (signed in, /api/arc — every query
 * owner-scoped by the session's user id, never the request; another
 * writer's book answers as if it had no campaign, so existence is not
 * leaked, as src/routes/shares.ts does):
 *   GET  /api/arc?manuscriptId=   { mail: arcMailStatus, campaign | null }
 *   POST /api/arc                 start a campaign → 201 { campaign, signupToken, signupUrl }
 *                                 (the token ONCE; only its hash is stored)
 * POST is gated as shares.create (src/access.ts); GET is never paused.
 */
export function arcOwnerRoutes(deps: ArcDeps): Router {
  const router = Router();
  router.use(requireAuth(deps.db));

  router.get('/', async (req, res, next) => {
    try {
      const mid = typeof req.query.manuscriptId === 'string' ? req.query.manuscriptId : '';
      if (!isUuid(mid)) return res.status(400).json({ error: 'manuscriptId is required: the book to show the campaign of' });
      const campaign = await campaignForManuscript(deps, req.user!.id, mid);
      return res.json({ mail: arcMailStatus(deps.config), campaign });
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

  return router;
}
