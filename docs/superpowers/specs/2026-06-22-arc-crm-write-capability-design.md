# Arc Read/Write Capability — Phase 1 Design

**Date:** 2026-06-22
**Status:** Approved (design), pending implementation plan
**Author:** Arc / Evan

## Problem

Arc told an operator it *cannot* create or "populate" CRM records and *cannot* find leads outside the app — only search/filter existing data. That refusal is **accurate to the current code**, not an attitude bug:

- Arc's runner tools (`apps/arc-runner/src/tools/`) can **read** CRM (companies, contacts, leads, jobs, outcomes, properties) but have **no tool to create or update** any core CRM record.
- The only record-creation path, `POST /api/v1/leads/ingest`, is human/bearer-token only and is not exposed to Arc.
- Arc's system prompt (`apps/arc-runner/src/prompt.ts`) hard-codes *"never editing core CRM records and never contacting anyone."*
- There is no external lead discovery / prospecting / enrichment anywhere in the codebase.

This contradicts the product's own principle — *"Agent does the work. Human approves decisions. Database remembers everything."* Creating an internal CRM record reaches no one, so it is approval-*safe* and should be allowed.

## Goal (direction)

Arc is a **full read/write participant across the entire app**, with the **second brain (knowledge graph) as its primary surface**, then CRM, personas, brand. Not a read-mostly assistant. Captured in memory: `arc-full-readwrite-direction`.

Phase 1 delivers the *foundation* that makes this true for CRM and unblocks every other surface, without building external discovery or sub-agents (deferred to phase 2).

## Non-negotiable boundary

"Write to everything" = create/update every **internal** record. It does **not** mean Arc approves its own work or pushes anything outbound. Three write tiers:

| Tier | Meaning | Examples |
|------|---------|----------|
| **Direct write** | Provenance-stamped, reversible, takes effect immediately | CRM create + update, interactions, brain learnings/signals, persona assignments |
| **Proposed** | Human confirms before it takes effect / influences outbound | brand facts, messaging angles, CTAs, proof points, campaign approval, brand-kit activation |
| **Never** | Hard lines | self-approve, send/contact/publish/spend (outbound), hard-delete without explicit confirmation |

This mirrors the brain's existing gating (gated kinds `brand_fact`/`messaging_angle`/`cta`/`proof_point` force `proposed`; `learning`/`signal` write directly). Phase 1 generalizes that pattern to CRM.

## Approach

Reuse the existing lead-ingestion pipeline rather than building a parallel writer. The human ingest path (`src/lib/lead-ingestion/persistence.ts` via `parseLeadIngestion` from `@/domain`) already validates personas, builds the company→contact→property→lead bundle, and runs deterministic app-layer scoring/routing. Arc rides the **same rails** so its records score identically — we add provenance + review status on top. Follows the CRM-interactions reference shape (`domain → lib → api route → arc-runner tool`).

## Components

### 1. Schema migration (`supabase/migrations/<timestamp>_arc_record_provenance.sql`)

Add to `leads`, `companies`, `contacts`:

- `origin` text/enum `('operator','agent')` **default `'operator'`** — provenance.
- `review_status` text/enum `('active','proposed','dismissed')` **default `'active'`** — gate state.
- `leads.agent_confidence` numeric null — Arc's self-rated confidence (0–1).

Defaults preserve current human-ingest behavior byte-for-byte (existing rows + the ingest route stay `operator`/`active`). New timestamped migration; do not edit shipped files. Note for deploy: must be applied to prod DB manually (see memory `vercel-deploy`, `prod-schema-drift`).

### 2. Write substrate (`src/lib/arc/record-writes.ts`)

One reusable shape every Arc write uses:

- **Provenance stamp**: `origin: 'agent'`, actor/agent key, timestamp, `agent_confidence`.
- **`review_status`**: caller-supplied — `active` for operator-initiated, `proposed` for autonomous/discovery (phase 2).
- **Dedup check**: before insert, match company by name+postal, contact by email; link to existing rather than duplicate. Returns `{ action: 'created' | 'matched', ids }`.
- **Reversibility**: every Arc write is auditable and undoable (provenance columns + existing activity timeline).

Guard all persistence with `isSupabaseAdminConfigured()` (degrade gracefully).

### 3. Arc API routes (`src/app/api/v1/arc/crm/`)

- `POST /api/v1/arc/crm/leads` — create the full bundle. Bearer-gated (`ARC_AGENT_API_TOKEN`), `isSupabaseAdminConfigured()` guard, `503 not_configured` fallback — same contract as sibling `/api/v1/arc` routes. Calls `parseLeadIngestion` → `record-writes`. Body carries `origin: agent` + `review_status`.
- `POST /api/v1/arc/crm/records/update` — update fields on an existing CRM record (lead/company/contact). Reversible; writes provenance + an interaction-timeline entry noting the change. Never deletes.

Response codes follow the ingest contract spirit: `400` validation/persona rejection, `201` created, `200` matched/updated, `503` not configured, `502` persistence error.

### 4. Arc runner tools (`apps/arc-runner/src/tools/crm-write.ts`)

- `create_lead` — creates the company→contact→property→lead bundle.
- `update_record` — updates an existing CRM record's fields (reversible).

Registered in **act/draft** modes only in `apps/arc-runner/src/tools/index.ts` (not ask/scan). Wired to the new routes.

### 5. Full-read grant

Audit `apps/arc-runner/src/tools/index.ts` and confirm Arc can **read** every surface: brain (has it), CRM, personas, persona-intelligence, brand docs, campaigns, performance, vault. Fill any read gaps so "I can't see that" refusals also disappear.

### 6. The prompt rewrite (`apps/arc-runner/src/prompt.ts`)

Replace `"never editing core CRM records and never contacting anyone"` with the real posture:

> Arc reads and writes across the whole app — the marketing brain, CRM, personas, and brand. It creates and updates internal records, always stamped with provenance and reversible. It **proposes** (does not commit) anything that shapes outbound or brand — brand facts, messaging angles, CTAs, campaign approval, brand-kit activation. It **never** self-approves, never sends/contacts/publishes/spends, and never hard-deletes without explicit confirmation.

This is the line that stops the refusals. Add an explicit "you *can* populate the CRM" sentence.

### 7. CRM UI provenance (`src/app/crm/_components/`)

- "Added by Arc" / "Edited by Arc" provenance pill (`StatusPill`) on records where `origin = 'agent'`, in the shared `crm-object-page` / `crm-record-page`.
- For `review_status = 'proposed'` records: confirm/dismiss affordance + a list filter. Per `DESIGN.md` (no emojis, Restoration Red sparingly, no equal 3-column rows).

### 8. Second brain integration

Arc writes route learnings back into the brain (existing `record_brain_note`) so creating/updating records strengthens the knowledge graph — keeping the brain the spine.

## Same-pattern fast-follows (after the reference lands, not new phases)

Each reuses the substrate from §2: persona assignment/update (direct), brand fact/document writes (proposed tier). One tool apiece.

## Out of scope (YAGNI / deferred)

- **Phase 2**: external lead discovery/prospecting (likely Apollo) feeding the same `create_lead` path with `review_status: proposed`; sub-agent fan-out (one agent per zip/persona, cheap model for grunt work + Opus for keep/drop, concurrency-capped, behind a flag like Higgsfield).
- Bulk CSV import UI.
- Editing existing-record *deletion*; auto-contacting anyone.

## Testing

- Domain/persistence: dedup matching (company by name+postal, contact by email); provenance defaults unchanged for the human ingest path.
- Route contract: `201`/`200`/`400`/`503`/`502` cases; bearer enforcement; `not_configured` fallback.
- Prompt/tool registry: `create_lead`/`update_record` present in act/draft, absent in ask/scan.
- `pnpm lint` (scoped to changed files), `tsc`/`pnpm build` for types (Supabase enum literal unions — memory `lint-does-not-typecheck`).

## Risks

- **Schema drift in prod** (`qqbecyrhnowmooyjiztz`) — migration must be applied manually; verify before relying on new columns.
- **Arc junk records** — mitigated by dedup + provenance + reversibility; proposed-queue gate for autonomous writes in phase 2.
- **Runner/app version skew** — new tools call new routes; deploy app before/with runner.
