-- Link a support request to the Linear issue it was filed as.
--
-- Internal triage state, not tenant state: the columns record where OUR
-- engineering tracker put the report, so a workspace's request can be followed
-- from the in-app form to the ticket that fixes it. They are not selected by
-- the tenant-facing read model (src/lib/support/read-model.ts) — a workspace
-- has no business seeing our issue tracker's internals.
--
-- Nullable on purpose. Linear is optional (LINEAR_API_KEY unset = off), so an
-- unlinked row is a normal state, not a broken one. `linear_sync_error` is what
-- makes a FAILED sync visible: without it a Linear outage would look exactly
-- like the integration being switched off.

alter table public.support_requests
  add column if not exists linear_issue_id text,
  add column if not exists linear_issue_identifier text,
  add column if not exists linear_issue_url text,
  add column if not exists linear_sync_error text;

comment on column public.support_requests.linear_issue_id is
  'Linear issue UUID, when the request was filed as a ticket.';
comment on column public.support_requests.linear_issue_identifier is
  'Human Linear handle, e.g. BSR-123.';
comment on column public.support_requests.linear_sync_error is
  'Why the Linear filing failed. Null when it succeeded OR when the integration is switched off — check linear_issue_id to tell those apart.';

-- Sweep query: "what came in that never reached Linear?" Partial so it stays
-- small — the healthy case is a row WITH an issue id.
create index if not exists support_requests_linear_unfiled_idx
  on public.support_requests (created_at desc)
  where linear_issue_id is null;
