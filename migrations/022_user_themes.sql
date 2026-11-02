-- My themes: a writer's own custom themes, kept per account so a theme
-- made in one book follows them to every book and device (Beuk 2.0; 1.0
-- keeps its custom themes per book, in the book's customThemes, and
-- still does). One row per (user, theme_key); theme_key is the theme's
-- own id (1.0's custom theme id, letters, digits, - and _). `doc` is
-- 1.0's custom-theme object ({ id, name, theme }) plus `assets`: the
-- uploaded fonts and flourishes the theme wears, each named by the
-- SHA-256 of its bytes. The bytes themselves never sit in the row: they
-- are the account's own stored pictures (migration 017), held once.
-- `revision` is the optimistic-concurrency counter series_covenants and
-- manuscripts carry: every write bumps it and a PUT or DELETE names the
-- revision it was based on (src/routes/user-themes.ts).
create table user_themes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  theme_key text not null,
  name text not null,
  doc jsonb not null,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, theme_key)
);

-- Which stored pictures each theme names, rewritten on every theme
-- write (as manuscript_pictures is for books). The foreign key to
-- pictures makes the database refuse to drop a picture a theme still
-- names (collectUnusedPictures checks both lists), and refuse a theme
-- naming a picture the account does not hold; deleting a theme drops
-- its rows.
create table user_theme_pictures (
  theme_id uuid not null references user_themes(id) on delete cascade,
  user_id uuid not null,
  sha256 text not null,
  primary key (theme_id, sha256),
  foreign key (user_id, sha256) references pictures (user_id, sha256)
);

create index user_theme_pictures_user_sha_idx on user_theme_pictures (user_id, sha256);
