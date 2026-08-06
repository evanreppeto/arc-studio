import { describe, expect, it } from "vitest";

import { humanizeArcProse, isMachineText, isToolToken } from "../arc-prose";

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

describe("the claims reviewer's prose, from prod", () => {
  // Verbatim shapes from the live campaign card on 2026-08-04. The sanitiser was
  // built for the opportunity inbox and caught NONE of these when it was first
  // pointed at the claims review: a short hex id is neither a UUID nor
  // snake_case, so every existing rule passed it through.
  it("lifts out an id cited in a parenthetical", () => {
    expect(
      humanizeArcProse("The workspace's own campaign learning (8abff0f5) says the advisories ended 2026-08-01."),
    ).toBe("The workspace's own campaign learning says the advisories ended 2026-08-01.");
  });

  it("lifts out an id cited inline, and leaves the sentence standing", () => {
    expect(
      humanizeArcProse("The phone number is a placeholder per learning 8abff0f5 ('pending the real number')."),
    ).toBe("The phone number is a placeholder per learning ('pending the real number').");
  });

  it("takes a run of ids out with the punctuation that separated them", () => {
    // One-at-a-time removal left "asset IDs, and don't appear anywhere" — which
    // parses worse than the sentence did with the ids still in it.
    expect(
      humanizeArcProse("cross-references: asset IDs bc760fde, 06459096, and 90cb3cf2 don't appear anywhere in the brain."),
    ).toBe("cross-references: asset IDs don't appear anywhere in the brain.");
    expect(humanizeArcProse("referencing asset IDs bc760fde or 06459096, or documenting the defect.")).toBe(
      "referencing asset IDs, or documenting the defect.",
    );
  });

  it("will not eat a phone number or a count", () => {
    // The failure that would matter most: this module only ever DELETES, so a
    // long digit run it mistook for an id would silently remove a real figure
    // from a claims review. An id must carry a letter as well as a digit.
    const real = "Call the crew on 7739008407 — the line answered 12345678 times last quarter.";
    expect(humanizeArcProse(real)).toBe(real);
  });

  it("respells a node kind rather than deleting it", () => {
    // "No proof_point nodes exist" must not become "No nodes exist" — the token
    // carries meaning even though its spelling is machine-shaped.
    expect(humanizeArcProse("No proof_point nodes exist and no social_ad slices were found.")).toBe(
      "No proof point nodes exist and no social ad slices were found.",
    );
  });

  it("leaves every real claim, credential and date alone", () => {
    // The failure that would matter far more than a leaked id: a sanitiser that
    // eats the reviewer's actual finding. Dates, hyphenated credentials, bracket
    // placeholders and hyphenated compounds all survive untouched.
    const real =
      "Two things block send: the phone number is still a literal [24/7 line] placeholder, and IICRC-trained Cook County crews are grounded in allowed-claims evidence as of 2026-08-01.";
    expect(humanizeArcProse(real)).toBe(real);
  });

  it("does not eat an eight-letter word spelled from a-f", () => {
    // `deadbeef` is eight hex characters and also a word people write. The digit
    // requirement is what keeps the id rule off English.
    expect(humanizeArcProse("The deadbeef facade accedes.")).toBe("The deadbeef facade accedes.");
  });

  it("cannot remove process narration, which is why the prompt had to change too", () => {
    // Plain English describing Arc's own searching. No token sanitiser can see
    // this — it is the runner's tool contract that stops it, and only for rows
    // written after. Asserted so the limit is recorded rather than assumed.
    const narration = "Searches for 'reply' and 'callback' returned nothing.";
    expect(humanizeArcProse(narration)).toBe(narration);
  });
});
