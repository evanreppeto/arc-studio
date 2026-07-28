# Arc CRM Read/Write Capability (Phase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Arc the ability to *create* and *update* core CRM records (leads/companies/contacts/properties) as provenance-stamped, reversible writes — stopping the "I can't populate the app" refusals — while preserving the human approval gate for anything outbound.

**Architecture:** Reuse the existing lead-ingestion pipeline. Arc's new `POST /api/v1/arc/crm/leads` route runs the *same* `parseLeadIngestionPayload` (domain) + `persistLeadIngestion` (lib) the human ingest uses, extended with an optional provenance stamp (`origin`, `review_status`, `agent_confidence`) and a dedup check. A second route `POST /api/v1/arc/crm/records/update` whitelists fields and logs an activity-timeline entry. Two new runner tools (`create_lead`, `update_record`) call these routes; the runner system prompt is rewritten to grant the new posture. A migration adds the provenance columns (defaults preserve current human-ingest behavior exactly).

**Tech Stack:** Next.js 16 (App Router, route handlers), Supabase (admin client), Zod, `@anthropic-ai/claude-agent-sdk` (runner tools), Vitest, pnpm. Path alias `@/*` → `./src/*`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260622180000_arc_record_provenance.sql` | **Create.** Add `origin` + `review_status` to companies/contacts/properties/leads; `agent_confidence` to leads. |
| `src/lib/lead-ingestion/persistence.ts` | **Modify.** Accept optional `provenance` + `existing` ids; stamp inserts. Human path unchanged (defaults). |
| `src/lib/arc/record-writes.ts` | **Create.** Arc-facing write substrate: `createArcLead` (parse + dedup + persist) and `updateArcRecord` + pure `pickAllowedFields`. |
| `src/lib/arc/__tests__/record-writes.test.ts` | **Create.** Unit-test the pure `pickAllowedFields` whitelist. |
| `src/app/api/v1/arc/crm/leads/route.ts` | **Create.** `POST` — Arc creates a lead bundle. |
| `src/app/api/v1/arc/crm/records/update/route.ts` | **Create.** `POST` — Arc updates an existing record + logs activity. |
| `apps/arc-runner/src/tools/crm-write.ts` | **Create.** `create_lead` + `update_record` runner tools. |
| `apps/arc-runner/src/tools/index.ts` | **Modify.** Register the new tools in `writeTools`. |
| `apps/arc-runner/src/prompt.ts` | **Modify.** Rewrite the capability posture line. |
| `src/lib/crm/read-model.ts` + `src/app/crm/_components/crm-record-detail.tsx` | **Modify.** Surface `origin` and render an "Added by Arc" pill. |

---

## Task 1: Provenance migration

**Files:**
- Create: `supabase/migrations/20260622180000_arc_record_provenance.sql`

- [ ] **Step 1: Write the migration**

Mirror the existing `partner_tier text check (...)` style (text + check, not new enum types — lower drift risk). Defaults make every existing row and the human ingest path `operator`/`active`, so nothing changes for them.

```sql
-- Provenance + review gate for Arc-created/updated CRM records.
-- Defaults preserve existing human-ingest behavior: every current row and the
-- /api/v1/leads/ingest path stays origin='operator', review_status='active'.

alter table public.companies
  add column if not exists origin text not null default 'operator'
    check (origin in ('operator', 'agent')),
  add column if not exists review_status text not null default 'active'
    check (review_status in ('active', 'proposed', 'dismissed'));

alter table public.contacts
  add column if not exists origin text not null default 'operator'
    check (origin in ('operator', 'agent')),
  add column if not exists review_status text not null default 'active'
    check (review_status in ('active', 'proposed', 'dismissed'));

alter table public.properties
  add column if not exists origin text not null default 'operator'
    check (origin in ('operator', 'agent')),
  add column if not exists review_status text not null default 'active'
    check (review_status in ('active', 'proposed', 'dismissed'));

alter table public.leads
  add column if not exists origin text not null default 'operator'
    check (origin in ('operator', 'agent')),
  add column if not exists review_status text not null default 'active'
    check (review_status in ('active', 'proposed', 'dismissed')),
  add column if not exists agent_confidence numeric
    check (agent_confidence is null or (agent_confidence >= 0 and agent_confidence <= 1));

comment on column public.leads.origin is 'operator (human) or agent (Arc) that created the record.';
comment on column public.leads.review_status is 'active = live; proposed = awaiting human confirm; dismissed = rejected.';
comment on column public.leads.agent_confidence is 'Arc self-rated confidence 0-1 when origin=agent.';
```

- [ ] **Step 2: Verify it parses against a scratch DB (if available) or eyeball-review**

Run (only if a local Supabase/psql is configured; otherwise skip and rely on review):
`pnpm supabase db reset --debug` *(do NOT run against prod)*
Expected: no syntax error on the new file. **Prod note:** this migration must be applied to prod (`qqbecyrhnowmooyjiztz`) **manually** — Vercel does not run migrations.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260622180000_arc_record_provenance.sql
git commit -m "feat(db): provenance + review_status columns for Arc CRM writes"
```

---

## Task 2: Provenance-aware `persistLeadIngestion`

Add two optional inputs so the same function serves the human path (no provenance, always inserts) and Arc (stamped, can reuse a deduped company/contact). The `insertAndReturnId` helper already takes `Record<string, unknown>` values, so new columns need no type changes.

**Files:**
- Modify: `src/lib/lead-ingestion/persistence.ts`

- [ ] **Step 1: Add the provenance/existing types to `PersistLeadInput`**

Replace the `PersistLeadInput` type (lines 7-12) with:

```typescript
export type LeadProvenance = {
  origin: "operator" | "agent";
  reviewStatus: "active" | "proposed" | "dismissed";
  agentConfidence?: number | null;
};

type PersistLeadInput = {
  input: ParsedLeadIngestionInput;
  result: AcceptedLeadIngestionResult;
  supabase: SupabaseClient;
  orgId: string;
  /** When set, stamps companies/contacts/properties/leads with origin + review_status. */
  provenance?: LeadProvenance;
  /** Pre-resolved (deduped) ids to reuse instead of inserting. */
  existing?: { companyId?: string | null; contactId?: string | null };
};
```

- [ ] **Step 2: Thread provenance + existing ids through the body**

Replace the function body (lines 25-106) with this version. Changes: destructure `provenance`/`existing`; build a `stamp` object spread into each insert; reuse `existing.companyId`/`existing.contactId` when present; add `agent_confidence` to the lead insert.

```typescript
export async function persistLeadIngestion({
  input,
  result,
  supabase,
  orgId,
  provenance,
  existing,
}: PersistLeadInput): Promise<PersistedLeadIngestion> {
  const stamp = provenance
    ? { origin: provenance.origin, review_status: provenance.reviewStatus }
    : {};

  const companyId = existing?.companyId
    ? existing.companyId
    : input.company
      ? await insertAndReturnId(supabase, "companies", orgId, {
          name: input.company.name,
          persona: result.persona,
          partner_tier: input.company.partnerTier ?? null,
          ...stamp,
          metadata: {
            network_connection: input.company.networkConnection ?? null,
            ingestion_source: input.source,
          },
        })
      : null;

  const contactId = existing?.contactId
    ? existing.contactId
    : input.contact
      ? await insertAndReturnId(supabase, "contacts", orgId, {
          company_id: companyId,
          persona: result.persona,
          first_name: input.contact.firstName ?? null,
          last_name: input.contact.lastName ?? null,
          email: input.contact.email ?? null,
          phone: input.contact.phone ?? null,
          ...stamp,
          metadata: {
            ingestion_source: input.source,
          },
        })
      : null;

  const propertyId = input.property
    ? await insertAndReturnId(supabase, "properties", orgId, {
        company_id: companyId,
        contact_id: contactId,
        persona: result.persona,
        street_line_1: input.property.streetLine1,
        street_line_2: input.property.streetLine2 ?? null,
        city: input.property.city,
        state: input.property.state.toUpperCase(),
        postal_code: input.property.postalCode,
        ...stamp,
        metadata: {
          ingestion_source: input.source,
        },
      })
    : null;

  const leadId = await insertAndReturnId(supabase, "leads", orgId, {
    company_id: companyId,
    contact_id: contactId,
    property_id: propertyId,
    persona: result.persona,
    status: result.routing === "archived" ? "archived" : "validated",
    routing_recommendation: toDatabaseRoutingRecommendation(result.routing),
    source: input.source,
    external_lead_id: input.externalLeadId ?? null,
    loss_summary: input.lossSummary ?? null,
    loss_signals: input.lossSignals,
    matched_target_keywords: result.classification.matchedTargetKeywords,
    matched_non_target_keywords: result.classification.matchedNonTargetKeywords,
    lead_score: result.scores.leadScore,
    attributed_campaign_id: result.attribution.campaignId,
    attributed_asset_id: result.attribution.assetId,
    attribution_channel: result.attribution.channel,
    attribution_method: result.attribution.method,
    attribution_utm: result.attribution.utm,
    ...stamp,
    agent_confidence: provenance?.agentConfidence ?? null,
    metadata: {
      ...input.metadata,
      classification: result.classification.classification,
      partner_score: result.scores.partnerScore,
      calculated_at: result.scores.calculatedAt,
    },
  });

  return { companyId, contactId, propertyId, leadId };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no errors in `persistence.ts`). The human ingest route still compiles — it calls `persistLeadIngestion` without the new optional args.

- [ ] **Step 4: Commit**

```bash
git add src/lib/lead-ingestion/persistence.ts
git commit -m "feat(lead-ingestion): optional provenance + deduped-id reuse in persistLeadIngestion"
```

---

## Task 3: Arc write substrate (`record-writes.ts`)

The Arc-facing module. `pickAllowedFields` is pure (TDD it). `createArcLead` and `updateArcRecord` are thin I/O over the admin client.

**Files:**
- Create: `src/lib/arc/record-writes.ts`
- Test: `src/lib/arc/__tests__/record-writes.test.ts`

- [ ] **Step 1: Write the failing test for `pickAllowedFields`**

```typescript
// src/lib/arc/__tests__/record-writes.test.ts
import { describe, expect, it } from "vitest";

import { pickAllowedFields } from "../record-writes";

describe("pickAllowedFields", () => {
  it("keeps only whitelisted columns for the table", () => {
    const out = pickAllowedFields("leads", {
      persona: "persona_plumbing_partner",
      lead_score: 80,
      id: "should-be-dropped",
      org_id: "should-be-dropped",
      not_a_column: true,
    });
    expect(out).toEqual({ persona: "persona_plumbing_partner", lead_score: 80 });
  });

  it("returns an empty object when nothing is allowed", () => {
    expect(pickAllowedFields("contacts", { id: "x", bogus: 1 })).toEqual({});
  });

  it("allows review_status on every table (the gate field)", () => {
    expect(pickAllowedFields("companies", { review_status: "active" })).toEqual({
      review_status: "active",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/arc/__tests__/record-writes.test.ts`
Expected: FAIL — `Cannot find module '../record-writes'`.

- [ ] **Step 3: Implement `record-writes.ts`**

```typescript
// src/lib/arc/record-writes.ts
import { type SupabaseClient } from "@supabase/supabase-js";

import { parseLeadIngestionPayload } from "@/domain";
import {
  persistLeadIngestion,
  type LeadProvenance,
  type PersistedLeadIngestion,
} from "@/lib/lead-ingestion/persistence";

export type ArcWritableTable = "leads" | "companies" | "contacts";

/** Per-table whitelist of columns Arc may set on an update. Pure data. */
const ALLOWED_UPDATE_FIELDS: Record<ArcWritableTable, readonly string[]> = {
  leads: [
    "persona",
    "status",
    "routing_recommendation",
    "loss_summary",
    "lead_score",
    "review_status",
    "company_id",
    "contact_id",
    "property_id",
  ],
  companies: [
    "name",
    "persona",
    "status",
    "partner_tier",
    "website_url",
    "phone",
    "email",
    "review_status",
  ],
  contacts: [
    "persona",
    "status",
    "first_name",
    "last_name",
    "email",
    "phone",
    "title",
    "review_status",
  ],
};

/** Pure: drop any key not in the table's whitelist. Never lets Arc set id/org_id. */
export function pickAllowedFields(
  table: ArcWritableTable,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = ALLOWED_UPDATE_FIELDS[table];
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in fields && fields[key] !== undefined) {
      out[key] = fields[key];
    }
  }
  return out;
}

export type CreateArcLeadResult =
  | { ok: true; persisted: PersistedLeadIngestion; dedup: { companyMatched: boolean; contactMatched: boolean } }
  | { ok: false; httpStatus: number; errors: Array<{ code: string; message: string }> };

/**
 * Arc creates a full company->contact->property->lead bundle through the same
 * domain pipeline the human ingest uses, stamped with provenance. Dedups the
 * company (by name + postal) and contact (by email) so Arc linking to an
 * existing account doesn't spawn duplicates.
 */
export async function createArcLead(params: {
  payload: unknown;
  supabase: SupabaseClient;
  orgId: string;
  reviewStatus: LeadProvenance["reviewStatus"];
  agentConfidence?: number | null;
}): Promise<CreateArcLeadResult> {
  const result = parseLeadIngestionPayload(params.payload);
  if (!result.ok) {
    return { ok: false, httpStatus: result.httpStatus, errors: result.errors };
  }

  const input = result.normalizedInput;

  const companyMatchId =
    input.company && input.property
      ? await findCompanyIdByNamePostal(
          params.supabase,
          params.orgId,
          input.company.name,
          input.property.postalCode,
        )
      : null;

  const contactMatchId = input.contact?.email
    ? await findContactIdByEmail(params.supabase, params.orgId, input.contact.email)
    : null;

  const persisted = await persistLeadIngestion({
    input,
    result,
    supabase: params.supabase,
    orgId: params.orgId,
    provenance: {
      origin: "agent",
      reviewStatus: params.reviewStatus,
      agentConfidence: params.agentConfidence ?? null,
    },
    existing: { companyId: companyMatchId, contactId: contactMatchId },
  });

  return {
    ok: true,
    persisted,
    dedup: { companyMatched: companyMatchId !== null, contactMatched: contactMatchId !== null },
  };
}

export type UpdateArcRecordResult =
  | { ok: true; id: string; applied: Record<string, unknown> }
  | { ok: false; httpStatus: number; message: string };

/** Arc updates an existing record's whitelisted fields. Never inserts, never deletes. */
export async function updateArcRecord(params: {
  table: ArcWritableTable;
  id: string;
  fields: Record<string, unknown>;
  supabase: SupabaseClient;
  orgId: string;
}): Promise<UpdateArcRecordResult> {
  const applied = pickAllowedFields(params.table, params.fields);
  if (Object.keys(applied).length === 0) {
    return { ok: false, httpStatus: 400, message: "No updatable fields supplied." };
  }

  const { data, error } = await params.supabase
    .from(params.table)
    .update({ ...applied, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("org_id", params.orgId)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    return { ok: false, httpStatus: 502, message: `Failed to update ${params.table}: ${error.message}` };
  }
  if (!data?.id) {
    return { ok: false, httpStatus: 404, message: `No ${params.table} record with id ${params.id}.` };
  }

  return { ok: true, id: data.id, applied };
}

async function findCompanyIdByNamePostal(
  supabase: SupabaseClient,
  orgId: string,
  name: string,
  postalCode: string,
): Promise<string | null> {
  // Match a company by exact name within the org that also has a property in the
  // same postal code — a conservative dedup that avoids cross-region collisions.
  const { data } = await supabase
    .from("companies")
    .select("id, properties!inner(postal_code)")
    .eq("org_id", orgId)
    .ilike("name", name)
    .eq("properties.postal_code", postalCode)
    .limit(1)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

async function findContactIdByEmail(
  supabase: SupabaseClient,
  orgId: string,
  email: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("contacts")
    .select("id")
    .eq("org_id", orgId)
    .ilike("email", email)
    .limit(1)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/arc/__tests__/record-writes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/arc/record-writes.ts src/lib/arc/__tests__/record-writes.test.ts
git commit -m "feat(arc): record-writes substrate (createArcLead, updateArcRecord, pickAllowedFields)"
```

---

## Task 4: `POST /api/v1/arc/crm/leads`

Bearer + Supabase + workspace gated via `arcGuard` (same as the interactions route). Operator-initiated creates default to `review_status: active`; callers can pass `proposed` (phase-2 discovery).

**Files:**
- Create: `src/app/api/v1/arc/crm/leads/route.ts`

> Note: a **GET** `/api/v1/arc/crm/leads` already exists (used by `search_leads`). Adding a `POST` export to a new `route.ts` at the same path is the goal — confirm whether the existing GET lives at `src/app/api/v1/arc/crm/leads/route.ts`. If it does, **add the `POST` export to that file** instead of creating a second one (Next.js allows multiple method exports per route file). The code below is the `POST` handler to add either way.

- [ ] **Step 1: Write the POST handler**

```typescript
import { arcGuard, fail, INVALID_JSON, ok, readJson } from "@/app/api/v1/arc/_lib/http";
import { createArcLead } from "@/lib/arc/record-writes";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Lets Arc CREATE a new lead bundle (company -> contact -> property -> lead),
 * stamped origin=agent. Runs the same domain pipeline as the human ingest, so
 * scoring/routing match. Nothing here reaches the outside world — a new lead is
 * an internal record.
 *
 *   POST /api/v1/arc/crm/leads
 *   { "lead": { persona, source, company?, contact?, property?, ... },
 *     "review_status"?: "active" | "proposed", "agent_confidence"?: number }
 */
export async function POST(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;

  const body = await readJson(request);
  if (body === INVALID_JSON || typeof body !== "object" || body === null) {
    return fail("invalid_request", "Request body must be a JSON object.", 400);
  }

  const payload = body as Record<string, unknown>;
  const lead = payload.lead;
  if (typeof lead !== "object" || lead === null) {
    return fail("invalid_request", 'Field "lead" (the lead ingestion payload) is required.', 400);
  }

  const reviewStatus = payload.review_status === "proposed" ? "proposed" : "active";
  const agentConfidence =
    typeof payload.agent_confidence === "number" ? payload.agent_confidence : null;

  try {
    const result = await createArcLead({
      payload: lead,
      supabase: getSupabaseAdminClient(),
      orgId: allowed.scope.orgId,
      reviewStatus,
      agentConfidence,
    });

    if (!result.ok) {
      return fail("invalid_request", result.errors[0]?.message ?? "Invalid lead payload.", result.httpStatus);
    }

    return ok(
      {
        lead_id: result.persisted.leadId,
        company_id: result.persisted.companyId,
        contact_id: result.persisted.contactId,
        property_id: result.persisted.propertyId,
        review_status: reviewStatus,
        dedup: result.dedup,
      },
      201,
    );
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Failed to create lead.", 502);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Manual smoke (optional, needs Supabase env + ARC_AGENT_API_TOKEN)**

Run `pnpm dev`, then:
```bash
curl -s -X POST localhost:3000/api/v1/arc/crm/leads \
  -H "authorization: Bearer $ARC_AGENT_API_TOKEN" -H "content-type: application/json" \
  -d '{"lead":{"persona":"persona_plumbing_partner","source":"arc_manual","company":{"name":"Joe Plumbing"},"property":{"streetLine1":"1 W Main St","city":"Chicago","state":"IL","postalCode":"60614"}},"review_status":"active"}'
```
Expected: `{"ok":true,...,"lead_id":"<uuid>", "review_status":"active"}` with HTTP 201. Without Supabase env you get `503 not_configured` (expected).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/arc/crm/leads/route.ts
git commit -m "feat(arc-api): POST /api/v1/arc/crm/leads — Arc creates lead bundles"
```

---

## Task 5: `POST /api/v1/arc/crm/records/update`

Updates a whitelisted record and writes an activity-timeline entry so the change is auditable/reversible.

**Files:**
- Create: `src/app/api/v1/arc/crm/records/update/route.ts`

- [ ] **Step 1: Write the handler**

```typescript
import { arcGuard, fail, INVALID_JSON, ok, readJson } from "@/app/api/v1/arc/_lib/http";
import { parseActivityInput } from "@/domain";
import { updateArcRecord, type ArcWritableTable } from "@/lib/arc/record-writes";
import { insertActivity } from "@/lib/interactions/persistence";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

const ENTITY_TYPE: Record<ArcWritableTable, string> = {
  leads: "lead",
  companies: "company",
  contacts: "contact",
};

const WRITABLE_TABLES: ArcWritableTable[] = ["leads", "companies", "contacts"];

/**
 * Lets Arc UPDATE whitelisted fields on an existing lead/company/contact, then
 * logs a timeline activity for the change. Never inserts or deletes. Internal
 * only — no outbound side effects.
 *
 *   POST /api/v1/arc/crm/records/update
 *   { "table": "leads"|"companies"|"contacts", "id": "<uuid>",
 *     "fields": { ...whitelisted columns... }, "summary"?: "why" }
 */
export async function POST(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;
  const scope = { orgId: allowed.scope.orgId, workspaceId: allowed.scope.workspaceId };

  const body = await readJson(request);
  if (body === INVALID_JSON || typeof body !== "object" || body === null) {
    return fail("invalid_request", "Request body must be a JSON object.", 400);
  }
  const payload = body as Record<string, unknown>;

  const table = payload.table;
  if (typeof table !== "string" || !WRITABLE_TABLES.includes(table as ArcWritableTable)) {
    return fail("invalid_request", 'Field "table" must be one of: leads, companies, contacts.', 400);
  }
  const id = payload.id;
  if (typeof id !== "string" || id.length === 0) {
    return fail("invalid_request", 'Field "id" is required.', 400);
  }
  const fields = payload.fields;
  if (typeof fields !== "object" || fields === null) {
    return fail("invalid_request", 'Field "fields" must be a JSON object.', 400);
  }

  try {
    const result = await updateArcRecord({
      table: table as ArcWritableTable,
      id,
      fields: fields as Record<string, unknown>,
      supabase: getSupabaseAdminClient(),
      orgId: allowed.scope.orgId,
    });
    if (!result.ok) return fail("failed", result.message, result.httpStatus);

    // Audit trail: log what Arc changed. Best-effort — a failed log must not fail the write.
    const summary =
      typeof payload.summary === "string" && payload.summary.length > 0
        ? payload.summary
        : `Arc updated ${Object.keys(result.applied).join(", ")}`;
    const activity = parseActivityInput({
      entityType: ENTITY_TYPE[table as ArcWritableTable],
      entityId: id,
      activityType: "arc_update",
      summary,
      actorKind: "agent",
      actorName: "Arc",
      metadata: { fields: result.applied },
    });
    if (activity.ok) {
      await insertActivity(activity.value, scope).catch(() => {});
    }

    return ok({ id: result.id, table, applied: result.applied }, 200);
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Failed to update record.", 502);
  }
}
```

- [ ] **Step 2: Verify `insertActivity` + `parseActivityInput` signatures match**

Run: `pnpm exec tsc --noEmit`
Expected: PASS. If `insertActivity` returns a result object rather than a promise that can reject, adapt the `.catch` accordingly (it is imported the same way the interactions route uses it). Confirm `parseActivityInput`'s field names against `src/app/api/v1/arc/crm/interactions/route.ts:63-73` (this handler mirrors them).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/arc/crm/records/update/route.ts
git commit -m "feat(arc-api): POST /api/v1/arc/crm/records/update — Arc edits existing records + audit log"
```

---

## Task 6: Runner tools `create_lead` + `update_record`

**Files:**
- Create: `apps/arc-runner/src/tools/crm-write.ts`
- Modify: `apps/arc-runner/src/tools/index.ts`

- [ ] **Step 1: Write the tool module**

Mirror `interactions.ts` (same `tool()` + `runTool` + `client.apiPost` pattern).

```typescript
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { ArcClient } from "../arc-client";
import { runTool, type StepFn } from "./helpers";

/**
 * Core CRM write tools (act/draft modes only). Arc can CREATE new lead bundles
 * and UPDATE existing records. Records are stamped origin=agent; updates are
 * logged to the timeline. Nothing here is outbound — a CRM record reaches no one.
 */
export function crmWriteTools(client: ArcClient, step: StepFn) {
  const createLead = tool(
    "create_lead",
    "Create a NEW lead in the CRM (company + contact + property + lead). Use when the operator asks you to add/populate a lead, or when you've found a prospect to record. Persona must be one of the official persona keys. Dedups against existing companies/contacts. The lead is internal and reaches no one. After it succeeds, emit a result card linking to the new lead.",
    {
      persona: z.string().describe("Official persona key, e.g. persona_plumbing_partner"),
      source: z.string().describe("Where this lead came from, e.g. arc_manual or arc_discovery"),
      company_name: z.string().optional(),
      partner_tier: z.enum(["A", "B", "C"]).optional(),
      contact_first_name: z.string().optional(),
      contact_last_name: z.string().optional(),
      contact_email: z.string().optional(),
      contact_phone: z.string().optional(),
      street_line_1: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional().describe("2-letter state code"),
      postal_code: z.string().optional(),
      loss_summary: z.string().optional(),
      review_status: z.enum(["active", "proposed"]).optional().describe("active (operator asked) or proposed (your own discovery)"),
      agent_confidence: z.number().optional().describe("0-1 self-rated confidence"),
    },
    async (args) =>
      runTool(step, `Creating lead${args.company_name ? ` for ${args.company_name}` : ""}`, async () => {
        const lead: Record<string, unknown> = {
          persona: args.persona,
          source: args.source,
          ...(args.company_name ? { company: { name: args.company_name, partnerTier: args.partner_tier } } : {}),
          ...(args.contact_first_name || args.contact_last_name || args.contact_email || args.contact_phone
            ? {
                contact: {
                  firstName: args.contact_first_name,
                  lastName: args.contact_last_name,
                  email: args.contact_email,
                  phone: args.contact_phone,
                },
              }
            : {}),
          ...(args.street_line_1 && args.city && args.state && args.postal_code
            ? {
                property: {
                  streetLine1: args.street_line_1,
                  city: args.city,
                  state: args.state,
                  postalCode: args.postal_code,
                },
              }
            : {}),
          ...(args.loss_summary ? { lossSummary: args.loss_summary } : {}),
        };
        return client.apiPost("/api/v1/arc/crm/leads", {
          lead,
          review_status: args.review_status ?? "active",
          agent_confidence: args.agent_confidence,
        });
      }),
  );

  const updateRecord = tool(
    "update_record",
    "Update fields on an EXISTING lead, company, or contact (e.g. fix a persona, set a status, correct contact info). Only whitelisted fields apply; the change is logged to the record timeline. Never deletes. Internal only.",
    {
      table: z.enum(["leads", "companies", "contacts"]),
      id: z.string().describe("The record id to update"),
      fields: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .describe("Column -> value map; non-whitelisted keys are ignored"),
      summary: z.string().optional().describe("Short why-note for the timeline"),
    },
    async (args) =>
      runTool(step, `Updating ${args.table} ${args.id}`, async () =>
        client.apiPost("/api/v1/arc/crm/records/update", {
          table: args.table,
          id: args.id,
          fields: args.fields,
          summary: args.summary,
        }),
      ),
  );

  return [createLead, updateRecord];
}
```

- [ ] **Step 2: Register the tools in `index.ts`**

In `apps/arc-runner/src/tools/index.ts`, add the import after line 7:

```typescript
import { crmWriteTools } from "./crm-write";
```

Then change `writeTools` (lines 44-46) to include them:

```typescript
/** Direct CRM writes + interactions + brain observations. act/draft only. */
function writeTools(client: ArcClient, step: StepFn) {
  return [
    ...crmWriteTools(client, step),
    ...brainWriteTools(client, step),
    ...interactionWriteTools(client, step),
  ];
}
```

- [ ] **Step 3: Typecheck the runner**

Run: `pnpm --filter arc-runner exec tsc --noEmit` *(or `cd apps/arc-runner && pnpm exec tsc --noEmit`)*
Expected: PASS. The new tool names `mcp__arc__create_lead` / `mcp__arc__update_record` now appear in `allowedToolNames("act")` and `allowedToolNames("draft")`.

- [ ] **Step 4: Commit**

```bash
git add apps/arc-runner/src/tools/crm-write.ts apps/arc-runner/src/tools/index.ts
git commit -m "feat(arc-runner): create_lead + update_record tools (act/draft modes)"
```

---

## Task 7: Rewrite the system prompt

This is the line that stops the refusals.

**Files:**
- Modify: `apps/arc-runner/src/prompt.ts:15`

- [ ] **Step 1: Replace the Tools paragraph**

Replace the paragraph at line 15 (`Tools: you can read the CRM ... Your available tools depend on the current mode.`) with:

```
Tools: you can read AND write across the app. You read the CRM (companies, contacts, leads, jobs, outcomes, properties), the marketing brain (knowledge graph), campaigns, and the approval queue. In act/draft mode you can also CREATE new CRM records with create_lead (a full company→contact→property→lead bundle — use this whenever the operator asks you to add or populate a lead, or when you've found a prospect worth recording), UPDATE existing records with update_record (fix a persona, set a status, correct contact info), log CRM interactions (notes, follow-up tasks, timeline activity), and record learnings/signals to the brain. Every record you create or change is stamped as your work (origin=agent) and is reversible. You PROPOSE — never commit — anything that shapes outbound or brand (brand facts, messaging angles, CTAs, proof points, campaign approval, brand-kit activation); those route to the human approval queue. You NEVER approve your own work, never send/publish/launch/spend/contact anyone, and never hard-delete a record. Always look up real data with these tools instead of inventing it, and cite what you found. Your available tools depend on the current mode.
```

- [ ] **Step 2: Typecheck (template string still valid)**

Run: `pnpm --filter arc-runner exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/arc-runner/src/prompt.ts
git commit -m "feat(arc-runner): grant read/write posture in system prompt (create + update CRM)"
```

---

## Task 8: CRM "Added by Arc" provenance pill

Surface `origin` in the record read-model and render a pill. Lightweight polish — the capability works without it, but it makes Arc's writes auditable in the UI.

**Files:**
- Modify: `src/lib/crm/read-model.ts`
- Modify: `src/app/crm/_components/crm-record-detail.tsx` (the `RecordHeaderBand` component)

- [ ] **Step 1: Inspect the read-model + header component**

Read `src/lib/crm/read-model.ts` to find the `getCrmRecordData` return type / row mapping, and `crm-record-detail.tsx` to find `RecordHeaderBand`. Identify where the record object is shaped (it already carries `label`, `quickStats`, etc.) and where the header renders the title row.

- [ ] **Step 2: Add `origin` to the record read-model**

In `src/lib/crm/read-model.ts`, where the record object is built from the Supabase row, add (the select is `*`, so `origin` is already fetched):

```typescript
// in the mapped record object:
origin: (row.origin as "operator" | "agent" | undefined) ?? "operator",
```

Add `origin: "operator" | "agent"` to the record's TypeScript type.

- [ ] **Step 3: Render the pill in `RecordHeaderBand`**

`StatusPill` is exported from `src/app/_components/page-header.tsx`. In `crm-record-detail.tsx`, import it if not already, and in `RecordHeaderBand` render, next to the title:

```tsx
{record.origin === "agent" ? <StatusPill tone="info">Added by Arc</StatusPill> : null}
```

Match the existing `StatusPill` tone prop options in `page-header.tsx` (use whichever neutral/info tone exists; do NOT invent a tone). Follow `DESIGN.md` — no emoji, Restoration Red only if that's the established accent for agent attribution.

- [ ] **Step 4: Typecheck + verify in the preview**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

Then verify visually with the preview tools: start the dev server, open a CRM lead record that was created by Arc (origin=agent), and confirm the "Added by Arc" pill renders. Use `preview_snapshot`/`preview_inspect` (not `preview_screenshot` — the particle canvas hangs it).

- [ ] **Step 5: Commit**

```bash
git add src/lib/crm/read-model.ts src/app/crm/_components/crm-record-detail.tsx
git commit -m "feat(crm-ui): 'Added by Arc' provenance pill on agent-created records"
```

---

## Task 9: Full verification pass

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: PASS (including the new `record-writes.test.ts`).

- [ ] **Step 2: Typecheck the whole app + runner**

Run: `pnpm exec tsc --noEmit` then `pnpm --filter arc-runner exec tsc --noEmit`
Expected: PASS both. (Per project memory, `pnpm lint` is eslint-only and noisy on vendored files — `tsc` is the real type gate.)

- [ ] **Step 3: Scoped lint on changed files only**

Run: `pnpm exec eslint src/lib/arc src/app/api/v1/arc/crm apps/arc-runner/src/tools/crm-write.ts`
Expected: no errors on the new files. (Scope to changed files — a full `pnpm lint` reports ~31k pre-existing vendor problems.)

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: success.

- [ ] **Step 5: Final commit (if any lint fixes were made)**

```bash
git add -A
git commit -m "chore(arc): lint/typecheck fixes for CRM write capability"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** §1 migration → Task 1. §2 substrate → Tasks 2-3. §3 routes → Tasks 4-5. §4 runner tools → Task 6. §5 full-read grant → already satisfied (read tools exist in every mode; prompt now says so) — if a *read* gap surfaces during implementation, add the read tool following `crm.ts`. §6 prompt → Task 7. §7 UI → Task 8. Second-brain integration (§ "second brain"): `record_brain_note` already exists and is unchanged; Arc records learnings via the existing tool.
- **Out of scope (confirm you did NOT build):** external discovery / prospecting, sub-agent fan-out, bulk CSV import, record deletion. These are phase 2.
- **The non-negotiable:** no tool, route, or prompt change here lets Arc self-approve, send outbound, or hard-delete. If any step seems to, stop.
- **Deploy ordering:** apply the migration to prod manually BEFORE deploying the app/runner that writes the new columns (avoids the schema-drift failure mode this repo has hit before).
```
