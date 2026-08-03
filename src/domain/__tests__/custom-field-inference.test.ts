import { describe, expect, it } from "vitest";

import { inferCustomField, inferCustomFieldType, toFieldKey, toFieldLabel } from "../custom-field-inference";
import { parseCsvContacts } from "../csv-import";

/**
 * BSR-645. A real export has 30–60 columns and the importer mapped about ten,
 * discarding the rest without a word — including the ones that encode how that
 * business actually works.
 */

describe("toFieldKey", () => {
  it("produces a key the database will accept", () => {
    // custom_field_definitions_key_format_check: ^[a-z][a-z0-9_]{0,62}$
    const cases = ["Policy Number", "Square footage", "referring-plumber", "  Renewal Date  "];
    for (const header of cases) {
      expect(toFieldKey(header)).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
    }
  });

  it("prefixes a header that starts with a digit rather than emitting an invalid key", () => {
    // "2026 revenue" would be rejected outright by the check constraint.
    expect(toFieldKey("2026 Revenue")).toMatch(/^[a-z]/);
    expect(toFieldKey("2026 Revenue")).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
  });

  it("is deterministic, so a re-import reuses the definition instead of duplicating it", () => {
    // The reuse behaviour depends entirely on this: same header, same key.
    expect(toFieldKey("Policy Number")).toBe(toFieldKey("policy number"));
    expect(toFieldKey("Policy  Number")).toBe(toFieldKey("Policy_Number"));
  });

  it("never returns an empty key", () => {
    // Both of these have nothing usable in them. They must not both collapse to
    // the same key, or two unnamed columns share one definition.
    expect(toFieldKey("!!!")).toBe("field");
    expect(toFieldKey("")).toBe("field");
    expect(toFieldKey("2026")).toBe("f_2026");
  });
});

describe("toFieldLabel", () => {
  it("makes a shouty header readable without touching a considered one", () => {
    expect(toFieldLabel("POLICY NUMBER")).toBe("Policy number");
    expect(toFieldLabel("referring_plumber")).toBe("Referring plumber");
    // Already mixed case: the author meant it.
    expect(toFieldLabel("Referring Plumber")).toBe("Referring Plumber");
  });
});

describe("inferCustomFieldType", () => {
  it("reads a repeating short vocabulary as a picklist", () => {
    const values = ["Water", "Fire", "Water", "Mold", "Water", "Fire"];
    const out = inferCustomFieldType(values);
    expect(out.fieldType).toBe("select");
    expect(out.options.map((o) => o.value)).toEqual(["Fire", "Mold", "Water"]);
  });

  it("does NOT call a column of mostly-distinct values a picklist", () => {
    // Without the ratio check, a 10-row file makes every column a select and the
    // tenant inherits a dropdown of their first ten customers.
    const values = ["Acme", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"];
    expect(inferCustomFieldType(values).fieldType).toBe("text");
  });

  it("separates currency from plain number by the marker, not the magnitude", () => {
    expect(inferCustomFieldType(["1200", "3400", "980"]).fieldType).toBe("number");
    expect(inferCustomFieldType(["$1,200", "$3,400"]).fieldType).toBe("currency");
  });

  it("only calls a column a date when every value would actually parse", () => {
    expect(inferCustomFieldType(["2026-01-15", "2025-11-02"]).fieldType).toBe("date");
    // parseCsvDate deliberately refuses ambiguous forms; inference must not be
    // more confident than the parser that has to read it later.
    expect(inferCustomFieldType(["15/01/2026", "02/11/2025"]).fieldType).not.toBe("date");
  });

  it("reads yes/no as boolean but a mixed column as something else", () => {
    expect(inferCustomFieldType(["yes", "no", "yes"]).fieldType).toBe("boolean");
    expect(inferCustomFieldType(["yes", "no", "maybe"]).fieldType).not.toBe("boolean");
  });

  it("falls back to text on an empty column rather than guessing", () => {
    expect(inferCustomFieldType(["", "  ", ""]).fieldType).toBe("text");
  });
});

describe("end to end from a CSV", () => {
  it("surfaces the unmapped columns with their values, keyed to the record each row became", () => {
    const csv = [
      "name,email,Policy Number,Loss Type",
      "Ada Lovelace,ada@example.com,POL-1,Water",
      "Grace Hopper,grace@example.com,POL-2,Fire",
    ].join("\n");

    const out = parseCsvContacts(csv);

    expect(out.unmappedColumns).toEqual(expect.arrayContaining(["Policy Number", "Loss Type"]));
    expect(out.unmappedValues["Policy Number"]).toEqual(["POL-1", "POL-2"]);

    // Attaching values to the right record depends on this pairing.
    const firstId = out.contacts[0]?.id ?? "";
    expect(out.extraValuesByContactId[firstId]).toEqual({ "Policy Number": "POL-1", "Loss Type": "Water" });

    const suggestion = inferCustomField("Policy Number", out.unmappedValues["Policy Number"] ?? []);
    // Label keeps the author's casing — "Policy Number" was deliberate.
    expect(suggestion).toMatchObject({ key: "policy_number", label: "Policy Number", fieldType: "text" });
    expect(suggestion.samples).toEqual(["POL-1", "POL-2"]);
  });

  it("does not let an unmapped column reach the lead payload", () => {
    // These are not part of the lead ingestion contract. Mixing them into
    // `properties` would send an unrecognised column into the ingest path.
    const csv = "name,email,Policy Number\nAda,ada@example.com,POL-1";
    const out = parseCsvContacts(csv);
    expect(out.contacts[0]?.properties).not.toHaveProperty("Policy Number");
  });
});
