import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { accessGate, ACCESS_RULES } from './access.js';
import { StripeBillingProvider, type BillingProvider } from './billing.js';
import { TrialReminders } from './trial-mail.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import {
  createHousekeepingContext,
  type HousekeepingDeps,
} from './housekeeping/context.js';
import { createMailer, type Mailer } from './mailer.js';
import { createArcMailer } from './arc/mail.js';
import { accountRoutes, BackgroundTasks, type AccountLimits } from './routes/account.js';
import { authRoutes, signInLimitHandle } from './routes/auth.js';
import { accountPortalRoutes, signupConfirmationHook, type PortalLimits } from './routes/account-portal.js';
import { studioRoutes } from './routes/studio.js';
import { billingRoutes } from './routes/billing.js';
import { cspReportRoutes, type CspReportOptions } from './routes/csp-report.js';
import { exportRoutes } from './routes/exports.js';
import { foundersRoutes } from './routes/founders.js';
import { helpRoutes, type HelpSearchLimits } from './routes/help.js';
import { housekeepingRoutes } from './routes/housekeeping.js';
import { BackupScheduler } from './housekeeping/offsite.js';
import { jobRoutes } from './routes/jobs.js';
import { manuscriptRoutes } from './routes/manuscripts.js';
import { seriesCovenantRoutes } from './routes/series-covenants.js';
import { userThemeRoutes } from './routes/user-themes.js';
import { pictureRoutes } from './routes/pictures.js';
import { publicConfigRoutes, statusRoutes } from './routes/public.js';
import { resetPageRoutes } from './routes/reset-page.js';
import { inviteRoutes } from './routes/invite.js';
import { shareOwnerRoutes, shareReaderRoutes } from './routes/shares.js';
import { arcOwnerRoutes } from './routes/arc.js';
import { arcPublicRoutes } from './routes/arc-public.js';
import { DEFAULT_ARC_PUBLIC_LIMITS, type ArcPublicLimits } from './arc/claims.js';
import { authorshipRoutes } from './routes/authorship.js';
import { twoStepRoutes } from './routes/two-step.js';
import { sessionRoutes } from './routes/sessions.js';
import { securityEmails } from './email/security.js';
import { stockRoutes } from './routes/stock.js';
import { arisRoutes } from './aris/routes.js';
import { streakRoutes } from './routes/streak.js';
import { warmthRoutes } from './routes/warmth.js';
import { renderNotFoundPage } from './warmth/pages.js';
import { arisPageRoutes } from './routes/aris-page.js';
import { siteRoutes } from './routes/site.js';
import { schoolRoutes } from './routes/school.js';
import { weeklyRoutes } from './routes/weekly.js';
import { bowmarketRoutes } from './routes/bowmarket.js';
import { oauthApiRoutes, oauthAuthorizeRoutes, oauthMetadataRoutes } from './routes/oauth.js';
import { clientErrorRoutes, type ClientErrorOptions } from './ops/client-errors.js';
import { OpsService } from './ops/service.js';
import { usageCounter } from './ops/usage.js';
import { opsHousekeepingRoutes } from './routes/ops-housekeeping.js';
import { epubRoutes } from './routes/epub.js';
import { studioEpub } from './book/epub/build.js';
import { EpubQueue } from './book/epub/queue.js';
import { wrapRoutes } from './routes/wrap.js';
import { BuildQueue } from './book/studio/queue.js';
import { statusPageRoutes } from './routes/status-page.js';

export interface AppDeps {
  db: Db;
  config: Config;
  /** Injectable server clock (tests walk it across day boundaries). */
  now?: () => Date;
  /** Billing provider; defaults to Stripe configured from `config`. */
  billing?: BillingProvider;
  /** M3 Housekeeping injectables (lock, scratch DB factory, boot check). */
  housekeeping?: HousekeepingDeps;
  /** P0 #5: outgoing mail; defaults to createMailer(config). */
  mailer?: Mailer;
  /** ARC reader mail (src/arc/mail.ts): defaults to createArcMailer(config),
   *  null while ARC mail is not configured; tests inject a fake or null. */
  arcMailer?: Mailer | null;
  /** ARC's public claim page limits (src/arc/claims.ts); tests loosen or tighten them. */
  arcLimits?: Partial<ArcPublicLimits>;
  /** ARC's stamped-download queue (Task 7); defaults to BuildQueue(2, 8). Tests hold it busy. */
  arcDownloads?: BuildQueue;
  /** P0 #5: rate limits for the account endpoints (tests tighten them). */
  accountLimits?: AccountLimits;
  /** CSP violation report endpoint (tests inject the log + limits). */
  cspReport?: CspReportOptions;
  /** H2: per-IP limit for help search (tests tighten it). */
  helpSearchLimits?: HelpSearchLimits;
  /** Accounts portal: rate limits for /api/account (tests tighten them). */
  portalLimits?: PortalLimits;
  /** Production ops (tests inject a webhook fetch and the error-report limits). */
  ops?: { fetchImpl?: typeof fetch; clientErrors?: ClientErrorOptions; now?: () => Date };
}

export function buildApp({
  db,
  config,
  now,
  billing,
  housekeeping,
  mailer,
  arcMailer,
  arcLimits,
  arcDownloads,
  accountLimits,
  cspReport,
  helpSearchLimits,
  portalLimits,
  ops: opsDeps,
}: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  // Exactly the configured number of proxy hops (default 1: Caddy) is
  // trusted, so req.ip is the real client address: Express takes the
  // address that many hops back, reading X-Forwarded-For right-to-left.
  // Caddy ignores any X-Forwarded-For the client sent and sets its own
  // (https://caddyserver.com/docs/caddyfile/directives/reverse_proxy,
  // "Defaults"), so the right-most entry is the client Caddy saw.
  // https://expressjs.com/en/guide/behind-proxies.html
  app.set('trust proxy', config.trustProxyHops);
  const mail = mailer ?? createMailer(config);
  const accountTasks = new BackgroundTasks();
  app.locals.mailer = mail;
  // ARC reader mail: its own transport and sender, never the account mailer.
  app.locals.arcMailer = arcMailer === undefined ? createArcMailer(config) : arcMailer;
  app.locals.accountTasks = accountTasks;
  // The billing webhook verifies its signature over the RAW body, so it
  // gets its own raw parser mounted on its exact path BEFORE the global
  // JSON parser can touch (and re-shape) the payload.
  app.use('/api/billing/webhook', express.raw({ type: () => true, limit: '5mb' }));
  // CSP violation reports carry their own small body cap and parser
  // (application/csp-report, application/reports+json), so they are
  // mounted before the global JSON parser and its manuscript-sized limit.
  app.use('/api/csp-report', cspReportRoutes(cspReport));
  // Studio error reports: their own 4 KB cap and parser, like CSP reports.
  app.use('/api/client-errors', clientErrorRoutes(db, config, opsDeps?.clientErrors));
  // Daily usage counters (aggregates only): watches responses, never blocks.
  app.use(usageCounter(db, config, opsDeps?.now ?? now));
  // Manuscripts are whole-book JSON documents (pictures and snapshots
  // included); allow generous payloads.
  app.use(express.json({ limit: config.manuscriptMaxBytes }));

  app.get('/api/health', async (_req, res) => {
    try {
      await db.query('select 1');
      return res.json({ ok: true, db: 'up' });
    } catch {
      return res.status(503).json({ ok: false, db: 'down' });
    }
  });

  app.get('/api', (_req, res) => res.json({ name: 'beuk-api', milestone: 'M5' }));

  const billingProvider = billing ?? new StripeBillingProvider(config);
  // Trial + one price: the account features that pause after the trial
  // without a plan (src/access.ts ACCESS_RULES), in front of their
  // routers. Nothing else is ever gated, and nothing is while billing is off.
  const gate = accessGate({ db, config, billing: billingProvider, now: now ?? (() => new Date()) });
  for (const rule of ACCESS_RULES) app.post(rule.path, gate(rule.feature));
  // The trial-ending email (once per account); index.ts runs its tick.
  app.locals.trialReminders = new TrialReminders({ db, config, billing: billingProvider, mailer: mail, now: now ?? (() => new Date()) });
  // Accounts portal (/account + /api/account): the sign-up hook sends the
  // email confirmation after the register response.
  const portal = accountPortalRoutes({ db, config, mailer: mail, tasks: accountTasks, billing: billingProvider, now, limits: portalLimits });
  // Owner-only invite sender (admin-gated). Sends through mail — the owner's Gmail in production.
  const invite = inviteRoutes(db, config, mail);
  // Account hardening: the security emails, after the response (src/email/security.ts).
  const security = securityEmails({ db, config, mailer: mail, tasks: accountTasks, now });
  // The per-account sign-in limit, shared so a password reset can lift it.
  const signInLimit = signInLimitHandle();
  app.use(
    '/api/auth',
    authRoutes(
      db,
      config,
      {
        afterRegister: signupConfirmationHook({ db, config, mailer: mail, tasks: accountTasks, billing: billingProvider, now }),
        onSignedIn: (user, _req, sessionToken) => security.signedIn(user, sessionToken),
        onRecoveryUsed: (user, left) => security.recoveryUsed(user, left),
      },
      { billing: billingProvider, now: now ?? (() => new Date()) },
      { now, signInLimit },
    ),
  );
  // P0 #5: forgot/reset password, change password, sign out everywhere.
  app.use('/api/auth', accountRoutes(db, config, mail, accountTasks, accountLimits, signInLimit));
  app.use('/api/manuscripts', manuscriptRoutes(db, config, accountTasks));
  app.use('/api/series-covenants', seriesCovenantRoutes(db, config));
  // My themes (migration 022): the writer's own themes, per account.
  app.use('/api/themes', userThemeRoutes(db, config));
  app.use('/api/pictures', pictureRoutes(db, config));
  app.use('/api/streak', streakRoutes(db, config, now));
  app.use('/api/exports', exportRoutes(db, config, now ?? (() => new Date())));
  const epubQueue = new EpubQueue(config.epubMaxConcurrent, config.epubMaxQueued);
  app.locals.epubQueue = epubQueue;
  app.use('/api/epub', epubRoutes(db, config, epubQueue));
  /* The cover wrap (Step 3 part 4): its own queue, one render at a time by default. */
  const wrapQueue = new BuildQueue(config.wrapMaxConcurrent, config.wrapMaxQueued);
  app.locals.wrapQueue = wrapQueue;
  app.use('/api/wrap', wrapRoutes(db, config, wrapQueue));
  /* Lift the studio's EPUB code now, in the background, so the first export does not wait for it. */
  if (config.epubWarmAtStart) {
    setImmediate(() => {
      try {
        studioEpub();
      } catch (err) {
        console.error('epub.warm_failed', err instanceof Error ? err.message : err);
      }
    });
  }
  app.use(
    '/api/billing',
    billingRoutes(db, config, billingProvider, now),
  );
  const hk = createHousekeepingContext(config, housekeeping);
  // Scheduled local backups + off-site copies + restore drill; the
  // timer lives in index.ts, the manual actions in Housekeeping.
  hk.backups = new BackupScheduler({
    db,
    config,
    secrets: hk.secrets,
    lock: hk.lock,
    runRestic: housekeeping?.runRestic,
    now: housekeeping?.now,
  });
  app.locals.backupScheduler = hk.backups;
  // Ops: backup alerts + local retention ride on the scheduler's tick
  // (index.ts); their Housekeeping views mount in front of the main router.
  const opsService = new OpsService({
    db,
    config,
    mailer: mail,
    lock: hk.lock,
    secrets: hk.secrets,
    now: opsDeps?.now ?? housekeeping?.now,
    fetchImpl: opsDeps?.fetchImpl,
  });
  app.locals.ops = opsService;
  app.use('/api/housekeeping', opsHousekeepingRoutes(db, config, hk, opsService, mail));
  app.use('/api/housekeeping', housekeepingRoutes(db, config, hk, mail));
  // M5 jobs (EPUBCheck + PDF/X over the caller's own archive).
  const jobs = jobRoutes(db, config);
  app.use('/api/jobs', jobs.router);
  app.locals.jobsRunner = jobs.runner;

  // Stock photos (cover-maker backgrounds): signed-in Pexels search
  // proxy; 501 until PEXELS_API_KEY is set (see routes/stock.ts).
  app.use('/api/stock', stockRoutes(db, config));

  // Aris (AI addon): mounted always, gated per request on ARIS_ENABLED
  // (see aris/routes.ts); must precede the /api catch-all below.
  app.use('/api/aris', arisRoutes(db, config));

  // M4 warmth: public status + public config + Founders' Shelf intake.
  app.use('/api/status', statusRoutes(db, config));
  // Public status: /status (page) and /api/status/public (monitors).
  const statusPage = statusPageRoutes(db, config, mail);
  app.use('/api/status', statusPage.api);
  app.use('/api/config', publicConfigRoutes(config));
  app.use('/api/founders', foundersRoutes(db));

  // H1/H2 Help: server-rendered pages + public search API.
  const help = helpRoutes(db, config, helpSearchLimits);
  app.use('/api/help', help.api);

  // Beta-reader share links: owner surface (signed in).
  app.use('/api/shares', shareOwnerRoutes(db, now));
  // ARC campaigns: the owner surface (signed in); version 1 builds through the server EPUB queue.
  const arcDeps = {
    db,
    config,
    arcMailer: app.locals.arcMailer as Mailer | null,
    mailer: mail,
    epubQueue,
    now: now ?? (() => new Date()),
  };
  app.use('/api/arc', arcOwnerRoutes(arcDeps));
  // The authorship record: fingerprint-only stamps (signed in, owner-only).
  app.use('/api/authorship', authorshipRoutes(db, now));

  // Two-step sign-in: turning it on and off (signed in; start + enable pause on day 22).
  app.use('/api/account/two-step', twoStepRoutes({ db, now, security }));
  // Where you're signed in: the session list and signing one device out (never paused).
  app.use('/api/account/sessions', sessionRoutes(db));
  app.use('/api/account', portal.api);
  // Owner-only invite sender API; requireAdmin makes it a 404 for everyone else.
  app.use('/api/invite', invite.api);

  // Beuk School: free courses at /school; progress for signed-in writers only.
  const school = schoolRoutes(db, config);
  app.use('/api/school', school.api);

  // OAuth 2.1 for the remote MCP server (Phase 1): token exchange +
  // RFC 7591 dynamic client registration under /api/oauth.
  app.use('/api/oauth', oauthApiRoutes(db, config));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

  // OAuth 2.1, the root-level pieces: /authorize + the consent decision
  // (session login + consent screen), and the RFC 8414 / RFC 9728
  // discovery documents at /.well-known/ (which MUST live at the origin
  // root). Caddy forwards /authorize* and /.well-known/oauth-* here —
  // see the Caddyfile.
  app.use(oauthAuthorizeRoutes(db, config, security));
  app.use(oauthMetadataRoutes(config));

  // Beta-reader share links: the public read-only reader (no account).
  // Caddy proxies /read* to the app (see the Caddyfile).
  app.use('/read', shareReaderRoutes(db, { now, cookieSecure: config.cookieSecure }));
  // ARC campaigns: the public claim page and its code (no account).
  // Caddy proxies /arc and /arc/* to the app (see the Caddyfile).
  // The stamped downloads take turns: 2 at once, 8 waiting, one per reader.
  app.use('/arc', arcPublicRoutes(arcDeps, { ...DEFAULT_ARC_PUBLIC_LIMITS, ...arcLimits }, arcDownloads ?? new BuildQueue(2, 8)));

  // M4 warmth pages (help reading room, thanks, changelog, roadmap).
  // Everything else at the site root is Caddy's static client mount.
  app.use(help.pages);
  // Beuk Weekly before the School's pages: /school/weekly is never a course slug.
  app.use(weeklyRoutes(config));
  // Bowmarket too: /school/bowmarket is never a course slug.
  app.use(bowmarketRoutes(config));
  app.use(school.pages);
  app.use(warmthRoutes(config, db));
  // Aris's one public page (404 unless ARIS_ENABLED); caddy proxies /aris* here.
  app.use(arisPageRoutes(db, config));
  // The public site's robots.txt and sitemap.xml (they carry APP_BASE_URL).
  app.use(siteRoutes(config));
  app.use(statusPage.page);
  // P0 #5: the "choose a new password" page the reset email links to.
  app.use(resetPageRoutes(config));
  // Owner-only invite page (/account/invite), before the portal's /account pages.
  app.use(invite.pages);
  // Accounts portal pages: /account, /account/confirm, /account/deleted.
  app.use(portal.pages);
  // The studio: Beuk 2.0 (React) at /studio/, from the image's build. STUDIO_CLASSIC=true
  // serves 1.0's index.html at /studio instead (the rollback). Caddy proxies /studio and /studio/* here.
  app.use(studioRoutes({ classic: config.studioClassic }));

  // Nothing above answered. A reader who asked for a PAGE (a GET whose
  // Accept names text/html, at an address with no file extension) gets the
  // site's own "page not found" (src/warmth/pages.ts), still a 404. It is
  // one page for every such address, so a page that is switched off here
  // (/support, /aris) reads exactly like one that never existed. Everything
  // else keeps Express's plain 404: scripts, styles and pictures (a missing
  // asset must not come back as a page), monitors and curl (Accept: */*).
  // /api never arrives here: its own JSON 404 is above.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const wantsPage = (req.method === 'GET' || req.method === 'HEAD') && (req.headers.accept ?? '').includes('text/html');
    if (!wantsPage || /\.[^/]+$/.test(req.path)) return next();
    return res.status(404).type('html').set('Cache-Control', 'no-store').send(renderNotFoundPage(config));
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    // body-parser marks an over-limit body; say so instead of a bare 500
    // so the studio can tell the writer why the shelf save failed.
    if ((err as { type?: string }).type === 'entity.too.large') {
      return res.status(413).json({ error: 'book is too large for the shelf', limitBytes: config.manuscriptMaxBytes });
    }
    // A body that is not JSON (or not in a charset the parser reads) is the
    // client's mistake: 400 / 415, nothing logged as a server fault.
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'the request body is not valid JSON' });
    }
    if ((err as { type?: string }).type === 'encoding.unsupported' || (err as { type?: string }).type === 'charset.unsupported') {
      return res.status(415).json({ error: 'the request body is in an encoding the server does not read' });
    }
    console.error(err);
    return res.status(500).json({ error: 'internal error' });
  });

  return app;
}
