-- Production ops: studio error reports, daily usage counts, backup alerts.
-- None of these tables holds a user id, an email address, an IP address
-- or any book content (see docs/privacy-inventory.md §11–§12). All three
-- are excluded from backups (src/housekeeping/backup.ts EXCLUDED_TABLES).

-- Studio error reports (POST /api/client-errors). One row per day per
-- distinct (error fingerprint, UI language, device class), with a count:
-- reports are aggregated as they arrive, never kept one per visit.
-- message/stack are scrubbed twice (in the studio and again here) of URL
-- query strings, email addresses and token-like strings. Rows older than
-- CLIENT_ERRORS_KEEP_DAYS (default 30) are deleted.
create table if not exists client_errors (
  id bigserial primary key,
  day date not null,
  fingerprint text not null,
  message text not null check (char_length(message) <= 300),
  stack text not null default '' check (char_length(stack) <= 2000),
  studio_build text not null default 'unknown' check (char_length(studio_build) <= 40),
  server_build text not null default 'unknown' check (char_length(server_build) <= 80),
  ui_lang text not null default '-' check (char_length(ui_lang) <= 10),
  device_class text not null default '-' check (device_class in ('phone', 'tablet', 'desktop', '-')),
  kind text not null default 'error' check (kind in ('error', 'rejection')),
  count integer not null default 1,
  last_seen_hour timestamptz not null,
  unique (day, fingerprint, ui_lang, device_class)
);
create index if not exists client_errors_day_idx on client_errors (day);

-- Usage counts: ONE row per day per counter, a number and nothing else.
-- No cookies, no IPs, no per-user event log. `final` marks a past day
-- whose computed counters will not be recomputed.
create table if not exists usage_daily (
  day date not null,
  counter text not null check (counter in (
    'sign_ups', 'sign_ins', 'first_shelf_saves', 'exports_archived',
    'epubcheck_runs', 'share_links_created', 'came_back_after_7_days'
  )),
  count integer not null default 0 check (count >= 0),
  final boolean not null default false,
  primary key (day, counter)
);

-- Backup alert state: one row per incident key ('backups'). Remembers
-- whether an incident is open and when it was alerted, so an alert goes
-- out once per incident (and once on recovery), never every tick.
create table if not exists ops_alerts (
  key text primary key,
  open boolean not null default false,
  opened_at timestamptz,
  closed_at timestamptz,
  failing text not null default '',
  detail text not null default '',
  last_alert_at timestamptz,
  last_alert_kind text,
  last_alert_result text,
  delivered boolean not null default false,
  open_attempts integer not null default 0
);
