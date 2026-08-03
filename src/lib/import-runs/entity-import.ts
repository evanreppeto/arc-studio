import { type SupabaseClient } from "@supabase/supabase-js";

import { parseCsvDate, parseUsdToCents, type ImportEntityKind, type ParsedEntityRow } from "@/domain";

import { recordImportedRecord, type ImportRunTenant } from "./persistence";

/**
 * The entity-per-file import engine (BSR-644).
 *
 * Companies, deals and notes, resolved against the identity map so that the
 * relationships between files survive — including across separate runs. Importing
 * deals a week after contacts still attaches them to the right company, because
 * both sides are keyed on the source system's own ids rather than on names.
 *
 * Best-effort per record, matching the contacts engine: a row whose parent cannot
 * be resolved is REPORTED as a skip with the reason, never silently dropped and
 * never allowed to sink the batch. "Unresolvable references are reported, not
 * silently dropped" is the part of this that customers actually feel — a deal
 * that vanishes without explanation is indistinguishable from data loss.
 */

export type EntityImportResult = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ externalId: string; message: string }>;
};

export type EntityImportInput = {
  client: SupabaseClient;
  tenant: ImportRunTenant;
  kind: ImportEntityKind;
  rows: ParsedEntityRow[];
  externalSystemId: string | null;
  importRunId: string | null;
  /** Persona for created companies; the org's own taxonomy, not the official 12. */
  defaultPersona?: string;
  now?: string;
};

/** Which local table each entity kind writes, and the mapping key it resolves by. */
const LOCAL_TABLE: Record<ImportEntityKind, string> = {
  companies: "companies",
  deals: "jobs",
  notes: "crm_notes",
};

function emptyResult(): EntityImportResult {
  return { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
}

/**
 * Resolve source-system ids to local row ids in one read.
 *
 * Scoped by workspace as well as org: the identity map is workspace-owned
 * (BSR-637), so a company imported into one workspace must not silently satisfy a
 * deal's parent reference in another.
 */
export async function resolveExternalIds(
  client: SupabaseClient,
  tenant: ImportRunTenant,
  externalSystemId: string | null,
  objectType: string,
  externalIds: string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const ids = [...new Set(externalIds.filter(Boolean))];
  if (!externalSystemId || ids.length === 0) return found;

  try {
    const { data } = await client
      .from("external_object_mappings")
      .select("external_object_id,local_id")
      .eq("workspace_id", tenant.workspaceId)
      .eq("external_system_id", externalSystemId)
      .eq("external_object_type", objectType)
      .in("external_object_id", ids);
    for (const row of (data ?? []) as Array<{ external_object_id: string; local_id: string }>) {
      found.set(row.external_object_id, row.local_id);
    }
  } catch {
    // A failed lookup resolves nothing, so every row reports "parent not found"
    // rather than being attached to the wrong record.
  }
  return found;
}

/** Build the row this entity kind writes, or a reason it cannot be written. */
function buildRow(
  input: EntityImportInput,
  row: ParsedEntityRow,
  parents: { company?: string; contact?: string },
): { values: Record<string, unknown> } | { reason: string } {
  const v = row.values;
  const orgId = input.tenant.orgId;

  if (input.kind === "companies") {
    return {
      values: {
        org_id: orgId,
        name: v.name,
        website_url: v.website ?? null,
        phone: v.phone ?? null,
        email: v.email ?? null,
        ...(input.defaultPersona ? { persona: input.defaultPersona } : {}),
        origin: "operator",
      },
    };
  }

  if (input.kind === "deals") {
    // A deal with an unresolvable company still has value on its own, but silently
    // orphaning it is what the ticket calls out. Only refuse when the file NAMED a
    // company we could not find — a deal with no company column is fine.
    if (v.companyExternalId && !parents.company) {
      return { reason: `company ${v.companyExternalId} not found — import the companies file first` };
    }
    return {
      values: {
        org_id: orgId,
        company_id: parents.company ?? null,
        job_number: v.name,
        status: v.status?.toLowerCase() || "pending",
        estimated_revenue_cents: parseUsdToCents(v.valueUsd),
        scheduled_at: parseCsvDate(v.scheduledAt) ?? null,
        completed_at: parseCsvDate(v.closedAt) ?? null,
        ...(input.defaultPersona ? { persona: input.defaultPersona } : {}),
      },
    };
  }

  // notes — must attach to something, or there is nowhere to show them.
  const entityId = parents.contact ?? parents.company;
  if (!entityId) {
    const named = v.contactExternalId ?? v.companyExternalId;
    return {
      reason: named
        ? `${v.contactExternalId ? "contact" : "company"} ${named} not found — import that file first`
        : "no company or contact to attach this note to",
    };
  }
  return {
    values: {
      org_id: orgId,
      // "lead" because that is what a contact reference resolves to — see the
      // lookup above. crm_entity_type has no "contact-via-lead" member, and lead
      // is where the imported person actually lives.
      entity_type: parents.contact ? "lead" : "company",
      entity_id: entityId,
      body: v.body,
      author_kind: "human",
      author_name: v.author ?? null,
      is_pinned: false,
      is_internal: true,
      ...(parseCsvDate(v.createdAt) ? { created_at: parseCsvDate(v.createdAt) } : {}),
    },
  };
}

/**
 * Import one entity file. Resolves parents, writes through the identity map so a
 * re-import updates in place, and records provenance for each affected row.
 */
export async function importEntityRows(input: EntityImportInput): Promise<EntityImportResult> {
  const result = emptyResult();
  if (input.rows.length === 0) return result;

  const table = LOCAL_TABLE[input.kind];

  // Three lookups, not three-per-row: our own ids for these rows, plus the
  // parents they reference.
  const [selfIds, companyParents, contactParents] = await Promise.all([
    resolveExternalIds(input.client, input.tenant, input.externalSystemId, table, input.rows.map((r) => r.externalId)),
    resolveExternalIds(
      input.client, input.tenant, input.externalSystemId, "companies",
      input.rows.map((r) => r.values.companyExternalId ?? ""),
    ),
    // Deliberately "leads", not "contacts". The contacts importer creates a lead
    // (with a contact attached) and records the source id against the LEAD, so
    // that is the only key a contact reference can resolve through. Looking up
    // "contacts" would compile, run, and never match anything — a dead reference
    // path that silently orphans every note.
    resolveExternalIds(
      input.client, input.tenant, input.externalSystemId, "leads",
      input.rows.map((r) => r.values.contactExternalId ?? ""),
    ),
  ]);

  for (const row of input.rows) {
    const parents = {
      company: row.values.companyExternalId ? companyParents.get(row.values.companyExternalId) : undefined,
      contact: row.values.contactExternalId ? contactParents.get(row.values.contactExternalId) : undefined,
    };

    const built = buildRow(input, row, parents);
    if ("reason" in built) {
      result.skipped += 1;
      result.errors.push({ externalId: row.externalId || "(no id)", message: built.reason });
      continue;
    }

    const existingId = row.externalId ? selfIds.get(row.externalId) : undefined;

    try {
      let localId: string;
      if (existingId) {
        const { error } = await input.client
          .from(table)
          .update(built.values)
          .eq("id", existingId)
          .eq("org_id", input.tenant.orgId);
        if (error) throw new Error(error.message);
        localId = existingId;
        result.updated += 1;
      } else {
        const { data, error } = await input.client
          .from(table)
          .insert(built.values)
          .select("id")
          .single<{ id: string }>();
        if (error || !data?.id) throw new Error(error?.message ?? "insert returned no id");
        localId = data.id;
        result.created += 1;
      }

      if (input.importRunId) {
        await recordImportedRecord(
          input.tenant,
          {
            importRunId: input.importRunId,
            localTable: table,
            localId,
            externalId: row.externalId || null,
            action: existingId ? "updated" : "created",
            previous: null,
          },
          input.externalSystemId,
          input.client,
        );
      }
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        externalId: row.externalId || "(no id)",
        message: error instanceof Error ? error.message : "write failed",
      });
    }
  }

  return result;
}
