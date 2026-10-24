import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { StripeBillingProvider, type BillingProvider } from './billing.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import {
  createHousekeepingContext,
  type HousekeepingDeps,
} from './housekeeping/context.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import { exportRoutes } from './routes/exports.js';
import { foundersRoutes } from './routes/founders.js';
import { housekeepingRoutes } from './routes/housekeeping.js';
import { jobRoutes } from './routes/jobs.js';
import { manuscriptRoutes } from './routes/manuscripts.js';
import { publicConfigRoutes, statusRoutes } from './routes/public.js';
import { shareOwnerRoutes, shareReaderRoutes } from './routes/shares.js';
import { stockRoutes } from './routes/stock.js';
import { streakRoutes } from './routes/streak.js';
import { warmthRoutes } from './routes/warmth.js';

export interface AppDeps {
  db: Db;
  config: Config;
  /** Injectable server clock (tests walk it across day boundaries). */
  now?: () => Date;
  /** Billing provider; defaults to Stripe configured from `config`. */
  billing?: BillingProvider;
  /** M3 Housekeeping injectables (lock, scratch DB factory, boot check). */
  housekeeping?: HousekeepingDeps;
}

export function buildApp({ db, config, now, billing, housekeeping }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  // The billing webhook verifies its signature over the RAW body, so it
  // gets its own raw parser mounted on its exact path BEFORE the global
  // JSON parser can touch (and re-shape) the payload.
  app.use('/api/billing/webhook', express.raw({ type: () => true, limit: '5mb' }));
  // Manuscripts are whole-book JSON documents; allow generous payloads.
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', async (_req, res) => {
    try {
      await db.query('select 1');
      return res.json({ ok: true, db: 'up' });
    } catch {
      return res.status(503).json({ ok: false, db: 'down' });
    }
  });

  app.get('/api', (_req, res) => res.json({ name: 'beuk-api', milestone: 'M5' }));

  app.use('/api/auth', authRoutes(db, config));
  app.use('/api/manuscripts', manuscriptRoutes(db));
  app.use('/api/streak', streakRoutes(db, config, now));
  app.use('/api/exports', exportRoutes(db, config));
  app.use('/api/billing', billingRoutes(db, billing ?? new StripeBillingProvider(config)));
  app.use(
    '/api/housekeeping',
    housekeepingRoutes(db, config, createHousekeepingContext(config, housekeeping)),
  );
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

  // Beta-reader share links: owner surface (signed in).
  app.use('/api/shares', shareOwnerRoutes(db, now));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

  // Beta-reader share links: the public read-only reader (no account).
  // Caddy proxies /read* to the app (see the Caddyfile).
  app.use('/read', shareReaderRoutes(db, { now, cookieSecure: config.cookieSecure }));

  // M4 warmth pages (help reading room, thanks, changelog, roadmap).
  // Everything else at the site root is Caddy's static client mount.
  app.use(warmthRoutes(config));

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    return res.status(500).json({ error: 'internal error' });
  });

  return app;
}
