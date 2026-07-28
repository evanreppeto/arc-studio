import { type SupabaseClient } from "@supabase/supabase-js";
import { reportDegraded } from "@/lib/observability/report-degraded";

import { getCampaignWorkspaceList, type CampaignWorkspaceListItem } from "@/lib/campaigns/read-model";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import {
  aggregateCampaignResults,
  aggregateTotals,
  countDispatchFunnel,
  type CampaignResultMetricRow,
  type GalleryCampaign,
  type GalleryTotals,
} from "./aggregate";

/** The subset of a campaigns list item the gallery showcase needs. */
export type GalleryListItem = Pick<
  CampaignWorkspaceListItem,
  "id" | "name" | "persona" | "href" | "thumbnailUrl" | "assetTypes" | "assetCount" | "mediaCount"
>;

export type GalleryData =
  | { status: "live"; campaigns: GalleryCampaign[]; totals: GalleryTotals }
  | { status: "unavailable"; message: string };

/** Pure: combine one live campaign's showcase fields with its dispatch + result rows. */
export function assembleGalleryCampaign(
  item: GalleryListItem,
  dispatchRows: Array<{ status: string }>,
  resultRows: CampaignResultMetricRow[],
): GalleryCampaign {
  return {
    id: item.id,
    name: item.name,
    persona: item.persona,
    href: item.href,
    thumbnailUrl: item.thumbnailUrl,
    assetTypes: item.assetTypes,
    assetCount: item.assetCount,
    mediaCount: item.mediaCount,
    dispatch: countDispatchFunnel(dispatchRows),
    metrics: aggregateCampaignResults(resultRows),
  };
}

type DispatchRow = { campaign_id: string; status: string };
type ResultRow = CampaignResultMetricRow & { campaign_id: string };

/** Live (deployed) campaigns + their dispatch funnel + marketing metrics. */
export async function getGalleryData(client?: SupabaseClient, orgId?: string): Promise<GalleryData> {
  if (!client && !isSupabaseAdminConfigured()) {
    return { status: "unavailable", message: "Supabase env vars are not configured." };
  }

  try {
    const list = await getCampaignWorkspaceList(client, "Arc", orgId);
    if (list.status === "unavailable") {
      return { status: "unavailable", message: list.message };
    }

    const live = list.campaigns.filter((campaign) => campaign.lifecycle === "Live");
    if (live.length === 0) {
      return { status: "live", campaigns: [], totals: aggregateTotals([]) };
    }

    const supabase = client ?? getSupabaseAdminClient();
    const ids = live.map((campaign) => campaign.id);

    let dispatchQuery = supabase
      .from("campaign_dispatches")
      .select("campaign_id,status")
      .in("campaign_id", ids);
    if (orgId) dispatchQuery = dispatchQuery.eq("org_id", orgId);
    const { data: dispatchData, error: dispatchError } = await dispatchQuery;
    if (dispatchError) throw new Error(`campaign_dispatches: ${dispatchError.message}`);

    let resultQuery = supabase
      .from("campaign_results")
      .select("campaign_id,impressions,clicks,calls,forms,leads,jobs,won_revenue_cents,spend_cents")
      .in("campaign_id", ids);
    if (orgId) resultQuery = resultQuery.eq("org_id", orgId);
    const { data: resultData, error: resultError } = await resultQuery;
    if (resultError) throw new Error(`campaign_results: ${resultError.message}`);

    const dispatchByCampaign = new Map<string, DispatchRow[]>();
    for (const row of (dispatchData ?? []) as DispatchRow[]) {
      const rows = dispatchByCampaign.get(row.campaign_id) ?? [];
      rows.push(row);
      dispatchByCampaign.set(row.campaign_id, rows);
    }
    const resultsByCampaign = new Map<string, ResultRow[]>();
    for (const row of (resultData ?? []) as ResultRow[]) {
      const rows = resultsByCampaign.get(row.campaign_id) ?? [];
      rows.push(row);
      resultsByCampaign.set(row.campaign_id, rows);
    }

    const campaigns = live.map((item) =>
      assembleGalleryCampaign(item, dispatchByCampaign.get(item.id) ?? [], resultsByCampaign.get(item.id) ?? []),
    );

    return { status: "live", campaigns, totals: aggregateTotals(campaigns) };
  } catch (error) {
    // Degrade, but not silently — this read IS the screen, so an empty
    // state here is indistinguishable from an outage (BSR-544).
    reportDegraded(error, { scope: "gallery.getGalleryData", surface: "primary" });
    return { status: "unavailable", message: error instanceof Error ? error.message : "Gallery is unavailable." };
  }
}
