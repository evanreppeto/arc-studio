/**
 * Per-tenant custom fields on the six CRM objects (Option B — BSR-489/BSR-493).
 *
 * Pure logic only: what a field definition may look like, and how a raw operator
 * or Arc input becomes a storable value. Persistence lives in
 * `src/lib/custom-fields/`.
 *
 * The type and object lists here are mirrored in the check constraints of
 * `supabase/migrations/20260728180000_custom_fields.sql` — keep them in sync.
 */

export const CUSTOM_FIELD_OBJECT_KEYS = [
  "companies",
  "contacts",
  "properties",
  "leads",
  "jobs",
  "outcomes",
] as const;

export type CustomFieldObjectKey = (typeof CUSTOM_FIELD_OBJECT_KEYS)[number];

export const CUSTOM_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "select",
  "multi_select",
  "boolean",
  "url",
  "currency",
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** Types whose `options` list is required and meaningful. */
export const CHOICE_FIELD_TYPES: ReadonlySet<CustomFieldType> = new Set<CustomFieldType>([
  "select",
  "multi_select",
]);

export type CustomFieldOption = { value: string; label: string };

export type CustomFieldDefinition = {
  id: string;
  objectKey: CustomFieldObjectKey;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  required: boolean;
  options: CustomFieldOption[];
  helpText: string | null;
  sortOrder: number;
  active: boolean;
};

export function isCustomFieldObjectKey(value: unknown): value is CustomFieldObjectKey {
  return typeof value === "string" && (CUSTOM_FIELD_OBJECT_KEYS as readonly string[]).includes(value);
}

export function isCustomFieldType(value: unknown): value is CustomFieldType {
  return typeof value === "string" && (CUSTOM_FIELD_TYPES as readonly string[]).includes(value);
}

/**
 * Machine key derived from an operator-typed label ("Matter number" ->
 * "matter_number"). Mirrors `custom_field_definitions_key_format_check`: the DB
 * is the authority, so anything this returns must satisfy that regex or the
 * insert fails loudly rather than storing a malformed key.
 *
 * Returns "" when the label has no usable characters — the caller decides
 * whether that is a validation error, rather than getting a silent fallback key.
 */
export function deriveCustomFieldKey(label: unknown): string {
  if (typeof label !== "string") return "";
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) return "";
  // The constraint requires a leading letter, so a label like "2024 target"
  // ("2024_target") gets prefixed rather than rejected.
  const withLetter = /^[a-z]/.test(slug) ? slug : `f_${slug}`;
  return withLetter.slice(0, 63).replace(/_+$/g, "");
}

/**
 * Which object keys a field may be defined on.
 *
 * The six built-ins are tables and always valid. A tenant-defined type is a row
 * in `custom_objects`, so validity is PER-ORG and cannot be answered from a
 * constant — the same rule personas follow (`isAllowedPersona(p, keys)`).
 * Callers that know the org resolve the key first and pass it here; callers
 * that don't get the six, which is what every pre-existing caller expects.
 */
export const BUILT_IN_OBJECT_KEYS: readonly string[] = CUSTOM_FIELD_OBJECT_KEYS;

export type FieldDefinitionInput = {
  objectKey: unknown;
  key?: unknown;
  label: unknown;
  fieldType: unknown;
  required?: unknown;
  options?: unknown;
  helpText?: unknown;
  sortOrder?: unknown;
};

export type ParsedFieldDefinition = {
  /**
   * Not narrowed to `CustomFieldObjectKey`: a tenant-defined type's key is a
   * per-org string. Narrowing it here is what forced the `as CustomFieldObjectKey`
   * casts scattered across the CRM and Arc routes — a lie the type system was
   * being asked to swallow at six call sites.
   */
  objectKey: string;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  required: boolean;
  options: CustomFieldOption[];
  helpText: string | null;
  sortOrder: number;
};

export type FieldDefinitionResult =
  | { ok: true; definition: ParsedFieldDefinition }
  | { ok: false; error: string };

function parseOptions(raw: unknown): CustomFieldOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CustomFieldOption[] = [];
  for (const entry of raw) {
    let value = "";
    let label = "";
    if (typeof entry === "string") {
      value = entry.trim();
      label = value;
    } else if (entry && typeof entry === "object") {
      const rec = entry as Record<string, unknown>;
      value = typeof rec.value === "string" ? rec.value.trim() : "";
      label = typeof rec.label === "string" && rec.label.trim() ? rec.label.trim() : value;
    }
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label });
  }
  return out;
}

/**
 * Validate an operator-authored field definition. Rejects rather than repairs:
 * a definition is a schema a tenant will build records on, so a silently
 * "fixed" one is worse than an error at the point of authoring.
 *
 * `allowedObjectKeys` defaults to the six built-ins. Pass the org's resolved
 * keys to allow a field on a type the tenant defined for itself — see
 * BUILT_IN_OBJECT_KEYS above for why this can't be a constant.
 */
export function parseFieldDefinition(
  input: FieldDefinitionInput,
  allowedObjectKeys: readonly string[] = BUILT_IN_OBJECT_KEYS,
): FieldDefinitionResult {
  if (typeof input.objectKey !== "string" || !input.objectKey.trim()) {
    return { ok: false, error: "Pick which record type this field belongs to." };
  }
  if (!allowedObjectKeys.includes(input.objectKey)) {
    // Names the recovery rather than just refusing: this is nearly always a
    // caller addressing a record type that was archived or never existed.
    return {
      ok: false,
      error: `"${input.objectKey}" is not a record type in this workspace.`,
    };
  }
  if (!isCustomFieldType(input.fieldType)) {
    return { ok: false, error: "Pick a field type." };
  }

  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (!label) return { ok: false, error: "Give the field a name." };
  if (label.length > 80) return { ok: false, error: "Field name must be 80 characters or fewer." };

  const explicitKey = typeof input.key === "string" ? input.key.trim().toLowerCase() : "";
  const key = explicitKey || deriveCustomFieldKey(label);
  if (!key) {
    return { ok: false, error: "Field name must contain at least one letter or number." };
  }
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(key)) {
    return { ok: false, error: "Field key must start with a letter and use only lowercase letters, numbers, and underscores." };
  }

  const options = parseOptions(input.options);
  if (CHOICE_FIELD_TYPES.has(input.fieldType) && options.length === 0) {
    return { ok: false, error: "Add at least one choice for a select field." };
  }

  const sortOrderRaw = typeof input.sortOrder === "number" ? input.sortOrder : 0;
  const sortOrder = Number.isFinite(sortOrderRaw) ? Math.trunc(sortOrderRaw) : 0;

  const helpTextRaw = typeof input.helpText === "string" ? input.helpText.trim() : "";

  return {
    ok: true,
    definition: {
      objectKey: input.objectKey,
      key,
      label,
      fieldType: input.fieldType,
      required: input.required === true,
      // Non-choice types carry no options, whatever the caller sent.
      options: CHOICE_FIELD_TYPES.has(input.fieldType) ? options : [],
      helpText: helpTextRaw || null,
      sortOrder,
    },
  };
}

export type FieldValueResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** True when a raw input means "the operator left this blank". */
function isBlank(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === "string") return raw.trim() === "";
  if (Array.isArray(raw)) return raw.length === 0;
  return false;
}

/**
 * Coerce a raw form/API input into the JSON value stored for `fieldType`.
 *
 * Blank is stored as null rather than "" or 0, so "not filled in" is
 * distinguishable from "filled in with an empty/zero value" — a required-field
 * check and an Arc read both depend on that distinction.
 */
export function coerceCustomFieldValue(
  definition: Pick<CustomFieldDefinition, "fieldType" | "label" | "required" | "options">,
  raw: unknown,
): FieldValueResult {
  const { fieldType, label } = definition;

  if (isBlank(raw)) {
    if (definition.required) return { ok: false, error: `${label} is required.` };
    return { ok: true, value: null };
  }

  switch (fieldType) {
    case "text": {
      const text = String(raw).trim();
      if (text.length > 2000) return { ok: false, error: `${label} must be 2000 characters or fewer.` };
      return { ok: true, value: text };
    }

    case "number":
    case "currency": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[,$\s]/g, ""));
      if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number.` };
      return { ok: true, value: n };
    }

    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      const s = String(raw).trim().toLowerCase();
      if (["true", "yes", "1", "on"].includes(s)) return { ok: true, value: true };
      if (["false", "no", "0", "off"].includes(s)) return { ok: true, value: false };
      return { ok: false, error: `${label} must be yes or no.` };
    }

    case "date": {
      const s = String(raw).trim();
      // Store the calendar date as written. Parsing to a Date and re-formatting
      // would shift the day for anyone west of UTC.
      const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
      if (!match) return { ok: false, error: `${label} must be a date (YYYY-MM-DD).` };
      const iso = `${match[1]}-${match[2]}-${match[3]}`;
      const probe = new Date(`${iso}T00:00:00Z`);
      if (Number.isNaN(probe.getTime()) || !probe.toISOString().startsWith(iso)) {
        return { ok: false, error: `${label} is not a real date.` };
      }
      return { ok: true, value: iso };
    }

    case "url": {
      const s = String(raw).trim();
      let parsed: URL;
      try {
        parsed = new URL(s);
      } catch {
        return { ok: false, error: `${label} must be a full URL starting with http:// or https://.` };
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: `${label} must be an http:// or https:// URL.` };
      }
      return { ok: true, value: parsed.toString() };
    }

    case "select": {
      const s = String(raw).trim();
      const allowed = definition.options.some((o) => o.value === s);
      if (!allowed) return { ok: false, error: `${label} must be one of the configured choices.` };
      return { ok: true, value: s };
    }

    case "multi_select": {
      const list = Array.isArray(raw) ? raw : [raw];
      const out: string[] = [];
      for (const entry of list) {
        const s = String(entry).trim();
        if (!s || out.includes(s)) continue;
        if (!definition.options.some((o) => o.value === s)) {
          return { ok: false, error: `${label} must only use the configured choices.` };
        }
        out.push(s);
      }
      if (out.length === 0) {
        if (definition.required) return { ok: false, error: `${label} is required.` };
        return { ok: true, value: null };
      }
      return { ok: true, value: out };
    }
  }
}

/**
 * Human-readable rendering for a detail view, a list cell, or Arc's context.
 * Returns "" for an unfilled value so callers can render their own em dash.
 */
export function formatCustomFieldValue(
  definition: Pick<CustomFieldDefinition, "fieldType" | "options">,
  value: unknown,
): string {
  if (value === null || value === undefined) return "";

  const labelFor = (v: string): string =>
    definition.options.find((o) => o.value === v)?.label ?? v;

  switch (definition.fieldType) {
    case "boolean":
      return value === true ? "Yes" : "No";
    case "currency": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return "";
      return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
    }
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) ? n.toLocaleString("en-US") : "";
    }
    case "select":
      return labelFor(String(value));
    case "multi_select":
      return Array.isArray(value) ? value.map((v) => labelFor(String(v))).join(", ") : "";
    default:
      return String(value);
  }
}

/**
 * Changing a field's type reinterprets every value already stored under it, so
 * it is refused once the field has data. The operator's path is to archive the
 * field and add a new one, which retains the old values instead of silently
 * recasting them.
 */
export function canChangeFieldType(hasValues: boolean): { ok: true } | { ok: false; error: string } {
  if (!hasValues) return { ok: true };
  return {
    ok: false,
    // Deliberately does not say "archive it": the CSV import reaches this when
    // reviving an ARCHIVED field whose type no longer matches, and telling that
    // reader to archive it names a step they have already taken.
    error: "This field already has saved values, so its type can't be changed. Add a new field instead.",
  };
}
