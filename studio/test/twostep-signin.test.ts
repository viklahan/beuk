import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { importBook } from '../../src/book/editor/index';
import { base32Decode, totpCode, totpStep } from '../../src/twostep/totp';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import markup from '../src/generated/cloud-markup.json';
import { cloudFacts, loadClosure, pageToast, resetCloudFacts, setClosureLang, setClosureT } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { bootCloud, cloudReset, cloudUi, deskChanged, loadCloud, type CloudClosure } from '../src/cloud/cloud';
import { fixtures } from './fixtures';
import { browser, startShelf, type Shelf } from './cloud-server';

/* Account hardening, task 4: the studio sign-in's code step (1.0's #modalAuth, BEUK:twostep), run by 1.0's own cloud
   code (closure-cloud.js) against the REAL server (test/cloud-server.ts, PGlite in this process). The server's clock is
   the shelf's (shelf.clock), so every code is computed here for a known 30 s step, and the clock only moves forward. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
const PASSWORD = 'correct horse battery';
const KEYS = ['auth.codeTitle', 'auth.codeSub', 'auth.codeLabel', 'auth.codeVerify', 'auth.codeWrong', 'auth.codeExpired'];
let cm: CloudClosure;
let shelf: Shelf;
const realFetch = globalThis.fetch;
const toasts: string[] = [];
beforeAll(async () => {
  await loadClosure();
  setClosureT(t);
  setClosureLang('en');
  cm = await loadCloud();
  shelf = await startShelf();
  shelf.clock.now = new Date(Date.parse('2026-11-09T12:00:00Z'));
}, 60_000);
afterAll(async () => {
  globalThis.fetch = realFetch;
  await shelf.close();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  pageToast.fn = () => undefined;
  toasts.length = 0;
  cloudReset();
  resetCloudFacts();
  document.body.innerHTML = '';
  localStorage.clear();
});
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const shown = (el: HTMLElement | null) => !!el && el.style.display !== 'none' && !el.hidden;
/** The next unused 30 s step on the server's clock. */
const nextStep = () => {
  shelf.clock.now = new Date(shelf.clock.now.getTime() + 30_000);
  return totpStep(shelf.clock.now.getTime());
};

/** An account with two-step on (through the real routes), signed out again; its secret and recovery codes. */
async function twoStepAccount(label: string): Promise<{ email: string; secret: Buffer; codes: string[] }> {
  const b = browser(shelf.base);
  const email = `${label}-${Date.now()}@example.test`;
  const json = { 'Content-Type': 'application/json' };
  const reg = await b.fetch('/api/auth/register', { method: 'POST', headers: json, body: JSON.stringify({ email, password: PASSWORD }) });
  expect(reg.status).toBe(201);
  const start = (await (await b.fetch('/api/account/two-step/start', { method: 'POST', headers: json, body: JSON.stringify({ currentPassword: PASSWORD }) })).json()) as { secret: string };
  const secret = base32Decode(start.secret);
  const on = await b.fetch('/api/account/two-step/enable', { method: 'POST', headers: json, body: JSON.stringify({ code: totpCode(secret, nextStep()) }) });
  expect(on.status).toBe(200);
  const codes = ((await on.json()) as { recoveryCodes: string[] }).recoveryCodes;
  await b.fetch('/api/auth/logout', { method: 'POST', headers: json, body: '{}' });
  return { email, secret, codes };
}

/** 1.0's shelf markup on the page, a desk with a book, the cloud booted signed out, the sign-in dialog open. */
async function signInDialog() {
  const b = browser(shelf.base);
  globalThis.fetch = b.fetch;
  const y = new Y.Doc();
  importBook(structuredClone(fixtures('real')[0]!.book), y);
  cloudUi.ydoc = () => y;
  document.body.innerHTML = markup.auth + markup.shelf + markup.account + markup.syncRow + markup.netPill;
  deskChanged(y);
  await bootCloud();
  pageToast.fn = (m) => void toasts.push(m);
  cm.api.openAuth();
  return b;
}
/** The writer types the address and the password, and presses Sign in. */
async function password(email: string, pw = PASSWORD) {
  $('authEmail').value = email;
  $('authPassword').value = pw;
  await cm.api.cloudAuthSubmit();
}
async function code(value: string) {
  $('authCode').value = value;
  await cm.api.cloudAuthSubmit();
}
const inCodeStep = () => {
  expect(cm.vars.authMode).toBe('code');
  expect(shown($('authCode').closest('div'))).toBe(true);
  expect(shown($('authEmail').closest('div'))).toBe(false);
  expect(shown($('authPassword').closest('div'))).toBe(false);
  expect(document.getElementById('authTitle')!.textContent).toBe(t('auth.codeTitle'));
};
const inPasswordStep = () => {
  expect(cm.vars.authMode).toBe('login');
  expect(shown($('authCode').closest('div'))).toBe(false);
  expect(shown($('authEmail').closest('div'))).toBe(true);
  expect(shown($('authPassword').closest('div'))).toBe(true);
  expect(document.getElementById('authTitle')!.textContent).toBe(t('auth.titleLogin'));
};

describe('the code step (BEUK:twostep)', () => {
  it('a {twoStep, challenge} answer: the code field, email and password hidden, its own title, words and button', async () => {
    const a = await twoStepAccount('step');
    const b = await signInDialog();
    await password(a.email);
    inCodeStep();
    expect(document.getElementById('authSub')!.textContent).toBe(t('auth.codeSub'));
    expect(document.getElementById('authSubmitLabel')!.textContent).toBe(t('auth.codeVerify'));
    expect(document.querySelector('label[for="authCode"]')!.textContent).toBe(t('auth.codeLabel'));
    expect(shown(document.getElementById('authForgotRow'))).toBe(false);
    expect(shown(document.getElementById('authError'))).toBe(false);
    // not signed in yet; the dialog stays open; the password does not stay in it; the challenge is never in the page
    expect(cloudFacts.user).toBe(null);
    expect(document.getElementById('modalAuth')!.classList.contains('open')).toBe(true);
    expect($('authPassword').value).toBe('');
    const challenge = cm.vars.twoStepChallenge as string;
    expect(typeof challenge).toBe('string');
    expect(document.body.innerHTML).not.toContain(challenge);
    expect(b.requests.filter((r) => r.path === '/api/auth/login').length).toBe(1);
  }, 30_000);

  it('the code field: autocomplete one-time-code, inputmode text (recovery codes have letters)', () => {
    document.body.innerHTML = markup.auth;
    expect($('authCode').getAttribute('autocomplete')).toBe('one-time-code');
    expect($('authCode').getAttribute('inputmode')).toBe('text');
    expect($('authCode').closest('div')!.style.display).toBe('none');
  });

  it("the right code posts {challenge, code} to /api/auth/login/code and signs in exactly as a password sign-in does", async () => {
    // the oracle: a plain sign-in (two-step off) on the same desk — what it sends after the login, and what it says
    const plain = browser(shelf.base);
    const pe = `plain-${Date.now()}@example.test`;
    await plain.fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: pe, password: PASSWORD }) });
    let b = await signInDialog();
    await password(pe);
    for (let i = 0; i < 40 && cloudFacts.linkState === 'unlinked'; i++) await tick(50);
    await tick(300);
    const after = (reqs: typeof b.requests, from: string) => reqs.slice(reqs.findIndex((r) => r.path === from) + 1).map((r) => r.method + ' ' + r.path);
    const plainAfter = after(b.requests, '/api/auth/login');
    const plainToasts = [...toasts];
    expect(plainToasts).toEqual([t('auth.welcomeBackToast')]);
    cloudReset();
    resetCloudFacts();
    toasts.length = 0;

    const a = await twoStepAccount('right');
    b = await signInDialog();
    await password(a.email);
    const challenge = cm.vars.twoStepChallenge as string;
    const c = totpCode(a.secret, nextStep());
    await code(c);
    const sent = b.requests.find((r) => r.path === '/api/auth/login/code')!;
    expect(sent.method).toBe('POST');
    expect(JSON.parse(sent.body!)).toEqual({ challenge, code: c });
    expect((cloudFacts.user as Rec).email).toBe(a.email);
    expect(document.getElementById('modalAuth')!.classList.contains('open')).toBe(false);
    for (let i = 0; i < 40 && cloudFacts.linkState === 'unlinked'; i++) await tick(50);
    await tick(300);
    expect(toasts).toEqual(plainToasts);
    expect(after(b.requests, '/api/auth/login/code')).toEqual(plainAfter);
    // the step is over: the challenge and the code are forgotten
    expect(cm.vars.twoStepChallenge).toBe(null);
    expect($('authCode').value).toBe('');
  }, 40_000);

  it('a wrong code (401): "that code didn\'t work" in the dialog\'s words, and the step stays — the right code then works', async () => {
    const a = await twoStepAccount('wrong');
    const b = await signInDialog();
    await password(a.email);
    const good = totpCode(a.secret, nextStep());
    await code(good === '000000' ? '111111' : '000000');
    expect(b.requests.at(-1)!.path).toBe('/api/auth/login/code');
    inCodeStep();
    expect(shown(document.getElementById('authError'))).toBe(true);
    expect(document.getElementById('authError')!.textContent).toBe(t('auth.codeWrong'));
    expect(cloudFacts.user).toBe(null);
    await code(good);
    expect((cloudFacts.user as Rec).email).toBe(a.email);
  }, 30_000);

  it('final review M5: a double Enter (or click) in the code step sends the code once; the step stays on a wrong code', async () => {
    const a = await twoStepAccount('double');
    const b = await signInDialog();
    await password(a.email);
    const good = totpCode(a.secret, nextStep());
    $('authCode').value = good === '000000' ? '111111' : '000000';
    // two presses before the first answer arrives
    await Promise.all([cm.api.cloudAuthSubmit(), cm.api.cloudAuthSubmit()]);
    expect(b.requests.filter((r) => r.path === '/api/auth/login/code').length).toBe(1);
    inCodeStep();
    expect(document.getElementById('authError')!.textContent).toBe(t('auth.codeWrong'));
    // the button is free again once the answer is in: the right code then signs in
    await code(good);
    expect(b.requests.filter((r) => r.path === '/api/auth/login/code').length).toBe(2);
    expect((cloudFacts.user as Rec).email).toBe(a.email);
  }, 30_000);

  it('an expired challenge (410): back to the password step, the address kept, "That took a little long"', async () => {
    const a = await twoStepAccount('late');
    await signInDialog();
    await password(a.email);
    shelf.clock.now = new Date(shelf.clock.now.getTime() + 6 * 60_000); // past the 5-minute challenge
    await code(totpCode(a.secret, totpStep(shelf.clock.now.getTime())));
    inPasswordStep();
    expect(document.getElementById('authError')!.textContent).toBe(t('auth.codeExpired'));
    expect(shown(document.getElementById('authError'))).toBe(true);
    expect($('authEmail').value).toBe(a.email);
    expect(cm.vars.twoStepChallenge).toBe(null);
    expect(cloudFacts.user).toBe(null);
  }, 30_000);

  it('Review focus 5: closed during the code step and opened again, the dialog starts at email and password, no stale challenge', async () => {
    const a = await twoStepAccount('close');
    const b = await signInDialog();
    await password(a.email);
    inCodeStep();
    $('authCode').value = '12';
    cm.api.closeAuth();
    // closing forgets at once (not only at the next open)
    expect(cm.vars.twoStepChallenge).toBe(null);
    expect($('authCode').value).toBe('');
    cm.api.openAuth();
    inPasswordStep();
    expect($('authCode').value).toBe('');
    expect(shown(document.getElementById('authError'))).toBe(false);
    // Sign in now asks for the password again: it posts /api/auth/login, never /login/code
    b.requests.length = 0;
    await password(a.email);
    expect(b.requests.map((r) => r.path)).toEqual(['/api/auth/login']);
    inCodeStep();
    // and "Back to sign in" from the code step does the same
    cm.api.setAuthMode(cm.vars.authMode === 'login' ? 'register' : 'login'); // 1.0's toggle line (CloudHost wires it in 2.0)
    inPasswordStep();
    expect(cm.vars.twoStepChallenge).toBe(null);
  }, 30_000);

  it('a recovery code, typed in any shape, signs in', async () => {
    const a = await twoStepAccount('rec');
    await signInDialog();
    await password(a.email);
    await code(' ' + a.codes[3]!.toLowerCase().replace('-', ' ') + ' ');
    expect((cloudFacts.user as Rec).email).toBe(a.email);
    expect(toasts).toContain(t('auth.welcomeBackToast'));
  }, 30_000);

  it('a language change in the code step keeps the step (and its challenge), in the new words', async () => {
    const a = await twoStepAccount('lang');
    await signInDialog();
    await password(a.email);
    const ch = cm.vars.twoStepChallenge;
    cm.api.setAuthMode(cm.vars.authMode); // CloudHost's language-change line
    inCodeStep();
    expect(cm.vars.twoStepChallenge).toBe(ch);
  }, 30_000);
});

describe("the code step's words", () => {
  it('every new key is in all 13 locales (1.0 UI_STRINGS, so every pack)', () => {
    const packs = path.join(import.meta.dirname, '..', 'src', 'generated', 'packs');
    const langs = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'ar', 'ja', 'zh-Hans'];
    const missing: string[] = [];
    for (const l of langs) {
      const p = JSON.parse(readFileSync(path.join(packs, l + '.json'), 'utf8')) as Rec;
      for (const k of KEYS) if (typeof p[k] !== 'string' || !(p[k] as string).trim()) missing.push(l + ':' + k);
    }
    expect(missing).toEqual([]);
    expect(KEYS.map((k) => (en as Rec)[k])).toEqual([
      'Two-step sign-in',
      'Type the 6-digit code from your authenticator app, or one of your recovery codes.',
      'Code',
      'Verify',
      "That code didn't work. Check your app and try again.",
      'That took a little long. Sign in again.',
    ]);
  });
});
