-- Named reading links. Each beta reader can get their own link to a
-- reading copy (a share): the same frozen copy, but the reader's name
-- is on every page, and the link expires or closes on its own. As with
-- shares, the link's secret token is shown to the writer once and kept
-- here only as its SHA-256 hash. Closed and expired rows are kept as
-- the trace record (a leaked page names exactly one row).
create table share_recipients (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references shares(id) on delete cascade,
  -- 1-60 code points after NFC + trim, no control characters; never renamed.
  name text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  first_opened_at timestamptz,
  -- Written at most once an hour per link.
  last_opened_at timestamptz
);

-- Names are unique within a reading copy, compared case-insensitively.
create unique index share_recipients_share_name_idx on share_recipients (share_id, lower(name));

-- A comment left through a named link carries that link; null = the open link.
alter table share_comments add column recipient_id uuid references share_recipients(id) on delete set null;
create index share_comments_recipient_idx on share_comments (recipient_id);

-- The open link can be closed on its own while the named links keep working.
alter table shares add column open_link_closed_at timestamptz;
