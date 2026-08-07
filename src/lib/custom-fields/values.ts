import { type SupabaseClient } from "@supabase/supabase-js";

import {
  coerceCustomFieldValue,
  formatCustomFieldValue,
  type CustomFieldDefinition,
  type CustomFieldObjectKey,
} from "@/domain";

import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";

import { listFieldDefinitions } from "./definitions";
import { demoFieldValue } from "./demo";

/** See the note in ./demo — Supabase ABSENT, not merely the flag set. */
function serveDemoValues(client?: SupabaseClient): boolean {
  return !client && !isSupabaseAdminConfigured() && isDemoDataEnabled();
}

const TABLE = "custom_field_values";

/** A definition paired with this record's value — what a detail view renders. */
export type CustomFieldEntry = {
  definition: CustomFieldDefinition;
  value: unknown;
  display: string;
};

export type SaveValuesResult =
  | { ok: true; saved: number }
  /**
   * `reason` separates "you named a field that doesn't exist" from "the value
   * you gave doesn't fit the field". A caller recovers from those differently:
   * the first by listing the fields, the second by fixing the value.
   */
  | { ok: false; error: string; fieldKey?: string; reason?: "unknown_field" | "invalid_value" };

/**
 * Every active custom field for one record, in display order, including fields
 * the record has no value for.
 *
 * Unfilled fields are included on purpose: a detail view that only listed filled
 * fields would make a tenant's own schema look like it changes record to record.
 */
export async function getCustomFieldsForRecord(
  orgId: string,
  // Per-org: a tenant-defined record type's key is not one of the six.
  objectKey: string,
  recordId: string,
  opts: { client?: SupabaseClient } = {},
): Promise<CustomFieldEntry[]> {
  if (serveDemoValues(opts.client)) {
    return listFieldDefinitions(orgId, objectKey).then((definitions) =>
      definitions.map((definition) => {
        const hit = demoFieldValue(definition, recordId);
        return { definition, value: hit?.value ?? null, display: hit?.display ?? "" };
      }),
    );
  }

  const client = opts.client ?? getSupabaseAdminClient();
  const definitions = await listFieldDefinitions(orgId, objectKey, { client });
  if (definitions.length === 0) return [];

  const { data, error } = await client
    .from(TABLE)
    .select("field_id,value")
    .eq("org_id", orgId)
    .eq("object_key", objectKey)
    .eq("record_id", recordId);

  if (error) throw new Error(`Failed to load custom field values: ${error.message}`);

  const byField = new Map<string, unknown>();
  for (const row of data ?? []) {
    const rec = row as Record<string, unknown>;
    byField.set(String(rec.field_id), rec.value ?? null);
  }

  return definitions.map((definition) => {
    const value = byField.get(definition.id) ?? null;
    return { definition, value, display: formatCustomFieldValue(definition, value) };
  });
}

/**
 * Custom field values for many records at once, keyed by record id.
 *
 * The list view needs this — resolving each row separately would be an N+1
 * against the query hot path.
 */
export async function getCustomFieldsForRecords(
  orgId: string,
  // Per-org: a tenant-defined record type's key is not one of the six.
  objectKey: string,
  recordIds: string[],
  opts: { client?: SupabaseClient } = {},
): Promise<Map<string, CustomFieldEntry[]>> {
  const out = new Map<string, CustomFieldEntry[]>();
  if (recordIds.length === 0) return out;

  if (serveDemoValues(opts.client)) {
    const definitions = await listFieldDefinitions(orgId, objectKey);
    for (const recordId of recordIds) {
      const entries = definitions
        .map((definition) => ({ definition, hit: demoFieldValue(definition, recordId) }))
        .filter((e) => e.hit)
        .map((e) => ({ definition: e.definition, value: e.hit!.value, display: e.hit!.display }));
      if (entries.length > 0) out.set(recordId, entries);
    }
    return out;
  }

  const client = opts.client ?? getSupabaseAdminClient();
  const definitions = await listFieldDefinitions(orgId, objectKey, { client });
  if (definitions.length === 0) return out;

  const { data, error } = await client
    .from(TABLE)
    .select("record_id,field_id,value")
    .eq("org_id", orgId)
    .eq("object_key", objectKey)
    .in("record_id", recordIds);

  if (error) throw new Error(`Failed to load custom field values: ${error.message}`);

  const byRecord = new Map<string, Map<string, unknown>>();
  for (const row of data ?? []) {
    const rec = row as Record<string, unknown>;
    const recordId = String(rec.record_id);
    if (!byRecord.has(recordId)) byRecord.set(recordId, new Map());
    byRecord.get(recordId)!.set(String(rec.field_id), rec.value ?? null);
  }

  for (const recordId of recordIds) {
    const values = byRecord.get(recordId);
    out.set(
      recordId,
      definitions.map((definition) => {
        const value = values?.get(definition.id) ?? null;
        return { definition, value, display: formatCustomFieldValue(definition, value) };
      }),
    );
  }

  return out;
}

/**
 * Validate and persist custom field values for one record.
 *
 * `raw` is keyed by the field's machine key, which is what a form, the API, and
 * Arc all address a field by.
 *
 * A key naming an ARCHIVED field is ignored — that's a stale form posting a
 * field someone removed mid-edit, and failing the whole save over it would be
 * user-hostile. A key naming NOTHING is refused: see below.
 *
 * All-or-nothing on validation — nothing is written unless every supplied value
 * coerces, so a record can't end up half-updated.
 */
export async function saveCustomFieldValues(
  orgId: string,
  // Per-org: a tenant-defined record type's key is not one of the six.
  objectKey: string,
  recordId: string,
  raw: Record<string, unknown>,
  opts: { client?: SupabaseClient } = {},
): Promise<SaveValuesResult> {
  const client = opts.client ?? getSupabaseAdminClient();
  // Archived definitions are loaded too, purely to tell "you removed this
  // field" apart from "this field never existed". Only active ones are written.
  const all = await listFieldDefinitions(orgId, objectKey, { client, includeArchived: true });
  const definitions = all.filter((d) => d.active);

  const supplied = definitions.filter((d) => Object.prototype.hasOwnProperty.call(raw, d.key));

  /*
   * Naming a field that doesn't exist is an ERROR, not a no-op.
   *
   * This returned `{ ok: true, saved: 0 }` whenever the object had no matching
   * definitions — so Arc could call save_custom_fields with two named fields,
   * be told it succeeded, and write nothing. Verified against real Postgres:
   * HTTP 200, `saved: 0`, zero rows. A caller cannot correct a mistake it is
   * told is a success, and the whole point of these values is that Arc sets
   * them, so the failure was invisible from both ends.
   *
   * An empty `values` object is still a legitimate no-op — that's a caller
   * asking for nothing, not a caller asking for something that isn't there.
   */
  const unknown = Object.keys(raw).filter((k) => !all.some((d) => d.key === k));
  if (unknown.length > 0) {
    return {
      ok: false,
      error:
        `No field named ${unknown.map((k) => `"${k}"`).join(", ")} on this record type. ` +
        (definitions.length > 0
          ? `Its fields are: ${definitions.map((d) => d.key).join(", ")}.`
          : "It has no custom fields yet — add one before setting values on it."),
      fieldKey: unknown[0],
      reason: "unknown_field",
    };
  }

  if (supplied.length === 0) return { ok: true, saved: 0 };

  const rows: Array<Record<string, unknown>> = [];
  for (const definition of supplied) {
    const coerced = coerceCustomFieldValue(definition, raw[definition.key]);
    if (!coerced.ok) {
      return { ok: false, error: coerced.error, fieldKey: definition.key, reason: "invalid_value" };
    }

    rows.push({
      org_id: orgId,
      field_id: definition.id,
      object_key: objectKey,
      record_id: recordId,
      value: coerced.value,
      updated_at: new Date().toISOString(),
    });
  }

  const { error } = await client
    .from(TABLE)
    .upsert(rows, { onConflict: "org_id,record_id,field_id" });

  if (error) return { ok: false, error: `Could not save custom fields: ${error.message}` };
  return { ok: true, saved: rows.length };
}

/**
 * Custom fields rendered for Arc's prompt context, keyed by machine key.
 *
 * Only filled fields are included here — the opposite of the detail view.
 * Feeding Arc a wall of empty fields invites it to invent plausible values for
 * them, which is exactly the failure the provenance work exists to prevent.
 */
export async function getCustomFieldContextForRecord(
  orgId: string,
  // Per-org: a tenant-defined record type's key is not one of the six.
  objectKey: string,
  recordId: string,
  opts: { client?: SupabaseClient } = {},
): Promise<Record<string, { label: string; value: string }>> {
  const entries = await getCustomFieldsForRecord(orgId, objectKey, recordId, opts);
  const out: Record<string, { label: string; value: string }> = {};
  for (const entry of entries) {
    if (entry.value === null || entry.value === undefined || entry.display === "") continue;
    out[entry.definition.key] = { label: entry.definition.label, value: entry.display };
  }
  return out;
}

/**
 * Record ids in this object that match a custom field filter.
 *
 * Returns ids rather than records so the caller can intersect with whatever
 * query it already runs, instead of this layer having to know the six tables.
 */
export async function findRecordIdsByCustomField(
  orgId: string,
  // Per-org: a tenant-defined record type's key is not one of the six.
  objectKey: string,
  fieldId: string,
  match: string,
  opts: { client?: SupabaseClient; limit?: number } = {},
): Promise<string[]> {
  const client = opts.client ?? getSupabaseAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select("record_id,value")
    .eq("org_id", orgId)
    .eq("object_key", objectKey)
    .eq("field_id", fieldId)
    .not("value", "is", null)
    .limit(opts.limit ?? 500);

  if (error) throw new Error(`Failed to filter by custom field: ${error.message}`);

  const needle = match.trim().toLowerCase();
  if (!needle) return [];

  const ids: string[] = [];
  for (const row of data ?? []) {
    const rec = row as Record<string, unknown>;
    const value = rec.value;
    // multi_select stores an array; every other type stores a scalar.
    const hay = Array.isArray(value)
      ? value.map((v) => String(v).toLowerCase())
      : [String(value ?? "").toLowerCase()];
    if (hay.some((h) => h === needle || h.includes(needle))) ids.push(String(rec.record_id));
  }
  return ids;
}

/**
 * Validate custom field values WITHOUT writing them.
 *
 * Record creation needs this: the values must be checked before the record row
 * is inserted, or a rejected value leaves a created record missing the fields
 * its own tenant marked required. `createCrmRecord` already front-loads the
 * object's DB constraints for exactly this reason — this is the same guard for
 * the tenant-defined half of the schema.
 */
export async function validateCustomFieldValues(
  orgId: string,
  // Per-org: a tenant-defined record type's key is not one of the six.
  objectKey: string,
  raw: Record<string, unknown>,
  opts: { client?: SupabaseClient } = {},
): Promise<{ ok: true } | { ok: false; error: string; fieldKey?: string }> {
  const client = opts.client ?? getSupabaseAdminClient();
  const definitions = await listFieldDefinitions(orgId, objectKey, { client });

  for (const definition of definitions) {
    // A required field must be satisfied even when the form omitted it, or
    // "required" would only apply to callers that happened to send the key.
    const supplied = Object.prototype.hasOwnProperty.call(raw, definition.key);
    if (!supplied && !definition.required) continue;

    const coerced = coerceCustomFieldValue(definition, supplied ? raw[definition.key] : null);
    if (!coerced.ok) return { ok: false, error: coerced.error, fieldKey: definition.key };
  }

  return { ok: true };
}
