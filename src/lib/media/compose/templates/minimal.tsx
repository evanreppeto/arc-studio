import { creativeScale } from "@/domain";

import type { CreativeTemplate } from "../types";
import { brandColor } from "./tokens";

/** Minimal: solid brand-primary side panel with the headline; photo fills the rest.
 *
 *  Geometry and type scale come from CREATIVE_LAYOUTS.minimal (BSR-679). */
export const templateMinimal: CreativeTemplate = ({ brand, copy, dims, layout, backgroundDataUrl, logoDataUrl }) => {
  const u = creativeScale(dims.width);
  const L = layout;
  const c = (ref: Parameters<typeof brandColor>[1]) => brandColor(brand, ref);
  const panelW = dims.width * L.panel!.widthRatio;

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
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
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: panelW,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          paddingTop: L.panel!.padTop * u,
          paddingBottom: L.panel!.padBottom * u,
          paddingLeft: L.panel!.padLeft * u,
          paddingRight: L.panel!.padRight * u,
          backgroundColor: c(L.panel!.background),
        }}
      >
        {logoDataUrl ? (
          <img src={logoDataUrl} style={{ width: L.logo.width * u, height: L.logo.height * u, objectFit: "contain" }} />
        ) : (
          <div style={{ display: "flex", color: c("light"), fontFamily: "Heading", fontSize: L.logo.fallbackSize * u }}>
            {brand.displayName}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column" }}>
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
            }}
          >
            {copy.headline}
          </div>
          {copy.subhead ? (
            <div
              style={{
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: L.subhead.clampLines,
                overflow: "hidden",
                textOverflow: "ellipsis",
                color: c(L.subhead.color),
                fontFamily: "Body",
                fontSize: L.subhead.size * u,
                lineHeight: L.subhead.lineHeight,
                marginTop: L.kicker.marginBottom! * u,
              }}
            >
              {copy.subhead}
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              width: L.divider!.width * u,
              height: L.divider!.height * u,
              backgroundColor: c(L.divider!.color),
              marginTop: L.divider!.marginTop * u,
              marginBottom: L.divider!.marginBottom * u,
            }}
          />
          {copy.ctaLabel ? (
            <div
              style={{
                display: "flex",
                alignSelf: "flex-start",
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
    </div>
  );
};
