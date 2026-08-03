import { describe, expect, it } from "vitest";

import {
  CREATIVE_DESIGN_WIDTH,
  CREATIVE_LAYOUTS,
  CREATIVE_TEMPLATE_IDS,
  creativeScale,
} from "../index";

describe("creative layout spec", () => {
  it("covers every template the picker offers", () => {
    for (const id of CREATIVE_TEMPLATE_IDS) {
      expect(CREATIVE_LAYOUTS[id], `no layout for ${id}`).toBeDefined();
    }
    expect(Object.keys(CREATIVE_LAYOUTS).sort()).toEqual([...CREATIVE_TEMPLATE_IDS].sort());
  });

  // The whole mechanism: the renderer scales by dims.width/1080 and the canvas by
  // artboardWidth/1080. Same function, two inputs — that is what keeps the
  // preview and the export in proportion.
  it("scales design units the way both consumers do", () => {
    expect(creativeScale(CREATIVE_DESIGN_WIDTH)).toBe(1);
    expect(creativeScale(1920)).toBeCloseTo(1920 / 1080);
    expect(CREATIVE_LAYOUTS.bold.headline.size * creativeScale(1920)).toBeCloseTo(78 * (1920 / 1080));
  });

  // These are the values the templates were carrying as literals. Pinning them
  // means a layout change has to be deliberate rather than a drifting edit to
  // one of the two renderers — which is exactly how they diverged before.
  it("pins the geometry the templates render", () => {
    expect(CREATIVE_LAYOUTS.bold).toMatchObject({
      copyInset: { left: 56, right: 56, bottom: 56 },
      logoPosition: { top: 56, left: 56 },
      headline: { size: 78, lineHeight: 1.05, clampLines: 3 },
      cta: { style: "filled", radius: 16 },
      scrim: { heightRatio: 0.62 },
    });
    expect(CREATIVE_LAYOUTS.editorial).toMatchObject({
      rail: { width: 16 },
      topBand: { padTop: 56, padLeft: 64 },
      headline: { size: 70 },
      cta: { style: "outline", borderWidth: 3 },
    });
    expect(CREATIVE_LAYOUTS.minimal).toMatchObject({
      panel: { widthRatio: 0.5, pad: 64 },
      headline: { size: 64 },
      divider: { width: 64, height: 4 },
      cta: { style: "filled" },
    });
  });

  // Every template needs the pieces both renderers unconditionally read.
  it("gives each template the parts both renderers require", () => {
    for (const id of CREATIVE_TEMPLATE_IDS) {
      const layout = CREATIVE_LAYOUTS[id];
      expect(layout.headline.size, id).toBeGreaterThan(0);
      expect(layout.kicker.size, id).toBeGreaterThan(0);
      expect(layout.cta.size, id).toBeGreaterThan(0);
      expect(layout.logo.fallbackSize, id).toBeGreaterThan(0);
      expect(layout.copyInset.left, id).toBeGreaterThan(0);
      // A filled CTA needs a background; an outline one needs a border.
      if (layout.cta.style === "filled") expect(layout.cta.background, id).toBeDefined();
      else expect(layout.cta.borderWidth, id).toBeDefined();
    }
  });
});
