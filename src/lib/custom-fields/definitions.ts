import { requireCount } from "@/lib/supabase/count";
import { type SupabaseClient } from "@supabase/supabase-js";

import {
  canChangeFieldType,
  parseFieldDefinition,
  type CustomFieldDefinition,
  type CustomFieldObjectKey,
  type CustomFieldOption,
  type CustomFieldType,
  type FieldDefinitionInput,
} from "@/domain";

import { getSupabaseAdminClient } from "@/lib/supabase/server";

// Untyped SupabaseClient: `custom_field_definitions` isn't in the generated
// database.types yet (that regenerates against a DB with the migration applied),
// matching how the support/vault/connections layers handle their tables.

const TABLE = "custom_field_definitions";

export type DefinitionResult =
  | { ok: true; definition: CustomFieldDefinition }
  | { ok: false; error: string };

function rowToDefinition(row: Record<string, unknown>): CustomFieldDefinition {
  return {
    id: String(row.id),
    objectKey: String(row.object_key) as CustomFieldObjectKey,
    key: String(row.key),
    label: String(row.label),
    fieldType: String(row.field_type) as CustomFieldType,
    required: row.required === true,
    options: Array.isArray(row.options) ? (row.options as CustomFieldOption[]) : [],
    helpText: typeof row.help_text === "string" ? row.help_text : null,
    sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
    active: row.active !== false,
  };
}

/**
 * Field definitions for one CRM object, in display order.
 *
 * Org-scoped explicitly — the service-role client bypasses RLS, so the tenant
 * filter is the caller's responsibility here (same contract as every other
 * admin-client read in src/lib).
 */
export async function listFieldDefinitions(
  orgId: string,
  objectKey: CustomFieldObjectKey,
  opts: { includeArchived?: boolean; client?: SupabaseClient } = {},
): Promise<CustomFieldDefinition[]> {
  const client = opts.client ?? getSupabaseAdminClient();
  let query = client
    .from(TABLE)
    .select("id,object_key,key,label,field_type,required,options,help_text,sort_order,active")
    .eq("org_id", orgId)
    .eq("object_key", objectKey);

  if (!opts.includeArchived) query = query.eq("active", true);

  const { data, error } = await query.order("sort_order", { ascending: true }).order("label", { ascending: true });
  if (error) throw new Error(`Failed to load custom fields: ${error.message}`);

  return (data ?? []).map((row) => rowToDefinition(row as Record<string, unknown>));
}

/** Every definition across all six objects — for the settings screen. */
export async function listAllFieldDefinitions(
  orgId: string,
  opts: { includeArchived?: boolean; client?: SupabaseClient } = {},
): Promise<CustomFieldDefinition[]> {
  const client = opts.client ?? getSupabaseAdminClient();
  let query = client
    .from(TABLE)
    .select("id,object_key,key,label,field_type,required,options,help_text,sort_order,active")
    .eq("org_id", orgId);

  if (!opts.includeArchived) query = query.eq("active", true);

  const { data, error } = await query
    .order("object_key", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`Failed to load custom fields: ${error.message}`);

  return (data ?? []).map((row) => rowToDefinition(row as Record<string, unknown>));
}

/**
 * Create a field definition, or reactivate an archived one with the same key.
 *
 * Reactivation rather than a second row is deliberate: the unique index spans
 * archived rows, and the archived definition still owns its retained values, so
 * reviving it brings that history back instead of stranding it behind a new id.
 */
export async function createFieldDefinition(
  orgId: string,
  input: FieldDefinitionInput,
  opts: { client?: SupabaseClient } = {},
): Promise<DefinitionResult> {
  const parsed = parseFieldDefinition(input);
  if (!parsed.ok) return parsed;

  const client = opts.client ?? getSupabaseAdminClient();
  const d = parsed.definition;

  const { data: existing, error: lookupError } = await client
    .from(TABLE)
    .select("id,active,field_type")
    .eq("org_id", orgId)
    .eq("object_key", d.objectKey)
    .eq("key", d.key)
    .maybeSingle();

  if (lookupError) return { ok: false, error: `Could not check existing fields: ${lookupError.message}` };

  if (existing) {
    const row = existing as Record<string, unknown>;
    if (row.active !== false) {
      return { ok: false, error: `A field named "${d.label}" already exists on this record type.` };
    }
    // Reviving an archived field whose values are typed differently would
    // reinterpret every one of them.
    if (String(row.field_type) !== d.fieldType) {
      const hasValues = await fieldHasValues(String(row.id), { client });
      const allowed = canChangeFieldType(hasValues);
      if (!allowed.ok) return { ok: false, error: allowed.error };
    }

    const { data, error } = await client
      .from(TABLE)
      .update({
        label: d.label,
        field_type: d.fieldType,
        required: d.required,
        options: d.options,
        help_text: d.helpText,
        sort_order: d.sortOrder,
        active: true,
        archived_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", String(row.id))
      .eq("org_id", orgId)
      .select("id,object_key,key,label,field_type,required,options,help_text,sort_order,active")
      .single();

    if (error) return { ok: false, error: `Could not restore the field: ${error.message}` };
    return { ok: true, definition: rowToDefinition(data as Record<string, unknown>) };
  }

  const { data, error } = await client
    .from(TABLE)
    .insert({
      org_id: orgId,
      object_key: d.objectKey,
      key: d.key,
      label: d.label,
      field_type: d.fieldType,
      required: d.required,
      options: d.options,
      help_text: d.helpText,
      sort_order: d.sortOrder,
    })
    .select("id,object_key,key,label,field_type,required,options,help_text,sort_order,active")
    .single();

  if (error) return { ok: false, error: `Could not create the field: ${error.message}` };
  return { ok: true, definition: rowToDefinition(data as Record<string, unknown>) };
}

export type UpdateFieldInput = {
  label?: string;
  fieldType?: CustomFieldType;
  required?: boolean;
  options?: unknown;
  helpText?: string | null;
  sortOrder?: number;
};

/**
 * Update a definition. The machine `key` is deliberately immutable — Arc and
 * any export address a field by key, so renaming one would break references
 * that look identical afterwards. Renaming the `label` is always allowed.
 */
export async function updateFieldDefinition(
  orgId: string,
  fieldId: string,
  input: UpdateFieldInput,
  opts: { client?: SupabaseClient } = {},
): Promise<DefinitionResult> {
  const client = opts.client ?? getSupabaseAdminClient();

  const { data: current, error: loadError } = await client
    .from(TABLE)
    .select("id,object_key,key,label,field_type,required,options,help_text,sort_order,active")
    .eq("org_id", orgId)
    .eq("id", fieldId)
    .maybeSingle();

  if (loadError) return { ok: false, error: `Could not load the field: ${loadError.message}` };
  if (!current) return { ok: false, error: "That field no longer exists." };

  const existing = rowToDefinition(current as Record<string, unknown>);
  const nextType = input.fieldType ?? existing.fieldType;

  if (nextType !== existing.fieldType) {
    const hasValues = await fieldHasValues(fieldId, { client });
    const allowed = canChangeFieldType(hasValues);
    if (!allowed.ok) return { ok: false, error: allowed.error };
  }

  // Re-validate the whole definition rather than the diff, so a change that is
  // individually fine but jointly invalid (switching to `select` while leaving
  // the old empty options) is still caught.
  const parsed = parseFieldDefinition({
    objectKey: existing.objectKey,
    key: existing.key,
    label: input.label ?? existing.label,
    fieldType: nextType,
    required: input.required ?? existing.required,
    options: input.options ?? existing.options,
    helpText: input.helpText === undefined ? existing.helpText : input.helpText,
    sortOrder: input.sortOrder ?? existing.sortOrder,
  });
  if (!parsed.ok) return parsed;

  const d = parsed.definition;
  const { data, error } = await client
    .from(TABLE)
    .update({
      label: d.label,
      field_type: d.fieldType,
      required: d.required,
      options: d.options,
      help_text: d.helpText,
      sort_order: d.sortOrder,
      updated_at: new Date().toISOString(),
    })
    .eq("id", fieldId)
    .eq("org_id", orgId)
    .select("id,object_key,key,label,field_type,required,options,help_text,sort_order,active")
    .single();

  if (error) return { ok: false, error: `Could not update the field: ${error.message}` };
  return { ok: true, definition: rowToDefinition(data as Record<string, unknown>) };
}

/**
 * Archive (soft-delete) a definition. Values are retained: archiving hides the
 * field everywhere but is fully reversible, which is what makes it safe to
 * offer as the only delete affordance.
 */
export async function archiveFieldDefinition(
  orgId: string,
  fieldId: string,
  opts: { client?: SupabaseClient } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = opts.client ?? getSupabaseAdminClient();
  const { error } = await client
    .from(TABLE)
    .update({ active: false, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", fieldId)
    .eq("org_id", orgId);

  if (error) return { ok: false, error: `Could not archive the field: ${error.message}` };
  return { ok: true };
}

export async function restoreFieldDefinition(
  orgId: string,
  fieldId: string,
  opts: { client?: SupabaseClient } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = opts.client ?? getSupabaseAdminClient();
  const { error } = await client
    .from(TABLE)
    .update({ active: true, archived_at: null, updated_at: new Date().toISOString() })
    .eq("id", fieldId)
    .eq("org_id", orgId);

  if (error) return { ok: false, error: `Could not restore the field: ${error.message}` };
  return { ok: true };
}

/** True when any record has a stored value for this field. */
export async function fieldHasValues(
  fieldId: string,
  opts: { client?: SupabaseClient } = {},
): Promise<boolean> {
  const client = opts.client ?? getSupabaseAdminClient();
  const { count, error } = await client
    .from("custom_field_values")
    .select("id", { count: "exact", head: true })
    .eq("field_id", fieldId)
    .not("value", "is", null);

  // Fail closed: if we can't prove the field is empty, treat it as having data
  // so a type change is refused rather than silently recasting stored values.
  if (error) return true;
  // Fail closed: a null count read as 0 claims the tenant has no custom fields.
  return requireCount("custom_field_definitions", { count, error }) > 0;
}
