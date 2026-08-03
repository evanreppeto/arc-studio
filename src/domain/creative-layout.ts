/**
 * Geometry and type scale for the creative templates — the single source both
 * renderers derive from. Pure data, no I/O, no React.
 *
 * Studio had two independent implementations of the same design: a hand-built
 * CSS preview in `studio-view.tsx` and Satori templates in
 * `src/lib/media/compose/templates/`. Nothing kept them in sync, and the
 * template picker didn't reach the preview at all — so choosing Minimal left a
 * Bold-shaped preview on screen and exported a Minimal PNG. The operator
 * approved something they had not seen (BSR-679).
 *
 * Every value here is in DESIGN UNITS on a 1080-wide reference canvas, which is
 * how the templates were already written (`u = dims.width / 1080`). A consumer
 * scales by its own width:
 *
 *   renderer: u = dims.width / 1080          → export pixels
 *   canvas:   u = artboardWidthPx / 1080     → preview pixels
 *
 * Same numbers, two scales. That is the whole mechanism.
 */
import type { CreativeTemplateId } from "./creative-templates";

/** Which brand token a layer paints with. Resolved by the consumer, because the
 *  renderer and the preview get their brand values from different places. */
export type BrandColorRef = "primary" | "secondary" | "accent" | "dark" | "light";

export type TextScale = {
  /** Font size in design units. */
  size: number;
  /** Unitless, so it needs no scaling. */
  lineHeight?: number;
  /** Letter spacing in design units; negative tightens. */
  tracking?: number;
  uppercase?: boolean;
  /** Space below this element in design units. */
  marginBottom?: number;
  color: BrandColorRef;
};

export type CtaScale = {
  size: number;
  padX: number;
  padY: number;
  radius: number;
  /** filled = solid accent pill; outline = bordered, transparent. */
  style: "filled" | "outline";
  background?: BrandColorRef;
  color: BrandColorRef;
  borderWidth?: number;
  borderColor?: BrandColorRef;
};

export type LogoScale = {
  /** Rendered logo image box, in design units. */
  width: number;
  height: number;
  /** Type size for the no-logo fallback. */
  fallbackSize: number;
  /** Bold's fallback is a filled chip; the others fall back to plain brand text. */
  fallbackChip?: { padX: number; radius: number; background: BrandColorRef; color: BrandColorRef };
};

export type CreativeLayoutSpec = {
  /** Page background behind the photo. */
  surface: BrandColorRef;
  /** Inset of the copy block from each edge, in design units. Omitted edges are unset. */
  copyInset: { left: number; right: number; bottom?: number; top?: number };
  logo: LogoScale;
  /** Where the logo sits, when it is positioned rather than flowed in a row. */
  logoPosition?: { top: number; left: number };
  kicker: TextScale;
  headline: TextScale & { clampLines: number };
  cta: CtaScale;
  /** Bottom gradient for legibility: height as a fraction of the canvas height. */
  scrim?: { heightRatio: number; solidStop: number; midStop?: number };
  /** Editorial's top band behind the headline. */
  topBand?: { padTop: number; padBottom: number; padLeft: number; padRight: number; solidStop: number };
  /** Editorial's accent rail down the left edge. */
  rail?: { width: number; color: BrandColorRef };
  /** Minimal's solid side panel. */
  panel?: { widthRatio: number; pad: number; background: BrandColorRef };
  /** Minimal's short accent rule between headline and CTA. */
  divider?: { width: number; height: number; marginTop: number; marginBottom: number; color: BrandColorRef };
};

/**
 * Transcribed from the templates as they stood, value for value, so adopting
 * this spec changes no exported pixel. Anything that looks arbitrary here was
 * arbitrary there — the point of this pass is to have ONE copy of it, not to
 * redesign it.
 */
export const CREATIVE_LAYOUTS: Record<CreativeTemplateId, CreativeLayoutSpec> = {
  bold: {
    surface: "dark",
    copyInset: { left: 56, right: 56, bottom: 56 },
    logoPosition: { top: 56, left: 56 },
    logo: {
      width: 300,
      height: 72,
      fallbackSize: 34,
      fallbackChip: { padX: 22, radius: 14, background: "accent", color: "light" },
    },
    kicker: { size: 26, tracking: 2, uppercase: true, marginBottom: 18, color: "accent" },
    headline: { size: 78, lineHeight: 1.05, tracking: -1, marginBottom: 32, clampLines: 3, color: "light" },
    cta: { size: 30, padX: 34, padY: 20, radius: 16, style: "filled", background: "accent", color: "light" },
    scrim: { heightRatio: 0.62, solidStop: 6, midStop: 48 },
  },
  editorial: {
    surface: "dark",
    copyInset: { left: 64, right: 56, bottom: 56 },
    logo: { width: 260, height: 56, fallbackSize: 34 },
    kicker: { size: 24, tracking: 3, uppercase: true, marginBottom: 16, color: "accent" },
    headline: { size: 70, lineHeight: 1.06, tracking: -1, clampLines: 3, color: "light" },
    cta: { size: 28, padX: 28, padY: 16, radius: 12, style: "outline", color: "light", borderWidth: 3, borderColor: "light" },
    scrim: { heightRatio: 0.34, solidStop: 8 },
    topBand: { padTop: 56, padBottom: 64, padLeft: 64, padRight: 56, solidStop: 30 },
    rail: { width: 16, color: "accent" },
  },
  minimal: {
    surface: "primary",
    copyInset: { left: 64, right: 64, bottom: 64, top: 64 },
    logo: { width: 300, height: 64, fallbackSize: 38 },
    kicker: { size: 24, tracking: 3, uppercase: true, marginBottom: 18, color: "accent" },
    headline: { size: 64, lineHeight: 1.1, clampLines: 3, color: "light" },
    cta: { size: 28, padX: 30, padY: 18, radius: 10, style: "filled", background: "accent", color: "primary" },
    panel: { widthRatio: 0.5, pad: 64, background: "primary" },
    divider: { width: 64, height: 4, marginTop: 28, marginBottom: 28, color: "accent" },
  },
};

/** The design-space width every value above is expressed against. */
export const CREATIVE_DESIGN_WIDTH = 1080;

/** Scale factor from design units to a consumer's pixel space. */
export function creativeScale(targetWidth: number): number {
  return targetWidth / CREATIVE_DESIGN_WIDTH;
}
