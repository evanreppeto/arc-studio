import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { DEFAULT_BODY_FONT, DEFAULT_HEADING_FONT, resolveBrandFont, type BrandTokens } from "@/domain";

/** A font entry in the shape `ImageResponse` expects. */
export type LoadedFont = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };

/** Where the .ttf files sit, from the project root. Paired with the
 *  `outputFileTracingIncludes` entry in next.config.ts that puts them in the
 *  lambda — change one and you must change the other. */
const FONT_DIR = "src/lib/media/compose/fonts";

/**
 * Read a bundled font.
 *
 * `process.cwd()` + `join`, which is the pattern Next's own ImageResponse docs
 * use, and deliberately NOT `new URL(..., import.meta.url)`.
 *
 * That URL form was here to get the .ttf traced into the lambda, and it is what
 * took the whole compose path down on prod. Turbopack rewrites
 * `new URL(<path>, import.meta.url)` into its own asset reference, and the result
 * is not a `file:` URL — so `fileURLToPath` rejected it. Both symptoms were the
 * same cause, one line apart:
 *
 *   passing the object  -> "must be of type string or an instance of URL.
 *                           Received an instance of URL"   (a foreign URL class)
 *   passing `.href`     -> "TypeError: Invalid URL"        at new URL, inside
 *                           fileURLToPath (the href was not a file: URL)
 *
 * Tracing is now DECLARED in next.config.ts instead of inferred, which is the
 * documented fix and the honest one: nft analyses `fs` usage statically, and the
 * path below is chosen at runtime from the brand kit, so no analysis could ever
 * have resolved it. The old form only appeared to work.
 *
 * Nothing here is bundler-rewritable, which is the point.
 */
async function readFont(relative: string): Promise<Buffer> {
  return readFile(join(process.cwd(), FONT_DIR, relative));
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
