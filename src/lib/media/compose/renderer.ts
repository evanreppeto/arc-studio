import "server-only";

import { ImageResponse } from "next/og";

import {
  CREATIVE_DIMENSIONS,
  CREATIVE_LAYOUTS,
  withLayoutOverride,
  type BrandTokens,
  type CreativeCopy,
  type CreativeFormat,
  type CreativeLayoutOverride,
  type CreativeTemplateId,
} from "@/domain";
import { assertPublicHttpUrl } from "@/lib/brand-kit/website";

import { loadCreativeFonts } from "./fonts";
import type { CreativeTemplate } from "./types";
import { templateBold } from "./templates/bold";
import { templateEditorial } from "./templates/editorial";
import { templateMinimal } from "./templates/minimal";

const TEMPLATES: Record<CreativeTemplateId, CreativeTemplate> = {
  bold: templateBold,
  editorial: templateEditorial,
  minimal: templateMinimal,
};

/** Fetch an http(s) image and inline it as a data: URL (satori renders these reliably). */
async function toDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  assertPublicHttpUrl(url); // SSRF guard: reject loopback/private/internal hosts before fetching
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to fetch image (${res.status}): ${url}`);
  const contentType = res.headers.get("content-type") ?? "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${contentType};base64,${buf.toString("base64")}`;
}

export type RenderCreativeInput = {
  template: CreativeTemplateId;
  format: CreativeFormat;
  brand: BrandTokens;
  copy: CreativeCopy;
  backgroundUrl: string;
  /** The operator's nudge from the Studio canvas. Clamped here as well as there
   *  — a value arriving from a client is not trusted to be in range. */
  layoutOverride?: CreativeLayoutOverride;
};

/** Render a finished, brand-tokenized creative to a PNG buffer. */
export async function renderCreative(
  input: RenderCreativeInput,
): Promise<{ bytes: Buffer; contentType: "image/png" }> {
  const dims = CREATIVE_DIMENSIONS[input.format];
  const backgroundDataUrl = await toDataUrl(input.backgroundUrl);
  const logoDataUrl = input.brand.logoUrl
    ? await toDataUrl(input.brand.logoUrl).catch(() => null) // a broken logo must not kill the render
    : null;
  const fonts = await loadCreativeFonts(input.brand);
  const template = TEMPLATES[input.template] ?? templateBold;
  // Resolve the layout once, here: templates render whatever spec they are
  // handed, so an override cannot be applied differently by each of them — or
  // differently from the canvas, which folds it in the same way.
  const layout = withLayoutOverride(CREATIVE_LAYOUTS[input.template] ?? CREATIVE_LAYOUTS.bold, input.layoutOverride);
  const element = template({ brand: input.brand, copy: input.copy, dims, layout, backgroundDataUrl, logoDataUrl });
  const response = new ImageResponse(element, { width: dims.width, height: dims.height, fonts });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, contentType: "image/png" };
}
