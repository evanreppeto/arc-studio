-- Per-tenant custom fields on the six CRM objects (Option B, BSR-489/BSR-493).
--
-- Every tenant needs to track something the six typed tables didn't anticipate.
-- Today that requires a developer to write a migration, which means it never
-- happens. This adds a field layer ON TOP of the typed tables rather than
-- replacing them with a generic JSONB record store (that is Option A, and it is
-- explicitly deferred until repeated tenant demand exists).
--
-- Named `custom_field_*` rather than the ticket's `field_definitions` /
-- `field_values`: this is a shared `public` schema with 60+ tables, and a table
-- called `field_values` reads like infrastructure rather than a CRM feature.
--
-- The type list and object list below are mirrored in src/domain/custom-fields.ts
-- (CUSTOM_FIELD_TYPES / CUSTOM_FIELD_OBJECT_KEYS) — keep them in sync.

create table if not exists public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  -- Which of the six typed CRM tables this field hangs off.
  object_key text not null,
  -- Stable machine key. Never changes after creation: custom_field_values rows
  -- reference the definition by id, but Arc and any export address it by key.
  key text not null,
  -- What the operator sees. Freely renameable — it is not an identifier.
  label text not null,
  field_type text not null,
  required boolean not null default false,
  -- Allowed choices for select/multi_select: [{value, label}]. Empty otherwise.
  options jsonb not null default '[]'::jsonb,
  help_text text,
  sort_order integer not null default 0,
  -- Soft delete. Archiving hides the field from every form and detail view but
  -- RETAINS its values, so archiving is never destructive and is reversible by
  -- setting active back to true.
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  archived_at timestamp with time zone,
  constraint custom_field_definitions_object_key_check
    check (object_key in ('companies', 'contacts', 'properties', 'leads', 'jobs', 'outcomes')),
  constraint custom_field_definitions_type_check
    check (field_type in ('text', 'number', 'date', 'select', 'multi_select', 'boolean', 'url', 'currency')),
  -- Machine key: lowercase, underscore-separated, starts with a letter. Keeps
  -- keys safe as object properties in exports and Arc's prompt context.
  constraint custom_field_definitions_key_format_check
    check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint custom_field_definitions_label_length_check
    check (char_length(btrim(label)) between 1 and 80),
  -- A select with no choices is a field nobody can fill in.
  constraint custom_field_definitions_options_check
    check (
      field_type not in ('select', 'multi_select')
      or jsonb_array_length(options) > 0
    )
);

-- Unique across ACTIVE AND ARCHIVED rows, deliberately. Re-adding a key that was
-- archived reactivates the original definition, which brings its retained values
-- back with it. The alternative (unique-where-active) would let a second
-- definition shadow the first and silently strand the old values.
create unique index if not exists custom_field_definitions_org_object_key_idx
  on public.custom_field_definitions (org_id, object_key, key);

create index if not exists custom_field_definitions_object_idx
  on public.custom_field_definitions (org_id, object_key, sort_order)
  where active;

create table if not exists public.custom_field_values (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  field_id uuid not null references public.custom_field_definitions(id) on delete cascade,
  -- Denormalized from the definition so the two hot-path indexes below can be
  -- satisfied without a join.
  object_key text not null,
  -- Polymorphic: points at a row in one of the six typed tables. There is
  -- deliberately NO foreign key — six nullable FK columns would be worse. The
  -- consequence is that deleting a CRM record leaves its custom values orphaned;
  -- they are unreachable (every read starts from a record) but not reclaimed.
  record_id uuid not null,
  -- The value, typed by the definition's field_type. Scalars are stored as JSON
  -- scalars; multi_select stores a JSON array. NULL means "not filled in".
  value jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint custom_field_values_object_key_check
    check (object_key in ('companies', 'contacts', 'properties', 'leads', 'jobs', 'outcomes'))
);

-- One value per field per record.
create unique index if not exists custom_field_values_record_field_idx
  on public.custom_field_values (org_id, record_id, field_id);

-- Hot path 1 — render a record: every custom value for one record.
create index if not exists custom_field_values_record_idx
  on public.custom_field_values (org_id, object_key, record_id);

-- Hot path 2 — filter a list by a custom field. `value #>> '{}'` extracts a JSON
-- scalar as text, which is what an equality/prefix filter compares against.
create index if not exists custom_field_values_field_scalar_idx
  on public.custom_field_values (org_id, field_id, (value #>> '{}'));

-- Hot path 3 — multi_select filtering, where value is an array and the filter is
-- a containment test rather than an equality test.
create index if not exists custom_field_values_value_gin_idx
  on public.custom_field_values using gin (value jsonb_path_ops);

alter table public.custom_field_definitions enable row level security;
alter table public.custom_field_values enable row level security;

create policy custom_field_definitions_org_member_select on public.custom_field_definitions
  as permissive for select to authenticated
  using ((select app_private.is_org_member(custom_field_definitions.org_id)));

create policy custom_field_values_org_member_select on public.custom_field_values
  as permissive for select to authenticated
  using ((select app_private.is_org_member(custom_field_values.org_id)));

grant select, insert, update, delete on public.custom_field_definitions to service_role;
grant select, insert, update, delete on public.custom_field_values to service_role;

comment on table public.custom_field_definitions is
  'Per-org, per-CRM-object custom field definitions. Archiving (active=false) retains values.';
comment on table public.custom_field_values is
  'Values for custom_field_definitions, keyed by (org, record, field). record_id is polymorphic across the six CRM tables and intentionally carries no FK.';
