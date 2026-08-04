import "server-only";

import { ImageResponse } from "next/og";

import {
  CREATIVE_DIMENSIONS,
  CREATIVE_LAYOUTS,
  pickLogoForBackground,
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

/** The background each template's logo area actually sits on. See renderCreative. */
const LOGO_BACKGROUND: Record<CreativeTemplateId, "light" | "dark"> = {
  bold: "dark",
  editorial: "dark",
  minimal: "dark",
};

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
  // Which logo variant actually suits this template's logo area. Every template
  // today draws the mark over the background photo or a charcoal scrim — their
  // short-mark fallbacks are all set in `c("light")`, i.e. light-on-dark — so
  // all three resolve "dark". Stated per template rather than assumed, because
  // the day one puts the logo on a paper panel this is the line that has to
  // change, and a template drawing a white knocked-out mark on white paper
  // produces an image that looks fine to every check except a human eye.
  const logoBackground = LOGO_BACKGROUND[input.template] ?? "dark";
  const chosenLogo = pickLogoForBackground(input.brand.logos ?? [], logoBackground);
  // No variants uploaded → the single mirror logo, which is what every
  // workspace had before the set existed.
  const logoUrl = chosenLogo?.url ?? input.brand.logoUrl;
  const logoDataUrl = logoUrl
    ? await toDataUrl(logoUrl).catch(() => null) // a broken logo must not kill the render
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
