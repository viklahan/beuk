import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { readCookie, SESSION_COOKIE, sessionUser as sharedSessionUser } from '../auth.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { rateLimit, TokenBucketLimiter } from '../ratelimit.js';
import {
  ACCESS_TTL_MS,
  CODE_TTL_MS,
  CONSENT_TTL_MS,
  consumeOAuthToken,
  findClient,
  findRefreshToken,
  issueOAuthToken,
  OAUTH_SCOPES,
  pkceChallengeMatches,
  REFRESH_TTL_MS,
  registerClient,
  resolveScopes,
  revokeClientGrant,
} from '../oauth/model.js';
import { consentPage, errorPage, returnPage, signInPage } from '../oauth/pages.js';

/** OAuth endpoints are called cross-origin by browser-based clients
 *  (MCP Inspector runs in a browser); they carry no cookies and answer
 *  with nothing private to the Beuk origin, so a wildcard is safe here —
 *  and ONLY here (the consent pages below do NOT get this). */
function cors(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, mcp-protocol-version');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

/** RFC 8414 + RFC 9728 discovery documents, at the origin root (Caddy
 *  forwards /.well-known/oauth-* — see the Caddyfile). The path-suffix
 *  variants (…/oauth-authorization-server/api/mcp) answer the same
 *  document: one issuer, one authorization server. */
export function oauthMetadataRoutes(config: Config): Router {
  const router = Router();
  const base = config.appBaseUrl;
  router.get(
    ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/*'],
    cors,
    (_req, res) =>
      res.json({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/api/oauth/token`,
        registration_endpoint: `${base}/api/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: [...OAUTH_SCOPES],
      }),
  );
  router.get(
    ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/*'],
    cors,
    (_req, res) =>
      res.json({
        resource: base,
        authorization_servers: [base],
        scopes_supported: [...OAUTH_SCOPES],
        bearer_methods_supported: ['header'],
      }),
  );
  return router;
}

/** Resolve the session cookie to a user without sending anything — the
 *  authorize pages answer HTML, not requireAuth's JSON 401. */
async function sessionUser(db: Db, req: Request): Promise<{ id: string; email: string } | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  // The one session lookup (src/auth.ts), "last active" included.
  return sharedSessionUser(db, token);
}

/** Like the /reset page: never cached, never indexed, no referrer out. */
function pageHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex');
}

const BASE64URL_43_128 = /^[A-Za-z0-9_-]{43,128}$/;
/** RFC 7636 §4.1: the verifier's exact alphabet and length. */
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

const authorizeQuery = z.object({
  response_type: z.string().optional(),
  client_id: z.string().max(100).optional(),
  redirect_uri: z.string().max(2048).optional(),
  scope: z.string().max(512).optional(),
  state: z.string().max(2048).optional(),
  code_challenge: z.string().max(256).optional(),
  code_challenge_method: z.string().max(32).optional(),
  resource: z.string().max(2048).optional(),
});

const decisionBody = z.object({
  consent: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  decision: z.enum(['approve', 'deny']),
});

export function oauthAuthorizeRoutes(db: Db, config: Config): Router {
  const router = Router();
  const form = express.urlencoded({ extended: false, limit: '16kb' });

  router.get('/authorize', async (req, res, next) => {
    try {
      pageHeaders(res);
      const parsed = authorizeQuery.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).type('html').send(errorPage('the request carried a malformed parameter'));
      }
      const q = parsed.data;

      // Unknown client / unregistered redirect_uri NEVER redirect
      // (RFC 6749 §4.1.2.1): the browser is not sent to an address the
      // client did not register.
      if (!q.client_id || !z.uuid().safeParse(q.client_id).success) {
        return res.status(400).type('html').send(errorPage('this client is not registered with Beuk'));
      }
      const client = await findClient(db, q.client_id);
      if (!client) {
        return res.status(400).type('html').send(errorPage('this client is not registered with Beuk'));
      }
      if (!q.redirect_uri || !client.redirect_uris.includes(q.redirect_uri)) {
        return res
          .status(400)
          .type('html')
          .send(errorPage('the return address does not match what this client registered'));
      }

      // From here the client is authenticated by its redirect_uri, so
      // errors go BACK to it (error + state), per RFC 6749 §4.1.2.1.
      const redirectError = (error: string, description: string) => {
        const url = new URL(q.redirect_uri!);
        url.searchParams.set('error', error);
        url.searchParams.set('error_description', description);
        if (q.state) url.searchParams.set('state', q.state);
        return res.redirect(302, url.toString());
      };

      if (q.response_type !== 'code') {
        return redirectError('unsupported_response_type', 'only response_type=code is supported');
      }
      // OAuth 2.1: PKCE is mandatory and only S256 is accepted — 'plain'
      // is explicitly refused (the work order's hard requirement).
      if (q.code_challenge_method !== 'S256') {
        return redirectError('invalid_request', 'PKCE with code_challenge_method=S256 is required (plain is refused)');
      }
      if (!q.code_challenge || !BASE64URL_43_128.test(q.code_challenge)) {
        return redirectError('invalid_request', 'code_challenge must be the base64url SHA-256 of the verifier');
      }
      const scopes = resolveScopes(q.scope);
      if (scopes === null) {
        return redirectError('invalid_scope', `supported scopes: ${OAUTH_SCOPES.join(' ')}`);
      }
      // RFC 8707 resource indicator: accepted when it parses as a URL.
      // The AS and the resource are the same single origin here, so the
      // token is not audience-split further in Phase 1.
      if (q.resource !== undefined && !z.url().safeParse(q.resource).success) {
        return redirectError('invalid_target', 'resource must be an absolute URL');
      }

      const user = await sessionUser(db, req);
      if (!user) {
        return res.status(200).type('html').send(signInPage(client.client_name));
      }

      // The consent token is both the CSRF proof for the decision POST
      // and the carrier of the exact request being approved: single-use,
      // bound to this user, dead in 10 minutes.
      const consentToken = await issueOAuthToken(db, {
        kind: 'consent',
        userId: user.id,
        clientId: client.id,
        scopes,
        ttlMs: CONSENT_TTL_MS,
        redirectUri: q.redirect_uri,
        codeChallenge: q.code_challenge,
        state: q.state ?? null,
      });
      return res.status(200).type('html').send(
        consentPage({
          clientName: client.client_name,
          // Where approval sends the writer (already exact-matched
          // against the registration above): the one thing a look-alike
          // app can't fake, since anyone may register any name.
          redirectHost: new URL(q.redirect_uri!).host,
          email: user.email,
          scopes: scopes.split(' '),
          consentToken,
        }),
      );
    } catch (err) {
      return next(err);
    }
  });

  router.post('/authorize/decision', form, async (req, res, next) => {
    try {
      pageHeaders(res);
      const parsed = decisionBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).type('html').send(errorPage('this consent form is incomplete — go back and try again'));
      }
      const user = await sessionUser(db, req);
      if (!user) {
        return res.status(403).type('html').send(errorPage('your sign-in expired — reconnect from the app that sent you here'));
      }
      // Single-use consume, scoped to THIS session's user: a token minted
      // for someone else neither works nor burns the owner's copy.
      const consent = await consumeOAuthToken(db, 'consent', parsed.data.consent, user.id);
      if (!consent) {
        return res.status(400).type('html').send(errorPage('this consent form expired or was already used — reconnect from the app'));
      }
      const url = new URL(consent.redirect_uri!);
      if (consent.state) url.searchParams.set('state', consent.state);
      if (parsed.data.decision === 'deny') {
        url.searchParams.set('error', 'access_denied');
        url.searchParams.set('error_description', 'the user denied the request');
        return res.status(200).type('html').send(returnPage(url.toString()));
      }
      const code = await issueOAuthToken(db, {
        kind: 'code',
        userId: user.id,
        clientId: consent.client_id,
        scopes: consent.scopes,
        ttlMs: CODE_TTL_MS,
        redirectUri: consent.redirect_uri,
        codeChallenge: consent.code_challenge,
      });
      url.searchParams.set('code', code);
      return res.status(200).type('html').send(returnPage(url.toString()));
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

const codeGrant = z.object({
  grant_type: z.literal('authorization_code'),
  code: z.string().min(1).max(512),
  code_verifier: z.string().regex(VERIFIER_RE, 'code_verifier must be 43–128 unreserved characters'),
  redirect_uri: z.string().max(2048),
  client_id: z.uuid(),
  resource: z.string().max(2048).optional(),
});

const refreshGrant = z.object({
  grant_type: z.literal('refresh_token'),
  refresh_token: z.string().min(1).max(512),
  client_id: z.uuid(),
  scope: z.string().max(512).optional(),
  resource: z.string().max(2048).optional(),
});

const tokenBody = z.discriminatedUnion('grant_type', [codeGrant, refreshGrant]);

// RFC 7591 §2: unrecognised metadata is ignored, not refused — zod's
// default strip mode does exactly that.
const registerBody = z.object({
  redirect_uris: z.array(z.string().max(2048)).min(1).max(10),
  client_name: z.string().trim().min(1).max(200).optional(),
  token_endpoint_auth_method: z.literal('none').optional(),
  grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).optional(),
  response_types: z.array(z.literal('code')).optional(),
});

/** A registered return address must be https; plain http only for
 *  loopback development (MCP Inspector runs on localhost). */
function redirectUriProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `redirect URI is not an absolute URL: ${raw}`;
  }
  if (url.hash) return 'a redirect URI must not carry a fragment';
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) {
    return null;
  }
  return 'redirect URIs must be https (http only for localhost)';
}

export function oauthApiRoutes(db: Db, config: Config): Router {
  const router = Router();
  // The token endpoint takes application/x-www-form-urlencoded
  // (RFC 6749 §4.1.3); JSON also lands here already parsed by the app's
  // global parser, and both shapes validate the same below.
  const form = express.urlencoded({ extended: false, limit: '16kb' });
  // Open registration writes rows, so it gets the auth endpoints' own
  // per-IP bucket settings (config.authRateBurst / authRateRefillMs).
  const registerLimit = rateLimit(
    new TokenBucketLimiter({ burst: config.authRateBurst, refillMs: config.authRateRefillMs }),
    'too many registration attempts — please wait and try again',
  );

  router.options(['/token', '/register'], cors);

  router.post('/register', cors, registerLimit, async (req, res, next) => {
    try {
      const parsed = registerBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          error: 'invalid_client_metadata',
          error_description: parsed.error.issues[0]?.message ?? 'invalid registration request',
        });
      }
      for (const uri of parsed.data.redirect_uris) {
        const problem = redirectUriProblem(uri);
        if (problem) return res.status(400).json({ error: 'invalid_redirect_uri', error_description: problem });
      }
      const clientName = parsed.data.client_name ?? 'MCP client';
      const client = await registerClient(db, clientName, parsed.data.redirect_uris);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(201).json({
        client_id: client.id,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
        client_name: clientName,
        redirect_uris: parsed.data.redirect_uris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/token', cors, form, async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      const parsed = tokenBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: parsed.error.issues[0]?.message ?? 'malformed token request',
        });
      }
      const body = parsed.data;
      const client = await findClient(db, body.client_id);
      // 401 invalid_client is the documented signal on which Claude
      // re-runs dynamic registration (support.claude.com article 11503834).
      if (!client) return res.status(401).json({ error: 'invalid_client' });

      const issuePair = async (userId: string, scopes: string) => {
        const accessToken = await issueOAuthToken(db, {
          kind: 'access',
          userId,
          clientId: client.id,
          scopes,
          ttlMs: ACCESS_TTL_MS,
        });
        const refreshToken = await issueOAuthToken(db, {
          kind: 'refresh',
          userId,
          clientId: client.id,
          scopes,
          ttlMs: REFRESH_TTL_MS,
        });
        return res.json({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: Math.floor(ACCESS_TTL_MS / 1000),
          refresh_token: refreshToken,
          scope: scopes,
        });
      };

      if (body.grant_type === 'authorization_code') {
        // Consume first (single-use, atomic): a code is burnt by its
        // first exchange attempt even when that attempt then fails a
        // binding check — RFC 6749 §4.1.2 and OAuth 2.1 both demand it.
        const code = await consumeOAuthToken(db, 'code', body.code);
        if (!code) return res.status(400).json({ error: 'invalid_grant', error_description: 'code is invalid, expired or already used' });
        if (
          code.client_id !== client.id ||
          code.redirect_uri !== body.redirect_uri ||
          !code.code_challenge ||
          !pkceChallengeMatches(body.code_verifier, code.code_challenge)
        ) {
          return res.status(400).json({ error: 'invalid_grant', error_description: 'code binding or PKCE verification failed' });
        }
        return await issuePair(code.user_id, code.scopes);
      }

      // refresh_token grant, with rotation. Look first WITHOUT consuming:
      // a refused request (bad scope, wrong client) must not invalidate
      // the refresh token (RFC 6749 §5.2 errors are not consumption).
      const seen = await findRefreshToken(db, body.refresh_token);
      if (!seen || seen.client_id !== client.id) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'refresh token is invalid or expired' });
      }
      if (seen.revoked) {
        // Reuse of a rotated refresh token = the grant may be stolen
        // (OAuth 2.1 §4.3.1): everything this user issued to this
        // client is revoked, and the caller is told plainly.
        if (!seen.expired) await revokeClientGrant(db, seen.user_id, seen.client_id);
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'refresh token reuse detected — the grant has been revoked; authorize again',
        });
      }
      if (seen.expired) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'refresh token is invalid or expired' });
      }
      // RFC 6749 §6: a refresh may NARROW scope, never widen it.
      let scopes = seen.scopes;
      if (body.scope !== undefined) {
        const requested = resolveScopes(body.scope);
        const granted = new Set(seen.scopes.split(' '));
        if (requested === null || !requested.split(' ').every((s) => granted.has(s))) {
          return res.status(400).json({ error: 'invalid_scope', error_description: 'a refresh may only narrow the original scopes' });
        }
        scopes = requested;
      }
      // NOW rotate, atomically: of two racing refreshes only one finds
      // the row unrevoked; the loser is told invalid_grant.
      const rotated = await consumeOAuthToken(db, 'refresh', body.refresh_token);
      if (!rotated) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'refresh token is invalid or expired' });
      }
      return await issuePair(rotated.user_id, scopes);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
