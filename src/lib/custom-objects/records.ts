import { type SupabaseClient } from "@supabase/supabase-js";

import { parseCustomRecord, type CustomObject } from "@/domain";

import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";

import { demoCustomRecords } from "./demo";

const TABLE = "custom_object_records";

export type CustomRecord = {
  id: string;
  title: string;
  subtitle: string | null;
  updatedAt: string;
  createdAt: string;
  archivedAt: string | null;
  origin: string;
};

export type RecordWriteResult =
  | { ok: true; persisted: boolean; id?: string; count?: number }
  | { ok: false; error: string };

function rowToRecord(row: Record<string, unknown>): CustomRecord {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    subtitle: row.subtitle == null ? null : String(row.subtitle),
    updatedAt: String(row.updated_at ?? row.created_at ?? ""),
    createdAt: String(row.created_at ?? ""),
    archivedAt: row.archived_at == null ? null : String(row.archived_at),
    origin: String(row.origin ?? "operator"),
  };
}

function serveDemo(client?: SupabaseClient): boolean {
  return !client && !isSupabaseAdminConfigured() && isDemoDataEnabled();
}

/** How many rows a list fetches at once — mirrors the CRM board's own window. */
export const CUSTOM_RECORD_LIMIT = 1000;

export async function listCustomRecords(
  orgId: string,
  object: CustomObject,
  opts: { archived?: boolean; client?: SupabaseClient } = {},
): Promise<CustomRecord[]> {
  if (serveDemo(opts.client)) {
    if (opts.archived) return [];
    return demoCustomRecords(object.key).map((r) => ({
      ...r,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      archivedAt: null,
      origin: "operator",
    }));
  }
  if (!orgId) return [];

  const client = opts.client ?? getSupabaseAdminClient();
  let query = client
    .from(TABLE)
    .select("id,title,subtitle,updated_at,created_at,archived_at,origin")
    .eq("org_id", orgId)
    .eq("object_id", object.id);

  // Archived means the same thing here as on the six: out of every list and
  // count, restorable, reachable only by asking for it.
  query = opts.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);

  const { data, error } = await query
    .order(opts.archived ? "archived_at" : "updated_at", { ascending: false })
    .limit(CUSTOM_RECORD_LIMIT);
  if (error) throw new Error(`Failed to load ${object.labelPlural}: ${error.message}`);
  return (data ?? []).map((row) => rowToRecord(row as Record<string, unknown>));
}

export async function countCustomRecords(
  orgId: string,
  object: CustomObject,
  opts: { client?: SupabaseClient } = {},
): Promise<number> {
  if (serveDemo(opts.client)) return demoCustomRecords(object.key).length;
  if (!orgId) return 0;
  const client = opts.client ?? getSupabaseAdminClient();
  const { count, error } = await client
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("object_id", object.id)
    .is("archived_at", null);
  if (error) throw new Error(`Failed to count ${object.labelPlural}: ${error.message}`);
  return count ?? 0;
}

export async function getCustomRecord(
  orgId: string,
  object: CustomObject,
  recordId: string,
  opts: { client?: SupabaseClient } = {},
): Promise<CustomRecord | null> {
  if (serveDemo(opts.client)) {
    const hit = demoCustomRecords(object.key).find((r) => r.id === recordId);
    return hit
      ? { ...hit, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), archivedAt: null, origin: "operator" }
      : null;
  }
  if (!orgId) return null;
  const client = opts.client ?? getSupabaseAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select("id,title,subtitle,updated_at,created_at,archived_at,origin")
    .eq("org_id", orgId)
    .eq("object_id", object.id)
    .eq("id", recordId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load that record: ${error.message}`);
  return data ? rowToRecord(data as Record<string, unknown>) : null;
}

export async function createCustomRecord(
  orgId: string,
  object: CustomObject,
  input: { title?: string; subtitle?: string | null },
  opts: { client?: SupabaseClient } = {},
): Promise<RecordWriteResult> {
  const parsed = parseCustomRecord(input, object.labelSingular);
  if (!parsed.ok) return parsed;
  if (!orgId) return { ok: false, error: "Could not resolve your workspace." };
  if (!opts.client && !isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const client = opts.client ?? getSupabaseAdminClient();
  // Org-scoped, no workspace_id: these are customer/business records like the
  // six, which are all "org" in the tenancy contract.
  const { data, error } = await client
    .from(TABLE)
    .insert({
      org_id: orgId,
      object_id: object.id,
      title: parsed.value.title,
      subtitle: parsed.value.subtitle,
      origin: "operator",
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: `Could not save that ${object.labelSingular.toLowerCase()}: ${error.message}` };
  return { ok: true, persisted: true, id: String((data as { id: string }).id) };
}

export async function updateCustomRecord(
  orgId: string,
  object: CustomObject,
  recordId: string,
  input: { title?: string; subtitle?: string | null },
  opts: { client?: SupabaseClient } = {},
): Promise<RecordWriteResult> {
  if (!orgId) return { ok: false, error: "Could not resolve your workspace." };
  if (!opts.client && !isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) {
    const parsed = parseCustomRecord({ title: input.title }, object.labelSingular);
    if (!parsed.ok) return parsed;
    patch.title = parsed.value.title;
  }
  if (input.subtitle !== undefined) patch.subtitle = input.subtitle?.trim() || null;

  const client = opts.client ?? getSupabaseAdminClient();
  const { error } = await client
    .from(TABLE)
    .update(patch)
    .eq("id", recordId)
    .eq("org_id", orgId)
    .eq("object_id", object.id);
  if (error) return { ok: false, error: `Could not save that change: ${error.message}` };
  return { ok: true, persisted: true };
}

/**
 * Archive/restore, org-scoped on the WRITE. Same shape as the six: the count
 * returned is what came back, not what was asked for, so an id belonging to
 * another tenant reports zero rather than claiming success.
 */
export async function setCustomRecordsArchived(
  orgId: string,
  object: CustomObject,
  ids: string[],
  archived: boolean,
  opts: { client?: SupabaseClient } = {},
): Promise<RecordWriteResult> {
  if (ids.length === 0) return { ok: true, persisted: false, count: 0 };
  if (!orgId) return { ok: false, error: "Could not resolve your workspace." };
  const saved = ids.filter((id) => !id.startsWith("local-") && !id.startsWith("demo-"));
  if (saved.length === 0) return { ok: true, persisted: false, count: 0 };
  if (!opts.client && !isSupabaseAdminConfigured()) return { ok: true, persisted: false, count: 0 };

  const client = opts.client ?? getSupabaseAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .in("id", saved)
    .eq("org_id", orgId)
    .eq("object_id", object.id)
    .select("id");
  if (error) return { ok: false, error: `Could not update those records: ${error.message}` };
  return { ok: true, persisted: true, count: (data ?? []).length };
}
