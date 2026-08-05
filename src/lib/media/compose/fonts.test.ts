import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BRAND_FONTS, type BrandTokens } from "@/domain";

import { loadCreativeFonts } from "./fonts";

const tokens = (headingFont: string, bodyFont: string): BrandTokens =>
  ({ headingFont, bodyFont } as BrandTokens);

/**
 * The join between the picker and the pixels. `loadCreativeFonts` decides which
 * .ttf the creative renderer actually draws with, and every failure mode here is
 * silent: the ad renders, it just renders in the wrong face, and the operator
 * approving it has no way to tell.
 */
describe("loadCreativeFonts", () => {
  it("returns the two logical families the templates reference", async () => {
    const loaded = await loadCreativeFonts(tokens("Oswald", "Inter"));
    expect(loaded.map((f) => f.name)).toEqual(["Heading", "Body"]);
    expect(loaded.map((f) => f.weight)).toEqual([700, 400]);
  });

  it("loads real font bytes, not an empty or placeholder buffer", async () => {
    const loaded = await loadCreativeFonts(tokens("Playfair Display", "DM Sans"));
    for (const font of loaded) {
      expect(font.data.byteLength).toBeGreaterThan(20_000);
      // TrueType files start with 0x00010000; OpenType/CFF with "OTTO".
      const tag = font.data.subarray(0, 4);
      const isTrueType = tag[0] === 0x00 && tag[1] === 0x01 && tag[2] === 0x00 && tag[3] === 0x00;
      const isOpenType = tag.toString("latin1") === "OTTO";
      expect(isTrueType || isOpenType, `unrecognised font header: ${tag.toString("hex")}`).toBe(true);
    }
  });

  // The bug this replaced: every family collapsed to one of two files, so two
  // different brand kits produced byte-identical creative.
  it("gives genuinely different bytes for different chosen families", async () => {
    const oswald = await loadCreativeFonts(tokens("Oswald", "Inter"));
    const playfair = await loadCreativeFonts(tokens("Playfair Display", "Inter"));
    expect(oswald[0].data.equals(playfair[0].data)).toBe(false);
    // ...while the untouched body face stays put.
    expect(oswald[1].data.equals(playfair[1].data)).toBe(true);
  });

  it("can load every family the picker offers", async () => {
    for (const font of BRAND_FONTS) {
      const loaded = await loadCreativeFonts(tokens(font.id, font.id));
      expect(loaded[0].data.byteLength, `${font.label} heading`).toBeGreaterThan(20_000);
      expect(loaded[1].data.byteLength, `${font.label} body`).toBeGreaterThan(20_000);
    }
  });

  it("still renders a legacy free-text value rather than throwing", async () => {
    // "Fraunces" is a real stored value we ship no files for.
    const loaded = await loadCreativeFonts(tokens("Fraunces", "Geist"));
    expect(loaded[0].data.byteLength).toBeGreaterThan(20_000);
    expect(loaded[1].data.byteLength).toBeGreaterThan(20_000);
  });
});

/**
 * The font path has to be handed on as a STRING.
 *
 * Passing the `URL` object works in every test above and fails in production:
 * vitest runs in plain Node, where the global `URL` and the class `node:url`
 * instance-checks against are the same, so both forms load bytes here. In the
 * deployed bundle they are different classes, and the object form throws the
 * self-refuting "must be of type string or an instance of URL. Received an
 * instance of URL" — taking down BOTH compose paths: Studio's Generate button
 * and Arc's `compose_creative` tool. Found by clicking Generate on prod
 * (2026-08-05), not by any of the 5,300 tests.
 *
 * So this is a SOURCE assertion, deliberately. There is no behavioural test that
 * can distinguish the two forms in this runner — the environment that tells them
 * apart is the one we cannot execute here. Asserting on the text is weaker than a
 * real test and is the strongest thing available; the alternative is no guard on
 * a bug that is invisible until an operator clicks the primary button on the page.
 */
describe("font path is passed as a string, not a URL object", () => {
  const source = readFileSync(join(__dirname, "fonts.ts"), "utf8");

  it("never hands a bare URL instance to fileURLToPath", () => {
    // Matches `fileURLToPath(new URL(...))` with no `.href`/String() conversion.
    expect(source).not.toMatch(/fileURLToPath\(\s*new URL\([^)]*\)\s*\)/);
  });

  it("converts the URL to its href before use", () => {
    expect(source).toMatch(/new URL\([^)]*\)\.href/);
  });
});
