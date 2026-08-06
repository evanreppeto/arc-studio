import { describe, expect, it } from "vitest";

import { cityFromPostalAddress, describeMonitoredPointCoverage } from "../nws-weather";

/**
 * BSR-756 (connector half). BSR monitored four points; three sat outside its
 * service area — Naperville (a different county), Evanston and Cicero. Alerts
 * fired correctly for geography the business cannot serve, each seeded an
 * opportunity, and one became a campaign scoped to "Chicagoland".
 *
 * Nothing checked, because a point is a lat/lng and a service area is a name.
 */
const CHICAGO_AREAS = ["Lakeview", "Wrigleyville", "Uptown", "Lincoln Park", "Hyde Park", "Rogers Park"];

describe("describeMonitoredPointCoverage", () => {
  it("flags the exact prod misconfiguration", () => {
    const out = describeMonitoredPointCoverage({
      points: [
        { label: "Chicago", city: "Chicago", state: "IL" },
        { label: "Naperville", city: "Naperville", state: "IL" },
        { label: "Evanston", city: "Evanston", state: "IL" },
        { label: "Cicero", city: "Cicero", state: "IL" },
      ],
      serviceAreas: CHICAGO_AREAS,
      homeCity: "Chicago",
    });
    expect(out.unconfirmed).toHaveLength(3);
    expect(out.warning).toContain("Naperville");
    expect(out.warning).toContain("Evanston");
    expect(out.warning).toContain("Cicero");
    // The one good point must not be flagged, or the warning is noise.
    expect(out.warning).not.toMatch(/Chicago \(/);
  });

  it("passes the corrected config, where every point resolves to the home city", () => {
    const out = describeMonitoredPointCoverage({
      points: [
        { label: "Chicago — Loop", city: "Chicago", state: "IL" },
        { label: "Rogers Park — far north", city: "Chicago", state: "IL" },
        { label: "Hyde Park — south lakefront", city: "Chicago", state: "IL" },
      ],
      serviceAreas: CHICAGO_AREAS,
      homeCity: "Chicago",
    });
    expect(out.unconfirmed).toEqual([]);
    expect(out.warning).toBeNull();
  });

  it("accepts a point named in the service areas even when it is not the home city", () => {
    // A business in Chicago that lists Evanston as a service area serves Evanston.
    const out = describeMonitoredPointCoverage({
      points: [{ label: "Evanston", city: "Evanston", state: "IL" }],
      serviceAreas: [...CHICAGO_AREAS, "Evanston"],
      homeCity: "Chicago",
    });
    expect(out.unconfirmed).toEqual([]);
  });

  it("reports rather than judges — the wording asks, it does not condemn", () => {
    // A business may legitimately serve a neighbouring town. This makes the
    // question visible; it does not decide it.
    const out = describeMonitoredPointCoverage({
      points: [{ label: "Naperville", city: "Naperville", state: "IL" }],
      serviceAreas: CHICAGO_AREAS,
      homeCity: "Chicago",
    });
    expect(out.warning).toContain("confirm you serve them");
    expect(out.warning).not.toMatch(/\b(invalid|wrong|error)\b/i);
  });

  it("always shows where each point actually is", () => {
    const out = describeMonitoredPointCoverage({
      points: [{ label: "Chicago", city: "Naperville", state: "IL" }],
      serviceAreas: CHICAGO_AREAS,
      homeCity: "Chicago",
    });
    expect(out.lines).toEqual(["Chicago → Naperville, IL"]);
  });

  it("calls a label that disagrees with the resolved city mislabelled, not merely unconfirmed", () => {
    const out = describeMonitoredPointCoverage({
      points: [{ label: "Chicago", city: "Naperville", state: "IL" }],
      serviceAreas: CHICAGO_AREAS,
      homeCity: "Chicago",
    });
    expect(out.mislabelled).toHaveLength(1);
    expect(out.warning).toContain("Mislabelled");
  });

  it("does not treat a descriptive label as a claim about the city", () => {
    // "north lakefront" is not an assertion that the point is in a city of that
    // name, so it must not be reported as mislabelled.
    const out = describeMonitoredPointCoverage({
      points: [{ label: "north lakefront", city: "Chicago", state: "IL" }],
      serviceAreas: CHICAGO_AREAS,
      homeCity: "Chicago",
    });
    expect(out.mislabelled).toEqual([]);
    expect(out.warning).toBeNull();
  });

  it("says nothing about a point NWS could not resolve, rather than guessing", () => {
    const out = describeMonitoredPointCoverage({
      points: [{ label: "Offshore buoy", city: null, state: null }],
      serviceAreas: CHICAGO_AREAS,
      homeCity: "Chicago",
    });
    expect(out.lines).toEqual(["Offshore buoy → unresolved"]);
    expect(out.unconfirmed).toEqual([]);
    expect(out.warning).toBeNull();
  });

  it("is silent when there is nothing to compare against", () => {
    // No service areas and no home city: every point would flag, which is noise
    // rather than signal. The campaign layer already reports an unset Brand Kit.
    const out = describeMonitoredPointCoverage({
      points: [{ label: "Chicago", city: "Chicago", state: "IL" }],
    });
    expect(out.unconfirmed).toEqual(["Chicago (Chicago, IL)"]);
  });

  it("handles an empty point list", () => {
    expect(describeMonitoredPointCoverage({ points: [] })).toEqual({
      lines: [], unconfirmed: [], mislabelled: [], warning: null,
    });
  });
});

describe("cityFromPostalAddress", () => {
  it("reads the city from the workspace's own address block", () => {
    // BSR's, verbatim from app_settings.
    expect(cityFromPostalAddress("Big Shoulders Restoration\n1770 W. Berteau Ave\nChicago, IL 60613")).toBe("Chicago");
  });

  it("handles a two-word city and a ZIP+4", () => {
    expect(cityFromPostalAddress("12 Main St\nOak Park, IL 60302-1234")).toBe("Oak Park");
  });

  it("returns null rather than guessing when there is no City, ST line", () => {
    expect(cityFromPostalAddress("Just a company name")).toBeNull();
    expect(cityFromPostalAddress("")).toBeNull();
    expect(cityFromPostalAddress(null)).toBeNull();
    expect(cityFromPostalAddress(undefined)).toBeNull();
  });

  it("takes the last matching line, so a street named like a city does not win", () => {
    expect(cityFromPostalAddress("Springfield, IL\n1770 W. Berteau Ave\nChicago, IL 60613")).toBe("Chicago");
  });
});

describe("the corrected BSR config, end to end", () => {
  it("passes once the home city is read from the postal address", () => {
    // Without a home city, a workspace listing NEIGHBOURHOODS flags its own
    // correct points — a warning that cries wolf gets ignored within a week.
    const homeCity = cityFromPostalAddress("Big Shoulders Restoration\n1770 W. Berteau Ave\nChicago, IL 60613");
    const out = describeMonitoredPointCoverage({
      points: [
        { label: "Chicago — Loop", city: "Chicago", state: "IL" },
        { label: "Rogers Park — far north", city: "Chicago", state: "IL" },
        { label: "Hyde Park — south lakefront", city: "Chicago", state: "IL" },
      ],
      serviceAreas: ["Lakeview", "Wrigleyville", "Hyde Park", "Rogers Park"],
      homeCity,
    });
    expect(out.warning).toBeNull();
  });
});
