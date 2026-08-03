"use client";

import type { CSSProperties, ReactNode } from "react";

import {
  CREATIVE_DESIGN_WIDTH,
  CREATIVE_LAYOUTS,
  type BrandColorRef,
  type CreativeLayoutSpec,
  type CreativeTemplateId,
} from "@/domain";

/**
 * The Studio artboard, laid out from the SAME spec the exporter uses.
 *
 * Before this, the canvas was a hand-built CSS approximation with its own
 * numbers, and it never read the selected template at all — pick Minimal and
 * you kept looking at a Bold-shaped preview while the PNG came out Minimal
 * (BSR-679). Every value below now comes from CREATIVE_LAYOUTS.
 *
 * Design units → preview pixels without measuring anything: the canvas is a
 * container (`container-type: inline-size`), so `100cqw` is its own width and
 * `n / 1080 * 100cqw` is exactly the `n * u` the renderer computes. Resize the
 * pane and the proportions hold, because it is the same ratio.
 */

/** A design-unit length as a CSS length relative to the artboard's width. */
function du(n: number): string {
  return `calc(${n} / ${CREATIVE_DESIGN_WIDTH} * 100cqw)`;
}

export type CanvasBrand = {
  primary: string;
  secondary: string;
  accent: string;
  dark: string;
  light: string;
  displayName: string;
  shortMark: string;
};

export type CanvasCopy = {
  kicker: string;
  headline: string;
  cta: string;
};

/** Empty copy renders as a muted placeholder rather than collapsed nothing, so a
 *  workspace starting from scratch still sees where each line lands. */
const PLACEHOLDER: CanvasCopy = {
  kicker: "Kicker",
  headline: "Your headline goes here.",
  cta: "",
};

type CanvasProps = {
  template: CreativeTemplateId;
  brand: CanvasBrand;
  copy: CanvasCopy;
  /** Layer visibility from the Layers panel. */
  shown: (layer: string) => boolean;
  /** The background media element, or null when the workspace has none yet. */
  background: ReactNode;
};

function color(brand: CanvasBrand, ref: BrandColorRef): string {
  return brand[ref];
}

function textStyle(brand: CanvasBrand, scale: CreativeLayoutSpec["kicker"]): CSSProperties {
  return {
    color: color(brand, scale.color),
    fontSize: du(scale.size),
    ...(scale.lineHeight ? { lineHeight: scale.lineHeight } : {}),
    ...(scale.tracking ? { letterSpacing: du(scale.tracking) } : {}),
    ...(scale.uppercase ? { textTransform: "uppercase" as const } : {}),
    ...(scale.marginBottom ? { marginBottom: du(scale.marginBottom) } : {}),
  };
}

function headlineStyle(brand: CanvasBrand, L: CreativeLayoutSpec): CSSProperties {
  return {
    ...textStyle(brand, L.headline),
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: L.headline.clampLines,
    overflow: "hidden",
  };
}

function ctaStyle(brand: CanvasBrand, L: CreativeLayoutSpec): CSSProperties {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    alignSelf: "flex-start",
    color: color(brand, L.cta.color),
    fontSize: du(L.cta.size),
    paddingTop: du(L.cta.padY),
    paddingBottom: du(L.cta.padY),
    paddingLeft: du(L.cta.padX),
    paddingRight: du(L.cta.padX),
    borderRadius: du(L.cta.radius),
  };
  return L.cta.style === "filled"
    ? { ...base, background: color(brand, L.cta.background ?? "accent") }
    : { ...base, border: `${du(L.cta.borderWidth ?? 2)} solid ${color(brand, L.cta.borderColor ?? "light")}` };
}

/** Logo lockup: the brand's mark when it has one, else the same fallback the
 *  template draws (a filled chip for Bold, plain brand text elsewhere). */
function Logo({ brand, L }: { brand: CanvasBrand; L: CreativeLayoutSpec }) {
  if (L.logo.fallbackChip) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          height: du(L.logo.height),
          paddingLeft: du(L.logo.fallbackChip.padX),
          paddingRight: du(L.logo.fallbackChip.padX),
          background: color(brand, L.logo.fallbackChip.background),
          color: color(brand, L.logo.fallbackChip.color),
          fontSize: du(L.logo.fallbackSize),
          borderRadius: du(L.logo.fallbackChip.radius),
          fontFamily: "var(--serif)",
          fontWeight: 600,
        }}
      >
        {brand.shortMark}
      </span>
    );
  }
  return (
    <span style={{ color: color(brand, "light"), fontSize: du(L.logo.fallbackSize), fontFamily: "var(--serif)", fontWeight: 600 }}>
      {brand.displayName}
    </span>
  );
}

function CopyStack({ brand, L, copy, shown }: { brand: CanvasBrand; L: CreativeLayoutSpec; copy: CanvasCopy; shown: (l: string) => boolean }) {
  const kicker = copy.kicker || PLACEHOLDER.kicker;
  const headline = copy.headline || PLACEHOLDER.headline;
  return (
    <>
      {shown("Kicker") && (
        <div style={{ ...textStyle(brand, L.kicker), opacity: copy.kicker ? 1 : 0.45 }}>{kicker}</div>
      )}
      {shown("Headline") && (
        <div style={{ ...headlineStyle(brand, L), opacity: copy.headline ? 1 : 0.45, fontFamily: "var(--serif)", fontWeight: 600 }}>
          {headline}
        </div>
      )}
      {L.divider && (
        <div
          style={{
            width: du(L.divider.width),
            height: du(L.divider.height),
            background: color(brand, L.divider.color),
            marginTop: du(L.divider.marginTop),
            marginBottom: du(L.divider.marginBottom),
          }}
        />
      )}
      {shown("CTA button") && copy.cta && <div style={ctaStyle(brand, L)}>{copy.cta}</div>}
    </>
  );
}

export function StudioCanvas({ template, brand, copy, shown, background }: CanvasProps) {
  const L = CREATIVE_LAYOUTS[template];

  return (
    <>
      <div className="cbg">{background}</div>

      {/* Editorial's accent rail */}
      {L.rail && (
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: du(L.rail.width), background: color(brand, L.rail.color) }} />
      )}

      {/* Editorial's top band: kicker + headline sit inside it */}
      {L.topBand && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            display: "flex",
            flexDirection: "column",
            paddingTop: du(L.topBand.padTop),
            paddingBottom: du(L.topBand.padBottom),
            paddingLeft: du(L.topBand.padLeft),
            paddingRight: du(L.topBand.padRight),
            background: `linear-gradient(180deg, ${color(brand, L.surface)} ${L.topBand.solidStop}%, rgba(15,17,21,0) 100%)`,
          }}
        >
          {shown("Kicker") && (
            <div style={{ ...textStyle(brand, L.kicker), opacity: copy.kicker ? 1 : 0.45 }}>{copy.kicker || PLACEHOLDER.kicker}</div>
          )}
          {shown("Headline") && (
            <div style={{ ...headlineStyle(brand, L), opacity: copy.headline ? 1 : 0.45, fontFamily: "var(--serif)", fontWeight: 600 }}>
              {copy.headline || PLACEHOLDER.headline}
            </div>
          )}
        </div>
      )}

      {/* Bottom scrim for legibility */}
      {L.scrim && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: `${L.scrim.heightRatio * 100}%`,
            background: L.scrim.midStop
              ? `linear-gradient(0deg, ${color(brand, L.surface)} ${L.scrim.solidStop}%, rgba(15,17,21,0.55) ${L.scrim.midStop}%, rgba(15,17,21,0) 100%)`
              : `linear-gradient(0deg, ${color(brand, L.surface)} ${L.scrim.solidStop}%, rgba(15,17,21,0) 100%)`,
          }}
        />
      )}

      {/* Minimal's solid side panel carries the whole lockup */}
      {L.panel && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            width: `${L.panel.widthRatio * 100}%`,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: du(L.panel.pad),
            background: color(brand, L.panel.background),
          }}
        >
          {shown("Logo") ? <Logo brand={brand} L={L} /> : <span />}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <CopyStack brand={brand} L={L} copy={copy} shown={shown} />
          </div>
        </div>
      )}

      {/* Bold's positioned logo */}
      {L.logoPosition && shown("Logo") && (
        <div style={{ position: "absolute", top: du(L.logoPosition.top), left: du(L.logoPosition.left), display: "flex" }}>
          <Logo brand={brand} L={L} />
        </div>
      )}

      {/* Bold's bottom copy block */}
      {!L.panel && !L.topBand && (
        <div
          style={{
            position: "absolute",
            left: du(L.copyInset.left),
            right: du(L.copyInset.right),
            bottom: du(L.copyInset.bottom ?? 0),
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
          }}
        >
          <CopyStack brand={brand} L={L} copy={copy} shown={shown} />
        </div>
      )}

      {/* Editorial's foot row: logo left, outline CTA right */}
      {L.topBand && (
        <div
          style={{
            position: "absolute",
            left: du(L.copyInset.left),
            right: du(L.copyInset.right),
            bottom: du(L.copyInset.bottom ?? 0),
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {shown("Logo") ? <Logo brand={brand} L={L} /> : <span />}
          {shown("CTA button") && copy.cta ? <div style={ctaStyle(brand, L)}>{copy.cta}</div> : <span />}
        </div>
      )}
    </>
  );
}
