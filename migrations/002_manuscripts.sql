-- M1: cloud manuscripts. The manuscript itself is a single JSON document
-- (the client's three-tier Front/Body/Back Matter sections + settings),
-- with light metadata columns alongside. Every query is owner-scoped.
create table manuscripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null default 'Untitled',
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index manuscripts_user_updated_idx on manuscripts (user_id, updated_at desc);
