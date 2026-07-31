/**
 * AI usage cost model — pure, deterministic, no I/O.
 *
 * Prices are ESTIMATES, maintained here as the single source of truth and stamped
 * with PRICING_VERSION onto each ledger row's metadata so historical rows stay
 * correct after a price change. All figures are cents.
 */

export const PRICING_VERSION = "2026-07-31";

export type AiUsageService =
  | "arc_claude"
  | "gemini_image"
  | "gemini_video"
  | "gemini_embedding"
  | "gemini_text";

/** Services billed per generation, not per token. */
export type MediaUsageService = "gemini_image" | "gemini_video";

type ModelRate = { inputCentsPerMTok: number; outputCentsPerMTok: number };

/** Per-model token pricing, in cents per 1,000,000 tokens. */
const MODEL_PRICING: Record<string, ModelRate> = {
  "claude-opus-4-8": { inputCentsPerMTok: 1500, outputCentsPerMTok: 7500 },
  // Added 2026-07-31. It had been running in production since 2026-07-10 with no
  // entry here, so `resolveModelRate` returned null and every turn was recorded
  // at ZERO cost — 36 events, ~42k output tokens, 52% of the whole ledger. Rate
  // supplied by the operator rather than inferred; guessing a price in a billing
  // meter turns a visible zero into an invisible wrong number (BSR-502).
  "claude-sonnet-5": { inputCentsPerMTok: 300, outputCentsPerMTok: 1500 },
  "claude-haiku-4-5": { inputCentsPerMTok: 100, outputCentsPerMTok: 500 },
};

/** Per-generation media pricing, in cents per unit. */
const MEDIA_PRICING: Record<MediaUsageService, number> = {
  gemini_image: 4,
  gemini_video: 200,
};

/**
 * Embedding pricing, cents per 1,000,000 input tokens.
 *
 * DELIBERATELY EMPTY. The embedding path is now metered — volume, model and
 * character counts all reach the ledger — but no rate has been supplied, so
 * every embedding row records a cost of ZERO.
 *
 * That is the same shape as the claude-sonnet-5 hole this audit found, with one
 * decisive difference: it is LOUD. `recordUsageEvent` reports an unpriced model
 * to Sentry (`ai-usage.unpriced-model`), so a zero here announces itself instead
 * of sitting in the ledger for three weeks. Recording the volume now is what
 * makes a backfill possible the moment a real rate arrives — the rows will
 * exist, with exact character counts on them.
 *
 * Do NOT populate this by inference. A plausible wrong price in a billing meter
 * replaces a visible zero with an invisible error, which is strictly worse.
 */
const EMBEDDING_PRICING: Record<string, number> = {};

/** Resolve an embedding model's per-Mtok input rate, or null when unpriced. */
export function resolveEmbeddingRate(model: string): number | null {
  if (model in EMBEDDING_PRICING) return EMBEDDING_PRICING[model];
  for (const [id, rate] of Object.entries(EMBEDDING_PRICING)) {
    if (model.startsWith(id)) return rate;
  }
  return null;
}

/**
 * Gemini bills embeddings per input token but — on the developer API — returns
 * no token count for `embedContent`: `billableCharacterCount` and the per-
 * embedding `statistics` are Enterprise-only fields. So the token figure on an
 * embedding row is ESTIMATED from characters at the usual ~4-chars-per-token
 * approximation, and the row records the exact character count in `units`
 * alongside it.
 *
 * The estimate is flagged in row metadata (`token_source`) precisely so nobody
 * later mistakes it for a measured value and reconciles an invoice against it.
 */
export const CHARS_PER_TOKEN_ESTIMATE = 4;

export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * Gemini text-generation pricing, cents per 1,000,000 tokens.
 *
 * DELIBERATELY EMPTY, for the same reason as EMBEDDING_PRICING: no published
 * rate has been supplied and inferring one would put an invisible wrong number
 * where a visible zero is safer. Unlike embeddings, these rows carry MEASURED
 * token counts, so a backfill here is exact arithmetic the day a rate arrives.
 */
const GEMINI_TEXT_PRICING: Record<string, ModelRate> = {};

/** Resolve a Gemini text model's rate: exact id first, then a known-prefix match. */
export function resolveGeminiTextRate(model: string): ModelRate | null {
  if (GEMINI_TEXT_PRICING[model]) return GEMINI_TEXT_PRICING[model];
  for (const [id, rate] of Object.entries(GEMINI_TEXT_PRICING)) {
    if (model.startsWith(id)) return rate;
  }
  return null;
}

/** Estimated cost (cents) of a Gemini text call. Unpriced model -> 0. */
export function estimateGeminiTextCostCents(
  model: string,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number {
  const rate = resolveGeminiTextRate(model);
  if (!rate) return 0;
  const cents =
    ((inputTokens ?? 0) * rate.inputCentsPerMTok + (outputTokens ?? 0) * rate.outputCentsPerMTok) / 1_000_000;
  return Math.round(cents);
}

/** The token fields Gemini returns on `generateContent`. All optional. */
export type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount?: number;
};

export type FoldedGeminiUsage = {
  inputTokens: number;
  outputTokens: number;
  /** The raw fields, preserved so the fold above stays auditable and reversible. */
  breakdown: Record<string, number | null>;
};

/**
 * Collapse Gemini's usage block into the ledger's two token columns.
 *
 * The mapping is NOT the obvious one, and the obvious one undercounts:
 *
 *  - `thoughtsTokenCount` is the model's reasoning output on 2.5-series models.
 *    It is billed as output and is NOT included in `candidatesTokenCount`.
 *  - `toolUsePromptTokenCount` is tool results fed back to the model. It is
 *    billed as input and is NOT included in `promptTokenCount`. For a GROUNDED
 *    web search — the whole point of the research call site — this is where the
 *    bulk of the tokens live.
 *
 * Reading only prompt/candidates would therefore reproduce Finding 3 in a new
 * place: a plausible-looking token count that silently omits most of the spend.
 * Google's own definition of `totalTokenCount` is the sum of all four, which is
 * the check this fold is built to satisfy.
 *
 * `cachedContentTokenCount` is reported but NOT added: `promptTokenCount`
 * already includes it. It is kept in the breakdown because cached tokens bill at
 * a different rate, so pricing them correctly later needs the split.
 */
export function foldGeminiTextUsage(usage: GeminiUsageMetadata | null | undefined): FoldedGeminiUsage {
  const n = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  const raw = (v: number | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
  return {
    inputTokens: n(usage?.promptTokenCount) + n(usage?.toolUsePromptTokenCount),
    outputTokens: n(usage?.candidatesTokenCount) + n(usage?.thoughtsTokenCount),
    breakdown: {
      prompt_token_count: raw(usage?.promptTokenCount),
      candidates_token_count: raw(usage?.candidatesTokenCount),
      thoughts_token_count: raw(usage?.thoughtsTokenCount),
      tool_use_prompt_token_count: raw(usage?.toolUsePromptTokenCount),
      cached_content_token_count: raw(usage?.cachedContentTokenCount),
      total_token_count: raw(usage?.totalTokenCount),
    },
  };
}

/** Estimated cost (cents) of an embedding call. Unpriced model -> 0. */
export function estimateEmbeddingCostCents(
  model: string,
  inputTokens: number | null | undefined,
): number {
  const rate = resolveEmbeddingRate(model);
  if (rate === null) return 0;
  return Math.round(((inputTokens ?? 0) * rate) / 1_000_000);
}

/** Resolve a model's token rate: exact id first, then a known-prefix match. */
export function resolveModelRate(model: string): ModelRate | null {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  for (const [id, rate] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(id)) return rate;
  }
  return null;
}

export function isPricedModel(model: string): boolean {
  return resolveModelRate(model) !== null;
}

/**
 * Can this (service, model) pair produce a non-zero cost? Service-aware, because
 * "priced" means a different table per service and a Claude-only check would
 * report every embedding as priced-at-zero without ever saying so. Media is
 * priced per generation, so the model id is irrelevant there.
 */
export function isPricedUsage(service: AiUsageService, model: string): boolean {
  if (service === "arc_claude") return isPricedModel(model);
  if (service === "gemini_embedding") return resolveEmbeddingRate(model) !== null;
  if (service === "gemini_text") return resolveGeminiTextRate(model) !== null;
  return true;
}

/** Estimated cost (cents) of a Claude turn. Unknown model -> 0. */
export function estimateClaudeCostCents(
  model: string,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number {
  const rate = resolveModelRate(model);
  if (!rate) return 0;
  const inTok = inputTokens ?? 0;
  const outTok = outputTokens ?? 0;
  const cents = (inTok * rate.inputCentsPerMTok + outTok * rate.outputCentsPerMTok) / 1_000_000;
  return Math.round(cents);
}

/** Estimated cost (cents) of N media generations. Missing units -> 1. */
export function estimateMediaCostCents(
  service: MediaUsageService,
  units: number | null | undefined,
): number {
  const count = units ?? 1;
  return MEDIA_PRICING[service] * count;
}

export type UsageRollupEvent = {
  service: AiUsageService;
  model: string;
  actorUser: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  units: number | null;
  costCents: number;
  occurredAt: string; // ISO timestamp
};

export type ServiceRollup = {
  service: AiUsageService;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  units: number;
  count: number;
};

export type ModelRollup = { model: string; costCents: number; count: number };
export type UserRollup = {
  actorUser: string | null;
  costCents: number;
  count: number;
  inputTokens: number;
  outputTokens: number;
  units: number;
};

export type UsageSummary = {
  totalCostCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalUnits: number;
  eventCount: number;
  byService: ServiceRollup[];
  byModel: ModelRollup[];
  byUser: UserRollup[];
};

export function summarizeUsage(events: UsageRollupEvent[]): UsageSummary {
  const summary: UsageSummary = {
    totalCostCents: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalUnits: 0,
    eventCount: events.length,
    byService: [],
    byModel: [],
    byUser: [],
  };

  const services = new Map<AiUsageService, ServiceRollup>();
  const models = new Map<string, ModelRollup>();
  const users = new Map<string, UserRollup>();

  for (const e of events) {
    const inTok = e.inputTokens ?? 0;
    const outTok = e.outputTokens ?? 0;
    const units = e.units ?? 0;

    summary.totalCostCents += e.costCents;
    summary.totalInputTokens += inTok;
    summary.totalOutputTokens += outTok;
    summary.totalUnits += units;

    const svc = services.get(e.service) ?? {
      service: e.service,
      costCents: 0,
      inputTokens: 0,
      outputTokens: 0,
      units: 0,
      count: 0,
    };
    svc.costCents += e.costCents;
    svc.inputTokens += inTok;
    svc.outputTokens += outTok;
    svc.units += units;
    svc.count += 1;
    services.set(e.service, svc);

    const mdl = models.get(e.model) ?? { model: e.model, costCents: 0, count: 0 };
    mdl.costCents += e.costCents;
    mdl.count += 1;
    models.set(e.model, mdl);

    // The leading space is load-bearing: this is only a Map key, and actorUser is
    // caller-supplied, so an unspaced "autonomous" would silently merge a real user
    // of that name into the Arc bucket. The key never escapes — the row below keeps
    // the original actorUser (null when autonomous), which is what the UI renders.
    const userKey = e.actorUser ?? " autonomous";
    const usr = users.get(userKey) ?? {
      actorUser: e.actorUser,
      costCents: 0,
      count: 0,
      inputTokens: 0,
      outputTokens: 0,
      units: 0,
    };
    usr.costCents += e.costCents;
    usr.count += 1;
    usr.inputTokens += inTok;
    usr.outputTokens += outTok;
    usr.units += units;
    users.set(userKey, usr);
  }

  const byCostDesc = (a: { costCents: number }, b: { costCents: number }) => b.costCents - a.costCents;
  summary.byService = [...services.values()].sort(byCostDesc);
  summary.byModel = [...models.values()].sort(byCostDesc);
  summary.byUser = [...users.values()].sort(byCostDesc);
  return summary;
}

/** Bucket event cost into the supplied ordered ISO date keys (YYYY-MM-DD, UTC). */
export function bucketCostByDay(
  events: UsageRollupEvent[],
  dayKeys: string[],
): Array<{ date: string; costCents: number }> {
  const totals = new Map<string, number>(dayKeys.map((d) => [d, 0]));
  for (const e of events) {
    const day = e.occurredAt.slice(0, 10);
    if (totals.has(day)) totals.set(day, (totals.get(day) ?? 0) + e.costCents);
  }
  return dayKeys.map((date) => ({ date, costCents: totals.get(date) ?? 0 }));
}

export type UsageSummaryCard = {
  totalCostCents: number;
  totalTokens: number;
  totalRuns: number;
  /** Percent of the soft cap, rounded; 0 when no cap is set. */
  pctOfCap: number;
  /** True at or above 80% of the soft cap. */
  isNearCap: boolean;
};

/**
 * Collapse a UsageSummary into the headline numbers for the Settings → Usage card.
 * `softCapCents` is the workspace's optional spend ceiling; when unset (0/undefined)
 * there is no cap and pctOfCap is 0. Pure — no I/O.
 */
export function summarizeUsageForSettings(summary: UsageSummary, softCapCents?: number): UsageSummaryCard {
  const cap = softCapCents ?? 0;
  const pctOfCap = cap > 0 ? Math.round((summary.totalCostCents / cap) * 100) : 0;
  return {
    totalCostCents: summary.totalCostCents,
    totalTokens: summary.totalInputTokens + summary.totalOutputTokens,
    totalRuns: summary.eventCount,
    pctOfCap,
    isNearCap: cap > 0 && pctOfCap >= 80,
  };
}
