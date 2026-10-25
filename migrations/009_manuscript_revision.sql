-- Local-first saving: optimistic concurrency for cloud manuscripts.
-- Every successful write bumps `revision`; a PUT must name the
-- revision it was based on (If-Match header or body.revision) and is
-- refused with 409 + the current shelf copy when the shelf has moved
-- on since. Two devices can therefore never silently overwrite each
-- other — the client routes the 409 into its conflict notice
-- (Keep mine / Use the shelf copy / Keep both).
-- Existing rows start at revision 1.
alter table manuscripts add column revision integer not null default 1;
