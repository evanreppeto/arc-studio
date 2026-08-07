import { describe, expect, it } from "vitest";

import { detectLocalSeoOpportunities, type LocationProfile } from "../local-seo";

const NOW = "2026-08-06T12:00:00.000Z";

/** A profile with every audited field healthy — rules bite only when a test breaks one. */
function healthy(overrides: Partial<LocationProfile> = {}): LocationProfile {
  return {
    id: "loc-1",
    title: "Big Shoulders Restoration",
    primaryCategory: "Water damage restoration service",
    additionalCategories: ["Fire damage restoration service"],
    hasRegularHours: true,
    serviceAreaCount: 12,
    description: "x".repeat(200),
    websiteUri: "https://example.com",
    serviceItemCount: 6,
    readFields: ["title", "categories", "regularHours", "serviceArea", "profile", "websiteUri", "serviceItems"],
    ...overrides,
  };
}

function keys(profile: LocationProfile): string[] {
  return detectLocalSeoOpportunities(profile, { now: NOW }).map((o) => String(o.evidence.gap));
}

describe("local SEO audit", () => {
  it("finds nothing on a complete profile", () => {
    expect(detectLocalSeoOpportunities(healthy(), { now: NOW })).toEqual([]);
  });

  it("flags the gaps that suppress local visibility", () => {
    expect(keys(healthy({ primaryCategory: null }))).toContain("missing_primary_category");
    expect(keys(healthy({ serviceAreaCount: 0 }))).toContain("no_service_area");
    expect(keys(healthy({ hasRegularHours: false }))).toContain("missing_hours");
    expect(keys(healthy({ description: "Restoration." }))).toContain("thin_description");
    expect(keys(healthy({ websiteUri: null }))).toContain("missing_website");
    expect(keys(healthy({ serviceItemCount: 0 }))).toContain("no_service_items");
  });

  it("ranks category and service area above the rest", () => {
    const found = detectLocalSeoOpportunities(healthy({ primaryCategory: null, serviceAreaCount: 0, serviceItemCount: 0 }), {
      now: NOW,
    });
    const urgency = Object.fromEntries(found.map((o) => [String(o.evidence.gap), o.urgency]));
    expect(urgency.missing_primary_category).toBe("high");
    expect(urgency.no_service_area).toBe("high");
    expect(urgency.no_service_items).toBe("low");
  });

  // REGRESSION GUARD: MISSING_IS_NOT_EMPTY. A readMask fetch returns only what it
  // asked for, so an unread field is unknown — auditing it anyway would tell an
  // operator their hours are missing when the fetch simply never requested them.
  it("does not audit a field that was never read", () => {
    const partial: LocationProfile = {
      id: "loc-1",
      // Only categories was read; everything else is absent, not empty.
      readFields: ["categories"],
      primaryCategory: "Water damage restoration service",
    };
    expect(detectLocalSeoOpportunities(partial, { now: NOW })).toEqual([]);
  });

  it("audits everything when the caller tracks no read fields", () => {
    const untracked: LocationProfile = { id: "loc-1", primaryCategory: null };
    expect(keys(untracked)).toContain("missing_primary_category");
  });

  it("gives each gap a stable per-rule subject id so dedup retires them one at a time", () => {
    const found = detectLocalSeoOpportunities(healthy({ primaryCategory: null, websiteUri: null }), { now: NOW });
    const ids = found.map((o) => o.subjectId);
    expect(ids).toContain("loc-1:missing_primary_category");
    expect(ids).toContain("loc-1:missing_website");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns nothing without a location id", () => {
    expect(detectLocalSeoOpportunities(null, { now: NOW })).toEqual([]);
    expect(detectLocalSeoOpportunities({ id: "  " }, { now: NOW })).toEqual([]);
  });

  it("proposes fixes rather than describing edits it could make", () => {
    const found = detectLocalSeoOpportunities(healthy({ primaryCategory: null }), { now: NOW });
    expect(found[0]!.kind).toBe("local_seo_gap");
    expect(found[0]!.recommendedAction).toMatch(/^Set a primary/);
    expect(found[0]!.evidence.source).toBe("google_business_profile");
  });
});
