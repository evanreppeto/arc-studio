import type { ReactElement } from "react";

import type { BrandTokens, CreativeCopy, CreativeDimensions, CreativeLayoutSpec } from "@/domain";

export type CreativeTemplateProps = {
  brand: BrandTokens;
  copy: CreativeCopy;
  dims: CreativeDimensions;
  /** The template's layout with any per-asset override already folded in, so a
   *  template never applies an override itself and the canvas can resolve the
   *  identical spec the same way. */
  layout: CreativeLayoutSpec;
  /** Background image as a data: URL (fetched + inlined by the renderer). */
  backgroundDataUrl: string;
  /** Logo as a data: URL, or null when the brand has no logo (use the short mark). */
  logoDataUrl: string | null;
  /** The operator's logo placement, already resolved to a CSS transform in this
   *  renderer's unit space (null when untouched). Computed once by the caller so
   *  every template applies the identical value and none does the arithmetic. */
  logoStyle: { transform: string; transformOrigin: string } | null;
};

export type CreativeTemplate = (p: CreativeTemplateProps) => ReactElement;
