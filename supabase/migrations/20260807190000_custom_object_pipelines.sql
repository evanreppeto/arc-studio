-- Pipelines on tenant-defined record types.
--
-- The three built-in pipelines (leads, jobs, outcomes) are the sales process.
-- A tenant-defined type has its own lifecycle — equipment is in service, needs
-- repair, retired; a permit is applied for, granted, expired — and until now
-- had no way to say so, because pipeline_stages.object_key was pinned to those
-- three by a CHECK.
--
-- OPT-IN, and that is the whole design. There is no sensible default lifecycle
-- for "Equipment": the app cannot guess it and guessing wrong is worse than
-- staying quiet, so a custom object HAS a pipeline exactly when its org has
-- stage rows for it. No rows means no status column, no picker, nothing added
-- to the screen — which is also what keeps every custom object that shipped
-- before this migration behaving exactly as it did.
--
-- Contrast the six: DEFAULT_PIPELINE_STAGES seeds those per industry at
-- workspace creation, because a lead pipeline is a thing the product knows the
-- shape of. This one belongs to the tenant alone.
--
-- ADDITIVE. Adds a nullable column and swaps one CHECK for a looser one; no
-- drop table/column, no `alter column ... type`, so migrate-prod applies it
-- unattended.

-- ── Let a stage hang off a tenant-defined type ────────────────────────────────
--
-- Same widening as custom_field_definitions got in 20260806140000: from a fixed
-- list to the key grammar every valid object key already satisfies. The app
-- still checks that the key names something real — a format check cannot know
-- which types an org has defined — but nothing unsafe in a URL or an export can
-- be stored.
alter table public.pipeline_stages
  drop constraint if exists pipeline_stages_object_key_check;
alter table public.pipeline_stages
  add constraint pipeline_stages_object_key_check
  check (object_key ~ '^[a-z][a-z0-9_]{0,62}$');

-- ── Where a record's stage lives ──────────────────────────────────────────────
--
-- NULLABLE on purpose, and it stays null for every object without a pipeline.
-- It holds a stage KEY, not a label: labels are the tenant's words and change
-- whenever they rename a stage, and a renamed stage must not orphan every
-- record sitting in it. Deliberately NOT a foreign key to pipeline_stages —
-- archiving a stage would then either cascade (deleting records) or block
-- (refusing the archive); the app resolves an unknown key to "no stage" and
-- shows the raw value, which is recoverable and loud.
alter table public.custom_object_records
  add column if not exists status text;

-- Lists filter by stage inside one object, and only over live rows.
create index if not exists custom_object_records_status_idx
  on public.custom_object_records (org_id, object_id, status)
  where archived_at is null;

comment on column public.custom_object_records.status is
  'Stage key from pipeline_stages for this object type, or null when the type has no pipeline. Not an FK: a stage archived out from under a record must not delete or block it.';
