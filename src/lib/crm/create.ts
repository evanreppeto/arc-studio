import { isAllowedPersona } from "@/domain";
import { getCurrentOrgId } from "@/lib/auth/org";
import { syncRecordToBrain } from "@/lib/brain-ingestion/sync";
import { getOrgPersonaKeys } from "@/lib/personas/read-model";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { findExistingContactByEmail } from "./dedupe";
import { type CrmObjectKey } from "./read-model";

export type CreateCrmInput = {
  /** Tenant-defined custom field values, keyed by field key (BSR-493). */
  customFields?: Record<string, unknown>;
  objectKey: CrmObjectKey;
  /** Primary display name / title. Required. */
  name: string;
  /** Official persona key (e.g. persona_homeowner_emergency) or "" for none. */
  persona?: string;
  /** Lifecycle status; each object falls back to a sensible default when blank. */
  status?: string;
  /** Secondary field — email (contacts), website (companies), source (leads). */
  detail?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  /** Parent record to link (leads → company/contact/property; outcomes → job/lead). */
  parentType?: string;
  parentId?: string;
  /** Audit label for metadata.owner. */
  owner?: string;
};

// Parent link type → the FK column it fills. Leads and outcomes carry a DB check
// constraint requiring at least one of these.
const PARENT_COLUMN: Record<string, string> = {
  company: "company_id",
  contact: "contact_id",
  property: "property_id",
  job: "job_id",
  lead: "lead_id",
};

export type CreateCrmResult = { ok: true; id: string } | { ok: false; error: string };

const NOT_CONFIGURED = "Supabase is not configured, so nothing was written.";

/**
 * Mirror an operator's CRM write into the Brain, so what a human types becomes memory
 * Arc can recall — exactly as Arc's own edits already do (`lib/arc/record-writes.ts`).
 * Without this the identical edit fed Arc's memory when Arc made it and vanished when
 * a person made it, until someone happened to press "Refresh memory" on the Brain page.
 *
 * Lives here rather than in the server actions so it covers every caller of this layer,
 * and because a write's consequences belong with the write.
 *
 * Awaited, not fire-and-forget: a server action's runtime can freeze once it returns,
 * which would silently drop the sync — the failure mode this is fixing. It costs the
 * save an upsert plus (only when the text changed) one embed call. Best-effort: the row
 * is already committed and a Brain hiccup must never fail it, since a missed node is
 * recoverable from the next sync or the Brain page's backfill, and a lost CRM write is not.
 */
async function mirrorToBrainBestEffort(objectKey: CrmObjectKey, recordId: string, orgId: string): Promise<void> {
  try {
    await syncRecordToBrain(objectKey, recordId, { orgId });
  } catch {
    /* ignore — the record write already succeeded; see above */
  }
}

/**
 * Insert a new operator-created CRM record. Mirrors src/lib/interactions
 * persistence: self-guards on isSupabaseAdminConfigured(), org-scopes the write,
 * and stamps origin:'operator' so the record reads as human- (not Arc-) created.
 * Persona is only written when it belongs to the org's own taxonomy (its active
 * personas) — never the internal `unassigned_persona`, which the DB check
 * constraint rejects. Column sets are kept to the fields the read-model selects.
 */
export async function insertCrmRecord(input: CreateCrmInput, orgId?: string): Promise<CreateCrmResult> {
  if (!isSupabaseAdminConfigured()) return { ok: false, error: NOT_CONFIGURED };

  const scopedOrgId = orgId ?? (await getCurrentOrgId());
  const supabase = getSupabaseAdminClient();
  // Persona is validated against the org's own taxonomy (its active personas),
  // not a fixed BSR set — an unknown/foreign key drops to null.
  const allowedKeys = await getOrgPersonaKeys(scopedOrgId);
  const persona = input.persona && isAllowedPersona(input.persona, allowedKeys) ? input.persona : null;
  // Leads carry a NOT NULL persona with no default, so they need a real one.
  if (input.objectKey === "leads" && !persona) {
    return { ok: false, error: "Choose a persona defined for your workspace." };
  }
  const metadata: Record<string, unknown> = input.owner ? { owner: input.owner } : {};
  const detail = input.detail?.trim() || null;

  // Dedup: a contact's `detail` is its email. Re-adding someone who is already in
  // the CRM used to silently create a second row; surface the clash instead and let
  // the operator decide (open the existing one, or use a different address) rather
  // than silently returning someone else's record from a "create".
  if (input.objectKey === "contacts") {
    const existing = await findExistingContactByEmail(supabase, scopedOrgId, detail);
    if (existing) {
      return { ok: false, error: `${existing.name} already uses that email — open that contact instead of adding a second one.` };
    }
  }

  const { table, row } = buildInsert(input, scopedOrgId, persona, metadata, detail);

  const { data, error } = await supabase
    .from(table)
    .insert(row as never)
    .select("id")
    .single<{ id: string }>();
  if (error) return { ok: false, error: error.message };
  await mirrorToBrainBestEffort(input.objectKey, data.id, scopedOrgId);
  return { ok: true, id: data.id };
}

function buildInsert(
  input: CreateCrmInput,
  orgId: string,
  persona: string | null,
  metadata: Record<string, unknown>,
  detail: string | null,
): { table: CrmObjectKey; row: Record<string, unknown> } {
  const name = input.name.trim();
  // Only write `persona` when we actually have one. Some tables (companies,
  // contacts) have persona NOT NULL WITH a default — explicitly inserting null
  // violates the constraint, so omit the key and let the default apply. Leads
  // require a real persona and the action guarantees one is present.
  const base: Record<string, unknown> = { org_id: orgId, metadata };
  if (persona) base.persona = persona;

  // Parent FK for leads/outcomes (satisfies the relationship check constraint).
  const parentCol = input.parentType ? PARENT_COLUMN[input.parentType] : undefined;
  const parentLink: Record<string, unknown> = parentCol && input.parentId ? { [parentCol]: input.parentId } : {};

  switch (input.objectKey) {
    case "companies":
      return {
        table: "companies",
        row: { ...base, name, status: input.status || "active", website_url: detail, origin: "operator" },
      };
    case "contacts": {
      // full_name is a GENERATED column (first + last) — never insert it directly.
      const [first, ...rest] = name.split(/\s+/);
      return {
        table: "contacts",
        row: {
          ...base,
          first_name: first ?? name,
          last_name: rest.join(" ") || null,
          email: detail,
          status: input.status || "active",
          origin: "operator",
        },
      };
    }
    case "properties":
      // city / state / postal_code are NOT NULL in the DB — the modal requires them.
      return {
        table: "properties",
        row: {
          ...base,
          street_line_1: name,
          city: input.city?.trim() || "",
          state: input.state?.trim() || "",
          postal_code: input.postalCode?.trim() || "",
          origin: "operator",
        },
      };
    case "leads":
      return {
        table: "leads",
        row: {
          ...base,
          ...parentLink,
          loss_summary: name,
          source: detail || "manual",
          status: input.status || "new",
          received_at: new Date().toISOString(),
          origin: "operator",
        },
      };
    case "jobs":
      // jobs/outcomes have no `origin` column in the read-model contract.
      return {
        table: "jobs",
        row: { ...base, job_number: name, status: input.status || "scheduled" },
      };
    case "outcomes":
      return {
        table: "outcomes",
        row: { ...base, ...parentLink, status: input.status || "won", metadata: { ...metadata, title: name } },
      };
  }
}

/**
 * Update the editable fields of a CRM record (persona and/or status). Org-scoped;
 * persona is only applied when it belongs to the org's own taxonomy. Table name
 * is the objectKey (companies/contacts/…). Returns the row id.
 */
export async function updateCrmRecordFields(
  objectKey: CrmObjectKey,
  recordId: string,
  patch: { persona?: string; status?: string },
  orgId?: string,
): Promise<CreateCrmResult> {
  if (!isSupabaseAdminConfigured()) return { ok: false, error: NOT_CONFIGURED };

  const scopedOrgId = orgId ?? (await getCurrentOrgId());
  const row: Record<string, unknown> = {};
  if (patch.persona && isAllowedPersona(patch.persona, await getOrgPersonaKeys(scopedOrgId))) row.persona = patch.persona;
  if (patch.status?.trim()) row.status = patch.status.trim();
  if (Object.keys(row).length === 0) return { ok: false, error: "Nothing to update." };

  const { data, error } = await getSupabaseAdminClient()
    .from(objectKey)
    .update(row as never)
    .eq("id", recordId)
    .eq("org_id", scopedOrgId)
    .select("id")
    .single<{ id: string }>();
  if (error) return { ok: false, error: error.message };
  await mirrorToBrainBestEffort(objectKey, data.id, scopedOrgId);
  return { ok: true, id: data.id };
}

/**
 * Set one persona on many records of a single object in a single org-scoped update.
 * Skips optimistic/local ids (never persisted). Validates the persona against the
 * workspace's own taxonomy. Returns how many rows the DB actually matched.
 */
export async function bulkUpdateCrmPersona(
  objectKey: CrmObjectKey,
  ids: string[],
  persona: string,
  orgId?: string,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (!isSupabaseAdminConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const cleanIds = [...new Set(ids.map((id) => id.trim()).filter((id) => id && !id.startsWith("local-")))];
  if (cleanIds.length === 0) return { ok: true, count: 0 };
  const scopedOrgId = orgId ?? (await getCurrentOrgId());
  if (!isAllowedPersona(persona, await getOrgPersonaKeys(scopedOrgId))) return { ok: false, error: "Choose a valid persona." };

  const { data, error } = await getSupabaseAdminClient()
    .from(objectKey)
    .update({ persona } as never)
    .in("id", cleanIds)
    .eq("org_id", scopedOrgId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  const updated = (data as { id: string }[] | null) ?? [];
  await Promise.all(updated.map((r) => mirrorToBrainBestEffort(objectKey, r.id, scopedOrgId)));
  return { ok: true, count: updated.length };
}
