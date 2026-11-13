-- Phase 3 (PHASE3.md item 4): the audit trail for MCP-originated writes.
-- One row per bearer-authed manuscript UPDATE (the MCP update_chapter
-- path): who, through which OAuth client and token, which book, which
-- sections changed, and the document's byte size before and after.
-- Written by the APP at the moment of the write — never self-reported
-- by the MCP service. Session (cookie) writes are the writer's own
-- hands and are not recorded here.
create table mcp_writes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  client_id uuid not null,
  token_id uuid not null,
  manuscript_id uuid not null,
  -- The ids of sections whose content changed (added, removed, or
  -- edited), diffed by the app between the stored and incoming doc.
  changed_sections jsonb not null default '[]',
  bytes_before integer not null,
  bytes_after integer not null,
  created_at timestamptz not null default now()
);
create index mcp_writes_user_idx on mcp_writes (user_id, created_at desc);
create index mcp_writes_manuscript_idx on mcp_writes (manuscript_id, created_at desc);
