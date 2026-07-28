import { describe, expect, it } from "vitest";

import {
  canChangeFieldType,
  coerceCustomFieldValue,
  deriveCustomFieldKey,
  formatCustomFieldValue,
  parseFieldDefinition,
  type CustomFieldDefinition,
} from "../custom-fields";

const def = (
  over: Partial<Pick<CustomFieldDefinition, "fieldType" | "label" | "required" | "options">>,
): Pick<CustomFieldDefinition, "fieldType" | "label" | "required" | "options"> => ({
  fieldType: "text",
  label: "Field",
  required: false,
  options: [],
  ...over,
});

describe("deriveCustomFieldKey", () => {
  it("slugifies an operator-typed label", () => {
    expect(deriveCustomFieldKey("Matter number")).toBe("matter_number");
    expect(deriveCustomFieldKey("  Policy #  ")).toBe("policy");
  });

  it("prefixes a key that would start with a digit", () => {
    // The DB constraint requires a leading letter; a bare "2024_target" would
    // be rejected at insert time.
    expect(deriveCustomFieldKey("2024 target")).toBe("f_2024_target");
  });

  it("returns empty for a label with no usable characters", () => {
    // Deliberately not a fallback key — the caller reports a validation error.
    expect(deriveCustomFieldKey("###")).toBe("");
    expect(deriveCustomFieldKey(null)).toBe("");
  });

  it("never emits a key the DB constraint would reject", () => {
    const pattern = /^[a-z][a-z0-9_]{0,62}$/;
    for (const label of ["Matter number", "2024 target", "A".repeat(200), "ünïcødé name", "a-b-c"]) {
      const key = deriveCustomFieldKey(label);
      if (key) expect(key).toMatch(pattern);
    }
  });
});

describe("parseFieldDefinition", () => {
  it("accepts a well-formed definition and derives the key", () => {
    const result = parseFieldDefinition({
      objectKey: "properties",
      label: "Matter number",
      fieldType: "text",
    });

    expect(result).toMatchObject({
      ok: true,
      definition: { objectKey: "properties", key: "matter_number", label: "Matter number", required: false },
    });
  });

  it("rejects an unknown object key", () => {
    const result = parseFieldDefinition({ objectKey: "invoices", label: "X", fieldType: "text" });
    expect(result.ok).toBe(false);
  });

  it("requires at least one choice on a select field", () => {
    const result = parseFieldDefinition({ objectKey: "leads", label: "Stage", fieldType: "select" });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/choice/i);
  });

  it("drops options on a type that has no choices", () => {
    const result = parseFieldDefinition({
      objectKey: "leads",
      label: "Notes",
      fieldType: "text",
      options: ["a", "b"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.definition.options).toEqual([]);
  });

  it("normalizes and de-duplicates choices", () => {
    const result = parseFieldDefinition({
      objectKey: "leads",
      label: "Stage",
      fieldType: "select",
      options: ["new", { value: "won", label: "Closed won" }, "new", "  "],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.definition.options).toEqual([
        { value: "new", label: "new" },
        { value: "won", label: "Closed won" },
      ]);
    }
  });

  it("rejects a malformed explicit key rather than repairing it", () => {
    const result = parseFieldDefinition({
      objectKey: "leads",
      key: "9bad key!",
      label: "Stage",
      fieldType: "text",
    });

    expect(result.ok).toBe(false);
  });
});

describe("coerceCustomFieldValue", () => {
  it("stores blank as null, not empty string", () => {
    // "not filled in" must stay distinguishable from "filled in with nothing".
    expect(coerceCustomFieldValue(def({}), "   ")).toEqual({ ok: true, value: null });
    expect(coerceCustomFieldValue(def({}), null)).toEqual({ ok: true, value: null });
  });

  it("rejects blank on a required field", () => {
    const result = coerceCustomFieldValue(def({ required: true, label: "Matter" }), "");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/required/i);
  });

  it("parses a currency string with symbols and separators", () => {
    expect(coerceCustomFieldValue(def({ fieldType: "currency" }), "$1,250.50")).toEqual({
      ok: true,
      value: 1250.5,
    });
  });

  it("rejects a non-numeric number", () => {
    expect(coerceCustomFieldValue(def({ fieldType: "number" }), "abc").ok).toBe(false);
  });

  it("keeps zero and false as real values, not blanks", () => {
    expect(coerceCustomFieldValue(def({ fieldType: "number", required: true }), 0)).toEqual({
      ok: true,
      value: 0,
    });
    expect(coerceCustomFieldValue(def({ fieldType: "boolean", required: true }), false)).toEqual({
      ok: true,
      value: false,
    });
  });

  it("stores a date as the written calendar day", () => {
    // Parsing to a Date and reformatting would shift the day west of UTC.
    expect(coerceCustomFieldValue(def({ fieldType: "date" }), "2026-03-01")).toEqual({
      ok: true,
      value: "2026-03-01",
    });
  });

  it("rejects a date that does not exist", () => {
    expect(coerceCustomFieldValue(def({ fieldType: "date" }), "2026-02-30").ok).toBe(false);
    expect(coerceCustomFieldValue(def({ fieldType: "date" }), "March 1st").ok).toBe(false);
  });

  it("rejects a non-http url scheme", () => {
    expect(coerceCustomFieldValue(def({ fieldType: "url" }), "https://example.com").ok).toBe(true);
    expect(coerceCustomFieldValue(def({ fieldType: "url" }), "javascript:alert(1)").ok).toBe(false);
    expect(coerceCustomFieldValue(def({ fieldType: "url" }), "example.com").ok).toBe(false);
  });

  it("rejects a select value outside the configured choices", () => {
    const d = def({ fieldType: "select", options: [{ value: "new", label: "New" }] });
    expect(coerceCustomFieldValue(d, "new")).toEqual({ ok: true, value: "new" });
    expect(coerceCustomFieldValue(d, "other").ok).toBe(false);
  });

  it("de-duplicates a multi-select and rejects unknown entries", () => {
    const d = def({
      fieldType: "multi_select",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    });

    expect(coerceCustomFieldValue(d, ["a", "b", "a"])).toEqual({ ok: true, value: ["a", "b"] });
    expect(coerceCustomFieldValue(d, ["a", "z"]).ok).toBe(false);
  });

  it("treats an empty multi-select as unfilled", () => {
    const d = def({ fieldType: "multi_select", options: [{ value: "a", label: "A" }] });
    expect(coerceCustomFieldValue(d, [])).toEqual({ ok: true, value: null });
    expect(coerceCustomFieldValue({ ...d, required: true }, []).ok).toBe(false);
  });
});

describe("formatCustomFieldValue", () => {
  it("renders unfilled as empty so callers supply their own dash", () => {
    expect(formatCustomFieldValue(def({}), null)).toBe("");
  });

  it("renders choice labels, not raw values", () => {
    const d = def({
      fieldType: "multi_select",
      options: [
        { value: "won", label: "Closed won" },
        { value: "new", label: "New" },
      ],
    });

    expect(formatCustomFieldValue(d, ["won", "new"])).toBe("Closed won, New");
  });

  it("renders false as No rather than blank", () => {
    expect(formatCustomFieldValue(def({ fieldType: "boolean" }), false)).toBe("No");
  });

  it("renders currency and number readably", () => {
    expect(formatCustomFieldValue(def({ fieldType: "currency" }), 1250.5)).toBe("$1,250.50");
    expect(formatCustomFieldValue(def({ fieldType: "number" }), 1250)).toBe("1,250");
  });
});

describe("canChangeFieldType", () => {
  it("allows a type change before any values exist", () => {
    expect(canChangeFieldType(false)).toEqual({ ok: true });
  });

  it("refuses once the field has saved values", () => {
    // Recasting stored values silently is worse than making the operator
    // archive and re-add, which retains the originals.
    expect(canChangeFieldType(true).ok).toBe(false);
  });
});
