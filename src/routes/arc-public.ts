import { randomBytes } from 'node:crypto';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { ArcDeps } from '../arc/campaigns.js';
import { campaignState } from '../arc/campaigns.js';
import { loadSignup, rowByRef, SIGNUP_TOKEN_RE, startClaim, verifyClaim, type ArcPublicLimits, type SignupView, type StartOutcome } from '../arc/claims.js';
import {
  renderClaimPage,
  renderClosedPage,
  renderCodePage,
  renderUnknownPage,
  renderWaitingPage,
  type ClaimRefusal,
  type ClaimValues,
  type CodeRefusal,
} from '../arc/pages.js';
import type { BuildQueue } from '../book/studio/queue.js';
import { SlidingWindowLimiter } from '../rate-limit.js';
import { imageHeaders, readerHeaders } from '../shares/reader.js';

/**
 * ARC campaigns, the public surface (no account, /arc — Caddy proxies
 * /arc and /arc/* to the app). Every page is sent with readerHeaders
 * (noindex, nofollow; a nonce'd CSP with default-src 'none'; no-referrer;
 * no-store):
 *   GET  /arc/:signup          the claim page (404 unknown, 410 closed or ended)
 *   POST /arc/:signup          start a claim → 303 /arc/:signup/check?r=<ref>,
 *                              or the claim page again with the reason
 *                              (400 / 409 / 410 / 429 / 503)
 *   GET  /arc/:signup/check    the code page (?r=<ref>)
 *   POST /arc/:signup/check    the code → instant: 303 /arc/r/<token> (the
 *                              copy page, Task 7); approval: 200 the waiting
 *                              page; refused: the code page with the reason
 *   GET  /arc/:signup/cover    the build's cover picture
 * A signup token is 20-64 base64url characters (SIGNUP_TOKEN_RE), so the
 * reader routes Task 7 registers first (/arc/r/…, /arc/m/…) never collide.
 * Claimed readers read through /read/:token (ruling R4a); nothing here
 * serves the book. Forms are urlencoded, 8 KB at most. Nothing here is
 * paused for a paused author (src/access.ts NEVER_PAUSED).
 */

const START_STATUS: Record<Extract<StartOutcome, { kind: 'refused' }>['reason'], number> = {
  'bad-name': 400,
  'bad-email': 400,
  'bad-profile': 400,
  closed: 410,
  full: 409,
  blocked: 409,
  answered: 409,
  busy: 429,
  'mail-off': 503,
  'mail-failed': 503,
  'signups-busy': 503,
};

const CODE_STATUS: Record<CodeRefusal, number> = {
  wrong: 400,
  expired: 410,
  unknown: 404,
  closed: 410,
  full: 409,
  answered: 409,
  busy: 429,
};

export function arcPublicRoutes(
  deps: ArcDeps,
  limits: ArcPublicLimits,
  /** The stamped-download queue (Task 7 uses it; declared here, ruling F12). */
  downloads: BuildQueue,
): Router {
  void downloads;
  const router = Router();
  const clock = () => deps.now().getTime();
  const claimPerIp = new SlidingWindowLimiter(limits.claimPerIp.max, limits.claimPerIp.windowMs, clock);
  const checkPerIp = new SlidingWindowLimiter(limits.checkPerIp.max, limits.checkPerIp.windowMs, clock);
  const codesPerAddress = new SlidingWindowLimiter(limits.codesPerAddress.max, limits.codesPerAddress.windowMs, clock);
  const form = express.urlencoded({ extended: false, limit: '8kb' });

  const sendPage = (res: Response, code: number, render: (nonce: string) => string) => {
    const nonce = randomBytes(16).toString('base64');
    res.status(code).set(readerHeaders(nonce)).type('html').send(render(nonce));
  };
  const ip = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const str = (v: unknown) => (typeof v === 'string' ? v : '');

  /** The campaign in the path, or the 404 page sent. */
  const signup = async (req: Request, res: Response): Promise<SignupView | null> => {
    const token = req.params.signup;
    const view = SIGNUP_TOKEN_RE.test(token) ? await loadSignup(deps.db, token) : null;
    if (!view) sendPage(res, 404, (nonce) => renderUnknownPage({ nonce }));
    return view;
  };
  const isOpen = (view: SignupView) => campaignState(view.campaign, deps.now()) === 'open';
  const closed = (res: Response, view: SignupView) => sendPage(res, 410, (nonce) => renderClosedPage(view, { nonce }));

  const claimPage = (res: Response, status: number, view: SignupView, token: string, extra: { values?: ClaimValues; error?: ClaimRefusal } = {}) =>
    sendPage(res, status, (nonce) => renderClaimPage(view, { nonce, signup: token, ...extra }));

  router.get('/:signup', async (req, res, next) => {
    try {
      const view = await signup(req, res);
      if (!view) return;
      if (!isOpen(view)) return closed(res, view);
      return claimPage(res, 200, view, req.params.signup);
    } catch (err) {
      return next(err);
    }
  });

  router.post('/:signup', form, async (req, res, next) => {
    try {
      const view = await signup(req, res);
      if (!view) return;
      const token = req.params.signup;
      if (!isOpen(view)) return closed(res, view);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const values = { name: str(body.name).slice(0, 200), email: str(body.email).slice(0, 300), profile: str(body.profile).slice(0, 400) };
      if (claimPerIp.reserve(ip(req)) === null) return claimPage(res, 429, view, token, { values, error: 'busy' });
      const out = await startClaim(
        deps,
        view,
        { name: body.name, email: body.email, profile: body.profile, tz: body.tz, website: body.website },
        codesPerAddress,
      );
      if (out.kind === 'sent') return res.redirect(303, `/arc/${token}/check?r=${encodeURIComponent(out.ref)}`);
      if (out.reason === 'closed') return closed(res, view);
      return claimPage(res, START_STATUS[out.reason], view, token, { values, error: out.reason });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:signup/check', async (req, res, next) => {
    try {
      const view = await signup(req, res);
      if (!view) return;
      if (!isOpen(view)) return closed(res, view);
      const ref = str(req.query.r);
      const row = await rowByRef(deps.db, view, ref);
      return sendPage(res, 200, (nonce) => renderCodePage(view, { nonce, signup: req.params.signup, ref, email: row?.email ?? null }));
    } catch (err) {
      return next(err);
    }
  });

  router.post('/:signup/check', form, async (req, res, next) => {
    try {
      const view = await signup(req, res);
      if (!view) return;
      const token = req.params.signup;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const ref = str(body.r);
      const codePage = async (status: number, error: CodeRefusal) => {
        const row = await rowByRef(deps.db, view, ref);
        return sendPage(res, status, (nonce) => renderCodePage(view, { nonce, signup: token, ref, email: row?.email ?? null, error }));
      };
      if (checkPerIp.reserve(ip(req)) === null) return codePage(429, 'busy');
      const out = await verifyClaim(deps, view, ref, body.code);
      if (out.kind === 'claimed') return res.redirect(303, `/arc/r/${out.token}`);
      if (out.kind === 'pending') return sendPage(res, 200, (nonce) => renderWaitingPage(view, { nonce, name: out.name }));
      if (out.reason === 'closed') return closed(res, view);
      return codePage(CODE_STATUS[out.reason], out.reason);
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:signup/cover', async (req, res, next: NextFunction) => {
    try {
      const token = req.params.signup;
      const view = SIGNUP_TOKEN_RE.test(token) ? await loadSignup(deps.db, token) : null;
      if (!view || !view.hasCover) return res.status(404).end();
      const r = await deps.db.query<{ cover: { mediaType: string; data: string } | null }>(
        'select cover from arc_builds where campaign_id = $1 order by version_no desc limit 1',
        [view.campaign.id],
      );
      const cover = r.rows[0]?.cover;
      if (!cover || !/^image\/(jpeg|png|gif|webp)$/.test(cover.mediaType)) return res.status(404).end();
      res.set(imageHeaders(cover.mediaType));
      return res.send(Buffer.from(cover.data, 'base64'));
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
