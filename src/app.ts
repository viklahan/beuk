import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { StripeBillingProvider, type BillingProvider } from './billing.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import {
  createHousekeepingContext,
  type HousekeepingDeps,
} from './housekeeping/context.js';
import { createMailer, type Mailer } from './mailer.js';
import { accountRoutes, BackgroundTasks, type AccountLimits } from './routes/account.js';
import { authRoutes } from './routes/auth.js';
import { accountPortalRoutes, signupConfirmationHook, type PortalLimits } from './routes/account-portal.js';
import { billingRoutes } from './routes/billing.js';
import { cspReportRoutes, type CspReportOptions } from './routes/csp-report.js';
import { exportRoutes } from './routes/exports.js';
import { foundersRoutes } from './routes/founders.js';
import { helpRoutes, type HelpSearchLimits } from './routes/help.js';
import { housekeepingRoutes } from './routes/housekeeping.js';
import { BackupScheduler } from './housekeeping/offsite.js';
import { jobRoutes } from './routes/jobs.js';
import { manuscriptRoutes } from './routes/manuscripts.js';
import { publicConfigRoutes, statusRoutes } from './routes/public.js';
import { resetPageRoutes } from './routes/reset-page.js';
import { shareOwnerRoutes, shareReaderRoutes } from './routes/shares.js';
import { stockRoutes } from './routes/stock.js';
import { streakRoutes } from './routes/streak.js';
import { warmthRoutes } from './routes/warmth.js';
import { siteRoutes } from './routes/site.js';

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
  /** P0 #5: rate limits for the account endpoints (tests tighten them). */
  accountLimits?: AccountLimits;
  /** CSP violation report endpoint (tests inject the log + limits). */
  cspReport?: CspReportOptions;
  /** H2: per-IP limit for help search (tests tighten it). */
  helpSearchLimits?: HelpSearchLimits;
  /** Accounts portal: rate limits for /api/account (tests tighten them). */
  portalLimits?: PortalLimits;
}

export function buildApp({
  db,
  config,
  now,
  billing,
  housekeeping,
  mailer,
  accountLimits,
  cspReport,
  helpSearchLimits,
  portalLimits,
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
  app.locals.accountTasks = accountTasks;
  // The billing webhook verifies its signature over the RAW body, so it
  // gets its own raw parser mounted on its exact path BEFORE the global
  // JSON parser can touch (and re-shape) the payload.
  app.use('/api/billing/webhook', express.raw({ type: () => true, limit: '5mb' }));
  // CSP violation reports carry their own small body cap and parser
  // (application/csp-report, application/reports+json), so they are
  // mounted before the global JSON parser and its manuscript-sized limit.
  app.use('/api/csp-report', cspReportRoutes(cspReport));
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
  // Accounts portal (/account + /api/account): the sign-up hook sends the
  // email confirmation after the register response.
  const portal = accountPortalRoutes({ db, config, mailer: mail, tasks: accountTasks, billing: billingProvider, now, limits: portalLimits });
  app.use('/api/auth', authRoutes(db, config, { afterRegister: signupConfirmationHook({ db, config, mailer: mail, tasks: accountTasks }) }));
  // P0 #5: forgot/reset password, change password, sign out everywhere.
  app.use('/api/auth', accountRoutes(db, config, mail, accountTasks, accountLimits));
  app.use('/api/manuscripts', manuscriptRoutes(db));
  app.use('/api/streak', streakRoutes(db, config, now));
  app.use('/api/exports', exportRoutes(db, config));
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
  app.use('/api/housekeeping', housekeepingRoutes(db, config, hk, mail));
  // M5 jobs (EPUBCheck + PDF/X over the caller's own archive).
  const jobs = jobRoutes(db, config);
  app.use('/api/jobs', jobs.router);
  app.locals.jobsRunner = jobs.runner;

  // Stock photos (cover-maker backgrounds): signed-in Pexels search
  // proxy; 501 until PEXELS_API_KEY is set (see routes/stock.ts).
  app.use('/api/stock', stockRoutes(db, config));

  // M4 warmth: public status + public config + Founders' Shelf intake.
  app.use('/api/status', statusRoutes(db, config));
  app.use('/api/config', publicConfigRoutes(config));
  app.use('/api/founders', foundersRoutes(db));

  // H1/H2 Help: server-rendered pages + public search API.
  const help = helpRoutes(db, config, helpSearchLimits);
  app.use('/api/help', help.api);

  // Beta-reader share links: owner surface (signed in).
  app.use('/api/shares', shareOwnerRoutes(db, now));

  app.use('/api/account', portal.api);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

  // Beta-reader share links: the public read-only reader (no account).
  // Caddy proxies /read* to the app (see the Caddyfile).
  app.use('/read', shareReaderRoutes(db, { now, cookieSecure: config.cookieSecure }));

  // M4 warmth pages (help reading room, thanks, changelog, roadmap).
  // Everything else at the site root is Caddy's static client mount.
  app.use(help.pages);
  app.use(warmthRoutes(config));
  // The public site's robots.txt and sitemap.xml (they carry APP_BASE_URL).
  app.use(siteRoutes(config));
  // P0 #5: the "choose a new password" page the reset email links to.
  app.use(resetPageRoutes(config));
  // Accounts portal pages: /account, /account/confirm, /account/deleted.
  app.use(portal.pages);

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    // body-parser marks an over-limit body; say so instead of a bare 500
    // so the studio can tell the writer why the shelf save failed.
    if ((err as { type?: string }).type === 'entity.too.large') {
      return res.status(413).json({ error: 'book is too large for the shelf', limitBytes: config.manuscriptMaxBytes });
    }
    console.error(err);
    return res.status(500).json({ error: 'internal error' });
  });

  return app;
}
