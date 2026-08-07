import { CUSTOM_FIELD_OBJECT_KEYS } from "./custom-fields";

/**
 * Tenant-defined CRM object types.
 *
 * The six built-ins (companies, contacts, properties, leads, jobs, outcomes)
 * are TABLES. These are rows — see 20260806140000 for why a table per type is
 * not available. Everything here is pure: validation and naming only, no I/O.
 */

export type CustomObject = {
  id: string;
  key: string;
  labelPlural: string;
  labelSingular: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
};

/**
 * Keys a custom object may never take.
 *
 * The six because /crm/[objectKey] resolves a built-in first, so a custom
 * object named `contacts` would be permanently unreachable — records you can
 * create and never open. The rest because they are real path segments under
 * /crm or the app: the route would resolve THEM instead, with the same result.
 * Mirrored by custom_objects_key_reserved_check, since the app is not the only
 * possible writer.
 */
export const RESERVED_OBJECT_KEYS: ReadonlySet<string> = new Set<string>([
  ...CUSTOM_FIELD_OBJECT_KEYS,
  "import",
  "new",
  "settings",
]);

export const OBJECT_KEY_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

/** "Service Vehicles" → "service_vehicles". Same grammar a custom field key uses. */
export function deriveObjectKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^([0-9])/, "n$1")
    .slice(0, 63);
}

export type CustomObjectInput = {
  key?: string;
  labelPlural?: string;
  labelSingular?: string;
  description?: string | null;
  sortOrder?: number;
};

export type CustomObjectParseResult =
  | { ok: true; value: { key: string; labelPlural: string; labelSingular: string; description: string | null; sortOrder: number } }
  | { ok: false; error: string };

/**
 * Validate a proposed object type.
 *
 * Both words are required and neither is derived from the other. Deriving would
 * produce "Add Equipments" for any irregular noun, and irregular nouns are the
 * normal case for what tenants track — equipment, staff, inventory. This is the
 * same rule `app_settings.crm_object_labels` follows for renaming the six: a
 * partial pair is refused, never half-applied.
 */
export function parseCustomObject(input: CustomObjectInput): CustomObjectParseResult {
  const labelPlural = typeof input.labelPlural === "string" ? input.labelPlural.trim() : "";
  const labelSingular = typeof input.labelSingular === "string" ? input.labelSingular.trim() : "";

  if (!labelPlural) return { ok: false, error: "Give the record type a name, e.g. “Equipment”." };
  if (!labelSingular) {
    return { ok: false, error: "Add the singular too — it is what buttons say, e.g. “Add equipment item”." };
  }
  if (labelPlural.length > 60) return { ok: false, error: "Name must be 60 characters or fewer." };
  if (labelSingular.length > 60) return { ok: false, error: "Singular must be 60 characters or fewer." };

  const explicitKey = typeof input.key === "string" ? input.key.trim().toLowerCase() : "";
  const key = explicitKey || deriveObjectKey(labelPlural);

  if (!key) return { ok: false, error: "Name must contain at least one letter or number." };
  if (!OBJECT_KEY_PATTERN.test(key)) {
    return { ok: false, error: "Key must start with a letter and use only lowercase letters, numbers and underscores." };
  }
  if (RESERVED_OBJECT_KEYS.has(key)) {
    // Named explicitly rather than "that name is taken": the operator picked a
    // word the product already uses, and needs to know which, or they will try
    // three more synonyms of the same thing.
    return {
      ok: false,
      error: `“${key}” is a built-in record type. Pick another name — a record type using it could never be opened.`,
    };
  }

  const sortRaw = typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder) ? Math.trunc(input.sortOrder) : 0;
  const description = typeof input.description === "string" && input.description.trim() ? input.description.trim() : null;

  return { ok: true, value: { key, labelPlural, labelSingular, description, sortOrder: sortRaw } };
}

/** Is this key one of the six tables rather than a tenant-defined type? */
export function isBuiltInObjectKey(key: string): boolean {
  return (CUSTOM_FIELD_OBJECT_KEYS as readonly string[]).includes(key);
}

export type CustomRecordInput = { title?: string; subtitle?: string | null };
export type CustomRecordParseResult =
  | { ok: true; value: { title: string; subtitle: string | null } }
  | { ok: false; error: string };

/**
 * A record of a custom object.
 *
 * Title is the only structural field — it is what a list row and a record page
 * are named by. Everything else the tenant cares about is a custom field, which
 * is the whole point of the generic store.
 */
export function parseCustomRecord(input: CustomRecordInput, singularLabel = "record"): CustomRecordParseResult {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: `Give the ${singularLabel.toLowerCase()} a name.` };
  if (title.length > 200) return { ok: false, error: "Name must be 200 characters or fewer." };
  const subtitle = typeof input.subtitle === "string" && input.subtitle.trim() ? input.subtitle.trim() : null;
  return { ok: true, value: { title, subtitle } };
}
