# Group A/B migration plan — finishing the workspace boundary

Last updated: 2026-08-03

BSR-637 decided the boundary and BSR-638 made it enforceable. 77 tables are
enforced today; **35 are still marked `pending`** in `supabase/tenancy-contract.mjs`,
which is the gap between the boundary being *decided* and being *true*.

This plan covers closing that gap. Companion docs:
[backend-workspace-data-boundary-audit.md](./backend-workspace-data-boundary-audit.md)
(the contract), [TENANCY.md](./TENANCY.md) (RLS pattern), [DATA-MIGRATION.md](./DATA-MIGRATION.md).

---

## Two findings that should change how this is scheduled

### 1. The backfill window is NOT closing. It is held open structurally.

Every prior note on this work — including mine — has said the backfill is
unambiguous "only while every org has exactly one workspace", implying a deadline.
That framing is wrong, and it was worth checking before planning around it.

`createWorkspaceForAuthenticatedUser` (`src/lib/auth/workspace-onboarding.ts`) is
the only path that creates a workspace row, and it calls
`createOrganizationUnique` **immediately before** `upsertDefaultWorkspace` — every
new workspace arrives with a brand-new org. There is exactly one call site
(line 476), and no other insert into `workspaces` anywhere in `src/` or `apps/`.

**So the product has no way to create a second workspace inside an existing org.**
`(select id from workspaces where org_id = t.org_id)` cannot become ambiguous no
matter how many customers sign up.

The window closes only if someone (a) builds a "add another workspace to this org"
feature, or (b) inserts one by hand. Both are deliberate acts, not drift.

**Consequence:** this work is *important* but not *urgent*, and it should be
sequenced for safety rather than speed. If a multi-workspace-per-org feature ever
gets planned, this becomes a hard prerequisite for it — worth noting on that
ticket when it appears.

### 2. Derivability is bimodal, and the fallback carries most of the rows

A `workspace_id` can be backfilled two ways: derived through a foreign key to a
table that already carries one (correct under *any* future topology), or taken
from the org's sole workspace (correct only under today's).

Measured against prod, not assumed:

| | tables | rows | backfill source |
| --- | --- | --- | --- |
| **Fully derivable** | 9 | 310 | FK → `campaigns` / `agent_tasks`, 100% coverage |
| **Fallback only** | 14 | ~1,630 | org's sole workspace — no FK path exists |
| **Mostly fallback** | 1 | 134 | `opportunities`: only **8 of 134** have a `campaign_id` |

The campaign/approval/agent spine derives perfectly. The Brain
(`knowledge_edges` 1078, `knowledge_nodes` 525), media, brand, vault and
opportunities have no parent to derive from at all.

That is not a blocker — finding (1) means the fallback is sound — but it decides
the ordering below: **derive where we can, so those tables are right permanently,
and treat the fallback set as a deliberate one-time assignment rather than a
derivation.**

---

## The actual risk is the write paths, not the backfill

The backfill is ~2,000 rows and provably resolvable. The thing that will break
production is a table gaining `NOT NULL workspace_id` while some insert site still
doesn't stamp it.

`orgTenantFields()` — **six identical copies** across `campaigns/{launch,decisions,
attach-media}`, `dispatch/persistence`, and `arc-api/{drafts,approvals}` — takes a
full `{org_id, workspace_id}` tenant and returns `org_id` **only**. BSR-639 fixed
the seventh (`campaigns/create.ts`) for the `campaigns` table alone.

Every one of those copies writes to tables in this migration. Miss one and the
insert starts failing in prod the moment `SET NOT NULL` lands.

### The technique that makes this safe: split every wave in two

**Phase A (additive, ships freely):** add the column *nullable*, backfill, index,
and update every writer to stamp it. Nothing can break — a missed writer produces
a NULL, not an error.

**Phase B (the lock, ships later):** verify prod shows zero NULLs and zero new
NULLs since Phase A, then `SET NOT NULL` + RLS + read-path filters.

The gap between A and B is the safety margin. A missed writer shows up as a
counted NULL in a query instead of a 500 for a customer. **Do not collapse the two
phases into one PR**, however small the table looks.

A one-line check makes Phase B a decision rather than a hope:

```sql
select count(*) filter (where workspace_id is null) as nulls,
       count(*) filter (where workspace_id is null and created_at > :phase_a_deployed_at) as new_nulls
from public.<table>;
```

`new_nulls > 0` means a writer is still missing. Do not proceed on that table.

---

## Sequencing

Four waves, ordered so the pattern is proven on the tables where a mistake is
cheapest and most visible.

### Wave 1 — campaign + approval surface (9 tables, 310 rows)

100% derivable, and where the `orgTenantFields` copies are concentrated. Order
matters *within* the wave, because each tier derives from the one above:

1. `campaign_assets` ← `campaigns.workspace_id`
2. `approval_items` ← `campaign_id`, else `campaign_asset_id`
3. `approval_decisions`, `approval_recommendations`, `agent_outputs` ← `approval_item_id`
4. `campaign_events`, `campaign_dispatches`, `campaign_results` ← `campaign_id` / `campaign_asset_id` / `approval_item_id`

Writers: `campaigns/{create,launch,decisions,attach-media}.ts`,
`dispatch/persistence.ts`, `arc-api/{drafts,approvals}.ts`. This wave is where
five of the six remaining `orgTenantFields` copies die.

**Do this wave first even though it has no deadline** — it is the one that proves
the two-phase pattern, and its 310 rows all derive correctly, so a mistake shows
up as a wrong-but-recoverable value rather than an arbitrary assignment.

### Wave 2 — agent + Arc work (5 tables, ~100 rows)

`agent_task_inputs`, `agent_task_events`, `agent_run_logs` ← `task_id → agent_tasks`
(which already carries `workspace_id NOT NULL`). Then `agents` and
`arc_generated_skills`, which have no FK and take the fallback.

Writers: `arc-api/tasks.ts`, `agent-operations/*`, the runner's callbacks.
⚠️ The **runner** writes some of these over `/api/v1` — its token already carries
`org_id` + `workspace_id` (`arcGuard`), so the scope is available, but the runner
deploys separately (Cloud Run, on merge). Phase B for this wave must wait for a
runner deploy, not just a Vercel one.

### Wave 3 — the fallback set (10 tables, ~1,630 rows)

`knowledge_nodes`, `knowledge_edges`, `vault_notes`, `business_profiles`,
`media_assets`, `media_folders`, `persona_snapshots`, `persona_knowledge_entries`,
`competitor_campaigns`, `opportunities`.

No derivation path; every row takes the org's sole workspace. Dominated by the
Brain (1,603 of the rows).

Two things specific to this wave:

- **`opportunities` is the honest exception.** 8 of 134 rows derive from a
  campaign; the other 126 are assigned. That is fine today (finding 1) but it is
  the table most likely to be wrong first if the org/workspace topology ever
  changes, so it deserves a comment in the migration saying so.
- **`business_profiles` is a close call already flagged** in the audit doc
  (creative brand identity vs. `workspaces.logo_url` chrome). Confirm the call
  still stands before moving it — it is cheap now and expensive later.

### Wave 4 — Group B: tighten what already exists (11 tables, ~250 rows)

No new columns. `arc_conversations`, `arc_messages`, `arc_projects`,
`arc_saved_items`, `audit_events`, `support_requests`, `ai_usage_events`,
`connector_usage_events`, `connector_spend_budgets`, `workspace_connectors`,
`workspace_media_config`.

Backfill the nullable column, then `SET NOT NULL`. Note `ai_usage_events` and
`connector_usage_events` have a nullable **`org_id`** too — tighten both.

⚠️ `ai_usage_events` is the metering table, and the meter is already known to
undercount. Do not let a tenancy change quietly drop rows: count before and after.

---

## Verification per wave

Every wave, in order:

1. **Before Phase A** — measure derivability on prod read-only, exactly as this
   plan did. Numbers in the PR body, not adjectives.
2. **Phase A merged** — confirm zero NULLs from the backfill, and record the
   deploy timestamp for the `new_nulls` check.
3. **Between phases** — re-run the NULL check after real traffic. This is the step
   that catches a missed writer, and it is the only reason the two phases exist.
4. **Phase B merged** — `db:check-tenancy` must show the wave's tables moving from
   pending to enforced, and the `chain` job must stay green (it re-runs
   `rls-cross-tenant.sql`, which is what caught the seeded-membership gap in
   BSR-639).
5. **After Phase B** — verify on prod that the columns are `NOT NULL` and the
   policies exist, the way BSR-639 and BSR-653 were verified. Merged ≠ live.

## What I would not do

- **One big-bang PR.** 35 tables, six writer files, and RLS across the whole
  campaign surface. A single failure mode anywhere takes the lot.
- **`SET NOT NULL` in the same PR as the column.** The entire safety margin is the
  gap between them.
- **Trusting `n_live_tup` for row counts.** It is a planner estimate. It said
  `guardrail_findings` had 0 rows during BSR-653; it had 6.
- **Assuming a writer is covered because the table looks unused.** `agents`,
  `arc_generated_skills` and `competitor_campaigns` all look dormant and all have
  live write paths.

## Rough shape

Four waves, each two PRs, plus a measurement pass at the head of each. Wave 1 is
the largest by writer-surface and the smallest by risk; Wave 3 is the largest by
rows and the smallest by code change. Nothing here is blocked on anything else,
and nothing here is urgent — see finding (1).
