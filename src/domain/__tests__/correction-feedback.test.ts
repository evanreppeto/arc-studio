import { describe, expect, it } from "vitest";

import { summarizeCorrections, type CorrectionInput } from "../correction-feedback";

const at = (day: number) => `2026-08-${String(day).padStart(2, "0")}T10:00:00.000Z`;

function note(over: Partial<CorrectionInput> = {}): CorrectionInput {
  return {
    decision: "revision_requested",
    note: "Our logo needs to be on the truck",
    itemType: "campaign_asset",
    decidedAt: at(3),
    ...over,
  };
}

describe("summarizeCorrections", () => {
  it("surfaces a single correction — unlike dismissals, one is already a lesson", () => {
    // The live tenant has exactly three, each specific and actionable. A
    // repetition threshold like BSR-686's would have discarded all of them.
    const out = summarizeCorrections([note()]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("Our logo needs to be on the truck");
  });

  it("ignores approvals — an approval note is praise, not a correction", () => {
    expect(summarizeCorrections([note({ decision: "approved", note: "Copy is on-brand." })])).toEqual([]);
    expect(summarizeCorrections([note({ decision: "archived", note: "Test artifact." })])).toEqual([]);
  });

  it("keeps declines as well as revision requests", () => {
    const out = summarizeCorrections([note({ decision: "declined", note: "Wrong audience entirely." })]);
    expect(out).toHaveLength(1);
  });

  it("collapses boilerplate repeated verbatim to one line", () => {
    // The archived demo org holds nine identical "Nightly smoke check — no
    // action needed" notes, one per night from the prod smoke workflow. Org
    // scoping keeps them out of the live tenant; this is the second line.
    const smoke = Array.from({ length: 9 }, (_, i) =>
      note({ note: "Nightly smoke check — no action needed; this asset is reopened immediately.", decidedAt: at(i + 1) }),
    );
    expect(summarizeCorrections(smoke)).toHaveLength(1);
  });

  it("treats whitespace and case differences as the same note", () => {
    const out = summarizeCorrections([
      note({ note: "Our logo needs to be on the truck", decidedAt: at(3) }),
      note({ note: "our  logo   needs to be on the TRUCK", decidedAt: at(2) }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("puts the newest correction first and caps the list", () => {
    const many = Array.from({ length: 12 }, (_, i) => note({ note: `correction ${i}`, decidedAt: at(i + 1) }));
    const out = summarizeCorrections(many);
    expect(out).toHaveLength(5);
    // at(12) is the newest of the twelve.
    expect(out[0]).toContain("correction 11");
  });

  it("keeps the most recent copy when the same text repeats", () => {
    const out = summarizeCorrections([
      note({ note: "same words", decidedAt: at(1), itemType: "email_campaign_asset" }),
      note({ note: "same words", decidedAt: at(9), itemType: "campaign_asset" }),
    ]);
    // The survivor is the newer row, so its item label is the one rendered.
    expect(out).toEqual(['Creative — "same words"']);
  });

  it("bounds a pasted wall of text instead of letting it flood the prompt", () => {
    const out = summarizeCorrections([note({ note: "x".repeat(5000) })]);
    expect(out[0].length).toBeLessThan(300);
    expect(out[0]).toContain("…");
  });

  it("skips empty and whitespace-only notes rather than rendering empty quotes", () => {
    expect(summarizeCorrections([note({ note: null }), note({ note: "   " })])).toEqual([]);
  });

  it("names what was under review, so a creative note is not read as copy guidance", () => {
    // Labels come from the registered vocabulary mapper (BSR-709), not from a
    // second private one living here.
    expect(summarizeCorrections([note({ itemType: "email_campaign_asset" })])[0]).toContain("Email —");
    expect(summarizeCorrections([note({ itemType: "campaign_asset" })])[0]).toContain("Creative —");
    expect(summarizeCorrections([note({ itemType: null })])[0]).toContain("Draft —");
    expect(summarizeCorrections([note({ itemType: "a_type_from_next_quarter" })])[0]).toContain("Draft —");
  });

  it("returns nothing at all when there is nothing to say", () => {
    expect(summarizeCorrections([])).toEqual([]);
  });
});
