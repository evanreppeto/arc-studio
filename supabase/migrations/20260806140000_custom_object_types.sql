-- Tenant-defined object types (reopens Option B).
--
-- Until now the CRM was exactly six objects — companies, contacts, properties,
-- leads, jobs, outcomes — renameable but not extensible. A workspace that
-- tracks something the six don't model (equipment, subcontractors, permits,
-- vehicles) had nowhere to put it. This adds net-new object types per org.
--
-- A GENERIC ROW STORE, not a table per type. That is forced, not preferred:
--
--   * .github/workflows/migrate-prod.yml applies checked-in files. There is no
--     runtime DDL path, and a tenant creating an object type at 2am cannot wait
--     for a deploy.
--   * PostgREST resolves tables from a cached schema; a new table is invisible
--     until that cache reloads, so every create would need a privileged reload.
--   * RLS policies and role grants would have to be minted per table, per
--     tenant, forever — the surface where a missed grant is a data leak.
--
-- So the shape mirrors custom_field_values, which already stores tenant-defined
-- data as rows rather than columns and has been in production since
-- 20260728180000.
--
-- ADDITIVE. No drop table/column, no `alter column ... type` — this stays an
-- unattended migration. It does drop and re-add two CHECK constraints, which
-- that guard permits and which is the whole point of the third section.

-- ── The type definition ───────────────────────────────────────────────────────
create table if not exists public.custom_objects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  -- Route segment and the object_key custom fields hang off: /crm/<key>/<id>.
  -- Same grammar as a custom field's key, so it is safe in URLs, exports and
  -- Arc's prompt context.
  key text not null,
  -- Both words, always. A partial pair is refused rather than half-applied —
  -- the rule app_settings.crm_object_labels already follows, because "Add
  -- Equipments" is what you get when only the plural is supplied.
  label_plural text not null,
  label_singular text not null,
  description text,
  sort_order integer not null default 0,
  -- Soft delete, like every other tenant-defined thing here: archiving hides
  -- the object and its records but destroys nothing.
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint custom_objects_key_format_check
    check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  -- The six built-ins are not available as keys: the CRM routes resolve a
  -- built-in first, so a custom object named `contacts` would be permanently
  -- unreachable — a record you can create and never open. Enforced here as
  -- well as in the app because the app is not the only writer.
  constraint custom_objects_key_reserved_check
    check (key not in ('companies', 'contacts', 'properties', 'leads', 'jobs', 'outcomes', 'import', 'new', 'settings')),
  constraint custom_objects_label_plural_check
    check (char_length(btrim(label_plural)) between 1 and 60),
  constraint custom_objects_label_singular_check
    check (char_length(btrim(label_singular)) between 1 and 60)
);

-- One key per org. Two objects answering to /crm/equipment is a coin flip over
-- which one the route resolves.
create unique index if not exists custom_objects_org_key_idx
  on public.custom_objects (org_id, key);

-- ── The records ───────────────────────────────────────────────────────────────
create table if not exists public.custom_object_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  -- ORG-owned, no workspace_id — matching companies/contacts/leads/jobs/
  -- properties/outcomes, which are all "org" in supabase/tenancy-contract.mjs.
  -- The rule (BSR-637): a row is workspace-owned only if two workspaces in one
  -- company could legitimately DISAGREE about it. Two workspaces disagreeing
  -- about whether a piece of equipment exists means one of them is wrong, so
  -- the org owns it — same as it owns the contact record.
  object_id uuid not null references public.custom_objects (id) on delete restrict,
  -- What the row is called in a list. Every object needs one identifying
  -- string; everything else the tenant defines is a custom field.
  title text not null,
  subtitle text,
  -- Provenance and anything the app stashes, matching the six.
  metadata jsonb not null default '{}'::jsonb,
  origin text not null default 'operator',
  archived_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint custom_object_records_title_check
    check (char_length(btrim(title)) between 1 and 200)
);

-- `on delete restrict` above, deliberately: deleting an object type out from
-- under its records would orphan them silently. Archiving the type is the
-- supported path and keeps every row.

-- Every list and count reads the live rows of one object.
create index if not exists custom_object_records_live_idx
  on public.custom_object_records (org_id, object_id, updated_at desc)
  where archived_at is null;
create index if not exists custom_object_records_archived_idx
  on public.custom_object_records (org_id, object_id, archived_at desc)
  where archived_at is not null;

-- ── Let custom fields hang off a custom object ────────────────────────────────
--
-- This is what makes the feature tractable rather than a second schema stack:
-- custom_field_definitions and custom_field_values already store tenant-defined
-- data, already validate it, and already have an editor. Their object_key was
-- pinned to the six by a CHECK; widening it to the same key grammar the six
-- satisfy lets a custom object reuse all of it unchanged.
--
-- The app still validates that an object_key names something real — a format
-- check cannot know which objects an org has defined. What it does guarantee is
-- that no key can be stored that would be unsafe in a URL or an export.
alter table public.custom_field_definitions
  drop constraint if exists custom_field_definitions_object_key_check;
alter table public.custom_field_definitions
  add constraint custom_field_definitions_object_key_check
  check (object_key ~ '^[a-z][a-z0-9_]{0,62}$');

alter table public.custom_field_values
  drop constraint if exists custom_field_values_object_key_check;
alter table public.custom_field_values
  add constraint custom_field_values_object_key_check
  check (object_key ~ '^[a-z][a-z0-9_]{0,62}$');

comment on table public.custom_objects is
  'Tenant-defined CRM object types. The six built-ins are not rows here — they are tables.';
comment on table public.custom_object_records is
  'Rows of a tenant-defined object type. Generic store: identity is title + custom field values.';
comment on column public.custom_object_records.archived_at is
  'Soft delete, same meaning as on the six: non-null = out of every list and count, restorable.';
