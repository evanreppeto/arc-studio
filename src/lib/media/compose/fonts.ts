import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { DEFAULT_BODY_FONT, DEFAULT_HEADING_FONT, resolveBrandFont, type BrandTokens } from "@/domain";

/** A font entry in the shape `ImageResponse` expects. */
export type LoadedFont = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };

/** Read a bundled font. `new URL(..., import.meta.url)` lets Next's file tracer
 *  bundle the `.ttf` for the route at build time (a bare cwd path would not be traced). */
async function readFont(relative: string): Promise<Buffer> {
  return readFile(fileURLToPath(new URL(`./fonts/${relative}`, import.meta.url)));
}

/**
 * Load two logical families — "Heading" (700) and "Body" (400) — from the actual
 * typeface the workspace chose. Templates always reference fontFamily
 * "Heading" / "Body".
 *
 * This used to pick between exactly two files via a serif/sans guess on the font
 * name, which meant every workspace's creative rendered as Inter or one serif no
 * matter what their brand kit said. `resolveBrandFont` maps the stored value to
 * a family we ship both static weights for, and still honours the old
 * serif-or-sans behaviour for legacy free-text values naming fonts we don't
 * bundle — see brand-fonts.ts.
 */
export async function loadCreativeFonts(brand: BrandTokens): Promise<LoadedFont[]> {
  const heading = resolveBrandFont(brand.headingFont, DEFAULT_HEADING_FONT);
  const body = resolveBrandFont(brand.bodyFont, DEFAULT_BODY_FONT);
  return [
    { name: "Heading", data: await readFont(heading.files.bold), weight: 700, style: "normal" },
    { name: "Body", data: await readFont(body.files.regular), weight: 400, style: "normal" },
  ];
}
