import { describe, expect, it } from "vitest";

import {
  MAX_LEAD_FIT_SCORE,
  calculateLeadFitScore,
  effectiveLeadQuality,
  type LeadFitSignals,
} from "../lead-fit";

const NONE: LeadFitSignals = {
  hasPersona: false,
  hasEmail: false,
  hasPhone: false,
  hasCompany: false,
  hasLocation: false,
};

const COMPLETE: LeadFitSignals = {
  hasPersona: true,
  hasEmail: true,
  hasPhone: true,
  hasCompany: true,
  hasLocation: true,
};

// The floor a cold-lead candidate has to clear, and the most the detector's own
// cold bonus can add. Pinned here so a change to either surfaces as a failure in
// this file rather than as opportunities silently appearing or vanishing.
const CRM_INACTIVITY_FLOOR = 60;
const MAX_COLD_BONUS = 20;

describe("calculateLeadFitScore", () => {
  it("scores an empty record at the base", () => {
    expect(calculateLeadFitScore(NONE)).toBe(15);
  });

  it("tops out at 53 for a fully known record", () => {
    expect(calculateLeadFitScore(COMPLETE)).toBe(MAX_LEAD_FIT_SCORE);
    expect(MAX_LEAD_FIT_SCORE).toBe(53);
  });

  // The single most important property: fit alone must never qualify anything.
  // A record still has to be genuinely quiet as well as genuinely well-formed.
  it("cannot clear the floor on its own, even when perfect", () => {
    expect(MAX_LEAD_FIT_SCORE).toBeLessThan(CRM_INACTIVITY_FLOOR);
  });

  // ...but a complete record that HAS gone quiet must be able to.
  it("clears the floor once the maximum cold bonus is added", () => {
    expect(MAX_LEAD_FIT_SCORE + MAX_COLD_BONUS).toBeGreaterThanOrEqual(CRM_INACTIVITY_FLOOR);
  });

  // A bare email silent for a year is not an opportunity, it's a dead row.
  it("leaves a bare email below the floor even at maximum coldness", () => {
    const bare = calculateLeadFitScore({ ...NONE, hasEmail: true });
    expect(bare).toBe(23);
    expect(bare + MAX_COLD_BONUS).toBeLessThan(CRM_INACTIVITY_FLOOR);
  });

  it("weights persona and company above contact details", () => {
    const persona = calculateLeadFitScore({ ...NONE, hasPersona: true });
    const company = calculateLeadFitScore({ ...NONE, hasCompany: true });
    const phone = calculateLeadFitScore({ ...NONE, hasPhone: true });
    expect(persona).toBeGreaterThan(phone);
    expect(company).toBeGreaterThan(phone);
  });
});

describe("effectiveLeadQuality", () => {
  // Inbound leads keep what the intent model earned them. This can only raise a
  // record the intent model had nothing to say about — the imported case.
  it("never lowers a lead that earned a real intent score", () => {
    expect(effectiveLeadQuality(90, COMPLETE)).toBe(90);
    expect(effectiveLeadQuality(70, NONE)).toBe(70);
  });

  it("lifts an imported record the intent model scored at its base", () => {
    // 10 is calculateLeadScore's base — what every record with no standing
    // water, photo or after-hours call receives.
    expect(effectiveLeadQuality(10, COMPLETE)).toBe(53);
  });

  it("still refuses to lift an empty record far", () => {
    expect(effectiveLeadQuality(10, NONE)).toBe(15);
  });
});
