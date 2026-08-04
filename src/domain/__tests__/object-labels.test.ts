import { describe, expect, it } from "vitest";

import { deriveObjectLabelForms, OBJECT_LABEL_MAX_LENGTH, parseObjectLabelOverride } from "../object-labels";

describe("parseObjectLabelOverride", () => {
  it("accepts a complete override", () => {
    expect(parseObjectLabelOverride({ plural: "Matters", singular: "matter" })).toEqual({
      plural: "Matters",
      singular: "matter",
    });
  });

  // Half an override would mix two vocabularies on one screen: a "Matters" tab
  // above an "Add site" button.
  it.each([
    ["plural only", { plural: "Matters", singular: "" }],
    ["singular only", { plural: "", singular: "matter" }],
    ["whitespace only", { plural: "   ", singular: "  " }],
  ])("refuses a partial override (%s)", (_label, input) => {
    expect(parseObjectLabelOverride(input)).toBeNull();
  });

  it.each([
    ["null", null],
    ["a string", "Matters"],
    ["a number", 7],
    ["wrong keys", { label: "Matters" }],
  ])("refuses malformed input (%s)", (_label, input) => {
    expect(parseObjectLabelOverride(input)).toBeNull();
  });

  it("trims and collapses whitespace", () => {
    expect(parseObjectLabelOverride({ plural: "  Service   locations ", singular: " service location " })).toEqual({
      plural: "Service locations",
      singular: "service location",
    });
  });

  it("caps length so a label cannot break a tab", () => {
    const long = "x".repeat(OBJECT_LABEL_MAX_LENGTH + 20);
    const parsed = parseObjectLabelOverride({ plural: long, singular: long });
    expect(parsed?.plural).toHaveLength(OBJECT_LABEL_MAX_LENGTH);
  });
});

describe("deriveObjectLabelForms", () => {
  it("expands two words into the four rendered forms", () => {
    expect(deriveObjectLabelForms({ plural: "Matters", singular: "matter" })).toEqual({
      label: "Matters",
      noun: "matters",
      nameHeader: "Matter",
      singular: "matter",
    });
  });

  // The reason a workspace types the singular instead of us guessing it.
  it("does not mangle an irregular plural", () => {
    const forms = deriveObjectLabelForms({ plural: "People", singular: "person" });
    expect(forms.singular).toBe("person");
    expect(forms.nameHeader).toBe("Person");
  });

  it("leaves acronyms capitalized mid-sentence", () => {
    const forms = deriveObjectLabelForms({ plural: "HOA Boards", singular: "HOA board" });
    expect(forms.noun).toBe("HOA boards");
    expect(forms.singular).toBe("HOA board");
    expect(forms.nameHeader).toBe("HOA board");
  });

  it("lowercases ordinary words for mid-sentence use", () => {
    expect(deriveObjectLabelForms({ plural: "Service Locations", singular: "Service Location" })).toMatchObject({
      label: "Service Locations",
      noun: "service locations",
      singular: "service location",
      nameHeader: "Service Location",
    });
  });
});
