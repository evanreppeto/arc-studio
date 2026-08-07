"use server";

import { revalidatePath } from "next/cache";

import { describeFixFailure, validateRevisionInstruction, type AssetDecision } from "@/domain";
import { getCurrentAgentTaskTenantFields } from "@/lib/agent-tasks/scope";
import { getOperatorActor, requireOperator } from "@/lib/auth/operator";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { attachMediaToCampaignAsset } from "@/lib/campaigns/attach-media";
import { buildExternalSendPackage, recordExternalSend, type ExternalSendPackage } from "@/lib/campaigns/external-send";
import { ApprovalBlockedError, decideAsset, reopenAsset, type ApprovalDecision } from "@/lib/campaigns/decisions";
import { editDraftAsset } from "@/lib/campaigns/draft-editing";
import { applyFindingFix } from "@/lib/campaigns/inline-fix";
import { MEDIA_RESOLVE_MESSAGE, resolveMediaAssetId } from "@/lib/campaigns/media-identity";
import { decideAssetApproval } from "@/lib/media-library/approval";
import { launchCampaign } from "@/lib/campaigns/launch";
import { redispatchStalledRevision } from "@/lib/campaigns/revision-recovery";
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
      /**
       * The queued `agent_tasks` row, returned so the UI can offer an immediate
       * Retry on `dispatched: false` instead of making the operator wait for the
       * stale-revision sweep to notice it ten minutes later.
       */
      agentTaskId?: string | null;
    }
  | { ok: false; error: string }
  /**
   * Approval refused because the asset has open blocking findings and the
   * reviewer has not said how they were addressed. Distinct from a plain error
   * so the UI can open the acknowledgement field and name the blockers, rather
   * than showing a red string the operator can do nothing with.
   */
  | { ok: false; error: string; reason: "acknowledgement_required"; blockers: string[] };

export type LaunchCampaignActionResult =
  | { ok: true; persisted: boolean; launchedAssets?: number }
  | { ok: false; error: string };

const DECISIONS: ReadonlySet<string> = new Set(["approved", "declined", "archived"]);

/**
 * What a reviewer may decide about one PICTURE. A superset of the deliverable's
 * three: creative can be sent back for another pass (`needs_revision`), which a
 * deliverable expresses through the separate revision-request path instead.
 * Validated here rather than trusted from the client — this is a server action,
 * so its argument is an untrusted input like any request body.
 */
const ASSET_DECISIONS: ReadonlySet<AssetDecision> = new Set<AssetDecision>([
  "approved",
  "declined",
  "needs_revision",
  "archived",
]);

export async function decideCampaignAsset(
  campaignId: string,
  assetId: string,
  decision: string,
  /** How the reviewer addressed the asset's blocking findings, when it has any. */
  acknowledgement?: string | null,
): Promise<CampaignActionResult> {
  await requireOperator();
  if (!DECISIONS.has(decision)) return { ok: false, error: "Unknown decision." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false, status: decision };

  try {
    const operator = await getOperatorActor();
    const tenant = await getCurrentAgentTaskTenantFields();
    const result = await decideAsset({
      assetId,
      campaignId,
      decision: decision as ApprovalDecision,
      operator,
      tenant,
      acknowledgement,
    });
    revalidatePath(`/campaigns/${campaignId}`);
    return { ok: true, persisted: true, status: result.status };
  } catch (error) {
    // Carried through as its own shape: the UI opens the acknowledgement field
    // on this, where a generic error would just be a red line to read.
    if (error instanceof ApprovalBlockedError) {
      return { ok: false, error: error.message, reason: "acknowledgement_required", blockers: error.blockers };
    }
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
    const { dispatched, agentTaskId } = await requestAssetRevision({ campaignId, assetId, instruction: cleaned, operator });
    revalidatePath(`/campaigns/${campaignId}`);
    return { ok: true, persisted: true, status: "revision_requested", dispatched, agentTaskId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not request the revision." };
  }
}

/**
 * Send a stranded revision to Arc again.
 *
 * The revision was already recorded — this only re-wakes the existing task, so
 * pressing it twice cannot produce two revisions. `redispatchStalledRevision`
 * re-reads the row and refuses anything that has already started. Nothing here
 * touches outbound: a revision produces a draft, and the approval gate is
 * untouched.
 */
export async function retryCampaignRevision(campaignId: string, agentTaskId: string): Promise<CampaignActionResult> {
  await requireOperator();

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false, status: "revision_requested" };

  try {
    const operator = await getOperatorActor();
    const { org_id: orgId } = await getCurrentAgentTaskTenantFields();
    const result = await redispatchStalledRevision({ agentTaskId, orgId, operator });

    if (!result.ok) {
      return {
        ok: false,
        error:
          result.reason === "already_running"
            ? "Arc has already picked this up — no need to retry."
            : "That revision request is no longer available.",
      };
    }

    revalidatePath(`/campaigns/${campaignId}`);
    return { ok: true, persisted: true, status: "revision_requested", dispatched: result.dispatched };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not retry the revision." };
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

export type ApplyFindingFixActionResult =
  | { ok: true; persisted: boolean; replaced?: number }
  | { ok: false; error: string };

/**
 * Fill in the one value a claims-review finding is asking for, and apply it to
 * the draft (BSR-743).
 *
 * An edit, not a decision: it writes through the same path as the inline
 * editor, leaves dispatch locked, and the deliverable still needs approving.
 * The finding closes because it has been answered, not because anyone approved
 * anything.
 */
export async function applyFindingFixAction(input: {
  campaignId: string;
  findingId: string;
  value: string;
}): Promise<ApplyFindingFixActionResult> {
  await requireOperator();
  if (!input.findingId) return { ok: false, error: "Missing finding." };
  if (!input.value.trim()) return { ok: false, error: "Add the value first — nothing was changed." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  try {
    const [operator, ctx] = await Promise.all([getOperatorActor(), getCurrentWorkspaceContext()]);
    // Refuse rather than fall back to org-wide. Applying a fix edits copy, and
    // an unresolved workspace is not a reason to widen what may be edited.
    if (!ctx.workspaceId) return { ok: false, error: "No workspace is selected, so nothing was changed." };
    const result = await applyFindingFix(
      { findingId: input.findingId, value: input.value, orgId: ctx.orgId, workspaceId: ctx.workspaceId },
      operator,
    );
    if (!result.ok) {
      if (result.reason === "not_found") {
        return { ok: false, error: "That finding is no longer open. Nothing was changed." };
      }
      if (result.reason === "no_fix") {
        return { ok: false, error: "This finding doesn't have a value to fill in. Nothing was changed." };
      }
      return { ok: false, error: describeFixFailure(result.reason, result.target) };
    }
    revalidatePath(`/campaigns/${input.campaignId}`);
    return { ok: true, persisted: true, replaced: result.replaced };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not apply that fix." };
  }
}

/**
 * Record a decision on ONE piece of creative, from the campaign that carries it.
 *
 * The picture and the deliverable are separate approvals and always have been:
 * approving an email does not approve the image inside it, which is why the
 * preview says so out loud. Until now the only place a picture could be decided
 * was `/library` — so a reviewer looking straight at the creative, in the
 * campaign it belongs to, had to leave, find it among everything else the
 * workspace has ever stored, and decide it out of context. This is the same
 * decision from where it is actually made.
 *
 * It writes through `decideAssetApproval`, the one asset-approval path
 * (`approval_items` + `approval_decisions`, same table and audit trail as
 * campaigns) — deliberately NOT a second, softer route to "approved". The
 * flagged-asset acknowledgement gate comes with it, and reads the flags from the
 * row rather than from this call.
 *
 * Approving here readies the image for a human-gated next step. It sends
 * nothing and unlocks no dispatch, exactly as every other approval on this
 * screen.
 */
export type DecideMediaActionResult =
  | { ok: true; persisted: boolean; status: AssetDecision; reviewer: string; reviewedAt: string }
  | { ok: false; error: string; flags?: string[] };

export async function decideCampaignMediaAction(input: {
  campaignId: string;
  /** The entry's identity as the read-model built it — id when recorded, else storage path. */
  libraryAssetId: string | null;
  storagePath: string | null;
  decision: AssetDecision;
  notes?: string | null;
  /** Required to approve a picture that carries risk flags. */
  acknowledgement?: string | null;
}): Promise<DecideMediaActionResult> {
  await requireOperator();
  if (!ASSET_DECISIONS.has(input.decision)) return { ok: false, error: "Unknown decision." };

  if (!isSupabaseAdminConfigured()) {
    return {
      ok: true,
      persisted: false,
      status: input.decision,
      reviewer: "You",
      reviewedAt: new Date().toISOString(),
    };
  }

  const ctx = await getCurrentWorkspaceContext();
  // Refuse rather than widen to org-wide. An unresolved workspace is not a
  // reason to let a decision land on any picture in the organisation.
  if (!ctx.orgId || !ctx.workspaceId) return { ok: false, error: "No workspace is selected, so nothing was recorded." };

  try {
    const client = getSupabaseAdminClient();
    // Resolved through the same rule the read-model used to decide what this
    // picture's review state IS, so the decision lands on the row the operator
    // was shown — see media-identity.ts.
    const resolved = await resolveMediaAssetId(
      client,
      { libraryAssetId: input.libraryAssetId, storagePath: input.storagePath },
      ctx.orgId,
      ctx.workspaceId,
    );
    // A picture with no row is a real case (composites predate the Library
    // registration). Say so — do not report a decision nothing recorded.
    if (!resolved.ok) return { ok: false, error: MEDIA_RESOLVE_MESSAGE[resolved.reason] };

    const operator = await getOperatorActor();
    const result = await decideAssetApproval(
      {
        assetId: resolved.assetId,
        orgId: ctx.orgId,
        decision: input.decision,
        operator,
        notes: input.notes ?? null,
        acknowledgement: input.acknowledgement ?? null,
      },
      client,
    );
    if (!result.ok) return { ok: false, error: result.error, flags: result.flags };

    revalidatePath(`/campaigns/${input.campaignId}`);
    // The Library shows the same asset's state, and it is now stale there too.
    revalidatePath("/library");
    return {
      ok: true,
      persisted: true,
      status: result.status,
      reviewer: operator,
      reviewedAt: new Date().toISOString(),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not record the decision." };
  }
}
