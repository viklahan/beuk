-- Beta-reader share links. A signed-in writer shares a frozen,
-- read-only copy of a manuscript with beta readers, who can leave
-- comments without an account. The link's secret token is shown to the
-- writer once and stored here only as its SHA-256 hash (like sessions).
create table shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  -- The shelf manuscript the copy was taken from. Set null if the
  -- writer later deletes that manuscript: the frozen copy keeps
  -- working until revoked or expired, but can no longer be republished.
  manuscript_id uuid references manuscripts(id) on delete set null,
  token_hash text not null unique,
  title text not null,
  -- The frozen copy, rendered and sanitized at share time (and again on
  -- every republish): book metadata + one sanitized HTML body per
  -- readable section. Images live in their own column so a page view
  -- never drags every picture out of the database.
  snapshot jsonb not null,
  images jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  allow_comments boolean not null default true,
  reader_name_required boolean not null default true
);

create index shares_owner_created_idx on shares (owner_id, created_at desc);
create index shares_manuscript_idx on shares (manuscript_id);

create table share_comments (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references shares(id) on delete cascade,
  -- Anchor: the studio section id, the block (paragraph) index inside
  -- that section's text, and the passage the reader selected (if any).
  section_id text not null,
  paragraph_index integer,
  quote text,
  body text not null,
  reader_name text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  -- SHA-256 of share id + client IP, for abuse review only. (An IPv4
  -- hash is brute-forceable; this is abuse control, not anonymity.)
  ip_hash text not null
);

create index share_comments_share_created_idx on share_comments (share_id, created_at);

-- Reader count: one row per distinct browser that opened the link
-- (an opaque cookie, hashed with the share id). Never shown to readers.
create table share_readers (
  share_id uuid not null references shares(id) on delete cascade,
  visitor_hash text not null,
  first_seen_at timestamptz not null default now(),
  primary key (share_id, visitor_hash)
);
