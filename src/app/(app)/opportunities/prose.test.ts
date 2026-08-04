import { describe, expect, it } from "vitest";

import { humanizeArcProse, isMachineText, isToolToken, rowName, rowQualifier } from "./prose";

describe("isToolToken", () => {
  it("names Arc's own tools by their shape", () => {
    expect(isToolToken("read_recent_activity")).toBe(true);
    expect(isToolToken("query_brain")).toBe(true);
    expect(isToolToken("list_opportunities")).toBe(true);
    expect(isToolToken("mcp__arc__search_companies")).toBe(true);
  });

  it("leaves the workspace's own vocabulary alone", () => {
    expect(isToolToken("campaign_ref")).toBe(false);
    expect(isToolToken("emergency-homeowner")).toBe(false);
    expect(isToolToken("won_revenue_usd")).toBe(false);
    expect(isToolToken("plumbing")).toBe(false);
  });
});

describe("isMachineText", () => {
  it("catches the tool-call strings Arc files under Source", () => {
    // Verbatim from prod opportunity evidence, 2026-08-04.
    expect(isMachineText("read_recent_activity + query_brain(campaign_ref) + list_opportunities")).toBe(true);
    expect(isMachineText("mcp__arc__search_companies (total=10, full roster read)")).toBe(true);
  });

  it("catches bare ids and lists of them", () => {
    expect(isMachineText("062c799e-6359-454d-a6a6-40f330b0f9f0")).toBe(true);
    expect(
      isMachineText("062c799e-6359-454d-a6a6-40f330b0f9f0, dba405db-915e-4288-9abd-716c4e7e2b4b"),
    ).toBe(true);
  });

  it("keeps anything an operator could act on", () => {
    expect(isMachineText("Cook, DuPage, Will — IL")).toBe(false);
    expect(isMachineText("National Weather Service")).toBe(false);
    expect(isMachineText("0")).toBe(false);
    expect(isMachineText("Suburban Home Background Asset")).toBe(false);
  });
});

describe("humanizeArcProse", () => {
  it("lifts the id out of a named campaign without touching the name", () => {
    expect(
      humanizeArcProse('"Suburban Home Background Asset" (campaign 0bd41cb3-ff30-4548-92e6-4ba431b61c8d)'),
    ).toBe('"Suburban Home Background Asset"');
  });

  it("drops an aside written for us rather than the reader", () => {
    expect(
      humanizeArcProse("both tagged persona emergency-homeowner (confirmed via query_brain campaign_ref nodes)"),
    ).toBe("both tagged persona emergency-homeowner");
    expect(humanizeArcProse("read_performance (dimension=persona) returns zero slices")).toBe(
      "returns zero slices",
    );
  });

  it("keeps an aside that carries a fact", () => {
    expect(humanizeArcProse("Open lead (score 67) with no live campaign")).toBe(
      "Open lead (score 67) with no live campaign",
    );
    expect(humanizeArcProse("Flood Advisory (Cook, DuPage, Will)")).toBe("Flood Advisory (Cook, DuPage, Will)");
  });

  it("spells persona keys the way the rest of the app does", () => {
    expect(humanizeArcProse("live lead queries return 0 leads for persona_homeowner_emergency")).toBe(
      "live lead queries return 0 leads for homeowner emergency",
    );
    expect(humanizeArcProse('all 3 won outcomes carry persona="unassigned_persona"')).toBe(
      'all 3 won outcomes carry persona="unassigned"',
    );
  });

  it("never edits the claim itself", () => {
    const summary =
      "$24,800 of won revenue (Ravenswood Rooter $4,800 + Rapid Response Plumbing $12,400) is unattributed.";
    expect(humanizeArcProse(summary)).toBe(summary);
  });

  it("is a no-op on prose the deterministic detectors already write well", () => {
    const clean =
      "Flood Advisory in effect for Cook, IL / DuPage, IL +1 more. Damage-response demand typically spikes in the affected area within days.";
    expect(humanizeArcProse(clean)).toBe(clean);
  });

  it("handles nothing-input", () => {
    expect(humanizeArcProse(null)).toBe("");
    expect(humanizeArcProse("")).toBe("");
  });
});

describe("rowName + rowQualifier", () => {
  it("tells two advisories apart, which the name alone cannot", () => {
    // Both were live in the inbox at once, and both rendered as "Flood Advisory".
    const a = "Flood Advisory — Cook, IL / DuPage, IL +1 more";
    const b = "Flood Advisory — Cook, IL / Will, IL";
    expect(rowName(a)).toBe("Flood Advisory");
    expect(rowName(b)).toBe("Flood Advisory");
    expect(rowQualifier(a)).toBe("Cook, IL / DuPage, IL +1 more");
    expect(rowQualifier(b)).toBe("Cook, IL / Will, IL");
    expect(rowQualifier(a)).not.toBe(rowQualifier(b));
  });

  it("has no qualifier when the title carries no dash", () => {
    expect(rowQualifier("A competitor launched a new comparison campaign")).toBeNull();
  });

  it("does not split on a hyphenated word", () => {
    expect(rowName("Flash-flood warning")).toBe("Flash-flood warning");
    expect(rowQualifier("Flash-flood warning")).toBeNull();
  });

  it("clips a lead too long to scan", () => {
    const name = rowName(
      "Two idle emergency-homeowner background creatives could seed a flood-response package",
    );
    expect(name.length).toBeLessThanOrEqual(46);
    expect(name.endsWith("…")).toBe(true);
  });
});
