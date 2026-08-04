import { describe, expect, it } from "vitest";

import {
  highlightClaims,
  isCleanForBulkApproval,
  normalizeClaim,
  splitSuggestedEdits,
  summarizeReview,
} from "./review-summary";

const finding = (claim: string, severity: string, message = "why") => ({ id: `f-${claim}`, claim, severity, message, fix: null });
const reviewed = { claimsReviewed: true };

describe("summarizeReview", () => {
  it("leads with the number of things standing between the draft and send", () => {
    const s = summarizeReview({
      ...reviewed,
      recommendation: { agent: "draft-critic", verdict: "request revision", rationale: "", riskFlags: [], suggestedEdits: "" },
      findings: [finding("a", "blocker"), finding("b", "blocker"), finding("c", "warning")],
      blockedPhrases: [],
    });
    expect(s.blockers).toBe(2);
    expect(s.concerns).toBe(1);
    expect(s.headline).toBe("2 things to fix before this can go out");
    expect(s.tone).toBe("red");
  });

  it("counts a banned phrase as a blocker — the Brand Kit gate is not a suggestion", () => {
    const s = summarizeReview({ ...reviewed, recommendation: null, findings: [], blockedPhrases: ["guaranteed"] });
    expect(s.blockers).toBe(1);
    expect(s.headline).toBe("1 thing to fix before this can go out");
  });

  it("says notes, not blockers, when nothing is blocking", () => {
    const s = summarizeReview({
      ...reviewed,
      recommendation: { agent: "draft-critic", verdict: "approve", rationale: "", riskFlags: [], suggestedEdits: "" },
      findings: [finding("a", "warning")],
      blockedPhrases: [],
    });
    expect(s.headline).toBe("1 note on this draft");
    expect(s.tone).toBe("amber");
  });

  it("does not read as clean when the verdict asks for a change but quotes nothing", () => {
    // The dangerous shape: a revision verdict with no findings attached. A blank
    // headline here would look identical to a draft that passed.
    const s = summarizeReview({
      ...reviewed,
      recommendation: { agent: "draft-critic", verdict: "request_revision", rationale: "", riskFlags: [], suggestedEdits: "" },
      findings: [],
      blockedPhrases: [],
    });
    expect(s.headline).toBe("Arc wants a change before this goes out");
    expect(s.tone).toBe("amber");
  });

  it("never lets an unchecked draft borrow the colour of one that passed", () => {
    // The trap the whole `claimsReviewed` flag exists for: no review and a clean
    // review produce identical data, and only this flag tells them apart.
    const s = summarizeReview({ recommendation: null, findings: [], blockedPhrases: [], claimsReviewed: false });
    expect(s.headline).toBe("Not checked yet");
    expect(s.tone).toBe("gray");

    const clean = summarizeReview({
      ...reviewed,
      recommendation: { agent: "draft-critic", verdict: "approve", rationale: "", riskFlags: [], suggestedEdits: "" },
      findings: [],
      blockedPhrases: [],
    });
    expect(clean.headline).toBe("Nothing flagged");
    expect(clean.tone).toBe("ok");
  });
});

describe("summarizeReview chip", () => {
  it("says the same thing at row length, so a collapsed card is still triageable", () => {
    const cases: Array<[Parameters<typeof summarizeReview>[0], string]> = [
      [{ ...reviewed, recommendation: null, findings: [finding("a", "blocker"), finding("b", "blocker")], blockedPhrases: [] }, "2 to fix"],
      [{ ...reviewed, recommendation: null, findings: [finding("a", "warning")], blockedPhrases: [] }, "1 note"],
      [{ ...reviewed, recommendation: null, findings: [finding("a", "warning"), finding("b", "warning")], blockedPhrases: [] }, "2 notes"],
      [{ recommendation: null, findings: [], blockedPhrases: [], claimsReviewed: false }, "Not checked"],
      [
        {
          ...reviewed,
          recommendation: { agent: "draft-critic", verdict: "approve", rationale: "", riskFlags: [], suggestedEdits: "" },
          findings: [],
          blockedPhrases: [],
        },
        "Nothing flagged",
      ],
    ];
    for (const [input, expected] of cases) expect(summarizeReview(input).chip).toBe(expected);
  });
});

describe("isCleanForBulkApproval", () => {
  it("takes a deliverable a review passed with nothing raised", () => {
    expect(isCleanForBulkApproval({ findings: [], blockedPhrases: [], claimsReviewed: true })).toBe(true);
  });

  it("refuses one nothing has reviewed, however empty its findings look", () => {
    // The whole hazard: unreviewed and reviewed-clean are byte-identical apart
    // from this flag, and bulk-approving the first would put unchecked copy
    // behind a human's approval.
    expect(isCleanForBulkApproval({ findings: [], blockedPhrases: [], claimsReviewed: false })).toBe(false);
  });

  it("refuses one carrying a finding or a banned phrase", () => {
    expect(isCleanForBulkApproval({ findings: [finding("a", "warning")], blockedPhrases: [], claimsReviewed: true })).toBe(false);
    expect(isCleanForBulkApproval({ findings: [], blockedPhrases: ["guaranteed"], claimsReviewed: true })).toBe(false);
  });
});

describe("splitSuggestedEdits", () => {
  it("breaks one numbered paragraph into the edits it actually contains", () => {
    const rows = splitSuggestedEdits(
      "1) Insert the real 24/7 line number before send. 2) Reword the opener to 'recent flooding'. 3) Confirm with ops that replying triggers a callback.",
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe("Insert the real 24/7 line number before send.");
    expect(rows[2]).toBe("Confirm with ops that replying triggers a callback.");
  });

  it("leaves unnumbered prose in one piece rather than guessing at breaks", () => {
    expect(splitSuggestedEdits("Soften the claim and add the address.")).toEqual([
      "Soften the claim and add the address.",
    ]);
  });

  it("does not mistake a decimal or a year for a new edit", () => {
    expect(splitSuggestedEdits("Drop the 1.5x claim and the 2026. reference.")).toHaveLength(1);
  });

  it("has nothing to show when the reviewer wrote no edits", () => {
    expect(splitSuggestedEdits("   ")).toEqual([]);
  });
});

describe("normalizeClaim", () => {
  it("peels the quoting a stored claim arrives double-wrapped in", () => {
    expect(normalizeClaim('““Call [24/7 line]””')).toBe("Call [24/7 line]");
  });

  it("keeps only the run before an ellipsis, which is all that can be matched", () => {
    expect(normalizeClaim('"If this week\'s flooding reached your home…"')).toBe("If this week's flooding reached your home");
  });
});

describe("highlightClaims", () => {
  const body = "Call [24/7 line] — answered any hour. If this week's flooding reached your home, we can help.";

  it("marks the quoted span in place, leaving the rest of the copy untouched", () => {
    const segments = highlightClaims(body, ['"Call [24/7 line]"']);
    expect(segments.map((s) => s.text).join("")).toBe(body);
    const marked = segments.filter((s) => s.findingIndex !== null);
    expect(marked).toHaveLength(1);
    expect(marked[0]).toEqual({ text: "Call [24/7 line]", findingIndex: 0 });
  });

  it("still matches when the draft and the quote disagree on curly punctuation", () => {
    // The draft carries a typographic apostrophe; the quote a straight one.
    const curly = "If this week’s flooding reached your home";
    const segments = highlightClaims(`Opener: ${curly}, we can help.`, ["\"If this week's flooding reached your home\""]);
    expect(segments.filter((s) => s.findingIndex === 0)).toHaveLength(1);
    expect(segments.map((s) => s.text).join("")).toBe(`Opener: ${curly}, we can help.`);
  });

  it("carries the finding's own index so a mark points back at its finding", () => {
    const segments = highlightClaims(body, ["nowhere in this draft", '"answered any hour"']);
    const marked = segments.filter((s) => s.findingIndex !== null);
    expect(marked).toHaveLength(1);
    expect(marked[0].findingIndex).toBe(1);
  });

  it("drops the shorter of two overlapping quotes rather than nesting marks", () => {
    const segments = highlightClaims(body, ['"Call [24/7 line] — answered any hour"', '"answered any hour"']);
    expect(segments.filter((s) => s.findingIndex !== null)).toHaveLength(1);
    expect(segments.map((s) => s.text).join("")).toBe(body);
  });

  it("ignores a claim too short to point at anything in particular", () => {
    const segments = highlightClaims(body, ['"an"']);
    expect(segments.every((s) => s.findingIndex === null)).toBe(true);
  });

  it("returns the copy whole when the review quoted nothing", () => {
    expect(highlightClaims(body, [])).toEqual([{ text: body, findingIndex: null }]);
  });
});
