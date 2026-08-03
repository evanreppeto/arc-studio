import { parseCsvDate } from "./csv-import";
import { type CustomFieldType } from "./custom-fields";

/**
 * Turning a column we didn't anticipate into a field the tenant keeps (BSR-645).
 *
 * `parseCsvContacts` maps a fixed set of known columns and discards the rest —
 * silently. A real export has 30–60 columns, and "policy number", "square
 * footage", "referring plumber", "franchise territory" are exactly the ones that
 * encode how that business actually works. Throwing them away without a word is
 * the default this module exists to remove.
 *
 * This is the M3 universality thesis applied to import: the columns we did not
 * anticipate are the ones that make a workspace feel built for its owner.
 *
 * Pure — inference is a judgement about data, and it should be arguable in a test
 * rather than only observable after a write.
 */

/** Distinct-value ceiling for treating a column as a picklist rather than text. */
const MAX_SELECT_OPTIONS = 12;
/** A column is only a picklist if its values genuinely repeat. */
const MAX_SELECT_RATIO = 0.5;

export type InferredField = {
  /** Machine key, matching the DB's `^[a-z][a-z0-9_]{0,62}$` constraint. */
  key: string;
  /** What the operator sees — the original header, tidied. */
  label: string;
  fieldType: CustomFieldType;
  /** Populated for select; empty otherwise. */
  options: Array<{ value: string; label: string }>;
  /** A few real values, so the operator can sanity-check the guess. */
  samples: string[];
};

/**
 * A stable machine key for a header. Lowercase, underscore-separated, starting
 * with a letter, ≤63 chars — the format `custom_field_definitions_key_format_check`
 * enforces. Deterministic, because re-importing the same file must reuse the same
 * definition rather than creating a near-duplicate beside it.
 */
export function toFieldKey(header: string): string {
  const base = header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 63);

  // A header with nothing usable in it ("", "!!!") must not fall through to the
  // digit-prefix path below: that yields "f" for every one of them, so two
  // unnamed columns would silently collide on one definition.
  if (!base) return "field";

  // Must start with a letter: "2026 revenue" would otherwise be rejected outright
  // by the key format check.
  const prefixed = /^[a-z]/.test(base) ? base : `f_${base}`;
  return prefixed.replace(/_+$/g, "").slice(0, 63);
}

/** "policy_number" / "POLICY NUMBER" → "Policy number". Left alone if already mixed case. */
export function toFieldLabel(header: string): string {
  const trimmed = header.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!trimmed) return "Untitled";
  const isShouty = trimmed === trimmed.toUpperCase();
  const normalized = isShouty ? trimmed.toLowerCase() : trimmed;
  return (normalized.charAt(0).toUpperCase() + normalized.slice(1)).slice(0, 80);
}

const BOOLEAN_VALUES = new Set(["true", "false", "yes", "no", "y", "n", "1", "0"]);

/**
 * Guess a column's type from what is actually in it.
 *
 * Ordered from most specific to least, and deliberately conservative: a wrong
 * guess is recoverable (the operator changes it before committing) but a guess
 * that looks confident and is wrong is worse than falling back to text.
 */
export function inferCustomFieldType(values: string[]): { fieldType: CustomFieldType; options: InferredField["options"] } {
  const present = values.map((v) => v?.trim() ?? "").filter(Boolean);
  if (present.length === 0) return { fieldType: "text", options: [] };

  const lower = present.map((v) => v.toLowerCase());

  // Booleans before numbers: "1"/"0" is a boolean column far more often than a
  // meaningful quantity, but only when NOTHING else appears in it.
  if (lower.every((v) => BOOLEAN_VALUES.has(v)) && new Set(lower).size <= 2) {
    return { fieldType: "boolean", options: [] };
  }

  if (present.every((v) => /^-?\$?[\d,]+(\.\d+)?$/.test(v))) {
    // A currency marker is a claim about meaning, not just format.
    const currency = present.some((v) => v.includes("$"));
    return { fieldType: currency ? "currency" : "number", options: [] };
  }

  // parseCsvDate deliberately refuses ambiguous forms, so this only fires on
  // dates we would actually parse the same way at import time.
  if (present.every((v) => parseCsvDate(v) !== undefined)) {
    return { fieldType: "date", options: [] };
  }

  if (present.every((v) => /^https?:\/\//i.test(v))) {
    return { fieldType: "url", options: [] };
  }

  // A picklist only when values genuinely repeat. Without the ratio check a
  // 10-row file makes every column a select, and the tenant inherits a dropdown
  // of their first ten customers.
  const distinct = [...new Set(present)];
  if (distinct.length <= MAX_SELECT_OPTIONS && distinct.length / present.length <= MAX_SELECT_RATIO) {
    return {
      fieldType: "select",
      options: distinct.sort().map((value) => ({ value, label: value })),
    };
  }

  return { fieldType: "text", options: [] };
}

/** Full suggestion for one unmapped column. */
export function inferCustomField(header: string, values: string[]): InferredField {
  const { fieldType, options } = inferCustomFieldType(values);
  return {
    key: toFieldKey(header),
    label: toFieldLabel(header),
    fieldType,
    options,
    samples: values.map((v) => v?.trim() ?? "").filter(Boolean).slice(0, 3),
  };
}
