"use client";

import { useCallback, useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import {
  CREATIVE_DESIGN_WIDTH,
  CREATIVE_LAYOUTS,
  clampLayoutOverride,
  withLayoutOverride,
  type BrandColorRef,
  type CreativeLayoutOverride,
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

/** Layers the operator can select on the artboard. Selecting any part of the
 *  copy selects the block, because the block is what moves — the template owns
 *  the arrangement inside it. */
export type CanvasLayer = "Background" | "Logo" | "Kicker" | "Headline" | "CTA button";

type CanvasProps = {
  template: CreativeTemplateId;
  brand: CanvasBrand;
  copy: CanvasCopy;
  /** Layer visibility from the Layers panel. */
  shown: (layer: string) => boolean;
  /** The background media element, or null when the workspace has none yet. */
  background: ReactNode;
  /** The operator's nudge. Applied here exactly as the renderer applies it. */
  override?: CreativeLayoutOverride;
  onOverrideChange?: (next: CreativeLayoutOverride) => void;
  selected?: CanvasLayer | null;
  onSelect?: (layer: CanvasLayer | null) => void;
  /** Commit an in-place text edit. */
  onCopyChange?: (field: "kicker" | "headline" | "cta", value: string) => void;
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


/** An editable text layer on the artboard: click selects, double-click types.
 *  contentEditable keeps the text in place rather than swapping in an input, so
 *  the line breaks and clamping you see while editing are the ones that ship. */
function EditableText({
  value,
  placeholder,
  style,
  layer,
  selected,
  onSelect,
  onCommit,
}: {
  value: string;
  placeholder: string;
  style: CSSProperties;
  layer: CanvasLayer;
  selected: boolean;
  onSelect?: (l: CanvasLayer | null) => void;
  onCommit?: (v: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Only push the prop back into the DOM when it actually differs, or every
  // keystroke would fight the caret.
  useEffect(() => {
    const node = ref.current;
    if (node && document.activeElement !== node && node.textContent !== value) node.textContent = value;
  }, [value]);

  return (
    <div
      ref={ref}
      className={`clayer${selected ? " sel" : ""}`}
      style={{ ...style, opacity: value ? 1 : 0.45 }}
      role="button"
      tabIndex={0}
      aria-label={`${layer} — click to select, double-click to edit`}
      suppressContentEditableWarning
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect?.(layer);
      }}
      onDoubleClick={(e) => {
        const node = e.currentTarget;
        node.contentEditable = "plaintext-only";
        node.focus();
      }}
      onBlur={(e) => {
        const node = e.currentTarget;
        if (node.contentEditable === "false") return;
        node.contentEditable = "false";
        onCommit?.((node.textContent ?? "").trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.currentTarget.contentEditable !== "false") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") e.currentTarget.blur();
      }}
    >
      {value || placeholder}
    </div>
  );
}

function CopyStack({
  brand,
  L,
  copy,
  shown,
  selected,
  onSelect,
  onCopyChange,
}: {
  brand: CanvasBrand;
  L: CreativeLayoutSpec;
  copy: CanvasCopy;
  shown: (l: string) => boolean;
  selected?: CanvasLayer | null;
  onSelect?: (l: CanvasLayer | null) => void;
  onCopyChange?: (field: "kicker" | "headline" | "cta", value: string) => void;
}) {
  return (
    <>
      {shown("Kicker") && (
        <EditableText
          value={copy.kicker}
          placeholder={PLACEHOLDER.kicker}
          style={textStyle(brand, L.kicker)}
          layer="Kicker"
          selected={selected === "Kicker"}
          onSelect={onSelect}
          onCommit={(v) => onCopyChange?.("kicker", v)}
        />
      )}
      {shown("Headline") && (
        <EditableText
          value={copy.headline}
          placeholder={PLACEHOLDER.headline}
          style={{ ...headlineStyle(brand, L), fontFamily: "var(--serif)", fontWeight: 600 }}
          layer="Headline"
          selected={selected === "Headline"}
          onSelect={onSelect}
          onCommit={(v) => onCopyChange?.("headline", v)}
        />
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
      {shown("CTA button") && copy.cta && (
        <EditableText
          value={copy.cta}
          placeholder=""
          style={ctaStyle(brand, L)}
          layer="CTA button"
          selected={selected === "CTA button"}
          onSelect={onSelect}
          onCommit={(v) => onCopyChange?.("cta", v)}
        />
      )}
    </>
  );
}

/** Is this layer part of the copy block — i.e. does selecting it arm the drag? */
function isCopyLayer(layer: CanvasLayer | null | undefined): boolean {
  return layer === "Kicker" || layer === "Headline" || layer === "CTA button";
}

export function StudioCanvas({
  template,
  brand,
  copy,
  shown,
  background,
  override,
  onOverrideChange,
  selected,
  onSelect,
  onCopyChange,
}: CanvasProps) {
  // The nudge is folded in here exactly as renderCreative folds it in, so the
  // artboard and the export stay one layout (BSR-679/BSR-680).
  const L = withLayoutOverride(CREATIVE_LAYOUTS[template], override);
  const armed = isCopyLayer(selected);

  /** Drag the copy block. Pixels are converted to design units against the
   *  artboard's own width, which is the same 1080-reference the spec uses, so a
   *  drag means the same thing at any zoom. The domain clamps the result. */
  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, mode: "move" | "scale") => {
      if (!onOverrideChange) return;
      const artboard = (event.currentTarget as HTMLElement).closest(".canvas") as HTMLElement | null;
      const width = artboard?.clientWidth ?? 0;
      if (!width) return;
      event.preventDefault();
      event.stopPropagation();
      const perPx = CREATIVE_DESIGN_WIDTH / width;
      const startX = event.clientX;
      const startY = event.clientY;
      const from = clampLayoutOverride(override);
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);

      const onMove = (move: PointerEvent) => {
        const dx = (move.clientX - startX) * perPx;
        const dy = (move.clientY - startY) * perPx;
        onOverrideChange(
          mode === "move"
            ? { ...from, copyDx: from.copyDx + dx, copyDy: from.copyDy + dy }
            : // Scale from horizontal travel: a quarter of the reference width
              // spans the whole allowed range, so the handle feels proportional.
              { ...from, headlineScale: from.headlineScale + dx / 540 },
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [onOverrideChange, override],
  );

  const copyStack = (
    <CopyStack brand={brand} L={L} copy={copy} shown={shown} selected={selected} onSelect={onSelect} onCopyChange={onCopyChange} />
  );

  /** Chrome shown around the copy block while a copy layer is selected: the
   *  outline that says what moves, and the handle that scales the headline. */
  const blockChrome = armed ? (
    <>
      <span className="cblock-ring" aria-hidden />
      <span
        className="cblock-handle"
        role="slider"
        tabIndex={0}
        aria-label="Resize headline"
        aria-valuenow={Math.round((clampLayoutOverride(override).headlineScale ?? 1) * 100)}
        aria-valuemin={60}
        aria-valuemax={160}
        onPointerDown={(e) => startDrag(e, "scale")}
      />
    </>
  ) : null;

  const dragProps = armed
    ? { onPointerDown: (e: ReactPointerEvent<HTMLElement>) => startDrag(e, "move"), style: { cursor: "move" as const } }
    : {};

  return (
    <>
      <div className="cbg" onPointerDown={() => onSelect?.(null)}>
        {background}
      </div>

      {/* Editorial's accent rail */}
      {L.rail && (
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: du(L.rail.width), background: color(brand, L.rail.color) }} />
      )}

      {/* Editorial's top band: kicker + headline sit inside it */}
      {L.topBand && (
        <div
          className={`cblock${armed ? " armed" : ""}`}
          {...dragProps}
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
            ...(dragProps.style ?? {}),
          }}
        >
          {shown("Kicker") && (
            <EditableText
              value={copy.kicker}
              placeholder={PLACEHOLDER.kicker}
              style={textStyle(brand, L.kicker)}
              layer="Kicker"
              selected={selected === "Kicker"}
              onSelect={onSelect}
              onCommit={(v) => onCopyChange?.("kicker", v)}
            />
          )}
          {shown("Headline") && (
            <EditableText
              value={copy.headline}
              placeholder={PLACEHOLDER.headline}
              style={{ ...headlineStyle(brand, L), fontFamily: "var(--serif)", fontWeight: 600 }}
              layer="Headline"
              selected={selected === "Headline"}
              onSelect={onSelect}
              onCommit={(v) => onCopyChange?.("headline", v)}
            />
          )}
          {blockChrome}
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
            pointerEvents: "none",
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
            paddingTop: du(L.panel.padTop),
            paddingRight: du(L.panel.padRight),
            paddingBottom: du(L.panel.padBottom),
            paddingLeft: du(L.panel.padLeft),
            background: color(brand, L.panel.background),
          }}
        >
          {shown("Logo") ? (
            <div
              className={`clayer${selected === "Logo" ? " sel" : ""}`}
              role="button"
              tabIndex={0}
              aria-label="Logo"
              onPointerDown={(e) => { e.stopPropagation(); onSelect?.("Logo"); }}
            >
              <Logo brand={brand} L={L} />
            </div>
          ) : (
            <span />
          )}
          <div className={`cblock${armed ? " armed" : ""}`} {...dragProps} style={{ display: "flex", flexDirection: "column", position: "relative", ...(dragProps.style ?? {}) }}>
            {copyStack}
            {blockChrome}
          </div>
        </div>
      )}

      {/* Bold's positioned logo */}
      {L.logoPosition && shown("Logo") && (
        <div
          className={`clayer${selected === "Logo" ? " sel" : ""}`}
          role="button"
          tabIndex={0}
          aria-label="Logo"
          onPointerDown={(e) => { e.stopPropagation(); onSelect?.("Logo"); }}
          style={{ position: "absolute", top: du(L.logoPosition.top), left: du(L.logoPosition.left), display: "flex" }}
        >
          <Logo brand={brand} L={L} />
        </div>
      )}

      {/* Bold's bottom copy block */}
      {!L.panel && !L.topBand && (
        <div
          className={`cblock${armed ? " armed" : ""}`}
          {...dragProps}
          style={{
            position: "absolute",
            left: du(L.copyInset.left),
            right: du(L.copyInset.right),
            bottom: du(L.copyInset.bottom ?? 0),
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            ...(dragProps.style ?? {}),
          }}
        >
          {copyStack}
          {blockChrome}
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
          {shown("Logo") ? (
            <div
              className={`clayer${selected === "Logo" ? " sel" : ""}`}
              role="button"
              tabIndex={0}
              aria-label="Logo"
              onPointerDown={(e) => { e.stopPropagation(); onSelect?.("Logo"); }}
            >
              <Logo brand={brand} L={L} />
            </div>
          ) : (
            <span />
          )}
          {shown("CTA button") && copy.cta ? (
            <EditableText
              value={copy.cta}
              placeholder=""
              style={ctaStyle(brand, L)}
              layer="CTA button"
              selected={selected === "CTA button"}
              onSelect={onSelect}
              onCommit={(v) => onCopyChange?.("cta", v)}
            />
          ) : (
            <span />
          )}
        </div>
      )}
    </>
  );
}
