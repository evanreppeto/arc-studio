import { type SupabaseClient } from "@supabase/supabase-js";

import { parseCustomObject, type CustomObject, type CustomObjectInput } from "@/domain";

import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";

import { demoCustomObjects } from "./demo";

/**
 * Tenant-defined object types.
 *
 * Untyped SupabaseClient: `custom_objects` isn't in the generated
 * database.types yet (that regenerates against a DB with the migration
 * applied), matching how the custom-fields/support/vault layers handle theirs.
 */
const TABLE = "custom_objects";

export type ObjectResult = { ok: true; object: CustomObject } | { ok: false; error: string };

function rowToObject(row: Record<string, unknown>): CustomObject {
  return {
    id: String(row.id),
    key: String(row.key),
    labelPlural: String(row.label_plural),
    labelSingular: String(row.label_singular),
    description: row.description == null ? null : String(row.description),
    sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
    active: row.active !== false,
  };
}

/** See the note in ../custom-fields/demo — Supabase ABSENT, not merely the flag. */
function serveDemoObjects(client?: SupabaseClient): boolean {
  return !client && !isSupabaseAdminConfigured() && isDemoDataEnabled();
}

export async function listCustomObjects(
  orgId: string,
  opts: { includeArchived?: boolean; client?: SupabaseClient } = {},
): Promise<CustomObject[]> {
  if (serveDemoObjects(opts.client)) {
    const demo = demoCustomObjects();
    return opts.includeArchived ? demo : demo.filter((o) => o.active);
  }
  // No org means no tenant. Returning "every object type" here would surface
  // another workspace's schema in this one's CRM tabs.
  if (!orgId) return [];

  const client = opts.client ?? getSupabaseAdminClient();
  let query = client
    .from(TABLE)
    .select("id,key,label_plural,label_singular,description,sort_order,active")
    .eq("org_id", orgId);
  if (!opts.includeArchived) query = query.eq("active", true);

  const { data, error } = await query.order("sort_order", { ascending: true }).order("label_plural", { ascending: true });
  if (error) throw new Error(`Failed to load record types: ${error.message}`);
  return (data ?? []).map((row) => rowToObject(row as Record<string, unknown>));
}

export async function getCustomObjectByKey(
  orgId: string,
  key: string,
  opts: { client?: SupabaseClient } = {},
): Promise<CustomObject | null> {
  if (serveDemoObjects(opts.client)) {
    return demoCustomObjects().find((o) => o.key === key) ?? null;
  }
  if (!orgId || !key) return null;

  const client = opts.client ?? getSupabaseAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select("id,key,label_plural,label_singular,description,sort_order,active")
    .eq("org_id", orgId)
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`Failed to load that record type: ${error.message}`);
  return data ? rowToObject(data as Record<string, unknown>) : null;
}

export async function createCustomObject(
  orgId: string,
  input: CustomObjectInput,
  opts: { client?: SupabaseClient } = {},
): Promise<ObjectResult> {
  const parsed = parseCustomObject(input);
  if (!parsed.ok) return parsed;
  if (!orgId) return { ok: false, error: "Could not resolve your workspace." };

  const client = opts.client ?? getSupabaseAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .insert({
      org_id: orgId,
      key: parsed.value.key,
      label_plural: parsed.value.labelPlural,
      label_singular: parsed.value.labelSingular,
      description: parsed.value.description,
      sort_order: parsed.value.sortOrder,
    })
    .select("id,key,label_plural,label_singular,description,sort_order,active")
    .single();

  if (error) {
    // The unique index is per (org_id, key); "already exists" is the useful
    // sentence, not the constraint name Postgres reports.
    if (/duplicate key|unique/i.test(error.message)) {
      return { ok: false, error: `You already have a record type called “${parsed.value.key}”.` };
    }
    return { ok: false, error: `Could not create the record type: ${error.message}` };
  }
  return { ok: true, object: rowToObject(data as Record<string, unknown>) };
}

/**
 * Rename or reorder. The KEY is never updated: it is the route segment and the
 * `object_key` every custom field on this object hangs off, so changing it
 * would strand both the URL and every field definition. Labels are free text
 * and change all they like.
 */
export async function updateCustomObject(
  orgId: string,
  objectId: string,
  input: { labelPlural?: string; labelSingular?: string; description?: string | null; sortOrder?: number },
  opts: { client?: SupabaseClient } = {},
): Promise<ObjectResult> {
  const client = opts.client ?? getSupabaseAdminClient();
  const { data: current, error: loadError } = await client
    .from(TABLE)
    .select("id,key,label_plural,label_singular,description,sort_order,active")
    .eq("org_id", orgId)
    .eq("id", objectId)
    .maybeSingle();
  if (loadError) return { ok: false, error: `Could not load that record type: ${loadError.message}` };
  if (!current) return { ok: false, error: "That record type no longer exists." };

  const existing = rowToObject(current as Record<string, unknown>);
  // Re-validate the whole thing rather than the diff, so a change that is
  // individually fine but jointly invalid is still caught.
  const parsed = parseCustomObject({
    key: existing.key,
    labelPlural: input.labelPlural ?? existing.labelPlural,
    labelSingular: input.labelSingular ?? existing.labelSingular,
    description: input.description === undefined ? existing.description : input.description,
    sortOrder: input.sortOrder ?? existing.sortOrder,
  });
  if (!parsed.ok) return parsed;

  const { data, error } = await client
    .from(TABLE)
    .update({
      label_plural: parsed.value.labelPlural,
      label_singular: parsed.value.labelSingular,
      description: parsed.value.description,
      sort_order: parsed.value.sortOrder,
      updated_at: new Date().toISOString(),
    })
    .eq("id", objectId)
    .eq("org_id", orgId)
    .select("id,key,label_plural,label_singular,description,sort_order,active")
    .single();
  if (error) return { ok: false, error: `Could not update the record type: ${error.message}` };
  return { ok: true, object: rowToObject(data as Record<string, unknown>) };
}

/**
 * Archive, never delete. `on delete restrict` in the schema means a type with
 * records cannot be dropped at all — which is deliberate: deleting the type
 * would orphan every row silently. Archiving hides the tab and its records and
 * is reversible.
 */
export async function setCustomObjectActive(
  orgId: string,
  objectId: string,
  active: boolean,
  opts: { client?: SupabaseClient } = {},
): Promise<ObjectResult> {
  const client = opts.client ?? getSupabaseAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", objectId)
    .eq("org_id", orgId)
    .select("id,key,label_plural,label_singular,description,sort_order,active")
    .single();
  if (error) return { ok: false, error: `Could not update the record type: ${error.message}` };
  return { ok: true, object: rowToObject(data as Record<string, unknown>) };
}
