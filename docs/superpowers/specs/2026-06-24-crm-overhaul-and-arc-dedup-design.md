# CRM Overhaul + Arc Dedup — Design

**Date:** 2026-06-24
**Status:** Approved (design), pending implementation plan
**Author:** Arc / Evan

## Problem

The CRM is over-built and Arc pollutes it with duplicates. Three concrete complaints, all confirmed in code:

1. **"I have to press Open to open the thing."** A single row click doesn't open the record — it only selects it into a right-hand preview sidebar. To actually open a record you must double-click the row or click a small trailing `→` button (and there's *another* "Open" button in the preview panel). Four open affordances, none of them the obvious one. (`src/app/crm/_components/crm-object-table.tsx:80`, `:150`)
2. **"Too much going on."** List rows render 7–9 data points each; the view selector appears twice (a dropdown *and* a tab row); the record detail page stacks ~13 modules (header band + 6 quick-stats + 7 main sections + 6-panel intelligence rail) with status pills repeated in three places. (`src/app/crm/_components/crm-record-page.tsx:145`, `crm-record-detail.tsx:56`)
3. **"It's creating duplicate records."** Real backend bug:
   - `create_lead` **always inserts a new lead** — zero lead-level dedup. (`src/lib/lead-ingestion/persistence.ts:102`)
   - **Properties never dedup** — same address inserts a new row every call.
   - Company dedup only fires when name *and* postal code *and* an existing property all align (fragile); contact dedup needs an email present. (`src/lib/arc/record-writes.ts:170`, `:189`)
   - Notes/tasks have **no idempotency** — Arc writing the same note twice creates two rows. (`src/lib/interactions/persistence.ts:62`)
   - **No unique constraints** in the DB backstop any of it. (`supabase/migrations/20260527131500_initial_growth_engine_schema.sql`)

## Goal

A calm, professional CRM that reads like a real CRM (Attio/HubSpot-grade restraint), where a row click opens a record, the record shows essentials first and hides the intelligence machinery behind tabs, and Arc reliably **updates** existing records instead of spawning duplicates. Fully approval-safe — no outbound behavior changes; Arc still only drafts/records internal data.

Scope, in order: **Phase 1 record view → Phase 2 list view → Phase 3 Arc dedup.** Each phase is independently shippable.

## Design principle

**Progressive disclosure.** The default surface shows only what a human needs to understand and act on a record. Everything analytical is reorganized — not deleted — behind a deliberate click. Follow `DESIGN.md` (calm canvas, hairlines not card-soup, accent sparingly, no eyebrow kickers, sentence case) and reuse `page-header.tsx` primitives (`PageHeader`, `Panel`, `StatusPill`, `EmptyState`).

---

## Phase 1 — Individual record view

**File(s):** `src/app/crm/_components/crm-record-page.tsx`, `crm-record-detail.tsx`, `record-interactions/`.

### Slim header (replaces the ~300px header band + `RecordQuickStats`)
- Initials avatar · name · one-line subtitle (object type · location/role).
- **One** status pill (lifecycle). Persona/urgency move into Overview details or the Intelligence tab — no more 4-pill cluster.
- Score shown as a small `82/100` with a "Lead score" caption — not the large `ScoreDial` box.
- A contact-channel line (email · phone · website) and **one** primary action button (`Log activity`). The "Added by Arc" provenance pill is retained (small) per the existing provenance work.
- The "Internal CRM record. No outreach…" disclaimer shrinks to a quiet single-line footer.

### Four tabs (replaces the 13 stacked modules)
URL-driven via `?tab=` so each tab stays server-rendered, shareable, and matches the app's existing `searchParams` convention. Default tab = `overview`.

- **Overview** (`?tab=overview`, default): two columns.
  - `Details` — the ≈6–10 core stored fields as a clean key/value list (Stage, Persona, Service need, Owner, Source, Created + a few type-specific). The full field dump is *not* shown here.
  - `Recent activity` — a single next-best-action line + the last 3–5 timeline entries.
- **Activity** (`?tab=activity`): full `RecordTimeline` + `NotesPanel` + `TasksPanel`. The create-note / create-task forms live here (moved off Overview).
- **Intelligence** (`?tab=intelligence`): `PersonaIntelligence` (persona fields, score bars, attention reason, recommended CTA, message angle, proof points), `EngagementSummary`, `EvidenceSection`, `RelationshipGraph`, `DataQuality`. Everything heavy, opt-in.
- **Related** (`?tab=related`): `ConnectedRecords` + `LinkedCampaignsPanel`.

### Notes
- Tabs render as `<Link href="?tab=...">`; the active tab reads `searchParams.tab`. Unknown/absent → `overview`. This composes with the existing `?action=` scaffold params (a record can be `?tab=activity&action=edit`).
- No module is deleted — every current panel maps to exactly one tab (mapping above). This keeps all data and the provenance/locked semantics intact.
- The `StoredFields` three-bucket split (prose/scalar/wide) is simplified: Overview shows the curated core set; the exhaustive list (if still wanted) sits at the bottom of Intelligence under a "All stored fields" disclosure.

---

## Phase 2 — List view

**File(s):** `src/app/crm/_components/crm-object-page.tsx`, `crm-object-table.tsx`.

- **Row click opens the record** (navigate to `row.href`). Remove the single-click-selects / double-click-opens split and the trailing `→` "Open" column. Keyboard: row is a focusable link (Enter opens).
- **Delete the right-hand preview sidebar** (`crm-object-page.tsx:167`) entirely — it's a mini record page duplicating the real one. Removing it reclaims width and eliminates a whole interaction model and its duplicate quick-action buttons. The page becomes a single full-width table.
- **5 columns max**: Name (+ subtext) · Status · Persona · Score · Updated. The `Next action`, second timestamp, and `Value`/`Links` columns come off the default table (the data still lives on the record page).
- **One view selector**: keep the segmented `All records / Recently updated / Needs attention` tabs; **remove the duplicate `SignalSelect` dropdown** from the filter bar (`crm-object-table.tsx:198`). Keep search, persona filter, and rows-per-page.
- `?selected=` URL state and `selectRecord` logic are removed along with the sidebar.

---

## Phase 3 — Arc dedup (the real bug)

Two complementary layers: **read-before-write at the source** and a **persistence-layer find-or-create with DB backstops**.

### A. Find-or-create leads (`src/lib/lead-ingestion/persistence.ts`, `src/lib/arc/record-writes.ts`)
- Add an **opt-in `dedupeLead` option** to the persistence path. Arc's path sets it; the public `POST /api/v1/leads/ingest` path does **not** (preserves its frozen `201/202/400/502` contract — see Constraints).
- When enabled: before inserting a lead, match an existing **active** lead for the same `(org_id, company_id, contact_id)` — or by `(org_id, source, external_lead_id)` when present. On match, **update** the lead (refresh fields/score, append a timeline entry) and return `{ created: false, leadId }` instead of inserting.
- `POST /api/v1/arc/crm/leads` returns `201` on create, `200` on match/update (matching the route's documented contract spirit).

### B. Property dedup (currently none)
- Before inserting a property, match `(org_id, normalized address_line1, postal_code)`; reuse the match. Normalize address (trim, lowercase, collapse whitespace) in `src/domain/` so it's pure + unit-testable.

### C. Harden company/contact matching (`src/lib/arc/record-writes.ts`)
- Company: also match on **website domain** (normalized host) within org, not only name+postal+existing-property. Fall back to name-within-org when domain absent.
- Contact: keep email match; add **phone** (normalized digits) fallback when email is absent.

### D. Interactions idempotency (`src/lib/interactions/persistence.ts`, `src/app/api/v1/arc/crm/interactions/route.ts`)
- Accept an optional `idempotency_key` on note/task creation; a repeat key is a no-op returning the existing row.
- Secondary guard: dedup an identical `(entity_type, entity_id, author_kind, body)` note created within a short window (e.g. 10 min).

### E. DB backstops (`supabase/migrations/<timestamp>_crm_dedup_guards.sql`)
- Partial unique indexes so dupes can't slip in on a logic miss:
  - `contacts` unique on `(org_id, lower(email))` where `email is not null`.
  - `properties` unique on `(org_id, lower(address_line1), postal_code)` where `address_line1 is not null`.
  - Companies: **no hard unique** (legit same-name orgs exist); rely on app-layer matching.
- The migration **de-duplicates existing rows first** (merge/relink children to the survivor) before adding indexes, or it will fail. New timestamped file; never edit shipped migrations. Must be applied to prod (`qqbecyrhnowmooyjiztz`) manually — see memory `vercel-deploy`, `prod-schema-drift`.

### F. Read-before-write tool + prompt (`apps/arc-runner/src/tools/`, `prompt.ts`)
- Add a `search_crm` read tool: given a name/email/domain/address, returns matching existing companies/contacts/leads so Arc can decide to **update** rather than create.
- Update Arc's prompt: search for an existing record first; prefer `update_record`; only `create_lead` when nothing matches. Correct the `create_lead` tool description so its "dedups" claim is actually true.
- Registered in act/draft modes only (consistent with existing `crm-write` tools and the pinned per-mode tool-set tests — memory `arc-runner-tool-surface-pinned`).

---

## Constraints honored

- **Public ingest contract is frozen.** `persistLeadIngestion` is shared by the public ingest API and Arc. Dedup is an **opt-in option** so only Arc's path gets find-or-create; the public route's `201/202/400/502` semantics and persona rejection are untouched. (CLAUDE.md "Lead Ingestion Contract".)
- **Deterministic scoring/routing stays in the app layer**, not Postgres (CLAUDE.md). Dedup matching is a persistence concern; the DB indexes are backstops only.
- **Approval-safe.** No outbound send/publish/contact. Arc still only writes internal records; reads/updates add no outbound surface.
- **Reuse over new.** Reuse `page-header.tsx` primitives, the existing interactions persistence, and the existing `origin`/`review_status` provenance columns rather than new parallel systems.

## Out of scope (YAGNI)

- Bulk merge UI for existing duplicates (the migration de-dupes once; an operator-facing merge tool is a later ask).
- Company hard-unique constraint (too risky for legit same-name orgs).
- External lead discovery/prospecting (separate initiative).
- Re-theming beyond what restraint requires; this pass simplifies structure, not the palette.

## Testing

- **Domain (pure, unit-tested in `src/domain/__tests__/`):** address/phone/domain normalization; lead-match key selection.
- **Persistence:** find-or-create returns `created:false` on match and updates in place; property/contact/company dedup paths; public ingest path unchanged (dedup off) — provenance defaults intact.
- **Routes:** `/api/v1/arc/crm/leads` `201` create vs `200` match; interactions idempotency key no-ops; bearer enforcement; `503 not_configured` fallback. (Mock `next/cache` per-file — memory `revalidatepath-throws-in-vitest`.)
- **Runner:** `search_crm` present in act/draft, absent in ask/scan; update the pinned per-mode tool-set consts (memory `arc-runner-tool-surface-pinned`); run the **full** runner suite.
- **UI:** record page renders correct tab from `?tab=`; list row navigates on click; no preview sidebar; one view selector.
- `pnpm lint` (scoped to changed files — memory `pnpm-lint-scans-vendor`), `tsc`/`pnpm build` for types (memory `lint-does-not-typecheck`).

## Risks

- **Migration on populated data** — de-dupe-then-constrain must relink child rows to survivors or the unique index fails. Test against a seeded copy; apply to prod manually and verify (memory `prod-schema-drift`).
- **Tab regressions** — moving panels between tabs risks dropping a panel; the panel→tab mapping above is the checklist. Verify every current module still renders in exactly one tab.
- **Runner/app version skew** — `search_crm` calls a new route; deploy app before/with the runner (memory `arc-runner-cloud-run-live`).
- **Shared-table merge collisions** — nav/shared CRM components are merge hotspots; rebase on fresh `origin/main` before merging (memory `stale-worktree-branch-merge-collisions`).
