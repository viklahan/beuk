import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import type { Db } from '../src/db.js';
import { base32Decode, totpCode, totpStep } from '../src/twostep/totp.js';
import { pausedBody } from '../src/access.js';

let db: Db;
let server: TestServer;

before(async () => {
  db = await createTestDb();
  server = await startTestServer(db);
});

after(async () => {
  await server.close();
});

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** A browser for the HTML half of the flow: raw fetch + one session
 *  cookie (tests/helpers.ts Client parses every body as JSON, which the
 *  authorize pages are not). */
class Browser {
  cookie: string | null = null;

  constructor(private base: string) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { ...(this.cookie ? { cookie: `beuk_session=${this.cookie}` } : {}), ...extra };
  }

  private storeCookie(res: globalThis.Response): void {
    for (const sc of res.headers.getSetCookie()) {
      const m = /^beuk_session=([^;]*)/.exec(sc);
      if (m) this.cookie = m[1] || null;
    }
  }

  async signIn(email: string, password = 'correct horse battery'): Promise<void> {
    const res = await fetch(`${this.base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(res.status, 201);
    this.storeCookie(res);
  }

  async get(path: string): Promise<{ status: number; text: string; location: string | null }> {
    const res = await fetch(`${this.base}${path}`, { headers: this.headers(), redirect: 'manual' });
    this.storeCookie(res);
    return { status: res.status, text: await res.text(), location: res.headers.get('location') };
  }

  /** What the sign-in page's script sends: JSON, the session cookie kept. */
  async postJson(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown>; setCookie: boolean }> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie().some((c) => /^beuk_session=[^;]+/.test(c));
    this.storeCookie(res);
    return { status: res.status, body: (await res.json()) as Record<string, unknown>, setCookie };
  }

  async postForm(path: string, fields: Record<string, string>): Promise<{ status: number; text: string }> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams(fields).toString(),
      redirect: 'manual',
    });
    this.storeCookie(res);
    return { status: res.status, text: await res.text() };
  }
}

async function registerOAuthClient(redirectUris = [CALLBACK]): Promise<string> {
  const res = await new Client(server.base).post('/api/oauth/register', {
    client_name: 'Claude',
    redirect_uris: redirectUris,
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.token_endpoint_auth_method, 'none');
  return res.body.client_id as string;
}

function authorizePath(args: {
  clientId: string;
  challenge: string;
  state?: string;
  scope?: string;
  method?: string;
  redirectUri?: string;
  responseType?: string;
}): string {
  const q = new URLSearchParams({
    response_type: args.responseType ?? 'code',
    client_id: args.clientId,
    redirect_uri: args.redirectUri ?? CALLBACK,
    code_challenge: args.challenge,
    code_challenge_method: args.method ?? 'S256',
  });
  if (args.state) q.set('state', args.state);
  if (args.scope) q.set('scope', args.scope);
  return `/authorize?${q.toString()}`;
}

function consentTokenFrom(html: string): string {
  const m = /name="consent" value="([^"]+)"/.exec(html);
  assert.ok(m, 'consent page carries the consent token');
  return m![1];
}

/** The return page's meta-refresh target (escapeHtml turned & into &amp;). */
function redirectUrlFrom(html: string): URL {
  const m = /content="0;url=([^"]+)"/.exec(html);
  assert.ok(m, 'return page carries the redirect');
  return new URL(m![1].replaceAll('&amp;', '&'));
}

async function tokenRequest(fields: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  // Real form encoding, as RFC 6749 §4.1.3 and MCP Inspector send it.
  const res = await fetch(`${server.base}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Sign up a fresh user, approve the consent screen, exchange the code. */
async function fullGrant(email: string, scope?: string): Promise<{
  clientId: string;
  browser: Browser;
  access: string;
  refresh: string;
  scopes: string;
}> {
  const clientId = await registerOAuthClient();
  const browser = new Browser(server.base);
  await browser.signIn(email);
  const { verifier, challenge } = pkcePair();
  const consentScreen = await browser.get(authorizePath({ clientId, challenge, state: 'xyz', scope }));
  assert.equal(consentScreen.status, 200);
  const decided = await browser.postForm('/authorize/decision', {
    consent: consentTokenFrom(consentScreen.text),
    decision: 'approve',
  });
  assert.equal(decided.status, 200);
  const redirect = redirectUrlFrom(decided.text);
  assert.equal(redirect.origin + redirect.pathname, CALLBACK);
  assert.equal(redirect.searchParams.get('state'), 'xyz');
  const code = redirect.searchParams.get('code');
  assert.ok(code, 'redirect carries the code');
  const token = await tokenRequest({
    grant_type: 'authorization_code',
    code: code!,
    code_verifier: verifier,
    redirect_uri: CALLBACK,
    client_id: clientId,
  });
  assert.equal(token.status, 200);
  assert.equal(token.body.token_type, 'Bearer');
  assert.equal(token.body.expires_in, 3600);
  return {
    clientId,
    browser,
    access: token.body.access_token as string,
    refresh: token.body.refresh_token as string,
    scopes: token.body.scope as string,
  };
}

async function meWithBearer(access: string): Promise<number> {
  const res = await fetch(`${server.base}/api/auth/me`, {
    headers: { authorization: `Bearer ${access}` },
  });
  return res.status;
}

test('discovery documents: S256 only, endpoints named, path-suffix variant answers', async () => {
  const client = new Client(server.base);
  const meta = await client.get('/.well-known/oauth-authorization-server');
  assert.equal(meta.status, 200);
  assert.deepEqual(meta.body.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(meta.body.token_endpoint_auth_methods_supported, ['none']);
  assert.deepEqual(meta.body.scopes_supported, ['beuk:read', 'beuk:write', 'beuk:export']);
  assert.equal(meta.body.authorization_endpoint, `${server.config.appBaseUrl}/authorize`);
  assert.equal(meta.body.token_endpoint, `${server.config.appBaseUrl}/api/oauth/token`);
  assert.equal(meta.body.registration_endpoint, `${server.config.appBaseUrl}/api/oauth/register`);

  const resource = await client.get('/.well-known/oauth-protected-resource/api/mcp');
  assert.equal(resource.status, 200);
  assert.deepEqual(resource.body.authorization_servers, [server.config.appBaseUrl]);
});

test('dynamic registration validates redirect URIs', async () => {
  const client = new Client(server.base);
  const insecure = await client.post('/api/oauth/register', {
    redirect_uris: ['http://evil.example.com/cb'],
  });
  assert.equal(insecure.status, 400);
  assert.equal(insecure.body.error, 'invalid_redirect_uri');

  const empty = await client.post('/api/oauth/register', { redirect_uris: [] });
  assert.equal(empty.status, 400);

  // http is fine on loopback (MCP Inspector in local dev).
  const loopback = await client.post('/api/oauth/register', {
    redirect_uris: ['http://localhost:6274/oauth/callback'],
  });
  assert.equal(loopback.status, 201);
});

test('full flow: register → authorize → consent → code → token → bearer request', async () => {
  const grant = await fullGrant('oauth-flow@example.com');
  assert.equal(grant.scopes, 'beuk:read beuk:write beuk:export');
  assert.equal(await meWithBearer(grant.access), 200);
  const me = await fetch(`${server.base}/api/auth/me`, {
    headers: { authorization: `Bearer ${grant.access}` },
  });
  assert.equal(((await me.json()) as { user: { email: string } }).user.email, 'oauth-flow@example.com');
});

test('authorize refuses an unknown client and an unregistered redirect_uri WITHOUT redirecting', async () => {
  const browser = new Browser(server.base);
  const { challenge } = pkcePair();
  const unknown = await browser.get(
    authorizePath({ clientId: '00000000-0000-4000-8000-000000000000', challenge }),
  );
  assert.equal(unknown.status, 400);
  assert.equal(unknown.location, null);

  const clientId = await registerOAuthClient();
  const wrongUri = await browser.get(
    authorizePath({ clientId, challenge, redirectUri: 'https://attacker.example.com/cb' }),
  );
  assert.equal(wrongUri.status, 400);
  assert.equal(wrongUri.location, null);
});

test('authorize rejects PKCE plain (and missing challenge) with a redirect error', async () => {
  const clientId = await registerOAuthClient();
  const browser = new Browser(server.base);
  const { challenge } = pkcePair();

  const plain = await browser.get(authorizePath({ clientId, challenge, method: 'plain', state: 's1' }));
  assert.equal(plain.status, 302);
  const plainUrl = new URL(plain.location!);
  assert.equal(plainUrl.searchParams.get('error'), 'invalid_request');
  assert.equal(plainUrl.searchParams.get('state'), 's1');

  const missing = await browser.get(authorizePath({ clientId, challenge: '' }));
  assert.equal(missing.status, 302);

  const badScope = await browser.get(authorizePath({ clientId, challenge, scope: 'beuk:admin' }));
  assert.equal(badScope.status, 302);
  assert.equal(new URL(badScope.location!).searchParams.get('error'), 'invalid_scope');
});

test('authorize shows the sign-in page when no session exists', async () => {
  const clientId = await registerOAuthClient();
  const browser = new Browser(server.base); // never signed in
  const { challenge } = pkcePair();
  const page = await browser.get(authorizePath({ clientId, challenge }));
  assert.equal(page.status, 200);
  assert.match(page.text, /Sign in to Beuk/);
  assert.doesNotMatch(page.text, /name="consent"/);
});

test('two-step on: the sign-in page takes the code step, and login + code reaches the consent screen', async () => {
  // The page: a password-only script loops forever for a two-step writer
  // (login answers {twoStep, challenge} and sets no cookie, the page
  // reloads into the same form). It must ask for the code and send it on.
  const clientId = await registerOAuthClient();
  const { challenge } = pkcePair();
  const page = (await new Browser(server.base).get(authorizePath({ clientId, challenge }))).text;
  assert.match(page, /id="code"/, 'the page has a code field');
  assert.match(page, /\.twoStep/, 'the script reads twoStep from the login answer');
  assert.match(page, /\/api\/auth\/login\/code/, 'the script sends the code to /api/auth/login/code');

  // The server half, exactly as the page drives it.
  const email = `oauth-twostep-${randomBytes(4).toString('hex')}@example.com`;
  const studio = new Client(server.base);
  assert.equal((await registerUser(studio, email, 'correct horse battery')).status, 201);
  const s = await studio.post('/api/account/two-step/start', { currentPassword: 'correct horse battery' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const secret = base32Decode(s.body.secret as string);
  const step = totpStep(Date.now());
  assert.equal((await studio.post('/api/account/two-step/enable', { code: totpCode(secret, step) })).status, 200);

  const browser = new Browser(server.base);
  const login = await browser.postJson('/api/auth/login', { email, password: 'correct horse battery' });
  assert.equal(login.status, 200);
  assert.equal(login.body.twoStep, true);
  assert.equal(login.setCookie, false, 'no session before the code');
  // The next step: enable spent this one (replay guard).
  const code = await browser.postJson('/api/auth/login/code', { challenge: login.body.challenge, code: totpCode(secret, step + 1) });
  assert.equal(code.status, 200, JSON.stringify(code.body));
  assert.equal(code.setCookie, true);
  const consent = await browser.get(authorizePath({ clientId, challenge }));
  assert.equal(consent.status, 200);
  assert.match(consent.text, /name="consent"/, 'signed in with the code: the consent screen, not the sign-in form');
});

test('day 22: a paused account is paused for its bearer tokens too (every paused route a bearer can reach)', async () => {
  // Billing on (test placeholders, no network), the same database: a
  // grant made on the open server is a live bearer here.
  const paid = await startTestServer(db, undefined, {
    stripeWebhookSecret: 'whsec_test_placeholder_not_a_real_key',
    stripeSecretKey: 'sk_test_placeholder_not_a_real_key',
    stripePriceId: 'price_fixture_one',
    stripeApiBase: 'http://127.0.0.1:9',
  });
  try {
    const email = `oauth-paused-${randomBytes(4).toString('hex')}@example.com`;
    const { access } = await fullGrant(email, 'beuk:read beuk:write');
    const userId = (await db.query<{ id: string }>('select id from users where email = $1', [email])).rows[0].id;
    const bearerPost = (p: string, body: unknown) =>
      fetch(`${paid.base}${p}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const newBook = { doc: { title: 'P', sections: { frontMatter: [], body: [], backMatter: [] } } };
    // In the trial: the bearer adds a book (the gate lets it through).
    assert.equal((await bearerPost('/api/manuscripts', newBook)).status, 201, 'trial: open');
    // Day 22, no plan: every paused route the bearer routers serve answers 402.
    await db.query(`update users set trial_ends_at = now() - interval '1 day' where id = $1`, [userId]);
    for (const [p, feature, body] of [
      ['/api/manuscripts', 'shelf.add', newBook],
      ['/api/jobs/epubcheck', 'jobs.run', { exportId: '00000000-0000-4000-8000-000000000000' }],
      ['/api/jobs/pdfx', 'export.print', { exportId: '00000000-0000-4000-8000-000000000000' }],
    ] as const) {
      const res = await bearerPost(p, body);
      assert.equal(res.status, 402, `${p} paused for a bearer`);
      assert.deepEqual(await res.json(), pausedBody(feature));
    }
    // Reading stays open (never paused).
    const list = await fetch(`${paid.base}/api/manuscripts`, { headers: { authorization: `Bearer ${access}` } });
    assert.equal(list.status, 200);
  } finally {
    await paid.close();
  }
});

test('consent decision is CSRF-protected: forged, reused and cross-user tokens are refused', async () => {
  const clientId = await registerOAuthClient();
  const alice = new Browser(server.base);
  await alice.signIn('oauth-alice@example.com');
  const { challenge } = pkcePair();
  const screen = await alice.get(authorizePath({ clientId, challenge }));
  const consent = consentTokenFrom(screen.text);

  // Another signed-in user cannot spend Alice's consent token.
  const mallory = new Browser(server.base);
  await mallory.signIn('oauth-mallory@example.com');
  const crossUser = await mallory.postForm('/authorize/decision', { consent, decision: 'approve' });
  assert.equal(crossUser.status, 400);

  // An invented token is refused; no session at all is refused.
  const forged = await alice.postForm('/authorize/decision', {
    consent: randomBytes(32).toString('base64url'),
    decision: 'approve',
  });
  assert.equal(forged.status, 400);
  const signedOut = await new Browser(server.base).postForm('/authorize/decision', { consent, decision: 'approve' });
  assert.equal(signedOut.status, 403);

  // The real owner can still spend it once — and only once.
  const ok = await alice.postForm('/authorize/decision', { consent, decision: 'approve' });
  assert.equal(ok.status, 200);
  assert.match(ok.text, /code=/);
  const replay = await alice.postForm('/authorize/decision', { consent, decision: 'approve' });
  assert.equal(replay.status, 400);
});

test('deny returns error=access_denied to the client', async () => {
  const clientId = await registerOAuthClient();
  const browser = new Browser(server.base);
  await browser.signIn('oauth-deny@example.com');
  const { challenge } = pkcePair();
  const screen = await browser.get(authorizePath({ clientId, challenge, state: 'd1' }));
  const decided = await browser.postForm('/authorize/decision', {
    consent: consentTokenFrom(screen.text),
    decision: 'deny',
  });
  const redirect = redirectUrlFrom(decided.text);
  assert.equal(redirect.searchParams.get('error'), 'access_denied');
  assert.equal(redirect.searchParams.get('state'), 'd1');
  assert.equal(redirect.searchParams.get('code'), null);
});

test('token exchange verifies PKCE and burns the code', async () => {
  const clientId = await registerOAuthClient();
  const browser = new Browser(server.base);
  await browser.signIn('oauth-pkce@example.com');
  const { verifier, challenge } = pkcePair();
  const screen = await browser.get(authorizePath({ clientId, challenge }));
  const decided = await browser.postForm('/authorize/decision', {
    consent: consentTokenFrom(screen.text),
    decision: 'approve',
  });
  const code = redirectUrlFrom(decided.text).searchParams.get('code')!;

  // Wrong verifier: refused, and the code is single-use, so the RIGHT
  // verifier afterwards is refused too (the attempt burnt it).
  const wrong = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    code_verifier: randomBytes(32).toString('base64url'),
    redirect_uri: CALLBACK,
    client_id: clientId,
  });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, 'invalid_grant');
  const burnt = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: CALLBACK,
    client_id: clientId,
  });
  assert.equal(burnt.status, 400);

  // An unknown client at the token endpoint is 401 invalid_client (the
  // signal on which Claude re-registers).
  const noClient = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: CALLBACK,
    client_id: '00000000-0000-4000-8000-000000000000',
  });
  assert.equal(noClient.status, 401);
  assert.equal(noClient.body.error, 'invalid_client');
});

test('refresh grant rotates; reuse of the rotated token revokes the whole grant', async () => {
  const grant = await fullGrant('oauth-refresh@example.com');

  const rotated = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: grant.refresh,
    client_id: grant.clientId,
  });
  assert.equal(rotated.status, 200);
  const newAccess = rotated.body.access_token as string;
  assert.equal(await meWithBearer(newAccess), 200);

  // Spending the OLD refresh token again = theft signal: refused, and
  // the freshly rotated tokens die with it.
  const reuse = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: grant.refresh,
    client_id: grant.clientId,
  });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.body.error, 'invalid_grant');
  assert.equal(await meWithBearer(newAccess), 401);
});

test('a refresh may narrow scopes, never widen them', async () => {
  const grant = await fullGrant('oauth-scopes@example.com', 'beuk:read');
  assert.equal(grant.scopes, 'beuk:read');

  const widen = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: grant.refresh,
    client_id: grant.clientId,
    scope: 'beuk:read beuk:write',
  });
  assert.equal(widen.status, 400);
  assert.equal(widen.body.error, 'invalid_scope');

  const narrow = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: grant.refresh,
    client_id: grant.clientId,
    scope: 'beuk:read',
  });
  assert.equal(narrow.status, 200);
  assert.equal(narrow.body.scope, 'beuk:read');
});

test('"sign out everywhere" revokes bearer tokens with the sessions', async () => {
  const grant = await fullGrant('oauth-revoke@example.com');
  assert.equal(await meWithBearer(grant.access), 200);

  const revoke = await fetch(`${server.base}/api/auth/sessions/revoke-all`, {
    method: 'POST',
    headers: { cookie: `beuk_session=${grant.browser.cookie}` },
  });
  assert.equal(revoke.status, 200);
  // The response keeps its shape: `revoked` counts sessions only.
  assert.deepEqual(await revoke.json(), { ok: true, revoked: 1 });
  assert.equal(await meWithBearer(grant.access), 401);

  // The refresh token died too — the client cannot quietly come back.
  const refresh = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: grant.refresh,
    client_id: grant.clientId,
  });
  assert.equal(refresh.status, 400);
});

test('a 401 names the protected-resource metadata (RFC 9728 discovery)', async () => {
  const res = await fetch(`${server.base}/api/auth/me`, {
    headers: { authorization: 'Bearer not-a-real-token' },
  });
  assert.equal(res.status, 401);
  const header = res.headers.get('www-authenticate') ?? '';
  assert.match(header, /resource_metadata=/);
  assert.match(header, /invalid_token/);
});

/* ---- Phase 2: the API as an OAuth resource server (MCP tools call
   these with the writer's bearer; the studio's cookies are untouched). */

async function bearerFetch(
  method: string,
  path: string,
  access: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown>; header: (name: string) => string }> {
  const res = await fetch(`${server.base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${access}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
    header: (name: string) => res.headers.get(name) ?? '',
  };
}

async function createBook(browser: Browser, title: string): Promise<string> {
  const res = await fetch(`${server.base}/api/manuscripts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `beuk_session=${browser.cookie}` },
    body: JSON.stringify({ title, doc: { title, sections: [] } }),
  });
  assert.equal(res.status, 201);
  return ((await res.json()) as { manuscript: { id: string } }).manuscript.id;
}

test('a bearer-authed /me reports the token scopes; cookie answers stay scopeless', async () => {
  const grant = await fullGrant('oauth-introspect@example.com', 'beuk:read beuk:export');
  const viaBearer = await bearerFetch('GET', '/api/auth/me', grant.access);
  assert.equal(viaBearer.status, 200);
  assert.equal(viaBearer.body.scopes, 'beuk:read beuk:export');
  const viaCookie = await fetch(`${server.base}/api/auth/me`, {
    headers: { cookie: `beuk_session=${grant.browser.cookie}` },
  });
  assert.equal(viaCookie.status, 200);
  assert.ok(!('scopes' in ((await viaCookie.json()) as Record<string, unknown>)), 'cookie /me carries no scopes key');
});

test('beuk:read bearer reads the shelf: list, one book, and its format check', async () => {
  const grant = await fullGrant('oauth-shelf-read@example.com', 'beuk:read');
  const bookId = await createBook(grant.browser, 'Bearer-Read Book');

  const list = await bearerFetch('GET', '/api/manuscripts', grant.access);
  assert.equal(list.status, 200);
  const books = list.body.manuscripts as Array<{ id: string; title: string }>;
  assert.ok(books.some((b) => b.id === bookId));

  const one = await bearerFetch('GET', `/api/manuscripts/${bookId}`, grant.access);
  assert.equal(one.status, 200);
  assert.equal((one.body.manuscript as { title: string }).title, 'Bearer-Read Book');

  const check = await bearerFetch('GET', `/api/manuscripts/${bookId}/check`, grant.access);
  assert.equal(check.status, 200);
  const found = check.body.check as { status: string; warnings: unknown[]; upgrades: unknown[]; preservedPaths: unknown[] };
  // readBook never throws: an empty-sections doc reads as a book, with
  // whatever honest warnings it earns — the shape is the contract here.
  assert.ok(['ok', 'newer', 'failed'].includes(found.status));
  assert.ok(Array.isArray(found.warnings));
  assert.ok(Array.isArray(found.upgrades));
  assert.ok(Array.isArray(found.preservedPaths));
});

test('a read-only bearer may not write: POST is 403 insufficient_scope naming beuk:write', async () => {
  const grant = await fullGrant('oauth-shelf-readonly@example.com', 'beuk:read');
  const refused = await bearerFetch('POST', '/api/manuscripts', grant.access, { doc: { title: 'No' } });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, 'this token is missing the beuk:write scope');
  assert.match(refused.header('www-authenticate'), /insufficient_scope/);
  assert.match(refused.header('www-authenticate'), /scope="beuk:write"/);
});

test('a beuk:write bearer may write, exactly as consent granted', async () => {
  const grant = await fullGrant('oauth-shelf-write@example.com', 'beuk:read beuk:write');
  const created = await bearerFetch('POST', '/api/manuscripts', grant.access, {
    title: 'Bearer-Written Book',
    doc: { title: 'Bearer-Written Book', sections: [] },
  });
  assert.equal(created.status, 201);
  assert.equal((created.body.manuscript as { title: string }).title, 'Bearer-Written Book');
});

test('nothing irreversible from a bearer: no DELETE, no If-Match: * overwrite; a revisioned save still lands', async () => {
  const grant = await fullGrant('oauth-no-delete@example.com', 'beuk:read beuk:write beuk:export');
  const created = await bearerFetch('POST', '/api/manuscripts', grant.access, {
    title: 'Keep Me',
    doc: { title: 'Keep Me', sections: [] },
  });
  assert.equal(created.status, 201);
  const book = created.body.manuscript as { id: string; revision: number };
  const del = await bearerFetch('DELETE', `/api/manuscripts/${book.id}`, grant.access);
  assert.equal(del.status, 403);
  assert.match(String(del.body.error), /studio/);
  assert.equal((await bearerFetch('GET', `/api/manuscripts/${book.id}`, grant.access)).status, 200, 'the book is still there');
  const put = (ifMatch: string) =>
    fetch(`${server.base}/api/manuscripts/${book.id}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${grant.access}`, 'content-type': 'application/json', 'if-match': ifMatch },
      body: JSON.stringify({ title: 'Changed', doc: { title: 'Changed', sections: [] } }),
    });
  assert.equal((await put('*')).status, 403, 'a blind overwrite is refused');
  assert.equal((await put(` * `)).status, 403, 'padded * too');
  assert.equal((await put(`"${book.revision}"`)).status, 200, 'a save based on the current revision lands');
});

test('the consent screen names where approval sends you, since the app chose its own name', async () => {
  const res = await new Client(server.base).post('/api/oauth/register', {
    client_name: 'Claude',
    redirect_uris: ['https://evil.example/cb'],
  });
  assert.equal(res.status, 201);
  const browser = new Browser(server.base);
  await browser.signIn(`oauth-lookalike-${randomBytes(4).toString('hex')}@example.com`);
  const { challenge } = pkcePair();
  const page = await browser.get(
    authorizePath({ clientId: res.body.client_id as string, challenge, redirectUri: 'https://evil.example/cb' }),
  );
  assert.equal(page.status, 200);
  assert.match(page.text, /sends you back to <strong>evil\.example<\/strong>/);
  assert.match(page.text, /the one the app gave itself/);
});

test('beuk:read bearer reads jobs; an unknown job stays the same honest 404', async () => {
  const grant = await fullGrant('oauth-jobs-read@example.com', 'beuk:read');
  const list = await bearerFetch('GET', '/api/jobs', grant.access);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.jobs, []);
  const missing = await bearerFetch('GET', '/api/jobs/00000000-0000-4000-8000-00000000dead', grant.access);
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { error: 'job not found' });
});
