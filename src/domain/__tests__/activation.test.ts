import { describe, expect, it } from "vitest";

import { buildActivationChecklist, type ActivationSignals } from "../activation";

const NONE: ActivationSignals = {
  hasRecords: false,
  brandCaptured: false,
  dismissed: false,
  hasMedia: false,
  hasOpportunity: false,
  hasApprovedCampaign: false,
  hasTeammate: false,
};

const ALL: ActivationSignals = {
  hasRecords: true,
  brandCaptured: true,
  dismissed: false,
  hasMedia: true,
  hasOpportunity: true,
  hasApprovedCampaign: true,
  hasTeammate: true,
};

describe("buildActivationChecklist", () => {
  // Order is the product argument: a new workspace has no contacts or companies,
  // so until records exist every other screen is empty regardless of what else
  // the owner does.
  it("leads with records, then brand", () => {
    const result = buildActivationChecklist(NONE);
    expect(result.steps.map((s) => s.key)).toEqual(["records", "brand", "opportunity", "campaign", "media", "team"]);
    expect(result.steps.every((s) => !s.done)).toBe(true);
  });

  it("marks only records as blocking", () => {
    const blocking = buildActivationChecklist(NONE).steps.filter((s) => s.blocking).map((s) => s.key);
    expect(blocking).toEqual(["records"]);
  });

  it("maps each signal to its step's done flag", () => {
    const done = Object.fromEntries(
      buildActivationChecklist({ ...NONE, hasRecords: true, hasMedia: true, hasTeammate: true })
        .steps.map((s) => [s.key, s.done]),
    );
    expect(done).toEqual({ records: true, brand: false, opportunity: false, campaign: false, media: true, team: true });
  });

  // Core is records, NOT brand. A workspace with a perfectly captured brand and
  // no records still shows an empty app everywhere — which is the exact
  // confusion this checklist exists to prevent.
  it("treats records as the core completion gate, not brand", () => {
    expect(buildActivationChecklist(NONE).coreDone).toBe(false);
    expect(buildActivationChecklist({ ...NONE, brandCaptured: true }).coreDone).toBe(false);
    expect(buildActivationChecklist({ ...NONE, hasRecords: true }).coreDone).toBe(true);
  });

  it("points at the first unfinished step", () => {
    expect(buildActivationChecklist(NONE).nextStep).toBe("records");
    expect(buildActivationChecklist({ ...NONE, hasRecords: true }).nextStep).toBe("brand");
    expect(buildActivationChecklist(ALL).nextStep).toBeNull();
  });

  it("shows the checklist until everything is done or it is dismissed", () => {
    expect(buildActivationChecklist(NONE).showChecklist).toBe(true);
    expect(buildActivationChecklist({ ...NONE, dismissed: true }).showChecklist).toBe(false);
    expect(buildActivationChecklist(ALL).showChecklist).toBe(false);
  });

  // Dismissing is the owner's call and must stick even with work outstanding —
  // otherwise the panel reappears on every visit and becomes noise.
  it("stays dismissed even when steps remain unfinished", () => {
    const result = buildActivationChecklist({ ...NONE, hasRecords: true, dismissed: true });
    expect(result.showChecklist).toBe(false);
    expect(result.nextStep).toBe("brand");
  });
});

describe("the campaign step marks approval, not existence", () => {
  // The regression this locks down: the signal used to be "has any campaign", so
  // a draft nobody had looked at marked the step complete. BSR-504's acceptance
  // is reaching an APPROVED campaign, and the checklist's own rule is that it
  // cannot show complete while the underlying step isn't.
  it("stays open while a campaign exists but is unapproved", () => {
    const result = buildActivationChecklist({ ...NONE, hasRecords: true, hasOpportunity: true });
    const campaign = result.steps.find((s) => s.key === "campaign");
    expect(campaign?.done).toBe(false);
    expect(result.nextStep).toBe("brand");
  });

  it("completes only once a campaign has actually been approved", () => {
    const result = buildActivationChecklist({ ...NONE, hasApprovedCampaign: true });
    expect(result.steps.find((s) => s.key === "campaign")?.done).toBe(true);
  });

  it("puts the opportunity step before the campaign step", () => {
    // Arc finds something, then drafts from it. Asking someone to approve a
    // campaign while the inbox is empty asks for something not yet possible.
    const keys = buildActivationChecklist(NONE).steps.map((s) => s.key);
    expect(keys.indexOf("opportunity")).toBeLessThan(keys.indexOf("campaign"));
  });
});
