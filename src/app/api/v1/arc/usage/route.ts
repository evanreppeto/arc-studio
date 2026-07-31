import { NextResponse } from "next/server";

import { INVALID_JSON, arcGuard, fail, readJson } from "@/app/api/v1/arc/_lib/http";
import { recordUsageEvent } from "@/lib/ai-usage/persistence";

/**
 * Arc reports token usage for a completed turn. Org/workspace come from the
 * bearer token scope (trustworthy); actor_user is advisory attribution threaded
 * from the operator. Best-effort on the runner side — a failure here never
 * affects the chat reply. No outbound.
 *
 *   POST /api/v1/arc/usage
 *   body: { model: string, input_tokens?: number, output_tokens?: number,
 *           actor_user?: string, task_id?: string, campaign_id?: string,
 *           metadata?: object }
 */
export async function POST(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;

  const payload = await readJson(request);
  if (payload === INVALID_JSON || typeof payload !== "object" || payload === null) {
    return fail("rejected", "Request body must be valid JSON.", 400);
  }
  const body = payload as Record<string, unknown>;

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) return fail("rejected", "model is required.", 400);

  const asCount = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

  // Usage fields the ledger has no column for — today, the prompt-cache token
  // counts (BSR-502 Finding 3). Recorded to metadata rather than given columns
  // because what the SDK reports is still being established; `usage_keys` in the
  // payload says what actually arrived, so the next reader is not inferring from
  // an absence. NOT priced: cache reads are cheaper than base input and cache
  // creation is dearer, and no rate enters the meter on a guess.
  const detail = body.usage_detail;
  const usageDetail =
    detail && typeof detail === "object" && !Array.isArray(detail)
      ? { usage_detail: detail as Record<string, unknown> }
      : {};

  const callerMetadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {};

  const result = await recordUsageEvent({
    orgId: allowed.scope.orgId,
    workspaceId: allowed.scope.workspaceId,
    service: "arc_claude",
    model,
    actorUser: typeof body.actor_user === "string" ? body.actor_user : null,
    inputTokens: asCount(body.input_tokens),
    outputTokens: asCount(body.output_tokens),
    taskId: typeof body.task_id === "string" ? body.task_id : null,
    campaignId: typeof body.campaign_id === "string" ? body.campaign_id : null,
    metadata: { ...callerMetadata, ...usageDetail },
  });

  if (!result.recorded) {
    // not_configured / error are both non-fatal: ack so the runner doesn't retry-storm.
    return NextResponse.json({ ok: true, status: "skipped", reason: result.reason }, { status: 202 });
  }
  return NextResponse.json({ ok: true, status: "recorded", id: result.id, costCents: result.costCents }, { status: 201 });
}
