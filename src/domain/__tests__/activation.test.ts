import { describe, expect, it } from "vitest";

import { buildActivationChecklist, type ActivationSignals } from "../activation";

const NONE: ActivationSignals = {
  hasRecords: false,
  brandCaptured: false,
  dismissed: false,
  hasMedia: false,
  hasCampaign: false,
  hasTeammate: false,
};

const ALL: ActivationSignals = {
  hasRecords: true,
  brandCaptured: true,
  dismissed: false,
  hasMedia: true,
  hasCampaign: true,
  hasTeammate: true,
};

describe("buildActivationChecklist", () => {
  // Order is the product argument: a new workspace has no contacts or companies,
  // so until records exist every other screen is empty regardless of what else
  // the owner does.
  it("leads with records, then brand", () => {
    const result = buildActivationChecklist(NONE);
    expect(result.steps.map((s) => s.key)).toEqual(["records", "brand", "campaign", "media", "team"]);
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
    expect(done).toEqual({ records: true, brand: false, campaign: false, media: true, team: true });
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
