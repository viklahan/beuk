-- Aris W1 (docs/ARIS_DESIGN.md): the writer's AI-assist layer. Three
-- tables, all the writer's own data, all cascading with the account.
--
-- aris_settings: per-writer opt-in and voice. Aris is off until the
-- writer opts in (docs/ARIS_DESIGN.md).
create table aris_settings (
  user_id uuid primary key references users(id) on delete cascade,
  opted_in boolean not null default false,
  voice text not null default 'laconic' check (voice in ('laconic','homeric')),
  updated_at timestamptz not null default now()
);

-- aris_keys: the key vault for bring-your-own provider keys. Only the
-- ciphertext and the last four characters are stored; one key per
-- provider per writer. base_url is for openai-compat endpoints.
create table aris_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('openrouter','anthropic','openai-compat')),
  key_ciphertext text not null,
  key_last4 text not null,
  base_url text,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

-- ai_writes: the audit trail for AI-originated manuscript writes. One
-- row per applied proposal: what kind of write it was, which provider
-- and model produced it, the document's byte size before and after, and
-- whether the writer edited the proposal first. nonce makes a retried
-- apply idempotent per writer.
create table ai_writes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  manuscript_id uuid not null,
  section_id text not null,
  lens text not null,
  action text not null,
  kind text not null check (kind in ('generated-new','replaced-own-prose')),
  provider text not null,
  model text not null,
  proposal_chars integer not null,
  bytes_before integer not null,
  bytes_after integer not null,
  writer_edited boolean not null,
  nonce text not null,
  created_at timestamptz not null default now(),
  unique (user_id, nonce)
);
create index ai_writes_manuscript_idx on ai_writes (manuscript_id, created_at desc);
