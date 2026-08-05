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
 * The font path must not be bundler-rewritable, and the .ttf must be declared
 * into the lambda.
 *
 * The previous guard here asserted the OPPOSITE — that the path went through
 * `new URL(..., import.meta.url)` — because that expression was believed to be
 * what got the fonts traced. It is what broke them. Turbopack rewrites
 * `new URL(<path>, import.meta.url)` into its own asset reference, which is not
 * a `file:` URL, so `fileURLToPath` threw on it either way:
 *
 *   the object  -> "must be ... an instance of URL. Received an instance of URL"
 *   `.href`     -> "TypeError: Invalid URL" (at new URL, inside fileURLToPath)
 *
 * Both took down Studio's Generate button AND Arc's compose_creative tool, and
 * neither was visible to this suite: vitest runs unbundled, so every test above
 * loads real font bytes no matter which form is used. That is exactly why the
 * assertions below are on the SOURCE and on next.config.ts. The environment that
 * distinguishes these forms cannot be executed here, and a guard that can only
 * be wrong in production is still worth more than no guard at all.
 */
describe("fonts are read by a path the bundler cannot rewrite", () => {
  const raw = readFileSync(join(__dirname, "fonts.ts"), "utf8");
  // Comments only, stripped: the doc comment above readFont NAMES the broken
  // forms so the next reader knows why they are forbidden, and a guard that
  // matched its own explanation would forbid explaining it.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const config = readFileSync(join(__dirname, "..", "..", "..", "..", "next.config.ts"), "utf8");

  it("does not build the path from import.meta.url", () => {
    expect(source).not.toMatch(/import\.meta\.url/);
    expect(source).not.toMatch(/fileURLToPath/);
  });

  it("uses the documented process.cwd() + join form", () => {
    expect(source).toMatch(/join\(\s*process\.cwd\(\)/);
  });

  /**
   * Without this the fonts are simply absent from the lambda: nft resolves `fs`
   * usage statically and the filename here is chosen at runtime from the brand
   * kit, so nothing can infer it. The two must agree — a moved font directory
   * that updates only one of them fails in production and nowhere else.
   */
  it("declares the font directory into the trace, at the path fonts.ts reads", () => {
    expect(config).toMatch(/outputFileTracingIncludes/);
    const dir = raw.match(/const FONT_DIR = "([^"]+)"/)?.[1];
    expect(dir).toBeTruthy();
    expect(config).toContain(dir!);
  });
});
