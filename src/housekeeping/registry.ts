import { createHash } from 'node:crypto';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import { defaultMigrationsDir, type Db } from '../db.js';
import { fixtureEntries, loadFixtures, type FixtureSet } from './fixtures.js';
import { isUuid } from '../ids.js';
import { dummyPasswordHash, verifyAgainstDummy } from '../password.js';
import { TokenBucketLimiter } from '../ratelimit.js';
import { ghostscriptPdfxArgs, pdfRenderProblem, pdfxIccDirArgs, pdfxIccPath } from '../jobs/tools.js';
import { neutralRgbToGray, textInkFacts } from '../jobs/pdfpress.js';
import { inspectPdf } from '../jobs/pdfinspect.js';
import { checkPdfxProfile, PDFX_PROFILE } from '../jobs/iccprofile.js';
import {
  parseOpf,
  readZip,
  resolvePath,
  validateEpub,
  type ZipEntry,
} from './packages.js';
import { scanTags } from './xml.js';
import { BACKUP_TABLES, classifyTables, EXCLUDED_TABLES } from './backup.js';
import { drillHealth, offsiteFreshness, scheduleHealth, type HealthVerdict } from './offsite.js';

function verdict(v: HealthVerdict): string {
  if (v.status === 'not-configured') throw new NotConfigured(v.detail);
  assert(v.status === 'pass', v.detail);
  return v.detail;
}
import { clientDir, repoRoot } from '../warmth/pages.js';
import { createMailer, type Mailer } from '../mailer.js';
import { StripeBillingProvider } from '../billing.js';
import { loadEntitlements } from '../entitlements.js';
import { renderSnapshot } from '../shares/render.js';
import { sanitizeHtml } from '../shares/sanitize.js';
import { ACCOUNT_DELETED_TABLES, ACCOUNT_DETACHED_TABLES } from '../account/data.js';
import { CONFIRM_TOKEN_TTL_HOURS } from '../account/confirm.js';

/**
 * The Housekeeping Self-checks registry, ported from
 * goals/beuk-saas-launch/files/housekeeping-test-coverage.md.
 *
 * Every case from the client registry is here. Cases that are
 * server-meaningful EXECUTE: infra checks against the live system,
 * data invariants against the database + export volume, and package
 * assertions against fixture packages (the same shapes the client
 * generates, plus deliberately damaged copies for the validator
 * cases). Cases that are inherently client-UI state are registered
 * as 'client-only' with the reason — never dropped, never faked.
 */

export interface CheckContext {
  db: Db;
  config: Config;
  fixtures: FixtureSet;
  /** P0 #5: the app's mailer (defaults to one built from config). */
  mailer?: Mailer;
}

export interface CaseResult {
  id: string;
  title: string;
  /** not-configured: the feature this case checks is switched off on
   *  this server. Never counted as a pass; does not fail the run. */
  status: 'pass' | 'fail' | 'client-only' | 'not-configured';
  detail: string;
}

/** Thrown by a case whose feature is not configured on this server. */
export class NotConfigured extends Error {}

interface RegistryCase {
  id: string;
  title: string;
  kind: 'server' | 'client-only';
  reason?: string;
  run?: (ctx: CheckContext) => Promise<string>;
}

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function entriesOf(buf: Buffer): Map<string, ZipEntry> {
  return new Map(readZip(buf).map((e) => [e.name, e]));
}

function textOf(entries: Map<string, ZipEntry>, name: string): string {
  const entry = entries.get(name);
  assert(entry, `fixture is missing ${name}`);
  return entry.data.toString('utf8');
}

/** epub:type values inside the landmarks <nav> of a nav document, and
 *  the hrefs inside the toc <nav>. */
function navParts(navText: string): { landmarks: Set<string>; tocHrefs: string[] } {
  const navs = navText.split('<nav').slice(1);
  let landmarks = new Set<string>();
  let tocHrefs: string[] = [];
  for (const nav of navs) {
    // Classify by the <nav> element's OWN attributes (the text before
    // its first '>') — the landmarks nav itself contains a toc-typed
    // anchor, so scanning the whole segment misclassifies it.
    const ownAttrs = nav.slice(0, nav.indexOf('>'));
    const tags = scanTags(nav);
    if (ownAttrs.includes('epub:type="landmarks"')) {
      landmarks = new Set(
        tags.filter((t) => t.attrs['epub:type']).map((t) => t.attrs['epub:type']),
      );
    }
    if (ownAttrs.includes('epub:type="toc"')) {
      tocHrefs = tags.filter((t) => t.name === 'a' && t.attrs.href).map((t) => t.attrs.href);
    }
  }
  return { landmarks, tocHrefs };
}

function checkStatus(buf: Buffer, id: string): { status: string; detail: string } {
  const found = validateEpub(readZip(buf)).find((c) => c.id === id);
  assert(found, `validator produced no ${id} check`);
  return found;
}

/* ------------------------------------------------------------------ */

export const SELF_CHECK_CASES: RegistryCase[] = [
  /* ---- Infra ---- */
  {
    id: 'infra.db.reachable',
    title: 'Database is reachable',
    kind: 'server',
    run: async ({ db }) => {
      await db.query('select 1');
      return 'select 1 answered';
    },
  },
  {
    id: 'infra.migrations.current',
    title: 'All migrations are applied',
    kind: 'server',
    run: async ({ db }) => {
      const files = (await readdir(defaultMigrationsDir()))
        .filter((f) => f.endsWith('.sql'))
        .sort();
      const applied = await db.query<{ name: string }>('select name from schema_migrations');
      const done = new Set(applied.rows.map((r) => r.name));
      const missing = files.filter((f) => !done.has(f));
      assert(!missing.length, `migrations not applied: ${missing.join(', ')}`);
      return `${files.length} migrations applied`;
    },
  },
  {
    id: 'infra.exports.writable',
    title: 'Export volume is writable',
    kind: 'server',
    run: async ({ config }) => {
      const probe = path.join(config.exportDir, `.housekeeping-probe-${process.pid}`);
      await writeFile(probe, 'probe');
      await rm(probe, { force: true });
      return `wrote and removed a probe file in ${config.exportDir}`;
    },
  },
  {
    id: 'infra.deploy.warmth-assets',
    title: 'Deploy tree carries the warmth page sources',
    kind: 'server',
    run: async () => {
      // Caddy proxies /help*, /thanks*, /changelog to the app, which
      // reads the page sources from the deploy tree at request time —
      // NOT from Caddy's static ./client mount (only caddy sees that).
      // If these files never made it into the image, the Help reading
      // room 404s and /changelog 500s on first boot.
      const missing: string[] = [];
      const clientFiles: string[][] = [
        ['help', 'help.css'],
        ['help', 'help.js'],
        ['help', 'theme.js'],
        ['help', 'warmth.css'],
        ['thanks', 'index.html'],
      ];
      for (const segments of clientFiles) {
        try {
          await readFile(path.join(clientDir(), ...segments), 'utf8');
        } catch {
          missing.push(path.join('client', ...segments));
        }
      }
      try {
        await readFile(path.join(repoRoot(), 'CHANGELOG.md'), 'utf8');
      } catch {
        missing.push('CHANGELOG.md');
      }
      // H1: the Help pages render from content/help/ (guides, errors, home).
      for (const rel of [['content', 'help', 'errors.json'], ['content', 'help', 'home.json'], ['content', 'help', 'guides', 'check-your-book.md']]) {
        try {
          await readFile(path.join(repoRoot(), ...rel), 'utf8');
        } catch {
          missing.push(rel.join('/'));
        }
      }
      assert(
        !missing.length,
        `warmth page sources missing from the deploy tree: ${missing.join(', ')}`,
      );
      return 'client/help/ assets, content/help/, client/thanks/ and CHANGELOG.md all readable from the deploy tree';
    },
  },
  {
    id: 'infra.deploy.vendored-libraries',
    title: 'Deploy tree carries the studio libraries, byte-identical to their pinned releases',
    kind: 'server',
    run: async () => {
      // Local-first saving: the studio loads JSZip, mammoth, lucide and
      // jsPDF from client/assets/vendor/ (not a CDN) so it opens and
      // imports .docx OFFLINE. The page pins each file with a
      // Subresource Integrity hash; a file that drifted from its pinned
      // bytes would be refused by the browser. Same hashes as the
      // integrity="" attributes in client/index.html.
      const pinned: Array<[string, string]> = [
        ['jszip.min.js', 'sha512-XMVd28F1oH/O71fzwBnV7HucLxVwtxf26XV8P4wPk26EDxuGZ91N8bsOttmnomcCD3CS5ZMRL50H0GgOHvegtg=='],
        ['mammoth.browser.min.js', 'sha512-sG5Q7boJL+ft/weuz6Mmi9XBD+bEzE9AI2FMP4YMFxp3FpTFUQSQQm5K5cSgJCyed6bWs3W8f8h0lp36lHXhQA=='],
        ['lucide.min.js', 'sha512-ibnpmCRt4ihCELC17N3qavYe+koJxpcJQA2FxbbyCJkqYs1WetGvNWeecRmT5g3IJf7CmAsW+rLMJFC0qdkAiA=='],
        ['jspdf.umd.min.js', 'sha512-B/+2C2xTio+mD98bsO0SAh007OKBp96sQyJECBAFzA0pwWQhyC/yxgMU6aWjldvtZkALDUeOl+7eiLZL7P7+FA=='],
      ];
      const problems: string[] = [];
      for (const [file, sri] of pinned) {
        let bytes: Buffer;
        try {
          bytes = await readFile(path.join(clientDir(), 'assets', 'vendor', file));
        } catch {
          problems.push(`${file}: missing`);
          continue;
        }
        const actual = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
        if (actual !== sri) problems.push(`${file}: bytes differ from the pinned hash`);
      }
      assert(!problems.length, `studio libraries: ${problems.join('; ')}`);
      return `${pinned.length} vendored libraries present and matching their pinned SHA-512`;
    },
  },

  /* ==== BEUK:harden ==== */
  /* ---- Hardening: auth abuse, ids, sessions, deploy headers/signals ---- */
  {
    id: 'security.auth.rate-limit',
    title: 'Sign-in and sign-up are rate-limited per client (429 + Retry-After)',
    kind: 'server',
    run: async ({ config }) => {
      assert(
        Number.isFinite(config.authRateBurst) && config.authRateBurst >= 1 &&
          Number.isFinite(config.authRateRefillMs) && config.authRateRefillMs > 0,
        `auth rate limit misconfigured (AUTH_RATE_BURST=${config.authRateBurst}, AUTH_RATE_REFILL_MS=${config.authRateRefillMs})`,
      );
      // Exercise the same limiter class the routes use, on a frozen clock.
      const limiter = new TokenBucketLimiter({ burst: config.authRateBurst, refillMs: config.authRateRefillMs, now: () => 0 });
      for (let i = 0; i < config.authRateBurst; i++) assert(limiter.take('probe').ok, `attempt ${i + 1} refused early`);
      const refused = limiter.take('probe');
      assert(!refused.ok && refused.retryAfterSec >= 1, 'attempt past the burst was not refused with a retry-after');
      assert(
        Number.isInteger(config.trustProxyHops) && config.trustProxyHops >= 0,
        `TRUST_PROXY_HOPS=${config.trustProxyHops} is not a hop count`,
      );
      return `${config.authRateBurst} attempts per client, then one per ${config.authRateRefillMs} ms; trust proxy = ${config.trustProxyHops} hop(s)`;
    },
  },
  {
    id: 'security.auth.no-timing-oracle',
    title: 'Unknown-email sign-in spends a real argon2id verify (no account-existence timing oracle)',
    kind: 'server',
    run: async () => {
      const hash = await dummyPasswordHash();
      assert(hash.startsWith('$argon2id$'), 'the dummy hash is not an argon2id hash');
      const t0 = Date.now();
      assert((await verifyAgainstDummy('probe password')) === false, 'dummy verify did not refuse');
      return `dummy argon2id verify ran (${Date.now() - t0} ms) and refused`;
    },
  },
  {
    id: 'security.ids.non-uuid-not-found',
    title: 'Non-UUID ids are rejected before reaching Postgres (404, never a 500)',
    kind: 'server',
    run: async () => {
      assert(isUuid('00000000-0000-0000-0000-000000000000'), 'a canonical UUID was rejected');
      for (const bad of ['nope', '123', "1' or '1'='1", '']) assert(!isUuid(bad), `"${bad}" accepted as a UUID`);
      return 'canonical UUIDs accepted; malformed ids refused';
    },
  },
  {
    id: 'data.sessions.expired-purged',
    title: 'Expired sessions are being purged',
    kind: 'server',
    run: async ({ db, config }) => {
      // The purge runs at boot and every SESSION_PURGE_INTERVAL_MS; a
      // session expired for more than two intervals means it stopped.
      const stale = await db.query<{ n: string }>(
        `select count(*)::text as n from sessions
         where expires_at < now() - ($1::bigint * interval '1 millisecond')`,
        [String(config.sessionPurgeIntervalMs * 2)],
      );
      const n = Number(stale.rows[0]?.n ?? 0);
      assert(n === 0, `${n} session(s) expired more than two purge intervals ago are still stored`);
      return `no session expired longer than ${config.sessionPurgeIntervalMs * 2} ms is stored`;
    },
  },
  {
    id: 'infra.deploy.security-headers',
    title: 'Caddyfile sends the security headers (HSTS on real TLS only, full CSP enforced with a report endpoint)',
    kind: 'server',
    run: async () => {
      // Static proof from the deploy tree; the live headers are proven
      // by the Playwright check in the README "Security headers" section.
      const caddy = await readFile(path.join(repoRoot(), 'Caddyfile'), 'utf8');
      const missing = [
        'X-Content-Type-Options "nosniff"',
        'Referrer-Policy "strict-origin-when-cross-origin"',
        'X-Frame-Options "SAMEORIGIN"',
        `header ?Content-Security-Policy "default-src 'self'`,
        "object-src 'none'",
        "frame-ancestors 'self'",
        'report-uri /api/csp-report',
        'report-to csp',
        'header ?Reporting-Endpoints "csp=',
        'header @hsts Strict-Transport-Security',
        'not host localhost 127.0.0.1',
      ].filter((needle) => !caddy.includes(needle));
      assert(!missing.length, `Caddyfile is missing: ${missing.join('; ')}`);
      // The full policy is enforced; a leftover report-only copy would
      // mean the allow-list is not actually in force.
      const live = caddy.replace(/^\s*#.*$/gm, '');
      assert(!live.includes('Content-Security-Policy-Report-Only'), 'Caddyfile still ships a report-only CSP');
      return 'nosniff, referrer policy, frame protection, the full CSP (enforced, reporting to /api/csp-report) and TLS-only HSTS all present';
    },
  },
  {
    id: 'infra.deploy.signals-healthchecks',
    title: 'Compose runs the app under an init with a grace period, and health-checks app + caddy',
    kind: 'server',
    run: async ({ config }) => {
      const compose = await readFile(path.join(repoRoot(), 'docker-compose.yml'), 'utf8');
      const app = compose.slice(compose.indexOf('\n  app:'), compose.indexOf('\n  caddy:'));
      const caddy = compose.slice(compose.indexOf('\n  caddy:'));
      assert(/\n\s+init: true/.test(app), 'app service does not set init: true (node would be PID 1)');
      const grace = /stop_grace_period:\s*(\d+)s/.exec(app);
      assert(grace, 'app service has no stop_grace_period');
      assert(
        Number(grace[1]) * 1000 > config.shutdownGraceMs,
        `SHUTDOWN_GRACE_MS ${config.shutdownGraceMs} is not below stop_grace_period ${grace[1]}s`,
      );
      assert(app.includes('healthcheck:') && app.includes('/api/health'), 'app service has no /api/health healthcheck');
      assert(caddy.includes('healthcheck:'), 'caddy service has no healthcheck');
      return `init: true, stop_grace_period ${grace[1]}s > SHUTDOWN_GRACE_MS ${config.shutdownGraceMs} ms, app + caddy healthchecks present`;
    },
  },
  /* ==== /BEUK:harden ==== */

  /* ---- Account basics (P0 #5): mail + password reset ---- */
  {
    id: 'auth.mail.delivery-state-honest',
    title: 'Email: SMTP verified when configured; otherwise reported "email not configured" and never claimed sent',
    kind: 'server',
    run: async ({ config, mailer }) => {
      const m = mailer ?? createMailer(config, { log: () => {} });
      const status = m.status();
      if (status.configured) {
        const verified = await m.verify();
        assert(verified.ok, verified.detail);
        return `${verified.detail}; from ${status.from}`;
      }
      // Unconfigured: prove the mailer refuses to claim a delivery.
      const quiet = createMailer({ ...config, mailLogLinks: false }, { log: () => {} });
      // email-kind: self-check-probe (an unconfigured mailer only; never sent)
      const probe = await quiet.send({ to: 'probe@invalid.example', subject: 'probe', text: 'probe' });
      assert(!probe.delivered, 'an unconfigured mailer reported a delivery');
      const verified = await m.verify();
      assert(!verified.ok, 'an unconfigured mailer reported a verified connection');
      return `${status.detail}. Password-reset emails are NOT being sent until SMTP_URL and MAIL_FROM are set.`;
    },
  },
  {
    id: 'auth.reset.page-in-deploy-tree',
    title: 'Deploy tree carries the password-reset page (/reset)',
    kind: 'server',
    run: async () => {
      const html = await readFile(path.join(clientDir(), 'reset', 'index.html'), 'utf8').catch(() => null);
      assert(html !== null, 'client/reset/index.html is missing from the deploy tree — reset links would 404');
      assert(html.includes('/api/auth/reset'), 'client/reset/index.html does not post to /api/auth/reset');
      return 'client/reset/index.html readable and posts to /api/auth/reset';
    },
  },
  {
    id: 'auth.reset.tokens-hashed-single-use',
    title: 'Password-reset tokens: stored hashed, single-use column present, none live past 60 minutes',
    kind: 'server',
    run: async ({ db }) => {
      const cols = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_name = 'password_resets'`,
      );
      const names = new Set(cols.rows.map((r) => r.column_name));
      for (const c of ['token_hash', 'expires_at', 'used_at']) {
        assert(names.has(c), `password_resets has no ${c} column`);
      }
      assert(!names.has('token'), 'password_resets stores a plaintext token column');
      const live = await db.query<{ n: number }>(
        `select count(*)::int as n from password_resets where used_at is null and expires_at > now() + interval '61 minutes'`,
      );
      assert(Number(live.rows[0]?.n ?? 0) === 0, 'a live reset token expires more than 60 minutes out');
      return 'token_hash / expires_at / used_at present, no plaintext token column, no live token expires past 60 minutes';
    },
  },
  {
    id: 'auth.ui.forgot-and-account-controls',
    title: 'Studio: "Forgot password?" with honest confirmation copy; Change password + Sign out everywhere',
    kind: 'client-only',
    reason: 'The sign-in dialog and the account area are studio UI; the endpoints they call are covered by the server tests.',
  },

  /* ==== BEUK:portal ==== the account page (/account) */
  {
    id: 'account.confirm.tokens-hashed-single-use',
    title: 'Email-confirmation links: stored hashed, single-use column present, none live past their 48 hours',
    kind: 'server',
    run: async ({ db }) => {
      const cols = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_name = 'email_confirmations'`,
      );
      const names = new Set(cols.rows.map((r) => r.column_name));
      for (const c of ['token_hash', 'expires_at', 'used_at']) {
        assert(names.has(c), `email_confirmations has no ${c} column`);
      }
      assert(!names.has('token'), 'email_confirmations stores a plaintext token column');
      const live = await db.query<{ n: number }>(
        `select count(*)::int as n from email_confirmations
         where used_at is null and expires_at > now() + make_interval(hours => $1, mins => 1)`,
        [CONFIRM_TOKEN_TTL_HOURS],
      );
      assert(Number(live.rows[0]?.n ?? 0) === 0, `a live confirmation link expires more than ${CONFIRM_TOKEN_TTL_HOURS} hours out`);
      return `token_hash / expires_at / used_at present, no plaintext token column, no live link expires past ${CONFIRM_TOKEN_TTL_HOURS} hours`;
    },
  },
  {
    id: 'account.delete.covers-every-owned-table',
    title: 'Delete my account: every table that references users is either deleted or deliberately detached',
    kind: 'server',
    run: async ({ db }) => {
      const r = await db.query<{ table_name: string }>(
        `select distinct tc.table_name
         from information_schema.table_constraints tc
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
         where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public' and ccu.table_name = 'users'
         order by tc.table_name`,
      );
      const referencing = r.rows.map((row) => row.table_name);
      assert(referencing.length > 0, 'no foreign keys to users were found — the check cannot see the schema');
      const handled = new Set<string>([...ACCOUNT_DELETED_TABLES, ...Object.keys(ACCOUNT_DETACHED_TABLES)]);
      const missed = referencing.filter((t) => !handled.has(t));
      assert(!missed.length, `account deletion does not handle: ${missed.join(', ')}`);
      return `${referencing.length} tables reference users; all are deleted or detached by account deletion (${referencing.join(', ')})`;
    },
  },
  {
    id: 'account.portal.page-in-deploy-tree',
    title: 'Deploy tree carries the account page assets (/account/account.js, /account/account.css)',
    kind: 'server',
    run: async () => {
      const js = await readFile(path.join(clientDir(), 'account', 'account.js'), 'utf8').catch(() => null);
      const css = await readFile(path.join(clientDir(), 'account', 'account.css'), 'utf8').catch(() => null);
      assert(js !== null, 'client/account/account.js is missing — the account page forms would not work');
      assert(css !== null, 'client/account/account.css is missing — the account page would be unstyled');
      for (const p of ['/api/account/delete', '/api/account/email', '/api/auth/password', '/api/auth/sessions/revoke-all']) {
        assert(js.includes(p), `client/account/account.js does not call ${p}`);
      }
      return 'client/account/account.js + account.css readable; the forms call the account, password and sign-out-everywhere endpoints';
    },
  },
  /* ==== /BEUK:portal ==== */

  /* ==== BEUK:billing ==== */
  {
    id: 'billing.mode.matches-key',
    title: 'Billing: the Stripe key mode is known and agrees with STRIPE_MODE; unconfigured billing refuses every webhook',
    kind: 'server',
    run: async ({ config }) => {
      const provider = new StripeBillingProvider(config);
      if (!config.stripeSecretKey || !config.stripeWebhookSecret) {
        // Unconfigured: prove nothing can be processed, say so plainly.
        assert(!provider.configured, 'billing reports configured without both keys');
        assert(!provider.checkoutConfigured, 'checkout reports configured without both keys');
        return 'billing NOT configured (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET unset): the webhook answers 501 and nothing can be granted';
      }
      assert(provider.misconfiguration === null, provider.misconfiguration ?? '');
      return `mode ${provider.mode} (from the key prefix${config.stripeMode ? `, agrees with STRIPE_MODE` : ''}); only ${provider.mode}-mode events are applied`;
    },
  },
  {
    id: 'billing.entitlements.file-valid',
    title: 'Billing: the entitlements file parses and carries STRIPE_PRICE_ID',
    kind: 'server',
    run: async ({ config }) => {
      const loaded = loadEntitlements(config);
      assert(loaded.ok, loaded.ok ? '' : `ENTITLEMENTS_FILE ${loaded.source} is invalid: ${loaded.error}`);
      const prices = Object.keys(loaded.table.prices);
      if (!loaded.source) {
        return 'no ENTITLEMENTS_FILE set: no price grants any entitlement and no feature is gated';
      }
      if (config.stripePriceId) {
        assert(
          prices.includes(config.stripePriceId),
          `STRIPE_PRICE_ID ${config.stripePriceId} is not in ${loaded.source}: a checkout on it would grant nothing`,
        );
      }
      return `${prices.length} price(s) in ${loaded.source}`;
    },
  },
  {
    id: 'billing.events.none-stuck',
    title: 'Billing: no webhook event has been left unprocessed for more than an hour',
    kind: 'server',
    run: async ({ db }) => {
      const stuck = await db.query<{ event_id: string; type: string; error: string | null }>(
        `select event_id, type, error from billing_events
         where processed_at is null and received_at < now() - interval '1 hour'
         order by received_at limit 20`,
      );
      assert(
        !stuck.rows.length,
        `${stuck.rows.length} unprocessed event(s): ${stuck.rows.map((r) => `${r.event_id} (${r.type}${r.error ? `: ${r.error}` : ''})`).join('; ')}`,
      );
      const total = await db.query<{ n: number }>('select count(*)::int as n from billing_events');
      return `${Number(total.rows[0]?.n ?? 0)} event(s) in the ledger, none stuck`;
    },
  },
  {
    id: 'billing.subscriptions.attributed',
    title: 'Billing: every live subscription belongs to an account (no email guessing; unattributed ones listed here)',
    kind: 'server',
    run: async ({ db }) => {
      const orphans = await db.query<{ stripe_subscription_id: string; stripe_customer_id: string; status: string }>(
        `select stripe_subscription_id, stripe_customer_id, status from billing_subscriptions
         where user_id is null and status not in ('canceled', 'incomplete_expired')
         order by updated_at limit 20`,
      );
      const conflicts = await db.query<{ n: number }>(
        `select count(*)::int as n from billing_events
         where outcome in ('unattributed', 'customer-conflict') and received_at > now() - interval '30 days'`,
      );
      assert(
        !orphans.rows.length,
        `${orphans.rows.length} subscription(s) with no account: ${orphans.rows.map((r) => `${r.stripe_subscription_id} (customer ${r.stripe_customer_id}, ${r.status})`).join('; ')}. Link the customer to the right account by hand (users.stripe_customer_id), then resend the event from the Stripe Dashboard.`,
      );
      return `every non-terminal subscription is attributed; ${Number(conflicts.rows[0]?.n ?? 0)} unattributed/conflicting event(s) in the last 30 days`;
    },
  },
  /* ==== /BEUK:billing ==== */

  /* ---- Data invariants ---- */
  {
    id: 'data.exports.no-orphan-files',
    title: 'Export archive: no orphan files or rows',
    kind: 'server',
    run: async ({ db, config }) => {
      const rows = await db.query<{ id: string; user_id: string }>(
        'select id, user_id from exports',
      );
      const rowKeys = new Set(rows.rows.map((r) => `${r.user_id}/${r.id}`));
      const fileKeys = new Set<string>();
      let userDirs: string[] = [];
      try {
        userDirs = await readdir(config.exportDir);
      } catch {
        userDirs = [];
      }
      for (const userDir of userDirs) {
        if (userDir.startsWith('.')) continue;
        const files = await readdir(path.join(config.exportDir, userDir)).catch(() => [] as string[]);
        for (const file of files) fileKeys.add(`${userDir}/${file}`);
      }
      const orphanFiles = [...fileKeys].filter((k) => !rowKeys.has(k));
      const orphanRows = [...rowKeys].filter((k) => !fileKeys.has(k));
      assert(
        !orphanFiles.length && !orphanRows.length,
        [
          orphanFiles.length ? `files without rows: ${orphanFiles.slice(0, 3).join(', ')}` : '',
          orphanRows.length ? `rows without files: ${orphanRows.slice(0, 3).join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('; '),
      );
      return `${rowKeys.size} exports, files and rows agree`;
    },
  },
  {
    id: 'data.exports.sha256-reverify',
    title: 'Export archive: stored bytes still match their SHA-256',
    kind: 'server',
    run: async ({ db, config }) => {
      const rows = await db.query<{ id: string; user_id: string; sha256: string }>(
        'select id, user_id, sha256 from exports',
      );
      const bad: string[] = [];
      for (const row of rows.rows) {
        const file = path.join(config.exportDir, row.user_id, row.id);
        let bytes: Buffer;
        try {
          bytes = await readFile(file);
        } catch {
          bad.push(`${row.id}: file missing`);
          continue;
        }
        const actual = createHash('sha256').update(bytes).digest('hex');
        if (actual !== row.sha256) bad.push(`${row.id}: sha256 mismatch`);
      }
      assert(!bad.length, `corrupted exports: ${bad.slice(0, 3).join('; ')}`);
      return `${rows.rows.length} export(s) re-hashed, all match`;
    },
  },
  {
    id: 'data.manuscripts.revision-valid',
    title: 'Every shelf manuscript carries a valid concurrency revision',
    kind: 'server',
    run: async ({ db }) => {
      // Optimistic concurrency (migration 009): PUT is refused with 409
      // unless it names the current revision, so a row with a missing
      // or non-positive revision could never be saved again.
      const rows = await db.query<{ total: string; bad: string }>(
        'select count(*)::text as total, count(*) filter (where revision is null or revision < 1)::text as bad from manuscripts',
      );
      const { total, bad } = rows.rows[0] ?? { total: '0', bad: '0' };
      assert(bad === '0', `${bad} manuscript(s) carry an invalid revision`);
      return `${total} manuscript(s), every revision >= 1`;
    },
  },
  {
    id: 'data.backup.tables-classified',
    title: 'Every database table is either backed up or excluded on purpose (with a reason)',
    kind: 'server',
    run: async ({ db }) => {
      // Fails the day a migration adds a table nobody classified: an
      // unclassified table is silently missing from every backup, and a
      // restore's `delete from users` cascade could wipe it.
      const c = await classifyTables(db);
      assert(!c.unclassified.length, `tables in neither BACKUP_TABLES nor EXCLUDED_TABLES: ${c.unclassified.join(', ')}`);
      assert(!c.both.length, `tables in both lists: ${c.both.join(', ')}`);
      assert(!c.missing.length, `listed tables the database does not have: ${c.missing.join(', ')}`);
      return `${c.total} tables: ${BACKUP_TABLES.length} backed up, ${Object.keys(EXCLUDED_TABLES).length} excluded with a reason`;
    },
  },
  {
    id: 'backup.schedule.running',
    title: 'Scheduled local backups are running (BACKUP_INTERVAL_HOURS)',
    kind: 'server',
    run: async ({ config }) => verdict(await scheduleHealth(config)),
  },
  {
    id: 'backup.offsite.fresh',
    title: 'The last off-site backup (restic -> B2) succeeded and is recent (OFFSITE_MAX_AGE_HOURS)',
    kind: 'server',
    run: async ({ config }) => verdict(await offsiteFreshness(config)),
  },
  {
    id: 'backup.offsite.drill',
    title: 'The last restore drill of the off-site copy passed and is recent',
    kind: 'server',
    run: async ({ config }) => verdict(await drillHealth(config)),
  },
  {
    id: 'data.streak.ledger-consistent',
    title: 'Streak ledger is consistent',
    kind: 'server',
    run: async ({ db }) => {
      const count = async (sql: string): Promise<number> => {
        const result = await db.query<{ c: unknown }>(sql);
        return Number(result.rows[0]?.c ?? 0);
      };
      const missingState = await count(
        'select count(*) as c from users u left join streak_state s on s.user_id = u.id where s.user_id is null',
      );
      const overlaps = await count(
        'select count(*) as c from streak_freezes f join streak_days d on d.user_id = f.user_id and d.day = f.day',
      );
      const negative = await count(
        'select count(*) as c from streak_state where freezes_available < 0',
      );
      assert(missingState === 0, `${missingState} user(s) have no streak_state row`);
      assert(overlaps === 0, `${overlaps} day(s) are both activity and freeze in the ledger`);
      assert(negative === 0, `${negative} user(s) have a negative freeze balance`);
      return 'every user has streak state; no day is both active and frozen; balances non-negative';
    },
  },

  /* ---- Feature 1: cover upload + cover landmark ---- */
  {
    id: 'HK-F1-01',
    title: 'Cover (PNG): image in package, cover.xhtml first in spine with epub:type="cover"',
    kind: 'server',
    run: async ({ fixtures }) => {
      const entries = entriesOf(fixtures.bookPng);
      assert(entries.has('OEBPS/Images/cover.png'), 'Images/cover.png missing from package');
      const opf = parseOpf(textOf(entries, 'OEBPS/package.opf'));
      assert(opf.spineHrefs[0] === 'Text/cover.xhtml', `first spine item is ${opf.spineHrefs[0]}`);
      assert(
        textOf(entries, 'OEBPS/Text/cover.xhtml').includes('epub:type="cover"'),
        'cover.xhtml carries no epub:type="cover"',
      );
      return 'cover.png packaged; cover.xhtml leads the spine as epub:type="cover"';
    },
  },
  {
    id: 'HK-F1-02',
    title: 'Cover: OPF declares properties="cover-image" and legacy meta name="cover"',
    kind: 'server',
    run: async ({ fixtures }) => {
      const entries = entriesOf(fixtures.bookPng);
      const raw = textOf(entries, 'OEBPS/package.opf');
      const opf = parseOpf(raw);
      const item = opf.items.find((i) => i.href === 'Images/cover.png');
      assert(item?.properties.includes('cover-image'), 'cover item lacks properties="cover-image"');
      assert(raw.includes('<meta name="cover"'), 'legacy <meta name="cover"> missing');
      return 'cover-image property and legacy cover meta both declared';
    },
  },
  {
    id: 'HK-F1-03',
    title: 'Cover: nav landmarks carry cover with toc + bodymatter; cover kept out of the toc list',
    kind: 'server',
    run: async ({ fixtures }) => {
      const entries = entriesOf(fixtures.bookPng);
      const { landmarks, tocHrefs } = navParts(textOf(entries, 'OEBPS/nav.xhtml'));
      for (const needed of ['cover', 'toc', 'bodymatter']) {
        assert(landmarks.has(needed), `landmarks missing ${needed}`);
      }
      assert(
        !tocHrefs.some((href) => href.includes('cover.xhtml')),
        'cover.xhtml appears in the toc nav list',
      );
      return 'landmarks: cover, toc, bodymatter; toc list has no cover entry';
    },
  },
  {
    id: 'HK-F1-04',
    title: 'Cover (JPEG): image entry is cover.jpg with media-type image/jpeg',
    kind: 'server',
    run: async ({ fixtures }) => {
      const entries = entriesOf(fixtures.bookJpeg);
      assert(entries.has('OEBPS/Images/cover.jpg'), 'Images/cover.jpg missing from package');
      const opf = parseOpf(textOf(entries, 'OEBPS/package.opf'));
      const item = opf.items.find((i) => i.href === 'Images/cover.jpg');
      assert(item?.mediaType === 'image/jpeg', `cover media-type is ${item?.mediaType}`);
      return 'cover.jpg packaged as image/jpeg';
    },
  },
  {
    id: 'HK-F1-05',
    title: 'No cover: package is the pre-feature baseline (no cover files, no cover landmark)',
    kind: 'server',
    run: async ({ fixtures }) => {
      const zipEntries = readZip(fixtures.bookNoCover);
      assert(
        !zipEntries.some((e) => /cover\.(png|jpe?g)$/i.test(e.name) || e.name.endsWith('cover.xhtml')),
        'coverless book unexpectedly contains cover files',
      );
      const { landmarks } = navParts(textOf(entriesOf(fixtures.bookNoCover), 'OEBPS/nav.xhtml'));
      assert(!landmarks.has('cover'), 'coverless book has a cover landmark');
      assert(landmarks.has('toc') && landmarks.has('bodymatter'), 'baseline landmarks missing');
      return 'no cover files, no cover landmark; toc + bodymatter intact';
    },
  },
  {
    id: 'HK-F1-06',
    title: 'Cover is excluded from word counts and tier progress',
    kind: 'client-only',
    reason:
      'Word counts and Front/Body/Back progress are computed in the client editor over manuscript state; the server has no word-count engine.',
  },

  /* ---- Feature 2: platform export presets ---- */
  {
    id: 'HK-F2-01',
    title: 'Generic preset is the unchanged original package and the default',
    kind: 'client-only',
    reason:
      'Preset selection and the default live in the client Export dialog; the server stores the resulting package, it does not choose presets.',
  },
  {
    id: 'HK-F2-02',
    title: 'Each preset download filename carries its suffix (-kdp, -apple-books, …)',
    kind: 'client-only',
    reason:
      'Download filenames are generated in the client at export time; the archive keeps the name it was given.',
  },
  {
    id: 'HK-F2-03',
    title: 'Identifier honesty: an identifier is present and no ASIN/store id is fabricated',
    kind: 'server',
    run: async ({ fixtures }) => {
      const entries = entriesOf(fixtures.bookPng);
      const raw = textOf(entries, 'OEBPS/package.opf');
      assert(/<dc:identifier[^>]*>[^<]+<\/dc:identifier>/.test(raw), 'OPF has no dc:identifier value');
      for (const entry of readZip(fixtures.bookPng)) {
        assert(
          !entry.data.toString('utf8').includes('ASIN'),
          `${entry.name} contains a fabricated ASIN`,
        );
      }
      return 'dc:identifier present (ISBN or book UUID upstream); no ASIN anywhere in the package';
    },
  },
  {
    id: 'HK-F2-04',
    title: 'KDP/Nook presets: OPF carries a <guide> (cover/contents/start)',
    kind: 'server',
    run: async ({ fixtures }) => {
      const opf = parseOpf(textOf(entriesOf(fixtures.bookJpeg), 'OEBPS/package.opf'));
      for (const type of ['cover', 'toc', 'text']) {
        assert(opf.guideTypes.includes(type), `guide is missing a ${type} reference`);
      }
      return `guide references present: ${opf.guideTypes.join(', ')}`;
    },
  },
  {
    id: 'HK-F2-05',
    title: 'Apple Books preset: ibooks display-options file + schema.org accessibility metadata',
    kind: 'server',
    run: async ({ fixtures }) => {
      const entries = entriesOf(fixtures.bookPng);
      assert(
        entries.has('META-INF/com.apple.ibooks.display-options.xml'),
        'com.apple.ibooks.display-options.xml missing',
      );
      const raw = textOf(entries, 'OEBPS/package.opf');
      assert(raw.includes('schema:accessibilityFeature'), 'no schema.org accessibility metadata');
      return 'ibooks display-options packaged; accessibility metadata present';
    },
  },
  {
    id: 'HK-F2-06',
    title: 'Draft2Digital combines guide + Apple file + accessibility metadata (Kobo: a11y present)',
    kind: 'server',
    run: async ({ fixtures }) => {
      const entries = entriesOf(fixtures.bookPng);
      const opf = parseOpf(textOf(entries, 'OEBPS/package.opf'));
      assert(opf.guideTypes.length >= 3, 'combined package lost its guide');
      assert(entries.has('META-INF/com.apple.ibooks.display-options.xml'), 'combined package lost the Apple file');
      assert(opf.raw.includes('schema:'), 'combined package lost accessibility metadata');
      const kobo = parseOpf(textOf(entriesOf(fixtures.bookJpeg), 'OEBPS/package.opf'));
      assert(kobo.raw.includes('schema:'), 'Kobo-shape package lost accessibility metadata');
      return 'combined preset carries guide + Apple file + a11y metadata together';
    },
  },
  {
    id: 'HK-F2-07',
    title: 'Export tree, preset panel, checklist and Package Inspector reflect the same preset',
    kind: 'client-only',
    reason:
      'These are four client UI surfaces over one generator; consistency between them is a client rendering property.',
  },

  /* ---- Feature 3: footnotes/endnotes + images ---- */
  {
    id: 'HK-F3-01',
    title: 'Notes: noteref/endnote semantics with working back-links',
    kind: 'server',
    run: async ({ fixtures }) => {
      const chapter = textOf(entriesOf(fixtures.bookPng), 'OEBPS/Text/ch1.xhtml');
      assert(chapter.includes('epub:type="noteref"'), 'chapter has no epub:type="noteref" anchor');
      assert(chapter.includes('epub:type="endnote"'), 'chapter has no epub:type="endnote" aside');
      assert(chapter.includes('href="#fnref1"'), 'endnote has no back-link to its reference');
      const anchors = checkStatus(fixtures.bookPng, 'anchors-resolve');
      assert(anchors.status === 'pass', `anchor check failed: ${anchors.detail}`);
      return 'noteref + endnote semantics present; back-link resolves';
    },
  },
  {
    id: 'HK-F3-02',
    title: 'Undefined refs degrade to plain superscripts; duplicate refs share one note',
    kind: 'client-only',
    reason:
      'Reference resolution happens in the client generator while typesetting; the server receives only the finished package.',
  },
  {
    id: 'HK-F3-03',
    title: 'Images: packaged once in the manifest, file present, alt text set, full-bleed class honoured',
    kind: 'server',
    run: async ({ fixtures }) => {
      const entries = entriesOf(fixtures.bookPng);
      const opf = parseOpf(textOf(entries, 'OEBPS/package.opf'));
      const plates = opf.items.filter((i) => i.href === 'Images/plate.png');
      assert(plates.length === 1, `plate.png appears ${plates.length} times in the manifest`);
      assert(entries.has('OEBPS/Images/plate.png'), 'plate.png file missing from package');
      const chapter = textOf(entries, 'OEBPS/Text/ch1.xhtml');
      const img = scanTags(chapter).find((t) => t.name === 'img');
      assert(img, 'chapter has no <img>');
      assert((img.attrs.alt ?? '').length > 0, 'chapter <img> has empty alt text');
      assert((img.attrs.class ?? '').includes('full-bleed'), 'chapter <img> lost its full-bleed class');
      return 'image manifest-deduped, packaged, alt text set, full-bleed class present';
    },
  },
  {
    id: 'HK-F3-04',
    title: 'Excluded sections are skipped by note/image processing',
    kind: 'client-only',
    reason:
      'Section exclusion is applied by the client generator when building the package; nothing server-side re-processes sections.',
  },
  {
    id: 'HK-F3-05',
    title: 'Notes and images also render in standalone HTML and Markdown exports',
    kind: 'client-only',
    reason:
      'The standalone HTML and Markdown generators run in the client; the server archives their output without re-rendering it.',
  },
  {
    id: 'HK-F3-06',
    title: 'Word counts strip note/image markers',
    kind: 'client-only',
    reason:
      'Word counting is a client editor statistic; the server never counts manuscript words.',
  },

  /* ---- Feature 4: box sets + DOCX export ---- */
  {
    id: 'boxset.structure.dividers-titlepages-spine',
    title: 'Box set: divider + title page per book, spine in volume order',
    kind: 'server',
    run: async ({ fixtures }) => {
      const opf = parseOpf(textOf(entriesOf(fixtures.boxSet), 'OEBPS/package.opf'));
      const expected = [
        'Text/vol01-divider.xhtml',
        'Text/vol01-title.xhtml',
        'Text/vol01-ch1.xhtml',
        'Text/vol02-divider.xhtml',
        'Text/vol02-title.xhtml',
        'Text/vol02-ch1.xhtml',
      ];
      assert(
        JSON.stringify(opf.spineHrefs) === JSON.stringify(expected),
        `spine order is ${opf.spineHrefs.join(' → ')}`,
      );
      return 'spine runs divider → title → chapters, book by book';
    },
  },
  {
    id: 'boxset.toc.combined-parts',
    title: 'Box set: one combined TOC with each book as a part',
    kind: 'server',
    run: async ({ fixtures }) => {
      const nav = textOf(entriesOf(fixtures.boxSet), 'OEBPS/nav.xhtml');
      const nested = (nav.match(/<ol>/g) ?? []).length;
      assert(nested >= 3, `combined TOC has ${nested} lists (expected a root + one per book)`);
      assert(nav.includes('vol01-divider') && nav.includes('vol02-divider'), 'a book part is missing from the TOC');
      return 'combined TOC nests each book as a part with its sections';
    },
  },
  {
    id: 'boxset.carries.cover-images-notes',
    title: 'Box set: each book’s cover, images and endnotes carry over',
    kind: 'server',
    run: async ({ fixtures }) => {
      const entries = entriesOf(fixtures.boxSet);
      const opf = parseOpf(textOf(entries, 'OEBPS/package.opf'));
      assert(
        opf.items.some((i) => i.properties.includes('cover-image')),
        'box set lost its cover-image declaration',
      );
      assert(entries.has('OEBPS/Images/vol01-cover.png'), 'book one cover image missing');
      assert(entries.has('OEBPS/Images/vol02-plate.png'), 'book two plate image missing');
      const vol02 = textOf(entries, 'OEBPS/Text/vol02-ch1.xhtml');
      assert(vol02.includes('epub:type="endnote"'), 'book two endnotes did not carry over');
      return 'cover, per-book images and endnotes all present in the combined package';
    },
  },
  {
    id: 'docx.package.structure',
    title: 'DOCX: package has content types, document and styles parts',
    kind: 'server',
    run: async ({ fixtures }) => {
      const entries = entriesOf(fixtures.docx);
      for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml']) {
        assert(entries.has(part), `DOCX is missing ${part}`);
      }
      return 'DOCX parts present: [Content_Types].xml, _rels/.rels, word/document.xml, word/styles.xml';
    },
  },
  {
    id: 'docx.content.headings-scenebreak-endnotes',
    title: 'DOCX: Title/Heading styles, centred scene break, note once under Endnotes',
    kind: 'server',
    run: async ({ fixtures }) => {
      const doc = textOf(entriesOf(fixtures.docx), 'word/document.xml');
      assert(doc.includes('w:val="Title"'), 'document has no Title-styled paragraph');
      assert(doc.includes('w:val="Heading1"'), 'document has no Heading1 chapter headings');
      assert(doc.includes('* * *'), 'scene-break ornament missing from the document');
      const endnotesAt = doc.indexOf('Endnotes');
      assert(endnotesAt !== -1, 'no Endnotes heading');
      const noteText = 'The fixture note.';
      assert(doc.split(noteText).length - 1 === 1, 'the note text does not appear exactly once');
      assert(doc.indexOf(noteText) > endnotesAt, 'the note does not sit under Endnotes');
      return 'Title + Heading styles, scene break present, note appears once, after Endnotes';
    },
  },

  /* ---- Feature 5: font/theme library (all client-side) ---- */
  {
    id: 'fonts.library.expanded-shelf',
    title: 'Font library: the expanded serif/sans shelf is offered',
    kind: 'client-only',
    reason: 'The font shelf is client Typography state; fonts load from Google Fonts in the browser.',
  },
  {
    id: 'fonts.each.reaches-export-css',
    title: 'Every selectable font reaches the exported CSS',
    kind: 'client-only',
    reason:
      'Export CSS is generated in the client from the selected font; the server archives the finished package without re-typesetting it.',
  },
  {
    id: 'fonts.sans.clean-stack',
    title: 'Sans faces resolve to sans-serif stacks',
    kind: 'client-only',
    reason: 'Font-stack resolution happens in the client stylesheet builder.',
  },
  /* BEUK:scriptfonts — Amiri (Arabic script) + Noto Serif Devanagari (Hindi) */
  {
    id: 'fonts.script.preview-faces',
    title: 'Live preview sets Hindi and Arabic text in Noto Serif Devanagari and Amiri, loaded from this origin; Latin text keeps the chosen face',
    kind: 'client-only',
    reason:
      'Which face draws a character is the browser’s font matching over the studio stylesheet (asserted by window.runBeukAsyncSelfChecks()). The files, sha256s, licences and the renderer lock are tests/script-fonts.test.ts.',
  },
  {
    id: 'epub.fonts.script-embedded',
    title: 'A Hindi or Arabic book’s EPUB embeds its script face (font/ttf, @font-face + OFL), Arabic pages carry dir="rtl", the package validates',
    kind: 'client-only',
    reason:
      'The EPUB is assembled in the client from the book state and the same-origin font files (asserted by window.runBeukAsyncSelfChecks()); the server archives the finished package without re-typesetting it.',
  },
  /* BEUK:displayfaces — Pinyon Script, Patrick Hand, Abril Fatface: headings only */
  {
    id: 'fonts.display.heading-only',
    title: 'Display faces are heading choices only: they reach the chapter title and drop cap at weight 400 in preview and export CSS, never the body',
    kind: 'client-only',
    reason:
      'The heading and body stacks are built by the client stylesheet generator (asserted by window.runBeukSelfChecks()). The files, sha256s, licences and the renderer lock are tests/fonts-selfhosted.test.ts.',
  },
  {
    id: 'fonts.display.preview-and-epub',
    title: 'Display faces load from this origin in the preview, and an EPUB whose headings wear one embeds its TrueType with the OFL',
    kind: 'client-only',
    reason:
      'Font matching is the browser’s and the EPUB is assembled in the client from the book state and the same-origin font files (asserted by window.runBeukAsyncSelfChecks()).',
  },
  /* BEUK:bookcolour — a book's accent colour and page tint */
  {
    id: 'colour.accent.reaches-every-output',
    title: 'The book’s accent colour reaches chapter titles, numbers, drop caps, ornaments and the title page in preview, EPUB and print CSS; print blends the accent; the tint never reaches paper',
    kind: 'client-only',
    reason: 'Every surface’s CSS is generated in the client from the book state (asserted by window.runBeukSelfChecks()); tests/book-colour.test.ts checks the code statically.',
  },
  {
    id: 'colour.unset.css-identical',
    title: 'With no colour set, the book CSS, print tints and the book document are exactly as before',
    kind: 'client-only',
    reason: 'The CSS is generated in the client (asserted by window.runBeukSelfChecks()).',
  },
  {
    id: 'colour.contrast.guard',
    title: 'Contrast guard: an accent under 3:1 on the page, or a tint under 4.5:1 for black text, is refused plainly and changes nothing',
    kind: 'client-only',
    reason: 'The guard runs in the studio when a colour is picked (asserted by window.runBeukSelfChecks()).',
  },
  {
    id: 'colour.persists-with-book',
    title: 'The book’s colour is saved with the book and carried by History snapshots',
    kind: 'client-only',
    reason: 'The book document is serialized in the client; the server stores it as it arrives (asserted by window.runBeukSelfChecks()).',
  },
  {
    id: 'colour.dark-surfaces.readable',
    title: 'On the studio’s dark surfaces (the OLED phone preview, zen in Candlelight) the accent is shown in a shade that reaches 3:1; the EPUB and print keep the colour chosen',
    kind: 'client-only',
    reason: 'The preview and zen CSS is generated in the client from the book state (asserted by window.runBeukSelfChecks()).',
  },
  {
    id: 'colour.print.black-ink-option',
    title: 'Print the accent in black ink: the print interior sets the accented elements in #000 and blends black for its tints, while screens and the EPUB keep the accent',
    kind: 'client-only',
    reason: 'The print interior HTML is assembled in the client from the book state (asserted by window.runBeukSelfChecks()); the server converts it as it arrives.',
  },
  {
    id: 'themes.library.count-shelves-shape',
    title: 'Theme library: 15 themes across six genre shelves, all references resolve',
    kind: 'client-only',
    reason: 'The theme gallery and its shelf layout are client UI; themes are bundles of client settings.',
  },
  {
    id: 'themes.apply.exports-pairing-header-ornament',
    title: 'Applying a theme exports its font pairing, header style and ornament',
    kind: 'client-only',
    reason: 'Theme application mutates client typesetting settings; the exported result is verified by the client registry.',
  },
  {
    id: 'themes.apply.then-overridable',
    title: 'A theme stays overridable by the fine-grain controls after applying',
    kind: 'client-only',
    reason: 'Post-apply overrides are editor interactions in the client.',
  },

  /* ---- Feature 6: print interiors (all client-side) ---- */
  {
    id: 'print.trims.page-dimensions',
    title: 'Print: every trim declares its true @page size',
    kind: 'client-only',
    reason: 'The paged-media stylesheet is generated in the client print view; the server has no print pipeline (PDF/X is M5).',
  },
  {
    id: 'print.margins.mirrored-gutter',
    title: 'Print: gutter mirrors onto the binding edge of :left/:right pages',
    kind: 'client-only',
    reason: 'Margin geometry lives in the client-generated print stylesheet.',
  },
  {
    id: 'print.margins.gutter-grows-with-pages',
    title: 'Print: gutter steps up with page count',
    kind: 'client-only',
    reason: 'The page-count margin table is applied by the client when assembling the interior.',
  },
  {
    id: 'print.chapters.page-break-rules',
    title: 'Print: chapter page-break rules follow the recto toggle',
    kind: 'client-only',
    reason: 'Chapter break rules are emitted by the client print stylesheet builder.',
  },
  {
    id: 'print.running-head-and-folio',
    title: 'Print: running head and folio sit in @page margin boxes',
    kind: 'client-only',
    reason: 'Margin-box content is part of the client-generated print stylesheet.',
  },
  {
    id: 'print.document.interior-only',
    title: 'Print: the interior excludes the cover and never claims PDF/X',
    kind: 'client-only',
    reason: 'Interior assembly and its on-screen PDF/X honesty note are client export behaviour.',
  },

  /* ---- Feature 7: structural validator ---- */
  {
    id: 'validator.clean-book.no-errors',
    title: 'Validator: a clean book validates with zero errors',
    kind: 'server',
    run: async ({ fixtures }) => {
      const failures = validateEpub(readZip(fixtures.bookPng)).filter((c) => c.status === 'fail');
      assert(!failures.length, `clean book failed: ${failures.map((f) => f.id).join(', ')}`);
      return 'all structural checks pass on the clean fixture book';
    },
  },
  {
    id: 'validator.catches.missing-file',
    title: 'Validator: a dropped chapter file is caught',
    kind: 'server',
    run: async () => {
      const damaged = fixtureEntries().bookPng.filter((e) => e.name !== 'OEBPS/Text/ch1.xhtml');
      const found = validateEpub(damaged).find((c) => c.id === 'manifest-matches-files');
      assert(found?.status === 'fail', 'dropped chapter was not caught by manifest-matches-files');
      return `caught: ${found.detail}`;
    },
  },
  {
    id: 'validator.catches.malformed-xml',
    title: 'Validator: malformed XML (unclosed OPF) is caught',
    kind: 'server',
    run: async () => {
      const damaged = fixtureEntries().bookPng.map((e) =>
        e.name === 'OEBPS/package.opf'
          ? { ...e, data: Buffer.from(e.data.toString('utf8').replace('</package>', '')) }
          : e,
      );
      const found = validateEpub(damaged).find((c) => c.id === 'xml-well-formed');
      assert(found?.status === 'fail', 'malformed OPF was not caught by xml-well-formed');
      return `caught: ${found.detail}`;
    },
  },
  {
    id: 'validator.catches.dangling-anchor',
    title: 'Validator: a link to a nonexistent anchor is caught',
    kind: 'server',
    run: async () => {
      const damaged = fixtureEntries().bookPng.map((e) =>
        e.name === 'OEBPS/Text/ch1.xhtml'
          ? {
              ...e,
              data: Buffer.from(
                e.data.toString('utf8').replace('</body>', '<p><a href="#nowhere">x</a></p></body>'),
              ),
            }
          : e,
      );
      const found = validateEpub(damaged).find((c) => c.id === 'anchors-resolve');
      assert(found?.status === 'fail', 'dangling anchor was not caught by anchors-resolve');
      return `caught: ${found.detail}`;
    },
  },
  {
    id: 'validator.catches.missing-alt',
    title: 'Validator: an <img> stripped of alt text is caught',
    kind: 'server',
    run: async () => {
      const damaged = fixtureEntries().bookPng.map((e) =>
        e.name === 'OEBPS/Text/ch1.xhtml'
          ? { ...e, data: Buffer.from(e.data.toString('utf8').replace(' alt="A fixture plate illustration"', '')) }
          : e,
      );
      const found = validateEpub(damaged).find((c) => c.id === 'image-alt');
      assert(found?.status === 'fail', 'missing alt was not caught by image-alt');
      return `caught: ${found.detail}`;
    },
  },
  {
    id: 'validator.catches.undeclared-cover',
    title: 'Validator: a cover image without its cover-image declaration is caught',
    kind: 'server',
    run: async () => {
      const damaged = fixtureEntries().bookPng.map((e) =>
        e.name === 'OEBPS/package.opf'
          ? { ...e, data: Buffer.from(e.data.toString('utf8').replace(' properties="cover-image"', '')) }
          : e,
      );
      const found = validateEpub(damaged).find((c) => c.id === 'cover-declared');
      assert(found?.status === 'fail', 'undeclared cover was not caught by cover-declared');
      return `caught: ${found.detail}`;
    },
  },

  /* ---- SaaS wiring: cloud sync (all client-side) ---- */
  {
    id: 'cloud.roundtrip.serialize-save-load',
    title: 'Cloud round-trip: serialize → save → load preserves the manuscript',
    kind: 'client-only',
    reason:
      'The round-trip runs through the client serializer and its API client; the server stores the book as opaque JSON by design.',
  },
  {
    id: 'cloud.signedout.no-api-calls',
    title: 'Signed out, the studio makes no API calls',
    kind: 'client-only',
    reason: 'Network behavior of the signed-out client is observable only in the browser.',
  },
  {
    id: 'cloud.fallback.api-down-runs-local',
    title: 'API unreachable: the studio runs silently in local-only mode',
    kind: 'client-only',
    reason: 'The availability probe and the silent fallback are client behavior.',
  },
  {
    id: 'cloud.streak.server-wins-when-signed-in',
    title: 'Signed in, the server streak is shown; signed out, the local streak',
    kind: 'client-only',
    reason: 'Which streak renders is a client display decision over the two sources.',
  },
  {
    id: 'local.autosave.roundtrip',
    title: 'Local-first saving: the book (images, fonts, cover, history) is written to IndexedDB and restored on reload',
    kind: 'client-only',
    reason: 'IndexedDB lives in the writer’s browser; the server never sees the device copy.',
  },
  {
    id: 'local.indicator.honest',
    title: 'Local save indicator: saving, saved, and every failure state (storage blocked, quota full) are shown honestly',
    kind: 'client-only',
    reason: 'The indicator is header UI driven by the browser’s storage outcome.',
  },
  {
    id: 'local.conflict.409-routes-to-notice',
    title: 'A 409 from the shelf (stale revision) raises the conflict notice instead of overwriting',
    kind: 'client-only',
    reason: 'The server half runs in tests/manuscripts.test.ts; routing the 409 into the conflict notice is client UI (async network path, exercised by the studio browser run, not the synchronous in-studio checks).',
  },
  {
    id: 'local.shelf-save.serialized',
    title: 'Shelf saves from one device never overlap: a save asked for mid-upload runs once afterwards, on the new revision (no false conflict notice, no duplicate shelf copy)',
    kind: 'client-only',
    reason: 'Save sequencing is client behavior over an async network path; exercised by the studio browser run (slow-uplink race proof), not the synchronous in-studio checks.',
  },
  {
    id: 'cloud.epubcheck.result-in-plain-language',
    title: 'EPUBCheck job results render in plain language in the Export dialog',
    kind: 'client-only',
    reason: 'The server runs the job and stores its result; the plain-language rendering is client UI.',
  },

  /* ---- PDF/X job: the HTML → PDF rendition step (M5 follow-up) ---- */
  {
    id: 'jobs.pdfx.rendition.unconfigured-fails-honestly',
    title: 'PDF/X rendition unconfigured: the problem string says so before anything runs',
    kind: 'server',
    run: async ({ config }) => {
      const problem = pdfRenderProblem({ ...config, rendererUrl: null });
      assert(
        problem !== null && problem.includes('RENDERER_URL'),
        'expected an honest not-configured problem naming RENDERER_URL',
      );
      const legacy = pdfRenderProblem({ ...config, rendererUrl: null, legacyHtmlPdfBin: '/usr/bin/chromium' });
      assert(
        legacy !== null && legacy.includes('HTML_PDF_BIN is set but no longer used'),
        'a leftover HTML_PDF_BIN must be named as ignored, never silently used',
      );
      return 'an unconfigured renderer yields a named, honest problem string; a leftover HTML_PDF_BIN is named as ignored';
    },
  },
  {
    id: 'jobs.pdfx.rendition.renderer-isolated',
    title: 'Tools overlay renders print HTML in an isolated renderer, never in the app container',
    kind: 'server',
    run: async () => {
      // The pdfx job's Chromium interprets USER-SUPPLIED HTML. It must
      // live in its own service with no secrets, no volumes, no route
      // out and no database — and must be gone from the app image. This
      // case reads the deploy files the app image carries and fails,
      // naming the gap, the moment any of that drifts.
      const deploy = path.join(repoRoot(), 'deploy');
      const toolsDockerfile = await readFile(path.join(deploy, 'Dockerfile.tools'), 'utf8');
      const withoutComments = (text: string): string =>
        text
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('#'))
          .join('\n');
      const installs = withoutComments(toolsDockerfile);
      assert(
        !/(^|\s)chromium(\s|$)/m.test(installs),
        'deploy/Dockerfile.tools installs chromium into the APP image — user HTML would run next to the app secrets',
      );
      const rendererDockerfile = await readFile(path.join(deploy, 'renderer', 'Dockerfile'), 'utf8');
      assert(
        /(^|\s)chromium(\s|$)/m.test(withoutComments(rendererDockerfile)),
        'deploy/renderer/Dockerfile does not install chromium',
      );
      const server = await readFile(path.join(deploy, 'renderer', 'server.mjs'), 'utf8');
      for (const fence of [
        'setRequestInterception(true)',
        'setJavaScriptEnabled(false)',
        "request.abort('blockedbyclient')",
        '--host-resolver-rules=MAP * ~NOTFOUND',
        "script-src 'none'",
      ]) {
        assert(server.includes(fence), `deploy/renderer/server.mjs lost its fence: ${fence}`);
      }
      const compose = (
        await readFile(path.join(deploy, 'docker-compose.tools.yml'), 'utf8')
      ).replace(/\r\n/g, '\n');
      /** The lines of one YAML block (by exact key line), comments dropped. */
      const block = (name: string, indent: string): string[] => {
        const lines = compose.split('\n');
        const at = lines.findIndex((l) => l === `${indent}${name}:`);
        assert(at >= 0, `deploy/docker-compose.tools.yml has no "${name}" block`);
        const out: string[] = [];
        for (const line of lines.slice(at + 1)) {
          if (line.trimStart().startsWith('#')) continue;
          if (line.trim() && !line.startsWith(indent + ' ')) break;
          out.push(line);
        }
        return out;
      };
      /** The "- item" entries listed directly under `key:` in a block. */
      const listUnder = (lines: string[], key: string): string[] => {
        const at = lines.findIndex((l) => l.trim() === `${key}:`);
        if (at < 0) return [];
        const items: string[] = [];
        for (const line of lines.slice(at + 1)) {
          const m = /^\s+- (.+)$/.exec(line);
          if (!m) break;
          items.push(m[1].trim());
        }
        return items;
      };
      const renderer = block('renderer', '  ');
      const rendererText = renderer.join('\n');
      const appText = block('app', '  ').join('\n');
      assert(appText.includes('RENDERER_URL'), 'the app service does not set RENDERER_URL');
      assert(!appText.includes('HTML_PDF_BIN'), 'the app service still sets HTML_PDF_BIN');
      assert(/^\s+read_only: true$/m.test(rendererText), 'renderer root filesystem is not read_only');
      assert(listUnder(renderer, 'cap_drop').includes('ALL'), 'renderer does not drop ALL capabilities');
      assert(
        listUnder(renderer, 'security_opt').includes('no-new-privileges:true'),
        'renderer lacks no-new-privileges',
      );
      assert(!/^\s+volumes:/m.test(rendererText), 'renderer mounts volumes');
      assert(!/^\s+ports:/m.test(rendererText), 'renderer publishes ports');
      assert(
        /^\s+mem_limit: /m.test(rendererText) && /^\s+pids_limit: /m.test(rendererText),
        'renderer has no memory/pids limit',
      );
      assert(
        !/DATABASE_URL|STRIPE|PEXELS|POSTGRES|SECRET|KEY/.test(rendererText),
        'renderer environment carries an app secret',
      );
      assert(
        listUnder(renderer, 'networks').join(',') === 'render',
        'renderer must be on the internal "render" network only',
      );
      const topNets = block('networks', '').join('\n');
      assert(/^ {2}render:\n {4}internal: true$/m.test(topNets), 'the "render" network is not internal: true');
      return 'renderer: own image with chromium, request/JS/DNS fences, read-only, cap_drop ALL, no-new-privileges, no volumes/ports/secrets, internal network only; app image carries no chromium and points RENDERER_URL at it';
    },
  },
  {
    id: 'jobs.pdfx.result-in-plain-language',
    title: 'PDF/X job results render in plain language in the Export dialog',
    kind: 'client-only',
    reason: 'The server runs the job and stores its result; the plain-language rendering is client UI.',
  },

  /* ==== BEUK:store ==== */
  /* ---- Store-ready? report (KDP + IngramSpark verdict) ---- */
  {
    id: 'jobs.pdfx.inspection-reads-facts',
    title: 'PDF/X results carry an inspection of the converted file: pages, page box, PDF/X declaration, font embedding, RGB left',
    kind: 'server',
    run: async () => {
      const pdf = Buffer.from(
        '%PDF-1.3\n' +
          '1 0 obj\n<< /Type /Pages /Kids [2 0 R] /Count 1 /MediaBox [0 0 432 648] >>\nendobj\n' +
          '2 0 obj\n<< /Type /Page /Parent 1 0 R >>\nendobj\n' +
          '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' +
          '4 0 obj\n<< /GTS_PDFXVersion (PDF/X-1:2001) /GTS_PDFXConformance (PDF/X-1a:2001) >>\nendobj\n' +
          'trailer\n<< /Info 4 0 R >>\n%%EOF\n',
        'latin1',
      );
      const r = inspectPdf(pdf);
      assert(r.pageCount === 1, `expected 1 page, read ${r.pageCount}`);
      assert(r.firstPage.mediaBox?.w === 6 && r.firstPage.mediaBox?.h === 9, 'expected a 6 × 9 in page box');
      assert(r.pdfx.conformance === 'PDF/X-1a:2001', 'expected the declared X-1a conformance to be read');
      assert(r.fontsAllEmbedded === false, 'an unembedded Helvetica must be reported as unembedded, never as embedded');
      return '1 page, 6 × 9 in, PDF/X-1a:2001 declared, unembedded font reported as unembedded';
    },
  },
  {
    id: 'jobs.pdfx.safer-permits-icc',
    title: 'Ghostscript runs under SAFER with read access to exactly the ICC profile the PDF/X definition embeds',
    kind: 'server',
    run: async ({ config }) => {
      const icc = pdfxIccPath(config.pdfxDefPath);
      assert(icc, `the PDF/X definition at ${config.pdfxDefPath} names no /BeukICCPath`);
      const args = ghostscriptPdfxArgs(config, '/in.pdf', '/out.pdf');
      assert(args[0] === '-dSAFER', 'SAFER must be spelled out as the first Ghostscript argument');
      // Exactly two things may be read beyond the inputs: the profile the
      // definition embeds, and (when PDFX_ICC_DIR is set) the colour-
      // conversion profile directory.
      const permits = args.filter((a) => a.startsWith('--permit-file-read'));
      const allowed = [`--permit-file-read=${icc}`, ...pdfxIccDirArgs(config).filter((a) => a.startsWith('--permit-file-read'))];
      assert(
        permits.length === allowed.length && allowed.every((a) => permits.includes(a)),
        `Ghostscript must permit reading exactly the embedded ICC profile${config.pdfxIccDir ? ' and the conversion profile directory' : ''}; it permits ${permits.join(' ')}`,
      );
      assert(!args.includes('-dNOSAFER'), 'SAFER must stay on');
      const def = await readFile(config.pdfxDefPath, 'latin1');
      assert(def.includes('/GTS_PDFXConformance (PDF/X-1a:2001)'), 'the definition must declare PDF/X-1a:2001 conformance');
      return `permit-file-read ${icc}; SAFER on; X-1a conformance declared`;
    },
  },
  {
    id: 'jobs.pdfx.icc-profile-matches-def',
    title: 'PDF/X press profile: the definition file names the pinned CMYK profile and its condition; the installed file is those exact bytes (checked whenever PDF/X is configured or the file is present)',
    kind: 'server',
    run: async ({ config }) => {
      // With GS_BIN set the server claims PDF/X works, so the profile
      // file MUST be there and be the pinned bytes. Without it, the def
      // file is still checked and the detail says the file was not.
      const check = checkPdfxProfile(config, config.gsBin !== null);
      assert(check.ok, check.detail);
      return check.detail;
    },
  },
  /* ==== BEUK:print ==== */
  {
    id: 'jobs.pdfx.converts-through-press-profile',
    title: 'PDF/X colour conversion runs through the press profile the OutputIntent declares (Ghostscript’s default_cmyk.icc in PDFX_ICC_DIR is the pinned profile’s exact bytes)',
    kind: 'server',
    run: async ({ config }) => {
      if (!config.pdfxIccDir) {
        // With GS configured, converting through Ghostscript's built-in
        // profile while declaring another is the dishonest state: fail.
        assert(config.gsBin === null, 'GS_BIN is set but PDFX_ICC_DIR is not, so conversions use Ghostscript’s built-in CMYK profile, not the declared press profile');
        return 'PDF/X is not configured on this server (GS_BIN unset); nothing converts, so nothing to check';
      }
      const file = path.join(config.pdfxIccDir, 'default_cmyk.icc');
      const bytes = await readFile(file).catch(() => null);
      assert(bytes, `no default_cmyk.icc in PDFX_ICC_DIR (${config.pdfxIccDir})`);
      const sha = createHash('sha256').update(bytes).digest('hex');
      assert(sha === PDFX_PROFILE.sha256, `${file} is sha256 ${sha}, not the pinned press profile ${PDFX_PROFILE.sha256}`);
      const args = ghostscriptPdfxArgs(config, '/in.pdf', '/out.pdf');
      assert(args.some((a) => a.startsWith('-sICCProfilesDir=')), 'the pdfx Ghostscript call does not pass -sICCProfilesDir');
      return `${file} = pinned ${PDFX_PROFILE.path} (sha256 ${sha.slice(0, 12)}…); -sICCProfilesDir passed`;
    },
  },
  {
    id: 'jobs.pdfx.neutral-text-black-plate',
    title: 'PDF/X press: neutral RGB (black text, grey tints) is rewritten to DeviceGray before conversion, coloured values are untouched, and text colour is read back per text run',
    kind: 'server',
    run: async () => {
      const content = 'BT /F1 11 Tf 0 0 0 rg (A) Tj .25 .25 .25 rg (B) Tj 0.5 0.2 0.1 rg (C) Tj ET 1 1 1 RG';
      const pdf = Buffer.from(
        [
          '%PDF-1.4',
          '1 0 obj',
          '<< /Type /Catalog /Pages 2 0 R >>',
          'endobj',
          '2 0 obj',
          '<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 432 648] >>',
          'endobj',
          '3 0 obj',
          '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
          'endobj',
          '4 0 obj',
          `<< /Length ${content.length} >>`,
          'stream',
          content,
          'endstream',
          'endobj',
          'trailer',
          '<< /Size 5 /Root 1 0 R >>',
          'startxref',
          '0',
          '%%EOF',
          '',
        ].join('\n'),
        'latin1',
      );
      const out = neutralRgbToGray(pdf);
      assert(out.skipped === null, `the rewrite was skipped: ${out.skipped}`);
      assert(out.operators === 3, `expected 3 neutral operators rewritten (black, 25% grey, white stroke), got ${out.operators}`);
      assert(out.pdf.subarray(0, pdf.length).equals(pdf), 'the original bytes must stay verbatim ahead of the incremental update');
      const facts = textInkFacts(out.pdf);
      assert(facts.textShows === 3, `expected 3 text runs, read ${facts.textShows}`);
      assert(facts.kOnly === 2 && facts.kValues['100'] === 1 && facts.kValues['75'] === 1, `expected black + 75% grey as K-only, read ${JSON.stringify(facts.kValues)}`);
      assert(Object.keys(facts.otherColours).join() === '0.5 0.2 0.1 rg', `the coloured run must stay coloured, read ${JSON.stringify(facts.otherColours)}`);
      return 'black → 100% K, 25% grey → 75% K, coloured text untouched; original bytes kept ahead of the update';
    },
  },
  {
    id: 'print.press.solid-tints',
    title: 'Print for press: see-through text rules print as solid blended tints, body text is pure black, inline ornaments carry no opacity, the EPUB stylesheet is untouched',
    kind: 'client-only',
    reason: 'The print interior is built in the studio (buildPrintHtml); asserted by the client registry on the sample.',
  },
  {
    id: 'print.press.blend-math',
    title: 'Print for press: a solid tint is ink·a + page·(1 − a); an SVG part’s opacity becomes that solid fill',
    kind: 'client-only',
    reason: 'The blend and the SVG rewrite are studio functions; asserted by the client registry.',
  },
  {
    id: 'print.press.store-rows',
    title: 'Store-ready press rows (text in black ink, total ink) pass only on measured server facts; unmeasured is “not checked”',
    kind: 'client-only',
    reason: 'The rows are rendered in the studio from the pdfx job’s press facts; asserted by the client registry.',
  },
  /* ==== /BEUK:print ==== */
  {
    id: 'store.rules.cited-data',
    title: 'Store-ready: KDP and IngramSpark rules are data tables citing the stores’ own published guides',
    kind: 'client-only',
    reason: 'The rules table (STORE_RULES) and the report live in the studio; the server only supplies the PDF/X and EPUBCheck facts.',
  },
  {
    id: 'store.verdict.never-green-unchecked',
    title: 'Store-ready: a required check that could not run makes the verdict “Can’t confirm”, never “Ready”',
    kind: 'client-only',
    reason: 'The verdict is computed in the studio from the rows it rendered; asserted by the client registry.',
  },
  {
    id: 'store.dpi.sample-fails-honestly',
    title: 'Store-ready: the sample’s full-page paintings fail the 300 DPI rule with their measured DPI',
    kind: 'client-only',
    reason: 'Image placement and effective DPI are measured in the studio over the bundled sample.',
  },
  {
    id: 'store.trim.unsupported-fails',
    title: 'Store-ready: a trim the store does not print fails with a one-click switch to the nearest one it does',
    kind: 'client-only',
    reason: 'Trim choice and the one-click fix are studio state.',
  },
  {
    id: 'store.trim.paper-matrix',
    title: 'Store-ready: IngramSpark trims are checked per paper against its Trim Size Matrix; a blank cell is “not checked” (custom trim) or a fail, never a pass',
    kind: 'client-only',
    reason: 'The per-paper trim matrix and the paper choice live in the studio’s STORE_RULES.',
  },
  {
    id: 'store.spine.wrap-matches-store-factor',
    title: 'Store-ready: the wrap’s spine is checked against the store’s published per-page factor, and the fix makes it pass',
    kind: 'client-only',
    reason: 'The cover wrap and its spine math are computed in the studio.',
  },
  {
    id: 'store.report.download-carries-evidence',
    title: 'Store-ready: the downloaded report carries title, store, trim, pages, date, verdict, every check’s evidence and the sources',
    kind: 'client-only',
    reason: 'The report file is generated in the browser.',
  },
  /* ==== /BEUK:store ==== */

  /* ---- Sample story: the 0 ↔ 25K desk toggle (all client-side) ---- */
  {
    id: 'sample.book.scale-words-chapters',
    title: 'The bundled sample measures full-scale by the app’s own counter',
    kind: 'client-only',
    reason: 'The sample novella is bundled in the client; the server never holds it.',
  },
  {
    id: 'sample.epub.nav-every-chapter-and-notes',
    title: 'Sample EPUB: every chapter in nav, endnotes shipped',
    kind: 'client-only',
    reason: 'The package is generated in the client from the bundled sample; asserted by the client registry.',
  },
  {
    id: 'sample.load.idempotent-double-load',
    title: 'Loading the sample twice never stacks it',
    kind: 'client-only',
    reason: 'Load is an editor state interaction in the client.',
  },
  {
    id: 'sample.load.instant-single-swap',
    title: 'Load is a single synchronous swap — full count present immediately',
    kind: 'client-only',
    reason: 'Immediacy of the state swap is observable only in the client.',
  },
  {
    id: 'sample.toggle.empty-to-sample-to-empty',
    title: 'Remove empties the desk completely (0 ↔ 25K toggle, no restore)',
    kind: 'client-only',
    reason: 'Desk state lives in the client editor; there is no server-side desk.',
  },

  /* ---- Editor toolbar (all client-side) ---- */
  {
    id: 'editor.no-instruction-paragraph',
    title: 'No syntax-instruction paragraph anywhere in the editor UI',
    kind: 'client-only',
    reason: 'An absence in the client DOM; the server has no editor surface.',
  },
  {
    id: 'editor.toolbar.bold-italic-wrap',
    title: 'Toolbar Bold/Italic wrap a selection (and work at a bare cursor)',
    kind: 'client-only',
    reason: 'Toolbar actions are editor DOM interactions in the client.',
  },
  {
    id: 'editor.toolbar.blockquote-scenebreak',
    title: 'Toolbar Blockquote prefixes lines; Scene Break inserts a standalone *** line',
    kind: 'client-only',
    reason: 'Toolbar actions are editor DOM interactions in the client.',
  },
  {
    id: 'editor.toolbar.footnote-dialog-pair',
    title: 'Footnote dialog inserts a correctly numbered ref + definition pair',
    kind: 'client-only',
    reason: 'The dialog and its numbering run in the client editor.',
  },
  {
    id: 'editor.toolbar.image-line',
    title: 'Insert Image places a library image on its own line',
    kind: 'client-only',
    reason: 'The image picker and placement are client editor interactions.',
  },
  {
    id: 'editor.toolbar.layout',
    title: 'Editor toolbar layout: whole groups per row, rows filled, no edge dividers, no holes',
    kind: 'client-only',
    reason: 'Toolbar layout is measured from the rendered client DOM at the browser width; the server renders no editor.',
  },
  {
    id: 'editor.wordbar.live-counts',
    title: 'Word bar on the Content page: section and book counts, live',
    kind: 'client-only',
    reason:
      'The word bar (and the Zen pill that mirrors it) renders client editor statistics, refreshed by the client stats updater.',
  },

  /* ---- Book language & detection (all client-side) ---- */
  {
    id: 'lang.detect.german-prose',
    title: 'Detection: German prose detects as de',
    kind: 'client-only',
    reason: 'The detector runs in the client over manuscript text; the server stores books without analyzing them.',
  },
  {
    id: 'lang.detect.french-prose',
    title: 'Detection: French prose detects as fr',
    kind: 'client-only',
    reason: 'The detector runs in the client over manuscript text.',
  },
  {
    id: 'lang.detect.spanish-prose',
    title: 'Detection: Spanish prose detects as es',
    kind: 'client-only',
    reason: 'The detector runs in the client over manuscript text.',
  },
  {
    id: 'lang.detect.japanese-kana',
    title: 'Detection: Japanese kana detects as ja',
    kind: 'client-only',
    reason: 'Script-share analysis runs in the client.',
  },
  {
    id: 'lang.detect.chinese-han',
    title: 'Detection: Han text detects as zh-Hans/zh-Hant by character vote',
    kind: 'client-only',
    reason: 'Script-share analysis runs in the client.',
  },
  {
    id: 'lang.detect.arabic-rtl-epub',
    title: 'Arabic book exports dc:language ar with rtl page progression',
    kind: 'client-only',
    reason:
      'The assertion chains client detection → client export; the server fixture books carry no detected language.',
  },
  {
    id: 'lang.detect.english-stays-en',
    title: 'Detection: English text leaves the book en',
    kind: 'client-only',
    reason: 'The detector runs in the client over manuscript text.',
  },
  {
    id: 'lang.detect.gibberish-noop',
    title: 'Detection: gibberish changes nothing',
    kind: 'client-only',
    reason: 'The detector runs in the client over manuscript text.',
  },
  {
    id: 'lang.manual.survives-foreign-import',
    title: 'A manually chosen language is never overridden by import detection',
    kind: 'client-only',
    reason: 'The manual/detected precedence rule is client import behavior.',
  },
  {
    id: 'lang.autoformat.german-quotes',
    title: 'Auto-Format gives a German book German quotes („…”), not English ones',
    kind: 'client-only',
    reason: 'Auto-Format polishing runs in the client typesetting pipeline.',
  },
  {
    id: 'lang.count.chinese-characters',
    title: 'Chinese text counts by characters, not whitespace tokens',
    kind: 'client-only',
    reason: 'The counting engine is client-side, like all word counts (see HK-F1-06).',
  },

  /* ---- UI language packs (all client-side) ---- */
  {
    id: 'ui.packs.complete',
    title: 'Every UI string key exists and is non-empty in all 12 language packs',
    kind: 'client-only',
    reason: 'The string table and its packs live in the client bundle; the server renders no studio UI.',
  },
  {
    id: 'ui.switch.german-chrome',
    title: 'Switching the UI language re-renders the chrome in that language instantly',
    kind: 'client-only',
    reason: 'UI rendering is entirely client-side.',
  },
  {
    id: 'ui.rtl.arabic-chrome-book-keeps-its-direction',
    title: 'Arabic UI mirrors the chrome RTL while the book keeps its own direction',
    kind: 'client-only',
    reason: 'Chrome direction is a client layout decision driven by the UI locale.',
  },
  {
    id: 'ui.default.browser-language',
    title: 'First run, the UI defaults from the browser’s language',
    kind: 'client-only',
    reason: 'The browser language is only visible to the client.',
  },
  {
    id: 'ui.persist.choice-survives-reload',
    title: 'The UI language choice persists across reloads',
    kind: 'client-only',
    reason: 'The preference is stored in the client (local preference).',
  },
  {
    id: 'ui.independence.book-untouched',
    title: 'Switching UI language never changes the book’s language, stats or metadata',
    kind: 'client-only',
    reason: 'The independence rule is enforced in the client state model.',
  },
  {
    id: 'ui.intl.number-formats',
    title: 'Dates and numbers format via Intl for the active UI locale',
    kind: 'client-only',
    reason: 'Locale formatting happens at render time in the client.',
  },
  {
    id: 'ui.strings.detection-messages-localized',
    title: 'Detection toasts and messages render from the string table in the UI language',
    kind: 'client-only',
    reason: 'Toast rendering is client UI.',
  },
  {
    id: 'ui.font.default-karla',
    title: 'Default UI font is Karla across the chrome, Arabic fallback included',
    kind: 'client-only',
    reason:
      'Computed font resolution is a client rendering property; the --ui-font stack lives in the client stylesheet and leads with Karla. (Bricolage Grotesque was tried at the user’s direction on 2026-10-23, then replaced by Karla, also at the user’s direction; the case asserts representative chrome computes to Karla, including under an Arabic RTL UI with its fallback stack.)',
  },
  {
    id: 'ui.tagline.present',
    title: 'Header shows the brand tagline beside the Beuk wordmark lockup',
    kind: 'client-only',
    reason:
      'The tagline (“your EPUB & print studio”, string-table key brand.tagline, all 13 locales) is header chrome rendered by the client; it truncates as the bar narrows and hides below 1400px and in zen mode.',
  },
  {
    id: 'ui.brand.domain',
    title: 'Brand names beuk.studio; no tagline in any locale claims “free” or “open source”',
    kind: 'client-only',
    reason:
      'The header lockup, the page title and the 13-locale brand.tagline string table are client chrome. V decided on 2026-10-25: the sub-brand is the production domain beuk.studio, and the “free & open-source” claim is removed because the repo carries no licence. The case fails if either word returns in any locale.',
  },
  {
    id: 'ui.zen.mode-hides-the-room',
    title: 'Zen mode hides the structure pane, preview and topbar; leaving restores the room',
    kind: 'client-only',
    reason: 'Zen is a client body-class layout state over the studio chrome.',
  },
  /* ---- First-run quick tour (BEUK:tour) ---- */
  {
    id: 'tour.fresh-device-only',
    title: 'The quick tour offers itself only on a fresh device: never once finished or skipped, never where beuk.desk is set or a book is on the desk, not at all without storage',
    kind: 'client-only',
    reason: 'The quick tour is client UI state in the studio page (localStorage beuk.tour.v1 and beuk.desk, the desk restored from IndexedDB, layout at the window size); asserted by window.runBeukSelfChecks(). The static parts (strings in 13 locales, the keys, the target ids) are tests/tour.test.ts.',
  },
  {
    id: 'tour.never-over-dialog-or-zen',
    title: 'The quick tour never sits on top of an open dialog or Zen mode, and comes back at the same step after',
    kind: 'client-only',
    reason: 'The quick tour is client UI state in the studio page (localStorage beuk.tour.v1 and beuk.desk, the desk restored from IndexedDB, layout at the window size); asserted by window.runBeukSelfChecks(). The static parts (strings in 13 locales, the keys, the target ids) are tests/tour.test.ts.',
  },
  {
    id: 'tour.targets-visible',
    title: 'Every quick-tour step points at a real control that is on screen at the window size; the card stays inside the window',
    kind: 'client-only',
    reason: 'The quick tour is client UI state in the studio page (localStorage beuk.tour.v1 and beuk.desk, the desk restored from IndexedDB, layout at the window size); asserted by window.runBeukSelfChecks(). The static parts (strings in 13 locales, the keys, the target ids) are tests/tour.test.ts.',
  },
  {
    id: 'tour.skip-ends-for-good',
    title: 'Esc and Skip end the quick tour for good; Esc closing a menu leaves it; the last step ends at a first action, not a Done button',
    kind: 'client-only',
    reason: 'The quick tour is client UI state in the studio page (localStorage beuk.tour.v1 and beuk.desk, the desk restored from IndexedDB, layout at the window size); asserted by window.runBeukSelfChecks(). The static parts (strings in 13 locales, the keys, the target ids) are tests/tour.test.ts.',
  },
  {
    id: 'tour.no-overflow-rtl-phone',
    title: 'The quick tour fits in every interface language, Arabic right to left included, with no sideways scroll (run at 390 px for phone width)',
    kind: 'client-only',
    reason: 'The quick tour is client UI state in the studio page (localStorage beuk.tour.v1 and beuk.desk, the desk restored from IndexedDB, layout at the window size); asserted by window.runBeukSelfChecks(). The static parts (strings in 13 locales, the keys, the target ids) are tests/tour.test.ts.',
  },
  /* ---- Zen day cycle: the harbour's light follows time spent in Zen (BEUK:daycycle) ---- */
  {
    id: 'zen.day.no-reader',
    title: 'Zen harbour sketch carries no reader figure; horizon, harbour, water and reeds remain',
    kind: 'client-only',
    reason: 'The sketch is SVG built by the studio only while Zen is open; asserted in the browser by window.runBeukSelfChecks().',
  },
  {
    id: 'zen.day.advances',
    title: 'Zen day phase advances only with time in Zen, pauses while the tab is hidden or Zen is closed, and continues on re-entry',
    kind: 'client-only',
    reason: 'The phase is an in-memory clock in the studio page (visibilitychange, a 30 s timer); asserted with an injected clock by window.runBeukSelfChecks().',
  },
  {
    id: 'zen.day.holds-at-dusk',
    title: 'Zen day clamps at a soft dusk (phase 1) and holds; Paper never reaches night',
    kind: 'client-only',
    reason: 'The light table and the sun path live in the studio; asserted by window.runBeukSelfChecks().',
  },
  {
    id: 'zen.day.reduced-motion',
    title: 'Zen day under reduced motion moves nothing: no transform transitions, the sun or moon crossfades instead, rare updates',
    kind: 'client-only',
    reason: 'Reduced motion is a browser preference (plus the studio override) applied to client CSS; asserted by window.runBeukSelfChecks().',
  },
  /* ---- Zen ambient sound: CC0 / public-domain sound files, two field recordings and one offline render (BEUK:sound) ---- */
  {
    id: 'zen.sound.files-decode',
    title: 'Zen sound files are same-origin audio/mpeg, within budget, decode to pad + loop + pad seconds and loop seamlessly on the decoded samples',
    kind: 'client-only',
    reason:
      'Decoding is the browser’s own decodeAudioData (asserted by window.runBeukAsyncSelfChecks()). The server side — every shipped file listed in client/assets/sound/CREDITS.md with a matching sha256, CC0/PD licence and the size budget — is tests/sound.test.ts.',
  },
  {
    id: 'zen.sound.buffer-loop',
    title: 'Zen sound plays the chosen recording through one looping AudioBufferSourceNode, fades in, crossfades on scene switch and creates no oscillator or filter',
    kind: 'client-only',
    reason: 'Playback is a Web Audio graph in the studio, asserted by the async client self-check window.runBeukAsyncSelfChecks().',
  },
  {
    id: 'ui.sidebar.scroll-survives-rerender',
    title: 'Structure pane keeps its scroll position across sidebar rebuilds',
    kind: 'client-only',
    reason: 'Scroll restoration happens in the client sidebar renderer on every rebuild.',
  },
  // BEUK:sidebar — compact header pill, single Import/Settings, collapsible sidebar, pre-rename sample swap.
  {
    id: 'ui.savepill.compact',
    title: 'Header save pill shows a dot and a short label per state; the full sentence rides the tooltip, accessible name and popover; warnings stay distinct; width is capped',
    kind: 'client-only',
    reason: 'The save pill is client chrome over the browser-local save state (IndexedDB); the check renders each state in the studio.',
  },
  {
    id: 'ui.header.no-duplicates',
    title: 'Import and Project Settings appear once, in the sidebar; the header carries no duplicate icons',
    kind: 'client-only',
    reason: 'Header and sidebar buttons are client markup; the check inspects the studio DOM and clicks the sidebar buttons.',
  },
  {
    id: 'ui.sidebar.collapse',
    title: 'Sidebar tools stand in one labelled icon row; statistics are a remembered disclosure with a live one-line summary',
    kind: 'client-only',
    reason: 'The sidebar layout and its per-device preference (localStorage) live in the client.',
  },
  {
    id: 'ui.outline.groups',
    title: 'Outline Front/Body/Back groups fold with counts; the active section is never hidden; add-page, add-chapter and reorder survive',
    kind: 'client-only',
    reason: 'The outline is rendered by the client sidebar renderer from the in-browser book model.',
  },
  {
    id: 'chapter.lists',
    title: 'Lists: bulleted and numbered lists set in the preview, print and EPUB, export to Word as real lists, and come in from Word as lists',
    kind: 'client-only',
    reason: 'The list markup is parsed and typeset in the studio; the Word import and export are built there too.',
  },
  {
    id: 'chapter.containers',
    title: 'Containers: "::: kind" … ":::" fences are read before blocks split, unknown kinds set as paragraphs, fences are never words, and the toolbar fences and unfences',
    kind: 'client-only',
    reason: 'The container parser, word counts, Markdown export and editor toolbar all run in the studio.',
  },
  {
    id: 'chapter.verse',
    title: 'Verse: line breaks and indents kept, stanzas set ragged and unindented in preview, print and EPUB, and as Verse paragraphs with real line breaks in Word',
    kind: 'client-only',
    reason: 'The verse is typeset by the studio renderer, and the EPUB and Word files are built in the browser.',
  },
  {
    id: 'chapter.align',
    title: 'Centre and right: aligned blocks in preview, print and EPUB, w:jc in the Word export, and centred/right paragraphs come in from Word as containers',
    kind: 'client-only',
    reason: 'The alignment is typeset by the studio renderer; the Word import reads the package in the browser.',
  },
  {
    id: 'chapter.texts',
    title: 'Texts: "::: texts <MeName>" sets message bubbles (sent right and tinted, received left and outlined, names above each run) in preview, print and EPUB, and Text Sent / Text Received paragraphs in Word',
    kind: 'client-only',
    reason: 'The conversation is typeset by the studio renderer, and the EPUB and Word files are built in the browser.',
  },
  {
    id: 'chapter.letter',
    title: 'Letter: "::: letter" sets an italic note in a hairline box with its line breaks, salutation and right-set sign-off, in preview, print and EPUB, and as Letter paragraphs in Word',
    kind: 'client-only',
    reason: 'The letter is typeset by the studio renderer, and the EPUB and Word files are built in the browser.',
  },
  {
    id: 'chapter.hanging',
    title: 'Hanging: "::: hanging" sets one entry per line with its turn-over hung (bibliography, chronology, index) in preview, print, the Print Interior View and EPUB, mirrored right to left, and as Hanging paragraphs in Word',
    kind: 'client-only',
    reason: 'The entries are typeset by the studio renderer, and the EPUB and Word files are built in the browser.',
  },
  {
    id: 'chapter.columns',
    title: 'Columns: "::: columns" sets compact back matter in two balanced columns in print, the Print Interior View and the wide preview, one column in the EPUB, and a two-column Word section',
    kind: 'client-only',
    reason: 'The columns are laid out by the studio renderer and the print stylesheet, and the EPUB and Word files are built in the browser.',
  },
  {
    id: 'titlepage.centred',
    title: 'Title page: the subtitle, author and publisher are centred like the title in every theme, at standard, Large Print and picture-book type, and right to left',
    kind: 'client-only',
    reason: 'The title page is typeset by the studio renderer and the print stylesheet; the check measures it in the browser.',
  },
  {
    id: 'print.picturebook',
    title: 'Picture-book type: a 24pt print type size beside Large Print for the print interior and the Print Interior View, carried by the book file',
    kind: 'client-only',
    reason: 'The print interior and its view are typeset in the browser from the print stylesheet.',
  },
  {
    id: 'chapter.captions',
    title: 'Image captions: a figcaption under the picture in preview, print and EPUB, a Caption paragraph in Word, written from the image dialog, and read from Word Caption-styled paragraphs',
    kind: 'client-only',
    reason: 'The figure is typeset by the studio renderer; the EPUB, the Word export and the Word import all run in the browser.',
  },
  {
    id: 'chapter.attribution',
    title: 'Quote attribution: a last "> — Name" line set right under the quote in preview, print and EPUB, and as a right-aligned paragraph in Word',
    kind: 'client-only',
    reason: 'The quote is typeset by the studio renderer, and the EPUB and Word files are built in the browser.',
  },
  {
    id: 'chapter.platecaption',
    title: 'Captions on the page: a frontispiece caption under its plate in preview, print and EPUB, and a captioned picture held short enough in print to keep its caption on its page',
    kind: 'client-only',
    reason: 'The plate and the print stylesheet are built by the studio renderer, and the EPUB in the browser.',
  },
  {
    id: 'print.footnotes.page',
    title: 'Notes in print: at the foot of the page (new books) or at the end of the chapter (books saved before the choice); the print interior carries the notes and the page geometry, the EPUB keeps linked endnotes, and the Print Interior View sets each note at its reference\'s page foot',
    kind: 'client-only',
    reason: 'The setting, the print interior and the spread view are built in the studio; the renderer half (measuring, cutting the pages, drawing the notes) is covered by tests/print-footnotes.test.ts.',
  },
  {
    id: 'print.footnotes.runon',
    title: 'Notes in print: a long note referenced on a chapter\'s last page runs on onto a page added at the chapter\'s end, in the Print Interior View as the renderer adds it; a note too long even for that keeps the chapter\'s notes at its end',
    kind: 'client-only',
    reason: 'The Print Interior View is laid out by the browser in the studio; the renderer\'s added pages are covered by tests/print-footnotes.test.ts.',
  },
  {
    id: 'print.footnotes.report',
    title: 'Notes in print: the store check reports what the renderer did with the notes, naming each chapter that kept its notes at its end and why',
    kind: 'client-only',
    reason: 'The store check is assembled in the studio from the PDF/X job result; the renderer header and its parsing into that result are covered by tests/print-footnotes.test.ts and tests/jobs.test.ts.',
  },
  {
    id: 'chapter.backdrop.spread',
    title: 'Spread backdrop: a plated chapter faces its plate across the gutter, the art at full strength there and fading before the words',
    kind: 'client-only',
    reason: 'The layout, the spread view and the print file are built in the studio; the renderer half is covered by tests/print-spreads.test.ts.',
  },
  {
    id: 'chapter.links',
    title: 'Links: https / http / mailto links set in the preview (new tab, noopener) and the book; unsafe schemes stay text; the count counts only the words; Also by and call-to-action links print as plain words; the toolbar Link dialog places one',
    kind: 'client-only',
    reason: 'The link markup is parsed and typeset in the studio, and the Link dialog is part of the client editor.',
  },
  {
    id: 'export.links',
    title: 'Links in the exports: EPUB links validate, Word gets real hyperlinks on External relationships, Markdown keeps them, and Word web links import as links',
    kind: 'client-only',
    reason: 'The EPUB, Word and Markdown exports and the Word import are all built in the client.',
  },
  {
    id: 'sample.legacy-salt-meridian',
    title: 'A sample copy saved before the rename is snapshotted into History and replaced by the current sample; restoring the snapshot returns the old text exactly',
    kind: 'client-only',
    reason: 'The sweep runs in the client on every path a book reaches the desk (device restore, shelf open, conflict, backup file).',
  },

  /* ---- Device-only book guard (BEUK:shelfguard) ---- */
  {
    id: 'shelf.open.guards-device-only',
    title: 'Opening a shelf book over a book that exists only on this device asks first (Keep my book is the default; Put it on my shelf, then open; Open and replace it) — never a silent swap',
    kind: 'client-only',
    reason: 'The guard runs in the studio before the shelf book is fetched; asserted by the async client self-check window.runBeukAsyncSelfChecks() against a stubbed shelf.',
  },
  {
    id: 'confirm.alt.hidden-when-unused',
    title: 'A two-choice confirmation draws exactly two buttons (the optional third is hidden and can never resolve as yes); the three-choice shelf-open dialog stacks Keep / Put on shelf / Replace',
    kind: 'client-only',
    reason: 'Rendered layout of the studio confirm dialog (computed style in the browser); asserted by the async client self-check window.runBeukAsyncSelfChecks().',
  },
  {
    id: 'history.restore.snapshot-always',
    title: 'Restore the whole book takes the snapshot its confirmation promises (every desk but a truly empty one), the untouched sample included',
    kind: 'client-only',
    reason: 'History snapshots live in the in-browser book (state.history); restore runs in the client.',
  },
  /* ---- round-7 goals & history (BEUK:goalshist) ---- */
  {
    id: 'goals.road.only-logged-days',
    title: 'The road so far draws a point only for a day the log kept: a fixture log with gaps gives exactly its logged days, breaks the line at every gap, and hides below two logged days',
    kind: 'client-only',
    reason: "The writing log (with the book length per logged day) lives in this browser's localStorage and the chart is drawn in the studio; asserted by window.runBeukSelfChecks().",
  },
  {
    id: 'goals.road.pace-line',
    title: "The road so far draws the target as a level line and, with a deadline ahead, the steady pace from today's length to the target on the deadline at (target - today) / days left; none past the deadline or once met",
    kind: 'client-only',
    reason: 'Goals ride the in-browser book and the chart geometry is computed in the studio; asserted by window.runBeukSelfChecks().',
  },
  {
    id: 'history.delta.words',
    title: "Each snapshot shows its change against the book now (+N words / -N words / same length) with each language's plural form",
    kind: 'client-only',
    reason: 'History snapshots live in the in-browser book (state.history); the comparison is computed and rendered in the client.',
  },
  {
    id: 'history.delta.sections',
    title: "A snapshot's detail lists the sections added since, no longer in the book, and changed by word count (or reworded), matched by section id; the deltas sum to the book's change",
    kind: 'client-only',
    reason: 'History snapshots live in the in-browser book (state.history); the section comparison is computed and rendered in the client.',
  },
  /* ---- round-6 bugs (BEUK:bugs) ---- */
  {
    id: 'history.snapshots.share-pictures',
    title: 'Every History snapshot shares the book’s pictures: each picture is written once in the saved book, a dropped one once in historyPool; it reads back and restores exactly',
    kind: 'client-only',
    reason: 'History snapshots live in the in-browser book (state.history); packing and unpacking run in the client.',
  },
  {
    id: 'history.restore.empty-desk-no-prune',
    title: 'Restoring over a truly empty desk takes no safety snapshot (prunes no real automatic one) and its confirmation says so; any content and the snapshot is taken',
    kind: 'client-only',
    reason: 'History snapshots live in the in-browser book (state.history); restore and its confirmation run in the client.',
  },
  {
    id: 'shelf.reload.no-false-conflict',
    title: 'A reload right after a shelf save raises no false conflict (revision written at once; a same-book stale note or 409 agrees quietly); a real two-device change still raises the notice',
    kind: 'client-only',
    reason: 'The device link record (IndexedDB) and the conflict notice live in the browser; asserted by the async client self-check window.runBeukAsyncSelfChecks().',
  },
  /* ---- round-7 overlapping shelf saves (BEUK:savesync) ---- */
  {
    id: 'shelf.save.single-flight',
    title: 'Shelf saves are single-flight: a save asked for mid-flight runs once, after the answer, on the returned revision (never two PUTs on one If-Match); a late answer for a book no longer on the desk moves nothing; no path out of a save leaves "Saving…" standing',
    kind: 'client-only',
    reason: 'The save queue, its in-flight promise and the shelf status line live in the browser; asserted by the async client self-check window.runBeukAsyncSelfChecks() against a stand-in shelf that keeps this server’s If-Match contract.',
  },
  {
    id: 'shelf.save.identical-409-silent',
    title: 'A 409 or reconnect check whose shelf copy is the device’s own book settles quietly on the shelf revision; a stale timestamp with an agreeing revision is no conflict; another device’s different words still raise the notice',
    kind: 'client-only',
    reason: 'The comparison of the shelf copy with the desk’s book and the conflict notice run in the browser; asserted by the async client self-check window.runBeukAsyncSelfChecks().',
  },
  {
    id: 'ui.lang.live-account-desk',
    title: 'Switching the UI language redraws the account button and the preview desk at once (es, ar, ja)',
    kind: 'client-only',
    reason: 'Rendered studio chrome in the browser.',
  },
  {
    id: 'ui.plural.counts',
    title: 'Word and page counts take each language’s own CLDR plural form (Intl.PluralRules)',
    kind: 'client-only',
    reason: 'UI strings and Intl.PluralRules run in the browser.',
  },
  {
    id: 'sample.count.truthful',
    title: 'The sample’s word counts are true: the Load button states its real count; the open sample’s note follows every edit',
    kind: 'client-only',
    reason: 'The bundled sample and its counts live in the studio page.',
  },

  /* ---- Story Insights, round 7 (BEUK:insights) ---- */
  {
    id: 'insights.glance.numbers-true',
    title: 'Story Insights at a glance: words, reading time, chapters, average sentence and dialogue share equal the studio’s own counts; pages are the reading desk’s own measurement or no number while it measures',
    kind: 'client-only',
    reason: 'Story Insights is computed in the browser from the manuscript on the desk; the page count comes from the studio’s own layout engine.',
  },
  {
    id: 'insights.chart.click-opens-chapter',
    title: 'Story Insights charts: clicking a rhythm column, Enter on a cadence point and clicking a dialogue row each close Insights and open that chapter',
    kind: 'client-only',
    reason: 'Rendered SVG charts and editor navigation in the studio page.',
  },
  {
    id: 'insights.crutch.counts',
    title: 'Story Insights words to look at: exact counts and per-10,000 rates on hand-built English and Spanish fixtures; no list for other languages',
    kind: 'client-only',
    reason: 'The word lists and counting run in the studio page (the server never sees manuscript text for this).',
  },
  {
    id: 'insights.sentences.histogram',
    title: 'Story Insights sentence variety: known sentence lengths land in the right buckets, with exact median and nine-in-ten lengths',
    kind: 'client-only',
    reason: 'Sentence splitting and the histogram run in the studio page.',
  },
  {
    id: 'insights.readability.en-only',
    title: 'Story Insights reading ease: Flesch Reading Ease exact on a known English sentence; other book languages get a note instead of a score',
    kind: 'client-only',
    reason: 'Computed in the studio page from the manuscript on the desk.',
  },
  {
    id: 'insights.perf',
    title: 'Story Insights stay quick: the sample book computes and draws from cold in under 600 ms; an unchanged book reopens from the per-revision cache',
    kind: 'client-only',
    reason: 'Timed in the writer’s own browser; the server has no part in it.',
  },

  /* ---- Dictation language + Read Aloud section language (BEUK:dictlang) ---- */
  {
    id: 'dictation.language-picker',
    title: 'Dictation language picker sets the recogniser language, restarts cleanly mid-session and round-trips with the book',
    kind: 'client-only',
    reason:
      'Dictation runs in the browser’s own SpeechRecognition (stubbed in the client self-check); the pick is client state serialized with the book (serializeBook().dictation). The server never sees speech.',
  },
  {
    id: 'dictation.language-suggest',
    title: 'Text that reads as another language offers a dictation / book-language switch, never applied without a tap',
    kind: 'client-only',
    reason:
      'The suggestion is computed in the client from the open section’s text (detectLanguageInText) and shown in the editor’s language bar. Browsers cannot detect the spoken language (W3C Web Speech API: lang is a single BCP 47 tag).',
  },
  {
    id: 'readaloud.section-language',
    title: 'Read Aloud offers the matching voice for a section that reads as another language than the book',
    kind: 'client-only',
    reason: 'Read Aloud uses the device’s speechSynthesis voices in the browser; the section-language switch is client session state.',
  },

  /* ---- Cover maker (all client-side) ---- */
  {
    id: 'cover.maker.renders-text-over-background',
    title: 'Cover maker composes a cover from its recipe (text over chosen background)',
    kind: 'client-only',
    reason: 'Composition and canvas rendering happen in the client.',
  },
  {
    id: 'cover.maker.ebook-render-dimensions',
    title: 'Made ebook cover renders at exactly 2560×1600',
    kind: 'client-only',
    reason: 'The render is produced by the client canvas at adopt time.',
  },
  {
    id: 'cover.maker.print-render-dimensions',
    title: 'Made print front renders at trim size × 300 DPI',
    kind: 'client-only',
    reason: 'The render is produced by the client canvas from the book’s trim setting.',
  },
  {
    id: 'cover.wrap.spine-math',
    title: 'Print wrap: spine = pages × paper factor; wrap = 2 × trim width + spine + bleed',
    kind: 'client-only',
    reason: 'The wrap geometry is computed in the client cover maker.',
  },
  {
    id: 'cover.wrap.narrow-spine',
    title: 'Print wrap: a spine under 0.5″ carries no text and shows the honest note',
    kind: 'client-only',
    reason: 'The spine is painted by the client canvas.',
  },
  {
    id: 'cover.wrap.barcode-box',
    title: 'Print wrap: the 2″ × 1.2″ barcode reserve sits clear at the back’s bottom-right',
    kind: 'client-only',
    reason: 'The back panel is painted by the client canvas.',
  },
  {
    id: 'cover.wrap.pdf-size',
    title: 'Print wrap: the PDF page equals the computed wrap size',
    kind: 'client-only',
    reason: 'The wrap PDF is assembled in the client and downloaded; the server never holds it.',
  },
  {
    id: 'cover.wrap.recipe-persists',
    title: 'Print wrap settings survive a round-trip inside the cover recipe',
    kind: 'client-only',
    reason: 'The cover recipe is part of the client book model (synced as opaque JSON).',
  },
  {
    id: 'cover.wrap3d.faces-from-wrap',
    title: '3D wrap viewer: front, spine and back faces are sliced from the current wrap render',
    kind: 'client-only',
    reason: 'The 3D viewer renders in the client from the client wrap canvas.',
  },
  {
    id: 'cover.wrap3d.spine-follows-calculator',
    title: '3D wrap viewer: the model’s spine proportion follows the wrap calculator',
    kind: 'client-only',
    reason: 'The 3D viewer renders in the client from the client wrap geometry.',
  },
  {
    id: 'cover.wrap3d.sample-fallback',
    title: '3D wrap viewer: with no composed cover it shows the sample book; composing a cover replaces it',
    kind: 'client-only',
    reason: 'The 3D viewer renders in the client from the client desk state.',
  },
  {
    id: 'cover.hardcover.case-math',
    title: 'Hardcover case laminate: board = trim − 0.185″ × trim + 0.25″; wrap = 0.625 + board + 0.5 + spine + 0.5 + board + 0.625 (IngramSpark)',
    kind: 'client-only',
    reason: 'The hardcover wrap geometry is computed in the client cover maker.',
  },
  {
    id: 'cover.hardcover.jacket-math',
    title: 'Hardcover dust jacket: panel = trim + 0.4375″ × trim + 0.25″; jacket = 0.125 + 3.25 + 0.25 + panel + spine + panel + 0.25 + 3.25 + 0.125 (IngramSpark)',
    kind: 'client-only',
    reason: 'The dust-jacket geometry is computed in the client cover maker.',
  },
  {
    id: 'cover.hardcover.spine-source',
    title: 'Hardcover spine: a template spine is used exactly; otherwise it is labelled an estimate',
    kind: 'client-only',
    reason: 'The spine source and its label live in the client cover maker.',
  },
  {
    id: 'cover.hardcover.trims',
    title: 'Hardcover trims follow IngramSpark’s trim matrix; an unlisted trim shows a warning',
    kind: 'client-only',
    reason: 'The trim availability table is client data shown in the cover maker.',
  },
  {
    id: 'cover.hardcover.guides-preview-only',
    title: 'Hardcover guides (hinge, board, turn-in, flaps, spine, safety, barcode) are preview-only, never in downloads',
    kind: 'client-only',
    reason: 'The guides are painted by the client canvas; downloads are rendered client-side.',
  },
  {
    id: 'cover.hardcover.flaps',
    title: 'Dust jacket flaps: description on the front flap, author bio (About the Author default) on the back, inside the safe inset',
    kind: 'client-only',
    reason: 'The flaps are painted by the client canvas.',
  },
  {
    id: 'cover.hardcover.pdf-size',
    title: 'Hardcover PDF: the page equals the computed case-laminate / dust-jacket size',
    kind: 'client-only',
    reason: 'The hardcover PDF is assembled in the client and downloaded; the server never holds it.',
  },
  {
    id: 'cover.hardcover.recipe-persists',
    title: 'Hardcover settings survive a round-trip inside the cover recipe',
    kind: 'client-only',
    reason: 'The cover recipe is part of the client book model (synced as opaque JSON).',
  },
  {
    id: 'cover.hardcover.3d-proportions',
    title: '3D viewer, hardcover: board / jacket-panel proportions, spine depth and the boards’ square',
    kind: 'client-only',
    reason: 'The 3D viewer renders in the client from the client wrap geometry.',
  },
  // BEUK:hcpreview — the Hardcover device in the studio's preview pane.
  {
    id: 'preview.hardcover.device',
    title: 'Hardcover device: a closed hardback wearing the book’s cover art and spine title; the e-reader frame and desk stand down and return',
    kind: 'client-only',
    reason: 'The hardcover device is drawn by the client preview pane (CSS 3D in the studio page).',
  },
  {
    id: 'preview.hardcover.trim-proportions',
    title: 'Hardcover device proportions follow the print trim plus IngramSpark’s 0.125 in square; 6 × 9 and 5 × 8 differ',
    kind: 'client-only',
    reason: 'The proportions come from the client trim table and are measured in the rendered client DOM.',
  },
  {
    id: 'preview.hardcover.spread-print',
    title: 'Hardcover device, open: each spread page equals the Print Interior View page from the same print model',
    kind: 'client-only',
    reason: 'Both the spread and the Print Interior View paginate in the client browser; the server never lays out pages.',
  },
  {
    id: 'preview.hardcover.turn-jump',
    title: 'Hardcover device: Next / Prev / arrow keys step one spread and stop at the ends; it opens on, and follows, the chapter being edited',
    kind: 'client-only',
    reason: 'Page turning and chapter selection are client UI state.',
  },
  {
    id: 'preview.hardcover.binding-look',
    title: 'Hardcover device materials follow the cover maker binding: dust jacket, case laminate, or a cloth board with no cover art',
    kind: 'client-only',
    reason: 'The binding lives in the client cover recipe and the look is drawn by the client.',
  },
  {
    id: 'preview.hardcover.page-block',
    title: 'Hardcover device, closed: a cream page block recessed between the boards by the 0.125 in square, its head facing the viewer on screen and clearing the front board',
    kind: 'client-only',
    reason: 'The closed book is CSS 3D in the client; the check measures the projected faces in the studio browser.',
  },
  {
    id: 'preview.hardcover.i18n',
    title: 'Hardcover device strings ship in all 13 interface languages',
    kind: 'client-only',
    reason: 'The interface string table is client data.',
  },
  // BEUK:pagecount — per-device page counts at fixed device geometry.
  {
    id: 'preview.pagecount.fixed-geometry',
    title:
      'Page counts at fixed device geometry: each e-reader profile counts at its own CSS-px reading area, identical at any window size; the copy calls them estimates',
    kind: 'client-only',
    reason:
      'E-reader pagination is laid out by the studio browser (CSS multicol in the client page); the server never lays out pages.',
  },
  // BEUK:reader — the preview keeps the writer's place; Zen controls clear the tabs.
  {
    id: 'preview.keeps-page-on-edit',
    title: 'The preview keeps its page while the writer formats: bold, italic, blockquote and a font-size change leave the formatted word on screen and Page X of Y true',
    kind: 'client-only',
    reason: 'The preview is laid out and paged by the studio browser (CSS multicol in the client page); the server never lays out pages.',
  },
  {
    id: 'preview.follows-caret',
    title: 'The preview follows the caret: an edit at another paragraph turns the preview to the page that holds it',
    kind: 'client-only',
    reason: 'The caret lives in the client editor and the pages are laid out by the client preview.',
  },
  {
    id: 'preview.new-section-page-one',
    title: 'Opening another section starts its preview at page 1',
    kind: 'client-only',
    reason: 'Section selection and the preview page are client UI state.',
  },
  {
    id: 'preview.rtl-ui-same-pages',
    title: 'An Arabic (right-to-left) interface lays the book pages out exactly as an English one: same page count, same first page',
    kind: 'client-only',
    reason: 'The device preview is laid out by the studio browser; the interface direction is client UI state.',
  },
  {
    id: 'preview.rtl-book-pages-turn',
    title: 'A right-to-left (Arabic) book turns its pages the right way in the device preview: every page shows its own text, and a word is found on the page it is drawn on',
    kind: 'client-only',
    reason: 'The device preview is laid out and paged by the studio browser.',
  },
  {
    id: 'preview.opened-section-stays-put',
    title: 'A section just opened stays on page 1 through a font-size change; a chapter-title keystroke turns to the page the title stands on and a device change keeps it there',
    kind: 'client-only',
    reason: 'Section selection, the editor caret and the preview page are client UI state laid out by the studio browser.',
  },
  {
    id: 'zen.controls.no-overlap',
    title: 'Zen corner controls never cover the tabs in any of the 13 interface languages (Arabic RTL included), and stay inside the window',
    kind: 'client-only',
    reason: 'Zen is drawn by the studio page; the check measures bounding boxes in the client browser.',
  },
  {
    id: 'chapters.delete.undo-restores-exactly',
    title: 'Deleting a section offers Undo; Undo restores it at its exact place with id, text, notes, images and settings, the active section and chapter numbers, keeping edits made meanwhile',
    kind: 'client-only',
    reason: 'Section operations run on the in-browser book model (state.sections and its History snapshots) and the studio sidebar; the server only stores the resulting book.',
  },
  {
    id: 'chapters.delete.snapshot-taken',
    title: 'A delete first takes an automatic History snapshot (“Before deleting <name>”) that rides the book and restores; structural snapshots keep their own five and share the book’s pictures instead of copying them',
    kind: 'client-only',
    reason: 'Section operations run on the in-browser book model (state.sections and its History snapshots) and the studio sidebar; the server only stores the resulting book.',
  },
  {
    id: 'chapters.duplicate.deep-copy',
    title: 'Duplicate inserts a deep copy right after the original with a new id and “(copy)” title, selects it, and Undo removes it',
    kind: 'client-only',
    reason: 'Section operations run on the in-browser book model (state.sections and its History snapshots) and the studio sidebar; the server only stores the resulting book.',
  },
  {
    id: 'chapters.split.at-caret',
    title: 'Split at cursor cuts the active section at the cursor paragraph; notes follow their references, images their paragraphs; Undo restores exactly',
    kind: 'client-only',
    reason: 'Section operations run on the in-browser book model (state.sections and its History snapshots) and the studio sidebar; the server only stores the resulting book.',
  },
  {
    id: 'chapters.merge.scene-break',
    title: 'Merge with next joins two sections with the scene break, keeps the first title and settings, renumbers clashing notes; Undo restores both',
    kind: 'client-only',
    reason: 'Section operations run on the in-browser book model (state.sections and its History snapshots) and the studio sidebar; the server only stores the resulting book.',
  },
  {
    id: 'chapters.merge.refuses-across-kinds',
    title: 'Merge refuses across front/body/back, generated pages, Part dividers and the last section, with the reason as tooltip; nothing changes',
    kind: 'client-only',
    reason: 'Section operations run on the in-browser book model (state.sections and its History snapshots) and the studio sidebar; the server only stores the resulting book.',
  },
  {
    id: 'cover.maker.adopt-gains-cover-package',
    title: 'Adopting a made cover gives the EPUB its cover files and landmark',
    kind: 'client-only',
    reason: 'Adoption sets the client cover slot; the resulting package is asserted by the client registry.',
  },
  {
    id: 'cover.maker.remove-restores-no-cover',
    title: 'Removing a made cover restores exact no-cover behavior',
    kind: 'client-only',
    reason: 'Cover state (image + recipe) lives in the client book model.',
  },
  {
    id: 'cover.maker.recipe-survives-roundtrip',
    title: 'The cover recipe survives a save/load round-trip for re-editing',
    kind: 'client-only',
    reason: 'The recipe rides inside the book JSON the client serializes; the server stores it opaquely.',
  },
  {
    id: 'cover.maker.open-leaves-uploaded-cover',
    title: 'Merely opening the maker leaves a pre-existing uploaded cover untouched',
    kind: 'client-only',
    reason: 'Maker open/adopt state is client UI behavior.',
  },
  {
    id: 'cover.maker.image-and-duotone-backgrounds',
    title: 'Maker backgrounds include the writer’s art and a duotone treatment of it',
    kind: 'client-only',
    reason: 'Background painting is client canvas work.',
  },
  {
    id: 'cover.maker.free-position-photo-bg',
    title: 'Maker: free placement anchors text where the writer put it; photo backgrounds come from the shelf stock endpoint',
    kind: 'client-only',
    reason:
      'Free placement and canvas painting are client interactions. The stock search runs in the client against GET /api/stock/search: signed-out gate, contract-shaped results and the honest 501 not-set-up state are client-rendered, and there is no per-writer API key anywhere in the client.',
  },

  /* ---- Bulk import (all client-side) ---- */
  {
    id: 'bulk.queue.three-files-three-books',
    title: 'A multi-file batch creates one shelf book per manuscript',
    kind: 'client-only',
    reason: 'The intake queue orchestrates in the client over the existing manuscript API.',
  },
  {
    id: 'bulk.dedupe.duplicate-in-batch',
    title: 'A duplicate file inside one batch is skipped by content hash',
    kind: 'client-only',
    reason: 'Batch hashing and dedupe run in the client during intake.',
  },
  {
    id: 'bulk.dedupe.already-shelved-fingerprint',
    title: 'A manuscript matching a shelved book’s fingerprint is skipped as already shelved',
    kind: 'client-only',
    reason: 'The fingerprint comparison runs in the client against the shelf listing.',
  },
  {
    id: 'bulk.failure.corrupt-isolated-no-partial',
    title: 'A corrupt file fails alone; the batch continues and no partial book remains',
    kind: 'client-only',
    reason: 'Failure isolation is queue behavior in the client.',
  },
  {
    id: 'bulk.detect.per-book-language',
    title: 'Each book in a batch gets its own language detection',
    kind: 'client-only',
    reason: 'Detection runs in the client import pipeline.',
  },
  {
    id: 'bulk.gate.signed-out-no-controls',
    title: 'Signed out, no bulk import controls appear (signups only)',
    kind: 'client-only',
    reason: 'The gate is enforced in the client UI state; the underlying API already requires auth.',
  },
  {
    id: 'bulk.vault.frontmatter-links-images',
    title: 'Vault import honours frontmatter, wikilinks and image embeds',
    kind: 'client-only',
    reason: 'Vault parsing (frontmatter, [[links]], embeds) is client import behavior.',
  },

  /* ---- Word import report (client-side; BEUK:importreport) ---- */
  {
    id: 'import.report.txt-records-and-undo',
    title:
      'Import report (text): chapter splits, a spaced * * * scene break and smartened quotes are recorded; one chapter split undoes back into its neighbour, typography and break undos restore the original, and Undo the whole import restores the prior book',
    kind: 'client-only',
    reason: 'The import pipeline, the report and its undos all run in the studio against the book in the browser.',
  },
  {
    id: 'import.report.docx-honest',
    title:
      'Import report (Word): tables are reported as left out (words back on undo), footnotes link as notes, images land in the library with alt text, demoted headings, comments, tracked changes, headers, lists and converter warnings are all listed',
    kind: 'client-only',
    reason: 'Word conversion (Mammoth.js) and the report are client-side; the server never sees the .docx.',
  },
  {
    id: 'import.docx.inline-formatting',
    title:
      'Word import keeps formatting: italic, bold and bold-italic come across as Beuk marks (also in subheadings, quotes, list items and footnotes), web and mail links as [words](address), and the report lists only what has no mark (underline, strike-through, sub/superscript, bookmark links, bold chapter-title lines)',
    kind: 'client-only',
    reason: 'Word conversion (Mammoth.js), the inline walk and the import report all run in the studio; the server never sees the .docx.',
  },
  {
    id: 'import.docx.dropcap-emphasis',
    title: 'A first paragraph that opens in italic, bold or bold-italic (as Word import writes it) keeps its drop cap inside the emphasis, and a small-caps lead-in ending inside the italic stays well-formed',
    kind: 'client-only',
    reason: 'Chapter rendering (contentBlocksToHtml) and the drop cap are built in the studio.',
  },
  {
    id: 'import.docx.other-paths-formatting',
    title: 'Box-set volume and bulk Word import keep italic, bold, bold-italic and links like the main Word import, with the same Mammoth options',
    kind: 'client-only',
    reason: 'Box-set and bulk import read the .docx with Mammoth.js in the studio; the server never sees the file.',
  },
  {
    id: 'import.docx.beuk-roundtrip',
    title: 'Word round trip: a Beuk Word export read back by the Word import keeps bold italic, links, lists, a quote with its attribution and a centred block, and its container styles fence nothing',
    kind: 'client-only',
    reason: 'The Word export, Mammoth.js and the import walk all run in the studio; the server never sees the file.',
  },
  {
    id: 'import.docx.backmatter',
    title: 'Word round trip (back matter): Hanging, Columns and Columns Hanging paragraphs from a Beuk Word export come back fenced as "::: hanging", "::: columns" and "::: columns hanging"',
    kind: 'client-only',
    reason: 'The Word export, Mammoth.js and the import walk all run in the studio; the server never sees the file.',
  },
  {
    id: 'import.pdf',
    title:
      'PDF import: a PDF written in the check imports through the vendored PDF.js (SRI) as two chapters with running heads and page numbers left out and reported, the line-end hyphen joined, italic and bold carried, a paragraph running on over the page break, a scene break, the table reported and the picture imported; a text-less scan is refused; undo restores the prior book',
    kind: 'client-only',
    reason: 'PDF.js reads the file in the browser and the import pipeline and report run against the book there; the server never sees the PDF.',
  },
  {
    id: 'import.pdf.layout',
    title:
      'PDF import layout: short dialogue lines at the foot of pages are kept (only fixed-place running heads and page numbers are left out, listed with counts), indented one-line paragraphs stay apart, an Arabic page reads right to left with its paragraphs, a text-less page under a full-page picture is reported, and control characters from the text layer are removed and counted',
    kind: 'client-only',
    reason: 'The layout reader runs in the browser on what PDF.js extracts there; the server never sees the PDF.',
  },
  {
    id: 'import.report.images-accounted',
    title:
      'Import report (Word): every picture is accounted for — images inside headings, list items and quotes are imported, and any the import cannot hold are listed as left out',
    kind: 'client-only',
    reason: 'Word conversion (Mammoth.js) and the report are client-side; the server never sees the .docx.',
  },
  {
    id: 'import.report.persists-with-book',
    title: 'Import report rides with the book until dismissed; History snapshots do not carry it',
    kind: 'client-only',
    reason: 'The report is a field of the client book document (serializeBook); the shelf stores the book JSON opaquely.',
  },

  /* ---- Import credit and Cover maker prefill (client-side; BEUK:importmeta) ---- */
  {
    id: 'import.title.from-titlepage',
    title:
      "Import credit from the manuscript's title page: title, subtitle and by-line author are read from the lead lines before the first chapter, lifted out of the body and reported (undoable); prose is never taken as a title",
    kind: 'client-only',
    reason: 'Title discovery runs in the studio import pipeline; the server never sees the manuscript file.',
  },
  {
    id: 'import.title.from-filename',
    title: 'Import credit from the cleaned file name when nothing better exists (extension, separators, copy markers and trailing draft/version words removed, reported as such)',
    kind: 'client-only',
    reason: 'Title discovery runs in the studio import pipeline; the server never sees the manuscript file.',
  },
  {
    id: 'import.title.keeps-writers',
    title: "A title the writer typed is never overwritten by an import (the report offers the document's title with one click); an imported title is replaced by the next import",
    kind: 'client-only',
    reason: 'Credit provenance (meta.titleSource) is a field of the client book document; imports and the report run in the studio.',
  },
  {
    id: 'import.title.keeps-section-editor',
    title: "A credit the writer types on the Title Page or Copyright section editor counts as theirs: the next import keeps it and offers the document's own",
    kind: 'client-only',
    reason: 'The section editors and credit provenance (meta.titleSource/authorSource) are client UI and client book state.',
  },
  {
    id: 'settings.title.placeholder-not-stored',
    title: '"Untitled Book" is display-only: a blank title is stored blank, and a stored placeholder in any of the 13 languages counts as untitled',
    kind: 'client-only',
    reason: 'Settings Save and the placeholder fallback are client UI behavior.',
  },
  {
    id: 'covermaker.prefill.from-book',
    title: "Cover maker prefill: a new cover takes the book's title, subtitle, author and series (never the placeholder) and seeds the photo search",
    kind: 'client-only',
    reason: 'The Cover maker and its recipe live in the client book model.',
  },
  {
    id: 'covermaker.prefill.follows-book',
    title: "Cover maker follows the book: a saved recipe's blank fields, and fields still equal to the book's words when it was saved, take the book's current values; text typed in the maker is kept",
    kind: 'client-only',
    reason: 'The Cover maker and its recipe (with its book-text snapshot) live in the client book model.',
  },

  /* ---- Feature 7: ACX audio script export (all client-side) ---- */
  {
    id: 'acx.files.order-and-credits',
    title: 'Audio script: files in ACX order (00 Opening Credits … NN Closing Credits) with title, author and narrator in both credits; the table of contents left out',
    kind: 'client-only',
    reason: 'The audio script plan and its zip are built in the client from the open book; the server never sees the scripts.',
  },
  {
    id: 'acx.script.notes-images-pauses',
    title: 'Audio script: footnotes become narrator-decision notes, pictures become [IMAGE: alt], scene breaks become pauses',
    kind: 'client-only',
    reason: 'Script lines are generated in the client from the manuscript text and section metadata.',
  },
  {
    id: 'acx.pron.detect-roundtrip-first-note',
    title: 'Pronunciation guide: candidates detected, entries round-trip with the book, first-occurrence note only',
    kind: 'client-only',
    reason: 'Detection and the guide are client state; the guide rides the manuscript document the server stores opaquely.',
  },
  {
    id: 'acx.estimate.words-per-hour',
    title: "Audio script: length estimate is words / 9,300 (ACX's average) and a file over 120 minutes is warned",
    kind: 'client-only',
    reason: 'The estimate is computed in the client summary screen from word counts; nothing is recorded or measured.',
  },
  /* ---- Beta-reader share links ---- */
  {
    id: 'shares.schema.tables-present',
    title: 'Share links: shares, share_comments and share_readers tables exist',
    kind: 'server',
    run: async ({ db }) => {
      const r = await db.query<{ n: string | number }>(
        `select count(*) as n from information_schema.tables
         where table_name in ('shares', 'share_comments', 'share_readers')`,
      );
      assert(Number(r.rows[0].n) === 3, `expected 3 share tables, found ${r.rows[0].n}`);
      return 'shares, share_comments and share_readers present';
    },
  },
  {
    id: 'shares.tokens.stored-hashed-only',
    title: 'Share links: every stored link token is a SHA-256 hash, never the token itself',
    kind: 'server',
    run: async ({ db }) => {
      const r = await db.query<{ n: string | number }>(
        `select count(*) as n from shares where token_hash !~ '^[0-9a-f]{64}$'`,
      );
      const total = await db.query<{ n: string | number }>('select count(*) as n from shares');
      assert(Number(r.rows[0].n) === 0, `${r.rows[0].n} share row(s) hold a token that is not a SHA-256 hash`);
      return `${total.rows[0].n} share row(s), all token columns are 64-hex hashes`;
    },
  },
  {
    id: 'shares.reader.hostile-book-renders-inert',
    title: 'Share links: a book carrying <script>, on* handlers and javascript: links renders inert',
    kind: 'server',
    run: async () => {
      const { snapshot } = renderSnapshot(
        {
          meta: { title: '<script>alert(1)</script>' },
          sections: [
            {
              id: 'x',
              kind: 'body',
              type: 'chapter',
              title: '<img src=x onerror=alert(1)>',
              content: '<script>alert(2)</script>\n\n<a href="javascript:alert(3)">x</a>',
            },
          ],
        },
        'check',
      );
      const html = snapshot.sections.map((s) => sanitizeHtml(s.html)).join('');
      assert(!/<script/i.test(html), 'a <script> tag survived');
      assert(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(html), 'an event-handler attribute survived');
      assert(!/(href|src)\s*=\s*["']?\s*javascript:/i.test(html), 'a javascript: URL survived');
      const raw = sanitizeHtml('<p onclick="x()">a</p><a href="javascript:alert(1)">b</a><img src=x onerror=alert(1)>');
      assert(raw === '<p>a</p><a>b</a>', `sanitizer output was ${raw}`);
      return 'renderer escapes book text; sanitizer drops scripts, handlers, javascript: links and unsafe images';
    },
  },
  {
    id: 'shares.studio.signed-out-shows-why',
    title: 'Share links: signed out, the Export dialog explains why sharing needs a shelf',
    kind: 'client-only',
    reason: 'The share panel and its signed-out note are client UI state (the API already requires auth).',
  },
  {
    id: 'shares.studio.create-copy-revoke-republish',
    title: 'Share links: the studio creates a link (copy button), lists links with reader/comment counts, revokes and republishes',
    kind: 'client-only',
    reason: 'The share list and its controls are rendered by the client over the /api/shares owner endpoints.',
  },
  {
    id: 'shares.studio.comments-panel-jump-resolve',
    title: 'Share links: the Reader comments panel shows comments by section/paragraph, jumps to them and resolves them',
    kind: 'client-only',
    reason: 'Anchoring a comment to the open book (section + paragraph + quote) happens in the client editor.',
  },
  // EPUB manifest properties + spine reach (EPUB 3.3 §5.6.2.1 / §5.7.1,
  // https://www.w3.org/TR/epub-33/#sec-item-resource-properties,
  // https://www.w3.org/TR/epub-33/#sec-spine-elem). The package is
  // assembled in the studio, so these run there.
  {
    id: 'epub.props.detect-from-content',
    title: 'EPUB: svg / mathml / scripted / switch / remote-resources are detected from each document\'s own markup',
    kind: 'client-only',
    reason: 'Property detection runs on the XHTML/CSS the studio generates, with the browser DOMParser.',
  },
  {
    id: 'epub.props.sample-declared-exactly',
    title: 'EPUB: the sample book declares exactly the manifest properties each file needs, in every preset and as a box set',
    kind: 'client-only',
    reason: 'The EPUB package (epubFiles / boxSetFiles) is assembled in the client from the open book.',
  },
  {
    id: 'epub.props.recomputed-not-trusted',
    title: 'EPUB: a missing svg is restored and stale detected properties are removed; nav and cover-image are kept',
    kind: 'client-only',
    reason: 'The manifest is rewritten by the client package builder before download.',
  },
  {
    id: 'epub.spine.nav-links-reach-spine',
    title: 'EPUB: every document linked from the nav or the text is in the spine (contents page, or nav as linear="no")',
    kind: 'client-only',
    reason: 'Nav, landmarks and spine are generated by the client package builder.',
  },
  {
    id: 'validator.catches.undeclared-svg-and-off-spine-link',
    title: 'Validator: an inline-SVG document without properties="svg" and a link to a non-spine document are caught',
    kind: 'client-only',
    reason: 'These two checks live in the studio package validator (validateEpubPackage); the server validator does not carry them yet.',
  },
  {
    id: 'epub.identifier.real-uuid',
    title: 'EPUB: new books, imports and the sample carry a real RFC 9562 UUID identifier',
    kind: 'client-only',
    reason: 'Book identifiers are minted in the client when a book is created or imported.',
  },  {
    id: 'help.validator.beuk-codes',
    title: 'Help: every studio validator check maps to a BEUK- code, and each line that is not a pass links to /help/errors/<code>',
    kind: 'client-only',
    reason: 'The structural validator and its result list run in the studio; the server side of the mapping is covered by tests/help-content.test.ts.',
  },
  {
    id: 'bookid.v5.rfc-vector',
    title: 'Book ID: the UUIDv5 routine reproduces the RFC 9562 Appendix A.4 vector and SHA-1 the FIPS 180-4 test digests',
    kind: 'client-only',
    reason: 'The UUIDv5/SHA-1 routine runs in the client, where old book ids are migrated on arrival.',
  },
  {
    id: 'bookid.migrate.legacy-book',
    title: 'Book ID: an old non-UUID id migrates to the expected UUIDv5, keeps the old id in legacyBookIds, snapshots History first and ships the new id',
    kind: 'client-only',
    reason: 'Migration runs in the client (applyBookDoc); the server stores the book document as-is and never rewrites its ids.',
  },
  {
    id: 'bookid.migrate.idempotent',
    title: 'Book ID: migration is idempotent across re-applying, a second device and restoring the pre-migration snapshot',
    kind: 'client-only',
    reason: 'Migration and History live in the client book document.',
  },
  {
    id: 'bookid.match.legacy-and-new',
    title: 'Book ID: shelf matching treats migrated and un-migrated copies as one book and never matches a different one',
    kind: 'client-only',
    reason: 'Shelf matching by book id runs in the client (cloudAfterSignIn, backup open); the server keys manuscripts and shares by manuscript id only.',
  },
  {
    id: 'bookid.sample.stays-sample',
    title: "Book ID: the pre-UUID sample id migrates to the sample's fixed UUID and stays the sample",
    kind: 'client-only',
    reason: 'Sample detection is a client concern (isSampleBookId).',
  },
  /* ==== BEUK:cast ==== Story Insights — Names on stage (client-side) */
  {
    id: 'insights.cast.detects',
    title: 'Names on stage: recurring capitalised names are found and counted per section (a title pair as one name, possessives merged); a capitalised word that only opens sentences is not taken for a name',
    kind: 'client-only',
    reason: 'Name detection runs in the studio on the book on the device (castCompute); nothing is sent to the server.',
  },
  {
    id: 'insights.cast.hide-persists',
    title: 'Names on stage: hidden names ride with the book (meta.castHidden) through serializeBook/applyBookDoc and never leak into the next book',
    kind: 'client-only',
    reason: 'The hidden list lives in the client book document; the server stores the document whole and never reads it.',
  },
  {
    id: 'insights.cast.caseless-note',
    title: 'Names on stage: scripts without letter case (Japanese, Arabic) get the honest note instead of guessed names; a cased script (Cyrillic) is read',
    kind: 'client-only',
    reason: 'Script detection and the note are studio UI.',
  },
  /* ==== /BEUK:cast ==== */
  /* ==== BEUK:imagelib ==== The image library: where a picture is used, and removing it (client-side) */
  {
    id: 'images.usage.finds-every-role',
    title: 'Image library: one usage map finds a picture in every role (text, frontispiece, plate, backdrop, scene, cover artwork, flap photo, ornament, heading flourish, saved theme) and counts only unreferenced, non-sample pictures as unused',
    kind: 'client-only',
    reason: 'The usage map reads the client book document (imglibUsageMap); the server stores the book whole and never reads it.',
  },
  {
    id: 'images.delete.unused-undo',
    title: 'Image library: an unused picture is removed without a question, after a "Before removing a picture" snapshot, with a 10-second Undo that puts it back in place',
    kind: 'client-only',
    reason: 'The delete control, the History snapshot and the Undo toast are studio UI over the client book.',
  },
  {
    id: 'images.delete.used-clears-roles',
    title: 'Image library: a used picture asks first, listing where it is used; Remove it everywhere clears every role like the editor’s own controls; Undo restores the book byte for byte',
    kind: 'client-only',
    reason: 'The confirmation and the clearing of plates, backdrops, scenes, cover and flourishes happen in the studio on the client book.',
  },
  {
    id: 'images.cleanup.unused-only',
    title: 'Image library: Remove unused pictures removes exactly the unreferenced, non-sample pictures with their total size shown, and is disabled with a note when there are none',
    kind: 'client-only',
    reason: 'The cleanup button and its count are computed in the studio from the book on the device.',
  },
  {
    id: 'images.delete.leaves-serialized-book',
    title: 'Image library: a removed picture leaves serializeBook() and the device-save record; only the History snapshot taken before holds it, shared by a run of removals',
    kind: 'client-only',
    reason: 'serializeBook and the IndexedDB record are built in the browser; the shelf receives that document as opaque JSON.',
  },
  /* ==== /BEUK:imagelib ==== */
];

/* ------------------------------------------------------------------ */

export interface SelfCheckRun {
  overall: 'pass' | 'fail';
  passCount: number;
  failCount: number;
  clientOnlyCount: number;
  notConfiguredCount: number;
  results: CaseResult[];
}

export async function runSelfChecks(ctx: CheckContext): Promise<SelfCheckRun> {
  const results: CaseResult[] = [];
  for (const registryCase of SELF_CHECK_CASES) {
    if (registryCase.kind === 'client-only') {
      results.push({
        id: registryCase.id,
        title: registryCase.title,
        status: 'client-only',
        detail: registryCase.reason ?? 'Client-only case.',
      });
      continue;
    }
    try {
      const detail = await registryCase.run!(ctx);
      results.push({ id: registryCase.id, title: registryCase.title, status: 'pass', detail });
    } catch (err) {
      results.push({
        id: registryCase.id,
        title: registryCase.title,
        status: err instanceof NotConfigured ? 'not-configured' : 'fail',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const passCount = results.filter((r) => r.status === 'pass').length;
  const failCount = results.filter((r) => r.status === 'fail').length;
  const clientOnlyCount = results.filter((r) => r.status === 'client-only').length;
  const notConfiguredCount = results.filter((r) => r.status === 'not-configured').length;
  return {
    notConfiguredCount,
    overall: failCount ? 'fail' : 'pass',
    passCount,
    failCount,
    clientOnlyCount,
    results,
  };
}

export function buildCheckContext(db: Db, config: Config): CheckContext {
  return { db, config, fixtures: loadFixtures() };
}

/** Package-relative path used by restore verification and tests. */
export function resolvePackagePath(fromDir: string, href: string): string {
  return resolvePath(fromDir, href).path;
}
