-- Book format observe mode: after each manuscript save the server reads
-- the book with readBook() (src/book/read.ts) and keeps the LATEST
-- observation per book here. Observe only: a save is never rejected or
-- changed for format reasons. One row per book (upserted on every save);
-- it goes with the book (on delete cascade). `unknown_keys` are the
-- top-level keys the format does not know; `warnings` is the readBook
-- warning list as written ({code, path, detail}); `read_ms` is how long
-- readBook took on the server.
create table book_format_observations (
  manuscript_id uuid primary key references manuscripts(id) on delete cascade,
  observed_at timestamptz not null,
  status text not null,
  upgrades text[] not null,
  warnings jsonb not null,
  unknown_keys text[] not null,
  read_ms real not null
);
