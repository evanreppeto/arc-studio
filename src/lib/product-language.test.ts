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
