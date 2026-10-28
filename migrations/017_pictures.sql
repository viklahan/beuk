-- Shelf pictures, stored once. A book's pictures (its image library,
-- cover, uploaded fonts and the copies its History keeps) used to ride
-- inside the manuscript doc as base64, so every autosave re-sent all of
-- them (The Marvelous Land of Oz: 49.8 MB per save). Now each one is
-- stored here once per account, addressed by the SHA-256 of its bytes,
-- and the doc names it with the string "beuk-pic:<sha256>" in place of
-- its data. Every query is owner-scoped: an account can only ever read,
-- name or delete its own pictures (another account's hash is "not found").
create table pictures (
  user_id uuid not null references users(id) on delete cascade,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  media_type text not null,
  -- decoded size in bytes (the quota counts these)
  byte_size integer not null check (byte_size >= 0),
  -- the bytes as canonical base64: exactly what the studio holds, so a
  -- doc read back with its pictures filled in is the doc that was saved
  data text not null,
  created_at timestamptz not null default now(),
  -- last upload or "do you have it?" ask: the collector never takes a
  -- picture touched within its grace window (a save in progress)
  touched_at timestamptz not null default now(),
  primary key (user_id, sha256)
);

-- Which shelf books name which pictures, rewritten on every doc write.
-- The foreign key to pictures makes the database itself refuse to drop
-- a picture any book still names (and refuse a doc naming a picture the
-- account does not hold); deleting a book drops its rows.
create table manuscript_pictures (
  manuscript_id uuid not null references manuscripts(id) on delete cascade,
  user_id uuid not null,
  sha256 text not null,
  primary key (manuscript_id, sha256),
  foreign key (user_id, sha256) references pictures (user_id, sha256)
);

create index manuscript_pictures_user_sha_idx on manuscript_pictures (user_id, sha256);
