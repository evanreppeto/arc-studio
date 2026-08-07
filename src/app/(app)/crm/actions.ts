"use server";

import { revalidatePath } from "next/cache";

import { type SupabaseClient } from "@supabase/supabase-js";

import { entityTypeFromCrmObjectKey, parseTaskInput } from "@/domain";
import { addContactsToCampaignAudience } from "@/lib/audience/campaign-audience";
import { getOperatorActor, requireOperator } from "@/lib/auth/operator";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getCurrentOrgId } from "@/lib/auth/org";
import { bulkUpdateCrmPersona, type CreateCrmInput, insertCrmRecord } from "@/lib/crm/create";
import { insertTask } from "@/lib/interactions/persistence";
import { listArchivedCrmObjectRows, searchCrmObjectRows, type CrmObjectKey } from "@/lib/crm/read-model";
import { archiveCrmRecords, restoreCrmRecords } from "@/lib/crm/archive";
import { getCustomObjectByKey } from "@/lib/custom-objects/definitions";
import { createCustomRecord, listCustomRecords, setCustomRecordsArchived } from "@/lib/custom-objects/records";
import { customRecordToRow } from "./_data/custom-row-vm";

import { toRow } from "./_data/row-vm";
import { type CrmRowVM } from "./_components/crm-board";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";
import type { CustomFieldObjectKey, CustomObject } from "@/domain";
import { saveCustomFieldValues, validateCustomFieldValues } from "@/lib/custom-fields/values";

/**
 * Reach a CRM record the board never loaded (BSR-633).
 *
 * The board fetches a 1,000-row recency window and filters it in the browser, so
 * on a workspace with more records than that, everything past the window is
 * unsearchable — while the row counter, a real COUNT, says it exists. Measured
 * at 2,719 contacts: 63% of them were unreachable.
 *
 * Read-only and operator-gated. `capped` tells the UI the match set itself hit
 * the ceiling, so it can say so rather than imply the results are exhaustive —
 * the same no-silent-caps rule the Brain's search follows.
 */
export type CrmSearchActionResult =
  | { ok: true; rows: CrmRowVM[]; capped: boolean }
  | { ok: false; error: string };

export async function searchCrmRecords(objectKey: string, query: string): Promise<CrmSearchActionResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: true, rows: [], capped: false };

  const orgId = await getCurrentOrgId();
  const result = await searchCrmObjectRows(objectKey as CrmObjectKey, query, orgId);
  if (result.status !== "live") return { ok: false, error: result.message };
  // Mapped with the SAME function the page uses, so a search result is
  // indistinguishable from a row that was already on screen.
  return { ok: true, rows: result.rows.map(toRow), capped: result.capped };
}

/**
 * Real operator write for the CRM board's "Add {record}" button. A new CRM
 * record is internal (never outbound) so it persists directly — through
 * requireOperator() + org-scoped persistence, stamped origin:'operator'.
 * `persisted: false` is the honest offline/demo signal: the board may show the
 * new row optimistically without claiming it was saved.
 */
export type CreateResult =
  | { ok: true; persisted: boolean; id?: string }
  | { ok: false; error: string };

const VALID_KEYS = new Set<CrmObjectKey>([
  "companies",
  "contacts",
  "properties",
  "leads",
  "jobs",
  "outcomes",
]);

const LEAD_PARENTS = new Set(["company", "contact", "property"]);
const OUTCOME_PARENTS = new Set(["job", "lead"]);

export type BulkPersonaResult =
  | { ok: true; persisted: boolean; count?: number }
  | { ok: false; error: string };

/**
 * Bulk-assign one persona to the selected records (the CRM board's selection bar).
 * Internal only — never outbound. requireOperator() + org-scoped, and the persona
 * is validated against the workspace's taxonomy. `persisted: false` is the honest
 * offline/demo signal so the board can reflect it optimistically.
 */
export async function bulkAssignPersona(objectKey: string, ids: string[], persona: string): Promise<BulkPersonaResult> {
  await requireOperator();
  if (!VALID_KEYS.has(objectKey as CrmObjectKey)) return { ok: false, error: "Unknown record type." };
  if (!persona?.trim()) return { ok: false, error: "Choose a persona." };
  if (!ids?.length) return { ok: false, error: "Select at least one record." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const orgId = await getCurrentOrgId();
  const res = await bulkUpdateCrmPersona(objectKey as CrmObjectKey, ids, persona.trim(), orgId);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/crm");
  return { ok: true, persisted: true, count: res.count };
}

export type ArchiveActionResult =
  | { ok: true; persisted: boolean; count: number }
  | { ok: false; error: string };

/**
 * Archive the selected records — this CRM's delete.
 *
 * There was no delete at all before this. The only way to remove a record was
 * to open it, edit it, and set Status to "archived", which the form offered on
 * three of the six objects; properties, jobs and outcomes had no route to it
 * whatsoever. Archiving is now a column rather than a status, so all six behave
 * the same and a tenant renaming a pipeline stage cannot change what archived
 * means.
 *
 * Nothing is destroyed — `restoreCrmRecordsAction` puts them back.
 */
export async function archiveCrmRecordsAction(objectKey: string, ids: string[]): Promise<ArchiveActionResult> {
  await requireOperator();
  if (!VALID_KEYS.has(objectKey as CrmObjectKey)) return { ok: false, error: "Unknown record type." };
  if (!ids?.length) return { ok: false, error: "Select at least one record." };
  // Optimistic rows aren't saved yet, so there is nothing to archive: dropping
  // them is the client's job, and passing a "local-" id to Postgres is a
  // guaranteed uuid syntax error rather than a no-op.
  const saved = ids.filter((id) => !id.startsWith("local-"));
  if (!saved.length) return { ok: true, persisted: false, count: 0 };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false, count: 0 };

  const orgId = await getCurrentOrgId();
  const res = await archiveCrmRecords(objectKey as CrmObjectKey, saved, orgId);
  if (!res.ok) return res;
  revalidatePath("/crm");
  revalidatePath(`/crm/${objectKey}`);
  return res;
}

/** Bring archived records back into every list and count. */
export async function restoreCrmRecordsAction(objectKey: string, ids: string[]): Promise<ArchiveActionResult> {
  await requireOperator();
  if (!VALID_KEYS.has(objectKey as CrmObjectKey)) return { ok: false, error: "Unknown record type." };
  if (!ids?.length) return { ok: false, error: "Select at least one record." };
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false, count: 0 };

  const orgId = await getCurrentOrgId();
  const res = await restoreCrmRecords(objectKey as CrmObjectKey, ids, orgId);
  if (!res.ok) return res;
  revalidatePath("/crm");
  revalidatePath(`/crm/${objectKey}`);
  return res;
}

/** The archived records for one object, so they can be reviewed and restored. */
export async function listArchivedCrmRecords(objectKey: string): Promise<CrmSearchActionResult> {
  await requireOperator();
  if (!VALID_KEYS.has(objectKey as CrmObjectKey)) return { ok: false, error: "Unknown record type." };
  if (!isSupabaseAdminConfigured()) return { ok: true, rows: [], capped: false };

  const orgId = await getCurrentOrgId();
  const result = await listArchivedCrmObjectRows(objectKey as CrmObjectKey, orgId);
  if (result.status !== "live") return { ok: false, error: result.message };
  return { ok: true, rows: result.rows.map(toRow), capped: result.capped };
}

export type BulkTaskResult =
  | { ok: true; persisted: boolean; count?: number }
  | { ok: false; error: string };

/**
 * Add the same follow-up task to each selected record (the CRM board's selection
 * bar). Internal only — tasks never go outbound. requireOperator() + org-scoped
 * per insert. Optimistic/local ids are skipped (they aren't saved yet). Loops the
 * single-record insert — the selection is a handful of records, low frequency.
 */
export async function bulkAddTask(objectKey: string, ids: string[], title: string): Promise<BulkTaskResult> {
  await requireOperator();
  if (!VALID_KEYS.has(objectKey as CrmObjectKey)) return { ok: false, error: "Unknown record type." };
  const entityType = entityTypeFromCrmObjectKey(objectKey);
  if (!entityType) return { ok: false, error: "Unknown record type." };
  const body = title?.trim();
  if (!body) return { ok: false, error: "Enter a task." };
  const cleanIds = [...new Set(ids.map((id) => id.trim()).filter((id) => id && !id.startsWith("local-")))];
  if (cleanIds.length === 0) return { ok: false, error: "Select at least one saved record." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const ctx = await getCurrentWorkspaceContext();
  const scope = { orgId: ctx.orgId, workspaceId: ctx.workspaceId ?? undefined };
  const actor = await getOperatorActor();

  let count = 0;
  for (const recordId of cleanIds) {
    const parsed = parseTaskInput({
      entityType,
      entityId: recordId,
      title: body,
      authorKind: "human",
      authorName: actor,
      assigneeKind: "human",
      assigneeName: actor,
    });
    if (!parsed.ok) continue;
    const result = await insertTask(parsed.value, scope);
    if (result.ok) count += 1;
  }
  if (count === 0) return { ok: false, error: "Could not add the task." };
  revalidatePath("/crm");
  return { ok: true, persisted: true, count };
}

export type AddToCampaignResult =
  | { ok: true; persisted: boolean; total?: number }
  | { ok: false; error: string };

/**
 * Bulk "Add to campaign" (contacts only — a campaign's audience is contacts). Adds
 * the selected contacts to the chosen campaign's manual audience. Nothing outbound —
 * membership only; the approval + send gates are unchanged. The campaign is verified
 * to be the operator's org (the tenant gate, since campaign_audiences has no org_id).
 */
export async function bulkAddContactsToCampaign(campaignId: string, contactIds: string[]): Promise<AddToCampaignResult> {
  await requireOperator();
  if (!campaignId?.trim()) return { ok: false, error: "Choose a campaign." };
  if (!contactIds?.length) return { ok: false, error: "Select at least one contact." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const orgId = await getCurrentOrgId();
  // The generic client — campaign_audiences isn't in the generated types, and the
  // ownership query filters org_id (the tenant gate). Matches campaign-audience.ts.
  const client = getSupabaseAdminClient() as unknown as SupabaseClient;
  const { data: campaign, error } = await client
    .from("campaigns")
    .select("persona")
    .eq("id", campaignId.trim())
    .eq("org_id", orgId)
    .maybeSingle<{ persona: string }>();
  if (error) return { ok: false, error: error.message };
  if (!campaign?.persona) return { ok: false, error: "That campaign isn't in this workspace." };

  const res = await addContactsToCampaignAudience(client, campaignId.trim(), campaign.persona, contactIds);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/crm");
  revalidatePath(`/campaigns/${campaignId.trim()}`);
  return { ok: true, persisted: true, total: res.total };
}

export async function createCrmRecord(input: CreateCrmInput): Promise<CreateResult> {
  await requireOperator();

  if (!VALID_KEYS.has(input.objectKey)) return { ok: false, error: "Unknown record type." };
  const name = input.name?.trim();
  if (!name) return { ok: false, error: "A name is required." };

  // Enforce the object's DB-required columns / check constraints up front (they'd
  // otherwise fail the real insert after the optimistic row).
  // A lead requires a persona (NOT NULL). Validity against the org's taxonomy is
  // enforced in insertCrmRecord, which has the org scope to check it.
  if (input.objectKey === "leads" && !input.persona?.trim()) {
    return { ok: false, error: "A lead needs a persona." };
  }
  if (input.objectKey === "properties" && !(input.city?.trim() && input.state?.trim() && input.postalCode?.trim())) {
    return { ok: false, error: "A property needs a city, state, and ZIP." };
  }
  // Leads and outcomes carry a "must link a parent" check constraint.
  if (input.objectKey === "leads" && !LEAD_PARENTS.has(input.parentType ?? "")) {
    return { ok: false, error: "Link the lead to a company, contact, or property." };
  }
  if (input.objectKey === "outcomes" && !OUTCOME_PARENTS.has(input.parentType ?? "")) {
    return { ok: false, error: "Link the outcome to a job or lead." };
  }
  if ((input.objectKey === "leads" || input.objectKey === "outcomes") && !input.parentId) {
    return { ok: false, error: "Choose a record to link to." };
  }

  const actor = await getOperatorActor();

  // Offline/demo: no DB to write to. Report success-but-unpersisted so the board
  // can show the record without claiming it was saved.
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const ctx = await getCurrentWorkspaceContext();

  // Validate the tenant's own custom fields BEFORE inserting, for the same
  // reason the built-in constraints are checked above: a value rejected after
  // the insert would leave a created record missing fields its tenant marked
  // required, with no obvious way for the operator to tell what happened.
  // Always validated, even when the form supplied nothing: a field the tenant
  // marked required must be enforced regardless of what the caller sent, or
  // "required" would only bind callers that happened to include the key.
  const customValues = input.customFields ?? {};
  const valid = await validateCustomFieldValues(
    ctx.orgId,
    input.objectKey as CustomFieldObjectKey,
    customValues,
  ).catch(() => ({ ok: true }) as const);
  if (!valid.ok) return { ok: false, error: valid.error };

  const result = await insertCrmRecord({ ...input, name, owner: actor }, ctx.orgId);
  if (!result.ok) return { ok: false, error: result.error };

  // Values are already validated, so this only fails on a genuine write error.
  // Say so rather than reporting a clean create — the record exists either way,
  // and silently dropping the custom values is how data goes quietly missing.
  let customFieldsSaved = true;
  if (result.id && Object.keys(customValues).length > 0) {
    const saved = await saveCustomFieldValues(
      ctx.orgId,
      input.objectKey as CustomFieldObjectKey,
      result.id,
      customValues,
    ).catch(() => ({ ok: false }) as const);
    customFieldsSaved = saved.ok;
  }

  revalidatePath("/crm");
  if (!customFieldsSaved) {
    return { ok: false, error: "The record was created, but its custom fields could not be saved. Open the record to add them." };
  }
  return { ok: true, persisted: true, id: result.id };
}

/* ── Tenant-defined object types ──────────────────────────────────────────────
 *
 * Custom objects are rows, not tables, so none of the paths above reach them —
 * every one of those resolves `objectKey` to a real table name. These are the
 * parallel writes for a record of a tenant-defined type. Same gate, same
 * org-scoping, same archive semantics.
 */

// Explicit union: inferred from the returns, TypeScript widens each branch with
// the other's keys as optional-undefined, and `"error" in scope` then narrows
// nothing — every caller below reads scope.orgId as possibly undefined.
type ResolvedObject = { error: string } | { orgId: string; object: CustomObject };

async function resolveObject(objectKey: string): Promise<ResolvedObject> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return { error: "Could not resolve your workspace." };
  const object = await getCustomObjectByKey(orgId, objectKey).catch(() => null);
  if (!object) return { error: "That record type no longer exists." };
  return { orgId, object };
}

export async function createCustomObjectRecord(input: {
  objectKey: string;
  title: string;
  subtitle?: string;
}): Promise<CreateResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const scope = await resolveObject(input.objectKey);
  if ("error" in scope) return { ok: false, error: scope.error };

  const res = await createCustomRecord(scope.orgId, scope.object, {
    title: input.title,
    subtitle: input.subtitle,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/crm");
  revalidatePath(`/crm/${input.objectKey}`);
  return { ok: true, persisted: res.persisted, id: res.id };
}

export async function archiveCustomObjectRecords(objectKey: string, ids: string[]): Promise<ArchiveActionResult> {
  await requireOperator();
  if (!ids?.length) return { ok: false, error: "Select at least one record." };
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false, count: 0 };

  const scope = await resolveObject(objectKey);
  if ("error" in scope) return { ok: false, error: scope.error };

  const res = await setCustomRecordsArchived(scope.orgId, scope.object, ids, true);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/crm");
  revalidatePath(`/crm/${objectKey}`);
  return { ok: true, persisted: res.persisted, count: res.count ?? 0 };
}

export async function restoreCustomObjectRecords(objectKey: string, ids: string[]): Promise<ArchiveActionResult> {
  await requireOperator();
  if (!ids?.length) return { ok: false, error: "Select at least one record." };
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false, count: 0 };

  const scope = await resolveObject(objectKey);
  if ("error" in scope) return { ok: false, error: scope.error };

  const res = await setCustomRecordsArchived(scope.orgId, scope.object, ids, false);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/crm");
  revalidatePath(`/crm/${objectKey}`);
  return { ok: true, persisted: res.persisted, count: res.count ?? 0 };
}

/** Archived records of a custom object, for the board's Archived view. */
export async function listArchivedCustomObjectRecords(objectKey: string): Promise<CrmSearchActionResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: true, rows: [], capped: false };

  const scope = await resolveObject(objectKey);
  if ("error" in scope) return { ok: false, error: scope.error };

  try {
    const rows = await listCustomRecords(scope.orgId, scope.object, { archived: true });
    return { ok: true, rows: rows.map((r) => customRecordToRow(scope.object.key, r)), capped: false };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not load archived records." };
  }
}
