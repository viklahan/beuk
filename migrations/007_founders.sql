-- M4: Founders' Shelf applications (Warmth Phase 0 — the private seed
-- list of writers). Written by the public POST /api/founders/apply;
-- read only through Housekeeping's founders.list action. No emails are
-- sent from these rows in this milestone.
create table founders_applications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  about text not null,
  created_at timestamptz not null default now()
);

create index founders_applications_created_idx on founders_applications (created_at desc);
