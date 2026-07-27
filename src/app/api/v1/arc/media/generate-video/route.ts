import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { parseArcRoute } from "@/domain";

import { INVALID_JSON, arcGuard, fail, readJson } from "@/app/api/v1/arc/_lib/http";
import { checkUsageAllowed, usageBlockMessage } from "@/lib/billing/entitlements";
import { getMediaProviderWithKey } from "@/lib/media";
import { MEDIA_CONNECTOR_KEY, resolveMediaGeneration } from "@/lib/media/enablement";
import { meterConnectorCall } from "@/lib/connectors/metering";
import { hardenImagePrompt } from "@/lib/media/prompt";
import { deriveImageRiskFlags } from "@/lib/media/risk";
import { storeGeneratedMedia } from "@/lib/media/storage";
import { getAppSettings } from "@/lib/settings/store";
import { recordUsageEvent } from "@/lib/ai-usage/persistence";

/**
 * Generate a video (Veo) — async. Two modes in one route:
 *   start: { prompt, aspect_ratio?, duration_seconds? } -> 201 { ok, status:"running", operationName, model }
 *   poll:  { operation_name, prompt?, model? } -> 200 { ok, status:"running" } | 201 { ok, status:"done", media, objectPath }
 * Flag- + credential-guarded; key + storage stay server-side. No outbound.
 */
export async function POST(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;
  const access = await resolveMediaGeneration(allowed.scope.workspaceId);
  if (!access.enabled) return fail("not_configured", access.reason, 503);
  const payload = await readJson(request);
  if (payload === INVALID_JSON || typeof payload !== "object" || payload === null) {
    return fail("rejected", "Request body must be valid JSON.", 400);
  }
  const body = payload as Record<string, unknown>;
  const settings = await getAppSettings(allowed.scope.orgId);
  // Precedence: Advanced override -> turn level (body.level) -> workspace default
  // level -> env/default. Computed each call; the poll request may omit body.level
  // (start already picked the model), so it falls back safely either way.
  const level = parseArcRoute(body.level ?? settings.markDefaultRoute);
  const provider = getMediaProviderWithKey(access.credential, { level, imageModel: settings.imageModel, videoModel: settings.videoModel });

  const operationName = typeof body.operation_name === "string" ? body.operation_name.trim() : "";

  try {
    if (operationName) {
      const result = await provider.pollVideo(operationName);
      if (result.status === "running") return NextResponse.json({ ok: true, status: "running" }, { status: 200 });
      const objectPath = `arc-generated/${allowed.scope.orgId}/${allowed.scope.workspaceId}/${randomUUID()}.mp4`;
      const url = await storeGeneratedMedia(objectPath, result.bytes, result.contentType);
      // Best-effort usage metering — count one generation when the video lands.
      await recordUsageEvent({
        orgId: allowed.scope.orgId,
        workspaceId: allowed.scope.workspaceId,
        service: "gemini_video",
        model: typeof body.model === "string" ? body.model : "veo",
        units: 1,
        metadata: { route: "generate-video", job_id: typeof body.job_id === "string" ? body.job_id : null },
      });
      const media = {
        kind: "video" as const,
        url,
        source: "ai_generated" as const,
        model: typeof body.model === "string" ? body.model : "veo",
        ...(typeof body.job_id === "string" ? { jobId: body.job_id } : {}),
        riskFlags: typeof body.prompt === "string" ? deriveImageRiskFlags(body.prompt) : [],
      };
      return NextResponse.json({ ok: true, status: "done", media, objectPath }, { status: 201 });
    }
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return fail("rejected", "prompt is required to start a video.", 400);
    // Gate only the START of a new video (polls of in-flight jobs always finish —
    // that cost is already incurred). Non-blocking until enforcement is armed.
    const gate = await checkUsageAllowed(allowed.scope.orgId);
    if (!gate.allowed) {
      return fail("plan_limit", usageBlockMessage(gate), 402);
    }
    const aspectRatio =
      typeof body.aspect_ratio === "string" && body.aspect_ratio.trim() ? body.aspect_ratio.trim() : "16:9";
    const durationSeconds = typeof body.duration_seconds === "number" ? body.duration_seconds : undefined;
    // Spend-cap the START only (a poll of an in-flight job finishes work whose
    // cost is already incurred). Video ≈ 10 image-units in the rate table.
    const metered = await meterConnectorCall(
      undefined,
      { orgId: allowed.scope.orgId, workspaceId: allowed.scope.workspaceId, connectorKey: MEDIA_CONNECTOR_KEY, estimatedUnits: 10, costTier: access.costTier, context: { route: "generate-video" } },
      () => provider.startVideo({ prompt: hardenImagePrompt(prompt), aspectRatio, durationSeconds }),
    );
    if (!metered.ok) return fail("plan_limit", metered.refusal.message, 402);
    const start = metered.result;
    return NextResponse.json(
      { ok: true, status: "running", operationName: start.operationName, model: start.model, jobId: start.jobId },
      { status: 201 },
    );
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Video generation failed.", 502);
  }
}
