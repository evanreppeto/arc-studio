/**
 * AI usage cost model — pure, deterministic, no I/O.
 *
 * Prices are ESTIMATES, maintained here as the single source of truth and stamped
 * with PRICING_VERSION onto each ledger row's metadata so historical rows stay
 * correct after a price change. All figures are cents.
 */

export const PRICING_VERSION = "2026-06-22";

export type AiUsageService = "arc_claude" | "gemini_image" | "gemini_video";

type ModelRate = { inputCentsPerMTok: number; outputCentsPerMTok: number };

/** Per-model token pricing, in cents per 1,000,000 tokens. */
const MODEL_PRICING: Record<string, ModelRate> = {
  "claude-opus-4-8": { inputCentsPerMTok: 1500, outputCentsPerMTok: 7500 },
  "claude-haiku-4-5": { inputCentsPerMTok: 100, outputCentsPerMTok: 500 },
};

/** Per-generation media pricing, in cents per unit. */
const MEDIA_PRICING: Record<Exclude<AiUsageService, "arc_claude">, number> = {
  gemini_image: 4,
  gemini_video: 200,
};

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
  service: Exclude<AiUsageService, "arc_claude">,
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
