-- OAuth 2.1 for the remote MCP server (Phase 1): clients registered via
-- RFC 7591 dynamic registration (public clients, no secret) and every
-- credential the flow mints. Tokens are stored as SHA-256 hashes only,
-- exactly like sessions (001_users_sessions.sql) — a database read never
-- yields a usable token.
create table oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  -- Exact-match allow-list for /authorize redirect_uri (jsonb array of
  -- absolute URLs). Claude registers https://claude.ai/api/mcp/auth_callback.
  redirect_uris jsonb not null,
  -- Public clients only (PKCE carries the proof): always 'none'.
  token_endpoint_auth_method text not null default 'none',
  created_at timestamptz not null default now()
);

-- One table for every credential kind, so "sign out everywhere" is ONE
-- update and the lifecycle rules stay in one place:
--   consent — the CSRF/one-time token behind the consent form (10 min)
--   code    — the authorization code (10 min, single-use)
--   access  — the bearer token MCP requests carry (~1 h)
--   refresh — rotated on every use (30 days)
create table oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('consent', 'code', 'access', 'refresh')),
  token_hash text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  client_id uuid not null references oauth_clients(id) on delete cascade,
  -- Space-separated, the OAuth wire format (e.g. 'beuk:read beuk:write').
  scopes text not null,
  -- consent + code rows carry the authorization request they are bound
  -- to; the token exchange re-checks all three against the caller.
  redirect_uri text,
  code_challenge text,
  state text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- Set on single-use consume (consent, code, refresh rotation) and on
  -- revocation ("sign out everywhere", password change/reset). A revoked
  -- refresh row is kept until expiry so reuse of a rotated token is
  -- DETECTED (and revokes the client's whole grant) instead of invisible.
  revoked_at timestamptz
);

create index oauth_tokens_user_id_idx on oauth_tokens (user_id);
create index oauth_tokens_client_id_idx on oauth_tokens (client_id);
create index oauth_tokens_expires_at_idx on oauth_tokens (expires_at);
