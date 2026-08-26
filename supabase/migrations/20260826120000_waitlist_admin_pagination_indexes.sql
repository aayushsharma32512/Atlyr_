-- Admin waitlist approvals pages through the table ordered by recency and
-- filtered by status. Without these the list query is a seq scan + sort, and
-- the per-status COUNT(*) behind the "N total" header scans the whole table.

create index if not exists idx_waitlist_created_at_desc
  on public.waitlist (created_at desc);

create index if not exists idx_waitlist_status_created_at
  on public.waitlist (status, created_at desc);
