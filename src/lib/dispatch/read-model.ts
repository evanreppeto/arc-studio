import { type SupabaseClient } from "@supabase/supabase-js";
import { reportDegraded } from "@/lib/observability/report-degraded";

import { isDemoDataEnabled } from "../demo/demo-mode";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "../supabase/server";
import { buildDemoDispatches } from "./demo";
import { type DispatchStatus, type DispatchView } from "./status";

export type DispatchRow = {
  id: string;
  campaign_id: string;
  campaign_asset_id: string | null;
  channel: string | null;
  status: DispatchStatus;
  scheduled_for: string | null;
  dispatched_at: string | null;
  recipient_summary: string | null;
  audience_count: number | null;
  result_note: string | null;
  updated_at: string;
  payload: Record<string, unknown> | null;
};

const SELECT =
  "id,campaign_id,campaign_asset_id,channel,status,scheduled_for,dispatched_at,recipient_summary,audience_count,result_note,updated_at,payload";

function humanizeChannel(channel: string | null): string {
  if (!channel) return "Unknown channel";
  return channel.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

function previewValue(payload: Record<string, unknown> | null, key: "to" | "subject" | "text"): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Pure: map a dispatch row + resolved names into a display view. */
export function rowToDispatchView(
  row: DispatchRow,
  names: { campaignName: string; deliverable: string | null },
): DispatchView {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    campaignName: names.campaignName,
    assetId: row.campaign_asset_id,
    deliverable: names.deliverable ?? "Deliverable",
    channel: humanizeChannel(row.channel),
    status: row.status,
    scheduledFor: formatDate(row.scheduled_for),
    dispatchedAt: formatDate(row.dispatched_at),
    recipientSummary: row.recipient_summary,
    audienceCount: row.audience_count,
    resultNote: row.result_note,
    updatedAt: formatDate(row.updated_at) ?? "—",
    preview: row.payload
      ? {
          to: previewValue(row.payload, "to"),
          subject: previewValue(row.payload, "subject"),
          text: previewValue(row.payload, "text"),
        }
      : null,
  };
}

export type OutboxList =
  | { status: "live"; dispatches: DispatchView[] }
  | { status: "unavailable"; message: string };

async function loadViews(supabase: SupabaseClient, filter?: { campaignId: string }): Promise<DispatchView[]> {
  let dispatchQuery = supabase
    .from("campaign_dispatches")
    .select(SELECT)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (filter) dispatchQuery = dispatchQuery.eq("campaign_id", filter.campaignId);
  const { data: dispatchData, error: dispatchError } = await dispatchQuery;
  if (dispatchError) throw new Error(`campaign_dispatches: ${dispatchError.message}`);
  const rows = (dispatchData ?? []) as DispatchRow[];
  if (rows.length === 0) return [];

  const campaignIds = [...new Set(rows.map((r) => r.campaign_id))];
  const assetIds = [
    ...new Set(rows.map((r) => r.campaign_asset_id).filter((id): id is string => Boolean(id))),
  ];

  const [{ data: campaignData }, { data: assetData }] = await Promise.all([
    supabase.from("campaigns").select("id,name").in("id", campaignIds),
    assetIds.length
      ? supabase.from("campaign_assets").select("id,title").in("id", assetIds)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string }> }),
  ]);

  const campaignName = new Map((campaignData ?? []).map((c) => [c.id as string, c.name as string]));
  const deliverable = new Map((assetData ?? []).map((a) => [a.id as string, a.title as string]));

  return rows.map((row) =>
    rowToDispatchView(row, {
      campaignName: campaignName.get(row.campaign_id) ?? "Campaign",
      deliverable: row.campaign_asset_id ? deliverable.get(row.campaign_asset_id) ?? null : null,
    }),
  );
}

/** Cross-campaign outbox list. */
export async function getOutboxList(client?: SupabaseClient): Promise<OutboxList> {
  if (!client && !isSupabaseAdminConfigured()) {
    // Offline preview: render a populated send queue instead of an empty console.
    if (isDemoDataEnabled()) return { status: "live", dispatches: buildDemoDispatches() };
    return { status: "unavailable", message: "Supabase env vars are not configured." };
  }
  try {
    const supabase = client ?? getSupabaseAdminClient();
    return { status: "live", dispatches: await loadViews(supabase) };
  } catch (error) {
    // Degrade, but not silently — this read IS the screen, so an empty
    // state here is indistinguishable from an outage (BSR-544).
    reportDegraded(error, { scope: "dispatch.getOutboxList", surface: "primary" });
    return { status: "unavailable", message: error instanceof Error ? error.message : "Outbox is unavailable." };
  }
}

/** Dispatches for a single campaign (detail panel). Returns [] when unconfigured. */
export async function getCampaignDispatches(campaignId: string, client?: SupabaseClient): Promise<DispatchView[]> {
  if (!client && !isSupabaseAdminConfigured()) return [];
  const supabase = client ?? getSupabaseAdminClient();
  try {
    return await loadViews(supabase, { campaignId });
  } catch {
    return [];
  }
}
