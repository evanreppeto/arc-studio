import { type SupabaseClient } from "@supabase/supabase-js";

import {
  MEDIA_ASSET_ITEM_TYPE,
  buildDecisionNote,
  checkAssetApproval,
  type AssetDecision,
} from "@/domain";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

// Asset approval through `approval_items` — the same table, vocabulary and audit
// trail campaigns use (BSR-538). There is deliberately no second, softer path to
// "approved" for media.
//
// Approval marks an asset ready for a human-gated next step. It does NOT send,
// publish or unlock outbound — that invariant is unchanged here, exactly as in
// `decideApprovalItem` for campaigns.

function assertOk(label: string, error: { message: string } | null) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

export type DecideAssetApprovalInput = {
  assetId: string;
  orgId: string;
  decision: AssetDecision;
  operator: string;
  notes?: string | null;
  /** Reviewer's acknowledgement of the asset's risk flags. Required to approve a flagged asset. */
  acknowledgement?: string | null;
};

export type DecideAssetApprovalResult =
  | { ok: true; approvalItemId: string; status: AssetDecision }
  | { ok: false; error: string; flags?: string[] };

type AssetRow = { id: string; risk_flags: string[] | null };
type ItemRow = { id: string; status: string };

/**
 * Record a human decision on a media asset.
 *
 * Reads the asset's CURRENT risk flags from the database rather than trusting
 * what the caller passed: the gate has to bind to what is actually recorded, or
 * a client could approve a flagged asset by simply omitting the flags.
 *
 * Creates the approval row on first decision (assets don't get one until someone
 * reviews them) and updates it thereafter, so an asset has one approval item and
 * a full decision history.
 */
export async function decideAssetApproval(
  input: DecideAssetApprovalInput,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<DecideAssetApprovalResult> {
  const { assetId, orgId, decision, operator } = input;
  const now = new Date().toISOString();

  const { data: asset, error: assetError } = await client
    .from("media_assets")
    .select("id,risk_flags")
    .eq("id", assetId)
    .eq("org_id", orgId)
    .maybeSingle<AssetRow>();
  assertOk("media_assets lookup", assetError);
  if (!asset) return { ok: false, error: "Asset not found." };

  // The gate. Flags come from the row, not the request.
  const request = {
    decision,
    riskFlags: asset.risk_flags ?? [],
    acknowledgement: input.acknowledgement,
  };
  const verdict = checkAssetApproval(request);
  if (!verdict.allowed) {
    return { ok: false, error: verdict.message, flags: verdict.flags };
  }

  const decisionNotes = buildDecisionNote(request, input.notes);

  const { data: existing, error: existingError } = await client
    .from("approval_items")
    .select("id,status")
    .eq("media_asset_id", assetId)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ItemRow>();
  assertOk("approval_items lookup", existingError);

  let approvalItemId: string;
  const previousStatus = existing?.status ?? "draft";

  if (existing) {
    const { error } = await client
      .from("approval_items")
      .update({ status: decision, reviewed_by: operator, reviewed_at: now, decision_notes: decisionNotes, updated_at: now })
      .eq("id", existing.id)
      .eq("org_id", orgId);
    assertOk("approval_items update", error);
    approvalItemId = existing.id;
  } else {
    const { data: created, error } = await client
      .from("approval_items")
      .insert({
        org_id: orgId,
        media_asset_id: assetId,
        item_type: MEDIA_ASSET_ITEM_TYPE,
        status: decision,
        approval_required: true,
        // Approving an asset readies it for review-gated use; it never unlocks
        // outbound on its own. Same posture as campaign assets.
        locked_until_approved: true,
        prompt_inputs: {},
        requested_by: operator,
        submitted_at: now,
        reviewed_by: operator,
        reviewed_at: now,
        decision_notes: decisionNotes,
        risk_level: (asset.risk_flags ?? []).length > 0 ? "elevated" : "standard",
        reasoning_payload: {},
        audit_payload: {},
      })
      .select("id")
      .single<{ id: string }>();
    assertOk("approval_items insert", error);
    if (!created) return { ok: false, error: "Could not create the approval record." };
    approvalItemId = created.id;
  }

  // The decision log is what makes "why did this go out?" answerable. Recorded
  // for every decision, never overwritten.
  const { error: decisionError } = await client.from("approval_decisions").insert({
    org_id: orgId,
    approval_item_id: approvalItemId,
    decision,
    decided_by: operator,
    decided_at: now,
    decision_notes: decisionNotes,
    previous_status: previousStatus,
    next_status: decision,
    metadata: {
      source: "media_library",
      outbound_locked: true,
      acknowledged_flags: verdict.requiresAcknowledgement ? (asset.risk_flags ?? []) : [],
    },
  });
  assertOk("approval_decisions insert", decisionError);

  return { ok: true, approvalItemId, status: decision };
}

export type AssetApprovalState = {
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

/**
 * Latest approval state per asset, keyed by asset id. Assets with no approval
 * row are simply absent — the card renders them as unreviewed.
 */
export async function getAssetApprovalStates(
  orgId: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<Record<string, AssetApprovalState>> {
  const { data, error } = await client
    .from("approval_items")
    .select("media_asset_id,status,reviewed_by,reviewed_at,created_at")
    .eq("org_id", orgId)
    .eq("item_type", MEDIA_ASSET_ITEM_TYPE)
    .not("media_asset_id", "is", null)
    .order("created_at", { ascending: false });
  if (error || !data) return {};

  const out: Record<string, AssetApprovalState> = {};
  for (const row of data as Array<{
    media_asset_id: string;
    status: string;
    reviewed_by: string | null;
    reviewed_at: string | null;
  }>) {
    // Ordered newest-first, so the first row per asset wins.
    if (!out[row.media_asset_id]) {
      out[row.media_asset_id] = { status: row.status, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at };
    }
  }
  return out;
}
