import type { NextFunction, Request, Response } from 'express';
import { readCookie, SESSION_COOKIE, sessionUser } from '../auth.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { findAccessGrant, scopeGranted, type OAuthScope } from './model.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set when the request authenticated with an OAuth bearer token
     *  (space-separated scopes as granted). Absent on cookie sessions. */
    oauthScopes?: string;
  }
}

/** RFC 9728 §5.1: a 401 names where the resource's metadata lives, which
 *  is how an MCP client discovers the authorization server. `error` is
 *  only sent when a credential WAS presented and failed (RFC 6750 §3.1:
 *  a request with no authentication gets no error code). */
function unauthorized(res: Response, config: Config, tokenWasPresented: boolean, message: string): void {
  const parts = [`Bearer realm="beuk"`];
  if (tokenWasPresented) parts.push('error="invalid_token"');
  parts.push(`resource_metadata="${config.appBaseUrl}/.well-known/oauth-protected-resource"`);
  res.setHeader('WWW-Authenticate', parts.join(', '));
  res.status(401).json({ error: message });
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

/** Express middleware: resolves `Authorization: Bearer …` to req.user
 *  (and req.oauthScopes), else 401 — the OAuth twin of requireAuth.
 *  `needed` additionally demands one scope (403 insufficient_scope). */
export function requireBearer(db: Db, config: Config, needed?: OAuthScope) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = bearerToken(req);
      if (!token) return unauthorized(res, config, false, 'not signed in');
      const grant = await findAccessGrant(db, token);
      if (!grant) return unauthorized(res, config, true, 'token expired, revoked or invalid');
      if (needed && !scopeGranted(grant.scopes, needed)) {
        res.setHeader(
          'WWW-Authenticate',
          `Bearer realm="beuk", error="insufficient_scope", scope="${needed}"`,
        );
        res.status(403).json({ error: `this token is missing the ${needed} scope` });
        return;
      }
      req.user = { id: grant.userId, email: grant.email };
      req.oauthScopes = grant.scopes;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Phase 2: a whole router the studio (cookies) and the MCP server
 *  (bearer) both use, with the scope decided BY METHOD — a bearer may
 *  read (GET/HEAD need beuk:read) or write (anything else needs
 *  beuk:write) exactly what its consent screen granted. A cookie
 *  session passes untouched: the studio's behaviour does not change by
 *  one byte. Built on requireSessionOrBearer so the refusal bodies
 *  stay identical too. */
export function sessionOrScopedBearer(db: Db, config: Config) {
  const base = requireSessionOrBearer(db, config);
  return (req: Request, res: Response, next: NextFunction): void => {
    void base(req, res, (err?: unknown) => {
      if (err) return next(err);
      // No oauthScopes ⇒ the request authenticated with a cookie
      // session (requireSessionOrBearer only sets it for bearers).
      if (req.oauthScopes === undefined) return next();
      const needed: OAuthScope = req.method === 'GET' || req.method === 'HEAD' ? 'beuk:read' : 'beuk:write';
      if (!scopeGranted(req.oauthScopes, needed)) {
        res.setHeader(
          'WWW-Authenticate',
          `Bearer realm="beuk", error="insufficient_scope", scope="${needed}"`,
        );
        res.status(403).json({ error: `this token is missing the ${needed} scope` });
        return;
      }
      return next();
    });
  };
}

/** Cookie session first, bearer token second — for endpoints the studio
 *  (cookies) and the MCP server (bearer) both call, like /api/auth/me.
 *  The refusal bodies match requireAuth's exactly, so nothing the studio
 *  shows a signed-out writer changes. */
export function requireSessionOrBearer(db: Db, config: Config) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cookie = readCookie(req, SESSION_COOKIE);
      if (cookie) {
        // The same lookup requireAuth makes, "last active" included.
        const user = await sessionUser(db, cookie);
        if (user) {
          req.user = user;
          return next();
        }
        // A dead cookie plus a live bearer token still authenticates
        // (the MCP server never holds cookies; a browser with a stale
        // cookie and no bearer gets requireAuth's exact answer below).
      }
      const token = bearerToken(req);
      if (token) {
        const grant = await findAccessGrant(db, token);
        if (grant) {
          req.user = { id: grant.userId, email: grant.email };
          req.oauthScopes = grant.scopes;
          return next();
        }
        return unauthorized(res, config, true, 'token expired, revoked or invalid');
      }
      if (cookie) {
        res.status(401).json({ error: 'session expired or invalid' });
        return;
      }
      return unauthorized(res, config, false, 'not signed in');
    } catch (err) {
      next(err);
    }
  };
}
