-- M2: per-user export archive. Metadata lives here; the bytes live on the
-- data volume at EXPORT_DIR/<user_id>/<export_id> (no extension — the
-- format/filename metadata in this row is what a download is served as).
-- Every query in the routes is owner-scoped, exactly like manuscripts.
create table exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- The manuscript this export was produced from. Verified owner-scoped at
  -- insert time; set null (not cascaded) if the manuscript is later deleted,
  -- so the archive copy survives the working document.
  manuscript_id uuid references manuscripts(id) on delete set null,
  format text not null check (format in ('epub', 'markdown', 'html', 'print-html', 'docx')),
  preset text,
  filename text not null,
  byte_size bigint not null,
  sha256 text not null,
  created_at timestamptz not null default now()
);

create index exports_user_created_idx on exports (user_id, created_at desc);
create index exports_manuscript_idx on exports (manuscript_id);
