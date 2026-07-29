import { describe, expect, it } from "vitest";

import { coerceCustomFieldValue, type CustomFieldDefinition } from "../custom-fields";

/**
 * The rule `validateCustomFieldValues` depends on at record creation: a required
 * field must be enforced even when the caller omitted the key entirely, or
 * "required" would only bind callers that happened to send it.
 */
const required = (
  over: Partial<Pick<CustomFieldDefinition, "fieldType" | "options">> = {},
): Pick<CustomFieldDefinition, "fieldType" | "label" | "required" | "options"> => ({
  fieldType: "text",
  label: "Matter number",
  required: true,
  options: [],
  ...over,
});

describe("required custom fields at creation", () => {
  it("rejects an omitted required field (undefined, as a missing key coerces to)", () => {
    const result = coerceCustomFieldValue(required(), undefined);

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("Matter number");
  });

  it("rejects a whitespace-only required field", () => {
    expect(coerceCustomFieldValue(required(), "   ").ok).toBe(false);
  });

  it("rejects an empty required multi-select", () => {
    const def = required({ fieldType: "multi_select", options: [{ value: "a", label: "A" }] });
    expect(coerceCustomFieldValue(def, []).ok).toBe(false);
  });

  it("accepts a required boolean set to false", () => {
    // false is a real answer, not a blank — a required yes/no field is satisfied
    // by "no". Treating it as missing would make the field unanswerable.
    expect(coerceCustomFieldValue(required({ fieldType: "boolean" }), false)).toEqual({
      ok: true,
      value: false,
    });
  });

  it("accepts a required number set to zero", () => {
    expect(coerceCustomFieldValue(required({ fieldType: "number" }), 0)).toEqual({ ok: true, value: 0 });
  });

  it("leaves an omitted OPTIONAL field as null rather than erroring", () => {
    const optional = { ...required(), required: false };
    expect(coerceCustomFieldValue(optional, undefined)).toEqual({ ok: true, value: null });
  });
});
