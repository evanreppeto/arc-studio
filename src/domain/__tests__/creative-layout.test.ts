import { describe, expect, it } from "vitest";

import {
  COPY_NUDGE_LIMIT,
  CREATIVE_DESIGN_WIDTH,
  CREATIVE_LAYOUTS,
  CREATIVE_TEMPLATE_IDS,
  HEADLINE_SCALE_RANGE,
  LOGO_NUDGE_LIMIT,
  LOGO_ROTATE_LIMIT,
  LOGO_SCALE_RANGE,
  clampLayoutOverride,
  isLogoPlaced,
  logoTransform,
  creativeScale,
  withLayoutOverride,
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
      panel: { widthRatio: 0.5, padLeft: 64, padBottom: 64 },
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

describe("layout overrides (constrained canvas editing)", () => {
  it("clamps a nudge to the allowed range", () => {
    expect(clampLayoutOverride({ copyDx: 9999, copyDy: -9999 })).toMatchObject({
      copyDx: COPY_NUDGE_LIMIT,
      copyDy: -COPY_NUDGE_LIMIT,
    });
    expect(clampLayoutOverride({ headlineScale: 12 }).headlineScale).toBe(HEADLINE_SCALE_RANGE.max);
    expect(clampLayoutOverride({ headlineScale: 0 }).headlineScale).toBe(HEADLINE_SCALE_RANGE.min);
  });

  // A client can send anything; the renderer clamps the same values the canvas did.
  it("refuses NaN and undefined rather than propagating them into CSS", () => {
    expect(clampLayoutOverride({ copyDx: Number.NaN }).copyDx).toBe(0);
    expect(clampLayoutOverride({ logoRotate: Number.NaN }).logoRotate).toBe(0);
    expect(clampLayoutOverride(undefined)).toEqual({
      copyDx: 0,
      copyDy: 0,
      headlineScale: 1,
      logoDx: 0,
      logoDy: 0,
      logoScale: 1,
      logoRotate: 0,
    });
  });

  it("returns the layout untouched when nothing was moved", () => {
    expect(withLayoutOverride(CREATIVE_LAYOUTS.bold, {})).toBe(CREATIVE_LAYOUTS.bold);
    expect(withLayoutOverride(CREATIVE_LAYOUTS.bold, { copyDx: 0, headlineScale: 1 })).toBe(CREATIVE_LAYOUTS.bold);
  });

  // Down is down in every template, whichever edge it anchors to — that is the
  // whole reason the override is applied centrally instead of per renderer.
  it("moves the copy down for a positive dy on a bottom-anchored template", () => {
    const moved = withLayoutOverride(CREATIVE_LAYOUTS.bold, { copyDy: 40 });
    expect(moved.copyInset.bottom).toBe(CREATIVE_LAYOUTS.bold.copyInset.bottom! - 40);
  });

  it("moves the copy down for a positive dy on a top-anchored template", () => {
    const moved = withLayoutOverride(CREATIVE_LAYOUTS.editorial, { copyDy: 40 });
    expect(moved.topBand!.padTop).toBe(CREATIVE_LAYOUTS.editorial.topBand!.padTop + 40);
  });

  it("moves the copy down inside the side panel too", () => {
    const moved = withLayoutOverride(CREATIVE_LAYOUTS.minimal, { copyDy: 40, copyDx: 10 });
    expect(moved.panel!.padBottom).toBe(CREATIVE_LAYOUTS.minimal.panel!.padBottom - 40);
    expect(moved.panel!.padLeft).toBe(CREATIVE_LAYOUTS.minimal.panel!.padLeft + 10);
  });

  it("scales the headline and leaves every other size alone", () => {
    const scaled = withLayoutOverride(CREATIVE_LAYOUTS.bold, { headlineScale: 1.5 });
    expect(scaled.headline.size).toBe(CREATIVE_LAYOUTS.bold.headline.size * 1.5);
    expect(scaled.kicker.size).toBe(CREATIVE_LAYOUTS.bold.kicker.size);
    expect(scaled.cta.size).toBe(CREATIVE_LAYOUTS.bold.cta.size);
  });

  it("never mutates the shared spec", () => {
    const before = JSON.stringify(CREATIVE_LAYOUTS);
    withLayoutOverride(CREATIVE_LAYOUTS.minimal, { copyDx: 99, copyDy: 99, headlineScale: 1.4 });
    withLayoutOverride(CREATIVE_LAYOUTS.editorial, { copyDx: -99, copyDy: -99 });
    expect(JSON.stringify(CREATIVE_LAYOUTS)).toBe(before);
  });
});

describe("subhead slot", () => {
  it("every template can carry one", () => {
    for (const id of CREATIVE_TEMPLATE_IDS) {
      expect(CREATIVE_LAYOUTS[id].subhead.size, id).toBeGreaterThan(0);
      expect(CREATIVE_LAYOUTS[id].subhead.clampLines, id).toBeGreaterThan(0);
    }
  });

  // It reads as support, not as a second headline.
  it("is smaller than the headline on every template", () => {
    for (const id of CREATIVE_TEMPLATE_IDS) {
      expect(CREATIVE_LAYOUTS[id].subhead.size, id).toBeLessThan(CREATIVE_LAYOUTS[id].headline.size);
    }
  });

  // Scaling the headline alone would break the type relationship the template
  // was designed around, so the subhead rides the same multiplier.
  it("scales with the headline", () => {
    const scaled = withLayoutOverride(CREATIVE_LAYOUTS.bold, { headlineScale: 1.5 });
    expect(scaled.subhead.size).toBe(CREATIVE_LAYOUTS.bold.subhead.size * 1.5);
    expect(scaled.kicker.size).toBe(CREATIVE_LAYOUTS.bold.kicker.size);
  });
});

/**
 * Free logo placement.
 *
 * The templates pinned the mark — bold to a corner, editorial and minimal into a
 * flowed foot row — and the app explained that as a rule: your logo "can't" go on
 * the van panel. It was never a rule. What generation enforces is that the MODEL
 * must not draw your mark (it renders a garbled counterfeit), which is a reason
 * the model can't draw it, not a reason your real file can't sit there.
 *
 * Expressed as a TRANSFORM so all three templates honour it without
 * restructuring, and computed by one function so the preview and the export
 * cannot disagree — the BSR-679 property.
 */
describe("logo placement", () => {
  it("is untouched by default, so a template renders exactly as before", () => {
    expect(logoTransform(undefined, (n) => `${n}px`)).toBeNull();
    expect(logoTransform({ logoDx: 0, logoScale: 1, logoRotate: 0 }, (n) => `${n}px`)).toBeNull();
    expect(isLogoPlaced(undefined)).toBe(false);
  });

  it("reaches the middle of the frame, which a copy-block nudge cannot", () => {
    // The whole point: 56px from the corner cannot reach a van panel mid-frame.
    expect(LOGO_NUDGE_LIMIT).toBeGreaterThanOrEqual(CREATIVE_DESIGN_WIDTH);
    expect(clampLayoutOverride({ logoDx: 500 }).logoDx).toBe(500);
  });

  it("orders the transform translate → rotate → scale", () => {
    // Order is load-bearing: rotate-then-translate would swing a placed mark off
    // the surface it was dragged onto.
    const out = logoTransform({ logoDx: 10, logoDy: -4, logoScale: 2, logoRotate: 12 }, (n) => `${n}px`);
    expect(out?.transform).toBe("translate(10px, -4px) rotate(12deg) scale(2)");
    expect(out?.transformOrigin).toBe("center");
  });

  it("renders in the caller's own units, so preview and export agree", () => {
    // Same numbers, two unit spaces — px for the exporter, cqw for the canvas.
    expect(logoTransform({ logoDx: 108 }, (n) => `${n}px`)?.transform).toContain("108px");
    expect(logoTransform({ logoDx: 108 }, (n) => `calc(${n} / 1080 * 100cqw)`)?.transform).toContain("100cqw");
  });

  it("clamps a placement that arrived from a client", () => {
    expect(clampLayoutOverride({ logoScale: 99 }).logoScale).toBe(LOGO_SCALE_RANGE.max);
    expect(clampLayoutOverride({ logoRotate: -9999 }).logoRotate).toBe(-LOGO_ROTATE_LIMIT);
  });
});
