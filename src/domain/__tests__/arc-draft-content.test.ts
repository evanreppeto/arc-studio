import { describe, expect, it } from "vitest";

import { isLongDraftBody, parseArcDraftContent } from "@/domain";

/**
 * The fixtures below are the SHAPES found in prod `campaign_assets` bodies, not
 * invented ones — the parser exists to survive the variation between runs, so a
 * fixture that only covers one spelling proves nothing.
 */
describe("parseArcDraftContent", () => {
  it("lifts an uppercase SUBJECT/PREHEADER lead-in off an email body", () => {
    const out = parseArcDraftContent(
      "SUBJECT: A quick pre-winter check for your pipes and water heater\n" +
        "PREHEADER: Pick a time that works — our Chicago crew handles the rest.\n\n" +
        "Hi {{first_name}},\n\nChicago winters are hard on pipes.",
    );
    expect(out.fields).toEqual([
      { label: "Subject", value: "A quick pre-winter check for your pipes and water heater" },
      { label: "Preheader", value: "Pick a time that works — our Chicago crew handles the rest." },
    ]);
    expect(out.body).toBe("Hi {{first_name}},\n\nChicago winters are hard on pipes.");
    expect(out.headline).toBe("A quick pre-winter check for your pipes and water heater");
  });

  it("reads the title-case spelling the same way", () => {
    const out = parseArcDraftContent(
      "Subject: Water in your home? Here's the next clear step.\n\n" +
        "Preheader: A real person answers 24/7.\n\nIf this week's flooding reached your home,",
    );
    expect(out.fields.map((f) => f.label)).toEqual(["Subject", "Preheader"]);
    expect(out.body).toBe("If this week's flooding reached your home,");
  });

  it("reads landing-page and social-ad labels", () => {
    const landing = parseArcDraftContent("H1: Start with the next clear step.\nSubhead: Answered 24/7.\n\nBody copy here.");
    expect(landing.fields).toEqual([
      { label: "Headline", value: "Start with the next clear step." },
      { label: "Subhead", value: "Answered 24/7." },
    ]);
    expect(landing.headline).toBe("Start with the next clear step.");

    const ad = parseArcDraftContent("Headline: Water damage? We slow the situation down.\n\nPrimary text: If last week's flooding reached your home.");
    expect(ad.fields.map((f) => f.label)).toEqual(["Headline", "Primary text"]);
  });

  it("takes a label's value from the next line when the colon is bare", () => {
    const out = parseArcDraftContent(
      "Platform: Meta (Facebook/Instagram), geo-capped to Cook County\n\nPrimary text:\nFlooding this week in Chicago?\n\nThe next clear step is simpler.",
    );
    expect(out.fields).toEqual([
      { label: "Platform", value: "Meta (Facebook/Instagram), geo-capped to Cook County" },
      { label: "Primary text", value: "Flooding this week in Chicago?" },
    ]);
    expect(out.body).toBe("The next clear step is simpler.");
  });

  /**
   * The regression this allowlist exists for. A `^\w+:` matcher lifts the
   * workspace's own brand name off the front of its SMS and relabels the message
   * as a field value — the deliverable renders as something the operator never
   * wrote.
   */
  it("leaves an unknown leading label in the copy", () => {
    const sms = "Big Shoulders Restoration: If last week's flooding reached your home, the next clear step is one call.";
    const out = parseArcDraftContent(sms);
    expect(out.fields).toEqual([]);
    expect(out.body).toBe(sms);
    expect(out.headline).toBeNull();
  });

  it("does not lift a known label that appears below the lead-in", () => {
    const out = parseArcDraftContent("Hi there,\n\nSubject: this line is prose, not a header.\n\nThanks.");
    expect(out.fields).toEqual([]);
    expect(out.body).toBe("Hi there,\n\nSubject: this line is prose, not a header.\n\nThanks.");
  });

  it("keeps an all-prose one-pager intact", () => {
    const doc = "PARTNER / SALES HANDOFF NOTE — Chicago Flood Response\n\nCONTEXT AS BUILT\nThis package was drafted Aug 3.";
    expect(parseArcDraftContent(doc)).toEqual({ fields: [], body: doc, headline: null });
  });

  it("handles a lead-in with no body after it", () => {
    const out = parseArcDraftContent("Subject: Just the subject");
    expect(out.fields).toEqual([{ label: "Subject", value: "Just the subject" }]);
    expect(out.body).toBe("");
  });

  it("returns empty content for blank or missing bodies", () => {
    for (const input of [null, undefined, "", "   \n\n  "]) {
      expect(parseArcDraftContent(input)).toEqual({ fields: [], body: "", headline: null });
    }
  });

  it("prefers a subject over a platform note as the headline", () => {
    const out = parseArcDraftContent("Platform: Meta\nSubject: The real one\n\nBody.");
    expect(out.headline).toBe("The real one");
  });
});

describe("isLongDraftBody", () => {
  it("is false for short copy", () => {
    expect(isLongDraftBody("")).toBe(false);
    expect(isLongDraftBody("One short line.")).toBe(false);
  });

  it("is true past the clamp in lines", () => {
    expect(isLongDraftBody("a\n".repeat(12), 10)).toBe(true);
    expect(isLongDraftBody("a\n".repeat(4), 10)).toBe(false);
  });

  it("is true past the clamp in characters, even on one wrapped line", () => {
    expect(isLongDraftBody("x".repeat(900), 10, 78)).toBe(true);
    expect(isLongDraftBody("x".repeat(200), 10, 78)).toBe(false);
  });
});
