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
  /** Shelf pictures (src/pictures.ts): the largest one picture, decoded
   *  (PICTURE_MAX_BYTES, default 32 MiB), every picture an account holds
   *  together (PICTURE_QUOTA_BYTES, default 2 GiB), and how long an
   *  upload no book names yet is kept before it is collected
   *  (PICTURE_GC_GRACE_SECONDS, default 3600: a save uploads its
   *  pictures first, then the doc that names them). */
  pictureMaxBytes: number;
  pictureQuotaBytes: number;
  pictureGcGraceSeconds: number;
  /** RESTORE_ENABLED (default true). Restore now carries every data
   *  table (shares, comments, readers and jobs included; the completeness
   *  self-check fails on any unclassified table). Set false to turn
   *  restore off: POST /api/housekeeping/restore then answers 503. */
  restoreEnabled: boolean;
  /** M2 billing hooks: all null until Vik sets a price + keys. When any
   *  piece is missing the billing endpoints answer 501 "not configured"
   *  rather than erroring or faking success. */
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  stripePriceId: string | null;
  /** STRIPE_MODE ('test' | 'live'), optional. The mode is read from the
   *  secret key's prefix (sk_test_/rk_test_ vs sk_live_/rk_live_,
   *  https://docs.stripe.com/keys); when STRIPE_MODE is also set and
   *  disagrees, billing refuses to run. Null = not set. */
  stripeMode: 'test' | 'live' | null;
  /** Stripe API origin (STRIPE_API_BASE). Default https://api.stripe.com;
   *  tests point it at a local fake Stripe API. */
  stripeApiBase: string;
  /** P2 (V, 2026-10-25): days a past_due subscription keeps its
   *  entitlements (BILLING_GRACE_DAYS, default 7). */
  billingGraceDays: number;
  /** P1: JSON file mapping Stripe price ids to entitlements
   *  (ENTITLEMENTS_FILE). Null = no file: nothing is granted or gated. */
  entitlementsFile: string | null;
  /** Trial + one price (V, 2026-10-26). TRIAL_DAYS (default 7): the free
   *  trial a new account gets from sign-up (stamped on users.trial_ends_at
   *  at sign-up, so changing it later never moves an existing trial). */
  trialDays: number;
  /** BILLING_PRICE_LABEL: how the one price is written for people, e.g.
   *  "8 a month" with its currency. Null = no price is shown anywhere
   *  (the Upgrade button still works once STRIPE_PRICE_ID is set; Stripe's
   *  own checkout page shows the amount). */
  billingPriceLabel: string | null;
  /** BILLING_AUTOMATIC_TAX=true: checkout asks Stripe Tax to calculate
   *  tax (automatic_tax[enabled]=true). Needs Stripe Tax set up first. */
  billingAutomaticTax: boolean;
  /** BILLING_CANCEL_PRORATE=true: when an account is deleted, its
   *  subscription is cancelled with prorate=true (Stripe credits the
   *  unused time to the customer balance; it is not a refund). Default
   *  false, Stripe's own default. */
  billingCancelProrate: boolean;
  /** TRIAL_REMINDER_DAYS (default 3; 0 = off): the trial-ending email goes
   *  this many days before the trial ends, once per account. */
  trialReminderDays: number;
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
   *  and the reply-time promise are all Vik's to set in .env.
   *  All three are null until set (V, 2026-10-25: the mailbox does not
   *  exist yet). While SUPPORT_EMAIL is unset, nothing that names a
   *  person, an address or a reply time is rendered anywhere — no
   *  empty mailto, no placeholder address. SUPPORT_NAME and
   *  SUPPORT_REPLY_PROMISE are only used when SUPPORT_EMAIL is set,
   *  and each only when it is set itself (no built-in default promise). */
  supportEmail: string | null;
  supportName: string | null;
  supportReplyPromise: string | null;
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
  /** M5 jobs: Ghostscript's ICC profile directory for the pdfx job
   *  (PDFX_ICC_DIR, passed as -sICCProfilesDir). pdfwrite converts
   *  colour into its default_cmyk.icc and ignores -sOutputICCProfile
   *  (measured on Ghostscript 10.00.0, 2026-10-25 — see
   *  ghostscriptPdfxArgs), so the tools image builds a directory whose
   *  default_cmyk.icc IS the press profile the OutputIntent declares.
   *  Null: the conversion runs through Ghostscript's own built-in CMYK
   *  profile, and the job result says so. */
  pdfxIccDir: string | null;
  /** M5 jobs: resolution (PDFX_INK_DPI, default 100) of the CMYK raster
   *  the pdfx job renders from its own output to measure total ink. */
  pdfxInkDpi: number;
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
  /** M5 jobs: wall-clock timeout in ms (JOB_TIMEOUT_MS, default 2
   *  minutes) for EPUBCheck and for the pdfx job's HTML-to-PDF renderer
   *  request; a step that overruns is stopped and the job fails. */
  jobTimeoutMs: number;
  /** M5 jobs: wall-clock timeout in ms for the pdfx job's Ghostscript
   *  conversion step (PDFX_TIMEOUT_MS, default 30 minutes; it covers
   *  every Ghostscript run of a chunked conversion together). Separate
   *  because PDF/X-1a forbids transparency: Ghostscript flattens every
   *  page that has any by rendering it whole to an image, which took
   *  ~100 s of the bundled 81-page sample's run (the renderer: ~6 s).
   *  30 minutes is an operational default: a 241,642-word, 873-page
   *  novel's conversion (22 runs of 40 pages + the join) measured
   *  648 s on a heavily loaded host (2026-10-27), 72 % of the old
   *  15-minute default, so books of 1,000+ pages had no margin. */
  pdfxTimeoutMs: number;
  /** M5 jobs: how many pages ONE Ghostscript run converts to PDF/X
   *  (PDFX_CHUNK_PAGES, default 40). GPL Ghostscript 10.00.0's pdfwrite,
   *  converting a PDF's colour to CMYK, keeps about 21 MB more memory for
   *  every page it reads when the CMYK profile is the 2.7 MB SWOP press
   *  profile (measured 2026-10-27: 50 pages 1.1 GB, 100 pages 2.2 GB,
   *  200 pages 3.2 GB peak), so a 873-page novel needed far more memory
   *  than the server had and the kernel killed it. A longer interior is
   *  therefore converted in runs of this many pages, then joined in one
   *  last pass that leaves the colour as it is (that pass measured 45 MB
   *  for 200 pages). Smaller = less memory, a little more time. */
  pdfxChunkPages: number;
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
  /** Scheduled local backups: one every BACKUP_INTERVAL_HOURS (default
   *  24; 0 turns the schedule off). Local backups are kept until
   *  BACKUP_KEEP_DAYS / BACKUP_KEEP_COUNT say otherwise (src/ops/retention.ts);
   *  unset, they are never deleted
   *  automatically (local retention is not decided yet). */
  backupIntervalHours: number;
  /** Legal pages (/privacy, /terms): who runs the service. Every slot
   *  is null until the operator sets it in .env; while a slot is null
   *  the page shows a visible "this part is being completed" notice in
   *  its place — a name, address or jurisdiction is never invented.
   *  contactEmail is LEGAL_CONTACT_EMAIL, falling back to SUPPORT_EMAIL
   *  (see legalContactEmail()). effectiveDate is LEGAL_EFFECTIVE_DATE
   *  (YYYY-MM-DD); null = the pages show the content file's own date. */
  legal: {
    operatorName: string | null;
    contactEmail: string | null;
    jurisdiction: string | null;
    postalAddress: string | null;
    hostingLocation: string | null;
    effectiveDate: string | null;
  };
  /** Off-site backups: restic to Backblaze B2 through B2's S3-compatible
   *  API (see src/housekeeping/offsite.ts for why). Off until all five
   *  of key id, application key, bucket, endpoint and RESTIC_PASSWORD
   *  are set; until then Housekeeping reports "not configured". */
  offsite: {
    b2KeyId: string | null;
    b2ApplicationKey: string | null;
    b2Bucket: string | null;
    /** The bucket's S3 endpoint, e.g. https://s3.us-west-004.backblazeb2.com */
    b2Endpoint: string | null;
    /** Folder inside the bucket (OFFSITE_B2_PREFIX, default "beuk"). */
    repoPrefix: string;
    resticPassword: string | null;
    resticBin: string;
    resticTimeoutMs: number;
    /** Timeout for the first repository probe (OFFSITE_PROBE_TIMEOUT_MS,
     *  default 2 min): restic keeps retrying a wrong key or a missing
     *  bucket, so a short probe turns that into a prompt, named failure. */
    probeTimeoutMs: number;
    resticHost: string;
    resticTag: string;
    /** restic forget --keep-daily/--keep-weekly/--keep-monthly. */
    keepDaily: number;
    keepWeekly: number;
    keepMonthly: number;
    /** Freshness self-check fails beyond this age (default 36 h). */
    maxAgeHours: number;
    /** Restore drill cadence (default 168 h = weekly; 0 = off) and the
     *  age beyond which the drill self-check fails (default 192 h). */
    drillIntervalHours: number;
    drillMaxAgeHours: number;
  };
  /** Production ops (src/ops/): backup alerts, local backup retention,
   *  studio error reports. Optional so older test configs need not
   *  carry it; opsSettings() in src/ops/settings.ts fills the defaults. */
  ops?: OpsConfig;
}

export interface OpsConfig {
  /** ALERT_EMAIL: where backup alerts are emailed (only when SMTP_URL +
   *  MAIL_FROM are set too). Null = no alert email. */
  alertEmail: string | null;
  /** ALERT_WEBHOOK_URL: a URL backup alerts are POSTed to as JSON.
   *  Treated as a secret (Slack/Discord webhook URLs carry a token). */
  alertWebhookUrl: string | null;
  /** ALERT_WEBHOOK_FORMAT: json (default; the full alert object, with
   *  `text` and `content` lines), slack ({"text"}) or discord ({"content"}). */
  alertWebhookFormat: 'json' | 'slack' | 'discord';
  /** BACKUP_KEEP_DAYS / BACKUP_KEEP_COUNT: local backup retention. Null =
   *  unset = keep everything (V has not decided). */
  backupKeepDays: number | null;
  backupKeepCount: number | null;
  /** CLIENT_ERRORS_KEEP_DAYS: days studio error reports are kept (default 30). */
  clientErrorsKeepDays: number;
}

function positiveIntOrNull(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function nonNegativeNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function nonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** A real calendar date written YYYY-MM-DD (2026-02-30 is refused). */
export function isIsoDate(raw: string | undefined): boolean {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const d = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw;
}

/** The address the legal pages give for privacy requests. */
export function legalContactEmail(config: Config): string | null {
  return config.legal.contactEmail ?? config.supportEmail;
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
    pictureMaxBytes: positiveInt(env.PICTURE_MAX_BYTES, 32 * 1024 * 1024),
    pictureQuotaBytes: positiveInt(env.PICTURE_QUOTA_BYTES, 2 * 1024 * 1024 * 1024),
    pictureGcGraceSeconds: nonNegativeInt(env.PICTURE_GC_GRACE_SECONDS, 3600),
    restoreEnabled: (env.RESTORE_ENABLED ?? 'true').toLowerCase() !== 'false',
    stripeSecretKey: env.STRIPE_SECRET_KEY || null,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || null,
    stripePriceId: env.STRIPE_PRICE_ID || null,
    stripeMode:
      env.STRIPE_MODE === 'test' || env.STRIPE_MODE === 'live' ? env.STRIPE_MODE : null,
    stripeApiBase: (env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, ''),
    billingGraceDays: nonNegativeInt(env.BILLING_GRACE_DAYS, 7),
    entitlementsFile: env.ENTITLEMENTS_FILE || null,
    trialDays: nonNegativeInt(env.TRIAL_DAYS, 7),
    billingPriceLabel: env.BILLING_PRICE_LABEL?.trim() || null,
    billingAutomaticTax: (env.BILLING_AUTOMATIC_TAX ?? '').toLowerCase() === 'true',
    billingCancelProrate: (env.BILLING_CANCEL_PRORATE ?? '').toLowerCase() === 'true',
    trialReminderDays: nonNegativeInt(env.TRIAL_REMINDER_DAYS, 3),
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
    supportEmail: env.SUPPORT_EMAIL?.trim() || null,
    supportName: env.SUPPORT_NAME?.trim() || null,
    supportReplyPromise: env.SUPPORT_REPLY_PROMISE?.trim() || null,
    kofiUrl: env.KOFI_URL || null,
    epubcheckJar: env.EPUBCHECK_JAR || null,
    javaBin: env.JAVA_BIN || 'java',
    gsBin: env.GS_BIN || null,
    pdfxDefPath: env.PDFX_DEF ?? path.resolve(process.cwd(), 'tools', 'PDFX_def.ps'),
    pdfxIccDir: env.PDFX_ICC_DIR || null,
    pdfxInkDpi: positiveInt(env.PDFX_INK_DPI, 100),
    rendererUrl: env.RENDERER_URL || null,
    legacyHtmlPdfBin: env.HTML_PDF_BIN || null,
    jobTimeoutMs: Number(env.JOB_TIMEOUT_MS ?? 120_000),
    pdfxTimeoutMs: positiveInt(env.PDFX_TIMEOUT_MS, 1_800_000),
    pdfxChunkPages: positiveInt(env.PDFX_CHUNK_PAGES, 40),
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
    backupIntervalHours: nonNegativeNumber(env.BACKUP_INTERVAL_HOURS, 24),
    legal: {
      operatorName: env.LEGAL_OPERATOR_NAME?.trim() || null,
      contactEmail: env.LEGAL_CONTACT_EMAIL?.trim() || null,
      jurisdiction: env.LEGAL_JURISDICTION?.trim() || null,
      postalAddress: env.LEGAL_POSTAL_ADDRESS?.trim() || null,
      hostingLocation: env.LEGAL_HOSTING_LOCATION?.trim() || null,
      effectiveDate: isIsoDate(env.LEGAL_EFFECTIVE_DATE?.trim()) ? env.LEGAL_EFFECTIVE_DATE!.trim() : null,
    },
    offsite: {
      b2KeyId: env.OFFSITE_B2_KEY_ID || null,
      b2ApplicationKey: env.OFFSITE_B2_APPLICATION_KEY || null,
      b2Bucket: env.OFFSITE_B2_BUCKET || null,
      b2Endpoint: env.OFFSITE_B2_ENDPOINT || null,
      repoPrefix: env.OFFSITE_B2_PREFIX ?? 'beuk',
      resticPassword: env.RESTIC_PASSWORD || null,
      resticBin: env.RESTIC_BIN || 'restic',
      resticTimeoutMs: positiveInt(env.RESTIC_TIMEOUT_MS, 30 * 60_000),
      probeTimeoutMs: positiveInt(env.OFFSITE_PROBE_TIMEOUT_MS, 120_000),
      resticHost: env.RESTIC_HOST || 'beuk',
      resticTag: 'beuk-backup',
      keepDaily: positiveInt(env.RESTIC_KEEP_DAILY, 7),
      keepWeekly: positiveInt(env.RESTIC_KEEP_WEEKLY, 4),
      keepMonthly: positiveInt(env.RESTIC_KEEP_MONTHLY, 12),
      maxAgeHours: positiveInt(env.OFFSITE_MAX_AGE_HOURS, 36),
      drillIntervalHours: nonNegativeNumber(env.OFFSITE_DRILL_INTERVAL_HOURS, 168),
      drillMaxAgeHours: positiveInt(env.OFFSITE_DRILL_MAX_AGE_HOURS, 192),
    },
    ops: {
      alertEmail: env.ALERT_EMAIL?.trim() || null,
      alertWebhookUrl: env.ALERT_WEBHOOK_URL?.trim() || null,
      alertWebhookFormat:
        env.ALERT_WEBHOOK_FORMAT === 'slack' || env.ALERT_WEBHOOK_FORMAT === 'discord' ? env.ALERT_WEBHOOK_FORMAT : 'json',
      backupKeepDays: positiveIntOrNull(env.BACKUP_KEEP_DAYS),
      backupKeepCount: positiveIntOrNull(env.BACKUP_KEEP_COUNT),
      clientErrorsKeepDays: positiveInt(env.CLIENT_ERRORS_KEEP_DAYS, 30),
    },
  };
}
