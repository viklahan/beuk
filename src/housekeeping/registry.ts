import { createHash } from 'node:crypto';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import { defaultMigrationsDir, type Db } from '../db.js';
import { fixtureEntries, loadFixtures, type FixtureSet } from './fixtures.js';
import { isUuid } from '../ids.js';
import { dummyPasswordHash, verifyAgainstDummy } from '../password.js';
import { TokenBucketLimiter } from '../ratelimit.js';
import { ghostscriptPdfxArgs, pdfRenderProblem, pdfxIccPath } from '../jobs/tools.js';
import { inspectPdf } from '../jobs/pdfinspect.js';
import { checkPdfxProfile } from '../jobs/iccprofile.js';
import {
  parseOpf,
  readZip,
  resolvePath,
  validateEpub,
  type ZipEntry,
} from './packages.js';
import { scanTags } from './xml.js';
import { clientDir, repoRoot } from '../warmth/pages.js';
import { createMailer, type Mailer } from '../mailer.js';
import { renderSnapshot } from '../shares/render.js';
import { sanitizeHtml } from '../shares/sanitize.js';

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
  status: 'pass' | 'fail' | 'client-only';
  detail: string;
}

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
        ['help', 'index.html'],
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
      assert(
        !missing.length,
        `warmth page sources missing from the deploy tree: ${missing.join(', ')}`,
      );
      return 'client/help/, client/thanks/ and CHANGELOG.md all readable from the deploy tree';
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
    title: 'Caddyfile sends the security headers (HSTS on real TLS only, CSP enforced + report-only)',
    kind: 'server',
    run: async () => {
      // Static proof from the deploy tree; the live headers are proven
      // by the Playwright check in the README "Security headers" section.
      const caddy = await readFile(path.join(repoRoot(), 'Caddyfile'), 'utf8');
      const missing = [
        'X-Content-Type-Options "nosniff"',
        'Referrer-Policy "strict-origin-when-cross-origin"',
        'X-Frame-Options "SAMEORIGIN"',
        'Content-Security-Policy "frame-ancestors',
        'Content-Security-Policy-Report-Only "',
        'header @hsts Strict-Transport-Security',
        'not host localhost 127.0.0.1',
      ].filter((needle) => !caddy.includes(needle));
      assert(!missing.length, `Caddyfile is missing: ${missing.join('; ')}`);
      return 'nosniff, referrer policy, frame protection, CSP (enforced + report-only) and TLS-only HSTS all present';
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
      assert(
        args.filter((a) => a.startsWith('--permit-file-read')).length === 1 && args.includes(`--permit-file-read=${icc}`),
        'Ghostscript must permit reading exactly the ICC profile the definition embeds',
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
      'The tagline (“your free & open-source EPUB converter”, string-table key brand.tagline, all 13 locales) is header chrome rendered by the client; it truncates as the bar narrows and hides below 1400px and in zen mode.',
  },
  {
    id: 'ui.zen.mode-hides-the-room',
    title: 'Zen mode hides the structure pane, preview and topbar; leaving restores the room',
    kind: 'client-only',
    reason: 'Zen is a client body-class layout state over the studio chrome.',
  },
  {
    id: 'ui.sidebar.scroll-survives-rerender',
    title: 'Structure pane keeps its scroll position across sidebar rebuilds',
    kind: 'client-only',
    reason: 'Scroll restoration happens in the client sidebar renderer on every rebuild.',
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
  },
];

/* ------------------------------------------------------------------ */

export interface SelfCheckRun {
  overall: 'pass' | 'fail';
  passCount: number;
  failCount: number;
  clientOnlyCount: number;
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
        status: 'fail',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const passCount = results.filter((r) => r.status === 'pass').length;
  const failCount = results.filter((r) => r.status === 'fail').length;
  const clientOnlyCount = results.filter((r) => r.status === 'client-only').length;
  return {
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
