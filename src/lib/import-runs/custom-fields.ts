import { type SupabaseClient } from "@supabase/supabase-js";

import { type CustomFieldType } from "@/domain";
import { createFieldDefinition, listFieldDefinitions } from "@/lib/custom-fields/definitions";
import { saveCustomFieldValues } from "@/lib/custom-fields/values";

/**
 * Provisioning tenant fields from an import's unmapped columns (BSR-645).
 *
 * Goes through the existing custom-fields layer rather than writing the tables
 * directly, so imported fields are indistinguishable from ones created by hand in
 * Settings — same validation, same key format, same archive semantics.
 */

export type AcceptedCustomField = {
  /** The header in the file. */
  header: string;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  options?: Array<{ value: string; label: string }>;
};

export type ProvisionResult = {
  /** Definitions newly created by this import. */
  created: string[];
  /** Keys that already existed and were reused. */
  reused: string[];
  /** Keys that could not be provisioned, with why. */
  failed: Array<{ key: string; error: string }>;
};

/**
 * Ensure a definition exists for every accepted column, on `leads`.
 *
 * **Reuse is the point, not a nicety.** Re-importing the same file must attach to
 * the definition the first import created; creating "Policy number" beside
 * "Policy number" would strand the first import's values on a field the operator
 * thinks they already have. Keys are derived deterministically from the header
 * (`toFieldKey`) precisely so the second run resolves to the same one.
 */
export async function provisionCustomFields(
  orgId: string,
  fields: AcceptedCustomField[],
  client?: SupabaseClient,
): Promise<ProvisionResult> {
  const result: ProvisionResult = { created: [], reused: [], failed: [] };
  if (fields.length === 0) return result;

  const existing = await listFieldDefinitions(orgId, "leads", client ? { client } : {});
  const existingKeys = new Set(existing.map((d) => d.key));

  for (const field of fields) {
    if (existingKeys.has(field.key)) {
      result.reused.push(field.key);
      continue;
    }

    const outcome = await createFieldDefinition(
      orgId,
      {
        objectKey: "leads",
        key: field.key,
        label: field.label,
        fieldType: field.fieldType,
        options: field.options ?? [],
        required: false,
        helpText: "Created by a CSV import.",
      },
      client ? { client } : {},
    );

    if (outcome.ok) result.created.push(field.key);
    // A definition that already exists but is ARCHIVED comes back as an error
    // here. That is a reuse, not a failure — the operator archived it once and
    // re-importing should not be blocked by their own tidy-up.
    else if (/already exists/i.test(outcome.error)) result.reused.push(field.key);
    else result.failed.push({ key: field.key, error: outcome.error });
  }

  return result;
}

/**
 * Write one imported record's custom values.
 *
 * Best-effort and per-record, matching everything else in the import path: a
 * value that will not coerce must not fail the lead that was already written.
 * `saveCustomFieldValues` is all-or-nothing *within* a record, which is the right
 * granularity — a half-populated record is worse than an unpopulated one.
 */
export async function writeImportedCustomValues(
  orgId: string,
  leadId: string,
  fields: AcceptedCustomField[],
  rowValues: Record<string, string>,
  client?: SupabaseClient,
): Promise<void> {
  if (fields.length === 0) return;

  const raw: Record<string, unknown> = {};
  for (const field of fields) {
    const value = rowValues[field.header];
    if (value !== undefined && value !== "") raw[field.key] = value;
  }
  if (Object.keys(raw).length === 0) return;

  try {
    await saveCustomFieldValues(orgId, "leads", leadId, raw, client ? { client } : {});
  } catch {
    // Swallowed on purpose. The lead is already imported; failing here would
    // report a record that landed as failed.
  }
}
