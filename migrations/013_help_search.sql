-- H2: Help search. help_docs is DERIVED data: the app rebuilds it from
-- content/help/ on every boot (src/help/search.ts rebuildHelpIndex — an
-- idempotent upsert plus a delete of rows whose content is gone), so it
-- is excluded from backups. search_log keeps what was searched — the
-- sha-256 of the normalised query, its first 200 characters and the
-- result count — with NO user id and NO IP address.

-- pg_trgm (typo-tolerant matching) ships with Postgres' contrib modules
-- and is a trusted extension (PG13+), so the database owner can create
-- it. Where it is unavailable (PGlite without the extension loaded, a
-- Postgres built without contrib) the migration still succeeds and the
-- search falls back to an in-app trigram match; see search.ts.
do $$
begin
  create extension if not exists pg_trgm;
exception when others then
  raise notice 'pg_trgm is not available (%); help search uses its in-app fallback', sqlerrm;
end
$$;

create table if not exists help_docs (
  id text primary key,
  kind text not null check (kind in ('guide', 'error', 'section')),
  ref text not null,
  title text not null,
  body text not null,
  codes text not null default '',
  url text not null,
  tsv tsvector generated always as (
    setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', body), 'B')
  ) stored,
  updated_at timestamptz not null default now()
);
create index if not exists help_docs_tsv_idx on help_docs using gin (tsv);

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    execute 'create index if not exists help_docs_title_trgm_idx on help_docs using gin (title gin_trgm_ops)';
    execute 'create index if not exists help_docs_codes_trgm_idx on help_docs using gin (codes gin_trgm_ops)';
  end if;
end
$$;

create table if not exists search_log (
  id bigserial primary key,
  q_hash text not null,
  q_text text not null check (char_length(q_text) <= 200),
  results_count integer not null,
  clicked_ref text,
  created_at timestamptz not null default now()
);
create index if not exists search_log_created_idx on search_log (created_at);
create index if not exists search_log_zero_idx on search_log (created_at) where results_count = 0;
