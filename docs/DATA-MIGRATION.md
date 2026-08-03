# Data Migration & Workspace Consistency

Last updated: 2026-08-03

How a customer brings years of existing CRM data into Arc Studio — on day one and
on any day after — and which tenant boundary that data lands inside.

Two problems, deliberately in one document, because they are the same problem:
an import is a write, and a write has to know what it belongs to.

Companion docs: [TENANCY.md](./TENANCY.md) (org isolation + RLS),
[backend-workspace-data-boundary-audit.md](./backend-workspace-data-boundary-audit.md)
(the running status log), [CONNECTORS.md](./CONNECTORS.md).

---

## Part 1 — Where we actually are

### Import today

Import is already modeled correctly as a connector kind — `import_source` — with
three providers funneling into one provider-agnostic engine:

| Piece | File |
| --- | --- |
| Orchestrators (`runCrmImport`, `runMailchimpImport`, `runCsvImport`) | `src/lib/connectors/import.ts` |
| The engine (page → map → validate → dedupe → persist) | `src/lib/integrations/crm/import-run.ts` |
| Sources | `src/lib/integrations/crm/{hubspot,mailchimp,source}.ts` |
| CSV parsing + header aliasing | `src/domain/csv-import.ts` |
| Operator surface | `src/app/(app)/settings/_components/settings-view.tsx` (`CsvImportSection`) |

What it already gets right, and should not be rebuilt:

- **Idempotent.** Keyed on the source's external id — a re-import updates rather
  than duplicating (`findExistingLeadByExternalId`).
- **Operator-triggered, never automatic.** Import is explicitly kept off the
  signal-detection loop, because it mutates CRM rows rather than only writing
  `opportunities`.
- **History-preserving.** `lastContactedAt` is carried through, so an eight-month
  cold contact lands eight months cold. Without this, cold-lead detection cannot
  fire for 30 days and a freshly-imported workspace sees an empty Opportunities
  screen right after being told to import its records.
- **Best-effort per record.** One bad row is counted and skipped, never sinking
  the batch.
- **Read-only, no outbound.** Nothing an import touches can reach a person.

### What's missing

**1. The surface is a textarea.** CSV import is a paste box inside Settings →
Connections. No file upload, no column mapping, no preview, no dry run, no
history, no undo. The connector catalog copy in `src/domain/connectors.ts`
already advertises "paste **or upload** a CSV" — the upload half does not exist.

**2. It only imports contacts.** The engine's unit of work is one contact → one
lead (plus a derived company/contact/property). Everything else in a real CRM
export has nowhere to land, even though the tables exist and are wired for both
humans and Arc:

| In their export | Our table | Import can write it |
| --- | --- | --- |
| Contacts, companies | `contacts`, `companies` | yes |
| Deals / jobs | `jobs` | no |
| Notes, tasks, activity timeline | `crm_notes`, `crm_tasks`, `crm_activities` | no |
| Custom fields | `custom_field_definitions`, `custom_field_values` | no |
| Pipeline stage, owner, tags | `pipeline_stages` | no |
| Relationships beyond contact→company | — | no |
| Attachments | `media_assets` | no |

**3. There is no record that an import happened.** No batch id on written rows,
no run history, no way to see what a run did or reverse it. That is what makes
"import whenever you want" feel dangerous rather than routine.

**4. Dead scaffold already exists for this.** `external_systems`,
`external_object_mappings`, `sync_conflicts`, and `integration_registry` are live
tables in prod, referenced **nowhere** in `src/` except the generated
`database.types.ts`. They were designed for exactly this problem. Revive rather
than reinvent.

### Workspace consistency — a contract the database doesn't honor

`backend-workspace-data-boundary-audit.md` states the product boundary plainly:

> Arc should be scoped to a workspace first. A workspace owns shared brand
> context, campaign memory, library assets, CRM references, approvals, and Arc
> API tokens.

The schema implements almost none of that at the workspace level. From prod's
`information_schema` (project `qqbecyrhnowmooyjiztz`, 2026-08-03):

- **Org-scoped only, no `workspace_id`:** `companies`, `contacts`, `leads`,
  `jobs`, `properties`, `outcomes`, `crm_notes`, `crm_tasks`, `crm_activities`,
  `opportunities`, `personas`, `knowledge_nodes`, `knowledge_edges`,
  `media_assets`, `media_folders`, `approval_items`, `custom_field_definitions`,
  `business_profiles`, `pipeline_stages`, `journey_*`
- **Workspace-scoped:** `agent_tasks`, `arc_conversations`, `arc_messages`,
  `workspace_connectors`, `workspace_media_config`, `ai_usage_events`,
  `agent_api_tokens`, `audit_events`
- **Declared but not enforced:** `campaigns.workspace_id` exists and is
  **nullable**; the tenant helper in `src/lib/campaigns/read-model.ts` filters on
  `org_id` alone.

Everything in TENANCY.md — the RLS policies, `is_org_member(org_id)`,
`resolveTenantReadHandle()` — is about isolating **orgs from each other**. It is
solid, and it is not what this section is about. Nothing isolates one workspace
from another workspace in the same org.

**Where that bites import specifically:** `runCsvImport` takes a `workspaceId`,
uses it only to resolve the connector credential, then calls
`importContactsFromSource({ orgId })`. So the connector is configured
per-workspace and the rows it writes land org-wide. Workspace A imports;
workspace B sees the contacts and cannot tell where they came from.

**This is latent, not currently broken.** Prod has two orgs, each with exactly
one workspace (`default`). It becomes real the first time a customer creates a
second workspace — the same shape as the session-less cron that resolved its
tenant fine until a second active org existed.

---

## Part 2 — The decision (made 2026-08-03, BSR-637)

**An org owns the customer record. A workspace owns everything generated from it.**

Option A for CRM records, Option B for generated artifacts. One customer list per
company; per-workspace campaigns, assets, approvals, Arc memory, brand, and spend.
The scenario it serves is one company running two brands, or an agency running
several clients off one customer list.

The operative rule, for classifying anything new:

> If two workspaces in the same company could legitimately **disagree** about a
> row, the row is workspace-owned. If disagreeing would just mean one of them is
> wrong, it is org-owned.

The full table-group-by-table-group contract, the three flagged close calls
(`media_assets`, `business_profiles`, `guardrail_rules`), and the migration plan
live in
[backend-workspace-data-boundary-audit.md](./backend-workspace-data-boundary-audit.md).
Short version: nothing in the customer record layer moves, ~2,260 rows across 33
tables gain or tighten a `workspace_id`, and the backfill is unambiguous only for
as long as every org has exactly one workspace.

Enforcement is a CI check against `information_schema` (BSR-638), not discipline.
The gap this closes existed for four weeks inside a document that described the
opposite of what the schema did, because nothing checked.

---

## Part 3 — The plan

### Workstream A — Tenancy contract

1. **Decide and write down the boundary**, table group by table group, replacing
   the aspirational sentence in the audit doc with what is actually true.
2. **Enforce it in CI** — a test that reads `information_schema` and fails when a
   product table's scoping columns don't match the contract. New tables inherit
   the rule automatically instead of being audited later.
3. **Resolve `campaigns.workspace_id`** — enforce it (non-null + filtered) or drop
   it. A nullable column nothing filters on is worse than either.

### Workstream B — Import as a real pipeline

The engine stays; everything around it becomes a product surface.

4. **`import_runs` + batch provenance.** Every row an import writes carries the
   run that created it. Runs record source, workspace, counts, per-row errors, and
   whether they're reversible. This is the ticket that makes "import any time"
   safe, and it is the prerequisite for the rest.
5. **Dry-run mode.** A `dryRun` flag through `importContactsFromSource` that
   returns the same result shape without writing: N new, M updated, K skipped,
   with sample rows and per-row reasons.
6. **Upload → map → preview → commit.** A real import surface: file drop
   (CSV/XLSX), the auto-detected column mapping shown and correctable, a dry-run
   diff, then commit. `src/domain/csv-import.ts` already does alias detection —
   it needs the mapping exposed rather than replaced.
7. **Import history + undo.** A list of runs with counts and errors, and a
   reverse-this-batch action for the most recent runs.

### Workstream C — Beyond contacts

8. **Entity-per-file import.** contacts / companies / deals / notes, with an
   `external_object_mappings` row per source id so relationships resolve across
   files and survive re-import. This is where "my CRM tabs and relationships"
   actually gets answered.
9. **Unmapped columns become custom fields** instead of being dropped —
   auto-provisioning `custom_field_definitions` from the mapping step.

### Workstream D — Lower the friction per source

10. **Native-export presets** for HubSpot, Salesforce, Pipedrive, Jobber, and
    Google Contacts: we know those column names, so the mapping step is
    pre-filled and the user just confirms. Relates to BSR-374 (Salesforce).

### Sequencing

A1 → A2 gate everything, because an import that writes to the wrong scope is a
bug you have to migrate out of later. B4 → B5 → B6 → B7 is the critical path to a
usable import. C and D are additive and can run in parallel once B4 lands.
