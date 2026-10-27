import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig, type Config } from '../src/config.js';
import { applyConditionals, legalFlags, parseLegalSource, renderLegalBody, type LegalFlags } from '../src/legal/render.js';
import { renderReaderPage } from '../src/shares/reader.js';
import { createTestDb, startTestServer, testConfig } from './helpers.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => readFileSync(path.join(root, ...p), 'utf8');

async function withServer(overrides: Partial<Config>, fn: (base: string) => Promise<void>): Promise<void> {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, overrides);
  try {
    await fn(server.base);
  } finally {
    await server.close();
  }
}

async function get(base: string, p: string): Promise<{ status: number; type: string; html: string }> {
  const res = await fetch(`${base}${p}`);
  return { status: res.status, type: res.headers.get('content-type') ?? '', html: await res.text() };
}

const NO_SLOTS: Partial<Config> = {
  supportEmail: null,
  legal: { operatorName: null, contactEmail: null, jurisdiction: null, postalAddress: null, hostingLocation: null, effectiveDate: null },
};

const ALL_SLOTS: Partial<Config> = {
  legal: {
    operatorName: 'Ada <Example> Lovelace',
    contactEmail: 'privacy@example.com',
    jurisdiction: 'England and Wales',
    postalAddress: '1 Example Street, Exampletown',
    hostingLocation: 'Germany (Hetzner)',
    effectiveDate: '2026-11-01',
  },
};

/** The parts of a page a CSP (the Caddyfile's) would judge. */
function cspIssues(html: string, policy: string): string[] {
  const issues: string[] = [];
  // Inline scripts: every <script> must have a src (script-src 'self';
  // the warmth chrome carries none inline, and none are needed).
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc=/.test(m[1])) issues.push(`inline <script>: ${m[2].slice(0, 60)}`);
  }
  if (/\son[a-z]+\s*=/i.test(html.replace(/<!--[\s\S]*?-->/g, ''))) issues.push('inline event handler attribute');
  if (/javascript:/i.test(html)) issues.push('javascript: URL');
  // External resources must be on a host the policy names for that kind.
  const directive = (name: string) => new RegExp(`${name} ([^;]+)`).exec(policy)?.[1] ?? '';
  for (const m of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="(https?:\/\/[^"/]+)/gi)) {
    if (!directive('style-src').includes(m[1])) issues.push(`stylesheet host not allowed: ${m[1]}`);
  }
  for (const m of html.matchAll(/<(?:script|img)\b[^>]*src="(https?:\/\/[^"/]+)/gi)) {
    issues.push(`third-party script/img: ${m[1]}`);
  }
  return issues;
}

const caddyPolicy = (): string => {
  const m = /header \?Content-Security-Policy "([^"]+)"/.exec(read('Caddyfile'));
  assert.ok(m, 'Caddyfile policy');
  return m[1];
};

test('legal: /privacy and /terms serve 200 HTML that covers every inventory category', async () => {
  await withServer({}, async (base) => {
    const privacy = await get(base, '/privacy');
    assert.equal(privacy.status, 200);
    assert.match(privacy.type, /text\/html/);
    for (const needle of [
      'IndexedDB', // the device copy
      'argon2id', // password hash
      'beuk_session', // session cookie
      '30 days', // SESSION_TTL_DAYS default in testConfig
      'export archive',
      'EPUBCheck',
      'writing streak',
      'Password resets',
      'beuk_reader', // reader-count cookie
      'hash of their IP address', // comment ip_hash
      'Anyone who has the link can read the book and every comment',
      'Help search',
      'first 200 characters',
      'Founders',
      'no access log',
      'in memory only',
      'security policy', // CSP reports
      'Backups',
      'not deleted automatically',
      'serve their typefaces from Beuk',
      'Openverse',
    ]) {
      assert.ok(privacy.html.includes(needle), `/privacy should mention ${needle}`);
    }
    assert.match(privacy.html, /no button for this yet/);
    assert.doesNotMatch(privacy.html, /googleapis|gstatic|Google receives/, 'the fonts are self-hosted: the page must not say otherwise');
    assert.match(privacy.html, /Drafted from the code on 2026-10-25[^>]*Not legal advice/);
    assert.match(privacy.html, /<h2 id="your-rights-and-how-to-use-them">/);

    const terms = await get(base, '/terms');
    assert.equal(terms.status, 200);
    for (const needle of [
      'Your writing is yours',
      'free to use',
      'without an account',
      'Please don',
      'Reading copies are yours to look after',
      'backups are best effort',
      'Export a backup',
      'As it is',
      'Limits on responsibility',
      'To delete your account',
      'Changes',
      'The law that applies',
    ]) {
      assert.ok(terms.html.includes(needle), `/terms should mention ${needle}`);
    }
    assert.match(terms.html, /Drafted from the code on 2026-10-25[^>]*Not legal advice/);
    // Trailing-slash forms answer too.
    assert.equal((await get(base, '/privacy/')).status, 200);
    assert.equal((await get(base, '/terms/')).status, 200);
  });
});

test('legal: unset operator slots render the "being completed" notice, never a placeholder', async () => {
  await withServer(NO_SLOTS, async (base) => {
    for (const p of ['/privacy', '/terms']) {
      const { html } = await get(base, p);
      assert.match(html, /data-legal-incomplete/, `${p}: the incomplete box`);
      assert.match(html, /This page is still being completed/);
      assert.ok((html.match(/data-legal-pending/g) ?? []).length >= 3, `${p}: inline notices`);
      assert.match(html, /The operator&#39;s name|The operator's name has not been published yet/);
      assert.doesNotMatch(html, /\{\{|\}\}|\[\[|undefined|null\b|mailto:/, `${p}: no raw slot, no empty mailto`);
      assert.match(html, /Last changed 25 October 2026\./, `${p}: the content file's own date`);
    }
    const terms = (await get(base, '/terms')).html;
    assert.match(terms, /The governing law has not been published yet/);
    const privacy = (await get(base, '/privacy')).html;
    assert.match(privacy, /Where the server is located has not been published yet/);
    for (const [p, html] of [['/terms', terms], ['/privacy', privacy]]) {
      assert.doesNotMatch(html.replace(/<[^>]+>/g, ''), /\.\./, `${p}: an inline notice never doubles the full stop`);
    }
  });
});

test('legal: SUPPORT_EMAIL stands in for an unset LEGAL_CONTACT_EMAIL', async () => {
  await withServer({ supportEmail: 'shelf@example.com' }, async (base) => {
    const { html } = await get(base, '/privacy');
    assert.match(html, /<a href="mailto:shelf@example\.com">shelf@example\.com<\/a>/);
  });
  const cfg = loadConfig({ SUPPORT_EMAIL: 'help@example.com' } as NodeJS.ProcessEnv);
  assert.equal(cfg.legal.contactEmail, null);
  const cfg2 = loadConfig({ SUPPORT_EMAIL: 'help@example.com', LEGAL_CONTACT_EMAIL: ' law@example.com ' } as NodeJS.ProcessEnv);
  assert.equal(cfg2.legal.contactEmail, 'law@example.com');
  assert.equal(loadConfig({ LEGAL_EFFECTIVE_DATE: '2026-02-30' } as NodeJS.ProcessEnv).legal.effectiveDate, null);
  assert.equal(loadConfig({ LEGAL_EFFECTIVE_DATE: 'soon' } as NodeJS.ProcessEnv).legal.effectiveDate, null);
  assert.equal(loadConfig({ LEGAL_EFFECTIVE_DATE: '2026-11-01' } as NodeJS.ProcessEnv).legal.effectiveDate, '2026-11-01');
  assert.equal(loadConfig({} as NodeJS.ProcessEnv).legal.operatorName, null);
});

test('legal: set slots render their values (escaped) and no notice', async () => {
  await withServer(ALL_SLOTS, async (base) => {
    for (const p of ['/privacy', '/terms']) {
      const { html } = await get(base, p);
      assert.doesNotMatch(html, /data-legal-incomplete|data-legal-pending/, `${p}: nothing pending`);
      assert.match(html, /Ada &lt;Example&gt; Lovelace/, `${p}: operator, escaped`);
      assert.match(html, /1 Example Street, Exampletown/);
      assert.match(html, /mailto:privacy@example\.com/);
      assert.match(html, /In effect from 1 November 2026\./);
      assert.doesNotMatch(html, /\{\{|\[\[/);
    }
    assert.match((await get(base, '/terms')).html, /governed by the law of England and Wales/);
    assert.match((await get(base, '/privacy')).html, /The server is located in Germany \(Hetzner\)\./);
  });
});

test('legal: feature blocks follow this server\'s configuration', async () => {
  // Defaults: no billing, no Ko-fi, no off-site, no Pexels, no SMTP.
  await withServer({}, async (base) => {
    const privacy = (await get(base, '/privacy')).html;
    const terms = (await get(base, '/terms')).html;
    assert.doesNotMatch(privacy, /Stripe|Backblaze|Pexels|Ko-fi/);
    assert.doesNotMatch(terms, /Stripe|paid plan|Ko-fi/);
  });
  await withServer({ backupIntervalHours: 24 }, async (base) => {
    const privacy = (await get(base, '/privacy')).html;
    assert.match(privacy, /makes a backup of its data every 24 hours/);
    assert.doesNotMatch(privacy, /by hand/);
  });
  const offsite = { ...testConfig().offsite, b2KeyId: 'k', b2ApplicationKey: 'a', b2Bucket: 'b', b2Endpoint: 'https://s3.example', resticPassword: 'p' };
  await withServer(
    { kofiUrl: 'https://ko-fi.com/test', offsite, pexelsApiKey: 'px', smtpUrl: 'smtp://x@y:587', mailFrom: 'Beuk <a@b.c>' },
    async (base) => {
      const privacy = (await get(base, '/privacy')).html;
      assert.match(privacy, /Backblaze B2/);
      assert.match(privacy, /one a day for 7 days, one a week for 4 weeks, and one a month for 12 months/);
      assert.match(privacy, /Pexels/);
      assert.match(privacy, /Ko-fi/);
      assert.match(privacy, /password-reset link/);
      assert.match(privacy, /makes backups of the server&#39;s data by hand|makes backups of the server's data by hand/, 'testConfig: schedule off');
      assert.doesNotMatch(privacy, /every 0 hours/);
      const terms = (await get(base, '/terms')).html;
      assert.match(terms, /A tip says thank you and buys nothing/);
      assert.doesNotMatch(terms, /paid plan/, 'test-free: billing still off');
    },
  );
  // Billing counts only when live: a test-mode key is not "paid plans".
  const testMode = legalFlags(testConfig({ stripeSecretKey: 'sk_test_x', stripePriceId: 'price_1', stripeWebhookSecret: 'whsec_x' }));
  assert.equal(testMode.billing, false);
  const live = legalFlags(testConfig({ stripeSecretKey: 'sk_live_x', stripePriceId: 'price_1', stripeWebhookSecret: 'whsec_x' }));
  assert.equal(live.billing, true);
  const doc = parseLegalSource(read('content', 'legal', 'terms.md'));
  assert.match(renderLegalBody('terms', doc, testConfig({ stripeSecretKey: 'sk_live_x', stripePriceId: 'price_1', stripeWebhookSecret: 'whsec_x' })), /paid plan/);
});

test('legal: every flag combination leaves no directive or unknown slot behind', () => {
  const names: (keyof LegalFlags)[] = ['billing', 'kofi', 'offsite', 'stock', 'mail', 'schedule', 'noschedule'];
  for (const page of ['privacy', 'terms'] as const) {
    const source = read('content', 'legal', `${page}.md`);
    assert.equal((source.match(/^\[\[if /gm) ?? []).length, (source.match(/^\[\[end\]\]/gm) ?? []).length, `${page}: balanced blocks`);
    const doc = parseLegalSource(source);
    assert.equal(doc.updated, '2026-10-25');
    for (let mask = 0; mask < 1 << names.length; mask++) {
      const flags = Object.fromEntries(names.map((n, i) => [n, Boolean(mask & (1 << i))])) as unknown as LegalFlags;
      const md = applyConditionals(doc.body, flags);
      assert.doesNotMatch(md, /\[\[/, `${page} mask ${mask}`);
    }
    const html = renderLegalBody(page, doc, testConfig());
    assert.doesNotMatch(html, /\{\{|\}\}/, `${page}: every slot filled`);
  }
});

test('legal: 0 CSP issues against the enforced Caddyfile policy', async () => {
  const policy = caddyPolicy();
  for (const overrides of [NO_SLOTS, ALL_SLOTS, { kofiUrl: 'https://ko-fi.com/test' }]) {
    await withServer(overrides, async (base) => {
      for (const p of ['/privacy', '/terms']) {
        const { html } = await get(base, p);
        assert.deepEqual(cspIssues(html, policy), [], `${p}`);
      }
    });
  }
});

test('legal: linked from Help, warmth pages, reset, the reader and the studio', async () => {
  await withServer({ kofiUrl: 'https://ko-fi.com/test' }, async (base) => {
    for (const p of ['/help/', '/help/errors', '/thanks', '/support', '/changelog', '/roadmap', '/privacy', '/terms']) {
      const { status, html } = await get(base, p);
      assert.equal(status, 200, p);
      assert.match(html, /<a href="\/privacy"[^>]*>Privacy<\/a>/, `${p}: Privacy link`);
      assert.match(html, /<a href="\/terms"[^>]*>Terms<\/a>/, `${p}: Terms link`);
    }
  });
  assert.match(read('client', 'reset', 'index.html'), /<a href="\/privacy">Privacy<\/a> · <a href="\/terms">Terms<\/a>/);
  const reader = renderReaderPage({
    nonce: 'n',
    token: 't',
    snapshot: { v: 1, title: 'T', subtitle: '', author: '', language: 'en', sections: [{ id: 's1', kind: 'body', type: 'chapter', label: 'One', html: '<p>x</p>' }] },
    chapter: 0,
    allowComments: true,
    readerNameRequired: false,
  });
  assert.match(reader, /<a href="\/privacy" rel="noreferrer">Privacy<\/a>/);
  assert.match(reader, /<a href="\/terms" rel="noreferrer">Terms<\/a>/);

  const studio = read('client', 'index.html');
  assert.match(studio, /id="authLegal"[^\n]*href="\/privacy"[^\n]*href="\/terms"/);
  assert.match(studio, /id="legalLinksSettings" hidden[^\n]*href="\/privacy"[^\n]*href="\/terms"/);
  assert.match(studio, /ll\.hidden = !cloud\.available/);
  const block = /const LEGAL_STRINGS = \{\n([\s\S]*?)\n {6}\};/.exec(studio);
  assert.ok(block, 'LEGAL_STRINGS block');
  const langs = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'ar', 'ja', 'zh-Hans'];
  const rows = block[1].split('\n');
  assert.equal(rows.length, 13);
  for (const [i, lang] of langs.entries()) {
    assert.ok(rows[i].trim().startsWith(`"${lang}": {`), `${lang} row`);
    for (const key of ['legal.authLine', 'legal.settingsLine', 'legal.privacy', 'legal.terms']) {
      assert.match(rows[i], new RegExp(`"${key.replace('.', '\\.')}": "[^"]+"`), `${lang} ${key}`);
    }
  }
});

test('legal: Caddy proxies the pages to the app, and the workers leave them to the network', () => {
  const caddy = read('Caddyfile');
  const legal = caddy.indexOf('handle /privacy* {');
  assert.ok(legal > 0 && caddy.indexOf('handle /terms* {') > 0, 'handle blocks');
  assert.ok(legal < caddy.indexOf('# === STATIC CLIENT ==='), 'before the static fallback');
  assert.match(caddy.slice(legal, legal + 60), /reverse_proxy app:3000/);
  for (const sw of [read('client', 'sw.js'), read('client', 'assets', 'sw.js')]) {
    assert.match(sw, /\(help\|support\|thanks\|changelog\|roadmap\|privacy\|terms[|)]/);
    assert.match(sw, /const BEUK_CACHE = "beuk-shell-v16"/);
  }
  const env = read('.env.example');
  for (const k of ['LEGAL_OPERATOR_NAME', 'LEGAL_CONTACT_EMAIL', 'LEGAL_POSTAL_ADDRESS', 'LEGAL_JURISDICTION', 'LEGAL_HOSTING_LOCATION', 'LEGAL_EFFECTIVE_DATE']) {
    assert.match(env, new RegExp(`^${k}=$`, 'm'), `.env.example ${k}`);
    assert.match(read('docker-compose.yml'), new RegExp(`${k}: \\$\\{${k}:-\\}`), `compose ${k}`);
  }
});
