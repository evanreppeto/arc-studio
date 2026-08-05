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
  /** The optional supporting line. Present on every template because the copy
   *  is optional, not the slot. */
  subhead: TextScale & { clampLines: number };
  cta: CtaScale;
  /** Bottom gradient for legibility: height as a fraction of the canvas height. */
  scrim?: { heightRatio: number; solidStop: number; midStop?: number };
  /** Editorial's top band behind the headline. */
  topBand?: { padTop: number; padBottom: number; padLeft: number; padRight: number; solidStop: number };
  /** Editorial's accent rail down the left edge. */
  rail?: { width: number; color: BrandColorRef };
  /** Minimal's solid side panel. Paddings are per-edge so a nudge can move the
   *  copy inside it without moving the panel. */
  panel?: { widthRatio: number; padTop: number; padRight: number; padBottom: number; padLeft: number; background: BrandColorRef };
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
    subhead: { size: 34, lineHeight: 1.35, marginBottom: 32, clampLines: 2, color: "light" },
    cta: { size: 30, padX: 34, padY: 20, radius: 16, style: "filled", background: "accent", color: "light" },
    scrim: { heightRatio: 0.62, solidStop: 6, midStop: 48 },
  },
  editorial: {
    surface: "dark",
    copyInset: { left: 64, right: 56, bottom: 56 },
    logo: { width: 260, height: 56, fallbackSize: 34 },
    kicker: { size: 24, tracking: 3, uppercase: true, marginBottom: 16, color: "accent" },
    headline: { size: 70, lineHeight: 1.06, tracking: -1, clampLines: 3, color: "light" },
    subhead: { size: 30, lineHeight: 1.4, marginBottom: 0, clampLines: 2, color: "light" },
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
    subhead: { size: 28, lineHeight: 1.4, marginBottom: 0, clampLines: 2, color: "light" },
    cta: { size: 28, padX: 30, padY: 18, radius: 10, style: "filled", background: "accent", color: "primary" },
    panel: { widthRatio: 0.5, padTop: 64, padRight: 64, padBottom: 64, padLeft: 64, background: "primary" },
    divider: { width: 64, height: 4, marginTop: 28, marginBottom: 28, color: "accent" },
  },
};

/** The design-space width every value above is expressed against. */
export const CREATIVE_DESIGN_WIDTH = 1080;

/** Scale factor from design units to a consumer's pixel space. */
export function creativeScale(targetWidth: number): number {
  return targetWidth / CREATIVE_DESIGN_WIDTH;
}


/**
 * A per-asset nudge on top of a template's layout.
 *
 * Deliberately small. The operator can move the copy block and scale the
 * headline; they cannot reposition arbitrary layers or break out of the
 * template, because the templates are what keep a workspace's creative on
 * brand. Constrained direct manipulation, decided on BSR-680.
 *
 * Units match the spec: design units on the 1080-wide reference canvas.
 */
export type CreativeLayoutOverride = {
  /** Horizontal nudge of the copy block. Positive moves right. */
  copyDx?: number;
  /** Vertical nudge of the copy block. Positive moves DOWN, screen-style, so a
   *  drag and its number agree regardless of which edge the template anchors to. */
  copyDy?: number;
  /** Headline size multiplier. */
  headlineScale?: number;
  /**
   * Where the workspace's REAL logo sits, as an offset from wherever its
   * template puts it — free across the artboard, scalable, rotatable.
   *
   * The templates pinned it: bold to a corner (`logoPosition: {top:56,left:56}`),
   * editorial and minimal inline in a foot row, none of them movable. The app
   * explained that as a rule — your logo "can't" go on the van panel — and it was
   * never a rule. What generation enforces is that the MODEL must not draw your
   * mark, because a model asked to render a logo produces a garbled counterfeit
   * of it. That is why NO_TEXT_DIRECTIVE exists and why it stays.
   *
   * Compositing your own real mark onto a surface in the scene is a different
   * act, and an ordinary one: your file, on a clearly-tagged composite, behind
   * the same approval gate as everything else. Rotation is what lets it sit on
   * an angled panel rather than float over one.
   *
   * Applied as a TRANSFORM rather than by moving the layout, so all three
   * templates honour it without restructuring — bold's absolute corner and the
   * other two's flowed foot row both just get offset from where they already are.
   */
  logoDx?: number;
  logoDy?: number;
  logoScale?: number;
  /** Degrees, clockwise. */
  logoRotate?: number;
};

/** How far the copy block may travel, in design units — a quarter of the
 *  reference width in each direction. Enough to re-balance a composition,
 *  not enough to push the headline off the artboard. */
export const COPY_NUDGE_LIMIT = 270;
export const HEADLINE_SCALE_RANGE = { min: 0.6, max: 1.6 } as const;
/** The logo roams the whole reference canvas — it has to reach a van panel in
 *  the middle of the frame, which a copy-block-sized nudge cannot do. */
export const LOGO_NUDGE_LIMIT = CREATIVE_DESIGN_WIDTH;
export const LOGO_SCALE_RANGE = { min: 0.25, max: 4 } as const;
export const LOGO_ROTATE_LIMIT = 180;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(min, value));
}

/** Clamp an override to the bounds above. Exported because the canvas clamps
 *  while dragging and the renderer clamps again on the way in — a value that
 *  arrives from a client must not be trusted to already be in range. */
export function clampLayoutOverride(override: CreativeLayoutOverride | undefined): Required<CreativeLayoutOverride> {
  return {
    copyDx: clamp(override?.copyDx ?? 0, -COPY_NUDGE_LIMIT, COPY_NUDGE_LIMIT),
    copyDy: clamp(override?.copyDy ?? 0, -COPY_NUDGE_LIMIT, COPY_NUDGE_LIMIT),
    headlineScale: clamp(override?.headlineScale ?? 1, HEADLINE_SCALE_RANGE.min, HEADLINE_SCALE_RANGE.max),
    logoDx: clamp(override?.logoDx ?? 0, -LOGO_NUDGE_LIMIT, LOGO_NUDGE_LIMIT),
    logoDy: clamp(override?.logoDy ?? 0, -LOGO_NUDGE_LIMIT, LOGO_NUDGE_LIMIT),
    logoScale: clamp(override?.logoScale ?? 1, LOGO_SCALE_RANGE.min, LOGO_SCALE_RANGE.max),
    logoRotate: clamp(override?.logoRotate ?? 0, -LOGO_ROTATE_LIMIT, LOGO_ROTATE_LIMIT),
  };
}

/** Has the operator moved the logo off its template position at all? */
export function isLogoPlaced(override?: CreativeLayoutOverride): boolean {
  const { logoDx, logoDy, logoScale, logoRotate } = clampLayoutOverride(override);
  return logoDx !== 0 || logoDy !== 0 || logoScale !== 1 || logoRotate !== 0;
}

/**
 * The logo's placement as a CSS transform, in the caller's own unit space.
 *
 * One function for both renderers, because the export and the preview showing
 * different logo positions is precisely the class of bug BSR-679 closed. The
 * caller supplies how to express a design-unit length — `px` for the exporter,
 * `cqw` for the canvas — and the ORDER here is load-bearing: translate first,
 * then rotate, then scale, so a rotated mark still lands where it was dragged.
 *
 * Returns null when untouched, so a template renders exactly as before.
 */
export function logoTransform(
  override: CreativeLayoutOverride | undefined,
  unit: (designUnits: number) => string,
): { transform: string; transformOrigin: string } | null {
  if (!isLogoPlaced(override)) return null;
  const { logoDx, logoDy, logoScale, logoRotate } = clampLayoutOverride(override);
  return {
    transform: `translate(${unit(logoDx)}, ${unit(logoDy)}) rotate(${logoRotate}deg) scale(${logoScale})`,
    transformOrigin: "center",
  };
}

/**
 * Fold an override into a layout, so every consumer keeps reading one spec and
 * neither renderer needs override logic of its own. That is the property BSR-679
 * bought and this must not spend: the canvas and the exporter apply the nudge by
 * rendering the same adjusted numbers, not by each interpreting the offset.
 *
 * Which edge moves depends on what the template anchors to, so that dragging
 * down always moves the copy down.
 */
export function withLayoutOverride(
  layout: CreativeLayoutSpec,
  override?: CreativeLayoutOverride,
): CreativeLayoutSpec {
  const { copyDx, copyDy, headlineScale } = clampLayoutOverride(override);
  if (copyDx === 0 && copyDy === 0 && headlineScale === 1) return layout;

  const next: CreativeLayoutSpec = {
    ...layout,
    headline: { ...layout.headline, size: layout.headline.size * headlineScale },
    // The subhead rides the headline's scale, or scaling the headline alone
    // would break the type relationship the template was designed around.
    subhead: { ...layout.subhead, size: layout.subhead.size * headlineScale },
  };

  if (layout.topBand) {
    // Top-anchored: the band's own padding positions the copy.
    next.topBand = { ...layout.topBand, padLeft: layout.topBand.padLeft + copyDx, padTop: layout.topBand.padTop + copyDy };
  } else if (layout.panel) {
    // Inside the side panel: bottom-anchored, so down means less bottom padding.
    next.panel = { ...layout.panel, padLeft: layout.panel.padLeft + copyDx, padBottom: layout.panel.padBottom - copyDy };
  } else {
    // Bottom-anchored copy block.
    next.copyInset = {
      ...layout.copyInset,
      left: layout.copyInset.left + copyDx,
      ...(layout.copyInset.bottom != null ? { bottom: layout.copyInset.bottom - copyDy } : {}),
    };
  }

  return next;
}
