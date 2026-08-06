import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BRAND_FONTS,
  DEFAULT_BODY_FONT,
  DEFAULT_HEADING_FONT,
  isCatalogFont,
  resolveBrandFont,
} from "@/domain/brand-fonts";

const FONT_DIR = fileURLToPath(new URL("../../lib/media/compose/fonts/", import.meta.url));

/**
 * The guard the whole catalog exists for.
 *
 * A family listed in BRAND_FONTS without its static files on disk renders
 * correctly in the app (the browser has webfonts) and silently falls back to
 * something else in generated creative — and the operator approving that ad
 * never sees the substitution. Offering a font we cannot draw is worse than
 * offering fewer fonts.
 */
describe("every offered font is one the renderer can actually draw", () => {
  it.each(BRAND_FONTS)("$label ships both static weights", (font) => {
    for (const file of [font.files.regular, font.files.bold]) {
      const path = `${FONT_DIR}${file}`;
      expect(existsSync(path), `${font.label}: ${file} is missing from ${FONT_DIR}`).toBe(true);
      // A truncated or LFS-pointer file would pass existsSync and fail at render.
      expect(statSync(path).size, `${font.label}: ${file} is too small to be a real font`).toBeGreaterThan(20_000);
    }
  });

  it("never points two families at the same file pair", () => {
    const pairs = BRAND_FONTS.map((f) => `${f.files.regular}|${f.files.bold}`);
    expect(new Set(pairs).size).toBe(BRAND_FONTS.length);
  });

  it("uses distinct files for regular and bold, so bold is genuinely bolder", () => {
    for (const font of BRAND_FONTS) {
      expect(font.files.regular, `${font.label} reuses one file for both weights`).not.toBe(font.files.bold);
    }
  });

  it("offers a real choice across categories", () => {
    const categories = new Set(BRAND_FONTS.map((f) => f.category));
    expect(categories.size).toBeGreaterThanOrEqual(3);
    expect(BRAND_FONTS.length).toBeGreaterThanOrEqual(6);
  });

  it("has ids that are unique and defaults that exist", () => {
    expect(new Set(BRAND_FONTS.map((f) => f.id)).size).toBe(BRAND_FONTS.length);
    expect(BRAND_FONTS.some((f) => f.id === DEFAULT_HEADING_FONT)).toBe(true);
    expect(BRAND_FONTS.some((f) => f.id === DEFAULT_BODY_FONT)).toBe(true);
  });
});

describe("resolveBrandFont", () => {
  it("resolves an exact catalog id", () => {
    expect(resolveBrandFont("Oswald", DEFAULT_BODY_FONT).id).toBe("Oswald");
  });

  it("is case-insensitive on the family name", () => {
    expect(resolveBrandFont("space grotesk", DEFAULT_BODY_FONT).id).toBe("Space Grotesk");
  });

  it("falls back for a blank value", () => {
    expect(resolveBrandFont("", "Inter").id).toBe("Inter");
    expect(resolveBrandFont(null, "Inter").id).toBe("Inter");
  });

  // The column was free text long before the picker existed, and Arc's
  // brand-profile route still writes arbitrary strings into it. Existing rows
  // must not all snap to the default the day the catalog ships.
  it("keeps the serif-ness of a legacy value naming a font we don't bundle", () => {
    expect(resolveBrandFont("Fraunces", "Inter").category).toBe("Serif");
    expect(resolveBrandFont("Geist", "Source Serif").category).toBe("Sans");
  });

  it("always returns a font that has files, whatever it is handed", () => {
    for (const value of ["", "  ", "Comic Sans", "Fraunces", "Wingdings", "Inter"]) {
      const font = resolveBrandFont(value, DEFAULT_BODY_FONT);
      expect(font.files.regular.length).toBeGreaterThan(0);
      expect(BRAND_FONTS).toContain(font);
    }
  });
});

describe("isCatalogFont", () => {
  it("separates a picked font from legacy free text", () => {
    expect(isCatalogFont("Playfair Display")).toBe(true);
    expect(isCatalogFont("Fraunces")).toBe(false);
    expect(isCatalogFont("")).toBe(false);
  });
});
