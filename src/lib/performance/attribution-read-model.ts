import { type SupabaseClient } from "@supabase/supabase-js";

import {
  computeCampaignEconomics,
  DEFAULT_PIPELINE_STAGES,
  isTerminalStatus,
  isWonStatus,
  type CampaignEconomics,
  type PipelineStage,
} from "@/domain";
import { getPipelineStages } from "@/lib/pipeline-stages/read-model";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "../supabase/server";

/**
 * Attributed revenue asks the stage what it MEANS (BSR-563).
 *
 * These were the literal lists `["won", "paid"]` and
 * `["pending", "scheduled", "in_progress"]` — the same shape that would have
 * made analytics read zero, missed when BSR-495 fixed that one. A workspace
 * that renames "Won" to "Retained" would have seen every campaign's attributed
 * revenue drop to nothing, with no error anywhere.
 *
 * `orgId` is optional because these are called from paths that don't all carry
 * one; without it the defaults stand in, which are exactly the values the two
 * lists used to hold, so nothing regresses.
 */
async function stagesFor(
  orgId: string | undefined,
  objectKey: "jobs" | "outcomes",
  client: SupabaseClient,
): Promise<PipelineStage[]> {
  if (!orgId) return [...DEFAULT_PIPELINE_STAGES[objectKey]];
  return getPipelineStages(orgId, objectKey, { client });
}

/** Open = in the pipeline and not yet closed, whatever the tenant calls it. */
function isOpenStatus(stages: readonly PipelineStage[], status: string | null | undefined): boolean {
  return Boolean(status) && !isTerminalStatus(stages, status);
}
// Explicit row caps so totals are never silently truncated by PostgREST's
// default page size (1000). A campaign's attributed leads are bounded, and
// their jobs/outcomes are a small multiple of that.
const MAX_LEADS = 5000;
const MAX_FANOUT_ROWS = 20000;
const MAX_RESULT_ROWS = 1000;

export type CampaignEconomicsReadModel =
  | (CampaignEconomics & {
      status: "live";
      selfReported: { wonRevenueCents: number; leads: number };
    })
  | { status: "unavailable"; message: string };

type LeadIdRow = { id: string };
type JobRow = { lead_id: string | null; status: string | null; estimated_revenue_cents: number | null };
type OutcomeRow = { lead_id: string | null; status: string | null; gross_revenue_cents: number | null };
type ResultRow = { spend_cents: number | null; won_revenue_cents: number | null; leads: number | null };

export async function getCampaignEconomics(
  campaignId: string,
  client?: SupabaseClient,
  orgId?: string,
): Promise<CampaignEconomicsReadModel> {
  if (!client && !isSupabaseAdminConfigured()) {
    return { status: "unavailable", message: "Supabase env vars are not configured." };
  }

  try {
    const supabase = client ?? getSupabaseAdminClient();

    const leadsRes = await supabase.from("leads").select("id").eq("attributed_campaign_id", campaignId).limit(MAX_LEADS);
    if (leadsRes.error) throw new Error(`leads lookup: ${leadsRes.error.message}`);
    const leadIds = ((leadsRes.data ?? []) as LeadIdRow[]).map((row) => row.id);

    // `.in("lead_id", [])` is valid in PostgREST — it returns an empty set, not an
    // error — so a campaign with zero attributed leads correctly yields zeroed economics.
    const [jobsRes, outcomesRes, resultsRes] = await Promise.all([
      supabase.from("jobs").select("lead_id,status,estimated_revenue_cents").in("lead_id", leadIds).limit(MAX_FANOUT_ROWS),
      supabase.from("outcomes").select("lead_id,status,gross_revenue_cents").in("lead_id", leadIds).limit(MAX_FANOUT_ROWS),
      supabase.from("campaign_results").select("spend_cents,won_revenue_cents,leads").eq("campaign_id", campaignId).limit(MAX_RESULT_ROWS),
    ]);
    if (jobsRes.error) throw new Error(`jobs lookup: ${jobsRes.error.message}`);
    if (outcomesRes.error) throw new Error(`outcomes lookup: ${outcomesRes.error.message}`);
    if (resultsRes.error) throw new Error(`campaign_results lookup: ${resultsRes.error.message}`);

    const jobs = (jobsRes.data ?? []) as JobRow[];
    const outcomes = (outcomesRes.data ?? []) as OutcomeRow[];
    const results = (resultsRes.data ?? []) as ResultRow[];

    const [outcomeStages, jobStages] = await Promise.all([
      stagesFor(orgId, "outcomes", supabase),
      stagesFor(orgId, "jobs", supabase),
    ]);

    const won = outcomes.filter((o) => isWonStatus(outcomeStages, o.status));
    const wonRevenueCents = won.reduce((sum, o) => sum + (o.gross_revenue_cents ?? 0), 0);
    const openPipelineCents = jobs
      .filter((j) => isOpenStatus(jobStages, j.status))
      .reduce((sum, j) => sum + (j.estimated_revenue_cents ?? 0), 0);
    const spendCents = results.reduce((sum, r) => sum + (r.spend_cents ?? 0), 0);

    const economics = computeCampaignEconomics({
      attributedLeads: leadIds.length,
      wonRevenueCents,
      wonCount: won.length,
      openPipelineCents,
      spendCents,
    });

    return {
      status: "live",
      ...economics,
      // selfReported sums campaign_results across ALL periods for the campaign —
      // an all-time total, consistent with the all-time realized figures above.
      // A date-windowed view would add period_start/period_end filters here.
      selfReported: {
        wonRevenueCents: results.reduce((sum, r) => sum + (r.won_revenue_cents ?? 0), 0),
        leads: results.reduce((sum, r) => sum + (r.leads ?? 0), 0),
      },
    };
  } catch (error) {
    return { status: "unavailable", message: error instanceof Error ? error.message : "Campaign economics unavailable." };
  }
}

/** Raw rows for per-channel and per-asset attribution — the dimension the
 *  campaign-level economics collapses away. Kept separate from getCampaignEconomics
 *  so that path stays a single round of queries and its contract is unchanged.
 *
 *  Two honest sources, merged by the pure builders (see campaign-panel.ts):
 *   • CRM attribution — leads carry `attribution_channel`; won/paid outcomes roll
 *     up to their lead's channel. This is the ground truth for leads/booked/revenue.
 *   • campaign_results — self-reported delivery per channel/asset (impressions,
 *     clicks, spend). The only source of spend and ad-delivery metrics. */
export type CampaignAttributionRows =
  | {
      status: "live";
      leadChannels: { id: string; channel: string | null }[];
      outcomes: { lead_id: string | null; status: string | null; gross_revenue_cents: number | null }[];
      results: {
        channel: string | null;
        campaign_asset_id: string | null;
        impressions: number | null;
        clicks: number | null;
        leads: number | null;
        jobs: number | null;
        won_revenue_cents: number | null;
        spend_cents: number | null;
      }[];
      assets: {
        id: string;
        title: string | null;
        channel: string | null;
        asset_type: string | null;
        source_system: string | null;
        tool_source: string | null;
        status: string | null;
      }[];
    }
  | { status: "unavailable"; message: string };

type LeadChannelRow = { id: string; attribution_channel: string | null };

export async function getCampaignAttributionRows(
  campaignId: string,
  client?: SupabaseClient,
): Promise<CampaignAttributionRows> {
  if (!client && !isSupabaseAdminConfigured()) {
    return { status: "unavailable", message: "Supabase env vars are not configured." };
  }

  try {
    const supabase = client ?? getSupabaseAdminClient();

    const leadsRes = await supabase
      .from("leads")
      .select("id,attribution_channel")
      .eq("attributed_campaign_id", campaignId)
      .limit(MAX_LEADS);
    if (leadsRes.error) throw new Error(`leads lookup: ${leadsRes.error.message}`);
    const leadRows = (leadsRes.data ?? []) as LeadChannelRow[];
    const leadIds = leadRows.map((row) => row.id);

    const [outcomesRes, resultsRes, assetsRes] = await Promise.all([
      supabase.from("outcomes").select("lead_id,status,gross_revenue_cents").in("lead_id", leadIds).limit(MAX_FANOUT_ROWS),
      supabase
        .from("campaign_results")
        .select("channel,campaign_asset_id,impressions,clicks,leads,jobs,won_revenue_cents,spend_cents")
        .eq("campaign_id", campaignId)
        .limit(MAX_RESULT_ROWS),
      supabase
        .from("campaign_assets")
        .select("id,title,channel,asset_type,source_system,tool_source,status")
        .eq("campaign_id", campaignId)
        .limit(MAX_RESULT_ROWS),
    ]);
    if (outcomesRes.error) throw new Error(`outcomes lookup: ${outcomesRes.error.message}`);
    if (resultsRes.error) throw new Error(`campaign_results lookup: ${resultsRes.error.message}`);
    if (assetsRes.error) throw new Error(`campaign_assets lookup: ${assetsRes.error.message}`);

    type LiveRows = Extract<CampaignAttributionRows, { status: "live" }>;
    return {
      status: "live",
      leadChannels: leadRows.map((row) => ({ id: row.id, channel: row.attribution_channel })),
      outcomes: (outcomesRes.data ?? []) as LiveRows["outcomes"],
      results: (resultsRes.data ?? []) as LiveRows["results"],
      assets: (assetsRes.data ?? []) as LiveRows["assets"],
    };
  } catch (error) {
    return { status: "unavailable", message: error instanceof Error ? error.message : "Campaign attribution unavailable." };
  }
}

/** Dated rows for a campaign's per-week trend: attributed-lead created dates and
 *  won/paid revenue events. Kept separate from getCampaignEconomics so the
 *  economics path stays a single round of queries. */
export type CampaignTrendRows =
  | { status: "live"; leadDates: (string | null)[]; wonEvents: { at: string | null; cents: number }[] }
  | { status: "unavailable"; message: string };

type LeadDateRow = { id: string; created_at: string | null };
type OutcomeDateRow = { status: string | null; gross_revenue_cents: number | null; closed_at: string | null; created_at: string | null };

export async function getCampaignTrendRows(campaignId: string, client?: SupabaseClient, orgId?: string): Promise<CampaignTrendRows> {
  if (!client && !isSupabaseAdminConfigured()) {
    return { status: "unavailable", message: "Supabase env vars are not configured." };
  }

  try {
    const supabase = client ?? getSupabaseAdminClient();

    const leadsRes = await supabase.from("leads").select("id,created_at").eq("attributed_campaign_id", campaignId).limit(MAX_LEADS);
    if (leadsRes.error) throw new Error(`leads lookup: ${leadsRes.error.message}`);
    const leadRows = (leadsRes.data ?? []) as LeadDateRow[];
    const leadIds = leadRows.map((row) => row.id);

    const outcomesRes = await supabase
      .from("outcomes")
      .select("status,gross_revenue_cents,closed_at,created_at")
      .in("lead_id", leadIds)
      .limit(MAX_FANOUT_ROWS);
    if (outcomesRes.error) throw new Error(`outcomes lookup: ${outcomesRes.error.message}`);
    const outcomeRows = (outcomesRes.data ?? []) as OutcomeDateRow[];

    const outcomeStages = await stagesFor(orgId, "outcomes", supabase);
    const wonEvents = outcomeRows
      .filter((o) => isWonStatus(outcomeStages, o.status))
      .map((o) => ({ at: o.closed_at ?? o.created_at, cents: o.gross_revenue_cents ?? 0 }));

    return { status: "live", leadDates: leadRows.map((row) => row.created_at), wonEvents };
  } catch (error) {
    return { status: "unavailable", message: error instanceof Error ? error.message : "Campaign trend unavailable." };
  }
}
