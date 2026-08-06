import { describe, expect, it } from "vitest";

import {
  applyConfidenceFloor,
  confidenceFloorForKind,
  DEFAULT_WEATHER_CATEGORIES,
  parseWeatherCategories,
  WEATHER_CATEGORIES,
  weatherCategoryOf,
  dismissCooldownDays,
  DISMISS_COOLDOWN_DAYS,
  DISMISS_COOLDOWN_JITTER_DAYS,
  detectColdLeadOpportunities,
  detectCompetitorOpportunities,
  detectNextIterationOpportunities,
  detectWeatherEventOpportunities,
  type ColdLeadInput,
  type CompetitorSignalInput,
  type NextIterationInput,
  type WeatherEventInput,
} from "../opportunity-detection";

const NOW = "2026-06-17T00:00:00.000Z";
function lead(over: Partial<ColdLeadInput> = {}): ColdLeadInput {
  return {
    id: "lead-1",
    label: "Dana Kasprak",
    persona: "persona_homeowner_emergency",
    leadScore: 70,
    status: "qualified",
    lastActivityAt: "2026-05-01T00:00:00.000Z", // 47 days before NOW
    activityKnown: true,
    hasActiveCampaign: false,
    ...over,
  };
}

describe("detectColdLeadOpportunities", () => {
  it("flags a cold, open lead with no active campaign", () => {
    const out = detectColdLeadOpportunities([lead()], { now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "crm_inactivity", subjectType: "lead", subjectId: "lead-1" });
    expect(out[0].evidence.daysCold).toBe(47);
    expect(out[0].confidence).toBeGreaterThan(0);
  });

  it("skips leads that are recent, converted/lost/archived, or already have a campaign", () => {
    expect(detectColdLeadOpportunities([lead({ lastActivityAt: NOW })], { now: NOW })).toEqual([]);
    expect(detectColdLeadOpportunities([lead({ status: "converted" })], { now: NOW })).toEqual([]);
    expect(detectColdLeadOpportunities([lead({ status: "lost" })], { now: NOW })).toEqual([]);
    expect(detectColdLeadOpportunities([lead({ status: "archived" })], { now: NOW })).toEqual([]);
    expect(detectColdLeadOpportunities([lead({ hasActiveCampaign: true })], { now: NOW })).toEqual([]);
  });

  it("respects a custom cold threshold", () => {
    const recentish = lead({ lastActivityAt: "2026-06-10T00:00:00.000Z" }); // 7 days
    expect(detectColdLeadOpportunities([recentish], { now: NOW })).toEqual([]); // default 30
    expect(detectColdLeadOpportunities([recentish], { now: NOW, coldDays: 5 })).toHaveLength(1);
  });

  it("derives higher urgency for high-value, long-cold leads", () => {
    const hot = detectColdLeadOpportunities([lead({ leadScore: 90, lastActivityAt: "2026-03-01T00:00:00.000Z" })], { now: NOW });
    const mild = detectColdLeadOpportunities([lead({ leadScore: 35 })], { now: NOW });
    expect(hot[0].urgency).toBe("high");
    expect(["low", "medium"]).toContain(mild[0].urgency);
  });
});

function weather(over: Partial<WeatherEventInput> = {}): WeatherEventInput {
  return {
    id: "wx-1",
    eventType: "Flash Flood Warning",
    area: "Riverside / Brookfield",
    severity: "warning",
    startsAt: "2026-06-16T22:00:00.000Z",
    endsAt: "2026-06-18T06:00:00.000Z", // after NOW
    zipCodes: ["60546", "60513"],
    sourceUrls: ["https://www.weather.gov/lot/", "https://water.noaa.gov/"],
    ...over,
  };
}

describe("detectWeatherEventOpportunities", () => {
  it("emits a geo-targeted damage-response opportunity from an active alert", () => {
    const out = detectWeatherEventOpportunities([weather()], { now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "weather_event",
      subjectType: "weather_event",
      subjectId: "wx-1",
      recommendedCampaignType: "storm_response",
    });
    expect(out[0].title).toContain("Flash Flood Warning");
    expect(out[0].recommendedAction).toContain("Riverside / Brookfield");
    // Evidence carries the weather facts for the card.
    expect(out[0].evidence).toMatchObject({
      eventType: "Flash Flood Warning",
      area: "Riverside / Brookfield",
      severity: "warning",
      zipCodes: ["60546", "60513"],
    });
    expect(out[0].evidence.evidence_urls).toEqual(["https://www.weather.gov/lot/", "https://water.noaa.gov/"]);
  });

  // Every workspace shares this detector, so it must not name one of them or assume
  // their customers. It used to say "puts BSR's emergency response in front of
  // homeowners" — wrong company for all but one tenant, wrong customer for any
  // commercial one.
  it("writes tenant-neutral copy — no company name, no assumed customer type", () => {
    const [o] = detectWeatherEventOpportunities([weather()], { now: NOW });
    const copy = `${o.title} ${o.summary} ${o.recommendedAction}`;
    expect(copy).not.toMatch(/BSR|Big Shoulders/i);
    expect(copy).not.toMatch(/homeowner/i);
    expect(o.summary).toContain("property owners");
  });

  it("omits the persona unless the caller supplies one from its own taxonomy", () => {
    expect(detectWeatherEventOpportunities([weather()], { now: NOW })[0].evidence.persona).toBeUndefined();
    expect(
      detectWeatherEventOpportunities([weather()], { now: NOW, persona: "persona_facilities_lead" })[0].evidence.persona,
    ).toBe("persona_facilities_lead");
    // Blank/whitespace is not an audience.
    for (const p of ["", "   ", null]) {
      expect(detectWeatherEventOpportunities([weather()], { now: NOW, persona: p })[0].evidence.persona).toBeUndefined();
    }
  });

  // The bug this filter exists for: two live Air Quality Alerts over Chicago would
  // have been filed as damage opportunities asserting that response demand spikes.
  it("skips real alerts that put no property in play", () => {
    for (const eventType of ["Air Quality Alert", "Heat Advisory", "Excessive Heat Warning", "Dense Fog Advisory", "Rip Current Statement", "Beach Hazards Statement", "Air Stagnation Advisory"]) {
      expect(detectWeatherEventOpportunities([weather({ id: "x", eventType })], { now: NOW })).toEqual([]);
    }
  });

  it("keeps property-damaging weather across every vertical this connector serves", () => {
    const damaging = [
      "Tornado Warning", "Severe Thunderstorm Warning", "Flash Flood Warning", "High Wind Warning",
      "Winter Storm Warning", "Ice Storm Warning", "Blizzard Warning", "Hurricane Warning",
      "Tropical Storm Warning", "Storm Surge Warning", "Snow Squall Warning", "Freezing Rain Advisory",
      // freeze -> burst pipes (plumbing/restoration); fire -> fire damage. Red Flag is
      // NWS's fire-weather product and contains the word "fire" nowhere.
      "Hard Freeze Warning", "Freeze Warning", "Extreme Cold Warning", "Fire Weather Watch", "Red Flag Warning",
    ];
    for (const eventType of damaging) {
      expect(detectWeatherEventOpportunities([weather({ id: "x", eventType })], { now: NOW })).toHaveLength(1);
    }
  });

  it("maps severity to urgency + confidence (advisory→low … emergency→high)", () => {
    const sev = (s: WeatherEventInput["severity"]) => detectWeatherEventOpportunities([weather({ severity: s })], { now: NOW })[0];
    expect(sev("advisory").urgency).toBe("low");
    expect(sev("watch").urgency).toBe("medium");
    expect(sev("warning").urgency).toBe("high");
    expect(sev("emergency").urgency).toBe("high");
    expect(sev("emergency").confidence).toBeGreaterThan(sev("advisory").confidence);
  });

  it("skips alerts whose effective window has already expired", () => {
    const expired = weather({ endsAt: "2026-06-16T00:00:00.000Z" }); // before NOW
    expect(detectWeatherEventOpportunities([expired], { now: NOW })).toEqual([]);
  });

  it("falls back gracefully on unknown severity + missing area", () => {
    const out = detectWeatherEventOpportunities(
      [weather({ severity: "hurricane" as never, area: "", zipCodes: [] })],
      { now: NOW },
    );
    expect(out).toHaveLength(1);
    expect(out[0].urgency).toBe("low"); // unknown → advisory
    expect(out[0].title).toContain("the coverage area");
  });
});

function competitor(over: Partial<CompetitorSignalInput> = {}): CompetitorSignalInput {
  return {
    id: "cc-1",
    competitorName: "ServPro",
    channel: "meta_ad_library",
    status: "confirmed",
    keywords: ["water damage oak park", "flood cleanup", "emergency restoration"],
    creativeCount: 6,
    persona: "persona_homeowner_emergency",
    capturedAt: "2026-06-15T00:00:00.000Z", // 2 days before NOW
    url: "https://www.facebook.com/ads/library/",
    ...over,
  };
}

describe("detectCompetitorOpportunities", () => {
  it("emits a defensive-flight opportunity from an active competitor flight", () => {
    const out = detectCompetitorOpportunities([competitor()], { now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "competitor_signal",
      subjectType: "competitor_signal",
      subjectId: "cc-1",
      urgency: "high", // confirmed + high activity
      recommendedCampaignType: "competitive_defense",
    });
    expect(out[0].title).toContain("ServPro");
    expect(out[0].evidence).toMatchObject({
      competitor: "ServPro",
      channel: "Meta",
      activityLevel: "high",
      creativeCount: 6,
      persona: "persona_homeowner_emergency",
    });
    expect(out[0].evidence.evidence_urls).toEqual(["https://www.facebook.com/ads/library/"]);
    expect(out[0].recommendedAction).toContain("ServPro");
  });

  it("skips archived intel and stale captures", () => {
    expect(detectCompetitorOpportunities([competitor({ status: "archived" })], { now: NOW })).toEqual([]);
    const stale = competitor({ capturedAt: "2026-01-01T00:00:00.000Z" }); // ~167 days old
    expect(detectCompetitorOpportunities([stale], { now: NOW })).toEqual([]);
    // But a generous freshDays window keeps it.
    expect(detectCompetitorOpportunities([stale], { now: NOW, freshDays: 365 })).toHaveLength(1);
  });

  it("softens urgency + confidence for unconfirmed, low-activity intel", () => {
    const soft = detectCompetitorOpportunities(
      [competitor({ status: "needs_review", creativeCount: 1 })],
      { now: NOW },
    )[0];
    const hard = detectCompetitorOpportunities([competitor()], { now: NOW })[0];
    expect(soft.urgency).toBe("low");
    expect(soft.confidence).toBeLessThan(hard.confidence);
    expect(soft.evidence.activityLevel).toBe("low");
  });
});

describe("detectNextIterationOpportunities", () => {
  function input(overrides: Partial<NextIterationInput> = {}): NextIterationInput {
    return {
      campaignId: "camp-1",
      campaignName: "Spring Storm Prep",
      persona: "persona_homeowner_emergency",
      topChannel: "Email",
      bookedJobs: 6,
      leads: 45,
      topAsset: "Storm-watch SMS nudge",
      recommendation: "For the next iteration, lead with Email.",
      arcPrompt: "Draft the next iteration of the Spring Storm Prep campaign. Keep it approval-gated.",
      ...overrides,
    };
  }

  it("turns a proven winner into a high-urgency draft-round-two opportunity", () => {
    const [opp] = detectNextIterationOpportunities([input()]);
    expect(opp).toMatchObject({
      kind: "next_iteration",
      subjectType: "campaign",
      subjectId: "camp-1",
      urgency: "high",
      recommendedCampaignType: "next_iteration",
    });
    expect(opp.title).toMatch(/converting/i);
    expect(opp.summary).toContain("Email booked 6 jobs from 45 leads");
    expect(opp.evidence).toMatchObject({ topChannel: "Email", bookedJobs: 6, leads: 45, topAsset: "Storm-watch SMS nudge" });
    expect(opp.evidence.arcPrompt).toContain("approval-gated");
    expect(opp.confidence).toBeGreaterThan(80);
  });

  it("is lower urgency + confidence for interest-only (leads but no bookings)", () => {
    const [opp] = detectNextIterationOpportunities([input({ bookedJobs: 0, leads: 12, topAsset: undefined })]);
    expect(opp.urgency).toBe("low");
    expect(opp.title).toMatch(/interest/i);
    expect(opp.summary).toContain("Email drew 12 leads");
    const proven = detectNextIterationOpportunities([input()])[0];
    expect(opp.confidence).toBeLessThan(proven.confidence);
  });

  it("scores mid-tier urgency for a small win", () => {
    const [opp] = detectNextIterationOpportunities([input({ bookedJobs: 2, leads: 10 })]);
    expect(opp.urgency).toBe("medium");
  });

  it("skips campaigns with no delivered signal and rows missing an id", () => {
    expect(detectNextIterationOpportunities([input({ bookedJobs: 0, leads: 0 })])).toEqual([]);
    expect(detectNextIterationOpportunities([input({ campaignId: "" })])).toEqual([]);
  });
});

describe("applyConfidenceFloor", () => {
  const c = (confidence: number, kind = "weather_event") => ({ confidence, kind });

  it("keeps candidates at or above the floor and drops the rest", () => {
    const kept = applyConfidenceFloor([c(49), c(50), c(51)]);
    // Boundary is inclusive: a candidate scoring exactly the floor cleared it.
    expect(kept.map((k) => k.confidence)).toEqual([50, 51]);
  });

  it("holds the flood-prone crm_inactivity kind to a higher bar than the baseline", () => {
    const mixed = [c(55, "crm_inactivity"), c(60, "crm_inactivity"), c(55, "weather_event")];
    const kept = applyConfidenceFloor(mixed);
    expect(kept).toEqual([c(60, "crm_inactivity"), c(55, "weather_event")]);
  });

  it("treats a non-finite or non-positive base as no floor rather than guessing", () => {
    expect(applyConfidenceFloor([c(1), c(99)], Number.NaN)).toHaveLength(2);
    expect(applyConfidenceFloor([c(1), c(99)], 0)).toHaveLength(2);
  });

  it("lets a raised base lift every kind, including ones with their own floor", () => {
    // A per-kind entry must never undercut an operator who raises the base.
    expect(confidenceFloorForKind("crm_inactivity", 80)).toBe(80);
    expect(confidenceFloorForKind("weather_event", 80)).toBe(80);
  });

  it("filters by quality, never by volume", () => {
    // A floor must never behave like a cap: 200 strong signals all survive.
    const many = Array.from({ length: 200 }, () => c(90, "crm_inactivity"));
    expect(applyConfidenceFloor(many)).toHaveLength(200);
  });

  // The regression this shape exists to prevent: a flat 60 floor deleted every
  // weather ADVISORY (they score exactly 55) — and Freezing Rain / Hard Freeze
  // advisories burst pipes, which is real restoration work.
  it("does not silently delete a whole severity tier of a selective detector", () => {
    for (const severity of ["advisory", "watch", "warning", "emergency"] as const) {
      const out = detectWeatherEventOpportunities([weather({ severity })], { now: NOW });
      expect(applyConfidenceFloor(out), `weather ${severity} was filtered out`).toHaveLength(1);
    }
  });

  it("does not reject the cold-lead detector's own high-urgency output", () => {
    // Guards the floor against drifting above what real detectors emit.
    const candidates = detectColdLeadOpportunities(
      [lead({ leadScore: 95, lastActivityAt: "2026-01-01T00:00:00.000Z" })],
      { now: NOW },
    );
    expect(candidates).toHaveLength(1);
    expect(applyConfidenceFloor(candidates)).toHaveLength(1);
  });
});

describe("dismissCooldownDays", () => {
  const KIND = "crm_inactivity";
  const LO = DISMISS_COOLDOWN_DAYS - DISMISS_COOLDOWN_JITTER_DAYS;
  const HI = DISMISS_COOLDOWN_DAYS + DISMISS_COOLDOWN_JITTER_DAYS;

  it("is deterministic — the same subject always resolves to the same expiry", () => {
    // If this drifted, a card's return date would wander between scans and a row
    // could re-appear early just by being re-evaluated.
    const first = dismissCooldownDays(KIND, "lead-abc");
    for (let i = 0; i < 50; i += 1) expect(dismissCooldownDays(KIND, "lead-abc")).toBe(first);
  });

  it("stays inside the base +/- jitter window", () => {
    for (let i = 0; i < 500; i += 1) {
      const d = dismissCooldownDays(KIND, `lead-${i}`);
      expect(d).toBeGreaterThanOrEqual(LO);
      expect(d).toBeLessThanOrEqual(HI);
    }
  });

  // The whole point: 39 cards cleared in one sitting must not all come back on
  // the same day, which is exactly what a fixed cooldown produced.
  it("spreads a batch dismissed together across the window", () => {
    const days = Array.from({ length: 39 }, (_, i) => dismissCooldownDays(KIND, `batch-lead-${i}`));
    const distinct = new Set(days);
    // A 15-day window over 39 subjects should occupy most of it, and certainly
    // must not collapse onto one date.
    expect(distinct.size).toBeGreaterThan(10);
    const perDay = Math.max(...[...distinct].map((d) => days.filter((x) => x === d).length));
    expect(perDay).toBeLessThan(days.length / 2);
  });

  it("separates the same subject id across different kinds", () => {
    // Kind is in the hash key, so one subject carrying two kinds of signal does
    // not resurface both at once.
    const a = Array.from({ length: 40 }, (_, i) => dismissCooldownDays("crm_inactivity", `s${i}`));
    const b = Array.from({ length: 40 }, (_, i) => dismissCooldownDays("account_expansion", `s${i}`));
    expect(a).not.toEqual(b);
  });

  it("averages out to roughly the base, so jitter shifts timing not policy", () => {
    const days = Array.from({ length: 2000 }, (_, i) => dismissCooldownDays(KIND, `lead-${i}`));
    const mean = days.reduce((s, d) => s + d, 0) / days.length;
    expect(Math.abs(mean - DISMISS_COOLDOWN_DAYS)).toBeLessThan(1);
  });

  it("never yields a non-positive cooldown, even if jitter would swamp the base", () => {
    // A zero/negative cooldown makes a dismissal instantly re-raisable — the very
    // bug the cooldown exists to prevent.
    for (let i = 0; i < 200; i += 1) {
      expect(dismissCooldownDays(KIND, `lead-${i}`, 2, 30)).toBeGreaterThanOrEqual(1);
    }
  });

  it("collapses to the base when jitter is disabled", () => {
    expect(dismissCooldownDays(KIND, "lead-abc", 30, 0)).toBe(30);
  });
});

describe("weatherCategoryOf", () => {
  it("classifies each category from real NWS product names", () => {
    expect(weatherCategoryOf("Severe Thunderstorm Warning")).toBe("property_damage");
    expect(weatherCategoryOf("Hard Freeze Warning")).toBe("property_damage");
    // BSR-551: fire weather is its own category now. This line used to assert
    // property_damage, which is exactly the bug — it gave a fire FORECAST the
    // damage-response claim ("affected property owners") before anything burned.
    expect(weatherCategoryOf("Red Flag Warning")).toBe("fire_weather");
    expect(weatherCategoryOf("Excessive Heat Warning")).toBe("extreme_heat");
    expect(weatherCategoryOf("Heat Advisory")).toBe("extreme_heat");
    expect(weatherCategoryOf("Air Quality Alert")).toBe("air_quality");
    expect(weatherCategoryOf("Air Stagnation Advisory")).toBe("air_quality");
    expect(weatherCategoryOf("Beach Hazards Statement")).toBe("marine_coastal");
    expect(weatherCategoryOf("Rip Current Statement")).toBe("marine_coastal");
  });

  // The property-damage regex is broad enough to swallow other categories, so it
  // must be tested LAST. "Coastal Flood Warning" contains "flood" and "Lakeshore
  // Flood Advisory" contains both — a damage-only workspace must not get them.
  it("prefers the specific category when the damage regex would also match", () => {
    expect(weatherCategoryOf("Coastal Flood Warning")).toBe("marine_coastal");
    expect(weatherCategoryOf("Lakeshore Flood Advisory")).toBe("marine_coastal");
    expect(weatherCategoryOf("High Surf Advisory")).toBe("marine_coastal");
  });

  it("returns null for alerts that drive no demand this connector models", () => {
    expect(weatherCategoryOf("Dense Fog Advisory")).toBeNull();
    expect(weatherCategoryOf("")).toBeNull();
    expect(weatherCategoryOf(null)).toBeNull();
  });
});

describe("parseWeatherCategories", () => {
  it("falls back to the default categories when unset, empty, or unparseable", () => {
    // fire_weather joined the defaults in BSR-551 so that splitting it out of
    // property_damage did not silently remove coverage workspaces already had.
    for (const raw of [undefined, null, [], "storms", [""], ["nonsense"], 42]) {
      expect(parseWeatherCategories(raw)).toEqual(["property_damage", "fire_weather"]);
    }
  });

  it("keeps valid categories, drops junk, and dedups", () => {
    expect(parseWeatherCategories(["extreme_heat", "nope", "extreme_heat", "air_quality"]))
      .toEqual(["extreme_heat", "air_quality"]);
  });
});

describe("detectWeatherEventOpportunities — per-workspace categories", () => {
  const at = (eventType: string) =>
    weather({ id: `id-${eventType}`, eventType, severity: "warning" });

  // The whole point of the default: an existing workspace that never opts in sees
  // exactly what it saw before.
  it("defaults to property damage only, unchanged from before categories existed", () => {
    expect(detectWeatherEventOpportunities([at("Severe Thunderstorm Warning")], { now: NOW })).toHaveLength(1);
    expect(detectWeatherEventOpportunities([at("Excessive Heat Warning")], { now: NOW })).toEqual([]);
    expect(detectWeatherEventOpportunities([at("Air Quality Alert")], { now: NOW })).toEqual([]);
    expect(detectWeatherEventOpportunities([at("Beach Hazards Statement")], { now: NOW })).toEqual([]);
  });

  it("surfaces a category once the workspace opts into it", () => {
    const out = detectWeatherEventOpportunities([at("Excessive Heat Warning")], {
      now: NOW,
      categories: ["extreme_heat"],
    });
    expect(out).toHaveLength(1);
    expect(out[0].evidence.category).toBe("extreme_heat");
  });

  it("opting into heat does not also admit damage", () => {
    const out = detectWeatherEventOpportunities(
      [at("Severe Thunderstorm Warning"), at("Excessive Heat Warning")],
      { now: NOW, categories: ["extreme_heat"] },
    );
    expect(out.map((o) => o.evidence.eventType)).toEqual(["Excessive Heat Warning"]);
  });

  // The reason categories needed their own copy at all: the single summary
  // asserted damage-response demand, so admitting heat under it would have
  // produced a card claiming a heatwave damaged buildings — a false claim wrapped
  // in genuine NWS evidence.
  it("never claims damage for weather that damages nothing", () => {
    for (const [eventType, category] of [
      ["Excessive Heat Warning", "extreme_heat"],
      ["Air Quality Alert", "air_quality"],
      ["Beach Hazards Statement", "marine_coastal"],
    ] as const) {
      const [o] = detectWeatherEventOpportunities([at(eventType)], { now: NOW, categories: [category] });
      const copy = `${o.summary} ${o.recommendedAction}`;
      expect(copy, `${eventType} claimed damage`).not.toMatch(/damage/i);
      expect(o.recommendedCampaignType).not.toBe("storm_response");
    }
    // The damage category still says so — the claim isn't lost, just scoped.
    const [dmg] = detectWeatherEventOpportunities([at("Severe Thunderstorm Warning")], { now: NOW });
    expect(`${dmg.summary} ${dmg.recommendedAction}`).toMatch(/damage/i);
    expect(dmg.recommendedCampaignType).toBe("storm_response");
  });

  it("stays tenant-neutral in every category — no trade named", () => {
    for (const c of WEATHER_CATEGORIES) {
      const events = [at("Severe Thunderstorm Warning"), at("Excessive Heat Warning"), at("Air Quality Alert"), at("Beach Hazards Statement")];
      for (const o of detectWeatherEventOpportunities(events, { now: NOW, categories: [c] })) {
        expect(`${o.summary} ${o.recommendedAction}`).not.toMatch(/HVAC|roofer|plumber|BSR|Big Shoulders/i);
      }
    }
  });
});

/**
 * BSR-551. `Red Flag Warning` was always surfaced — the property-damage regex
 * matches `red flag` explicitly — but it landed in `property_damage`, whose copy
 * claims "damage-response demand" among "affected property owners". A Red Flag
 * Warning forecasts fire RISK: nothing has burned and there are no affected
 * owners yet. Same class as the Air Quality bug: a real NWS alert wearing a
 * false claim.
 */
describe("fire weather is its own category (BSR-551)", () => {
  it("routes Red Flag Warning to fire_weather, not property_damage", () => {
    // The product name contains no "fire" at all — this is why the classifier
    // keys on the product, not the word.
    expect(weatherCategoryOf("Red Flag Warning")).toBe("fire_weather");
  });

  it("routes Fire Weather Watch to fire_weather", () => {
    expect(weatherCategoryOf("Fire Weather Watch")).toBe("fire_weather");
  });

  it("still classifies real damage weather as property_damage", () => {
    expect(weatherCategoryOf("Tornado Warning")).toBe("property_damage");
    expect(weatherCategoryOf("Ice Storm Warning")).toBe("property_damage");
  });

  it("does not let fire steal the more specific categories", () => {
    // Ordering guard: heat/air/marine are tested before fire.
    expect(weatherCategoryOf("Excessive Heat Warning")).toBe("extreme_heat");
    expect(weatherCategoryOf("Air Quality Alert")).toBe("air_quality");
    expect(weatherCategoryOf("Coastal Flood Warning")).toBe("marine_coastal");
  });

  it("ships ON by default so existing coverage is not silently removed", () => {
    // Fire alerts already reached every workspace via property_damage. Shipping
    // the new category off-by-default would look like an improvement while
    // quietly taking coverage away.
    expect(DEFAULT_WEATHER_CATEGORIES).toContain("fire_weather");
    expect(DEFAULT_WEATHER_CATEGORIES).toContain("property_damage");
  });

  it("is opt-out-able like any other category", () => {
    expect(parseWeatherCategories(["property_damage"])).toEqual(["property_damage"]);
  });
});

/**
 * The cold-lead title and summary are written to the opportunity row, so a
 * count disagreeing with its noun is stored — shown on the card, and read back
 * by Arc when it reasons about the record (BSR-690).
 *
 * `coldDays: 1` is not contrived. The 30-day default only binds
 * `crm_inactivity`; prod carries daysCold on four opportunity kinds, three of
 * which sit below 30 today (10, 12, 13) and never pass through this floor.
 */
describe("cold-lead copy agrees in number", () => {
  const dayBefore = "2026-06-16T00:00:00.000Z"; // exactly 1 day before NOW

  it("says '1 day', never '1 days', when activity is known", () => {
    const [out] = detectColdLeadOpportunities(
      [lead({ lastActivityAt: dayBefore, activityKnown: true })],
      { now: NOW, coldDays: 1 },
    );
    expect(out.evidence.daysCold).toBe(1);
    expect(out.title).toContain("quiet 1 day");
    expect(out.title).not.toContain("1 days");
    expect(out.summary).toContain("no activity in 1 day.");
    expect(out.summary).not.toContain("1 days");
  });

  it("says '1 day', never '1 days', when nothing has been recorded", () => {
    const [out] = detectColdLeadOpportunities(
      [lead({ lastActivityAt: dayBefore, activityKnown: false })],
      { now: NOW, coldDays: 1 },
    );
    expect(out.title).toContain("nothing recorded in 1 day");
    expect(out.title).not.toContain("1 days");
    expect(out.summary).toContain("since it arrived 1 day ago");
    expect(out.summary).not.toContain("1 days");
  });

  it("keeps the plural everywhere above one", () => {
    const [out] = detectColdLeadOpportunities([lead()], { now: NOW });
    expect(out.title).toContain("quiet 47 days");
    expect(out.summary).toContain("no activity in 47 days.");
  });
});
