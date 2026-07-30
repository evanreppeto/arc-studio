import { describe, expect, it } from "vitest";

import { narrationEchoesAnswer, visibleStepNarration } from "./step-narration";

describe("visibleStepNarration", () => {
  it("shows narration the answer doesn't already contain", () => {
    const narration = "The CRM search is the only way to know whether these records are live, so I'll run it before answering.";
    const answer = "Leads: 0. Companies: 0. Contacts: 0. The CRM is completely empty.";

    expect(visibleStepNarration(narration, answer)).toBe(narration);
  });

  it("hides narration that survived verbatim into the answer", () => {
    const narration = "I'll check the CRM first, since a stale memory isn't evidence.";
    const answer = `Here's what I found.\n\n${narration}\n\nLeads: 0.`;

    expect(visibleStepNarration(narration, answer)).toBeNull();
  });

  it("hides narration the answer restates in different words", () => {
    // The runner keeps substantively distinct pre-tool text in the reply, so a
    // near-repeat would otherwise be read twice in a row.
    const narration = "Checking the CRM for leads, companies, and contacts before I answer.";
    const answer = "I checked the CRM for leads, companies and contacts — all three are empty.";

    expect(visibleStepNarration(narration, answer)).toBeNull();
  });

  it("treats an empty or whitespace narration as nothing to show", () => {
    expect(visibleStepNarration("", "anything")).toBeNull();
    expect(visibleStepNarration("   ", "anything")).toBeNull();
    expect(visibleStepNarration(null, "anything")).toBeNull();
    expect(visibleStepNarration(undefined, "anything")).toBeNull();
  });

  it("still shows narration while the answer is empty — mid-run, nothing can echo yet", () => {
    const narration = "Pulling the campaign list next.";
    expect(visibleStepNarration(narration, "")).toBe(narration);
  });

  it("keeps narration that merely shares a few common words", () => {
    const narration = "Pulling the brand profile so the copy matches the voice already approved.";
    const answer = "Leads: 0. Companies: 0. Contacts: 0.";

    expect(narrationEchoesAnswer(narration, answer)).toBe(false);
  });
});
