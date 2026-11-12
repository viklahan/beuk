import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { tokenHash } from '../auth.js';
import type { Db } from '../db.js';

/** The three Beuk scopes (Phase 1 work order). Space-separated on the wire. */
export const OAUTH_SCOPES = ['beuk:read', 'beuk:write', 'beuk:export'] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export const CONSENT_TTL_MS = 10 * 60_000;
/** Work order: auth codes live at most 10 minutes. */
export const CODE_TTL_MS = 10 * 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 30 * 86_400_000;

export type OAuthTokenKind = 'consent' | 'code' | 'access' | 'refresh';

export interface OAuthClientRow {
  id: string;
  client_name: string;
  redirect_uris: string[];
}

export interface OAuthTokenRow {
  id: string;
  kind: OAuthTokenKind;
  user_id: string;
  client_id: string;
  scopes: string;
  redirect_uri: string | null;
  code_challenge: string | null;
  state: string | null;
}

export async function findClient(db: Db, clientId: string): Promise<OAuthClientRow | null> {
  const found = await db.query<OAuthClientRow>(
    'select id, client_name, redirect_uris from oauth_clients where id = $1',
    [clientId],
  );
  return found.rows[0] ?? null;
}

export async function registerClient(
  db: Db,
  clientName: string,
  redirectUris: string[],
): Promise<{ id: string; createdAt: Date }> {
  const created = await db.query<{ id: string; created_at: string }>(
    `insert into oauth_clients (client_name, redirect_uris)
     values ($1, $2) returning id, created_at`,
    [clientName, JSON.stringify(redirectUris)],
  );
  const row = created.rows[0];
  return { id: row.id, createdAt: new Date(row.created_at) };
}

export interface IssueTokenInput {
  kind: OAuthTokenKind;
  userId: string;
  clientId: string;
  /** Space-separated scope string, already validated. */
  scopes: string;
  ttlMs: number;
  redirectUri?: string | null;
  codeChallenge?: string | null;
  state?: string | null;
}

/** Mint a credential the way sessions are minted: 32 random bytes,
 *  base64url on the wire, SHA-256 hash in the table. Returns the raw
 *  token — the only moment it exists outside the caller's response. */
export async function issueOAuthToken(db: Db, input: IssueTokenInput): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + input.ttlMs);
  await db.query(
    `insert into oauth_tokens
       (kind, token_hash, user_id, client_id, scopes, redirect_uri, code_challenge, state, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.kind,
      tokenHash(token),
      input.userId,
      input.clientId,
      input.scopes,
      input.redirectUri ?? null,
      input.codeChallenge ?? null,
      input.state ?? null,
      expiresAt.toISOString(),
    ],
  );
  return token;
}

/** Atomic single-use consume (the password_resets pattern): only an
 *  unrevoked, unexpired row of the right kind matches, and it is revoked
 *  in the same statement — two racing exchanges cannot both win.
 *  `userId` (consent tokens) scopes the match to its owner, so someone
 *  else's session posting a stolen form value cannot BURN the owner's
 *  token: it simply does not match. */
export async function consumeOAuthToken(
  db: Db,
  kind: OAuthTokenKind,
  token: string,
  userId?: string,
): Promise<OAuthTokenRow | null> {
  const where = userId === undefined ? '' : ' and user_id = $3';
  const params: unknown[] = [tokenHash(token), kind];
  if (userId !== undefined) params.push(userId);
  const consumed = await db.query<OAuthTokenRow>(
    `update oauth_tokens set revoked_at = now()
     where token_hash = $1 and kind = $2 and revoked_at is null and expires_at > now()${where}
     returning id, kind, user_id, client_id, scopes, redirect_uri, code_challenge, state`,
    params,
  );
  return consumed.rows[0] ?? null;
}

/** Look a refresh token up WITHOUT consuming it, revoked rows included,
 *  so reuse of an already-rotated token is distinguishable from a token
 *  that never existed (reuse = the grant is treated as stolen). */
export async function findRefreshToken(
  db: Db,
  token: string,
): Promise<(OAuthTokenRow & { revoked: boolean; expired: boolean; just_rotated: boolean }) | null> {
  const found = await db.query<OAuthTokenRow & { revoked: boolean; expired: boolean; just_rotated: boolean }>(
    `select id, kind, user_id, client_id, scopes, redirect_uri, code_challenge, state,
            (revoked_at is not null) as revoked, (expires_at <= now()) as expired,
            (revoked_at > now() - make_interval(secs => $2)) as just_rotated
     from oauth_tokens where token_hash = $1 and kind = 'refresh'`,
    [tokenHash(token), REFRESH_RETRY_GRACE_S],
  );
  return found.rows[0] ?? null;
}

/** Seconds after a rotation in which spending the old refresh token
 *  again is treated as a retry (a lost response, or two of the app's own
 *  workers racing): refused, but the connection is NOT cut. After that,
 *  reuse is the theft signal and revokes the client's whole grant. */
export const REFRESH_RETRY_GRACE_S = 30;

export interface AccessGrant {
  userId: string;
  email: string;
  /** Space-separated scope string as granted. */
  scopes: string;
}

/** Resolve a bearer access token to its user, or null. */
export async function findAccessGrant(db: Db, token: string): Promise<AccessGrant | null> {
  const found = await db.query<{ user_id: string; email: string; scopes: string }>(
    `select t.user_id, u.email, t.scopes
     from oauth_tokens t join users u on u.id = t.user_id
     where t.token_hash = $1 and t.kind = 'access'
       and t.revoked_at is null and t.expires_at > now()`,
    [tokenHash(token)],
  );
  const row = found.rows[0];
  return row ? { userId: row.user_id, email: row.email, scopes: row.scopes } : null;
}

/** "Sign out everywhere" for OAuth: every live credential of the user —
 *  consents, codes, access AND refresh tokens — dies in one update.
 *  Returns rows revoked. Works on a tx Db as well as the pool. */
export async function revokeUserOAuthTokens(db: Db, userId: string): Promise<number> {
  const revoked = await db.query<{ id: string }>(
    'update oauth_tokens set revoked_at = now() where user_id = $1 and revoked_at is null returning id',
    [userId],
  );
  return revoked.rows.length;
}

/** Refresh-token reuse means the grant may be stolen: kill everything
 *  this user ever issued to this client. */
export async function revokeClientGrant(db: Db, userId: string, clientId: string): Promise<number> {
  const revoked = await db.query<{ id: string }>(
    `update oauth_tokens set revoked_at = now()
     where user_id = $1 and client_id = $2 and revoked_at is null returning id`,
    [userId, clientId],
  );
  return revoked.rows.length;
}

/** The sessions-purge twin (src/auth.ts purgeExpiredSessions): expired
 *  rows only. Revoked-but-unexpired refresh rows are deliberately KEPT —
 *  they are the reuse-detection evidence. Returns rows removed. */
export async function purgeExpiredOAuthTokens(db: Db): Promise<number> {
  const removed = await db.query<{ id: string }>(
    'delete from oauth_tokens where expires_at <= now() returning id',
  );
  return removed.rows.length;
}

/** PKCE S256 (RFC 7636 §4.6): base64url(SHA-256(verifier)) must equal the
 *  stored challenge. Compared in constant time; length mismatch is an
 *  immediate honest false (timingSafeEqual throws on unequal lengths). */
export function pkceChallengeMatches(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash('sha256').update(codeVerifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Parse + validate a requested scope string. Omitted/empty → every scope
 *  (the server's documented default). Unknown scope → null (invalid_scope). */
export function resolveScopes(requested: string | undefined | null): string | null {
  const trimmed = (requested ?? '').trim();
  if (!trimmed) return OAUTH_SCOPES.join(' ');
  const parts = trimmed.split(/\s+/);
  const seen = new Set<string>();
  for (const part of parts) {
    if (!(OAUTH_SCOPES as readonly string[]).includes(part)) return null;
    seen.add(part);
  }
  return [...seen].join(' ');
}

export function scopeGranted(grantedScopes: string, needed: OAuthScope): boolean {
  return grantedScopes.split(' ').includes(needed);
}


/** A client just got tokens: it is in use and must never be purged as
 *  an abandoned registration (migration 027). */
export async function markClientUsed(db: Db, clientId: string): Promise<void> {
  await db.query('update oauth_clients set last_used_at = now() where id = $1', [clientId]);
}

/** Open registration writes rows (review M4): a registration over a day
 *  old that never got a token and holds no consent or code in flight is
 *  deleted. Clients that were ever used are kept (see migration 027).
 *  Returns rows removed. */
export async function purgeIdleOAuthClients(db: Db): Promise<number> {
  const removed = await db.query<{ id: string }>(
    `delete from oauth_clients c
     where c.last_used_at is null
       and c.created_at < now() - interval '1 day'
       and not exists (select 1 from oauth_tokens t where t.client_id = c.id)
     returning id`,
  );
  return removed.rows.length;
}
