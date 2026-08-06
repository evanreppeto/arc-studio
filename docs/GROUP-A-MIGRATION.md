# Group A/B migration plan — finishing the workspace boundary

Last updated: 2026-08-04 (Waves 1 and 2 shipped — see Status)

BSR-637 decided the boundary and BSR-638 made it enforceable. **90 tables are
enforced today; 22 are still marked `pending`** in `supabase/tenancy-contract.mjs`
— that gap is the difference between the boundary being *decided* and being
*true*. It was 77/35 when this plan was written; Waves 1 and 2 closed 13.

Those counts cover the **write** side only. The read side has its own gap, and
locking a column does not close it — see BSR-729 at the end.

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

There were **eight** copies of the same org-only tenant builder, each taking a full
`{org_id, workspace_id}` and returning `org_id` alone: six private
`orgTenantFields()`, `campaignTenantFields` in `campaigns/create.ts`, and `withOrg`
in `arc/orchestrator.ts` — the last of which no filename-based search found,
because it was the one under a different name.

All eight are gone as of BSR-710/BSR-720, replaced by
`src/lib/tenancy/write-scope.ts` (`workspaceScopeFields` / `orgScopeFields`) and
`src/lib/tenancy/resolve-workspace.ts` for sites that carry only an `orgId`.
Waves 2-4 change one file, not eight.

The residual risk is not the helpers — it is an insert site nobody looked at. That
is what the automated audit below now covers.

### ⚠️ Amended 2026-08-03, after Wave 1 broke production

This section originally put the writer audit in **Phase B's** gate, and framed the
gap between phases as *time* — ship Phase A, let real traffic run, then check for
new NULLs. Wave 1 proved both halves of that wrong, and the amendment is the most
important thing in this document.

**What happened.** Wave 1 Phase A (BSR-710) updated "the writers" — meaning the six
files its ticket named. An exhaustive audit afterwards found **15 more insert sites
in 8 files**, including an *eighth* copy of the org-only helper (`withOrg` in
`arc/orchestrator.ts`) that no filename-based search would ever have found. One of
them had already broken production: `campaigns.workspace_id` went `NOT NULL` in
BSR-639, so `runArcPartnerCampaign` (`POST /api/v1/arc/runs`) could not create a
campaign for roughly four and a half hours. **No test could see it** — a mocked
insert cannot see a not-null constraint, so the whole suite stayed green.

**Two corrections:**

1. **Audit by TABLE, never by filename.** A ticket naming files is a starting
   point, not a scope. Enumerate every insert site into the affected tables.
2. **The time-based `new_nulls` gate is worthless on an idle prod.** It returns 0
   because nothing was written, not because the writers are right. Waiting buys
   nothing when there is no traffic; static enumeration is the real gate.

**This is now automated.** `src/lib/db/workspace-writers.test.ts` runs the audit in
the normal suite on **every PR**, keyed on a `hasColumn: true` marker in
`supabase/tenancy-contract.mjs`. Adding a `workspace_id` column in a Phase A? Add
`hasColumn: true` in the same PR, and the check starts enforcing that table's
writers immediately — the day the column lands, not the day the lock ships.

So the writer audit is now part of **Phase A's** definition of done, and it is a
build failure rather than a discipline. Phase B's gate is reduced to what it is
actually good for: confirming the backfill held and no NULL arrived from a path
nobody thought of.

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
`dispatch/persistence.ts`, `arc-api/{drafts,approvals}.ts` — **plus the eight more
files BSR-720 found by auditing the tables rather than the ticket's file list**.
This wave is where every copy of the org-only helper died.

**Do this wave first even though it has no deadline** — it is the one that proves
the two-phase pattern, and its 310 rows all derive correctly, so a mistake shows
up as a wrong-but-recoverable value rather than an arbitrary assignment.

### Wave 2 — agent + Arc work (5 tables, ~100 rows)

`agent_task_inputs`, `agent_task_events`, `agent_run_logs` ← `task_id → agent_tasks`
(which already carries `workspace_id NOT NULL`). Then `agents` and
`arc_generated_skills`, which have no FK and take the fallback.

Writers: `arc-api/tasks.ts`, `agent-operations/*`, `arc-chat/{enqueue,inbox}.ts`,
`arc/orchestrator.ts`, `campaigns/{queue,revisions}.ts`,
`competitor-intel/persistence.ts`, `auth/workspace-onboarding.ts`,
`exemplar-skills/persistence.ts` — **10 sites, 3 of which a by-table grep missed
because they read as selects.** Enumerate with the audit, not by eye.

~~The runner writes some of these over `/api/v1`, so Phase B must wait for a Cloud
Run deploy.~~ **Struck: verified false (see Status).** `apps/arc-runner` has no
database access at all; it calls our API and the insert runs on Vercel.

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
   plan did. Numbers in the PR body, not adjectives. Use `count(*)`, never
   `n_live_tup`.
2. **In Phase A, before merging** — add `hasColumn: true` to each migrated table in
   `supabase/tenancy-contract.mjs`. That switches on
   `src/lib/db/workspace-writers.test.ts` for those tables, which enumerates every
   insert site into them and fails on any that does not stamp a workspace.
   **This is the step that catches a missed writer**, and it is now a build
   failure rather than something to remember. Expect it to fail the first time —
   that is it doing its job, and it is far cheaper here than in production.
3. **Phase A merged** — confirm zero NULLs from the backfill on prod, and record
   the deploy timestamp. Only the **Vercel** deploy matters: every write to these
   tables happens in Next.js code, including the ones Arc triggers over `/api/v1`.
   Check row counts against the pre-migration numbers too — rows that arrive in
   the gap are written by the OLD code, and it is the backfill, not the new
   writers, that has to catch them.
4. **Between phases** — re-run the NULL check. Treat a clean result as weak
   evidence unless real traffic actually occurred: on an idle prod this returns 0
   because nothing was written. Step 2 is the gate that means something; this one
   only catches a path that step 2 could not see statically.
5. **Phase B merged** — `db:check-tenancy` must show the wave's tables moving from
   pending to enforced, and the `chain` job must stay green (it re-runs
   `rls-cross-tenant.sql`, which is what caught the seeded-membership gap in
   BSR-639).
6. **After Phase B** — verify on prod that the columns are `NOT NULL` and the
   policies exist, the way BSR-639 and BSR-653 were verified. Merged ≠ live.

## What I would not do

- **One big-bang PR.** 35 tables, six writer files, and RLS across the whole
  campaign surface. A single failure mode anywhere takes the lot.
- **`SET NOT NULL` in the same PR as the column.** The entire safety margin is the
  gap between them.
- **Trusting `n_live_tup` for row counts.** It is a planner estimate. It said
  `guardrail_findings` had 0 rows during BSR-653; it had 6.
- **Scoping a wave to the files a ticket names.** Wave 1 did, and missed 15 insert
  sites in 8 files — including an eighth copy of the org-only helper under a name
  nobody would have grepped for. Audit by table.
- **Trusting a green `new_nulls` check on an idle prod.** It means "nothing was
  written", not "the writers are right".
- **Assuming a writer is covered because the table looks unused.** `agents`,
  `arc_generated_skills` and `competitor_campaigns` all look dormant and all have
  live write paths.

## Rough shape

Four waves, each two PRs, plus a measurement pass at the head of each. Wave 1 is
the largest by writer-surface and the smallest by risk; Wave 3 is the largest by
rows and the smallest by code change. Nothing here is blocked on anything else,
and nothing here is urgent — see finding (1).

## Status

- **Wave 1 Phase A** — done (BSR-710), plus BSR-720 for the 15 insert sites it
  missed and the production break one of them had already caused.
- **The writer audit is automated** — `src/lib/db/workspace-writers.test.ts`,
  every PR, keyed on `hasColumn`. Currently enforcing **36 tables / 90 insert
  sites** (31/78 when Wave 1 landed).
- **Wave 1 Phase B** — done (BSR-711, PR #885), prod-verified 2026-08-04: 8/8
  `NOT NULL`, 32 workspace policies, 0 stale org policies, 228 rows / 0 nulls,
  and a read *as a real workspace member* returned rows (a schema query cannot
  tell you nobody was locked out).
- **Wave 2 Phase A** — done (BSR-712, PR #891), prod-verified 2026-08-04: 5
  columns live, nullable, indexed, FK'd, **0 NULLs across 103 rows**.
  Two things worth carrying forward:
  - The writer audit found **3 insert sites the by-table grep missed**
    (`upsertArcAgent`/`ensureArcAgentId` in three files — they read as selects).
    Wave 1's lesson held on its first re-test.
  - `agent_task_inputs` grew 83 → 85 between measurement and migration, and the
    backfill caught both. That is evidence the backfill handles the gap, **not**
    evidence the writers stamp — those rows predate the deploy. Still no
    post-deploy traffic, so the static audit remains the only real gate.
- **Wave 2 Phase B** — done (BSR-713, PR #898), prod-verified 2026-08-04: 5/5
  `NOT NULL`, 5 workspace-member policies, 0 stale org policies, 103 rows / 0
  nulls, and a read *as a real workspace member* returned 1 agent / 48 task
  inputs / 1 run log. Supabase's security advisors flag none of the five.

  Three things this wave established:
  - **RLS shape differs per wave.** These five carried ONE policy each (a SELECT
    for `authenticated`); writes reach them only through the service role. So the
    lock replaced the select and deliberately added no insert/update/delete
    policies — Wave 1's four-policy pattern would have *loosened* a closed
    surface. Read the existing policies before mirroring the previous wave.
  - ⚠️ **When verifying RLS "as a member", resolve the user id BEFORE
    `set role authenticated`.** The other order makes the lookup itself
    RLS-restricted, the jwt claim lands NULL, and every count reads 0 —
    indistinguishable from a total lockout. It produced a convincing false alarm
    on prod before the real check ran.
  - **A Wave 1 read-path gap surfaced.** `agent-operations/read-model.ts` held a
    *second, weaker* `applyOrgScope` beside the workspace-aware scoper, and four
    dashboard queries used it — three of them on tables Wave 1 had already
    locked. Wave 1's read-path change only reached `campaigns/read-model.ts`.
    Fixed by deleting the weak scoper rather than its call sites. **Two scopers
    in one file is the bug.**

  Still open, deliberately: `agents` is workspace-owned but unique on
  `(org_id, key)`. Equivalent today, wrong the day an org holds two workspaces;
  moving it means changing the constraint and ~16 call sites for no observable
  difference, so it belongs to whichever ticket builds multi-workspace-per-org.

  ⚠️ **"Phase B needs a Cloud Run runner deploy" was WRONG, and this plan said it
  twice.** Checked instead of assumed: `apps/arc-runner` has **no database access
  at all** — no Supabase client, no postgres driver, no such import; its only
  dependencies are the Agent SDK, Sentry, dotenv and zod. The runner reaches
  `agent_run_logs` by calling `POST /api/v1/arc/tasks/:id/log`, and the insert
  happens in `appendAgentRunLog` — **our Next.js code, on Vercel**. So a runner
  revision cannot write an unstamped row no matter how stale it is, and the
  runner's deploy cadence is irrelevant to every wave of this migration.

  The general lesson, which is the same one as the OAuth claim in
  `docs/` and the notes it came from: **a stated blocker gets verified before
  anything is sequenced around it.** This one would have parked Phase B behind an
  unrelated deploy nobody could check.
- **Waves 3-4** — not started (BSR-714 through BSR-717). **90 tables enforced,
  22 pending.**

One known gap is recorded in the audit test rather than hidden: three
`arc_messages` writes in `arc-chat/persistence.ts` do not stamp yet, tied to
Wave 4 / BSR-716. The test asserts they are *still* unstamped, so the entry
cannot outlive the fix.

## The other half of the boundary: reads (BSR-729)

Everything above is the **write** side — columns, backfills, NOT NULL, RLS. A
survey run during Wave 2 Phase B found **37 reads of workspace-owned tables that
filter `org_id` alone**, across all four waves' tables.

This matters more than it looks. **The service role bypasses RLS entirely**, so
for every server-side read the app-layer filter *is* the boundary — the policies
this plan installs do nothing there. Locking a column and narrowing its policy
does not make a read model workspace-safe.

Not a live leak today (one workspace per org, so both filters select the same
rows), and not fixable inside a lock migration — some sites need signature
changes across several call sites. Tracked as **BSR-729**, which is a hard
prerequisite for any multi-workspace-per-org feature, alongside this plan.

The finding also argues for how it should be closed: with a **check**, in the
shape of `workspace-writers.test.ts`. The write-side audit found 15 sites a
manual pass missed and 3 more on the next wave. A one-off read-side cleanup would
rot the same way.
