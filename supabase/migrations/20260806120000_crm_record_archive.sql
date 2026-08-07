-- Soft-delete for CRM records: one column, one meaning, all six objects.
--
-- ADDITIVE ONLY. Adds a nullable column and backfills it; no type changes, so
-- .github/workflows/migrate-prod.yml can apply it unattended.
--
-- Why a column rather than a status value. "Archived" was modelled as a STATUS,
-- and the six objects model status six different ways:
--
--   companies  company_status enum — has 'archived'
--   contacts   contact_status enum — has 'archived'
--   leads      lead_status (now text) — has 'archived'
--   jobs       job_status (now text) — pending/scheduled/in_progress/completed/canceled
--   outcomes   outcome_status (now text) — pending/won/lost/paid/written_off
--   properties NO status column at all
--
-- So for three of the six there was no way to remove a record at all, and the
-- UI reflected that: the edit form offers 'archived' on companies, contacts and
-- leads only. Worse, leads/jobs/outcomes statuses are now the TENANT'S pipeline
-- stages (20260729170000). Writing 'archived' into that column invents a stage
-- the org never defined — the exact "status that maps to nothing" failure the
-- edit modal already warns about — and the app would then be branching on a
-- value a tenant can rename, which src/domain/pipeline-stages.ts forbids:
-- per-org if it describes the tenant's process, never if the code branches on
-- it. Being archived is app machinery. It gets its own column.
--
-- Reversible on purpose: restoring is `archived_at = null`, and no row is ever
-- destroyed. There is still no hard delete anywhere in this product.

alter table public.companies  add column if not exists archived_at timestamp with time zone;
alter table public.contacts   add column if not exists archived_at timestamp with time zone;
alter table public.properties add column if not exists archived_at timestamp with time zone;
alter table public.leads      add column if not exists archived_at timestamp with time zone;
alter table public.jobs       add column if not exists archived_at timestamp with time zone;
alter table public.outcomes   add column if not exists archived_at timestamp with time zone;

-- Every list and count reads "not archived", so index that side. Partial keeps
-- the index small: archived rows are the rare case and are read only when
-- someone explicitly asks to see them.
create index if not exists companies_active_org_idx  on public.companies  (org_id) where archived_at is null;
create index if not exists contacts_active_org_idx   on public.contacts   (org_id) where archived_at is null;
create index if not exists properties_active_org_idx on public.properties (org_id) where archived_at is null;
create index if not exists leads_active_org_idx      on public.leads      (org_id) where archived_at is null;
create index if not exists jobs_active_org_idx       on public.jobs       (org_id) where archived_at is null;
create index if not exists outcomes_active_org_idx   on public.outcomes   (org_id) where archived_at is null;

-- Backfill the three objects that already carried 'archived' as a status, so
-- the new column is the SINGLE source of truth from the first read. Without
-- this, records archived the old way would reappear in every list the moment
-- the filter switched to archived_at — a silent un-delete.
--
-- `status::text` because the column is an enum on companies/contacts and text
-- on leads; the cast reads both. updated_at is deliberately NOT touched: this
-- records something already true, it is not an edit by the operator.
update public.companies set archived_at = coalesce(updated_at, now())
  where archived_at is null and status::text = 'archived';
update public.contacts  set archived_at = coalesce(updated_at, now())
  where archived_at is null and status::text = 'archived';
update public.leads     set archived_at = coalesce(updated_at, now())
  where archived_at is null and status::text = 'archived';

comment on column public.companies.archived_at is
  'Soft delete. Non-null = hidden from lists, counts and Arc. Restore by setting null; rows are never destroyed.';
comment on column public.contacts.archived_at is
  'Soft delete. Non-null = hidden from lists, counts and Arc. Restore by setting null; rows are never destroyed.';
comment on column public.properties.archived_at is
  'Soft delete. Non-null = hidden from lists, counts and Arc. Restore by setting null; rows are never destroyed.';
comment on column public.leads.archived_at is
  'Soft delete. Non-null = hidden from lists, counts and Arc. Restore by setting null; rows are never destroyed.';
comment on column public.jobs.archived_at is
  'Soft delete. Non-null = hidden from lists, counts and Arc. Restore by setting null; rows are never destroyed.';
comment on column public.outcomes.archived_at is
  'Soft delete. Non-null = hidden from lists, counts and Arc. Restore by setting null; rows are never destroyed.';
