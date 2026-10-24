-- M5: server jobs — EPUBCheck validation and PDF/X conversion run as
-- background jobs over exports already in the user's archive.
-- The framework is honest about its tools: a job whose tool is not
-- configured on this server completes as FAILED with that stated in
-- its result; a result is only ever what the real tool produced
-- (see src/jobs/).
create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('epubcheck', 'pdfx')),
  -- The archive export the job runs on. Set null if the user later
  -- deletes the source export; the job record (and its result) stays.
  source_export_id uuid references exports(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed')),
  -- The parsed tool outcome: counts + messages for EPUBCheck, the
  -- output summary for PDF/X, or the plain-language reason for a
  -- failure (tool not configured, tool error, timeout). Tool output
  -- derives from the user's own files; no secrets live here.
  result jsonb,
  -- For a successful pdfx job: the converted PDF, stored back into
  -- the user's archive as a new export (format 'pdfx').
  artifact_export_id uuid references exports(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index jobs_user_created_idx on jobs (user_id, created_at desc);
create index jobs_status_idx on jobs (status, created_at);

-- A successful pdfx job stores its output in the same archive, so
-- 'pdfx' joins the allowed export formats.
alter table exports drop constraint exports_format_check;
alter table exports add constraint exports_format_check
  check (format in ('epub', 'markdown', 'html', 'print-html', 'docx', 'pdfx'));
