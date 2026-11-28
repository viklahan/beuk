-- ARC campaigns, slice 1 (docs/superpowers/specs/2026-11-27-arc-campaigns-design.md).
-- A campaign is one share (no open link) + this row + one build; its readers are
-- share_recipients rows with role 'arc'. Reader emails go when the campaign, its
-- share or its book goes.

-- A campaign's share has no open link: readers enter only by claiming.
alter table shares alter column token_hash drop not null;

create table arc_campaigns (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null unique references shares(id) on delete cascade,
  owner_id uuid not null references users(id) on delete cascade,
  -- restrict: the book is deleted only through deleteArcForManuscript (src/arc/campaigns.ts),
  -- which removes the campaign's share first, so no reader address outlives the book.
  manuscript_id uuid not null references manuscripts(id) on delete restrict,
  signup_token_hash text not null unique,
  max_claims integer not null check (max_claims between 1 and 50),
  approval_mode text not null check (approval_mode in ('instant', 'approval')),
  launch_date date not null,
  closes_at timestamptz not null,
  -- the author's IANA time zone, from the studio's browser
  tz text not null,
  author_notified_at timestamptz,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index arc_campaigns_one_running_idx on arc_campaigns (manuscript_id) where ended_at is null;
create index arc_campaigns_owner_idx on arc_campaigns (owner_id);

-- One row per version. Slice 1 makes version 1 only. The unstamped EPUB as canonical
-- base64 (the pictures-table precedent); each reader's copy is stamped per download, never stored.
create table arc_builds (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references arc_campaigns(id) on delete cascade,
  version_no integer not null default 1,
  label text not null default 'v1.0',
  epub_base64 text not null,
  epub_sha256 text not null,
  epub_bytes integer not null,
  epub_filename text not null,
  -- {mediaType, data} of the book's cover at build time, or null; blurb is plain text
  cover jsonb,
  blurb text not null default '',
  created_at timestamptz not null default now(),
  unique (campaign_id, version_no)
);

alter table share_recipients alter column token_hash drop not null;
alter table share_recipients
  add column role text not null default 'beta' check (role in ('beta', 'arc')),
  add column email text,
  add column email_verified_at timestamptz,
  add column status text check (status in ('unverified', 'pending', 'claimed', 'declined')),
  add column build_id uuid references arc_builds(id) on delete set null,
  add column profile_link text,
  add column public_id text unique,
  add column claimed_at timestamptz,
  add column tz text,
  add column verify_ref_hash text unique,
  add column verify_code_hash text,
  add column verify_expires_at timestamptz,
  add column verify_attempts integer not null default 0,
  add column codes_sent integer not null default 0,
  add column mail_token_hash text unique,
  add column mail_stopped_at timestamptz;
alter table share_recipients add constraint share_recipients_role_shape check (
  (role = 'beta' and token_hash is not null and email is null and status is null)
  or (role = 'arc' and email is not null and status is not null and mail_token_hash is not null)
);
-- An ARC reader's address is kept in normalised form (src/arc/mail.ts normalizeEmail),
-- so one address typed two ways is one reader and one suppression hash.
alter table share_recipients add constraint share_recipients_arc_email_normal check (
  role <> 'arc' or email = lower(btrim(email))
);
-- beta names stay unique per copy; ARC readers are unique by email (two Sarahs both fit)
drop index share_recipients_share_name_idx;
create unique index share_recipients_share_name_idx on share_recipients (share_id, lower(name)) where role = 'beta';
create unique index share_recipients_share_email_idx on share_recipients (share_id, email) where role = 'arc';

-- What happened, for the send limits and the author's trace. No addresses here.
create table arc_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references arc_campaigns(id) on delete cascade,
  recipient_id uuid references share_recipients(id) on delete set null,
  kind text not null,
  at timestamptz not null default now()
);
create index arc_events_campaign_at_idx on arc_events (campaign_id, at);

-- "Not me" (scope 'all') and "Stop" (scope = the author's user id). Only
-- SHA-256(lower-cased email + ARC_SUPPRESSION_SALT). No FK to users on purpose:
-- an opt-out must outlive the author's account.
create table mail_suppressions (
  hash text not null,
  scope text not null,
  created_at timestamptz not null default now(),
  primary key (hash, scope)
);
