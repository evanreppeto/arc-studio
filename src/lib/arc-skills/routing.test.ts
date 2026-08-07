import { describe, expect, it } from "vitest";

import { ARC_SKILL_IDS } from "./catalog";
import { inferArcSkill, scoreArcSkills } from "./routing";

describe("Arc skill routing", () => {
  it("routes plain-language drafting, discovery, and research turns", () => {
    expect(inferArcSkill({ body: "Draft a campaign for the storm damage leads" })?.id).toBe(
      ARC_SKILL_IDS.campaignPackageDrafting,
    );
    expect(inferArcSkill({ body: "Find me new leads worth pursuing this week" })?.id).toBe(
      ARC_SKILL_IDS.opportunityDiscovery,
    );
    expect(inferArcSkill({ body: "Research Acme Restoration and tell me about their market" })?.id).toBe(
      ARC_SKILL_IDS.companyResearch,
    );
    expect(inferArcSkill({ body: "Help me create a skill for weekly recaps" })?.id).toBe(
      ARC_SKILL_IDS.skillAuthoring,
    );
  });

  it("separates single-asset creative work from campaign packages", () => {
    // Both are "drafting", but they need different craft: one is an image job,
    // the other is multi-channel copy.
    expect(inferArcSkill({ body: "make me an image of a service van in a driveway" })?.id).toBe(
      ARC_SKILL_IDS.approvalGatedDrafting,
    );
    expect(inferArcSkill({ body: "can you add our logo to the side of the van" })?.id).toBe(
      ARC_SKILL_IDS.approvalGatedDrafting,
    );
    expect(inferArcSkill({ body: "Draft the full campaign package with SMS and landing page copy" })?.id).toBe(
      ARC_SKILL_IDS.campaignPackageDrafting,
    );
  });

  it("tolerates modifiers between a verb and its object", () => {
    // Regression for the corpus's clearest marketing message, which exact
    // phrase matching missed on the single word "short".
    const decision = inferArcSkill({ body: "Draft a short email campaign to past customers about a winter check" });
    expect(decision?.id).toBe(ARC_SKILL_IDS.campaignPackageDrafting);
  });

  it("does not match a verb and object separated by an unrelated clause", () => {
    const scores = scoreArcSkills({
      body: "draft something later but for now just tell me how many contacts have a photo",
    });
    const creative = scores.find((entry) => entry.id === ARC_SKILL_IDS.approvalGatedDrafting)!;
    // "draft" … "photo" are 11 words apart — beyond the proximity window.
    expect(creative.score).toBeLessThan(3);
  });

  it("abstains rather than guessing", () => {
    // Nothing to go on.
    expect(inferArcSkill({ body: "hey" })).toBeNull();
    expect(inferArcSkill({ body: "" })).toBeNull();
    // Incidental vocabulary below the score floor.
    expect(inferArcSkill({ body: "what channel is this on" })).toBeNull();
    // The explicit path owns slash commands.
    expect(inferArcSkill({ body: "/draft-campaign something" })).toBeNull();
  });

  it("abstains when two playbooks are genuinely close", () => {
    // "summarize" (research) against "performance" (discovery) is a 1-point
    // lead — a coin flip, so it must not be dressed up as a decision.
    const decision = inferArcSkill({ body: "summarize performance" });
    expect(decision).toBeNull();
  });

  it("counts a repeated phrase once so emphasis cannot clear the margin", () => {
    const once = scoreArcSkills({ body: "draft" });
    const many = scoreArcSkills({ body: "draft draft draft draft" });
    expect(many[0]!.score).toBe(once[0]!.score);
  });

  it("lets operator wording outweigh the mode prior", () => {
    // Ask mode penalizes drafting, but the words are unambiguous.
    expect(inferArcSkill({ body: "draft an email sequence for these leads", mode: "ask" })?.id).toBe(
      ARC_SKILL_IDS.campaignPackageDrafting,
    );
  });

  it("abstains on a negated instruction rather than reading the verb literally", () => {
    // From the prod corpus. "Don't re-draft anything" must not be read as a
    // drafting request just because the word appears.
    expect(
      inferArcSkill({
        body: "Don't re-draft anything. Just read the CRM directly and tell me how many contacts exist.",
        mode: "draft",
      }),
    ).toBeNull();
  });

  it("never invents a score from the mode prior alone", () => {
    const scores = scoreArcSkills({ body: "hello there", mode: "draft" });
    expect(scores.every((entry) => entry.score === 0)).toBe(true);
  });

  it("reports margin and confidence for threshold tuning", () => {
    const decision = inferArcSkill({ body: "draft a campaign and write the email copy" });
    expect(decision?.confidence).toBe("high");
    expect(decision?.margin).toBeGreaterThanOrEqual(4);
  });
});
