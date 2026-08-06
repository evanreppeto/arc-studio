import { describe, expect, it } from "vitest";

import { wantsBrandingInScene } from "./logo-hint";

/**
 * The note this gates says Arc cannot paint a logo onto an object in a generated
 * scene. It was firing on any message containing `logo|…|sign|text|words|caption`,
 * which made it appear on requests the limit does not apply to — and, because it
 * keyed off the OPERATOR's message and rendered below the pending bubble, it
 * appeared before Arc had said anything. Reported as: "what is this? It appears
 * before Arc even has a moment to respond."
 *
 * The asymmetry that shapes every case below: a MISS costs nothing, because Arc
 * explains itself in its own reply. A FALSE POSITIVE lectures the operator about
 * a constraint that has nothing to do with what they asked.
 */
describe("wantsBrandingInScene", () => {
  it("fires on a logo asked for on a surface in the scene", () => {
    // Both of these are real prompts from this workspace's chat history.
    expect(wantsBrandingInScene("Put our logo on the side of the car please")).toBe(true);
    expect(wantsBrandingInScene("Add our logo to to the side of the truck")).toBe(true);
  });

  it("catches the other surfaces people actually name", () => {
    expect(wantsBrandingInScene("can you get our branding onto the van door")).toBe(true);
    expect(wantsBrandingInScene("put the wordmark on a billboard behind them")).toBe(true);
    expect(wantsBrandingInScene("our signage over the building entrance")).toBe(true);
  });

  /**
   * The reported bug. These are canvas-text requests, which Studio's own copy
   * fields handle — nothing to do with what image generation strips.
   */
  it("stays quiet on requests about the canvas copy", () => {
    expect(wantsBrandingInScene("rewrite the text shorter and punchier")).toBe(false);
    expect(wantsBrandingInScene("add a caption under the headline")).toBe(false);
    expect(wantsBrandingInScene("write three headline options for this ad")).toBe(false);
    expect(wantsBrandingInScene("make the words bigger")).toBe(false);
  });

  /**
   * Arc DOES do this — it composites the real Brand kit logo as a corner lockup
   * on every creative it renders. Warning here would contradict the product.
   */
  it("stays quiet when the logo is simply asked for, which Arc delivers", () => {
    expect(wantsBrandingInScene("Add our real logo")).toBe(false);
    expect(wantsBrandingInScene("include the logo please")).toBe(false);
  });

  it("stays quiet on ordinary creative requests", () => {
    expect(wantsBrandingInScene("make a few on-brand variations of this creative")).toBe(false);
    expect(wantsBrandingInScene("a clean service van in a driveway on a bright morning")).toBe(false);
    expect(wantsBrandingInScene("")).toBe(false);
  });

  /** A surface with no brand mark is just a scene description. */
  it("needs the brand mark, not merely a vehicle", () => {
    expect(wantsBrandingInScene("put the van in the driveway")).toBe(false);
  });

  /** ...and a brand mark with no placement is the corner lockup Arc adds. */
  it("needs the placement, not merely the word logo", () => {
    expect(wantsBrandingInScene("logo")).toBe(false);
  });
});
