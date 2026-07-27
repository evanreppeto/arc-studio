-- supabase/migrations/20260727210000_workspace_identity.sql
--
-- Per-workspace display identity for the rail's workspace block.
--
-- Until now the rail rendered a *derived* identity: the bold line was
-- workspaces.name, the grey line under it was organizations.name — and the only
-- writer (renameWorkspace) set both rows to the same string, so the two lines
-- were always duplicates of each other. The `● BIG workspace` pill below them
-- was worse: `orgName.split(/\s+/)[0] + " workspace"`, computed in the component
-- with no way to override it. And every workspace in the switcher menu wore the
-- same org-wide accent, so a menu of five workspaces was five identical dots.
--
-- These four columns give a workspace its own display identity, independent of
-- the organization it belongs to. All four are NULLABLE and every consumer falls
-- back to exactly today's derivation when they are NULL — an existing workspace
-- looks pixel-identical after this migration until someone edits it.
--
-- Note organizations.branding (jsonb, present since the baseline) is NOT used
-- for this. It is org-scoped, and the whole point here is that two workspaces
-- under one organization can look different from each other.

alter table public.workspaces
  -- The grey line under the workspace name. NULL = show the organization name,
  -- which is what the rail has always shown.
  add column if not exists subtitle text,
  -- The short label in the rail's status pill. NULL = the legacy derivation
  -- (first word of the organization name + " workspace").
  add column if not exists short_label text,
  -- One of the named accent keys from globals.css (gold/blue/red/steel/emerald),
  -- tinting this workspace's monogram + dot only. NULL = inherit the org-wide
  -- appearance accent, which is what every workspace does today.
  add column if not exists accent_key text,
  -- Per-workspace logo. Distinct from business_profiles.logo_url, which is
  -- org-scoped and is also what gets stamped on generated creative — a
  -- workspace-level logo is chrome, not brand, and never reaches outbound.
  add column if not exists logo_url text;

-- Guard the accent at the schema level so a bad write can't leak an arbitrary
-- string into a CSS custom property in the rail.
alter table public.workspaces
  drop constraint if exists workspaces_accent_key_check;
alter table public.workspaces
  add constraint workspaces_accent_key_check
  check (accent_key is null or accent_key in ('gold', 'blue', 'red', 'steel', 'emerald'));

comment on column public.workspaces.subtitle is
  'Grey line under the workspace name in the rail. NULL = fall back to organizations.name.';
comment on column public.workspaces.short_label is
  'Short label for the rail status pill. NULL = derived from the organization name.';
comment on column public.workspaces.accent_key is
  'Named accent (globals.css html[data-accent]) for this workspace''s monogram/dot. NULL = inherit the org accent.';
comment on column public.workspaces.logo_url is
  'Workspace-level logo shown in the rail and switcher. App chrome only — creative uses business_profiles.logo_url.';
