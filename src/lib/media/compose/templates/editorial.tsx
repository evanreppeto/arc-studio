import { CREATIVE_LAYOUTS, creativeScale } from "@/domain";

import type { CreativeTemplate } from "../types";
import { brandColor } from "./tokens";

/** Editorial: accent side-rail, kicker + headline up top on a dark band, logo + outline CTA at the foot.
 *
 *  Geometry and type scale come from CREATIVE_LAYOUTS.editorial (BSR-679). */
export const templateEditorial: CreativeTemplate = ({ brand, copy, dims, backgroundDataUrl, logoDataUrl }) => {
  const u = creativeScale(dims.width);
  const L = CREATIVE_LAYOUTS.editorial;
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
      <img
        src={backgroundDataUrl}
        width={dims.width}
        height={dims.height}
        style={{ position: "absolute", top: 0, left: 0, width: dims.width, height: dims.height, objectFit: "cover" }}
      />
      {/* accent rail */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: L.rail!.width * u,
          display: "flex",
          backgroundColor: c(L.rail!.color),
        }}
      />
      {/* top band */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          paddingTop: L.topBand!.padTop * u,
          paddingBottom: L.topBand!.padBottom * u,
          paddingLeft: L.topBand!.padLeft * u,
          paddingRight: L.topBand!.padRight * u,
          background: `linear-gradient(180deg, ${c(L.surface)} ${L.topBand!.solidStop}%, rgba(15,17,21,0) 100%)`,
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
          }}
        >
          {copy.headline}
        </div>
      </div>
      {/* bottom scrim */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: dims.height * L.scrim!.heightRatio,
          display: "flex",
          background: `linear-gradient(0deg, ${c(L.surface)} ${L.scrim!.solidStop}%, rgba(15,17,21,0) 100%)`,
        }}
      />
      {/* foot: logo + outline CTA */}
      <div
        style={{
          position: "absolute",
          left: L.copyInset.left * u,
          right: L.copyInset.right * u,
          bottom: L.copyInset.bottom! * u,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {logoDataUrl ? (
          <img src={logoDataUrl} style={{ width: L.logo.width * u, height: L.logo.height * u, objectFit: "contain" }} />
        ) : (
          <div style={{ display: "flex", color: c("light"), fontFamily: "Heading", fontSize: L.logo.fallbackSize * u }}>
            {brand.displayName}
          </div>
        )}
        {copy.ctaLabel ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: c(L.cta.color),
              fontFamily: "Heading",
              fontSize: L.cta.size * u,
              paddingTop: L.cta.padY * u,
              paddingBottom: L.cta.padY * u,
              paddingLeft: L.cta.padX * u,
              paddingRight: L.cta.padX * u,
              border: `${L.cta.borderWidth! * u}px solid ${c(L.cta.borderColor!)}`,
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
