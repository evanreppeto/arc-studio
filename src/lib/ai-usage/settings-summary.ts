// ---------------------------------------------------------------------------
// Settings → Usage & billing inline summary. Wraps the (UI-unused) AI-usage
// read-model + the purpose-built summarizeUsageForSettings card into the shape
// the Settings Usage section renders. Live via loadWorkspaceUsage; a realistic
// BSR demo card in the offline preview (ARC_DEMO_DATA); zeros otherwise.
// Read-only display — the full breakdown lives on the Usage report.
// ---------------------------------------------------------------------------

import { DEFAULT_PLAN_TIER, planCapCents, planForTier, summarizeUsageForSettings, type UsageSummaryCard } from "@/domain";
import { getCurrentOrgId } from "@/lib/auth/org";
import { resolveOrgPlan } from "@/lib/billing/entitlements";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";

import { loadWorkspaceUsage, type RecentUsageRow } from "./read-model";

// Illustrative cap for the offline demo card only; the live path uses the org's
// real plan cap resolved from org_plans (see @/lib/billing/entitlements). Kept in
// step with the demo billing view (Starter / $100) so both panels agree offline.
const DEMO_CAP_CENTS = 10_000;

export type UsageDailyPoint = { date: string; costCents: number };
export type UsageRecentRow = { occurredAt: string; actor: string; model: string; service: string; tokens: number; costCents: number };
export type UsageModelRow = { model: string; costCents: number; count: number };

export type SettingsUsageView = {
  isDemo: boolean;
  configured: boolean;
  tokensLabel: string;
  runsLabel: string;
  costLabel: string;
  capLabel: string;
  /** Plan tier label (e.g. "Pro") backing the cap, when resolved. */
  planLabel?: string;
  pctOfCap: number;
  isNearCap: boolean;
  rangeLabel: string;
  daily: UsageDailyPoint[];
  recent: UsageRecentRow[];
  byModel: UsageModelRow[];
};

const USD2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const USD0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("en-US");

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return NUM.format(n);
}

/** Pure: a usage card + breakdowns → the Settings Usage view-model. */
export function toUsageView(
  card: UsageSummaryCard,
  isDemo: boolean,
  configured: boolean,
  daily: UsageDailyPoint[] = [],
  recent: UsageRecentRow[] = [],
  byModel: UsageModelRow[] = [],
  capCents: number = planCapCents(DEFAULT_PLAN_TIER),
  planLabel: string = planForTier(DEFAULT_PLAN_TIER).label,
): SettingsUsageView {
  return {
    isDemo,
    configured,
    tokensLabel: formatTokens(card.totalTokens),
    runsLabel: NUM.format(card.totalRuns),
    costLabel: USD2.format(card.totalCostCents / 100),
    capLabel: USD0.format(capCents / 100),
    planLabel,
    pctOfCap: card.pctOfCap,
    isNearCap: card.isNearCap,
    rangeLabel: "Last 30 days",
    daily,
    recent,
    byModel,
  };
}

const ZERO_CARD: UsageSummaryCard = { totalCostCents: 0, totalTokens: 0, totalRuns: 0, pctOfCap: 0, isNearCap: false };

/** RecentUsageRow (read-model) → the flattened display row the Usage tab renders. */
function toRecentRows(rows: RecentUsageRow[]): UsageRecentRow[] {
  return rows.map((r) => ({
    occurredAt: r.occurredAt,
    actor: r.actorUser ?? "Arc",
    model: r.model,
    service: r.service,
    tokens: (r.inputTokens ?? 0) + (r.outputTokens ?? 0),
    costCents: r.costCents,
  }));
}

// ---- demo fallback (offline preview): a believable BSR month ----
function demoDaily(now: Date): UsageDailyPoint[] {
  const out: UsageDailyPoint[] = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const weekend = [0, 6].includes(d.getUTCDay());
    const wave = 150 + Math.round(70 * Math.sin(i / 2.3));
    out.push({ date: d.toISOString().slice(0, 10), costCents: Math.max(20, wave - (weekend ? 70 : 0)) });
  }
  return out;
}
function demoRecent(now: Date): UsageRecentRow[] {
  const at = (mins: number) => new Date(now.getTime() - mins * 60_000).toISOString();
  return [
    { occurredAt: at(9), actor: "Arc", model: "claude-opus-4-8", service: "text", tokens: 18_420, costCents: 34 },
    { occurredAt: at(41), actor: "Arc", model: "gemini-3-pro-image", service: "image", tokens: 0, costCents: 24 },
    { occurredAt: at(96), actor: "priya@bigshouldersrestoration.com", model: "claude-opus-4-8", service: "text", tokens: 9_640, costCents: 18 },
    { occurredAt: at(60 * 3), actor: "Arc", model: "veo-3.1-generate-preview", service: "video", tokens: 0, costCents: 120 },
    { occurredAt: at(60 * 6), actor: "Arc", model: "claude-haiku-4-5", service: "text", tokens: 4_100, costCents: 3 },
    { occurredAt: at(60 * 20), actor: "dana@bigshouldersrestoration.com", model: "gemini-3-pro-image", service: "image", tokens: 0, costCents: 24 },
    { occurredAt: at(60 * 27), actor: "Arc", model: "claude-opus-4-8", service: "text", tokens: 22_800, costCents: 41 },
    { occurredAt: at(60 * 44), actor: "Arc", model: "veo-3.1-fast-generate-preview", service: "video", tokens: 0, costCents: 60 },
  ];
}
function demoByModel(): UsageModelRow[] {
  return [
    { model: "claude-opus-4-8", costCents: 2380, count: 176 },
    { model: "gemini-3-pro-image", costCents: 1320, count: 55 },
    { model: "veo-3.1-generate-preview", costCents: 840, count: 12 },
    { model: "claude-haiku-4-5", costCents: 340, count: 69 },
  ];
}

function demoUsageView(now: Date): SettingsUsageView {
  // Believable BSR month: ~1.84M tokens, 312 agent runs, $48.80 → 49% of the $100 Starter cap.
  const card: UsageSummaryCard = { totalCostCents: 4880, totalTokens: 1_842_000, totalRuns: 312, pctOfCap: 49, isNearCap: false };
  return toUsageView(card, true, true, demoDaily(now), demoRecent(now), demoByModel(), DEMO_CAP_CENTS, "Starter");
}

export async function getSettingsUsageView(): Promise<SettingsUsageView> {
  // Deliberately NOT caught here (BSR-575).
  //
  // `loadWorkspaceUsage` already returns an unconfigured result for every
  // legitimate "nothing to report" case — no Supabase, no workspace context, no
  // workspace id — so the only thing a catch at this level can swallow is a real
  // query failure. Swallowed, it fell through to ZERO_CARD below and rendered
  // "$0 spent, 0% of cap" over an outage: a false statement about money, which
  // an operator either relaxes about or files a bug over.
  //
  // Worse, it made the caller's own care pointless. settings/page.tsx wraps this
  // call in a PRIMARY reportDegraded handler whose comment says exactly why
  // spend must not fail to null — and that handler could never fire, because
  // this function had already turned the failure into a plausible view. Let it
  // throw; the page is the layer that decides how to say so.
  const usage = await loadWorkspaceUsage("30d");
  if (usage?.configured) {
    // Resolve the org's real plan cap so both the % and the label reflect billing.
    const plan = await resolveOrgPlan(await getCurrentOrgId().catch(() => "")).catch(() => null);
    const capCents = plan?.capCents ?? planCapCents(DEFAULT_PLAN_TIER);
    const planLabel = planForTier(plan?.tier ?? DEFAULT_PLAN_TIER).label;
    return toUsageView(
      summarizeUsageForSettings(usage.summary, capCents),
      false,
      true,
      usage.daily,
      toRecentRows(usage.recent),
      usage.summary.byModel,
      capCents,
      planLabel,
    );
  }

  if (isDemoDataEnabled()) return demoUsageView(new Date());

  return toUsageView(ZERO_CARD, false, false);
}
