import { describe, expect, it } from "vitest";

import { canonicalIndustryKey, getProductLanguage } from "./product-language";

describe("product language", () => {
  it("normalizes picker keys and older display labels", () => {
    expect(canonicalIndustryKey("saas")).toBe("saas");
    expect(canonicalIndustryKey("SaaS & B2B tech")).toBe("saas");
    expect(canonicalIndustryKey("Restoration & home services")).toBe("restoration");
    expect(canonicalIndustryKey("Roofing & exteriors")).toBe("home_services");
    expect(canonicalIndustryKey("unknown value")).toBe("general");
  });

  it("uses neutral language when an industry is missing", () => {
    const language = getProductLanguage();
    expect(language.crmLabel).toBe("Relationships");
    expect(language.crmObjects.properties.label).toBe("Sites");
    expect(language.crmObjects.jobs.nameHeader).toBe("Project");
  });

  it("tailors the relationship model without changing object keys", () => {
    const healthcare = getProductLanguage("healthcare");
    expect(healthcare.crmLabel).toBe("Patients");
    expect(healthcare.crmObjects.contacts).toMatchObject({ label: "Patients", singular: "patient" });
    expect(healthcare.crmObjects.jobs).toMatchObject({ label: "Appointments", singular: "appointment" });

    const realEstate = getProductLanguage("real_estate");
    expect(realEstate.crmObjects.jobs.label).toBe("Deals");
    expect(realEstate.crmObjects.outcomes.label).toBe("Closings");
  });
});

describe("getProductLanguage — workspace overrides", () => {
  const matters = { objects: { properties: { plural: "Matters", singular: "matter" } } };

  it("lets a workspace's own words beat its industry vocabulary", () => {
    const language = getProductLanguage("professional_services", matters);

    expect(language.crmObjects.properties).toEqual({
      label: "Matters",
      noun: "matters",
      nameHeader: "Matter",
      singular: "matter",
    });
  });

  // The reason overrides apply per object rather than wholesale: renaming one
  // thing must not drop the other five to `general`'s neutral nouns.
  it("keeps the industry vocabulary for objects the workspace did not rename", () => {
    const language = getProductLanguage("professional_services", matters);

    expect(language.crmObjects.contacts.label).toBe("Clients");
    expect(language.crmObjects.jobs.label).toBe("Engagements");
  });

  it("renames the CRM section itself", () => {
    expect(getProductLanguage("general", { section: "Matters" }).crmLabel).toBe("Matters");
  });

  it("keeps the industry section name when no section override is set", () => {
    expect(getProductLanguage("healthcare", matters).crmLabel).toBe("Patients");
  });

  // A half-filled override would put "Matters" in the tab and "Add site" in the
  // button below it. Falling back keeps one screen speaking one vocabulary.
  it("ignores a half-filled override", () => {
    const language = getProductLanguage("general", {
      objects: { properties: { plural: "Matters", singular: "" } },
    });

    expect(language.crmObjects.properties.label).toBe("Sites");
  });

  it("ignores a malformed override without throwing", () => {
    const language = getProductLanguage("general", {
      objects: { properties: "Matters" as unknown as { plural: string; singular: string } },
    });

    expect(language.crmObjects.properties.label).toBe("Sites");
  });

  it("is unchanged when no overrides are passed at all", () => {
    expect(getProductLanguage("restoration")).toEqual(getProductLanguage("restoration", null));
  });
});
