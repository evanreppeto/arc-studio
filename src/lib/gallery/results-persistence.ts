import { type SupabaseClient } from "@supabase/supabase-js";

import { type ParsedCampaignResult } from "@/domain";
import { workspaceIdFields } from "@/lib/tenancy/resolve-workspace";

export type PersistResultsSummary = { inserted: number; updated: number };

/** Upsert campaign_results rows on the natural period key
 *  (campaign_id, campaign_asset_id, channel, period_start, period_end) using
 *  select-then-insert/update in app code (no DB unique constraint needed).
 *
 *  `orgId` is required, and deliberately so: the natural key is not unique across
 *  tenants, so an unscoped lookup can match another org's row and the update
 *  branch would then overwrite it. Every query below stays org-scoped. */
export async function persistCampaignResults(
  rows: ParsedCampaignResult[],
  client: SupabaseClient,
  orgId: string,
): Promise<PersistResultsSummary> {
  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    let query = client
      .from("campaign_results")
      .select("id")
      .eq("campaign_id", row.campaign_id)
      .eq("period_start", row.period_start)
      .eq("period_end", row.period_end)
      .eq("org_id", orgId);
    query = row.campaign_asset_id ? query.eq("campaign_asset_id", row.campaign_asset_id) : query.is("campaign_asset_id", null);
    query = row.channel ? query.eq("channel", row.channel) : query.is("channel", null);

    // maybeSingle throws if >1 row matches the natural key. There's no DB unique
    // constraint, so a pre-existing duplicate would surface here as a loud error
    // (caught below) rather than silently picking one — acceptable for single-writer ingest.
    const { data: existing, error: lookupError } = await query.maybeSingle<{ id: string }>();
    if (lookupError) throw new Error(`campaign_results lookup: ${lookupError.message}`);

    if (existing) {
      const { error: updateError } = await client
        .from("campaign_results")
        .update({ ...row, org_id: orgId })
        .eq("id", existing.id)
        .eq("org_id", orgId);
      if (updateError) throw new Error(`campaign_results update: ${updateError.message}`);
      updated += 1;
    } else {
      const { error: insertError } = await client.from("campaign_results").insert({
        ...row,
        org_id: orgId,
        ...(await workspaceIdFields(client, orgId, { campaignId: row.campaign_id })),
      });
      if (insertError) throw new Error(`campaign_results insert: ${insertError.message}`);
      inserted += 1;
    }
  }

  return { inserted, updated };
}
