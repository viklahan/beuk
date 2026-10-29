-- Beuk Weekly press (spec docs: 2026-10-29): one row per draft the Legion
-- drafter uploads. The files themselves live on the WEEKLY_DIR volume,
-- drafts/<id>/ while open, published/<NNN>/ once an admin approves.
--   drafted     uploaded, waiting for the editor
--   sent_back   the editor sent it back with notes; the drafter rewrites
--   approved    reserved for a publish in progress (never left standing)
--   published   live at /school/weekly/<issue_number>
--   withdrawn   discarded; its folder is gone and its number is free
-- Nothing publishes on its own: only an admin's Approve moves a row to
-- published. The number and week are set at publish (last + 1; the
-- Monday of the publish week), so a late approval never back-dates.
create table weekly_drafts (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('drafted', 'sent_back', 'approved', 'published', 'withdrawn')),
  issue_number integer null,
  week date null,
  source_commit text not null,
  notes text null,
  dropped jsonb not null default '[]',
  outlets jsonb not null default '[]',
  approved_by uuid null references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz null
);

-- One draft at a time: at most one row is open (drafted or sent_back).
create unique index weekly_drafts_one_open on weekly_drafts ((true)) where status in ('drafted', 'sent_back');
create unique index weekly_drafts_issue_number on weekly_drafts (issue_number) where issue_number is not null;
