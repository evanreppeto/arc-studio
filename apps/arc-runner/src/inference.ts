import { query } from "@anthropic-ai/claude-agent-sdk";

/**
 * The work tiers the app routes to. Mirrors payload.route. Operator-facing these
 * are the Arc Pulse / Drive / Deep tiers (see docs/MODEL-SELECTION.md):
 *   fast → Arc Pulse (Instant) · standard → Arc Drive (Balanced) · deep → Arc Deep (Maximum)
 * `deep` is defined but not yet routed — the app only emits fast/standard today.
 */
export type ArcRoute = "fast" | "standard" | "deep";

/**
 * Per-turn inference settings for the Agent SDK query() call.
 *
 * Arc Pulse (fast) rides Sonnet with a light thinking budget so it reasons a beat
 * without feeling slow; Arc Drive (standard: drafting, scans, campaign tasks)
 * rides Opus with a deep thinking budget; Arc Deep (max, dormant) reserves the
 * frontier tier for the hardest long-horizon runs. `fallbackModel` keeps a turn
 * alive if the primary is unavailable; `maxTurns` + `maxBudgetUsd` are runaway
 * rails that keep every path safe to run multi-tenant.
 *
 * These are the smartness/cost dials — tune them HERE, in one place.
 */
export type InferenceSettings = {
  model: string;
  fallbackModel: string;
  maxThinkingTokens: number;
  maxTurns: number;
  maxBudgetUsd: number;
};

// Arc Pulse — Instant. Sonnet 5 supersedes 4.6 (near-Opus quality at Sonnet cost,
// adaptive thinking on by default). Its tokenizer is ~30% heavier than 4.6, so the
// budget rail is bumped to keep the same effective headroom per turn.
const FAST: InferenceSettings = {
  model: "claude-sonnet-5",
  fallbackModel: "claude-haiku-4-5",
  maxThinkingTokens: 2_000,
  maxTurns: 12,
  maxBudgetUsd: 1,
};

// Arc Drive — Balanced. The default workhorse tier.
const STANDARD: InferenceSettings = {
  model: "claude-opus-4-8",
  fallbackModel: "claude-sonnet-5",
  maxThinkingTokens: 10_000,
  maxTurns: 24,
  maxBudgetUsd: 3,
};

// Arc Deep — Maximum. For right now the ceiling is Opus 4.8: Deep runs the same
// model as Drive but at maximum deliberation — deeper thinking budget, more turns,
// higher spend cap. Claude Fable 5 is the intended future occupant here once its
// operational requirements (30-day data retention, refusal/fallback handling) are
// cleared — swap the model string to enable. DORMANT: no route emits "deep" yet.
const DEEP: InferenceSettings = {
  model: "claude-opus-4-8",
  fallbackModel: "claude-opus-4-7",
  maxThinkingTokens: 24_000,
  maxTurns: 36,
  maxBudgetUsd: 8,
};

// The draft critic — an independent, read-only claims reviewer. Checking copy
// against workspace evidence is well within Sonnet, and the pass runs once per
// asset (a campaign package is ~4-7 of these), so the tier is picked for cost.
// The budget rail is tight on purpose: a critic that needs $0.50 of tool calls
// to check one email has lost the plot.
const CRITIC: InferenceSettings = {
  model: "claude-sonnet-5",
  fallbackModel: "claude-haiku-4-5",
  maxThinkingTokens: 4_000,
  maxTurns: 14,
  maxBudgetUsd: 0.5,
};

export function inferenceForRoute(route: ArcRoute): InferenceSettings {
  if (route === "deep") return DEEP;
  return route === "standard" ? STANDARD : FAST;
}

export function inferenceForCritic(): InferenceSettings {
  return CRITIC;
}

/**
 * The options object passed to the SDK's query(). Derived from the SDK's own
 * signature so it stays correct across SDK upgrades.
 */
type QueryOptions = NonNullable<Parameters<typeof query>[0]["options"]>;

/**
 * Build the query() options from per-turn inference settings, keeping the
 * outbound-safe permission posture. Pure + typed so it's unit-testable without
 * the SDK actually running.
 */
export function buildQueryOptions(args: {
  inference: InferenceSettings;
  systemPrompt: string;
  mcpServers: QueryOptions["mcpServers"];
  allowedTools: string[];
}): QueryOptions {
  return {
    systemPrompt: args.systemPrompt,
    model: args.inference.model,
    fallbackModel: args.inference.fallbackModel,
    // `maxThinkingTokens` is deprecated in the SDK and, on current models, is
    // only read as on/off — it does not describe how thinking is produced or
    // whether it reaches the stream. Arc has never captured a single character
    // of reasoning in production (BSR-573) while setting only this field, so
    // state the intent explicitly: these models support adaptive thinking, and
    // `thinking` takes precedence over the deprecated dial.
    thinking: { type: "adaptive" },
    maxThinkingTokens: args.inference.maxThinkingTokens,
    maxTurns: args.inference.maxTurns,
    maxBudgetUsd: args.inference.maxBudgetUsd,
    mcpServers: args.mcpServers,
    allowedTools: args.allowedTools,
    permissionMode: "bypassPermissions",
    // Emit token deltas so the reply can be typed out live; the final
    // assistant/result messages still land.
    includePartialMessages: true,
  };
}
