import { inferCustomField, parseCsv, type CustomObject } from "@/domain";

import { provisionCustomFields, writeImportedCustomValues, type AcceptedCustomField } from "@/lib/import-runs/custom-fields";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { createCustomRecord } from "./records";

/**
 * CSV import for a tenant-defined record type.
 *
 * Separate from the wizard at /crm/import, which imports a fixed
 * company -> contact -> property -> lead bundle: that shape has nothing to say
 * about "Equipment". A custom object is a title plus whatever its owner
 * defined, so the mapping is correspondingly simple — one column is the name,
 * every other column becomes a custom field.
 *
 * Fields are provisioned through the same helper the wizard uses, so a field
 * created by an import is indistinguishable from one made by hand in Settings:
 * same validation, same key derivation, same archive semantics. Keys come from
 * `toFieldKey` deterministically, which is what makes a SECOND import of the
 * same file attach to the first import's fields rather than creating "Serial
 * number" beside "Serial number".
 */

/** Rows past this are refused rather than silently truncated. */
export const MAX_IMPORT_ROWS = 2000;

export type CustomImportPlan = {
  /** Header chosen as the record name. */
  titleHeader: string;
  /** Every other header, with the field it will become. */
  fields: AcceptedCustomField[];
  rowCount: number;
  /** Rows with no value in the title column — they cannot be named, so they are skipped. */
  unnamedRows: number;
  sample: { title: string; values: Record<string, string> }[];
};

export type CustomImportResult =
  | { ok: true; created: number; skipped: number; fieldsCreated: string[]; fieldsReused: string[] }
  | { ok: false; error: string };

export type PlanResult = { ok: true; plan: CustomImportPlan } | { ok: false; error: string };

/**
 * Read the CSV and say what an import would do — without writing anything.
 *
 * The operator sees which column becomes the name and which fields get created
 * BEFORE any of it happens, because provisioning fields is the half that
 * changes their schema and is tedious to undo by hand.
 */
export function planCustomImport(csvText: string, titleHeader?: string): PlanResult {
  const rows = parseCsv(csvText);
  if (rows.length === 0) return { ok: false, error: "That file has no rows." };

  const headers = (rows[0] ?? []).map((h) => h.trim()).filter(Boolean);
  if (headers.length === 0) return { ok: false, error: "The first row needs column headings." };

  const body = rows.slice(1).filter((r) => r.some((cell) => cell.trim() !== ""));
  if (body.length === 0) return { ok: false, error: "That file has headings but no rows under them." };
  if (body.length > MAX_IMPORT_ROWS) {
    return { ok: false, error: `That file has ${body.length} rows; ${MAX_IMPORT_ROWS} is the most this imports at once.` };
  }

  // Default to the first column. It is the convention in every export this app
  // writes, and the operator can override it.
  const title = titleHeader && headers.includes(titleHeader) ? titleHeader : headers[0];
  const titleIndex = headers.indexOf(title);

  const others = headers.filter((h) => h !== title);
  const seen = new Set<string>();
  const fields: AcceptedCustomField[] = [];
  for (const header of others) {
    const values = body.map((r) => (r[headers.indexOf(header)] ?? "").trim()).filter(Boolean);
    // Same inference the wizard uses, so a column becomes the same kind of
    // field whichever door it came through — including a select with its
    // choices already populated.
    const inferred = inferCustomField(header, values);
    // Two headers can normalise to one key ("Serial #" and "Serial number").
    // Taking the first keeps the import deterministic instead of having the
    // later column silently overwrite the earlier one's values.
    if (!inferred.key || seen.has(inferred.key)) continue;
    seen.add(inferred.key);
    fields.push({ header, key: inferred.key, label: inferred.label, fieldType: inferred.fieldType, options: inferred.options });
  }

  const unnamedRows = body.filter((r) => !(r[titleIndex] ?? "").trim()).length;

  const sample = body.slice(0, 3).map((r) => ({
    title: (r[titleIndex] ?? "").trim(),
    values: Object.fromEntries(fields.map((f) => [f.header, (r[headers.indexOf(f.header)] ?? "").trim()])),
  }));

  return { ok: true, plan: { titleHeader: title, fields, rowCount: body.length, unnamedRows, sample } };
}

/**
 * Do the import.
 *
 * Per-record and best-effort, matching the wizard: a row whose values will not
 * coerce must not take down the rows around it. A row with no name is skipped
 * rather than invented — "Untitled" rows are worse than absent ones, because
 * nobody can tell which is which afterwards.
 */
export async function importCustomObjectCsv(
  orgId: string,
  object: CustomObject,
  csvText: string,
  titleHeader?: string,
): Promise<CustomImportResult> {
  const planned = planCustomImport(csvText, titleHeader);
  if (!planned.ok) return planned;
  if (!orgId) return { ok: false, error: "Could not resolve your workspace." };
  if (!isSupabaseAdminConfigured()) {
    return { ok: false, error: "Connect this workspace to a database before importing." };
  }

  const { plan } = planned;
  const rows = parseCsv(csvText);
  const headers = (rows[0] ?? []).map((h) => h.trim());
  const titleIndex = headers.indexOf(plan.titleHeader);
  const body = rows.slice(1).filter((r) => r.some((cell) => cell.trim() !== ""));

  const provisioned = await provisionCustomFields(orgId, plan.fields, undefined, object.key);
  // A field that could not be created is dropped from the write rather than
  // failing the import: the records are still worth having, and the operator is
  // told which fields did not make it.
  const usable = plan.fields.filter((f) => !provisioned.failed.some((x) => x.key === f.key));

  let created = 0;
  let skipped = 0;

  for (const row of body) {
    const title = (row[titleIndex] ?? "").trim();
    if (!title) {
      skipped += 1;
      continue;
    }

    const result = await createCustomRecord(orgId, object, { title });
    if (!result.ok || !result.id) {
      skipped += 1;
      continue;
    }
    created += 1;

    const rowValues: Record<string, string> = {};
    for (const field of usable) {
      const value = (row[headers.indexOf(field.header)] ?? "").trim();
      if (value) rowValues[field.header] = value;
    }
    await writeImportedCustomValues(orgId, result.id, usable, rowValues, undefined, object.key);
  }

  return {
    ok: true,
    created,
    skipped,
    fieldsCreated: provisioned.created,
    fieldsReused: provisioned.reused,
  };
}
