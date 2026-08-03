import { type SupabaseClient } from "@supabase/supabase-js";

import {
  MICROCENTS_PER_CENT,
  bucketCostByDay,
  centsFromMicrocents,
  summarizeUsage,
  type UsageRollupEvent,
  type UsageSummary,
} from "@/domain";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

export type UsageRange = "7d" | "30d" | "90d";

export const USAGE_RANGES: UsageRange[] = ["7d", "30d", "90d"];
const RANGE_DAYS: Record<UsageRange, number> = { "7d": 7, "30d": 30, "90d": 90 };

export type RecentUsageRow = {
  occurredAt: string;
  actorUser: string | null;
  service: UsageRollupEvent["service"];
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  units: number | null;
  costCents: number;
};

export type WorkspaceUsage = {
  configured: boolean;
  workspaceName: string;
  range: UsageRange;
  summary: UsageSummary;
  previousTotalCostCents: number;
  daily: Array<{ date: string; costCents: number }>;
  recent: RecentUsageRow[];
};

type UsageEventRow = {
  occurred_at: string;
  actor_user: string | null;
  service: UsageRollupEvent["service"];
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  units: number | null;
  cost_estimate_cents: number;
  cost_microcents: number | null;
};

function emptyUsage(range: UsageRange, workspaceName: string): WorkspaceUsage {
  return {
    configured: false,
    workspaceName,
    range,
    summary: summarizeUsage([]),
    previousTotalCostCents: 0,
    daily: [],
    recent: [],
  };
}

function toRollup(row: UsageEventRow): UsageRollupEvent {
  return {
    service: row.service,
    model: row.model,
    actorUser: row.actor_user,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    units: row.units,
    costCents: row.cost_estimate_cents,
    costMicrocents: row.cost_microcents,
    occurredAt: row.occurred_at,
  };
}

/** UTC YYYY-MM-DD keys for the last `days` days, oldest first, ending today. */
function lastNDayKeys(days: number, now: Date): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

/**
 * Load the active workspace's AI usage for a time range: rolled-up summary,
 * a per-day cost series, the previous period's total (for the delta), and a
 * short recent-activity tail. Degrades to an empty, `configured:false` shape
 * when Supabase or a workspace isn't available.
 */
export async function loadWorkspaceUsage(range: UsageRange): Promise<WorkspaceUsage> {
  if (!isSupabaseAdminConfigured()) return emptyUsage(range, "This workspace");

  let workspaceId: string | null = null;
  let workspaceName = "This workspace";
  try {
    const ctx = await getCurrentWorkspaceContext();
    workspaceId = ctx.workspaceId;
    workspaceName = ctx.workspaceName;
  } catch {
    return emptyUsage(range, workspaceName);
  }
  if (!workspaceId) return emptyUsage(range, workspaceName);

  const days = RANGE_DAYS[range];
  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setUTCDate(rangeStart.getUTCDate() - (days - 1));
  rangeStart.setUTCHours(0, 0, 0, 0);
  const prevStart = new Date(rangeStart);
  prevStart.setUTCDate(prevStart.getUTCDate() - days);

  const db = getSupabaseAdminClient() as unknown as SupabaseClient;

  try {
    const [{ data: currentRows }, { data: prevRows }] = await Promise.all([
      db
        .from("ai_usage_events")
        .select("occurred_at,actor_user,service,model,input_tokens,output_tokens,units,cost_estimate_cents,cost_microcents")
        .eq("workspace_id", workspaceId)
        .gte("occurred_at", rangeStart.toISOString())
        .order("occurred_at", { ascending: false }),
      db
        .from("ai_usage_events")
        .select("cost_estimate_cents,cost_microcents")
        .eq("workspace_id", workspaceId)
        .gte("occurred_at", prevStart.toISOString())
        .lt("occurred_at", rangeStart.toISOString()),
    ]);

    const rows = (currentRows ?? []) as UsageEventRow[];
    const events = rows.map(toRollup);
    const summary = summarizeUsage(events);
    const daily = bucketCostByDay(events, lastNDayKeys(days, now));
    // Summed in microcents, rounded once — see BSR-502 Finding 5.
    const previousTotalCostCents = centsFromMicrocents(
      ((prevRows ?? []) as Array<{ cost_estimate_cents: number; cost_microcents: number | null }>).reduce(
        (sum, r) => sum + (r.cost_microcents ?? (r.cost_estimate_cents ?? 0) * MICROCENTS_PER_CENT),
        0,
      ),
    );
    const recent: RecentUsageRow[] = rows.slice(0, 12).map((r) => ({
      occurredAt: r.occurred_at,
      actorUser: r.actor_user,
      service: r.service,
      model: r.model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      units: r.units,
      costCents: r.cost_estimate_cents,
    }));

    return { configured: true, workspaceName, range, summary, previousTotalCostCents, daily, recent };
  } catch {
    // Supabase unreachable (breaker/abort) — degrade rather than crash the page.
    return emptyUsage(range, workspaceName);
  }
}
