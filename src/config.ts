import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface Config {
  port: number;
  databaseUrl: string | null;
  /** IANA timezone the streak uses for "today". */
  timeZone: string;
  cookieSecure: boolean;
  sessionTtlDays: number;
  /** M2: directory export bytes are stored under (per-user subdirs). */
  exportDir: string;
  /** M2: max accepted export upload size in bytes (default 50 MiB). */
  exportMaxBytes: number;
  /** Max accepted manuscript JSON body in bytes (MANUSCRIPT_MAX_BYTES,
   *  default 64 MiB). A book carries its pictures and its snapshot
   *  history, so the sample book alone is ~23 MB. */
  manuscriptMaxBytes: number;
  /** M2 billing hooks: all null until Vik sets a price + keys. When any
   *  piece is missing the billing endpoints answer 501 "not configured"
   *  rather than erroring or faking success. */
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  stripePriceId: string | null;
  /** Public base URL of the site, for billing checkout redirect targets. */
  appBaseUrl: string;
  /** M3 Housekeeping: directory named backups are written under. */
  backupDir: string;
  /** M3 Housekeeping: stamp identifying this build. From BUILD_STAMP or
   *  GIT_SHA when the deploy sets them; otherwise a per-boot dev stamp.
   *  Self-check runs and sign-offs are recorded against it. */
  buildStamp: string;
  /** M3 Housekeeping: the deploy marks the working tree clean via the
   *  TREE_CLEAN env var or a marker file; promotion refuses without it. */
  treeClean: boolean;
  /** M3 Housekeeping: where a successful promotion writes its manifest. */
  promotionManifestPath: string;
  /** M4 warmth: version string reported by /api/status (APP_VERSION;
   *  defaults to the package version). */
  appVersion: string;
  /** M4 warmth: the public support contact shown on the Help pages.
   *  Email is the official support channel; the address, the human name
   *  and the reply-time promise are all Vik's to set in .env. */
  supportEmail: string;
  supportName: string;
  supportReplyPromise: string;
  /** M4 warmth: Ko-fi page URL (KOFI_URL). Null until set — while null
   *  the tip jar is rendered NOWHERE (no placeholder, no dead link). */
  kofiUrl: string | null;
  /** M5 jobs: path to the EPUBCheck jar (EPUBCHECK_JAR) and the java
   *  binary used to run it (JAVA_BIN, default "java"). A null/missing
   *  jar means EPUBCheck is NOT configured on this server: epubcheck
   *  jobs are still accepted, run, and complete as FAILED with that
   *  stated in their result — a pass is never fabricated. */
  epubcheckJar: string | null;
  javaBin: string;
  /** M5 jobs: Ghostscript binary (GS_BIN, e.g. /usr/bin/gs). Null
   *  means PDF/X conversion is not configured; pdfx jobs fail
   *  honestly the same way. */
  gsBin: string | null;
  /** M5 jobs: the PDF/X-1a definition file handed to Ghostscript
   *  (PDFX_DEF; defaults to tools/PDFX_def.ps in the repo). */
  pdfxDefPath: string;
  /** M5 jobs: URL of the isolated renderer service (RENDERER_URL, e.g.
   *  http://renderer:3100/render — see deploy/renderer/ and the tools
   *  overlay). The pdfx job POSTs the print-html interior there and
   *  gets the PDF back; user HTML never runs inside the app container.
   *  Null means HTML-to-PDF rendition is NOT configured on this server:
   *  pdfx jobs are still accepted, run, and complete as FAILED with that
   *  stated in their result — raw HTML is never fed to Ghostscript. */
  rendererUrl: string | null;
  /** The retired in-container renderer setting (HTML_PDF_BIN). It is
   *  read ONLY so the not-configured message can say it is ignored:
   *  running Chromium on user HTML inside the app container exposed the
   *  app's secrets and volumes, so that mode no longer exists. */
  legacyHtmlPdfBin: string | null;
  /** M5 jobs: per-job wall-clock timeout in ms (JOB_TIMEOUT_MS,
   *  default 2 minutes); a job that overruns is stopped and fails. */
  jobTimeoutMs: number;
  /** M5 jobs: maximum JVM heap for EPUBCheck (JAVA_MAX_HEAP, passed as
   *  -Xmx; default 512m). A hostile or huge EPUB then fails with an
   *  OutOfMemoryError in its result instead of starving the box. */
  javaMaxHeap: string;
  /** M5 jobs: how many jobs one user may have queued or running at
   *  once (JOB_MAX_ACTIVE_PER_USER, default 2); the next is a 429. */
  jobMaxActivePerUser: number;
  /** M5 jobs: how many jobs the whole server holds queued or running
   *  at once (JOB_MAX_QUEUED, default 20); the next is a 503. */
  jobMaxQueued: number;
  /** Stock photos (cover-maker backgrounds, via Pexels): the API key
   *  (PEXELS_API_KEY). Null until set — while null, GET /api/stock/search
   *  answers 501 "stock photos not configured". The key is used
   *  server-side only and is never sent to clients. */
  pexelsApiKey: string | null;
  /** Stock photos: Pexels API base URL (PEXELS_API_BASE, default
   *  https://api.pexels.com/v1); tests point it at a stub server. */
  pexelsApiBase: string;
  /** Hardening: how many reverse-proxy hops sit in front of the app
   *  (TRUST_PROXY_HOPS, default 1 = Caddy). Handed to Express's
   *  `trust proxy` so req.ip is the real client address. Set 0 when the
   *  app is reached directly (no proxy), or clients could spoof
   *  X-Forwarded-For. https://expressjs.com/en/guide/behind-proxies.html */
  trustProxyHops: number;
  /** Hardening: per-client-IP token bucket on POST /api/auth/login and
   *  /api/auth/register (separate buckets). AUTH_RATE_BURST attempts
   *  (default 10) up front, one more every AUTH_RATE_REFILL_MS
   *  (default 60000 = one a minute). */
  authRateBurst: number;
  authRateRefillMs: number;
  /** Hardening: on SIGTERM/SIGINT, how long in-flight requests and a
   *  running job get before the job is marked failed and the process
   *  exits (SHUTDOWN_GRACE_MS, default 20000; keep it below compose's
   *  stop_grace_period). */
  shutdownGraceMs: number;
  /** Hardening: how often expired sessions are deleted
   *  (SESSION_PURGE_INTERVAL_MS, default 1 hour; also once at boot). */
  sessionPurgeIntervalMs: number;
  /** P0 #5 account basics: outgoing mail. SMTP_URL is a nodemailer
   *  connection URL (smtp://user:pass@host:587 — STARTTLS when the
   *  server offers it; smtps://…:465 for implicit TLS). MAIL_FROM is
   *  the From address. Both null until set — while either is missing
   *  NO email is sent and none is ever reported as sent (see mailer.ts). */
  smtpUrl: string | null;
  mailFrom: string | null;
  /** When mail is not configured, write the would-be message (with its
   *  reset link) to the server console. MAIL_LOG_LINKS=true|false;
   *  default: on unless NODE_ENV=production. */
  mailLogLinks: boolean;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL ?? null,
    timeZone: env.APP_TIMEZONE ?? 'UTC',
    cookieSecure: (env.COOKIE_SECURE ?? 'false').toLowerCase() === 'true',
    sessionTtlDays: Number(env.SESSION_TTL_DAYS ?? 30),
    exportDir: env.EXPORT_DIR ?? path.resolve(process.cwd(), 'data', 'exports'),
    exportMaxBytes: Number(env.EXPORT_MAX_BYTES ?? 50 * 1024 * 1024),
    manuscriptMaxBytes: Number(env.MANUSCRIPT_MAX_BYTES ?? 64 * 1024 * 1024),
    stripeSecretKey: env.STRIPE_SECRET_KEY || null,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || null,
    stripePriceId: env.STRIPE_PRICE_ID || null,
    appBaseUrl: (env.APP_BASE_URL ?? 'https://localhost').replace(/\/$/, ''),
    backupDir: env.BACKUP_DIR ?? path.resolve(process.cwd(), 'data', 'backups'),
    buildStamp:
      env.BUILD_STAMP || env.GIT_SHA || `dev-${randomBytes(4).toString('hex')}`,
    treeClean:
      (env.TREE_CLEAN ?? '').toLowerCase() === 'true' ||
      env.TREE_CLEAN === '1' ||
      existsSync(env.TREE_CLEAN_FILE ?? path.resolve(process.cwd(), '.tree-clean')),
    promotionManifestPath:
      env.PROMOTION_MANIFEST_PATH ?? path.resolve(process.cwd(), 'PROMOTION_MANIFEST.json'),
    appVersion: env.APP_VERSION || '0.1.0',
    supportEmail: env.SUPPORT_EMAIL || 'support@beuk.studio',
    supportName: env.SUPPORT_NAME || 'the maker of Beuk',
    supportReplyPromise:
      env.SUPPORT_REPLY_PROMISE || 'a human replies within two working days',
    kofiUrl: env.KOFI_URL || null,
    epubcheckJar: env.EPUBCHECK_JAR || null,
    javaBin: env.JAVA_BIN || 'java',
    gsBin: env.GS_BIN || null,
    pdfxDefPath: env.PDFX_DEF ?? path.resolve(process.cwd(), 'tools', 'PDFX_def.ps'),
    rendererUrl: env.RENDERER_URL || null,
    legacyHtmlPdfBin: env.HTML_PDF_BIN || null,
    jobTimeoutMs: Number(env.JOB_TIMEOUT_MS ?? 120_000),
    javaMaxHeap: /^[1-9][0-9]*[kKmMgG]?$/.test(env.JAVA_MAX_HEAP ?? '') ? env.JAVA_MAX_HEAP! : '512m',
    jobMaxActivePerUser: positiveInt(env.JOB_MAX_ACTIVE_PER_USER, 2),
    jobMaxQueued: positiveInt(env.JOB_MAX_QUEUED, 20),
    pexelsApiKey: env.PEXELS_API_KEY || null,
    pexelsApiBase: (env.PEXELS_API_BASE ?? 'https://api.pexels.com/v1').replace(/\/$/, ''),
    trustProxyHops: Number(env.TRUST_PROXY_HOPS ?? 1),
    authRateBurst: Number(env.AUTH_RATE_BURST ?? 10),
    authRateRefillMs: Number(env.AUTH_RATE_REFILL_MS ?? 60_000),
    shutdownGraceMs: Number(env.SHUTDOWN_GRACE_MS ?? 20_000),
    sessionPurgeIntervalMs: Number(env.SESSION_PURGE_INTERVAL_MS ?? 3_600_000),
    smtpUrl: env.SMTP_URL || null,
    mailFrom: env.MAIL_FROM || null,
    mailLogLinks: env.MAIL_LOG_LINKS
      ? env.MAIL_LOG_LINKS.toLowerCase() === 'true' || env.MAIL_LOG_LINKS === '1'
      : (env.NODE_ENV ?? '').toLowerCase() !== 'production',
  };
}
