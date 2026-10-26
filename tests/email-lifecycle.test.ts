import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { changeConfirmEmail, changeNoticeEmail, signupConfirmEmail } from '../src/account/confirm.js';
import { html, raw, renderEmail } from '../src/email/layout.js';
import { priceLabel, trialWords, welcomeEmail } from '../src/email/welcome.js';
import { createMailer, smtpMessage, type MailMessage, type Mailer, type MailerStatus, type MailResult } from '../src/mailer.js';
import { resetEmail } from '../src/routes/account.js';
import type { BillingProvider } from '../src/billing.js';
import { Client, createTestDb, registerUser, startTestServer, testConfig } from './helpers.js';

/* Lifecycle email: the shared layout, the welcome email, the support
 * address wherever a writer looks for help, and docs/email-setup.md's
 * list of every email the code can send. */

const root = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => readFileSync(path.join(root, ...p), 'utf8');

/** A configured mailer that records instead of sending. */
class RecordingMailer implements Mailer {
  sent: MailMessage[] = [];
  status(): MailerStatus {
    return { configured: true, transport: 'smtp', from: 'Beuk <hello@example.com>', detail: 'recording mailer (test)' };
  }
  async send(message: MailMessage): Promise<MailResult> {
    this.sent.push(message);
    return { delivered: true, messageId: `<test-${this.sent.length}@example.com>` };
  }
  async verify() {
    return { ok: true, detail: 'recording mailer (test)' };
  }
}

async function pageWithCookie(client: Client, url: string): Promise<{ status: number; text: string }> {
  const cookie = (client as unknown as { cookieHeader(): Record<string, string> }).cookieHeader();
  const res = await fetch(url, { headers: cookie });
  return { status: res.status, text: await res.text() };
}

/* ------------------------------------------------------------------ */
/* The layout                                                          */

test('layout: plain text + HTML, one footer saying why, who and where', () => {
  const config = testConfig({ appBaseUrl: 'https://beuk.example', mailFrom: 'Beuk <hello@beuk.example>' });
  const m = renderEmail(config, {
    subject: 'A subject',
    text: ['First line.', '', 'Second line.'],
    html: html`<p>First line.</p>`,
    reason: 'a test asked for it',
  });
  assert.equal(m.subject, 'A subject');
  assert.ok(m.text.startsWith('First line.\n\nSecond line.\n\n--\n'), m.text);
  assert.ok(m.text.includes('You got this email because a test asked for it.'));
  assert.ok(m.text.includes('Sent by Beuk (https://beuk.example) from Beuk <hello@beuk.example>.'));
  assert.ok(m.text.endsWith('Your account: https://beuk.example/account'));
  assert.match(m.html, /^<!doctype html>/);
  assert.match(m.html, /<html lang="en">/);
  assert.ok(m.html.includes('<title>A subject</title>'));
  assert.ok(m.html.includes('<p>First line.</p>'));
  assert.ok(m.html.includes('You got this email because a test asked for it.'));
  // The sender's angle brackets are escaped in HTML.
  assert.ok(m.html.includes('from Beuk &lt;hello@beuk.example&gt;.'));
  assert.ok(m.html.includes('<a href="https://beuk.example/account" style="color:#7a3e12;">Your account</a>'));
  // No unsubscribe link, no images, no remote resources, calm copy.
  assert.doesNotMatch(m.html + m.text, /unsubscribe/i);
  assert.doesNotMatch(m.html, /<img|<link|<script|https?:\/\/(?!beuk\.example)/);
  assert.doesNotMatch(m.text + m.html.replace(/<!doctype/i, ''), /!/);

  // Without MAIL_FROM the footer names only the site.
  const bare = renderEmail(testConfig({ appBaseUrl: 'https://beuk.example', mailFrom: null }), {
    subject: 's',
    text: ['t'],
    html: html`<p>t</p>`,
    reason: 'r',
  });
  assert.ok(bare.text.includes('Sent by Beuk (https://beuk.example).'));
});

test('layout: every interpolated value is escaped; raw() and nested html pass through', () => {
  const evil = '<script>alert("x")</script> & \'q\'';
  const out = html`<p>${evil}</p>${raw('<b>fixed</b>')}${html`<i>${'<u>'}</i>`}${[html`<em>a</em>`, '<b>']}${null}${false}`;
  assert.equal(
    out.value,
    '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;</p><b>fixed</b><i>&lt;u&gt;</i><em>a</em>&lt;b&gt;',
  );
  const config = testConfig({ appBaseUrl: 'https://beuk.example' });
  const m = renderEmail(config, { subject: '<Subject & co>', text: [evil], html: html`<p>${evil}</p>`, reason: '<reason>' });
  assert.ok(m.html.includes('<title>&lt;Subject &amp; co&gt;</title>'));
  assert.ok(m.html.includes('You got this email because &lt;reason&gt;.'));
  assert.doesNotMatch(m.html, /<script>/);
  // Plain text stays plain: nothing escaped there.
  assert.ok(m.text.startsWith(evil));
});

test('the reset, confirmation and change emails keep their words, now in the layout', () => {
  const config = testConfig({ appBaseUrl: 'https://beuk.example', mailFrom: 'hello@beuk.example' });
  const link = 'https://beuk.example/x?token=a&b=<c>';
  const reset = resetEmail(config, link);
  assert.equal(reset.subject, 'Reset your Beuk password');
  assert.ok(reset.text.includes(`Choose a new password here — the link works once, for 60 minutes:\n${link}\n`));
  assert.ok(reset.html.includes('href="https://beuk.example/x?token=a&amp;b=&lt;c&gt;"'));
  assert.ok(reset.text.includes('because someone asked to reset the password'));

  const confirm = signupConfirmEmail(config, link);
  assert.equal(confirm.subject, 'Confirm your email address for Beuk');
  assert.ok(confirm.text.includes('Welcome to Beuk. To confirm that this is your address, open this link'));
  assert.ok(confirm.text.includes("If you didn't create a Beuk account, ignore this email."));

  const change = changeConfirmEmail(config, link, 'old<x>@example.com');
  assert.equal(change.subject, 'Confirm your new email address for Beuk');
  assert.ok(change.html.includes('the Beuk account old&lt;x&gt;@example.com asked'));

  const notice = changeNoticeEmail(config, 'new@example.com');
  assert.equal(notice.subject, 'Your Beuk email address is about to change');
  assert.ok(!/token=/.test(notice.text + notice.html), 'the notice never carries a link to confirm');

  for (const m of [reset, confirm, change, notice]) {
    // The old "— Beuk (<site>)" sign-off is now the shared footer.
    assert.ok(!m.text.includes('— Beuk ('), m.subject);
    assert.ok(m.text.endsWith('Your account: https://beuk.example/account'), m.subject);
    assert.ok(m.html.includes('Sent by Beuk (https://beuk.example) from hello@beuk.example.'), m.subject);
    assert.doesNotMatch(m.text, /!/, m.subject);
  }
});

/* ------------------------------------------------------------------ */
/* The welcome email                                                   */

test('welcome: sent once at sign-up when mail is configured, with the confirmation link inside; "send again" is the plain confirmation', async () => {
  const db = await createTestDb();
  const mailer = new RecordingMailer();
  const s = await startTestServer(db, undefined, {}, undefined, { mailer });
  try {
    const c = new Client(s.base);
    const reg = await registerUser(c, 'writer@example.com');
    assert.equal(reg.status, 201);
    assert.equal(reg.body.emailDelivery, 'email');
    await s.settle();
    assert.equal(mailer.sent.length, 1, 'one email for one sign-up, not two');
    const w = mailer.sent[0];
    assert.equal(w.to, 'writer@example.com');
    assert.equal(w.subject, 'Confirm your email address, and welcome to Beuk');
    assert.match(w.text, /\/account\/confirm\?token=[A-Za-z0-9_-]+/);
    for (const words of ['a shelf', 'an archive', 'beta readers', 'EPUBCheck', 'Writing never needs an account', '7-day free trial', 'announced before launch', '/help/', '/account']) {
      assert.ok(w.text.includes(words), `welcome says: ${words}`);
    }
    assert.ok(w.html && w.html.includes('<li>a shelf, so your books follow you'), 'html list');
    assert.doesNotMatch(w.text, /[$€£]\s?\d|\/\s?month|!/, 'no price, no exclamation');
    // Plans are not switched on in the test server: the email says so.
    assert.ok(w.text.includes("Plans aren't switched on on this server yet"));

    // Signing in again sends nothing.
    await c.post('/api/auth/login', { email: 'writer@example.com', password: 'correct horse battery' });
    await s.settle();
    assert.equal(mailer.sent.length, 1);

    // "Send the link again" is the plain confirmation, never a second welcome.
    const again = await c.post('/api/account/confirm/resend', {});
    assert.equal(again.status, 200, JSON.stringify(again.body));
    await s.settle();
    assert.equal(mailer.sent.length, 2);
    const last = mailer.sent[1];
    assert.equal(last.subject, 'Confirm your email address for Beuk');

    // The newest link confirms the address.
    const token = /\/account\/confirm\?token=([A-Za-z0-9_-]+)/.exec(last.text)![1];
    const done = await fetch(`${s.base}/account/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });
    assert.equal(done.status, 200);
    assert.equal((await c.get('/api/account/summary')).body.emailConfirmed, true);
    assert.equal(mailer.sent.filter((m) => /welcome/i.test(m.subject)).length, 1, 'the welcome is sent once');
  } finally {
    await s.close();
  }
});

test('welcome: the plan in plain words; a trial only when the server tracks one; a price only as BILLING_PRICE_LABEL', () => {
  const trial = { startedAt: '2026-10-26T10:00:00.000Z', endsAt: '2026-11-02T10:00:00.000Z', active: true };
  // Plans on, trial tracked: when it ends.
  assert.equal(
    trialWords({ billingOn: true, trial, priceLabel: null }),
    'Your 7-day free trial started with this account and runs until 2 Nov 2026, then one price for complete access, announced before launch. Exporting your book stays open whatever happens with a plan.',
  );
  assert.ok(trialWords({ billingOn: true, trial, priceLabel: 'LABEL-AS-SET' }).includes('then LABEL-AS-SET for complete access.'));
  // Plans on, no trial tracked (today's code): no trial claimed at all.
  assert.equal(
    trialWords({ billingOn: true, trial: null, priceLabel: null }),
    'Beuk is one price for complete access. Your account page shows your plan. Exporting your book stays open whatever happens with a plan.',
  );
  assert.equal(
    trialWords({ billingOn: true, trial: null, priceLabel: 'LABEL-AS-SET' }),
    'Beuk is LABEL-AS-SET for complete access. Your account page shows your plan. Exporting your book stays open whatever happens with a plan.',
  );
  assert.doesNotMatch(trialWords({ billingOn: true, trial: { ...trial, active: false }, priceLabel: null }), /trial/);
  // Plans off.
  assert.ok(trialWords({ billingOn: false, trial: null, priceLabel: null }).startsWith("Plans aren't switched on on this server yet"));

  const config = testConfig({ appBaseUrl: 'https://beuk.example' });
  // The label is Config's (BILLING_PRICE_LABEL, read once in src/config.ts); blank counts as unset.
  assert.equal(priceLabel({ ...config, billingPriceLabel: null }), null);
  assert.equal(priceLabel({ ...config, billingPriceLabel: '   ' }), null);
  assert.equal(priceLabel({ ...config, billingPriceLabel: ' LABEL ' }), 'LABEL');
  assert.equal(priceLabel({ ...config, billingPriceLabel: null }, { BILLING_PRICE_LABEL: 'FROM-ENV' }), null, 'Config wins over the environment');

  const m = welcomeEmail(config, 'https://beuk.example/account/confirm?token=t', { billingOn: true, trial, priceLabel: '<b>LABEL</b>' });
  assert.ok(m.text.includes('then <b>LABEL</b> for complete access'));
  assert.ok(m.html.includes('then &lt;b&gt;LABEL&lt;/b&gt; for complete access'), 'the label is escaped in HTML');
});

/** A billing provider that says checkout is configured; nothing else is called. */
function checkoutBilling(mode: 'test' | 'live'): BillingProvider {
  const never = () => {
    throw new Error('not called in this test');
  };
  return {
    configured: true,
    checkoutConfigured: true,
    mode,
    misconfiguration: null,
    verifyWebhook: () => null,
    createCheckoutSession: never,
    retrieveSubscription: never,
    listCustomerSubscriptionIds: never,
    retrieveCharge: never,
  };
}

test('welcome: plans on or off is decided as the account page decides it, and neither claims a trial the server does not track', async () => {
  const cases = [
    // Checkout configured, entitlements load: plans on, and the account's trial (migration 016) has started.
    { name: 'plans on', overrides: {}, mode: 'test' as const, on: true },
    // Checkout configured, but the entitlements file does not load: the account page says plans are off.
    { name: 'entitlements broken', overrides: { entitlementsFile: '/nonexistent/beuk-entitlements.json' }, mode: 'live' as const, on: false },
  ];
  for (const k of cases) {
    const db = await createTestDb();
    const mailer = new RecordingMailer();
    const s = await startTestServer(db, undefined, k.overrides, undefined, { mailer, billing: checkoutBilling(k.mode) });
    try {
      const c = new Client(s.base);
      assert.equal((await registerUser(c, 'plan@example.com')).status, 201);
      await s.settle();
      assert.equal(mailer.sent.length, 1, k.name);
      const text = mailer.sent[0].text;
      const page = (await pageWithCookie(c, `${s.base}/account`)).text;
      if (k.on) {
        // The email and the account page tell the same trial, to the same day.
        const m = /Your 7-day free trial started with this account and runs until ([^,]+), then one price for complete access, announced before launch\./.exec(text);
        assert.ok(m, `${k.name}: ${text}`);
        assert.ok(page.includes(`Your free trial runs until ${m[1]}`), `${k.name}: the account page agrees on ${m[1]}`);
      } else {
        assert.ok(text.includes("Plans aren't switched on on this server yet"), `${k.name}: ${text}`);
        assert.match(page, /Plans are not switched on on this server yet\./, `${k.name}: the account page agrees`);
      }
    } finally {
      await s.close();
    }
  }
});

test('replies: Reply-To is SUPPORT_EMAIL when it is set, and absent while it is not', async () => {
  const msg = { to: 'w@example.com', subject: 's', text: 't' };
  const withSupport = smtpMessage(testConfig({ mailFrom: 'Beuk <hello@mail.beuk.example>', supportEmail: 'help@beuk.example' }), msg);
  assert.equal(withSupport.from, 'Beuk <hello@mail.beuk.example>');
  assert.equal(withSupport.replyTo, 'help@beuk.example');
  assert.equal(withSupport.to, 'w@example.com');
  const without = smtpMessage(testConfig({ mailFrom: 'Beuk <hello@mail.beuk.example>', supportEmail: null }), msg);
  assert.ok(!('replyTo' in without), 'no Reply-To while SUPPORT_EMAIL is unset');

  const lines: string[] = [];
  const logged = createMailer(testConfig({ smtpUrl: null, mailFrom: null, mailLogLinks: true, supportEmail: 'help@beuk.example' }), { log: (l) => lines.push(l) });
  await logged.send(msg);
  assert.ok(lines.join('\n').includes('Reply-To: help@beuk.example'));

  const doc = read('docs', 'email-setup.md');
  assert.match(doc, /Beuk adds a `Reply-To:` header with that\s+address/);
});

test('not configured: no welcome, nothing claimed as sent, the would-be confirmation only logged', async () => {
  const db = await createTestDb();
  const lines: string[] = [];
  const config = testConfig({ smtpUrl: null, mailFrom: null, mailLogLinks: true });
  const mailer = createMailer(config, { log: (l) => lines.push(l) });
  const s = await startTestServer(db, undefined, { smtpUrl: null, mailFrom: null, mailLogLinks: true }, undefined, { mailer });
  try {
    const c = new Client(s.base);
    const reg = await registerUser(c, 'quiet@example.com');
    assert.equal(reg.status, 201);
    assert.equal(reg.body.emailDelivery, 'not-configured');
    await s.settle();
    const log = lines.join('\n');
    assert.ok(log.includes('NOT SENT: email not configured'), log);
    assert.ok(log.includes('Subject: Confirm your email address for Beuk'), 'the plain confirmation, not the welcome');
    assert.ok(!/welcome to Beuk/i.test(log.split('\n').filter((l) => l.startsWith('Subject:')).join('\n')));
    const page = await pageWithCookie(c, `${s.base}/account`);
    assert.match(page.text, /Email isn’t set up on this server yet/);
  } finally {
    await s.close();
  }
});

/* ------------------------------------------------------------------ */
/* The support address                                                 */

test('support address: account page and status page show it only when SUPPORT_EMAIL is set', async () => {
  for (const supportEmail of [null, 'help@beuk.example']) {
    const db = await createTestDb();
    const s = await startTestServer(db, undefined, { supportEmail, supportName: 'Vik', supportReplyPromise: 'within two working days' }, undefined, {
      mailer: new RecordingMailer(),
    });
    try {
      const c = new Client(s.base);
      await registerUser(c, 'a@example.com');
      await s.settle();
      const signedIn = await pageWithCookie(c, `${s.base}/account`);
      const signedOut = await (await fetch(`${s.base}/account`)).text();
      const status = await (await fetch(`${s.base}/status`)).text();
      assert.equal(signedIn.status, 200);
      assert.match(signedIn.text, /<section class="portal-card" id="help"/, 'Help card always');
      assert.match(signedIn.text, /<a href="\/help\/">Help<\/a> has a guide/);
      for (const [name, body] of [['account', signedIn.text], ['signed out', signedOut], ['status', status]] as const) {
        if (supportEmail) {
          assert.ok(body.includes('href="mailto:help@beuk.example"'), `${name}: shows the address`);
        } else {
          assert.doesNotMatch(body, /mailto:/, `${name}: no mailto while unset`);
          assert.doesNotMatch(body, /write to|two working days|\bVik\b|data-support-email/i, `${name}: no person or promise`);
        }
      }
      if (supportEmail) {
        assert.match(signedIn.text, /or you are stuck, write to <a href="mailto:help@beuk\.example" data-support-email>/);
        assert.match(status, /If something here stays wrong, write to <a href="mailto:help@beuk\.example">/);
      }
    } finally {
      await s.close();
    }
  }
});

test('support address: the studio hides Support and the settings line until its server names an address', () => {
  const studio = read('client', 'index.html');
  assert.ok(studio.includes('<p class="cover-note" id="supportLineSettings" hidden></p>'));
  assert.ok(studio.includes('if (btn) btn.style.display = beukSupportEmail ? "" : "none";'));
  assert.ok(studio.includes('fetch("/api/config/public", { credentials: "omit" })'));
  assert.ok(studio.includes('beukSupportLoad(); /* BEUK:support'));
  assert.ok(studio.includes('beukSupportApply(); /* BEUK:support */'));
  for (const lang of ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'ar', 'ja', '["zh-Hans"]']) {
    const head = lang.startsWith('[') ? `Object.assign(UI_STRINGS${lang}, { "support.settingsLine": "` : `Object.assign(UI_STRINGS.${lang}, { "support.settingsLine": "`;
    const at = studio.indexOf(head);
    assert.ok(at !== -1, `support.settingsLine in ${lang}`);
    const value = studio.slice(at + head.length, studio.indexOf('" });', at));
    assert.ok(value.includes('{email}'), `${lang} keeps the {email} slot`);
    assert.doesNotMatch(value, /!/, `${lang}: calm copy`);
  }
});

test('support address: /compare\'s "tell us" links to Help, and becomes the address only when the server has one', () => {
  const html = read('client', 'site', 'compare', 'index.html');
  assert.ok(html.includes('If you spot something out of date, <a href="/help" data-support-tell>tell us</a> and we will correct it.'));
  assert.ok(html.includes('fetch("/api/config/public", { credentials: "omit" })'));
  assert.ok(html.includes('a.href = "mailto:" + e;'));
  assert.doesNotMatch(html, /mailto:[a-z]/i, 'no address written into the page');
});

/* ------------------------------------------------------------------ */
/* docs/email-setup.md lists every email the code can send             */

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

test('docs/email-setup.md lists every email the code can send, and nothing the code cannot', () => {
  const kinds = new Set<string>();
  const unmarked: string[] = [];
  for (const file of tsFiles(path.join(root, 'src'))) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      // A mail send is `<something>.send({` that is not an Express response.
      const m = /(\w+)\.send\(\s*\{?\s*$|(\w+)\.send\(\s*\{/.exec(line);
      if (!m) return;
      const recv = m[1] ?? m[2];
      if (recv === 'res') return;
      const before = lines.slice(Math.max(0, i - 3), i).join('\n');
      const kind = /email-kind: ([a-z-]+)/.exec(before);
      if (!kind) unmarked.push(`${path.relative(root, file)}:${i + 1}`);
      else kinds.add(kind[1]);
    });
  }
  assert.deepEqual(unmarked, [], 'every mail send carries an `email-kind:` marker');
  assert.ok(kinds.size >= 7, `found ${[...kinds].join(', ')}`);

  const doc = read('docs', 'email-setup.md');
  const table = new Set([...doc.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]));
  for (const k of kinds) assert.ok(table.has(k), `docs/email-setup.md lists ${k}`);
  // Only Stripe's receipt is in the table without a send in Beuk's code.
  const extra = [...table].filter((k) => !kinds.has(k));
  assert.deepEqual(extra, ['stripe-receipt']);
  assert.match(doc, /Sent by Stripe, not by Beuk/);
  assert.match(doc, /https:\/\/docs\.stripe\.com\/receipts/);
  assert.match(doc, /checked on \*\*26 October 2026\*\*/);
});
