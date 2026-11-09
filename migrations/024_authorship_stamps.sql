-- The authorship record. Each backup export (and each Word download)
-- leaves one stamp: the SHA-256 fingerprint of the exact book text that
-- left the desk, the book's title, the kind of file and the time. Never
-- the book's text itself. Only the stamp's owner can read it back; the
-- rows go with the account (on delete cascade, and deleted explicitly by
-- "Delete my account").
create table authorship_stamps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- The studio's meta.bookId: 1-200 characters, no control characters.
  book_id text not null,
  -- Trimmed and cut to 300 characters by the route; may be empty.
  title text not null default '',
  -- 64 lowercase hex characters (checked by the route).
  sha256 text not null,
  kind text not null check (kind in ('backup', 'docx')),
  created_at timestamptz not null default now()
);

-- The record view: one book's stamps, newest first.
create index authorship_stamps_user_book_idx on authorship_stamps (user_id, book_id, created_at desc);
-- The "untouched" check: is this fingerprint on my record?
create index authorship_stamps_user_sha_idx on authorship_stamps (user_id, sha256);
