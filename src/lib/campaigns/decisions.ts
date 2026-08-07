import { type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminClient } from "../supabase/server";
import { type AgentTaskTenantFields } from "../agent-tasks/scope";
import { workspaceScopeFields } from "@/lib/tenancy/write-scope";
import { buildDecisionNote, checkAssetApproval } from "@/domain";

export type ApprovalDecision = "approved" | "declined" | "archived";

export type DecideApprovalInput = {
  approvalItemId: string;
  decision: ApprovalDecision;
  operator: string;
  notes?: string;
  tenant?: AgentTaskTenantFields;
};

const VALID_CAMPAIGN_STATUSES = new Set([
  "draft", "briefing", "generating", "pending_approval", "approved", "active", "paused", "archived", "blocked",
]);

/** Map an approval decision to a valid campaign_status. Declined work becomes unavailable (blocked). */
function decisionToCampaignStatus(decision: ApprovalDecision): string {
  if (decision === "approved") return "approved";
  if (decision === "archived") return "archived";
  return "blocked"; // declined
}

/** Coerce an arbitrary approval_status into a valid campaign_status, defaulting to pending_approval. */
function toCampaignStatus(status: string): string {
  return VALID_CAMPAIGN_STATUSES.has(status) ? status : "pending_approval";
}

/**
 * Record a human decision on a campaign approval item. A real backend state
 * transition: logs an approval_decision, moves the approval item + linked asset
 * + campaign to the decided status, and writes a campaign event.
 *
 * Outbound dispatch is NEVER unlocked here; approval marks the work ready for a
 * human-gated next step; it does not send anything (`dispatch_locked` /
 * `launch_locked` are left intact).
 */
export async function decideApprovalItem(
  input: DecideApprovalInput,
  client: SupabaseClient = getSupabaseAdminClient(),
) {
  const { approvalItemId, decision, operator, notes, tenant } = input;
  const now = new Date().toISOString();

  const { data: item, error: itemError } = await applyOrgScope(
    client
      .from("approval_items")
      .select("id,status,campaign_id,campaign_asset_id")
      .eq("id", approvalItemId),
    tenant,
  ).maybeSingle<{ id: string; status: string; campaign_id: string | null; campaign_asset_id: string | null }>();
  assertOk("approval_items lookup", itemError);
  if (!item) {
    throw new Error("Approval item not found.");
  }

  const { error: decisionError } = await client.from("approval_decisions").insert({
    ...workspaceScopeFields(tenant),
    approval_item_id: item.id,
    decision,
    decided_by: operator,
    decision_notes: notes ?? null,
    previous_status: item.status,
    next_status: decision,
    metadata: { source: "campaigns_workspace", outbound_locked: true },
  });
  assertOk("approval_decisions insert", decisionError);

  const { error: updateItemError } = await applyOrgScope(
    client
      .from("approval_items")
      .update({ status: decision, reviewed_by: operator, reviewed_at: now, decision_notes: notes ?? null })
      .eq("id", item.id),
    tenant,
  );
  assertOk("approval_items update", updateItemError);

  if (item.campaign_asset_id) {
    const assetUpdate: Record<string, unknown> = { status: decision };
    if (decision === "approved") {
      assetUpdate.approved_by = operator;
      assetUpdate.approved_at = now;
    }
    const { error: assetError } = await applyOrgScope(client.from("campaign_assets").update(assetUpdate).eq("id", item.campaign_asset_id), tenant);
    assertOk("campaign_assets update", assetError);
  }

  if (item.campaign_id) {
    const { error: campaignError } = await applyOrgScope(client.from("campaigns").update({ status: decisionToCampaignStatus(decision) }).eq("id", item.campaign_id), tenant);
    assertOk("campaigns update", campaignError);

    const { error: eventError } = await client.from("campaign_events").insert({
      ...workspaceScopeFields(tenant),
      campaign_id: item.campaign_id,
      campaign_asset_id: item.campaign_asset_id,
      approval_item_id: item.id,
      event_type: decision === "archived" ? "archived" : "approval_decided",
      actor: operator,
      detail: `Campaign ${decision} by ${operator}${notes ? `: ${notes}` : ""}`,
      payload: { decision, outbound_locked: true },
    });
    assertOk("campaign_events insert", eventError);
  }

  return { approvalItemId: item.id, decision, status: decision };
}

export type DecideAssetInput = {
  assetId: string;
  campaignId: string;
  decision: ApprovalDecision;
  operator: string;
  notes?: string;
  tenant?: AgentTaskTenantFields;
  /**
   * How the reviewer addressed the asset's blocking findings. Required to
   * APPROVE an asset that has any; ignored for every other decision.
   */
  acknowledgement?: string | null;
};

/** Raised when approval is refused for want of an acknowledgement. */
export class ApprovalBlockedError extends Error {
  readonly reason = "acknowledgement_required" as const;
  readonly blockers: string[];
  constructor(message: string, blockers: string[]) {
    super(message);
    this.name = "ApprovalBlockedError";
    this.blockers = blockers;
  }
}

/**
 * The blocking concerns on an asset, in the reviewer's words.
 *
 * Two sources, because the review surface counts both (see review-summary.ts):
 * `guardrail_findings` rows at severity `blocker` that are still OPEN, and any
 * phrase the Brand Kit bans, which the summary treats as a hard block in exactly
 * the same sense.
 *
 * Read at DECISION time rather than trusted from the client. The count the card
 * renders came from a page load that may be minutes old, and it arrives from a
 * browser — neither is a basis for letting something through the outbound gate.
 */
async function loadBlockingConcerns(
  assetId: string,
  client: SupabaseClient,
  tenant?: AgentTaskTenantFields,
): Promise<string[]> {
  const [findingsResult, assetResult] = await Promise.all([
    applyOrgScope(
      client
        .from("guardrail_findings")
        .select("severity,status,finding_message,matched_text")
        .eq("campaign_asset_id", assetId),
      tenant,
    ),
    applyOrgScope(client.from("campaign_assets").select("audit_payload").eq("id", assetId), tenant).maybeSingle<{
      audit_payload: unknown;
    }>(),
  ]);
  assertOk("guardrail_findings lookup", findingsResult.error);
  assertOk("campaign_assets guardrail lookup", assetResult.error);

  const rows = (findingsResult.data ?? []) as Array<{
    severity: string | null;
    status: string | null;
    finding_message: string | null;
    matched_text: string | null;
  }>;
  const blockers = rows
    .filter((r) => (r.severity ?? "").toLowerCase() === "blocker" && (r.status ?? "").toLowerCase() === "open")
    .map((r) => (r.finding_message ?? r.matched_text ?? "").trim())
    .filter(Boolean);

  const payload = assetResult.data?.audit_payload;
  const guardrail = asRecord(payload)?.guardrail;
  const phrases = asRecord(guardrail)?.blocked_phrases;
  const blockedPhrases = Array.isArray(phrases)
    ? phrases.map((p) => (typeof p === "string" ? p.trim() : "")).filter(Boolean)
    : [];

  return [...blockers, ...blockedPhrases.map((p) => `Banned phrase: ${p}`)];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Decide a deliverable by asset id — the unit operators actually act on. Every
 * deliverable is decidable: if an approval_item gates it we record the decision
 * through the normal approval path; if none exists (Arc created the asset
 * without a gate) we transition the asset directly and log the event. Never
 * unlocks dispatch — that's a separate launch/deploy step.
 */
export async function decideAsset(
  input: DecideAssetInput,
  client: SupabaseClient = getSupabaseAdminClient(),
) {
  const { assetId, campaignId, decision, operator, notes, tenant, acknowledgement } = input;

  /**
   * The gate the review surface had been asserting and nobody enforced.
   *
   * `review-summary.ts` calls these `blockers`, documents them as "Findings that
   * must be fixed before this can go out", and renders "N things to fix before
   * this can go out" in red. Nothing consulted them: not this function, not
   * `launchCampaign`, not the send executor. A deliverable with open blockers
   * approved in one click and went out — while a flagged IMAGE could not be
   * approved without saying how the flag was addressed, because the media path
   * runs `checkAssetApproval`. One review flow, two different rules.
   *
   * Now the same rule, from the same domain function, for both. Only approval is
   * gated: declining or asking for a revision is how a reviewer ACTS on a
   * blocker, and making them justify that first would push them toward approving
   * as the easier path.
   *
   * Ahead of the branch below on purpose — an asset with no approval row takes
   * the direct-write path, and that is exactly the one that must not be a way
   * around the gate.
   */
  // Loaded once: the gate and the audit note both need the same list.
  const blockers = decision === "approved" ? await loadBlockingConcerns(assetId, client, tenant) : [];
  if (decision === "approved") {
    const verdict = checkAssetApproval({
      decision: "approved",
      riskFlags: blockers,
      acknowledgement,
      concernNoun: { one: "a blocking finding", many: "blocking findings" },
    });
    if (!verdict.allowed) throw new ApprovalBlockedError(verdict.message, verdict.flags);
  }

  // The reviewer's words, with the blockers they were shown, so the audit trail
  // answers "what did they know when they approved it?" and not just "approved".
  const decidedNotes =
    blockers.length > 0
      ? buildDecisionNote({ decision: "approved", riskFlags: blockers, acknowledgement }, notes) ?? undefined
      : notes;

  const { data: approval, error: approvalError } = await applyOrgScope(
    client
      .from("approval_items")
      .select("id")
      .eq("campaign_asset_id", assetId)
      .order("submitted_at", { ascending: false })
      .limit(1),
    tenant,
  ).maybeSingle<{ id: string }>();
  assertOk("approval_items (asset) lookup", approvalError);

  if (approval) {
    return decideApprovalItem({ approvalItemId: approval.id, decision, operator, notes: decidedNotes, tenant }, client);
  }

  // No gate yet — act on the asset directly so it's never a dead-end draft.
  const now = new Date().toISOString();
  const assetUpdate: Record<string, unknown> = { status: decision };
  if (decision === "approved") {
    assetUpdate.approved_by = operator;
    assetUpdate.approved_at = now;
  }
  const { error: assetError } = await applyOrgScope(client.from("campaign_assets").update(assetUpdate).eq("id", assetId), tenant);
  assertOk("campaign_assets decide", assetError);

  const { error: eventError } = await client.from("campaign_events").insert({
    ...workspaceScopeFields(tenant),
    campaign_id: campaignId || null,
    campaign_asset_id: assetId,
    event_type: decision === "archived" ? "archived" : "approval_decided",
    actor: operator,
    detail: `Deliverable ${decision} by ${operator}${notes ? `: ${notes}` : ""}`,
    payload: { decision, asset_only: true, outbound_locked: true },
  });
  assertOk("campaign_events insert", eventError);

  return { assetId, decision, status: decision };
}

export type UndoAssetDecisionInput = {
  assetId: string;
  operator: string;
  tenant?: AgentTaskTenantFields;
};

/**
 * Undo the last decision on a deliverable by ASSET id — the unit operators act
 * on, mirroring `decideAsset`'s lookup so the two are symmetric.
 *
 * `undoDecision` is keyed by approval item, which the chat has never held: a
 * card carries `{ campaignId, assetId }`. Verified against prod before wiring —
 * all 13 asset ids referenced by Arc chat cards have an approval_items row, so
 * this reaches the real path rather than being another entry point onto nothing.
 *
 * The asset-only branch of `decideAsset` (no gate, status written straight onto
 * campaign_assets) has no approval_decisions row to reverse, so it is refused
 * explicitly rather than silently doing nothing. Outbound stays locked either
 * way — undo restores a status, it never sends.
 */
export async function undoAssetDecision(
  input: UndoAssetDecisionInput,
  client: SupabaseClient = getSupabaseAdminClient(),
) {
  const { assetId, operator, tenant } = input;

  const { data: approval, error: approvalError } = await applyOrgScope(
    client
      .from("approval_items")
      .select("id")
      .eq("campaign_asset_id", assetId)
      .order("submitted_at", { ascending: false })
      .limit(1),
    tenant,
  ).maybeSingle<{ id: string }>();
  assertOk("approval_items (asset) lookup", approvalError);

  if (!approval) {
    throw new Error("This deliverable was decided without an approval record, so there is nothing to undo.");
  }

  return undoDecision({ approvalItemId: approval.id, operator, tenant }, client);
}

export type ReopenAssetInput = {
  assetId: string;
  campaignId: string;
  operator: string;
  tenant?: AgentTaskTenantFields;
};

/**
 * Send a decided / deployed / removed deliverable back to "needs approval" —
 * the change-your-mind path. Restores the asset (and any approval gate) to
 * pending, RE-LOCKS dispatch (so a deployed piece is pulled back), logs an
 * append-only reversal, and records an `approval_submitted` event. Never
 * deletes history.
 */
export async function reopenAsset(
  input: ReopenAssetInput,
  client: SupabaseClient = getSupabaseAdminClient(),
) {
  const { assetId, campaignId, operator, tenant } = input;
  const now = new Date().toISOString();

  const { data: approval, error: approvalError } = await applyOrgScope(
    client
      .from("approval_items")
      .select("id,status")
      .eq("campaign_asset_id", assetId)
      .order("submitted_at", { ascending: false })
      .limit(1),
    tenant,
  ).maybeSingle<{ id: string; status: string }>();
  assertOk("approval_items lookup", approvalError);

  if (approval) {
    const { error: decisionError } = await client.from("approval_decisions").insert({
      ...workspaceScopeFields(tenant),
      approval_item_id: approval.id,
      decision: "reverted",
      decided_by: operator,
      decision_notes: "Re-opened for review",
      previous_status: approval.status,
      next_status: "pending_approval",
      metadata: { source: "campaigns_workspace_reopen", outbound_locked: true },
    });
    assertOk("approval_decisions insert (reopen)", decisionError);

    const { error: updateApprovalError } = await applyOrgScope(
      client
        .from("approval_items")
        .update({ status: "pending_approval", reviewed_by: null, reviewed_at: null, decision_notes: null })
        .eq("id", approval.id),
      tenant,
    );
    assertOk("approval_items update (reopen)", updateApprovalError);
  }

  const { error: assetError } = await applyOrgScope(
    client
      .from("campaign_assets")
      .update({ status: "pending_approval", approved_by: null, approved_at: null, dispatch_locked: true })
      .eq("id", assetId),
    tenant,
  );
  assertOk("campaign_assets update (reopen)", assetError);

  const { error: eventError } = await client.from("campaign_events").insert({
    ...workspaceScopeFields(tenant),
    campaign_id: campaignId || null,
    campaign_asset_id: assetId,
    approval_item_id: approval?.id ?? null,
    event_type: "reopened",
    actor: operator,
    detail: `Re-opened for review by ${operator}; dispatch re-locked.`,
    payload: { reopened_at: now, outbound_locked: true },
  });
  assertOk("campaign_events insert (reopen)", eventError);

  return { assetId };
}

export type UndoDecisionInput = {
  approvalItemId: string;
  operator: string;
  tenant?: AgentTaskTenantFields;
};

/**
 * Append-only reversal of the most recent decision on an approval item. Restores
 * the item (and any linked asset/campaign) to the decision's previous_status and
 * records a `reverted` approval_decisions row. Never deletes history; never
 * unlocks outbound. Throws if there is nothing to undo or the last decision was
 * already a reversal.
 */
export async function undoDecision(
  input: UndoDecisionInput,
  client: SupabaseClient = getSupabaseAdminClient(),
) {
  const { approvalItemId, operator, tenant } = input;

  const { data: last, error: lastError } = await applyOrgScope(
    client
      .from("approval_decisions")
      .select("id,decision,previous_status,next_status")
      .eq("approval_item_id", approvalItemId)
      .order("decided_at", { ascending: false })
      .limit(1),
    tenant,
  ).maybeSingle<{ id: string; decision: string; previous_status: string | null; next_status: string }>();
  assertOk("approval_decisions lookup", lastError);
  if (!last) {
    throw new Error("No decision to undo for this approval item.");
  }
  if (last.decision === "reverted") {
    throw new Error("The last action was already an undo; nothing to revert.");
  }

  const restoredStatus = last.previous_status ?? "pending_approval";

  const { data: item, error: itemError } = await applyOrgScope(
    client
      .from("approval_items")
      .select("id,status,campaign_id,campaign_asset_id")
      .eq("id", approvalItemId),
    tenant,
  ).maybeSingle<{ id: string; status: string; campaign_id: string | null; campaign_asset_id: string | null }>();
  assertOk("approval_items lookup", itemError);
  if (!item) {
    throw new Error("Approval item not found.");
  }

  const { error: decisionError } = await client.from("approval_decisions").insert({
    ...workspaceScopeFields(tenant),
    approval_item_id: approvalItemId,
    decision: "reverted",
    decided_by: operator,
    previous_status: last.next_status,
    next_status: restoredStatus,
    metadata: { source: "approval_inbox_undo", reverted_decision_id: last.id, outbound_locked: true },
  });
  assertOk("approval_decisions insert (revert)", decisionError);

  const { error: updateItemError } = await applyOrgScope(
    client
      .from("approval_items")
      .update({ status: restoredStatus, reviewed_by: null, reviewed_at: null })
      .eq("id", approvalItemId),
    tenant,
  );
  assertOk("approval_items update (revert)", updateItemError);

  if (item.campaign_asset_id) {
    const { error: assetError } = await applyOrgScope(
      client
        .from("campaign_assets")
        .update({ status: restoredStatus, approved_by: null, approved_at: null })
        .eq("id", item.campaign_asset_id),
      tenant,
    );
    assertOk("campaign_assets update (revert)", assetError);
  }

  if (item.campaign_id) {
    const { error: campaignError } = await applyOrgScope(client.from("campaigns").update({ status: toCampaignStatus(restoredStatus) }).eq("id", item.campaign_id), tenant);
    assertOk("campaigns update (revert)", campaignError);

    const { error: eventError } = await client.from("campaign_events").insert({
      ...workspaceScopeFields(tenant),
      campaign_id: item.campaign_id,
      campaign_asset_id: item.campaign_asset_id,
      approval_item_id: approvalItemId,
      event_type: "decision_reverted",
      actor: operator,
      detail: `Decision undone by ${operator}; restored to ${restoredStatus}.`,
      payload: { reverted_decision_id: last.id, outbound_locked: true },
    });
    assertOk("campaign_events insert (revert)", eventError);
  }

  return { approvalItemId, restoredStatus };
}

function assertOk(label: string, error: { message: string } | null) {
  if (error) {
    throw new Error(`${label} failed: ${error.message}`);
  }
}

function applyOrgScope<Query>(query: Query, tenant?: AgentTaskTenantFields): Query {
  if (!tenant) return query;
  return (query as { eq(column: string, value: string): Query }).eq("org_id", tenant.org_id);
}

