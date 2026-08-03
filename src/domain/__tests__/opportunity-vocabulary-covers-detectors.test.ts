import { describe, expect, it } from "vitest";

import {
  OPPORTUNITY_KINDS,
  OPPORTUNITY_SUBJECT_TYPES,
  detectColdLeadOpportunities,
  detectCompetitorOpportunities,
  detectNextIterationOpportunities,
  detectWeatherEventOpportunities,
  type OpportunityCandidate,
} from "@/domain";

/**
 * The vocabulary is what Arc is ALLOWED to say. The detectors are what the app
 * says on its own. So everything a detector can emit, Arc must be able to propose
 * — otherwise the agent is barred from a category its own product already renders.
 *
 * The first cut of the vocabulary missed exactly this. `detectNextIterationOpportunities`
 * emits kind "next_iteration" on subject "campaign", and the inbox renders it as
 * "Repeat a winner" — but neither value was on the list, so Arc could no longer
 * suggest repeating a winning campaign. It was invisible: the detectors call
 * upsertOpportunities directly and never touch parseOpportunityProposal, so nothing
 * failed; only the agent quietly lost a category. Prod carries no such rows yet, so
 * the data couldn't show it either.
 *
 * Asserting on the detectors' real output rather than on a hand-kept list, so
 * adding a detector kind and forgetting the vocabulary fails here.
 */

const NOW = "2026-07-16T13:00:00.000Z";

const emitted = (): OpportunityCandidate[] => [
  ...detectColdLeadOpportunities(
    [
      {
        id: "lead-1",
        label: "Dana Whitfield (North Shore Property Group)",
        persona: "persona_property_manager",
        leadScore: 71,
        status: "qualified",
        lastActivityAt: "2026-06-06T13:00:00.000Z",
        activityKnown: true,
        hasActiveCampaign: false,
      },
    ],
    { now: NOW },
  ),
  ...detectWeatherEventOpportunities(
    [
      {
        id: "wx-1",
        eventType: "Severe Thunderstorm Warning",
        area: "Naperville",
        severity: "warning",
        endsAt: "2026-07-20T00:00:00.000Z",
        zipCodes: ["60540"],
      },
    ],
    { now: NOW },
  ),
  ...detectNextIterationOpportunities([
    {
      campaignId: "camp-1",
      campaignName: "Spring Storm Prep",
      persona: "persona_homeowner_preventative",
      topChannel: "Email",
      bookedJobs: 6,
      leads: 45,
      recommendation: "Lead with Email; reuse the storm-watch nudge.",
      arcPrompt: "Draft round two of Spring Storm Prep, leading with Email.",
    },
  ]),
  ...detectCompetitorOpportunities(
    [
      {
        id: "comp-1",
        competitorName: "ServPro",
        channel: "meta_ad_library",
        status: "confirmed",
        keywords: ["water damage"],
        creativeCount: 4,
        capturedAt: NOW,
      },
    ],
    { now: NOW },
  ),
];

describe("the opportunity vocabulary covers what the detectors emit", () => {
  it("emits something from every detector, or this test proves nothing", () => {
    // A detector whose fixture stopped qualifying would silently make the
    // assertions below vacuous.
    const kinds = new Set(emitted().map((c) => c.kind));
    expect(kinds).toContain("crm_inactivity");
    expect(kinds).toContain("weather_event");
    expect(kinds).toContain("next_iteration"); // the one the vocabulary missed
    expect(kinds).toContain("competitor_signal");
  });

  it("every kind a detector produces is one Arc may propose", () => {
    for (const candidate of emitted()) {
      expect(OPPORTUNITY_KINDS, `kind "${candidate.kind}"`).toContain(candidate.kind);
    }
  });

  it("every subject type a detector produces is one Arc may propose", () => {
    // Includes the synthetic subjects: "campaign", "weather_event",
    // "competitor_signal" — not CRM records, but the inbox keys its icon off them.
    for (const candidate of emitted()) {
      expect(OPPORTUNITY_SUBJECT_TYPES, `subject_type "${candidate.subjectType}"`).toContain(candidate.subjectType);
    }
  });
});
