-- Covenant Codex: one shared Covenant (the story bible) per series, so
-- every book of a series reads the same cast, places and rules.
-- One row per (user, series_key); series_key is the series name
-- lowercased with whitespace collapsed (seriesKey() in
-- src/routes/series-covenants.ts, mirrored by the studio), so
-- "Salt  Road" and "salt road" are one row. `name` keeps the writer's
-- own spelling for display. `revision` is the same optimistic-
-- concurrency counter manuscripts carry (migration 009): every write
-- bumps it and a PUT must name the revision it was based on.
create table series_covenants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  series_key text not null,
  name text not null,
  doc jsonb not null,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, series_key)
);
