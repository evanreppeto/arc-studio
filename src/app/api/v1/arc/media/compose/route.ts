import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import {
  normalizeCreativeFormat,
  selectCreativeTemplate,
  toBrandTokens,
  type CreativeCopy,
} from "@/domain";
import { INVALID_JSON, arcGuard, fail, readJson } from "@/app/api/v1/arc/_lib/http";
import { resolveMediaGeneration } from "@/lib/media/enablement";
import { renderCreative } from "@/lib/media/compose/renderer";
import { storeGeneratedMedia } from "@/lib/media/storage";
import { listBrandLogos } from "@/lib/brand-kit/logos";
import { getBusinessProfile } from "@/lib/brand-kit/persistence";

// satori + custom font file reads need the Node runtime, not edge.
export const runtime = "nodejs";

const COMPOSITE_RISK =
  "Real logo overlaid on an AI-generated background — the background is not proof of a real job.";

/**
 * Composite a finished, on-brand creative: AI background + Brand Kit (logo,
 * palette, fonts) + headline/CTA copy → a single PNG stored in campaign-media.
 * Bearer-gated; flag-gated by isMediaGenEnabled(). No outbound — the caller
 * lands the result as an approval-gated draft asset.
 *
 *   POST /api/v1/arc/media/compose
 *   { background_url, headline, kicker?, cta_label?, format?, template?, seed? }
 *   -> 201 { ok, status:"created", media, objectPath, template }
 */
export async function POST(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;

  // Compositing renders locally (no provider call, nothing to meter) but stays
  // behind the same media connector switch so "media is off" means all of it.
  const access = await resolveMediaGeneration(allowed.scope.workspaceId);
  if (!access.enabled) return fail("not_configured", access.reason, 503);

  const payload = await readJson(request);
  if (payload === INVALID_JSON || typeof payload !== "object" || payload === null) {
    return fail("rejected", "Request body must be valid JSON.", 400);
  }
  const body = payload as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const backgroundUrl = str(body.background_url);
  if (!backgroundUrl) return fail("rejected", "background_url is required.", 400);
  const headline = str(body.headline);
  if (!headline) return fail("rejected", "headline is required.", 400);

  const copy: CreativeCopy = {
    headline,
    kicker: str(body.kicker) || undefined,
    ctaLabel: str(body.cta_label) || undefined,
  };
  const format = normalizeCreativeFormat(str(body.format));
  const template = selectCreativeTemplate({ hint: str(body.template) || null, seed: str(body.seed) || backgroundUrl });

  try {
    const [profile, brandLogos] = await Promise.all([
      getBusinessProfile(allowed.scope.orgId),
      listBrandLogos(allowed.scope.orgId, allowed.scope.workspaceId),
    ]);
    const brand = toBrandTokens(profile, brandLogos);
    const { bytes, contentType } = await renderCreative({ template, format, brand, copy, backgroundUrl });

    const objectPath = `arc-composite/${allowed.scope.orgId}/${allowed.scope.workspaceId}/${randomUUID()}.png`;
    const url = await storeGeneratedMedia(objectPath, bytes, contentType);

    const media = {
      kind: "image" as const,
      url,
      source: "composite" as const,
      format,
      riskFlags: [COMPOSITE_RISK],
    };
    return NextResponse.json({ ok: true, status: "created", media, objectPath, template }, { status: 201 });
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Creative compositing failed.", 502);
  }
}
