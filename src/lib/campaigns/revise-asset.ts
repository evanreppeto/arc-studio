import { type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminClient } from "../supabase/server";
import { screenDraftCopy } from "./create";
import { editDraftAsset } from "./draft-editing";

/**
 * Arc replacing the copy on a campaign asset that already exists (BSR-759).
 *
 * This is the write path a revision request has been missing since the feature
 * shipped. `requestAssetRevision` recorded the ask, flipped the asset to
 * `revision_requested` and woke the runner — and then Arc had no tool that could
 * change an asset: `create_campaign_draft` mints a NEW one, `submit_draft` is for
 * non-campaign drafts, `update_record` is CRM. So revisions ran to `completed`
 * having revised nothing, three times on prod before anyone noticed, because the
 * task status said success and only the asset's `updated_at` said otherwise.
 *
 * Deliberate properties, each one a failure mode that already happened here:
 *
 * - **Copy that did not change is a refusal, not a success.** `unchanged` exists
 *   so "Arc revised it" can never be reported over a row that never moved.
 * - **An approved asset is not revisable.** Editing what a human signed off is a
 *   way around the approval gate; Arc has to draft a new asset instead.
 * - **The revised copy is screened.** Same deterministic banned-phrase screen the
 *   asset passed on the way in, so a revision cannot smuggle blocked copy past it.
 * - **Stale guardrail flags are cleared, not kept.** Copy that fixed the problem
 *   must stop being flagged for it.
 * - **The item goes back in the operator's queue.** Left `revision_requested` it
 *   reads as still waiting on Arc, forever.
 * - **`dispatch_locked` is never touched.** A revision is not an approval.
 */

export type ReviseCampaignAssetInput = {
  assetId: string;
  /** The COMPLETE revised copy. Omit to change only the title. */
  body?: string;
  title?: string;
  /** One line on what changed, for the campaign timeline. */
  summary?: string;
  orgId: string;
  /** Required, not nullable: this is a write, and the honest answer to "we could
   *  not resolve a workspace" is to refuse rather than to quietly go org-wide. */
  workspaceId: string;
};

export type ReviseCampaignAssetResult =
  | {
      ok: true;
      assetId: string;
      campaignId: string;
      assetType: string;
      title: string;
      body: string;
      /** The asset's new approval status — `needs_compliance` when the revised
       *  copy tripped the banned-phrase screen, `pending_approval` otherwise. */
      status: string;
      approvalItemId: string | null;
      blockedPhrases: string[];
    }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "already_approved"; status: string }
  | { ok: false; reason: "unchanged" }
  | { ok: false; reason: "nothing_to_write" };

type AssetRow = {
  id: string;
  campaign_id: string;
  asset_type: string;
  title: string;
  status: string;
  draft_body: string | null;
  edited_body: string | null;
  approved_body: string | null;
  audit_payload: Record<string, unknown> | null;
};

function assertOk(label: string, error: { message: string } | null) {
  if (error) throw new Error(`${label} failed: ${error.message}`);
}

export async function reviseCampaignAsset(
  input: ReviseCampaignAssetInput,
  operator = "Arc",
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ReviseCampaignAssetResult> {
  const nextBody = typeof input.body === "string" ? input.body.trim() : "";
  const nextTitle = typeof input.title === "string" ? input.title.trim() : "";
  if (!nextBody && !nextTitle) return { ok: false, reason: "nothing_to_write" };

  // `assetId` is model-supplied, so both scope filters are load-bearing: by id
  // alone this reads — and then writes — another tenant's asset.
  const { data: asset, error: assetError } = await client
    .from("campaign_assets")
    .select("id,campaign_id,asset_type,title,status,draft_body,edited_body,approved_body,audit_payload")
    .eq("id", input.assetId)
    .eq("org_id", input.orgId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle<AssetRow>();
  assertOk("campaign_assets lookup", assetError);
  if (!asset) return { ok: false, reason: "not_found" };

  // The human's approval is against specific words. Rewriting them afterwards
  // would leave an approved asset nobody approved.
  if (asset.status === "approved" || asset.approved_body) {
    return { ok: false, reason: "already_approved", status: asset.status };
  }

  // Same precedence the review screen displays, so "unchanged" means unchanged
  // from what the operator is actually looking at.
  const currentBody = asset.edited_body ?? asset.draft_body ?? "";
  const bodyChanged = Boolean(nextBody) && nextBody !== currentBody.trim();
  const titleChanged = Boolean(nextTitle) && nextTitle !== asset.title.trim();
  if (!bodyChanged && !titleChanged) return { ok: false, reason: "unchanged" };

  const finalBody = bodyChanged ? nextBody : currentBody;
  const tenant = { org_id: input.orgId, workspace_id: input.workspaceId };
  const screen = await screenDraftCopy(finalBody, asset.asset_type, client, tenant);
  // Persist the CTA-resolved copy, like the create path: the operator approves
  // the body that will actually send.
  const bodyToPersist = screen.resolvedBody ?? finalBody;

  // The canonical edit path — `edited_body`, the title, and an `asset_edited`
  // event, exactly as an operator's in-canvas edit writes them. It filters by id
  // alone, which is safe only because the read above already proved this asset
  // belongs to this workspace.
  await editDraftAsset(
    {
      assetId: asset.id,
      campaignId: asset.campaign_id,
      ...(bodyChanged ? { body: bodyToPersist } : {}),
      ...(titleChanged ? { title: nextTitle } : {}),
      fields: {},
    },
    operator,
    client,
  );

  // Guardrail flags describe THIS copy. Carrying the previous verdict forward
  // would keep flagging a phrase the revision just removed.
  const audit = { ...(asset.audit_payload ?? {}) };
  delete audit.guardrail;
  if (screen.flags.length > 0) {
    audit.guardrail = { flags: screen.flags, blocked_phrases: screen.blockedPhrases };
  }

  const { error: statusError } = await client
    .from("campaign_assets")
    .update({
      status: screen.status,
      compliance_notes: screen.complianceNotes,
      audit_payload: audit,
    })
    .eq("id", asset.id)
    .eq("org_id", input.orgId)
    .eq("workspace_id", input.workspaceId);
  assertOk("campaign_assets status update", statusError);

  // Back into the human queue. An approval item left `revision_requested` reads
  // as "still waiting on Arc" on every screen that counts what is on your desk.
  const { data: approval, error: approvalError } = await client
    .from("approval_items")
    .select("id")
    .eq("campaign_asset_id", asset.id)
    .eq("org_id", input.orgId)
    .eq("workspace_id", input.workspaceId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  assertOk("approval_items lookup", approvalError);

  if (approval) {
    const { error: reopenError } = await client
      .from("approval_items")
      .update({
        status: screen.status,
        compliance_notes: screen.complianceNotes,
        risk_level: screen.riskLevel,
        // The previous decision was "come back with changes", and Arc just did.
        // Leaving the reviewer stamped would date this revision to that decision.
        reviewed_by: null,
        reviewed_at: null,
      })
      .eq("id", approval.id)
      .eq("org_id", input.orgId)
      // Scoped exactly like the read that found it. A write is not the place to
      // be looser than the query it came from.
      .eq("workspace_id", input.workspaceId);
    assertOk("approval_items reopen", reopenError);
  }

  const { error: eventError } = await client.from("campaign_events").insert({
    org_id: input.orgId,
    workspace_id: input.workspaceId,
    campaign_id: asset.campaign_id,
    campaign_asset_id: asset.id,
    approval_item_id: approval?.id ?? null,
    event_type: "reopened",
    actor: operator,
    detail: input.summary?.trim() || `${operator} revised this deliverable and sent it back for review`,
    payload: { revision: true, ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}), outbound_locked: true },
  });
  assertOk("campaign_events insert", eventError);

  return {
    ok: true,
    assetId: asset.id,
    campaignId: asset.campaign_id,
    assetType: asset.asset_type,
    title: titleChanged ? nextTitle : asset.title,
    body: bodyToPersist,
    status: screen.status,
    approvalItemId: approval?.id ?? null,
    blockedPhrases: screen.blockedPhrases,
  };
}
