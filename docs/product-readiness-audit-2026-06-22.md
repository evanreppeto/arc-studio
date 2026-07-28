# Product Readiness Audit — 2026-06-22

> **Status (fixed in branch `fix/multi-tenant-readiness`):** P0-1 (all four leaks),
> P0-2 (per-user attribution), P1-1 (stale test), and P2-1 (unsafe cast) are **done
> and verified** (tsc clean, full test suite green incl. 12 new tests, eslint clean).
> **Correction:** `agent_tasks` already has `org_id`/`workspace_id` (migration
> `20260618193000`), so the Arc-runs fixes needed **no migration** — they now use the
> existing `applyTaskScope`/`getCurrentAgentTaskTenantFields` helpers.
> **Newly found:** `vault_notes` has no `org_id` at all, so the vault @-mention source
> leaks across orgs — same class as P0-1 but needs a schema migration (see P1-3).
> **Remaining:** P1-2 (empty/error-state consistency) and P2-2 (scaffold labeling) —
> UX passes deferred for deliberate design decisions.

Pre–team-handoff audit. Goal: what to fix before multiple people share the app.

**Baseline health (verified this run):**

- `pnpm test` → **1335 pass / 1 fail** (the one failure is a stale test, not a regression — see P1-1).
- `npx tsc --noEmit` → **clean** (exit 0).
- Wired features (Vault, Campaigns, CRM interactions, auth) are functionally solid: approval-safety gates hold, no missing `await`s, no RSC function-prop violations.

**The theme:** the foundation is good. The gaps are **multi-tenant correctness** and **team accountability** — the things that don't show up when one person uses the app but bite immediately when a team does. The app uses the Supabase *service-role* client everywhere, which **bypasses RLS**, so **app-layer org scoping is the only tenant boundary that exists**. Any query that skips it leaks across workspaces.

Each finding below is cited to `file:line` and was confirmed by reading the code (not inferred).

---

## 🔴 P0 — Block the team handoff

### P0-1. Four queries leak data across workspaces

All four read tenant data without an org filter. Their sibling functions in the same files *do* scope correctly (e.g. `getCampaignWorkspaceList` uses `applyOrgScope`, `listApprovalCards` uses `filter.orgId`), so these are oversights, not design.

| # | Query | Location | Symptom for a teammate |
|---|---|---|---|
| a | `listCampaignNames()` | `src/lib/campaigns/read-model.ts:429` | Arc @-mention autocomplete lists **every org's** campaign names |
| b | `countActiveApprovals()` | `src/lib/approvals/read-model.ts:199` | Approval badge counts **all orgs**; the queue page shows only theirs → the two numbers disagree |
| c | `listActiveArcRunConversationIds()` | `src/lib/arc-chat/persistence.ts:284` | "Arc is working…" sidebar reflects **other orgs' / other operators'** runs |
| d | `listRecentArcRuns()` | `src/lib/arc-chat/persistence.ts:345` | Runs drawer shows **other orgs' / other operators'** task history |

**Fix (a) and (b):** small — add `applyOrgScope(query, orgId)` and thread `orgId` from the call sites (`src/app/arc/page.tsx:86,89`), mirroring the already-correct siblings. Add a unit test that asserts the org filter is applied.

**Fix (c) and (d):** deeper. `arc_conversations`, `arc_messages`, and `agent_tasks` have **no `org_id` column at all** (`supabase/migrations/20260608120000_arc_chat.sql` — scoped only by an `operator` text string; `agent_tasks` has neither org nor workspace). Requires a migration to add `org_id` (+ backfill from the operator/workspace mapping), then scope these two queries. Until then, even filtering by `operator` would stop *cross-operator* visibility within a shared workspace, which is the more imminent risk for a team.

### P0-2. No per-user audit attribution

Real per-user auth exists (Supabase mode + `workspace_memberships`, see `requireOperator()` at `src/lib/auth/operator.ts:25`). But `getOperatorActor()` (`src/lib/auth/operator.ts:70`) returns the single configured operator email **regardless of who is signed in**. Every note, task, and approval decision is therefore stamped with one identity.

**Why it matters:** for an approval-gated marketing tool, you cannot tell who approved, declined, or created what. That defeats the point of the human-approval audit trail once more than one person uses it.

**Fix:** in Supabase auth mode, resolve the actor from the session user (`supabase.auth.getUser()` → display name/email) instead of the static configured credential. The comment at `operator.ts:67` already flags this as the intended swap.

---

### P1-3. `vault_notes` not org-scoped — FIXED (migration must be applied to prod by hand)

> **Resolved.** Prod probe (2026-06-22) confirmed `vault_notes` has no `org_id`.
> Added migration `20260622170000_vault_notes_org_scope.sql` (adds `org_id` +
> backfill to the default org, swaps `unique(slug)` → `unique(org_id, slug)`, adds
> the org-member RLS policy) and org-scoped all 5 persistence fns + the read-model,
> vault actions, the @-mention catalog, and the needs-review badge. 5 new tests;
> suite green. **Action required: apply the migration to prod manually** (prod
> migrations aren't auto-applied — see deploy notes). Still open: `agent_outputs`
> is queried unscoped in `live-signals.ts` and also lacks `org_id` in prod — its
> own small follow-up.

<details><summary>Original finding (for context)</summary>

`listVaultNotes` (`src/lib/vault/persistence.ts`) reads all `vault_notes` with no org
filter, and **no migration ever adds an `org_id` column** to `vault_notes`. It surfaces
in the Arc @-mention catalog, so vault notes leak across orgs.

**But the fix is blocked by a deeper discovery.** Migration
`20260618185612_org_member_read_policies.sql` creates `for select using
(app_private.is_org_member(org_id))` RLS policies on ~40 tables **including
`vault_notes`, `arc_conversations`, and `arc_messages`** — none of which have an
`org_id` column anywhere in the migration history. A clean `supabase db push` of the
migration set would therefore **error** at that file. This means one of:

1. Prod has significant **out-of-band schema drift** (those `org_id` columns were added
   directly, not via a committed migration), or
2. That RLS migration never applied cleanly to prod and those tables are **not** actually
   protected by org RLS.

I **cannot tell which** — the Supabase MCP only sees the unrelated `askvisible` project,
not prod (`qqbecyrhnowmooyjiztz`), and the generated `database.types.ts` is stale (it
doesn't even list `vault_notes`). Adding app-layer `.eq("org_id", …)` to vault, or
shipping another `org_id` migration, without knowing the real column state risks either
breaking the live vault feature (if the column is absent) or duplicating work.

**To unblock:** run this against prod (Supabase SQL editor or psql) and share the result:

```sql
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and column_name = 'org_id'
  and table_name in ('vault_notes', 'arc_conversations', 'arc_messages', 'agent_outputs');
```

Then the vault fix is: add `org_id` (if truly absent) + backfill, swap `unique(slug)` →
`unique(org_id, slug)`, set the upsert `onConflict` to `org_id,slug`, and pass `orgId`
through the 5 persistence fns + 3 actions + 2 read-model wrappers. The campaign-name leak
in the same @-mention catalog **is** already fixed.

> Note: the committed P0-1 fixes are unaffected — `agent_tasks`, `campaigns`, and
> `approval_items` have `org_id` via self-consistent migrations (with backfills), so
> scoping them is sound regardless of the drift question above.

</details>

### P1-4. Repo migrations are not a buildable source of truth (drift)

The probe above (0 rows) confirms prod lacks `org_id` on `vault_notes`,
`arc_conversations`, `arc_messages`, and `agent_outputs`, yet
`20260618185612_org_member_read_policies.sql` (on `main`) creates
`is_org_member(org_id)` RLS policies on all of them. So a clean `supabase db push`
from `main` **errors partway** — a new teammate cannot stand up a working DB from
the repo. This is a bigger onboarding blocker than any single leak. Fix is a
reconciliation pass so `main`'s migrations build a prod-shaped schema (the
structural-drift reconciliation currently stranded in an unmerged branch).

## 🟡 P1 — Fix soon (rough edges a teammate will hit)

### P1-1. Stale failing test
`src/app/_data/__tests__/growth-engine.test.ts:24` expects nav `["Arc","Campaigns","Gallery","Opportunities"]` but the array now also includes `"Usage"`. One-line fix. A red suite reads as "broken" to anyone new.

### P1-2. Inconsistent empty/error states
Pages disagree on how they handle Supabase being unavailable:
- `src/app/crm/page.tsx:52` and `src/app/partners/page.tsx:19` show an "unavailable" warning.
- `src/app/approvals/page.tsx:66` and `src/app/arc/page.tsx:73` silently degrade to empty.

A teammate can't distinguish "empty workspace" from "database is down." Standardize on one pattern (a small shared "data unavailable" banner vs. a true empty state).

---

## 🟢 P2 — Polish

### P2-1. Unsafe `entityType` cast on error paths
`src/app/crm/interactions-actions.ts:63` (also `:92`, `:137`, and pre-validation `:107`, `:152`) casts the raw, unvalidated `entityType` and uses it to build a redirect. On invalid input this yields `/crm/undefined/<id>`. Low impact (only on malformed/tampered submissions), but trivially fixed by redirecting to a safe fallback when `parsed.ok` is false. Defense-in-depth: make `applyOrgScope` throw when `orgId` is missing in production, so a future unscoped call site fails loudly instead of leaking.

### P2-2. Scaffold pages that look functional
Several nav pages render but write no data (per `CLAUDE.md`, most non-wired `src/lib/<feature>/` dirs feed scaffold pages). A teammate expecting them to work will be confused. Either label them "Preview" in-UI or hide from nav until wired. (Audit which pages once prioritized.)

---

## Suggested order of work

1. **P0-1 a+b** — 2 small scoped queries + tests (hours).
2. **P1-1** — fix the stale test (minutes).
3. **P0-2** — per-user attribution in Supabase auth mode (small–medium).
4. **P1-2** — standardize empty/error states (small, mostly UI).
5. **P0-1 c+d** — migration to add `org_id` to arc tables + agent_tasks, backfill, then scope the two Arc-runs queries (medium; needs prod migration per the manual-migration process).
6. **P2** items — opportunistic.

## Note on this branch
`feat/invite-welcome-screen`'s invite-welcome work already shipped to `main` as PR #185. This branch is likely redundant — confirm before continuing work on it.
