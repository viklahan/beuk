import { randomBytes } from 'node:crypto';
import express, { Router, type ErrorRequestHandler, type NextFunction, type Request, type Response } from 'express';
import type { ArcDeps } from '../arc/campaigns.js';
import { campaignState } from '../arc/campaigns.js';
import { loadSignup, rowByRef, SIGNUP_TOKEN_RE, startClaim, verifyClaim, type ArcPublicLimits, type SignupView, type StartOutcome } from '../arc/claims.js';
import {
  renderBadFormPage,
  renderClaimPage,
  renderClosedPage,
  renderCodePage,
  renderCopyGonePage,
  renderCopyPage,
  renderMailActionPage,
  renderMailDonePage,
  renderMailGonePage,
  renderMailUnavailablePage,
  renderUnknownPage,
  renderWaitingPage,
  type ClaimRefusal,
  type ClaimValues,
  type CodeRefusal,
  type CopyRefusal,
  type MailAction,
} from '../arc/pages.js';
import {
  arcOptOutReady,
  formFields,
  notMe,
  readBuildEpub,
  readerByMailToken,
  recordDownload,
  resolveReader,
  stopMail,
  type MailReader,
  type ReaderView,
} from '../arc/readers.js';
import { StampError, stampEpub } from '../arc/stamp.js';
import { BuildBusyError, type BuildQueue } from '../book/studio/queue.js';
import { SlidingWindowLimiter } from '../rate-limit.js';
import { imageHeaders, readerHeaders } from '../shares/reader.js';
import { attachmentDisposition } from './epub.js';

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
 * and, registered first (Task 7):
 *   GET  /arc/r/:token         a claimed reader's copy page (404 unknown,
 *                              410 closed)
 *   GET  /arc/r/:token/epub    their stamped EPUB (stamped per download,
 *                              never stored; 429 / 503 / 500 pages)
 *   HEAD /arc/r/:token/epub    the download's headers only: nothing stamped,
 *                              counted or recorded (ruling C7)
 *   GET  /arc/m/:mailToken/:action   Not me (not-me) or Stop (stop): a page
 *                              with one POST button; nothing changes
 *   POST /arc/m/:mailToken/:action   the button, or for Stop only an RFC 8058
 *                              one-click (C7: the one-click header is the
 *                              Stop link) → the done page; unknown or used → 404
 * A signup token is 20-64 base64url characters (SIGNUP_TOKEN_RE), and the
 * reader routes are registered before the /:signup routes, so /arc/r/… and
 * /arc/m/… never reach them. Claimed readers also read through
 * /read/:token (ruling R4a: the copy page links there, and nothing here
 * opens the reader by any other check). Forms are urlencoded, 8 KB at
 * most (the mail POST also takes multipart, F22); a body the parser
 * refuses (too long, too many fields) gets the calm unreadable-form page
 * with its status, from this router's own error handler (C7). Once
 * sign-ups close, the claim page is the closed page with a lost-link form:
 * a reader who holds a copy can still get its link again (copies keep
 * working after a close; final review minor 1). Nothing here is paused
 * for a paused author (src/access.ts NEVER_PAUSED).
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
  /** The stamped-download queue (ruling F12): one download per reader at a
   *  time (key = reader id); app.ts makes it, BuildQueue(2, 8). */
  downloads: BuildQueue,
): Router {
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
  const closed = (res: Response, view: SignupView, extra: { values?: ClaimValues; error?: ClaimRefusal } = {}) =>
    sendPage(res, 410, (nonce) => renderClosedPage(view, { nonce, signup: view.signupToken, ...extra }));

  const claimPage = (res: Response, status: number, view: SignupView, token: string, extra: { values?: ClaimValues; error?: ClaimRefusal } = {}) =>
    sendPage(res, status, (nonce) => renderClaimPage(view, { nonce, signup: token, ...extra }));

  /* ---------------- Task 7: the reader's copy and the mail links ---------------- */

  const downloadsPerReader = new SlidingWindowLimiter(limits.downloadsPerReader.max, limits.downloadsPerReader.windowMs, clock);
  const multipart = express.raw({ type: 'multipart/form-data', limit: '8kb' });

  /** The reader behind a copy token: the 404 page sent when none, the 410
   *  page when the copy is closed; else the reader. */
  const copyReader = async (req: Request, res: Response): Promise<ReaderView | null> => {
    const reader = await resolveReader(deps.db, req.params.token, deps.now());
    if (!reader) {
      sendPage(res, 404, (nonce) => renderUnknownPage({ nonce }));
      return null;
    }
    if (reader.status !== 'active') {
      sendPage(res, 410, (nonce) => renderCopyGonePage(reader, { nonce }));
      return null;
    }
    return reader;
  };

  router.get('/r/:token', async (req, res, next) => {
    try {
      const reader = await copyReader(req, res);
      if (!reader) return;
      return sendPage(res, 200, (nonce) => renderCopyPage(reader, { nonce, token: req.params.token }));
    } catch (err) {
      return next(err);
    }
  });

  /*
   * HEAD on the download (ruling C7): what a GET would answer, headers
   * only — 404 / 410 when the copy is unknown or closed, else 200 with the
   * download's headers. Nothing is stamped, counted against the limit or
   * recorded: a mail scanner or a download manager's probe is not a
   * download. (Express would otherwise run the GET handler for a HEAD.)
   */
  router.head('/r/:token/epub', async (req, res, next) => {
    try {
      const reader = await resolveReader(deps.db, req.params.token, deps.now());
      if (!reader) return res.status(404).set(readerHeaders(randomBytes(16).toString('base64'))).end();
      if (reader.status !== 'active') return res.status(410).set(readerHeaders(randomBytes(16).toString('base64'))).end();
      const build = await deps.db.query<{ epub_filename: string }>('select epub_filename from arc_builds where id = $1', [reader.buildId || null]);
      res.set(downloadHeaders(build.rows[0]?.epub_filename ?? 'book-arc.epub'));
      return res.status(200).end();
    } catch (err) {
      return next(err);
    }
  });

  /*
   * The stamped download. In order: the reader (404 / 410, no bytes); the
   * per-reader limit (downloadsPerReader, 10 an hour → 429 with
   * Retry-After); the download queue, one run per reader (ruling F20: a
   * second download while one runs → 429, Retry-After 10; every place
   * taken → 503, Retry-After 30); inside it the build is read and stamped
   * for this reader (stampEpub; never stored); a failure is logged and
   * answered with the calm 500 page. Only a download that is sent is
   * counted against the limit and recorded ('downloaded'). When recording
   * it fails (the database), the failure is logged and the stamped file
   * still goes: the reader did nothing wrong, and the download did happen,
   * so its slot stays counted (final review minor 3).
   */
  router.get('/r/:token/epub', async (req, res, next) => {
    try {
      const reader = await copyReader(req, res);
      if (!reader) return;
      const copyPage = (code: number, error: CopyRefusal) =>
        sendPage(res, code, (nonce) => renderCopyPage(reader, { nonce, token: req.params.token, error }));
      const slot = downloadsPerReader.reserve(reader.readerId);
      if (slot === null) {
        res.set('Retry-After', String(downloadsPerReader.retryAfterSeconds(reader.readerId)));
        return copyPage(429, 'limit');
      }
      const giveBack = () => downloadsPerReader.release(reader.readerId, slot);
      const gone = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) gone.abort();
      });
      let out: { bytes: Buffer; filename: string };
      try {
        out = await downloads.run(reader.readerId, gone.signal, async () => {
          const build = await readBuildEpub(deps.db, reader.buildId);
          if (!build) throw new Error(`arc: the build of campaign ${reader.campaignId} is missing`);
          const bytes = await stampEpub(build.bytes, { name: reader.name, email: reader.email, publicId: reader.publicId, lang: reader.lang });
          return { bytes, filename: build.filename };
        });
      } catch (err) {
        giveBack();
        if (err instanceof BuildBusyError) {
          if (err.reason === 'aborted') {
            if (!res.headersSent) res.status(499).end();
            return;
          }
          res.set('Retry-After', err.reason === 'queue-full' ? '30' : '10');
          return copyPage(err.reason === 'queue-full' ? 503 : 429, err.reason === 'queue-full' ? 'server-busy' : 'busy');
        }
        // Logged without the reader's name or address.
        console.error(`arc: the copy for campaign ${reader.campaignId} could not be stamped:`, err instanceof StampError ? err.message : err);
        return copyPage(500, 'failed');
      }
      try {
        await recordDownload(deps.db, reader, deps.now());
      } catch (err) {
        // Logged without the reader's name or address.
        console.error(`arc: a download for campaign ${reader.campaignId} was sent but could not be recorded:`, err);
      }
      res.set(downloadHeaders(out.filename));
      return res.status(200).send(out.bytes);
    } catch (err) {
      return next(err);
    }
  });

  const MAIL_ACTIONS: readonly MailAction[] = ['not-me', 'stop'];
  const mailGone = (res: Response) => sendPage(res, 404, (nonce) => renderMailGonePage({ nonce }));

  /** The action in the path and the reader its token names: the 404 page
   *  sent when either is unknown (a used Not me link is unknown). */
  const mailReader = async (req: Request, res: Response): Promise<{ action: MailAction; reader: MailReader } | null> => {
    const action = req.params.action as MailAction;
    const reader = MAIL_ACTIONS.includes(action) ? await readerByMailToken(deps.db, req.params.mailToken) : null;
    if (!reader) {
      mailGone(res);
      return null;
    }
    return { action, reader };
  };

  // A GET never acts: the page with one POST button.
  router.get('/m/:mailToken/:action', async (req, res, next) => {
    try {
      const found = await mailReader(req, res);
      if (!found) return;
      return sendPage(res, 200, (nonce) => renderMailActionPage(found.reader, { nonce, mailToken: req.params.mailToken, action: found.action }));
    } catch (err) {
      return next(err);
    }
  });

  /*
   * The button, or a one-click unsubscribe (RFC 8058 §3.2: the body is
   * 'List-Unsubscribe=One-Click', SHOULD multipart/form-data, MAY
   * urlencoded; ruling F22: both are read). A POST that is neither changes
   * nothing (400, the button page again). Without a usable
   * ARC_SUPPRESSION_SALT the opt-out cannot be kept, so nothing changes
   * (503).
   */
  router.post('/m/:mailToken/:action', form, multipart, async (req, res, next) => {
    try {
      const found = await mailReader(req, res);
      if (!found) return;
      const { action, reader } = found;
      const fields = req.is('application/x-www-form-urlencoded') || req.is('multipart/form-data') ? formFields(req.body, req.get('content-type')) : {};
      // The page's button for either; a one-click unsubscribe only for Stop, the one
      // link List-Unsubscribe names (C7): Not me deletes the reader, so it needs the button.
      const pressed = fields.confirm === '1' || (action === 'stop' && fields['List-Unsubscribe'] === 'One-Click');
      if (!pressed) return sendPage(res, 400, (nonce) => renderMailActionPage(reader, { nonce, mailToken: req.params.mailToken, action }));
      if (!arcOptOutReady(deps.config)) return sendPage(res, 503, (nonce) => renderMailUnavailablePage(reader, { nonce, action }));
      const done = action === 'not-me' ? await notMe(deps, req.params.mailToken) : await stopMail(deps, req.params.mailToken);
      // Used in between (a second Not me at the same moment): the 404 page.
      if (!done) return mailGone(res);
      // Stop leaves the copy as it was; reader.copyOpen was read just before.
      return sendPage(res, 200, (nonce) => renderMailDonePage(reader, { nonce, action }));
    } catch (err) {
      return next(err);
    }
  });

  /* ---------------- Task 6: the claim page ---------------- */

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
      const body = (req.body ?? {}) as Record<string, unknown>;
      const values = { name: str(body.name).slice(0, 200), email: str(body.email).slice(0, 300), profile: str(body.profile).slice(0, 400) };
      // Sign-ups closed: the request goes on only as a lost-link request (startClaim
      // refuses it as 'closed' unless the address holds an open copy).
      const open = isOpen(view);
      const refused = (status: number, error: ClaimRefusal) =>
        open ? claimPage(res, status, view, token, { values, error }) : closed(res, view, { values, error });
      if (claimPerIp.reserve(ip(req)) === null) return refused(429, 'busy');
      const out = await startClaim(
        deps,
        view,
        { name: body.name, email: body.email, profile: body.profile, tz: body.tz, website: body.website },
        codesPerAddress,
      );
      if (out.kind === 'sent') return res.redirect(303, `/arc/${token}/check?r=${encodeURIComponent(out.ref)}`);
      if (out.reason === 'closed') return closed(res, view, { values });
      return refused(START_STATUS[out.reason], out.reason);
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:signup/check', async (req, res, next) => {
    try {
      const view = await signup(req, res);
      if (!view) return;
      const ref = str(req.query.r);
      const row = await rowByRef(deps.db, view, ref);
      // Sign-ups closed: the code page only for a code that was sent (a lost-link request).
      if (!isOpen(view) && !row) return closed(res, view);
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

  /*
   * This router's own error handler (ruling C7): a body the form parsers
   * refuse — longer than 8 KB (413), too many fields (413), a bad charset
   * (415), a body that cannot be parsed (400) — gets the calm unreadable-
   * form page with that status, never the app's generic error. Anything
   * else goes on to the app's handler.
   */
  const formError: ErrorRequestHandler = (err, _req, res, next) => {
    const e = err as { type?: unknown; status?: unknown; expose?: unknown } | null;
    const status = typeof e?.status === 'number' ? e.status : 0;
    if (typeof e?.type !== 'string' || e.expose !== true || status < 400 || status > 499 || res.headersSent) return next(err);
    return sendPage(res, status, (nonce) => renderBadFormPage({ nonce }));
  };
  router.use(formError);

  return router;
}

/** The headers of a stamped download (GET) and of its HEAD. */
function downloadHeaders(filename: string): Record<string, string> {
  return {
    'Content-Type': 'application/epub+zip',
    'Content-Disposition': attachmentDisposition(filename, 'book-arc.epub'),
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
  };
}
