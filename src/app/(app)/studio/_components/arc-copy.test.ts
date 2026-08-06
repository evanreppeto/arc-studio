import { describe, expect, it } from "vitest";

import { extractCanvasCopy } from "./arc-copy";

/**
 * Arc could make you a new asset but not drive the canvas you were editing: ask
 * it to rewrite a headline and you got words in the thread to copy by hand.
 * This is the parse behind the "Apply to canvas" control.
 *
 * The bar is high in one direction only. Missing a suggestion costs a
 * copy-paste, which is what the operator does today. Inventing one puts words on
 * an ad that Arc never proposed — so every rule here fails closed.
 */
describe("extractCanvasCopy", () => {
  it("reads a labelled headline, quotes and all", () => {
    expect(extractCanvasCopy('Headline: "Your roof, ready before the next storm."')).toEqual([
      { field: "headline", value: "Your roof, ready before the next storm." },
    ]);
  });

  it("maps every label variant onto the field it sets", () => {
    const text = [
      "Kicker: Storm season",
      "H1: Ready before the next storm",
      "Subhead: Free assessment, same-week scheduling",
      "CTA: Get my free quote",
    ].join("\n");
    expect(extractCanvasCopy(text).map((s) => s.field)).toEqual(["kicker", "headline", "subhead", "cta"]);
  });

  it("survives list markers and bold around the label", () => {
    expect(extractCanvasCopy('- **Headline:** "Ready before the storm"')).toEqual([
      { field: "headline", value: "Ready before the storm" },
    ]);
  });

  /**
   * The whole reason the labels are an allowlist. Prod replies are full of
   * lead-ins — `Subject:` on every email draft, `Platform:` on every paid-social
   * one — and a `/^(\w+):/` rule would offer to paste an email subject line or
   * "Meta (Facebook/Instagram), geo-capped to Cook County" onto the artboard.
   */
  it("ignores lead-ins that are not canvas copy", () => {
    const text = [
      "Subject: Water in your home? Here's the next clear step.",
      "Platform: Meta (Facebook/Instagram), geo-capped to Cook County",
      "Note: this needs your approval first",
      "Preheader: A quick pre-winter check",
      "Primary text: We slow the situation down.",
    ].join("\n");
    expect(extractCanvasCopy(text)).toEqual([]);
  });

  it("returns every option when Arc gives a choice", () => {
    // "Write three headline options" is one of the pane's own quick asks, so
    // three labelled lines is the common reply, not an edge case.
    const text = [
      'Headline: "Ready before the next storm."',
      'Headline: "Storm season starts before the storm."',
      'Headline: "One check now. No scramble later."',
    ].join("\n");
    expect(extractCanvasCopy(text)).toHaveLength(3);
  });

  it("collapses a value the card preview restates from the body", () => {
    const text = 'Headline: "Ready before the storm"\n\nHeadline: "ready before the storm"';
    expect(extractCanvasCopy(text)).toHaveLength(1);
  });

  /**
   * `card.preview` is a 280-character PREFIX and joins fields with " / ", so a
   * real one severs the field AFTER the headline, not the headline. Taking the
   * quoted span recovers the whole thing; treating the line as one value would
   * paste the wreckage of the next field onto the ad. This is the exact string
   * shape found on prod.
   */
  it("recovers a whole headline from a preview cut after it", () => {
    expect(extractCanvasCopy('Headline: "Water damage? We slow the situation down." / Prim')).toEqual([
      { field: "headline", value: "Water damage? We slow the situation down." },
    ]);
  });

  /** With no closing quote there is nothing to rescue — an ellipsis means the
   *  cut landed inside the value itself. */
  it("drops a value the cut landed inside", () => {
    expect(extractCanvasCopy("Headline: Ready before the next…")).toEqual([]);
    expect(extractCanvasCopy("Headline: Ready before the next...")).toEqual([]);
  });

  it("drops a paragraph that happens to carry a label", () => {
    const long = "Headline: " + "word ".repeat(60);
    expect(extractCanvasCopy(long)).toEqual([]);
  });

  it("finds nothing in ordinary prose, rather than guessing a sentence", () => {
    const prose = "I'd lead with the storm timing — it's the thing that makes someone act this week rather than next month.";
    expect(extractCanvasCopy(prose)).toEqual([]);
  });

  it("ignores a label with nothing after it", () => {
    expect(extractCanvasCopy("Headline:")).toEqual([]);
    expect(extractCanvasCopy('Headline: ""')).toEqual([]);
  });
});
