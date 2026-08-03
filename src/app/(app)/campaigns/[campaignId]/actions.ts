"use server";

import { revalidatePath } from "next/cache";

import { validateRevisionInstruction } from "@/domain";
import { getCurrentAgentTaskTenantFields } from "@/lib/agent-tasks/scope";
import { getOperatorActor, requireOperator } from "@/lib/auth/operator";
import { attachMediaToCampaignAsset } from "@/lib/campaigns/attach-media";
import { buildExternalSendPackage, recordExternalSend, type ExternalSendPackage } from "@/lib/campaigns/external-send";
import { decideAsset, reopenAsset, type ApprovalDecision } from "@/lib/campaigns/decisions";
import { editDraftAsset } from "@/lib/campaigns/draft-editing";
import { launchCampaign } from "@/lib/campaigns/launch";
import { requestAssetRevision } from "@/lib/campaigns/revisions";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

/**
 * Operator decisions on a campaign deliverable — the ContentEngine approval flow.
 * These are real backend state transitions (approve / decline / archive / request
 * revision), gated by requireOperator() and org-scoped. They never unlock
 * outbound dispatch; launching is a separate step. `persisted: false` is the
 * honest offline/demo signal so the UI can reflect the decision without saving.
 */
export type CampaignActionResult =
  | {
      ok: true;
      persisted: boolean;
      status?: string;
      /**
       * Only set by revision requests. `false` means the request was recorded
       * but Arc has not started on it (the runner did not answer the wake), so
       * the UI must not tell the operator their revision is under way.
       */
      dispatched?: boolean;
    }
  | { ok: false; error: string };

export type LaunchCampaignActionResult =
  | { ok: true; persisted: boolean; launchedAssets?: number }
  | { ok: false; error: string };

const DECISIONS: ReadonlySet<string> = new Set(["approved", "declined", "archived"]);

export async function decideCampaignAsset(campaignId: string, assetId: string, decision: string): Promise<CampaignActionResult> {
  await requireOperator();
  if (!DECISIONS.has(decision)) return { ok: false, error: "Unknown decision." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false, status: decision };

  try {
    const operator = await getOperatorActor();
    const tenant = await getCurrentAgentTaskTenantFields();
    const result = await decideAsset({ assetId, campaignId, decision: decision as ApprovalDecision, operator, tenant });
    revalidatePath(`/campaigns/${campaignId}`);
    return { ok: true, persisted: true, status: result.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not record the decision." };
  }
}

export async function requestCampaignRevision(campaignId: string, assetId: string, instruction: string): Promise<CampaignActionResult> {
  await requireOperator();

  let cleaned: string;
  try {
    cleaned = validateRevisionInstruction(instruction);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Tell Arc what to change." };
  }

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false, status: "revision_requested" };

  try {
    const operator = await getOperatorActor();
    const { dispatched } = await requestAssetRevision({ campaignId, assetId, instruction: cleaned, operator });
    revalidatePath(`/campaigns/${campaignId}`);
    return { ok: true, persisted: true, status: "revision_requested", dispatched };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not request the revision." };
  }
}

/**
 * Persist an operator's in-canvas edit to a deliverable's copy (title / body).
 * Wraps `editDraftAsset`, which writes edited_body/edited_fields and logs an
 * `asset_edited` event — and never touches dispatch_locked/launch_locked, so
 * outbound stays locked. The read path coalesces edited_body, so the edit shows
 * immediately and feeds the revision diff. Lets the operator fix copy in place
 * instead of round-tripping every wording tweak through Arc. Gated by
 * requireOperator(). `persisted: false` is the honest offline/demo signal.
 */
export async function editCampaignDraftAction(input: {
  campaignId: string;
  assetId: string;
  title?: string;
  body?: string;
}): Promise<CampaignActionResult> {
  await requireOperator();
  if (!input.assetId) return { ok: false, error: "Missing asset." };

  const body = typeof input.body === "string" ? input.body.trim() : undefined;
  const title = typeof input.title === "string" ? input.title.trim() : undefined;
  if (!body && !title) return { ok: false, error: "Nothing to save." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false, status: "edited" };

  try {
    const operator = await getOperatorActor();
    await editDraftAsset({ assetId: input.assetId, campaignId: input.campaignId, title, body, fields: {} }, operator);
    revalidatePath(`/campaigns/${input.campaignId}`);
    return { ok: true, persisted: true, status: "edited" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save your edit." };
  }
}

/**
 * Re-open a decided (approved/declined) deliverable for review. Wraps
 * `reopenAsset`, which reverts status to pending_approval, appends a "reverted"
 * approval decision + a "reopened" event, and RE-LOCKS dispatch — the safe
 * direction (it never unlocks outbound). This is the operator's undo for the
 * detail view's otherwise dead-end "decided" state. Gated by requireOperator(),
 * org-scoped via the tenant fields.
 */
export async function reopenCampaignAsset(campaignId: string, assetId: string): Promise<CampaignActionResult> {
  await requireOperator();
  if (!assetId) return { ok: false, error: "Missing asset." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false, status: "pending_approval" };

  try {
    const operator = await getOperatorActor();
    const tenant = await getCurrentAgentTaskTenantFields();
    await reopenAsset({ assetId, campaignId, operator, tenant });
    revalidatePath(`/campaigns/${campaignId}`);
    return { ok: true, persisted: true, status: "pending_approval" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not reopen the asset." };
  }
}

/**
 * Attach an approved Library media asset to an existing campaign deliverable.
 * Wraps `attachMediaToCampaignAsset`, which appends to the asset's
 * `audit_payload.media_assets` (with provenance) and is idempotent — it leaves
 * status + dispatch lock untouched, so outbound stays locked. Lets the operator
 * put real approved media on a deliverable so campaign cards aren't empty. Gated
 * by requireOperator() and org-scoped via the tenant fields.
 */
export async function attachCampaignMediaAction(input: {
  campaignId: string;
  assetId: string;
  libraryAssetId: string;
}): Promise<CampaignActionResult> {
  await requireOperator();
  if (!input.assetId || !input.libraryAssetId) return { ok: false, error: "Missing asset or media." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  try {
    const operator = await getOperatorActor();
    const tenant = await getCurrentAgentTaskTenantFields();
    await attachMediaToCampaignAsset({ assetId: input.assetId, libraryAssetId: input.libraryAssetId, operator, tenant });
    revalidatePath(`/campaigns/${input.campaignId}`);
    return { ok: true, persisted: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not attach the media." };
  }
}

/**
 * Launch a campaign — the explicit, deliberate outbound gate. `launchCampaign`
 * enforces that every gating deliverable is already approved; this unlocks the
 * approved pieces for dispatch, marks the campaign live, and opens the Outbox.
 * It never sends anything on its own: each queued dispatch is still confirmed
 * by the operator in the Outbox. Gated by requireOperator() and org-scoped.
 */
export async function launchCampaignAction(campaignId: string): Promise<LaunchCampaignActionResult> {
  await requireOperator();

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  try {
    const operator = await getOperatorActor();
    const tenant = await getCurrentAgentTaskTenantFields();
    const result = await launchCampaign({ campaignId, operator, tenant });
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");
    revalidatePath("/outbox");
    return { ok: true, persisted: true, launchedAssets: result.launchedAssets };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not launch the campaign." };
  }
}

export type ExternalSendPackageActionResult = { ok: true; pkg: ExternalSendPackage } | { ok: false; error: string };

/**
 * BYO send channel: the approved deliverable, attribution-stamped, plus the
 * resolved audience — ready to paste into the workspace's own email tool.
 * Approval-gated exactly like the native send path; exports nothing unapproved.
 */
export async function exportCampaignAssetForExternalSend(
  campaignId: string,
  assetId: string,
): Promise<ExternalSendPackageActionResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect a workspace to export a deliverable." };
  try {
    const tenant = await getCurrentAgentTaskTenantFields();
    return await buildExternalSendPackage({ campaignId, assetId, tenant }, getSupabaseAdminClient());
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not build the export." };
  }
}

export type MarkExternalSendResult = { ok: true; recipients: number } | { ok: false; error: string };

/**
 * The operator's declaration that the exported content went out through their
 * own tool — records the outbound_send touches (idempotent per recipient) so
 * journeys and the learning loop see the send the app didn't perform.
 */
export async function markCampaignAssetSentExternally(
  campaignId: string,
  assetId: string,
  tool?: string,
): Promise<MarkExternalSendResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) return { ok: false, error: "Connect a workspace to record an external send." };
  try {
    const operator = await getOperatorActor();
    const tenant = await getCurrentAgentTaskTenantFields();
    const result = await recordExternalSend({ campaignId, assetId, operator, tool: tool ?? null, tenant }, getSupabaseAdminClient());
    if (result.ok) revalidatePath(`/campaigns/${campaignId}`);
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not record the external send." };
  }
}
