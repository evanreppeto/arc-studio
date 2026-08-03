# Backend Workspace Data Boundary Audit

Last updated: 2026-07-05

## Product Boundary — DECIDED 2026-08-03 (BSR-637)

**An org owns the customer record. A workspace owns everything generated from it.**
Users own their identity, membership, role, and personal preferences.

This supersedes the previous statement here ("Arc should be scoped to a workspace
first… a workspace owns … CRM references"). That sentence was aspirational and was
never implemented: every CRM table has been `org_id`-only since the beginning, and
because nothing checked, the gap went unnoticed from 2026-07-05 to 2026-08-03. The
decision below is what the schema will be made to say.

### The rule

> If two workspaces in the same company could legitimately **disagree** about a
> row, the row is workspace-owned. If disagreeing would just mean one of them is
> wrong, it is org-owned.

Jane Smith's phone number is the same for every brand in the company — org-owned.
The campaign drafted for Jane, the asset generated for it, and what Arc learned
from how she responded are all brand-specific — workspace-owned. The scenario to
hold in mind is one company running two brands, or an agency running several
clients' marketing off one customer list.

### Category 1 — Org-owned (the customer record layer)

`org_id NOT NULL`, **no** `workspace_id`. Shared by every workspace in the org.

`companies`, `contacts`, `leads`, `jobs`, `properties`, `outcomes`, `crm_notes`,
`crm_tasks`, `crm_activities`, `custom_field_definitions`, `pipeline_stages`,
`personas`, `persona_definitions`, `journey_identities`, `engagement_events`,
`events`, `integrity_findings`, `routing_decisions`, `connections`,
`google_drive_connections`, `google_drive_sources`, `app_settings`,
`org_onboarding_state`, `org_plans`, `organization_memberships`

Already compliant. Nothing in this group moves.

### Category 2 — Workspace-owned (everything generated)

`org_id NOT NULL` **and** `workspace_id NOT NULL`. `org_id` stays so the existing
`is_org_member(org_id)` RLS predicate keeps working unchanged; `workspace_id` is
additive and narrows within it.

- **Campaign surface:** `campaigns`, `campaign_assets`, `campaign_events`,
  `campaign_dispatches`, `campaign_results`
- **Approval surface:** `approval_items`, `approval_decisions`,
  `approval_recommendations`, `agent_outputs`
- **Arc's memory and work:** `knowledge_nodes`, `knowledge_edges`, `vault_notes`,
  `arc_conversations`, `arc_messages`, `arc_projects`, `arc_saved_items`,
  `arc_instances`, `arc_generated_skills`, `agents`, `agent_tasks`,
  `agent_task_inputs`, `agent_task_events`, `agent_run_logs`, `agent_connections`,
  `agent_api_tokens`
- **Recommendations and intelligence:** `opportunities`, `next_best_actions`,
  `persona_snapshots`, `persona_knowledge_entries`, `competitor_campaigns`
- **Brand and creative:** `business_profiles`, `media_assets`, `media_folders`
- **Configuration, spend, audit:** `workspace_connectors`, `workspace_media_config`,
  `connector_spend_budgets`, `connector_usage_events`, `ai_usage_events`,
  `audit_events`, `support_requests`

### Category 3 — Inherits tenancy through its parent

No scoping column of its own; isolated by a `FOREIGN KEY` to a Category 1 or 2
row and reached only through it. Legitimate — the contract check must not demand
columns here.

`campaign_shares` / `campaign_audiences` → `campaigns`,
`arc_conversation_shares` → `arc_conversations`, `arc_project_shares` →
`arc_projects`, `agent_task_label_assignments` → `agent_tasks`

Condition of membership: the FK is **`NOT NULL`** and every read reaches the row
via its parent. A Category 3 table that acquires a direct read path has to be
reclassified into 1 or 2 first.

**That `NOT NULL` is load-bearing, and this list was wrong about it once.**
`guardrail_findings` and `partner_health_snapshots` were listed here on the
strength of merely *having* an FK to a scoped parent. The BSR-638 check rejected
both on its first run: every one of their parent FKs is nullable, so a row can be
inserted attached to nothing and belonging to no tenant — and `guardrail_findings`
is actively written by `src/lib/arc-api/draft-review.ts`. Both are now Categories 2
and 1 respectively, pending a scoping column of their own (BSR-653). "Has an FK to
a scoped parent" is not the test; "has a `NOT NULL` FK to a scoped parent" is.

### Category 4 — Platform, deliberately not tenant-scoped

`organizations`, `workspaces`, `profiles`, `waitlist_signups`, `platform_events`,
`weather_events` (a storm is a fact about the world, not about a tenant;
`weather_event_targets` is what maps one to a tenant), `integration_registry`

Listed explicitly so "no tenant column" is a decision on record rather than an
omission. Platform surfaces built on these gate on `ARC_PLATFORM_ADMIN_EMAILS`.

### Category 5 — Unclassified (dead or unwired)

~27 tables exist in prod with no tenancy column and no reference anywhere in
`src/` or `apps/` outside the generated `database.types.ts` — including
`nurture_sequences`, `nurture_enrollments`, `social_accounts`, `social_posts`,
`personalization_rules`, `tracking_links`, `analytics_snapshots`,
`score_weight_configs`, `ad_platform_actions`, `ad_spend_decisions`,
`agent_permissions`, `agent_tool_requests`, `competitor_apps`,
`competitor_features`, `partner_referral_tokens`, `partner_referral_submissions`,
`visitor_persona_contexts`, `rejected_intake_events`, `capacity_snapshots`,
`audits`, `software_research_notes`, `task_labels`, plus the
`status_backup_20260729_*` leftovers and the import scaffold
(`external_systems`, `external_object_mappings`, `sync_conflicts`).

**Rule: a Category 5 table cannot be wired until it has been classified into 1–4
and carries the matching columns.** This is the cheapest moment to enforce that —
they are all empty. Note `external_systems` / `external_object_mappings` are due
to be revived by BSR-640, so they get classified as part of that work (Category 2
— an import run belongs to the workspace that ran it).

### Flagged as close calls

Three landed on judgment rather than an obvious reading. Revisit if the first
multi-workspace customer disagrees:

1. **`media_assets` / `media_folders` → workspace.** Follows "library assets" in
   the original boundary statement and matches generated creative. But a photo of
   a finished job is company proof that every brand should be able to reuse, and
   the standing rule is to prefer approved real media. If reuse across workspaces
   becomes a real need, the answer is a shared-library flag on the asset, not
   moving the whole table back to org.
2. **`business_profiles` → workspace.** This is the creative brand identity that
   constrains generation, distinct from `workspaces.logo_url` which is UI chrome.
   Two brands, two profiles is the whole point of the multi-brand case.
3. **`guardrail_rules` → org.** Kept org-owned because guardrails encode
   compliance ("coverage-neutral language, never guarantee a claim outcome"),
   which is a company-level legal position rather than a brand choice. A workspace
   should be able to *add* rules, never subtract — if per-workspace additions are
   wanted, add a nullable `workspace_id` meaning "applies to this workspace only",
   with `NULL` meaning org-wide.

## Implemented Boundary

- `organizations`, `workspaces`, `workspace_memberships`, `arc_instances`, and
  `workspace_invites` exist as the product tenancy foundation.
- RLS is enabled on public tables and org-member read policies have been added
  for the current app-facing tables.
- App signup/login now provisions or joins workspaces.
- Settings exposes workspace invites and lets admins revoke unused invite codes.
- `/api/v1/arc/*` now has a central `arcGuard()` helper that resolves
  `ArcWorkspaceScope` for routes that need tenant context.
- DB-issued Arc API tokens preserve `org_id` and `workspace_id` through the API
  auth helper; legacy env-token mode is retained for local/back-compat routes.
- Arc brand context/profile and brain routes now pass the resolved org scope
  into their org-aware backend functions.
- `agent_tasks` now has an additive migration for `org_id` and UUID
  `workspace_id`, backfill logic, indexes, and workspace-member/admin RLS
  policies.
- Arc task list/detail/claim/log/complete/block routes now pass the resolved
  Arc workspace scope into task reads and mutations.
- Agent task creation, operator task-detail actions, and the agent operations
  read model now carry or enforce `org_id` + `workspace_id` on the
  service-role `agent_tasks` path.
- Agent Operations dashboard related reads now apply `org_id` filters to
  `approval_items`, `agent_outputs`, and `campaigns`.
- Campaign workspace list/detail reads now resolve the current org and pass
  `org_id` through the campaign, asset, approval, output, decision, and related
  CRM aggregation queries.
- Campaign creation/edit/decision/launch/dispatch write helpers now accept the
  active tenant context and stamp `org_id` onto new campaign, asset, approval,
  decision, dispatch, and campaign-event rows while applying `org_id` filters to
  service-role lookups and updates.
- Arc draft and approval-recommendation write routes now use `arcGuard()` and
  pass the resolved Arc workspace scope into persistence helpers so new
  `approval_items`, `agent_outputs`, and `approval_recommendations` rows carry
  `org_id`.
- Arc approval list/detail routes now use `arcGuard()` and pass the resolved
  org scope through approval item, recommendation, campaign, asset, CRM, and
  output reads.
- Arc approval recommendation read/write routes now use `arcGuard()` and pass
  the resolved org/workspace scope into recommendation helpers.
- Arc CRM list routes now use `arcGuard()` and pass the resolved org scope into
  company, contact, lead, job, property, and outcome reads.
- Arc CRM lead detail now passes the resolved org scope into the lead lookup.
- Arc CRM interaction writes now use `arcGuard()` and pass the resolved org
  scope into note, task, activity, and companion activity persistence.
- Arc campaign draft-asset writes now pass the resolved org/workspace scope into
  campaign shell creation, asset promotion, approval gates, events, and
  opportunity draft linking.
- Arc media reads now use DB-issued Arc token scope for `media_assets.org_id`
  filtering instead of falling back to the UI workspace context.
- Arc message inbox, claim, reclaim, reply-settle, and live-step writes now pass
  resolved org/workspace scope through `agent_tasks` queue helpers before
  reading or mutating pending Arc chat work.
- Arc partner campaign runs and social-ad ingest routes now use `arcGuard()`
  and pass the resolved token tenant into generator persistence so generated
  campaign, asset, approval, event, output, and task rows are org/workspace
  scoped.
- Arc competitor-intel ingest now uses `arcGuard()` and writes `org_id` to
  `competitor_campaigns`; migration `20260619124500_competitor_intel_org_scope.sql`
  adds the missing live-table boundary.
- Arc media generation and brand website analysis now use `arcGuard()`; generated
  media storage objects are partitioned under `arc-generated/{orgId}/{workspaceId}`.
- Arc performance slices now use `arcGuard()` and filter campaign results by the
  resolved Arc token `org_id`.
- `arcGuard()` now rejects malformed database-issued Arc tokens that are missing
  `org_id` or `workspace_id` instead of falling through to legacy env-token
  workspace resolution.
- Campaign results persistence is tenant-aware for scoped callers and applies
  `org_id` to lookup/update/insert paths.
- **DB-enforced isolation (first slice).** The CRM read-model
  (`src/lib/crm/read-model.ts`) now resolves reads through
  `resolveTenantReadHandle()` (`src/lib/supabase/tenant-client.ts`): in
  `supabase` auth mode with a live session it queries via the user's RLS-scoped
  client, so the *database* — not just the app filter — enforces org isolation.
  Open / operator / no-session paths degrade to the admin client with an
  explicit `org_id` filter, unchanged.
- Write-side RLS landed for the six CRM object tables (companies, contacts,
  properties, leads, jobs, outcomes) in
  `20260705120000_crm_object_write_policies.sql` — the first table group where a
  user-scoped client is isolated for INSERT/UPDATE/DELETE, not just SELECT.
- Slice 2 extends the same shape to the opportunities inbox:
  `20260705130000_opportunities_write_policies.sql` adds the write policies and
  `src/lib/opportunities/read-model.ts` now resolves reads through
  `resolveTenantReadHandle()`.
- Slice 3 adds write-side RLS across the campaign / approval surface
  (`20260705140000_campaign_surface_write_policies.sql`): campaigns, assets,
  approval items / decisions / recommendations, agent outputs, events, dispatches,
  results. The campaigns read-model reroute is deferred — it threads `org_id` from
  its callers, so that reroute lands at the call sites, not the read-model.
- Slice 4 completes write-side isolation for the wired human-editable surfaces
  (`20260706120000_human_surface_write_policies.sql`): the vault notebook
  (vault_notes), CRM interactions (crm_notes, crm_tasks, crm_activities), and the
  media library (media_assets, media_folders). Every wired human-editable surface
  is now write-isolated at the DB. System-owned / derived tables (guardrails,
  routing, integrity, persona intelligence) intentionally stay admin-write pending
  role-gating.
- Proof: `supabase/tests/rls_crm_isolation.sql` asserts cross-tenant read /
  insert / update / delete denial for `companies` (representative — every migrated
  table uses the same `is_org_member(org_id)` predicate);
  `src/lib/supabase/tenant-client.test.ts` covers the client selector. The
  pattern and rollout checklist live in [TENANCY.md](./TENANCY.md).

## Migration plan to reach the decided boundary

Nothing in Category 1 moves — the customer record layer is already org-owned and
correct. The work is entirely on Category 2.

**Size (prod, 2026-08-03): ~2,260 rows across 33 tables.** The whole migration is
smaller than a single mid-size CSV import, and it will never be smaller than it is
today.

### Group A — add `workspace_id` (24 tables, ~2,010 rows)

`approval_items` (42), `approval_decisions` (18), `approval_recommendations` (2),
`agent_outputs` (9), `campaign_assets` (47), `campaign_events` (76),
`campaign_dispatches` (9), `campaign_results` (0), `knowledge_nodes` (496),
`knowledge_edges` (1072), `vault_notes` (0), `arc_generated_skills` (0),
`agents` (8), `agent_task_inputs` (72), `agent_task_events` (0),
`agent_run_logs` (9), `opportunities` (134), `next_best_actions` (0),
`persona_snapshots` (0), `persona_knowledge_entries` (0),
`competitor_campaigns` (0), `business_profiles` (2), `media_assets` (3),
`media_folders` (10)

### Group B — tighten existing nullable columns (~250 rows)

`workspace_id` is present but nullable on `campaigns` (21), `arc_conversations`
(20), `arc_messages` (108), `arc_projects` (4), `arc_saved_items` (0),
`audit_events` (5), `ai_usage_events` (85), `connector_usage_events` (4),
`support_requests` (0). `org_id` is *also* nullable on `ai_usage_events`,
`connector_usage_events`, `connector_spend_budgets`, `workspace_connectors`, and
`workspace_media_config` — tighten both.

A nullable scoping column is the failure this whole ticket is about: it lets a
row exist that belongs to nobody, and `campaigns` proves the app then quietly
stops filtering on it.

### Sequence

1. **Add the columns nullable + index.** No behavior change, no downtime.
2. **Backfill.** Every org in prod has exactly one workspace, so the backfill is
   `workspace_id = (select id from workspaces w where w.org_id = t.org_id)` with
   no ambiguity to resolve and no data loss risk. **This is the step that expires:**
   the day any customer creates a second workspace, existing rows become rows
   nobody can place, and the backfill turns into a guess.
3. **`SET NOT NULL`,** once the backfill verifies zero nulls.
4. **Then the read paths and RLS.** Extend the `is_org_member(org_id)` policies
   with the workspace predicate per the rollout checklist in
   [TENANCY.md](./TENANCY.md), and add the workspace filter to the read models —
   `src/lib/campaigns/read-model.ts` first, since it is the one that already
   declares a column it does not filter on (BSR-639).

Steps 1–3 are additive and safe to ship ahead of step 4; a stamped-but-unfiltered
column changes nothing until the reads use it. Do **not** ship step 4 without the
CI contract check (BSR-638), or the next table to land will repeat the whole
thing.

### Standing rule — now enforced, not asserted

New tables declare their category before they ship. As of BSR-638 that is a build
failure rather than a convention:

- **`supabase/tenancy-contract.mjs`** is the machine-readable version of the five
  categories above. Every table appears in it.
- **`pnpm db:check-tenancy`** (`scripts/check-tenancy-contract.mjs`, run in the
  Migrations workflow after the RLS suite) holds the real schema to it: every
  public table must be classified, its category's columns must exist and be
  `NOT NULL`, an `inherits` table must really have a `NOT NULL` FK to its named
  parent, and anything tenant-scoped must have RLS on.
- **`src/lib/db/tenancy-contract.test.ts`** runs in the normal suite with no
  database: the contract is internally coherent, every table in the generated
  `database.types.ts` is classified, and no `unclassified` table is referenced
  anywhere in `src/` or `apps/` — that last one is what stops dead scaffold being
  revived without a category.

`pending` marks a table whose category is decided but whose migration hasn't
landed. It relaxes the column assertion and nothing else, and the check prints the
outstanding count on every run so the remaining Group A/B work stays visible
instead of quietly becoming permanent.

**Known limitation, stated rather than discovered later:** the Migrations workflow
is path-filtered and deliberately not a required check, so `db:check-tenancy` runs
only when `supabase/**` or its own scripts change. A new table always arrives with
a migration, so the case that matters is covered — but a PR that wires an existing
table without touching `supabase/` is caught by the vitest half alone.

A boundary that lives only in this document is exactly what produced the gap this
section fixes.

## Current Gaps

- The legacy campaign-results env-token ingest route cannot safely infer a
  workspace yet. It should be replaced by DB-issued workspace tokens or an
  explicit trusted integration scope before production multi-org usage.
- Local migration history and generated Supabase types need reconciliation for
  campaign-adjacent `org_id` columns such as `approval_recommendations` and any
  campaign tables that were patched live.
- Most service-role read models still bypass RLS. The CRM read-model is the
  first migrated onto the user-scoped client via `resolveTenantReadHandle()`
  (see [TENANCY.md](./TENANCY.md)); campaigns, opportunities, vault, personas,
  performance, and the agent-operations reads still need the same reroute, and
  their tables still need write-side policies.
- Legacy env-token Arc API mode is not workspace-specific. It should eventually
  be replaced by DB-issued workspace tokens only.

## Next Backend Slices

1. Verify the user-applied `20260618193000_agent_tasks_workspace_scope.sql`
   migration live: columns, indexes, policies, and no null task workspace
   backfill. Current Codex Supabase MCP access cannot query the project.
2. Cross-tenant isolation is now proven at the DB layer for CRM `companies`
   (`supabase/tests/rls_crm_isolation.sql`). Extend the same proof to tasks,
   approvals, brain nodes, campaigns, and media as each table group moves onto
   write-side RLS.
3. Decide whether `ping` and `health` should stay global diagnostics or require
   a resolved workspace scope like the data-bearing Arc routes.
4. In progress: `resolveTenantReadHandle()` is the shared authenticated-client
   boundary, and the CRM read-model now uses it. Roll it out to the remaining
   service-role UI read models per [TENANCY.md](./TENANCY.md).
