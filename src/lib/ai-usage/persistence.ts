import { type SupabaseClient } from "@supabase/supabase-js";

import {
  PRICING_VERSION,
  centsFromMicrocents,
  cacheTokensFromUsageDetail,
  estimateClaudeCostMicrocents,
  estimateEmbeddingCostMicrocents,
  estimateGeminiTextCostMicrocents,
  estimateMediaCostMicrocents,
  isPricedUsage,
  type AiUsageService,
  type MediaUsageService,
} from "@/domain";
import { reportDegraded } from "@/lib/observability/report-degraded";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { soleWorkspaceIdForOrg } from "@/lib/tenancy/resolve-workspace";

export type RecordUsageInput = {
  orgId: string;
  /**
   * The workspace this usage belongs to, or null to let `recordUsageEvent`
   * resolve it from the org.
   *
   * This used to say: "Null for org-scoped services. The Brain is org-scoped —
   * `knowledge_nodes` has an org_id and no workspace_id — so an embedding has no
   * workspace to attribute to." That was true when written and is now FALSE:
   * BSR-715 gave `knowledge_nodes` a `workspace_id NOT NULL`. The Brain is
   * workspace-scoped, so an embedding does have a workspace to attribute to, and
   * passing null no longer records "org-scoped" — it records nothing.
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

/**
 * Estimated cost in MICROCENTS for a usage event (BSR-502 Finding 5). Microcents
 * because rounding to whole cents per event floors every sub-half-cent call to
 * zero, and that floor only ever rounds down, so it cannot average out.
 *
 * Every token-priced service is routed EXPLICITLY. The media branch used to be
 * the fallthrough for "everything else", which silently swallowed `gemini_text`
 * when that service was added: `MEDIA_PRICING["gemini_text"]` is undefined, and
 * `undefined * units` is NaN — a cost that is neither a number nor an honest
 * zero, headed for an integer column. Naming each service means the next one
 * added fails typecheck here instead of computing NaN in production.
 */
function costMicrocentsForInput(input: RecordUsageInput): number {
  switch (input.service) {
    case "arc_claude":
      // The cached counts ride in on `metadata.usage_detail`, which the runner
      // has recorded since 2026-07-31. Reading them here is the whole fix: they
      // were captured, tested, and priced at zero for a week.
      return estimateClaudeCostMicrocents(
        input.model,
        input.inputTokens,
        input.outputTokens,
        cacheTokensFromUsageDetail((input.metadata as { usage_detail?: unknown } | undefined)?.usage_detail),
      );
    // Embeddings are billed per input token, not per generation, so they do not
    // go through the media path — `units` on an embedding row is characters.
    case "gemini_embedding":
      return estimateEmbeddingCostMicrocents(input.model, input.inputTokens);
    case "gemini_text":
      return estimateGeminiTextCostMicrocents(input.model, input.inputTokens, input.outputTokens);
    case "gemini_image":
    case "gemini_video":
      return estimateMediaCostMicrocents(input.service satisfies MediaUsageService, input.units);
  }
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

  const costMicrocents = costMicrocentsForInput(input);
  // `cost_estimate_cents` keeps its existing meaning (whole cents, rounded) so
  // every current reader is unaffected; `cost_microcents` is the precise value
  // that aggregation should sum. Derived from the same number, so they can never
  // disagree by more than the rounding itself.
  const costCents = centsFromMicrocents(costMicrocents);
  // `ai_usage_events` isn't in the generated Database types yet, so use the
  // established untyped-client cast (see src/lib/personas/persistence.ts).
  const db = getSupabaseAdminClient() as unknown as SupabaseClient;

  // Resolve rather than record a null (BSR-716). This used to write
  // `input.workspaceId ?? null`, which named the column without supplying a
  // value — 59 of 148 prod rows had no workspace, the newest written minutes
  // before this was found. Because this function is best-effort and never
  // throws, a NOT NULL column plus a null here would drop metering rows
  // SILENTLY, on the ledger already known to undercount.
  //
  // Same precedence as every backfill in this migration: the org's sole
  // workspace, and null only if that is genuinely ambiguous.
  const workspaceId = input.workspaceId ?? (await soleWorkspaceIdForOrg(db, input.orgId));

  try {
    const { data, error } = await db
      .from("ai_usage_events")
      .insert({
        org_id: input.orgId,
        workspace_id: workspaceId,
        actor_user: input.actorUser ?? null,
        service: input.service,
        model: input.model,
        input_tokens: input.inputTokens ?? null,
        output_tokens: input.outputTokens ?? null,
        units: input.units ?? null,
        cost_estimate_cents: costCents,
        cost_microcents: costMicrocents,
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
