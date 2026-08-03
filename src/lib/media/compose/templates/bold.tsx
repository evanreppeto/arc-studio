import { creativeScale } from "@/domain";

import type { CreativeTemplate } from "../types";
import { brandColor } from "./tokens";

/** Bold: charcoal scrim, logo top-left, big headline + accent CTA pill on a bottom scrim.
 *
 *  Geometry and type scale come from CREATIVE_LAYOUTS.bold so the Studio canvas
 *  can lay itself out from the same numbers (BSR-679). The structure below is
 *  unchanged — only the literals moved. */
export const templateBold: CreativeTemplate = ({ brand, copy, dims, layout, backgroundDataUrl, logoDataUrl }) => {
  const u = creativeScale(dims.width); // scale unit so 16:9 (1920w) scales up proportionally
  const L = layout;
  const c = (ref: Parameters<typeof brandColor>[1]) => brandColor(brand, ref);

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: dims.width,
        height: dims.height,
        backgroundColor: c(L.surface),
        fontFamily: "Body",
        overflow: "hidden",
      }}
    >
      {/* background photo */}
      <img
        src={backgroundDataUrl}
        width={dims.width}
        height={dims.height}
        style={{ position: "absolute", top: 0, left: 0, width: dims.width, height: dims.height, objectFit: "cover" }}
      />
      {/* bottom scrim for legibility */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: dims.height * L.scrim!.heightRatio,
          display: "flex",
          background: `linear-gradient(0deg, ${c(L.surface)} ${L.scrim!.solidStop}%, rgba(15,17,21,0.55) ${L.scrim!.midStop}%, rgba(15,17,21,0) 100%)`,
        }}
      />
      {/* logo or short-mark chip */}
      {logoDataUrl ? (
        <img
          src={logoDataUrl}
          style={{
            position: "absolute",
            top: L.logoPosition!.top * u,
            left: L.logoPosition!.left * u,
            width: L.logo.width * u,
            height: L.logo.height * u,
            objectFit: "contain",
          }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            top: L.logoPosition!.top * u,
            left: L.logoPosition!.left * u,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: L.logo.height * u,
            paddingLeft: L.logo.fallbackChip!.padX * u,
            paddingRight: L.logo.fallbackChip!.padX * u,
            backgroundColor: c(L.logo.fallbackChip!.background),
            color: c(L.logo.fallbackChip!.color),
            fontFamily: "Heading",
            fontSize: L.logo.fallbackSize * u,
            borderRadius: L.logo.fallbackChip!.radius * u,
          }}
        >
          {brand.shortMark}
        </div>
      )}
      {/* copy block */}
      <div
        style={{
          position: "absolute",
          left: L.copyInset.left * u,
          right: L.copyInset.right * u,
          bottom: L.copyInset.bottom! * u,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
        }}
      >
        {copy.kicker ? (
          <div
            style={{
              display: "flex",
              color: c(L.kicker.color),
              fontFamily: "Heading",
              fontSize: L.kicker.size * u,
              letterSpacing: L.kicker.tracking! * u,
              textTransform: "uppercase",
              marginBottom: L.kicker.marginBottom! * u,
            }}
          >
            {copy.kicker}
          </div>
        ) : null}
        <div
          style={{
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: L.headline.clampLines,
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: c(L.headline.color),
            fontFamily: "Heading",
            fontSize: L.headline.size * u,
            lineHeight: L.headline.lineHeight,
            letterSpacing: L.headline.tracking! * u,
            marginBottom: copy.ctaLabel ? L.headline.marginBottom! * u : 0,
          }}
        >
          {copy.headline}
        </div>
        {copy.ctaLabel ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              backgroundColor: c(L.cta.background!),
              color: c(L.cta.color),
              fontFamily: "Heading",
              fontSize: L.cta.size * u,
              paddingTop: L.cta.padY * u,
              paddingBottom: L.cta.padY * u,
              paddingLeft: L.cta.padX * u,
              paddingRight: L.cta.padX * u,
              borderRadius: L.cta.radius * u,
            }}
          >
            {copy.ctaLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
};
