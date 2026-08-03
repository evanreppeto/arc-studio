/**
 * Creative compositing — pure, industry-agnostic logic. No I/O. Owns the output
 * formats, how a workspace's Brand Kit maps to render tokens, and which layout
 * template a given creative uses. Consumed by the server-only renderer in
 * `src/lib/media/compose/` and the `/api/v1/arc/media/compose` route.
 */
import type { BusinessProfile } from "./brand-kit";

export type CreativeFormat = "1:1" | "4:5" | "9:16" | "16:9";
export type CreativeTemplateId = "bold" | "editorial" | "minimal";
export type CreativeDimensions = { width: number; height: number };

export type CreativeCopy = {
  headline: string;
  kicker?: string;
  /** Optional supporting line under the headline — an offer or qualifier
   *  ("Free assessment · same-week scheduling"). Renders only when set, like
   *  the kicker, so a creative that doesn't want one is unchanged (BSR-691). */
  subhead?: string;
  ctaLabel?: string;
};

/** Flattened, render-ready brand values pulled from a Brand Kit (or neutral defaults). */
export type BrandTokens = {
  primary: string;
  secondary: string;
  accent: string;
  dark: string;
  light: string;
  headingFont: string;
  bodyFont: string;
  logoUrl: string | null;
  shortMark: string;
  displayName: string;
};

export const CREATIVE_TEMPLATE_IDS: CreativeTemplateId[] = ["bold", "editorial", "minimal"];

export const CREATIVE_DIMENSIONS: Record<CreativeFormat, CreativeDimensions> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
};

export function normalizeCreativeFormat(raw: string | null | undefined): CreativeFormat {
  const r = (raw ?? "").trim().toLowerCase();
  if (r === "1:1" || r === "square") return "1:1";
  if (r === "4:5" || r === "portrait") return "4:5";
  if (r === "9:16" || r === "story" || r === "vertical") return "9:16";
  if (r === "16:9" || r === "landscape") return "16:9";
  return "1:1";
}

/** Pick a layout: a valid hint wins; otherwise a deterministic hash of the seed
 *  spreads picks across templates so consecutive creatives don't repeat. */
export function selectCreativeTemplate(input: { hint?: string | null; seed?: string }): CreativeTemplateId {
  const hint = input.hint?.trim().toLowerCase();
  if (hint && (CREATIVE_TEMPLATE_IDS as string[]).includes(hint)) {
    return hint as CreativeTemplateId;
  }
  const seed = input.seed ?? "";
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return CREATIVE_TEMPLATE_IDS[h % CREATIVE_TEMPLATE_IDS.length];
}

const SERIF_HINTS = [
  "serif", "georgia", "times", "garamond", "playfair", "lora",
  "merriweather", "source serif", "pt serif", "slab",
];

/** Map an arbitrary brand font name to one of our two bundled font roles. */
export function resolveFontRole(font: string | null | undefined): "sans" | "serif" {
  const f = (font ?? "").toLowerCase();
  return SERIF_HINTS.some((h) => f.includes(h)) ? "serif" : "sans";
}

const NEUTRAL_TOKENS: BrandTokens = {
  primary: "#16181d",
  secondary: "#3b3f47",
  accent: "#C8A24B",
  dark: "#0f1115",
  light: "#f5f3ee",
  headingFont: "sans-serif",
  bodyFont: "sans-serif",
  logoUrl: null,
  shortMark: "—",
  displayName: "Your Brand",
};

const pick = (hex: string | undefined, fallback: string) => (hex && hex.trim() ? hex : fallback);

/** Flatten a Brand Kit into render tokens, falling back to neutral defaults. */
export function toBrandTokens(profile: BusinessProfile | null): BrandTokens {
  if (!profile) return { ...NEUTRAL_TOKENS };
  const p = profile.brandPalette;
  const mark =
    (profile.shortMark && profile.shortMark.trim()) ||
    (profile.displayName ? profile.displayName.slice(0, 3).toUpperCase() : NEUTRAL_TOKENS.shortMark);
  return {
    primary: pick(p?.primary?.hex, NEUTRAL_TOKENS.primary),
    secondary: pick(p?.secondary?.hex, NEUTRAL_TOKENS.secondary),
    accent: pick(p?.accent?.hex, pick(profile.accent, NEUTRAL_TOKENS.accent)),
    dark: pick(p?.dark?.hex, NEUTRAL_TOKENS.dark),
    light: pick(p?.light?.hex, NEUTRAL_TOKENS.light),
    headingFont: pick(p?.headingFont, NEUTRAL_TOKENS.headingFont),
    bodyFont: pick(p?.bodyFont, NEUTRAL_TOKENS.bodyFont),
    logoUrl: profile.logoUrl ?? null,
    shortMark: mark,
    displayName: pick(profile.displayName, NEUTRAL_TOKENS.displayName),
  };
}
