import type { BrandColorRef, BrandTokens } from "@/domain";

/** Resolve a layout's brand colour reference against a workspace's Brand Kit.
 *  The layout spec names tokens rather than hex so the same numbers can be
 *  rendered by the exporter and by the Studio canvas, which get their brand
 *  values from different places. */
export function brandColor(brand: BrandTokens, ref: BrandColorRef): string {
  return brand[ref];
}
