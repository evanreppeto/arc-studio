import { type SupabaseClient } from "@supabase/supabase-js";

import {
  PRICING_VERSION,
  estimateClaudeCostCents,
  estimateEmbeddingCostCents,
  estimateMediaCostCents,
  isPricedUsage,
  type AiUsageService,
  type MediaUsageService,
} from "@/domain";
import { reportDegraded } from "@/lib/observability/report-degraded";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

export type RecordUsageInput = {
  orgId: string;
  /**
   * Null for org-scoped services. The Brain is org-scoped — `knowledge_nodes`
   * has an org_id and no workspace_id — so an embedding has no workspace to
   * attribute to, and resolving a "default" one would fabricate an attribution
   * rather than record the absence of one. Null means org-scoped, not lost.
   */
  workspaceId: string | null;
  service: AiUsageService;
  model: string;
  actorUser?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  units?: number | null;
  taskId?: string | null;
  campaignId?: string | null;
  metadata?: Record<string, unknown>;
};

export type RecordUsageResult =
  | { recorded: true; id: string; costCents: number }
  | { recorded: false; reason: "not_configured" | "error" };

/** Compute the estimated cost (cents) for a usage event from the pricing module. */
function costForInput(input: RecordUsageInput): number {
  if (input.service === "arc_claude") {
    return estimateClaudeCostCents(input.model, input.inputTokens, input.outputTokens);
  }
  // Embeddings are billed per input token, not per generation, so they do not go
  // through the media path — `units` on an embedding row is characters.
  if (input.service === "gemini_embedding") {
    return estimateEmbeddingCostCents(input.model, input.inputTokens);
  }
  return estimateMediaCostCents(input.service as MediaUsageService, input.units);
}

/**
 * Record one AI usage event into the `ai_usage_events` ledger. Best-effort:
 * returns a result object and never throws, so a ledger failure can't break an
 * Arc reply or a media generation. No-ops cleanly when Supabase is unconfigured.
 */
export async function recordUsageEvent(input: RecordUsageInput): Promise<RecordUsageResult> {
  if (!isSupabaseAdminConfigured()) {
    return { recorded: false, reason: "not_configured" };
  }

  const costCents = costForInput(input);
  // `ai_usage_events` isn't in the generated Database types yet, so use the
  // established untyped-client cast (see src/lib/personas/persistence.ts).
  const db = getSupabaseAdminClient() as unknown as SupabaseClient;

  try {
    const { data, error } = await db
      .from("ai_usage_events")
      .insert({
        org_id: input.orgId,
        workspace_id: input.workspaceId ?? null,
        actor_user: input.actorUser ?? null,
        service: input.service,
        model: input.model,
        input_tokens: input.inputTokens ?? null,
        output_tokens: input.outputTokens ?? null,
        units: input.units ?? null,
        cost_estimate_cents: costCents,
        task_id: input.taskId ?? null,
        campaign_id: input.campaignId ?? null,
        metadata: {
          ...(input.metadata ?? {}),
          pricing_version: PRICING_VERSION,
          priced_model: isPricedUsage(input.service, input.model),
        },
      })
      .select("id")
      .single();

    if (error || !data) {
      // A metering failure is UNBILLED CONSUMPTION, not a logging nuisance: the
      // spend happened, we just no longer know about it. A console.warn in a
      // serverless function is effectively invisible, so this reports (BSR-502).
      reportDegraded(new Error(error?.message ?? "recordUsageEvent returned no row"), {
        scope: "ai-usage.record",
        surface: "primary",
        detail: { orgId: input.orgId, service: input.service, model: input.model },
      });
      return { recorded: false, reason: "error" };
    }

    // The model has no price entry, so this event was recorded at ZERO cost. The
    // row already carries `priced_model: false` and has done for every
    // claude-sonnet-5 turn on prod — 36 of them, ~42k output tokens, all free —
    // and nothing ever surfaced it. Recording a fact nobody reads is not
    // detection, so an unpriced model now reports (BSR-502).
    if (!isPricedUsage(input.service, input.model)) {
      reportDegraded(new Error(`AI usage recorded for an unpriced model: ${input.model}`), {
        scope: "ai-usage.unpriced-model",
        surface: "primary",
        detail: {
          model: input.model,
          service: input.service,
          orgId: input.orgId,
          inputTokens: input.inputTokens ?? null,
          outputTokens: input.outputTokens ?? null,
          pricingVersion: PRICING_VERSION,
        },
      });
    }

    return { recorded: true, id: (data as { id: string }).id, costCents };
  } catch (err) {
    reportDegraded(err, {
      scope: "ai-usage.record",
      surface: "primary",
      detail: { orgId: input.orgId, service: input.service, model: input.model },
    });
    return { recorded: false, reason: "error" };
  }
}
