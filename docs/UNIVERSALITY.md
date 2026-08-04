# App Universality — making the product fit any company

The multi-tenant *plumbing* was done first: every table carries `org_id`, RLS is
enforced, and cross-tenant isolation is proven live (see `docs/TENANCY.md`,
`docs/MULTITENANT-STACK.md`). This doc tracked the second half — turning the
product's hardwired *vocabulary* (a restoration contractor's personas, nouns,
fields, and stages) into tenant-defined data.

**That work has shipped.** Tracks 1, 3 and 4 are complete, Track 2 shipped as
the decided Option B, and object labels are now free text per workspace on top of
the industry templates. What remains is deliberate scope, not backlog: the six
CRM objects are fixed by decision. That is recorded below with the reasoning, so
nobody re-opens it by accident — or assumes it's already open.

Product direction is settled: Arc is a broad marketing product for **all**
company types; BSR/Summit are demo tenants. Keep every change tenant-agnostic.

---

## Where we are

| Layer | State | Why |
| --- | --- | --- |
| Tenancy & isolation | **Universal** | `org_id` + RLS on every table |
| Persona taxonomy | **Tenant-defined** | enum → `text` (`20260713120000`); the org's `personas.slug` rows are the authority |
| Pipeline stages | **Tenant-defined** | `pipeline_stages` per org (`20260729160000`) + status enum → `text` (`20260729170000`); seeded per industry at workspace creation |
| Custom fields | **Tenant-defined** | `custom_field_definitions` / `custom_field_values` on all six objects (`20260728180000`) |
| Object + section labels | **Tenant-defined** | free text per workspace (`app_settings.crm_object_labels`), falling back to the 9-key industry map in `src/lib/product-language.ts` |
| CRM objects | **Fixed by decision** | 6 typed tables; no self-serve net-new object type (Option B, below) |

Verified against prod (`qqbecyrhnowmooyjiztz`) on 2026-08-03: `leads.persona`,
`campaigns.persona`, and `leads`/`jobs`/`outcomes`.`status` are all `text`, and
the `*_persona_not_unassigned_check` constraints survive as text checks.

---

## Problem 1 — the persona seam (small, high leverage)

*Original problem statement, kept for the reasoning. Skip to "Status: shipped"
below for the current state — the enum this describes is gone.*

There were two persona systems and they didn't meet:

- The rich `personas` table is per-org, and the "New persona" button is already
  wired end-to-end — `createPersona` (`src/app/(app)/personas/actions.ts`) →
  org-scoped `insertPersona`. A tenant *can* author personas today.
- But every core record — companies, contacts, leads, jobs, outcomes, campaigns,
  `campaign_audiences`, `knowledge_nodes`, `nurture_sequences`,
  `persona_knowledge_entries` — tags persona with a Postgres **enum**
  `persona_mapping` locked to BSR's 12 values (`00000000000000_baseline.sql:67`).
  A new tenant literally cannot assign their own persona to a lead — the column
  type rejects it.
- A third table, `persona_definitions` (org_id, key, label, audience_type,
  sort_order, is_active), is the *intended* per-org taxonomy authority, but the
  ingest validator (`src/domain/personas.ts`) still defaults to the hardcoded 12.

Persona customization is ~80% built and blocked by one enum.

### Fix (Track 1 — recommended first PR)

1. **New migration** — convert `persona` columns from the `persona_mapping` enum
   to `text` (or an `org_id`-scoped FK to `persona_definitions`). Preserve the
   existing internal-only guard (`leads_persona_not_unassigned_check`) as a text
   check. Do **not** edit shipped migrations; add a new timestamped file.
2. **Validation becomes org-aware** — `validateLeadIngestionPersona` already
   accepts an `allowedKeys` argument; feed it the org's `persona_definitions`
   keys (via a small read-model) instead of `OFFICIAL_PERSONA_MAPPINGS`. Keep the
   BSR list only as the seed default.
3. **Seed each new org** — on workspace creation, copy a starter persona set into
   `persona_definitions` + `personas` so the console is never empty.
4. **Verify on staging** — this alters a shipped enum across ~10 tables; prove it
   on the staging DB with a `BEGIN…ROLLBACK` harness before shipping (see
   `docs/staging-migration-reconciliation.md`).

Result: the persona console UI that already exists becomes real for every tenant.

**Status: shipped.** Migration `20260713120000_persona_taxonomy_per_org.sql` converts
all 15 persona columns to `text` and adds `personas.is_active` (verified on staging
via `BEGIN…ROLLBACK`); `getOrgPersonaKeys` (`src/lib/personas/read-model.ts`) is the
per-org authority for lead ingestion + Arc record writes; the Personas console gained
edit + archive + a create-first empty state; and new workspaces seed a neutral
starter set (`src/lib/personas/default-personas.ts`) via `seedDefaultPersonas`.

**Org-aware persona pickers — shipped.** Every persona *dropdown* (CRM add/edit
record, new campaign, draft-from-opportunity) now lists the org's own personas via
`getOrgPersonaOptions`, threaded from each server page → board/view → modal, and
falls back to the BSR demo set only offline. Every *validation gate* behind them
(`crm/actions`, `crm/[recordId]/actions`, `campaigns/actions`, `opportunities/actions`,
`lib/crm/create`, and the Arc `library/attach` + `campaigns/draft-asset` routes) now
validates with `isAllowedPersona(persona, getOrgPersonaKeys(orgId))` instead of the
hardcoded `OFFICIAL_PERSONA_MAPPINGS`. A tenant can now *tag* CRM records and
campaigns with a custom persona end-to-end, not just define and ingest them.

The follow-ups this section used to list are closed:

- **`restoration_focus`** — superseded by the industry-neutral free-text
  `campaigns.campaign_theme` (`20260721163927`). The old enum column survives as
  nullable back-compat and is still selected by the read-model as a display
  fallback (`campaign_theme || humanize(restoration_focus)`); nothing requires it.
- **HubSpot import** — `resolveHubspotPersona` (`src/domain/crm-import.ts`) takes
  `allowedPersonaKeys` and honors a non-restoration org's own persona from the
  mapped column; it falls back to the official set only when no list is passed.
- **Arc runner** — `personasBlock` (`apps/arc-runner/src/context.ts`) renders the
  org's own personas off the wire. `ARC_PERSONAS` remains only as the
  offline/demo fallback for a runner started without app context.

`OFFICIAL_PERSONA_MAPPINGS` still exists in `src/domain/personas.ts`, but it is
**demo seed + offline fallback, not the validation authority** — its own header
says so. Every remaining non-test import of it is a `personaOptions?.length ? … :`
fallback for the backend-less preview. Don't read its presence as hardcoding.

---

## Problem 2 — the CRM object fork (the platform decision)

*The framing below is the original decision record. See "Status" at the end of
this section for what actually shipped.*

The six objects are baked into a TypeScript union `CrmObjectKey`
(`src/lib/crm/read-model.ts`) and six real Postgres tables. `properties` and
`jobs` are restoration-only concepts; a law firm or agency has no use for them.
At the time there was **no** custom-object or custom-field layer — only a
`metadata jsonb` column nothing read structurally. "Add a new table in the CRM"
meant a dev writing a migration + types + read-model + components.

Making this tenant-self-serve is a real architecture decision with a genuine
tradeoff. Pick deliberately — do not rush it.

**Option A — metadata-driven objects (Airtable/HubSpot model).**
`object_definitions` + `field_definitions` per org; records stored in a generic
JSONB-backed `records` table; one generic list/detail UI renders any object.
Fully self-serve. Costs: loses typed columns, weaker relational queries, more
generic UI work, RLS on a shared records table.

**Option B — custom fields on the existing 6 objects.** Keep the typed tables;
add a `field_definitions` + `field_values` layer plus per-tenant object *labels*.
Lower risk, preserves today's typed model and read-models. Cannot add whole new
objects self-serve — but covers most "I need to track one more thing" needs.

### Decided: Option B (2026-07-27)

**We keep the typed tables and add a per-tenant field layer**
(`field_definitions` + `field_values`) plus per-tenant object *labels*. We are
**not** building the metadata/JSONB generic-object engine.

Why: the typed tables are load-bearing — every read-model, board, filter, and Arc
tool path is built on typed columns, and Option A rewrites all of them for a
capability no tenant has asked for yet. Option B ships in weeks and covers the
request that actually recurs ("I need to track one more thing"). Most of the
perceived gap is naming, not schema: a law firm needs "Properties" to say
"Matters", which is a presentation layer.

Accepted limitation: a tenant **cannot** self-serve a net-new object type.
Option A gets revisited only on real, repeated demand for net-new objects — not
on speculation — and would be its own epic.

Tracked as BSR-489 (decision), BSR-493 (custom fields), BSR-494 (object labels).

### Status: shipped as decided

**Custom fields — shipped.** `20260728180000_custom_fields.sql` adds
`custom_field_definitions` + `custom_field_values` for all six objects, with
eight types (`text, number, date, select, multi_select, boolean, url, …` — see
`CUSTOM_FIELD_TYPES` in `src/domain/custom-fields.ts`, mirrored in the migration's
check constraints). Definitions are managed in Settings; values render and edit
through the CRM board, add-record modal, and record view, and the import wizard
can map an incoming column onto one.

**Object labels — shipped, but industry-derived rather than free text.**
`src/lib/product-language.ts` maps an industry key to the label set for the CRM
section and all six objects, so a professional-services workspace reads
Organizations / Clients / Accounts / Inquiries / Engagements. It is consumed by
`app-shell`, the CRM index + record pages, the Settings custom-field and
pipeline-stage panels, and the `/industries` marketing pages (which derive their
vocabulary blocks from this same module at build time, so a page cannot promise
a vocabulary onboarding won't deliver).

**Free text on top — shipped.** The industry map is now the *default*, not the
ceiling: Settings → Records → Names lets a workspace type its own plural and
singular per object, plus a name for the CRM section. See "What's left" below for
the two design points (both forms required; a partial pair is refused).

Note the industry map still matters — it is what a workspace that never opens
that panel gets, and it is what the `/industries` marketing pages render (they
call `getProductLanguage(industryKey)` with no overrides, deliberately: those
pages must show what an industry gives you, not what one tenant renamed).

**Still true, by decision:** a tenant cannot self-serve a net-new object type.

---

## Problem 3 — configurable stages & statuses (own track)

`lead_status`, `job_status`, `company_status`, `campaign_status`, etc. were also
Postgres enums. Tenant-defined pipeline stages were a separate, smaller track
mirroring the persona-enum unlock: move the enum to a per-org
`stage_definitions`-style table and drive the board columns from it.

**Status: shipped, in the two halves the migrations describe.**

1. `20260729160000_pipeline_stages.sql` (additive) creates `pipeline_stages` per
   org and seeds every existing org with the values it already had.
2. `20260729170000_pipeline_status_to_text.sql` (destructive) widens
   `leads`/`jobs`/`outcomes`.`status` to `text`. `.github/workflows/migrate-prod.yml`
   refuses `alter column … type` by design, so this one was **applied to prod by
   hand** — confirmed live on 2026-08-03, all three columns are `text`. A fresh
   database gets it from the repo chain; don't wait for the automation on any
   future migration of this shape.

Settings has a full stage manager (`pipeline-stages-panel.tsx` +
`pipeline-stages-actions.ts`): create, rename, reorder, archive and restore, with
an occupancy check before archiving a stage that still holds records.

The load-bearing detail: stages carry **semantic flags** (`isWon`, `isLost`,
`isTerminal`, `isQualified`) and callers ask the stage what it means rather than
comparing its name. ~26 files tested `status === "won"` and 19 tested
`"qualified"`; without the flags, a tenant renaming "Won" to "Retained" would
silently zero their revenue reporting with no error.

**Deliberately still fixed:** `approval_status`, `agent_task_status`,
`campaign_status` and friends. The rule, stated in `src/domain/pipeline-stages.ts`
— *per-org if it describes the tenant's process, never if the code branches on
it.* Making the approval states configurable would let a tenant rename their way
through the outbound gate.

---

## Problem 4 — industry templates (cheap, high felt value)

Most of "make it feel built for me" is not a schema engine — it's seed data. At
onboarding, let a tenant pick an industry (restoration, law firm, agency, med
spa, SaaS, home services…). The choice seeds:

- a starter persona set (`personas`) — **shipped**,
- starter message angles + CTAs (baked into the persona pack) — **shipped**,
- object **labels** (rename "properties" → "matters"/"projects"/"accounts") —
  **shipped as industry-derived labels**, see Problem 2's status,
- default pipeline stages — **shipped**, see below.

**Shipped.** An Industry picker on the onboarding form
(`src/app/onboarding/page.tsx`) drives a code-side catalog
(`src/lib/personas/industry-templates.ts`, 8 verticals + a neutral `general`
fallback). `seedDefaultPersonas({ industry })` seeds the matching persona pack
(with angles + CTAs) instead of the neutral set, and `createWorkspaceDefaults`
persists the choice on `business_profiles.industry` (existing column — no
migration). The choice is editable afterwards in Settings → General. Because
Track 1 made every picker/gate org-aware, the seeded industry personas flow
through the whole app with no extra wiring.

The industry key also drives vocabulary through `src/lib/product-language.ts`
(`canonicalIndustryKey` absorbs the picker's values and older display-label
settings into one of nine stable keys), and connector recommendations in
Settings.

**Per-industry pipeline stages — shipped.**
`src/lib/pipeline-stages/industry-templates.ts` gives each of the eight verticals
a starter set for `leads` and `jobs`; `stagesForIndustry()` falls back to
`DEFAULT_PIPELINE_STAGES` for `general` and anything unrecognised.
`seedDefaultPipelineStages({ orgId, client, industry })` writes them at workspace
creation, mirroring `seedDefaultPersonas`.

Three rules that file follows, worth keeping:

- **`outcomes` is deliberately NOT varied.** It is the revenue ledger — won,
  lost, paid, written off — and it means the same thing in every trade.
  Splintering it would fragment revenue reporting across tenants for no gain.
- **Every set keeps an `isWon` and an `isLost` terminal.** Reporting reads the
  flags, not the names, so a set missing either would silently report zero
  conversion — no error, just wrong numbers. Enforced by a test over every
  template rather than left to review, alongside checks that the keys and labels
  satisfy the migration's own check constraints.
- **Seeding is a no-op when the org already has stages.** No existing tenant's
  stages or reporting can move; this only reaches new workspaces.

The `/industries` pages used to apologise for this being the one un-configured
thing; that note now says what genuinely is still manual (records, brand,
channels). The header comment in `src/app/industries/_data/industries.ts` keeps
the rule that made it worth writing down: *if a page claims a vertical gets
something configured, onboarding must actually deliver it.*

---

## What's left

Nothing in tracks 1–4 is outstanding. One thing is open **by decision**, and it
needs real repeated tenant demand — not speculation — before it reopens:

1. **Net-new object types** (Option A, the metadata/JSONB engine). Its own epic.
   Every read-model, board, filter and Arc tool path is built on typed columns.

**Free-text object labels — shipped.** Settings → Records → Names lets a
workspace type its own plural and singular for each of the six objects, plus a
name for the CRM section itself. Stored as one `app_settings` jsonb row
(`crm_object_labels`) — no migration, following the journey-settings precedent.
`getProductLanguage(industry, overrides)` resolves workspace words → industry
template → `general`, per object, so renaming one thing doesn't drop the other
five to neutral nouns.

Two design points worth not re-litigating. **A workspace types both forms**: the
singular is not derived, because "Matters" → "Matter" works and "People" →
"Peopl" does not, and the failure lands in a button an operator reads daily.
**A half-filled pair is refused** (`parseObjectLabelOverride` returns null),
because a plural without a singular renders a "Matters" tab above an "Add site"
button — one screen speaking two vocabularies is worse than either alone. The
panel flags the incomplete row inline rather than letting a save silently drop it.

If a tenant sets no override and lands outside the nine templates, they still get
`general` — neutral nouns (Organizations / People / Sites / Leads / Projects /
Outcomes) and a neutral persona pack. That is a working fallback, not a gap to
fix with a tenth template each time; add a template only when a vertical is worth
its own landing page too.

---

## Resolved decisions

- **CRM customization model** — **Option B**, custom fields on the fixed tables.
  See "Decided: Option B" under Problem 2.
- **Persona column type** — plain `text`, not an FK to a definitions table.
  Validation lives in the app layer (`getOrgPersonaKeys`), the same place stage
  validation ended up.
- **Where industry templates live** — a code-side catalog
  (`src/lib/personas/industry-templates.ts`), not operator-editable DB rows. The
  `/industries` marketing pages derive from it at build time, which is only sound
  because it is code.
