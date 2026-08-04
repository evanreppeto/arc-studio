import { describe, expect, it } from "vitest";

import { buildCampaignSeedFromOpportunity, inferRestorationFocus, describeServiceAreaScope } from "../campaign-from-opportunity";

describe("inferRestorationFocus", () => {
  it("maps focus keywords to enum values (specific beats generic)", () => {
    expect(inferRestorationFocus("Flash-flood warning — basements at risk")).toBe("flood");
    expect(inferRestorationFocus("burst pipe overnight")).toBe("burst_pipe");
    expect(inferRestorationFocus("three water-backup jobs referred")).toBe("water_backup");
    expect(inferRestorationFocus("storm surge along the shoreline")).toBe("storm_surge");
    expect(inferRestorationFocus("hail damage across the roof")).toBe("storm_surge");
    expect(inferRestorationFocus("sewage backup in the unit")).toBe("sewage");
    expect(inferRestorationFocus("mold remediation quote")).toBe("mold");
    expect(inferRestorationFocus("fire and smoke damage")).toBe("fire");
    expect(inferRestorationFocus("standing water in the crawlspace")).toBe("standing_water");
  });

  it("falls back to water_backup for generic water damage copy", () => {
    expect(inferRestorationFocus("comparing water-damage estimates")).toBe("water_backup");
  });

  it("returns '' when nothing matches", () => {
    expect(inferRestorationFocus("annual portfolio inspection package")).toBe("");
    expect(inferRestorationFocus("")).toBe("");
  });
});

describe("buildCampaignSeedFromOpportunity", () => {
  it("carries persona, infers focus, and keeps the recommended action as the angle", () => {
    const seed = buildCampaignSeedFromOpportunity({
      title: "Oak Park homeowner comparing water-damage estimates",
      summary: "Visited the water-damage service page three times and asked for a second quote.",
      recommendedAction: "Fast-track a same-day estimate with proof-of-work photos",
      urgency: "high",
      persona: "persona_homeowner_emergency",
      recommendedCampaignType: null,
    });

    expect(seed.persona).toBe("persona_homeowner_emergency");
    expect(seed.restorationFocus).toBe("water_backup");
    expect(seed.campaignTheme).toBe("Water backup");
    expect(seed.angle).toBe("Fast-track a same-day estimate with proof-of-work photos");
    expect(seed.name).toBe("Oak Park homeowner comparing water-damage estimates");
    expect(seed.campaignType).toBe("Rapid response");
    expect(seed.audienceSummary).toContain("Homeowner emergency");
  });

  it("blanks persona/focus when the opportunity has no confident value, so the operator must choose", () => {
    const seed = buildCampaignSeedFromOpportunity({
      title: "Lakeview portfolio due for annual moisture inspection",
      summary: "Approaching the anniversary of last year's survey.",
      recommendedAction: "Offer an annual portfolio moisture-inspection package",
      urgency: "medium",
      persona: "unassigned_persona",
      recommendedCampaignType: null,
    });

    expect(seed.persona).toBe("");
    expect(seed.restorationFocus).toBe("");
    expect(seed.campaignTheme).toBe("Targeted outreach");
    expect(seed.campaignType).toBe("Targeted outreach");
    expect(seed.audienceSummary).toContain("opportunity signal");
  });

  it("prefers the detector's recommended campaign type when present", () => {
    const seed = buildCampaignSeedFromOpportunity({
      title: "Harbor Point HOA has gone quiet",
      summary: "No contact since basement mitigation wrapped.",
      recommendedAction: "Re-engage with a preventative maintenance nurture",
      urgency: "low",
      persona: "persona_hoa_board",
      recommendedCampaignType: "reactivation_nurture",
    });

    expect(seed.campaignType).toBe("Reactivation nurture");
    expect(seed.campaignTheme).toBe("Reactivation nurture");
    expect(seed.persona).toBe("persona_hoa_board");
  });

  it("truncates an overlong title into an editable name", () => {
    const longTitle = `${"A".repeat(120)} tail`;
    const seed = buildCampaignSeedFromOpportunity({
      title: longTitle,
      summary: "",
      recommendedAction: "Do something",
      urgency: "low",
      persona: "persona_landlord",
    });
    expect(seed.name.length).toBeLessThanOrEqual(96);
    expect(seed.name.endsWith("…")).toBe(true);
  });
});

describe("campaign naming", () => {
  function nameFor(title: string, recommendedCampaignType = "") {
    return buildCampaignSeedFromOpportunity(
      { title, summary: "", recommendedAction: "", urgency: "medium", persona: null, recommendedCampaignType },
      ["persona_landlord"],
    ).name;
  }

  it("reads <theme> — <subject> instead of restating the opportunity headline", () => {
    // Real prod titles. As campaign names the trigger ("quiet 53 days") is noise;
    // the subject is the company.
    expect(nameFor("Dana Whitfield (Southside Water & Gas) — quiet 53 days", "re_engagement")).toBe(
      "Re-engagement — Southside Water & Gas",
    );
    expect(nameFor("Ravenswood Rooter — partner referral opportunity", "referral_outreach")).toBe(
      "Referral outreach — Ravenswood Rooter",
    );
  });

  it("takes the head before the dash when there is no parenthetical", () => {
    expect(
      nameFor("North Shore Property Group — 14-building PM account, only deal was lost", "account_reengagement"),
    ).toBe("Account reengagement — North Shore Property Group");
  });

  it("hyphenates a prefix rather than emitting \"Re engagement\"", () => {
    expect(nameFor("Acme Co — dormant", "re_engagement")).toContain("Re-engagement");
  });

  it("leaves an in-word hyphen alone when splitting", () => {
    // "Insurance-agent" must not be split at its hyphen — only a *spaced* dash
    // separates subject from rationale.
    expect(nameFor("Insurance-agent lane — empty", "partner_recruitment")).toBe(
      "Partner recruitment — Insurance-agent lane",
    );
  });

  it("ignores a parenthetical that is a date rather than a name", () => {
    // Real regression: "(Jun 14)" produced "Storm rapid response — Jun 14".
    expect(
      nameFor("Naperville hail swath (Jun 14) — 142 homes, storm-response window still open", "storm_rapid_response"),
    ).toBe("Storm rapid response — Naperville hail swath");
  });

  it("falls back to the title when no subject can be pulled out confidently", () => {
    // No parenthetical, no dash: a confidently wrong name is worse than a long one.
    const title = "Won-customer base has no reactivation motion";
    expect(nameFor(title, "reactivation")).toBe(title);
  });

  it("does not use an over-long head as a subject", () => {
    const title = `${"x".repeat(60)} — short reason`;
    expect(nameFor(title, "re_engagement")).toBe(title);
  });

  it("caps the name and marks the truncation", () => {
    const name = nameFor(`Acme (${"y".repeat(40)}) — reason`, "re_engagement");
    expect(name.length).toBeLessThanOrEqual(96);
  });
});

/**
 * BSR-756. A flood campaign on prod was scoped to "Chicagoland" off an advisory
 * covering Cook, DuPage and Will, while all 18 of the workspace's service areas
 * are City of Chicago neighbourhoods — a geo-targeted spend would have bought
 * impressions in two counties the business does not serve. Nothing on the create
 * path read `business_profiles.service_areas`.
 */
describe("describeServiceAreaScope", () => {
  const AREAS = ["Lakeview", "Wrigleyville", "Uptown", "Lincoln Park", "Logan Square", "Wicker Park", "Bucktown"];

  it("names what we serve and what the signal covered, without claiming an overlap", () => {
    const out = describeServiceAreaScope({ signalArea: "Cook, IL / DuPage, IL +1 more", serviceAreas: AREAS });
    expect(out).toContain("Targeting our service areas only");
    expect(out).toContain("Lakeview");
    expect(out).toContain("The signal covered Cook, IL / DuPage, IL +1 more");
    expect(out).toContain("excluded");
  });

  it("never asserts that a service area sits inside the signal's geography", () => {
    // NWS publishes by county; a workspace names its own patch. There is no
    // containment data relating them, so any computed intersection would be
    // invented — which is the failure this exists to stop.
    const out = describeServiceAreaScope({ signalArea: "Cook, IL", serviceAreas: ["Lakeview"] });
    expect(out).not.toMatch(/within|inside|part of|contained/i);
  });

  it("collapses a long list rather than printing all of it", () => {
    const many = [...AREAS, "West Loop", "River North", "South Loop", "Hyde Park"];
    const out = describeServiceAreaScope({ signalArea: null, serviceAreas: many });
    expect(out).toContain("+5 more");
    expect(out).not.toContain("Hyde Park");
  });

  it("says the scope is unverified when no service area is set", () => {
    // Silence is how the original bug read as fine.
    const out = describeServiceAreaScope({ signalArea: "Cook, IL", serviceAreas: [] });
    expect(out).toContain("not set on the Brand Kit");
    expect(out).toContain("unverified");
    expect(out).toContain("Cook, IL");
  });

  it("still flags an unset service area when there is no signal geography", () => {
    expect(describeServiceAreaScope({ serviceAreas: null })).toContain("unverified");
  });

  it("omits the signal clause when the opportunity carries no geography", () => {
    const out = describeServiceAreaScope({ signalArea: "  ", serviceAreas: AREAS });
    expect(out).toContain("Targeting our service areas only");
    expect(out).not.toContain("The signal covered");
  });

  it("ignores blank entries rather than printing empty names", () => {
    const out = describeServiceAreaScope({ serviceAreas: ["Lakeview", "  ", ""] });
    expect(out).toBe("Targeting our service areas only: Lakeview.");
  });
});

describe("buildCampaignSeedFromOpportunity service-area scoping", () => {
  const base = {
    title: "Flood Advisory — Cook, IL",
    summary: "Flood advisory across the metro",
    recommendedAction: "Launch a geo-targeted damage-response campaign for Cook, IL / DuPage, IL +1 more",
    urgency: "medium" as const,
    persona: "persona_homeowner_emergency",
  };

  it("scopes the audience summary to the workspace's service areas", () => {
    const seed = buildCampaignSeedFromOpportunity({
      ...base,
      signalArea: "Cook, IL / DuPage, IL +1 more",
      serviceAreas: ["Lakeview", "Hyde Park"],
    });
    expect(seed.audienceSummary).toContain("Targeting our service areas only: Lakeview, Hyde Park");
    expect(seed.audienceSummary).toContain("excluded");
  });

  it("keeps the persona half of the summary alongside the geography", () => {
    const seed = buildCampaignSeedFromOpportunity({ ...base, serviceAreas: ["Lakeview"] });
    expect(seed.audienceSummary).toMatch(/matched by Arc from this opportunity signal/);
    expect(seed.audienceSummary).toContain("Targeting our service areas only");
  });

  it("says so when the workspace has no service area set", () => {
    const seed = buildCampaignSeedFromOpportunity({ ...base, signalArea: "Cook, IL" });
    expect(seed.audienceSummary).toContain("unverified");
  });

  it("leaves the angle carrying the signal's own wording", () => {
    // The recommended action is provenance — it records what the detector said,
    // and must not be rewritten to match the decision.
    const seed = buildCampaignSeedFromOpportunity({ ...base, serviceAreas: ["Lakeview"] });
    expect(seed.angle).toBe(base.recommendedAction);
  });
});
