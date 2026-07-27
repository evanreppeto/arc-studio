# App Universality — making the product fit any company

The multi-tenant *plumbing* is done: every table carries `org_id`, RLS is
enforced, and cross-tenant isolation is proven live (see `docs/TENANCY.md`,
`docs/MULTITENANT-STACK.md`). What is **not** universal yet is the product's
*vocabulary* — its personas, CRM objects, fields, and stages are still a
restoration contractor's nouns. This doc is the map for turning that hardwired
vocabulary into tenant-defined data.

Product direction is already settled: Arc is a broad marketing product for **all**
company types; BSR/Summit are demo tenants. Keep every change tenant-agnostic.

---

## Where we are

| Layer | State | Why |
| --- | --- | --- |
| Tenancy & isolation | **Universal** | `org_id` + RLS on every table |
| Persona taxonomy | **Partial — one seam** | custom personas exist, but records tag persona via a locked enum |
| CRM objects | **Restoration-specific** | 6 fixed tables (`companies, contacts, properties, leads, jobs, outcomes`) |
| Custom fields & stages | **Restoration-specific** | no per-tenant fields; statuses are fixed enums |

---

## Problem 1 — the persona seam (small, high leverage)

There are two persona systems and they don't meet:

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

Still BSR-hardcoded (separate follow-ups, not persona-taxonomy): the campaign
`restoration_focus` enum + its pickers, the HubSpot import persona mapping
(`resolveHubspotPersona`), the Arc-runner `parseCampaignDraft` path, and the
opportunity *detectors* (they surface BSR personas, so a new tenant's opportunity
seeds don't pre-fill a persona yet).

---

## Problem 2 — the CRM object fork (the platform decision)

The six objects are baked into a TypeScript union `CrmObjectKey`
(`src/lib/crm/read-model.ts:72`) and six real Postgres tables. `properties` and
`jobs` are restoration-only concepts; a law firm or agency has no use for them.
There is **no** custom-object or custom-field layer — only a `metadata jsonb`
column nothing reads structurally. "Add a new table in the CRM" today = a dev
writes a migration + types + read-model + components.

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

---

## Problem 3 — configurable stages & statuses (own track)

`lead_status`, `job_status`, `company_status`, `campaign_status`, etc. are also
Postgres enums. Tenant-defined pipeline stages are a separate, smaller track that
mirrors the persona-enum unlock: move the enum to a per-org
`stage_definitions`-style table and drive the board columns from it.

---

## Problem 4 — industry templates (cheap, high felt value)

Most of "make it feel built for me" is not a schema engine — it's seed data. At
onboarding, let a tenant pick an industry (restoration, law firm, agency, med
spa, SaaS, home services…). The choice seeds:

- a starter persona set (`personas`) — **shipped**,
- starter message angles + CTAs (baked into the persona pack) — **shipped**,
- object **labels** (rename "properties" → "matters"/"projects"/"accounts") — deferred,
- default pipeline stages — deferred (needs Track 3).

**v1 shipped.** An Industry picker on the onboarding form
(`src/app/onboarding/page.tsx`) drives a code-side catalog
(`src/lib/personas/industry-templates.ts`, 8 verticals + a neutral `general`
fallback). `seedDefaultPersonas({ industry })` seeds the matching persona pack
(with angles + CTAs) instead of the neutral set, and `createWorkspaceDefaults`
persists the choice on `business_profiles.industry` (existing column — no
migration). Because Track 1 made every picker/gate org-aware, the seeded
industry personas flow through the whole app with no extra wiring. Object labels
+ per-industry stages are the remaining, deeper pieces (see Track 3 / the CRM
fork).

---

## Recommended sequence

1. **Track 1 — persona enum unlock.** Small, makes an already-built UI real for
   every tenant. Start here.
2. **Track 4 — industry templates.** Seed data; large felt-universality win once
   Track 1 makes personas tenant-defined.
3. **Track 2 (Option B) — custom fields + object labels.** Covers most CRM
   customization needs without the full platform build.
4. **Track 3 — configurable stages**, and **Track 2 (Option A)** custom objects —
   only if real tenant demand justifies the platform investment.

---

## Open decisions (need a human call)

- **Persona column type:** plain `text` (simplest) vs. FK to `persona_definitions`
  (referential integrity, slightly more migration work).
- **Where industry templates live:** a code-side catalog vs. seedable DB rows an
  operator can edit.

*Resolved: the CRM customization model — **Option B**, custom fields on the fixed
tables. See "Decided: Option B" under Problem 2.*
