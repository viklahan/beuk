-- Beuk School: which lessons a signed-in writer has marked done.
-- Only signed-in writers have progress at all (V, 2026-10-28): an anonymous
-- visitor's progress is never stored, here or anywhere else.
-- course/lesson are content slugs (content/school/<lang>/<course>/NN-<lesson>.md);
-- a row for a lesson later removed from the content is simply never shown.
create table school_progress (
  user_id uuid not null references users(id) on delete cascade,
  course text not null,
  lesson text not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, course, lesson)
);
