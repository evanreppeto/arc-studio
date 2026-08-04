import { type SupabaseClient } from "@supabase/supabase-js";

import { applyInlineFix } from "@/domain";

import { getSupabaseAdminClient } from "../supabase/server";
import { editDraftAsset } from "./draft-editing";

/**
 * Applying a claims-review finding's one-value fix to the draft it is about
 * (BSR-743).
 *
 * The whole point is that the operator does not leave the review to make the
 * change. So this reads the draft as it stands NOW rather than trusting the
 * copy the review was written against — a revision could have landed in
 * between, and substituting into a stale body would either miss or clobber.
 *
 * It writes through `editDraftAsset`, the same path the inline editor uses, so
 * the edit lands in `edited_body`, logs an `asset_edited` event, and leaves
 * dispatch locked. Applying a fix is an edit; it is not an approval, and the
 * deliverable still needs one.
 */

export type ApplyFindingFixResult =
  | { ok: true; replaced: number; campaignId: string; assetId: string }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "no_fix" }
  | { ok: false; reason: "empty_value" | "target_missing" | "value_contains_target"; target: string };

type FindingRow = {
  id: string;
  campaign_asset_id: string | null;
  status: string;
  fix_target: string | null;
};

type AssetRow = {
  id: string;
  campaign_id: string;
  draft_body: string | null;
  edited_body: string | null;
  approved_body: string | null;
};

export async function applyFindingFix(
  /** workspaceId is required, not nullable. This is a write path, and the
   *  honest answer to "we could not resolve a workspace" is to refuse rather
   *  than to fall back to org-wide — which is what a conditional filter here
   *  would quietly do. */
  input: { findingId: string; value: string; orgId: string; workspaceId: string },
  operator: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ApplyFindingFixResult> {
  // Both tables carry workspace_id NOT NULL. Org alone would let a finding id
  // from a sibling workspace resolve and then be written to — caught by the
  // tenancy ratchet in workspace-readers.test.ts, which reads the filter chain.
  const { data: finding, error: findingError } = await client
    .from("guardrail_findings")
    .select("id,campaign_asset_id,status,fix_target")
    .eq("id", input.findingId)
    .eq("org_id", input.orgId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle<FindingRow>();
  if (findingError) throw new Error(`guardrail_findings lookup failed: ${findingError.message}`);
  if (!finding || !finding.campaign_asset_id) return { ok: false, reason: "not_found" };
  if (!finding.fix_target) return { ok: false, reason: "no_fix" };
  // Already applied, or dismissed. Re-applying would substitute a second time
  // into copy that no longer holds the placeholder, which reports as
  // target_missing — true but confusing. Say the real thing.
  if (finding.status !== "open") return { ok: false, reason: "not_found" };

  const { data: asset, error: assetError } = await client
    .from("campaign_assets")
    .select("id,campaign_id,draft_body,edited_body,approved_body")
    .eq("id", finding.campaign_asset_id)
    .eq("org_id", input.orgId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle<AssetRow>();
  if (assetError) throw new Error(`campaign_assets lookup failed: ${assetError.message}`);
  if (!asset) return { ok: false, reason: "not_found" };

  // Same precedence the read model displays, so the operator is editing the
  // words they are looking at.
  const body = asset.approved_body ?? asset.edited_body ?? asset.draft_body ?? "";
  const applied = applyInlineFix(body, { target: finding.fix_target }, input.value);
  if (!applied.ok) return { ok: false, reason: applied.reason, target: finding.fix_target };

  // Threaded, not defaulted: without this the edit reaches for its own admin
  // client and the write lands outside whatever the caller handed us.
  await editDraftAsset(
    { assetId: asset.id, campaignId: asset.campaign_id, body: applied.body, fields: {} },
    operator,
    client,
  );

  // The finding is settled by the edit, so it stops being an open problem on
  // the card. Deliberately after the write: a finding marked resolved above a
  // draft that never changed is the worse of the two failure orders.
  // Scoped like the read above. The ratchet only inspects reads, but a write is
  // not the place to be looser than the query that found the row.
  const { error: resolveError } = await client
    .from("guardrail_findings")
    .update({ status: "resolved" })
    .eq("id", finding.id)
    .eq("org_id", input.orgId)
    .eq("workspace_id", input.workspaceId);
  if (resolveError) throw new Error(`guardrail_findings resolve failed: ${resolveError.message}`);

  return { ok: true, replaced: applied.replaced, campaignId: asset.campaign_id, assetId: asset.id };
}
