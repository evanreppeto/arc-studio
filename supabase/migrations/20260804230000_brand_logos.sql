-- supabase/migrations/20260804230000_brand_logos.sql
--
-- A workspace's logo SET, replacing the single `business_profiles.logo_url`.
--
-- Why this is a correctness fix and not a convenience feature: the creative
-- templates draw the logo on a charcoal scrim (`templateBold` and friends), and
-- the brand kit could hold exactly one image. A workspace whose logo is
-- dark-on-transparent — the common case for a print-first small business — has
-- been rendering an INVISIBLE mark on every ad Arc generates. Nothing in the
-- approval flow surfaces that: the operator sees a composed image and has no
-- reason to suspect the logo is present but unreadable.
--
-- Five named roles rather than free-form tags, because the renderer has to
-- branch on them (`pickLogoForBackground`), and a role a tenant invented is a
-- role the renderer cannot reason about. Object and stage vocabularies are
-- tenant-configurable in this product; this one is app machinery, which puts it
-- on the "never per-org" side of the rule in src/domain/pipeline-stages.ts.
--
-- Text + CHECK rather than a Postgres enum, matching `opportunities
-- .dismissed_reason` and `approval_items.risk_level`: adding a sixth role
-- should be a one-line edit, not a type alteration. The vocabulary is mirrored
-- in src/domain/brand-logos.ts and a test pins the two lists against each other
-- so they cannot drift silently.
--
-- Scoped exactly like `business_profiles`, whose variants these are: org_id NOT
-- NULL plus a nullable workspace_id, registered in supabase/tenancy-contract.mjs
-- as `{ category: "workspace", pending: GROUP_A, hasColumn: true }`.
--
-- It carries workspace_id from birth rather than waiting for a later wave.
-- Wave 3 Phase A (20260804220000) gave business_profiles, media_assets and
-- media_folders that column; a new sibling of those tables landing without one
-- would be the single brand table left out of the wave, needing a second
-- migration later and leaving a writer-audit gap in between —
-- src/lib/db/workspace-writers.test.ts keys on `hasColumn`, so from this
-- migration on every insert site must stamp it.
--
-- ORDERED AFTER Wave 3 deliberately. The backfill below derives workspace_id
-- from business_profiles, and that column does not exist until 20260804220000
-- has run. This file was originally timestamped 21:00, which would have placed
-- it before the column it reads.
--
-- ADDITIVE AND REVERSIBLE. `business_profiles.logo_url` is deliberately left in
-- place and kept in sync with the primary role by the application
-- (`setWorkspaceLogo`), because it has consumers well outside the brand screen:
-- the nav rail, the workspace switcher, `toBrandTokens`, and the Arc
-- brand-profile API. Dropping it here would break all of them at once for a
-- benefit — one fewer column — that nobody asked for. It stops being the
-- source of truth; it does not stop existing.
--
-- Backfill: every existing profile with a logo gets that image as its `primary`
-- role, so no workspace loses its logo and the rail keeps rendering exactly what
-- it rendered before. Idempotent via ON CONFLICT DO NOTHING, so a re-run cannot
-- duplicate or overwrite a role an operator has since set by hand.

create table if not exists public.brand_logos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- Nullable and un-locked, matching business_profiles after Wave 3 Phase A.
  -- Phase B narrows both together.
  workspace_id uuid references public.workspaces(id) on delete cascade,
  role text not null,
  url text not null,
  file_name text,
  -- Provenance when the image came from an operator upload rather than a URL
  -- import. Nullable and ON DELETE SET NULL: losing the library row must not
  -- take the brand's logo with it.
  media_asset_id uuid references public.media_assets(id) on delete set null,
  uploaded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_logos_role_check check (
    role in ('primary', 'mark', 'wordmark', 'on_light', 'on_dark')
  ),
  constraint brand_logos_url_not_blank check (btrim(url) <> '')
);

-- One image per role per org: uploading a new "on dark" replaces the old one
-- rather than silently stacking a second row the renderer would pick between at
-- random. The application upserts on this constraint.
create unique index if not exists brand_logos_org_role_key
  on public.brand_logos (org_id, role);

create index if not exists brand_logos_org_id_idx
  on public.brand_logos (org_id);

-- RLS. Omitting this is what `pnpm db:check-rls` caught on the first run of this
-- migration: a table carrying org_id with row level security DISABLED is
-- readable across tenants by any role that can reach it, and nothing in the
-- application layer would have shown it — every read here goes through the
-- service-role client, which bypasses RLS entirely. The guard is the only thing
-- between that mistake and production.
--
-- Same shape as pipeline_stages and the rest of the org-scoped tables: members
-- of the org may read, and only service_role writes, because every write path
-- runs through an operator-gated server action.
alter table public.brand_logos enable row level security;

create policy brand_logos_org_member_select on public.brand_logos
  as permissive for select to authenticated
  using ((select app_private.is_org_member(brand_logos.org_id)));

grant select, insert, update, delete on public.brand_logos to service_role;

comment on table public.brand_logos is
  'Named logo variants per org. Read by pickLogoForBackground so generated creative uses a mark that is actually visible on the background it lands on. business_profiles.logo_url mirrors the primary role for the nav rail and other single-image consumers.';

-- Backfill the existing single logo as each org's primary, deriving workspace_id
-- from the profile it came from. A derived value stays correct under any future
-- org/workspace topology, which an assigned one does not — the same reasoning
-- Wave 3 applies to its own tiers.
insert into public.brand_logos (org_id, workspace_id, role, url, uploaded_by)
select bp.org_id, bp.workspace_id, 'primary', btrim(bp.logo_url), 'migration:20260804230000'
from public.business_profiles bp
where bp.logo_url is not null
  and btrim(bp.logo_url) <> ''
on conflict (org_id, role) do nothing;

create index if not exists brand_logos_workspace_id_idx
  on public.brand_logos (workspace_id);
