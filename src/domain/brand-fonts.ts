/**
 * The typefaces a workspace can choose for its brand — pure catalog + resolution,
 * no I/O.
 *
 * The hard rule this module exists to enforce: **every font offered here is one
 * the creative renderer can actually draw.** `loadCreativeFonts` reads a static
 * .ttf per family from `src/lib/media/compose/fonts/`, so a family listed here
 * without those files on disk would look right in the app and silently render as
 * something else in the ad, email or landing page Arc generates — the operator
 * approving that creative would never see the substitution. `fontFiles` is the
 * single source of truth for both sides, and a test walks it against the
 * directory so the two cannot drift.
 */

export type BrandFontCategory = "Sans" | "Serif" | "Display";

export type BrandFont = {
  /**
   * The value stored in `brandPalette.headingFont` / `bodyFont`. Stable — these
   * strings are already in tenant rows, so renaming one silently re-fonts a
   * workspace. Deliberately the human family name rather than a slug, because
   * that is what the pre-existing free-text column already held.
   */
  id: string;
  label: string;
  category: BrandFontCategory;
  /** When to reach for it, in the operator's terms. */
  hint: string;
  /** CSS stack for previewing the choice in-app. */
  stack: string;
  /** Static instances the renderer loads. Regular = 400, Bold = 700. */
  files: { regular: string; bold: string };
};

export const BRAND_FONTS: BrandFont[] = [
  {
    id: "Inter",
    label: "Inter",
    category: "Sans",
    hint: "Neutral and highly legible. A safe default that never fights your message.",
    stack: 'var(--bf-inter), system-ui, sans-serif',
    files: { regular: "Inter-Regular.ttf", bold: "Inter-Bold.ttf" },
  },
  {
    id: "DM Sans",
    label: "DM Sans",
    category: "Sans",
    hint: "Warm and geometric. Friendly without being casual.",
    stack: 'var(--bf-dm-sans), system-ui, sans-serif',
    files: { regular: "DMSans-Regular.ttf", bold: "DMSans-Bold.ttf" },
  },
  {
    id: "Space Grotesk",
    label: "Space Grotesk",
    category: "Sans",
    hint: "Modern and a little technical. Reads as precise and current.",
    stack: 'var(--bf-space-grotesk), system-ui, sans-serif',
    files: { regular: "SpaceGrotesk-Regular.ttf", bold: "SpaceGrotesk-Bold.ttf" },
  },
  {
    id: "Source Serif",
    label: "Source Serif",
    category: "Serif",
    hint: "A readable serif for longer copy. Calm and established.",
    stack: 'var(--bf-source-serif), Georgia, serif',
    files: { regular: "Serif-Regular.ttf", bold: "Serif-Bold.ttf" },
  },
  {
    id: "Playfair Display",
    label: "Playfair Display",
    category: "Serif",
    hint: "High contrast and premium. Strong for headlines, hard work for body copy.",
    stack: 'var(--bf-playfair), Georgia, serif',
    files: { regular: "PlayfairDisplay-Regular.ttf", bold: "PlayfairDisplay-Bold.ttf" },
  },
  {
    id: "Oswald",
    label: "Oswald",
    category: "Display",
    hint: "Condensed and loud. Built for short headlines that have to carry an ad.",
    stack: 'var(--bf-oswald), Impact, sans-serif',
    files: { regular: "Oswald-Regular.ttf", bold: "Oswald-Bold.ttf" },
  },
];

export const DEFAULT_HEADING_FONT = "Source Serif";
export const DEFAULT_BODY_FONT = "Inter";

/** Serif hints for legacy free-text values — see resolveBrandFont. */
const LEGACY_SERIF_HINTS = ["serif", "fraunces", "georgia", "times", "playfair", "garamond", "merriweather", "lora"];

/**
 * Resolve a stored font value to a font we can actually render.
 *
 * Three tiers, and the third is the reason this isn't a lookup:
 *
 * 1. An exact catalog id (what the picker writes).
 * 2. A case-insensitive label match, so "inter" and "Inter" agree.
 * 3. **Legacy free text.** `headingFont`/`bodyFont` were a free-text column long
 *    before there was a picker — Arc's brand-profile route writes arbitrary
 *    strings into them, and existing rows hold values like "Fraunces" or "Geist"
 *    that name fonts we have no files for. Those must keep resolving to
 *    something sensible rather than snapping every existing workspace to the
 *    default, so we fall back to the old serif/sans heuristic the renderer used
 *    before the catalog existed.
 */
export function resolveBrandFont(value: string | null | undefined, fallbackId: string): BrandFont {
  const fallback = BRAND_FONTS.find((f) => f.id === fallbackId) ?? BRAND_FONTS[0];
  const raw = (value ?? "").trim();
  if (raw.length === 0) return fallback;

  const exact = BRAND_FONTS.find((f) => f.id === raw);
  if (exact) return exact;

  const lower = raw.toLowerCase();
  const byLabel = BRAND_FONTS.find((f) => f.label.toLowerCase() === lower || f.id.toLowerCase() === lower);
  if (byLabel) return byLabel;

  // Legacy value naming a font we don't bundle: keep its serif-ness, which is
  // the part that actually changes how the creative reads.
  const wantsSerif = LEGACY_SERIF_HINTS.some((hint) => lower.includes(hint));
  const category: BrandFontCategory = wantsSerif ? "Serif" : "Sans";
  return BRAND_FONTS.find((f) => f.category === category) ?? fallback;
}

/** True when the stored value names a font in the catalog (vs. legacy free text). */
export function isCatalogFont(value: string | null | undefined): boolean {
  const raw = (value ?? "").trim().toLowerCase();
  return raw.length > 0 && BRAND_FONTS.some((f) => f.id.toLowerCase() === raw);
}
