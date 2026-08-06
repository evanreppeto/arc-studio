import { describe, expect, it } from "vitest";

import { buildDemoLiveWork } from "./demo-live-work";

describe("buildDemoLiveWork", () => {
  it("grounds a draft preview in the actual channel and subject", () => {
    const work = buildDemoLiveWork("Write an email for the spring property-manager campaign");

    expect(work.commentary).toContain("an email draft");
    expect(work.commentary).toContain("for the spring property-manager campaign");
    expect(work.rows.some((row) => row.label.includes("CRM records"))).toBe(true);
    expect(work.rows.at(-1)?.label).toBe("Preparing the email draft");
  });

  it("does not replay the same script for different requests in one intent", () => {
    const homeowners = buildDemoLiveWork("Find homeowners affected by the Naperville hailstorm");
    const competitors = buildDemoLiveWork("Find roofing competitors advertising in Aurora");

    expect(homeowners.commentary).not.toBe(competitors.commentary);
    expect(homeowners.rows.map((row) => row.label)).not.toEqual(competitors.rows.map((row) => row.label));
    expect(homeowners.commentary).toContain("homeowners affected by the Naperville hailstorm");
    expect(competitors.commentary).toContain("roofing competitors advertising in Aurora");
  });

  it("falls back to a request-specific grounded answer plan", () => {
    const work = buildDemoLiveWork("Explain why our July conversion rate changed");

    expect(work.commentary).toContain("why our July conversion rate changed");
    expect(work.rows.at(-1)?.label).toContain("why our July conversion rate changed");
  });

  /**
   * The regression this file was written on. Every one of these used to come
   * back with prepositions deleted out of the middle of the operator's own
   * sentence, because the subject was built by filtering a stopword list across
   * the whole request and keeping the first six survivors.
   */
  it("keeps the operator's words in their own order", () => {
    const work = buildDemoLiveWork("Build a multi-channel win-back campaign for stalled demo accounts");

    expect(work.rows[0]?.label).toBe("Interpreting “multi-channel win-back campaign for stalled demo accounts”");
    // The verb the trace is about to say for itself is the only thing dropped.
    expect(work.commentary).not.toContain("Build");
    // ...and nothing inside the request is.
    for (const word of ["multi-channel", "win-back", "campaign", "for", "stalled", "demo", "accounts"]) {
      expect(work.commentary).toContain(word);
    }
  });

  it("drops only the opening verb phrase, never words inside the request", () => {
    const cases: Array<[string, string]> = [
      ["Draft an email to the property managers we lost in Q2", "email to the property managers we lost in Q2"],
      ["Can you find the accounts that went quiet after a demo", "accounts that went quiet after a demo"],
      ["please summarize what changed in the pipeline this week", "what changed in the pipeline this week"],
      ["Show me the leads with no follow-up", "leads with no follow-up"],
      ["/draft-email a note about our new service area", "note about our new service area"],
    ];

    for (const [request, subject] of cases) {
      expect(buildDemoLiveWork(request).rows[0]?.label).toBe(`Interpreting “${subject}”`);
    }
  });

  it("truncates a long subject on a word boundary rather than mid-word", () => {
    const work = buildDemoLiveWork(
      "Draft a campaign for every commercial property manager in the northern suburbs who has not booked an inspection since spring",
    );
    const subject = work.rows[0]!.label.replace(/^Interpreting “|”$/gu, "");

    expect(subject.endsWith("…")).toBe(true);
    expect(subject.replace(/…$/u, "")).toMatch(/\S$/u);
    // A word boundary, so the cut never lands inside a word.
    expect("campaign for every commercial property manager in the northern suburbs who has not booked an inspection since spring")
      .toContain(subject.replace(/…$/u, ""));
  });

  it("keeps a bare verb rather than emptying the subject", () => {
    expect(buildDemoLiveWork("summarize").rows[0]?.label).toBe("Interpreting “summarize”");
  });
});
