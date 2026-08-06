import { describe, expect, it, vi } from "vitest";

import { detectLocalSeoOpportunities } from "@/domain";

import { LOCATION_READ_MASK, gbpLocationSource, gbpLocationToProfile } from "./location";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

/** Typed so `mock.calls[n]` carries the fetch arguments the assertions inspect. */
const stubFetch = (body: unknown, status = 200) =>
  vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => jsonResponse(body, status));

const FULL = {
  name: "locations/987",
  title: "Big Shoulders Restoration",
  categories: {
    primaryCategory: { displayName: "Water damage restoration service" },
    additionalCategories: [{ displayName: "Fire damage restoration service" }],
  },
  regularHours: { periods: [{}, {}] },
  serviceArea: { places: { placeInfos: [{}, {}, {}] } },
  profile: { description: "x".repeat(200) },
  websiteUri: "https://example.com",
  serviceItems: [{}, {}],
};

describe("gbpLocationToProfile", () => {
  it("maps the API shape onto the provider-agnostic profile", () => {
    const profile = gbpLocationToProfile(FULL, "locations/987");
    expect(profile).toMatchObject({
      id: "987",
      title: "Big Shoulders Restoration",
      primaryCategory: "Water damage restoration service",
      hasRegularHours: true,
      serviceAreaCount: 3,
      websiteUri: "https://example.com",
      serviceItemCount: 2,
    });
  });

  // A field the response omitted is unknown, not empty. Mapping it to 0/false
  // would hand the auditor a confident gap the fetch never actually observed.
  it("leaves an omitted field undefined rather than defaulting it to empty", () => {
    const profile = gbpLocationToProfile({ name: "locations/987" }, "locations/987");
    expect(profile.hasRegularHours).toBeUndefined();
    expect(profile.serviceAreaCount).toBeUndefined();
    expect(profile.description).toBeUndefined();
    expect(profile.serviceItemCount).toBeUndefined();
  });

  it("distinguishes a present-but-empty field from an absent one", () => {
    const profile = gbpLocationToProfile({ regularHours: { periods: [] }, serviceArea: {} }, "locations/987");
    expect(profile.hasRegularHours).toBe(false);
    expect(profile.serviceAreaCount).toBe(0);
  });
});

describe("gbpLocationSource", () => {
  it("translates the stored location name and sends the required readMask", async () => {
    const fetchImpl = stubFetch(FULL);
    await gbpLocationSource("tok", {
      configLocation: "accounts/123/locations/987",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).fetchProfile();

    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).toContain("/v1/locations/987?");
    expect(url).not.toContain("accounts/");
    expect(url).toContain(`readMask=${encodeURIComponent(LOCATION_READ_MASK)}`);
  });

  it("returns null without a usable location instead of firing a doomed request", async () => {
    const fetchImpl = stubFetch(FULL);
    const profile = await gbpLocationSource("tok", {
      configLocation: "not-a-resource-name",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).fetchProfile();
    expect(profile).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("degrades to null on a provider failure so a scan survives it", async () => {
    const fetchImpl = stubFetch({}, 500);
    const profile = await gbpLocationSource("tok", {
      configLocation: "locations/987",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).fetchProfile();
    expect(profile).toBeNull();
  });

  // The fetched mask and the audited fields are one contract: a rule whose field
  // is absent from LOCATION_READ_FIELDS can never fire, and a mask field with no
  // rule is a wasted read. This catches the first half, which fails silently.
  it("reads every field the audit can act on", async () => {
    const fetchImpl = stubFetch({ name: "locations/987" });
    const profile = await gbpLocationSource("tok", {
      configLocation: "locations/987",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).fetchProfile();

    // An entirely empty profile should trip every rule the auditor has.
    const gaps = detectLocalSeoOpportunities({ ...profile!, readFields: undefined }, { now: "2026-08-06T00:00:00.000Z" });
    const audited = new Set(gaps.map((g) => String(g.evidence.field)));
    for (const field of audited) {
      expect(LOCATION_READ_MASK.split(",")).toContain(field);
    }
  });
});
