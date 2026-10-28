import { PGlite } from '@electric-sql/pglite';
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import type { BillingProvider } from '../src/billing.js';
import type { Config } from '../src/config.js';
import { runMigrations, type Db, type QueryResult } from '../src/db.js';
import type { Mailer } from '../src/mailer.js';
import type { AccountLimits, BackgroundTasks } from '../src/routes/account.js';
import type { CspReportOptions } from '../src/routes/csp-report.js';
import type { HelpSearchLimits } from '../src/routes/help.js';
import type {
  BootCheck,
  HousekeepingDeps,
  ScratchDbFactory,
} from '../src/housekeeping/context.js';

/** Wrap a PGlite instance in the Db interface (no migrations applied). */
export function wrapPglite(pg: PGlite): Db {
  const db: Db = {
    query: async <T>(text: string, params?: unknown[]): Promise<QueryResult<T>> => {
      if (!params || params.length === 0) {
        // No parameters → use exec, which also allows multi-statement SQL
        // (migration files). Return the last statement's result.
        const results = await pg.exec(text);
        const last = results[results.length - 1];
        return { rows: (last?.rows ?? []) as T[] };
      }
      const result = await pg.query(text, params as unknown[]);
      return { rows: result.rows as T[] };
    },
    tx: async <T>(fn: (txDb: Db) => Promise<T>): Promise<T> => {
      await pg.exec('begin');
      try {
        const result = await fn(db);
        await pg.exec('commit');
        return result;
      } catch (err) {
        await pg.exec('rollback');
        throw err;
      }
    },
  };
  return db;
}

/** Real Postgres (PGlite, WASM build of Postgres) in-process for tests —
 *  the same migration SQL and queries as production, no server needed. */
export async function createTestDb(): Promise<Db> {
  const db = wrapPglite(new PGlite());
  await runMigrations(db, path.resolve(import.meta.dirname, '..', 'migrations'));
  return db;
}

/** M3: a scratch-database factory backed by a throwaway PGlite —
 *  the test twin of the production pg factory (Rehearse). */
export function createPgliteScratchFactory(): ScratchDbFactory {
  return async () => {
    const pg = new PGlite();
    return {
      db: wrapPglite(pg),
      cleanup: async () => {
        await pg.close();
      },
    };
  };
}

/** M3: the test twin of the production boot check — stand the app up
 *  on an ephemeral port against the given DB and probe /api/health. */
export function httpBootCheck(baseConfig: Config): BootCheck {
  return async (scratchDb: Db) => {
    const app = buildApp({ db: scratchDb, config: baseConfig });
    const server: Server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        return { ok: false, detail: 'boot check could not bind a port' };
      }
      const res = await fetch(`http://127.0.0.1:${address.port}/api/health`);
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; db?: string };
      return {
        ok: res.status === 200 && body.ok === true && body.db === 'up',
        detail: `GET /api/health → ${res.status}`,
      };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

export interface TestServer {
  base: string;
  config: Config;
  close: () => Promise<void>;
  /** P0 #5: await the account routes' after-response work (reset mail). */
  settle: () => Promise<void>;
}

/** The full test Config (fresh temp dirs per call). */
export function testConfig(overrides?: Partial<Config>): Config {
  const backupDir = mkdtempSync(path.join(os.tmpdir(), 'beuk-backups-'));
  return {
    port: 0,
    databaseUrl: null,
    timeZone: 'UTC',
    cookieSecure: false,
    sessionTtlDays: 30,
    // M2: exports land in a fresh temp dir per test server; billing keys
    // absent by default (billing tests pass stripeWebhookSecret in).
    exportDir: mkdtempSync(path.join(os.tmpdir(), 'beuk-exports-')),
    exportMaxBytes: 50 * 1024 * 1024,
    manuscriptMaxBytes: 64 * 1024 * 1024,
    // Mirrors the production default (on); the 503 test turns it off.
    restoreEnabled: true,
    stripeSecretKey: null,
    stripeWebhookSecret: null,
    stripePriceId: null,
    stripeMode: null,
    stripeApiBase: 'http://127.0.0.1:9',
    billingGraceDays: 7,
    entitlementsFile: null,
    trialDays: 7,
    billingPriceLabel: null,
    billingAutomaticTax: false,
    billingCancelProrate: false,
    trialReminderDays: 3,
    appBaseUrl: 'http://127.0.0.1',
    // M3: no admins, a throwaway backup dir, a fixed build stamp and a
    // temp promotion-manifest path by default; tests override as needed.
    backupDir,
    buildStamp: 'test-build-1',
    treeClean: false,
    promotionManifestPath: path.join(backupDir, 'PROMOTION_MANIFEST.json'),
    // M4 warmth: test support contact, no tip jar unless a test sets one.
    appVersion: '0.1.0',
    supportEmail: 'shelf@example.com',
    supportName: 'The Test Shelf-Keeper',
    supportReplyPromise: 'a human replies within two working days',
    kofiUrl: null,
    // M5 jobs: no tools configured by default (the unconfigured path
    // is the honest default); jobs tests point these at stub tools.
    epubcheckJar: null,
    javaBin: 'java',
    gsBin: null,
    pdfxDefPath: path.resolve(import.meta.dirname, '..', 'tools', 'PDFX_def.ps'),
    pdfxIccDir: null,
    pdfxInkDpi: 100,
    rendererUrl: null,
    legacyHtmlPdfBin: null,
    jobTimeoutMs: 120_000,
    pdfxTimeoutMs: 900_000,
    pdfxChunkPages: 40,
    javaMaxHeap: '512m',
    jobMaxActivePerUser: 2,
    jobMaxQueued: 20,
    // Stock photos: no Pexels key by default (the unconfigured path is
    // the honest default); stock tests pass a key + stub base URL in.
    pexelsApiKey: null,
    pexelsApiBase: 'https://api.pexels.com/v1',
    // Hardening: tests talk to the app directly; one trusted hop lets a
    // test pose as distinct clients via X-Forwarded-For. The auth rate
    // limit is generous by default so suites that register many users
    // never trip it; tests/hardening.test.ts sets a tight one.
    trustProxyHops: 1,
    authRateBurst: 10_000,
    authRateRefillMs: 60_000,
    shutdownGraceMs: 20_000,
    sessionPurgeIntervalMs: 3_600_000,
    // Account basics: no SMTP by default (the unconfigured path is the
    // honest default) and no console logging of reset links in tests.
    smtpUrl: null,
    mailFrom: null,
    mailLogLinks: false,
    // Backups: no schedule and no off-site target by default (both are
    // reported "not configured"); tests/offsite.test.ts sets them.
    backupIntervalHours: 0,
    // Legal pages: every slot unset by default (the "being completed" notices).
    legal: { operatorName: null, contactEmail: null, jurisdiction: null, postalAddress: null, hostingLocation: null, effectiveDate: null },
    offsite: {
      b2KeyId: null,
      b2ApplicationKey: null,
      b2Bucket: null,
      b2Endpoint: null,
      repoPrefix: 'beuk',
      resticPassword: null,
      resticBin: 'restic',
      resticTimeoutMs: 60_000,
      probeTimeoutMs: 60_000,
      resticHost: 'beuk',
      resticTag: 'beuk-backup',
      keepDaily: 7,
      keepWeekly: 4,
      keepMonthly: 12,
      maxAgeHours: 36,
      drillIntervalHours: 168,
      drillMaxAgeHours: 192,
    },
    ...overrides,
  };
}

export async function startTestServer(
  db: Db,
  now?: () => Date,
  overrides?: Partial<Config>,
  housekeeping?: HousekeepingDeps,
  extra?: {
    mailer?: Mailer;
    accountLimits?: AccountLimits;
    cspReport?: CspReportOptions;
    billing?: BillingProvider;
    helpSearchLimits?: HelpSearchLimits;
  },
): Promise<TestServer> {
  const config = testConfig(overrides);
  const app = buildApp({ db, config, now, housekeeping, ...extra });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  return {
    base: `http://127.0.0.1:${address.port}`,
    config,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    settle: () => (app.locals.accountTasks as BackgroundTasks).idle(),
  };
}

export interface Response {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}

/** Minimal HTTP client with a per-instance cookie jar (one "browser"). */
export class Client {
  private cookies = new Map<string, string>();

  constructor(private base: string) {}

  private cookieHeader(): Record<string, string> {
    const cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    return cookie ? { cookie } : {};
  }

  private storeCookies(res: globalThis.Response): void {
    const setCookies =
      typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const pair = sc.split(';')[0];
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(sc)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(
    method: string,
    pathName: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...this.cookieHeader(),
      ...extraHeaders,
    };
    const res = await fetch(`${this.base}${pathName}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.storeCookies(res);
    const text = await res.text();
    return {
      status: res.status,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
      headers: res.headers,
    };
  }

  /** POST raw bytes (export archive upload). Returns the JSON response. */
  async upload(pathName: string, bytes: Buffer): Promise<Response> {
    const res = await fetch(`${this.base}${pathName}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', ...this.cookieHeader() },
      body: new Uint8Array(bytes),
    });
    this.storeCookies(res);
    const text = await res.text();
    return {
      status: res.status,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
      headers: res.headers,
    };
  }

  /** GET expecting binary content (export download). */
  async download(pathName: string): Promise<{ status: number; headers: Headers; bytes: Buffer }> {
    const res = await fetch(`${this.base}${pathName}`, { headers: this.cookieHeader() });
    this.storeCookies(res);
    return {
      status: res.status,
      headers: res.headers,
      bytes: Buffer.from(await res.arrayBuffer()),
    };
  }

  get(p: string) {
    return this.request('GET', p);
  }
  post(p: string, body?: unknown) {
    return this.request('POST', p, body);
  }
  put(p: string, body?: unknown, headers?: Record<string, string>) {
    return this.request('PUT', p, body, headers);
  }
  delete(p: string) {
    return this.request('DELETE', p);
  }
}

export async function registerUser(
  client: Client,
  email: string,
  password = 'correct horse battery',
): Promise<Response> {
  return client.post('/api/auth/register', { email, password });
}
