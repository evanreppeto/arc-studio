import type { CustomFieldDefinition, CustomFieldObjectKey } from "@/domain";

/**
 * Demo custom fields for the offline preview (ARC_DEMO_DATA).
 *
 * Without these the whole custom-fields surface is invisible in the preview:
 * the definitions come only from Supabase, so Settings → Records → Fields, the
 * Fields editor on the CRM board, the custom columns and the record's own
 * Custom fields section all render their empty state. That is not a fair
 * picture of the feature, and it means the edit form — the part that had no
 * caller at all until recently — cannot be looked at without a database.
 *
 * Deliberately tenant-agnostic. These are the kinds of things ANY owner-operator
 * tracks that no built-in column covers (docs/UNIVERSALITY.md); nothing here is
 * restoration-specific, because the demo tenant is not the product's shape.
 *
 * Two objects are deliberately left with NO fields. The empty state is a real
 * state — it is what every workspace sees on day one — and a fixture that fills
 * every surface hides it.
 *
 * ⚠️ Nothing here is writable. Demo mode has no Supabase, so create/edit/archive
 * all return "Custom fields need a configured database" rather than appearing to
 * save. That refusal is the honest half of this fixture: the preview shows what
 * the feature LOOKS like, and says plainly that it cannot persist.
 */

function def(
  objectKey: CustomFieldObjectKey,
  key: string,
  label: string,
  fieldType: CustomFieldDefinition["fieldType"],
  extra: Partial<CustomFieldDefinition> = {},
): CustomFieldDefinition {
  return {
    // Prefixed so a demo id can never be mistaken for a real uuid if one leaks
    // into a write path — it will fail loudly at Postgres rather than match a row.
    id: `demo-field-${objectKey}-${key}`,
    objectKey,
    key,
    label,
    fieldType,
    required: false,
    options: [],
    helpText: null,
    sortOrder: 0,
    active: true,
    ...extra,
  };
}

const DEMO_FIELDS: Partial<Record<CustomFieldObjectKey, CustomFieldDefinition[]>> = {
  contacts: [
    def("contacts", "referral_source", "Referral source", "text", {
      sortOrder: 0,
      helpText: "How this person found you.",
    }),
    def("contacts", "best_time", "Best time to reach", "select", {
      sortOrder: 1,
      options: [
        { value: "morning", label: "Morning" },
        { value: "afternoon", label: "Afternoon" },
        { value: "evening", label: "Evening" },
      ],
    }),
  ],
  companies: [
    def("companies", "renewal_month", "Renewal month", "date", { sortOrder: 0 }),
  ],
  properties: [
    def("properties", "access_notes", "Access notes", "text", {
      sortOrder: 0,
      helpText: "Gate codes, parking, who to ask for.",
    }),
  ],
  leads: [
    def("leads", "budget_range", "Budget range", "select", {
      sortOrder: 0,
      required: true,
      options: [
        { value: "under_5k", label: "Under $5k" },
        { value: "5k_25k", label: "$5k–$25k" },
        { value: "over_25k", label: "Over $25k" },
      ],
    }),
  ],
  // jobs and outcomes intentionally have none — see the note above.
};

export function demoFieldDefinitions(objectKey: CustomFieldObjectKey): CustomFieldDefinition[] {
  return DEMO_FIELDS[objectKey] ?? [];
}

export function allDemoFieldDefinitions(): CustomFieldDefinition[] {
  return Object.values(DEMO_FIELDS).flat();
}

/**
 * A stable per-record value, so the columns show data rather than a wall of
 * dashes — which would read as "custom fields are broken" rather than "this
 * workspace has none".
 *
 * Derived from the record id so it is deterministic across renders and differs
 * between rows. Some records are deliberately left blank: a field nobody has
 * filled in yet is the common case, and the record page has to show it.
 */
function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const REFERRAL_SOURCES = ["Existing customer", "Google search", "Trade referral", "Repeat client"];

export function demoFieldValue(definition: CustomFieldDefinition, recordId: string): { value: unknown; display: string } | null {
  const n = hash(`${definition.key}:${recordId}`);
  // ~1 in 4 records has nothing for a given field.
  if (n % 4 === 0) return null;

  if (definition.options.length > 0) {
    const option = definition.options[n % definition.options.length];
    return { value: option.value, display: option.label };
  }
  if (definition.fieldType === "date") {
    const month = new Date(Date.UTC(2027, n % 12, 1));
    const display = month.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    return { value: month.toISOString().slice(0, 10), display };
  }
  if (definition.key === "referral_source") {
    const source = REFERRAL_SOURCES[n % REFERRAL_SOURCES.length];
    return { value: source, display: source };
  }
  if (definition.key === "access_notes") {
    return { value: "Gate code at the callbox", display: "Gate code at the callbox" };
  }
  return null;
}
