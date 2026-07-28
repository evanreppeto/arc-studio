// Asset approval rules — pure, no I/O. BSR-538.
//
// Assets are approved through `approval_items`, the same table campaigns use, so
// there is exactly one approval concept and one audit trail (decided on BSR-514).
// This module holds the rules that decision must obey.
//
// The rule that needed this ticket: **a flagged asset cannot be approved without
// acknowledging the flag.** Risk flags exist so a reviewer weighs something
// specific before it can reach a customer; if approval sails past them they are
// decoration. Declining or requesting revision needs no acknowledgement — only
// approval carries the risk forward.

/** The `item_type` value that marks an approval row as being about a media asset. */
export const MEDIA_ASSET_ITEM_TYPE = "media_asset";

/** Decisions a reviewer can take on an asset. Mirrors the campaign vocabulary. */
export type AssetDecision = "approved" | "declined" | "needs_revision" | "archived";

/** The approval_status an asset sits in. */
export type AssetApprovalStatus = "draft" | "pending_approval" | AssetDecision;

export type AssetApprovalRequest = {
  decision: AssetDecision;
  /** Risk flags currently on the asset, including provenance-derived ones. */
  riskFlags: readonly string[];
  /**
   * The reviewer's written acknowledgement of those flags. Required to APPROVE a
   * flagged asset; ignored otherwise.
   */
  acknowledgement?: string | null;
};

export type AssetApprovalVerdict =
  | { allowed: true; requiresAcknowledgement: boolean }
  | { allowed: false; reason: "acknowledgement_required"; message: string; flags: string[] };

/** Minimum length for an acknowledgement to count as considered rather than clicked-through. */
const MIN_ACKNOWLEDGEMENT_CHARS = 3;

/**
 * Whether a decision may proceed.
 *
 * Only APPROVAL is gated. Declining or asking for a revision is how a reviewer
 * acts ON a concern, so requiring them to justify it first would be backwards —
 * and worse, it would nudge reviewers toward approving as the path of least
 * resistance, which is the exact opposite of what a risk flag is for.
 */
export function checkAssetApproval(request: AssetApprovalRequest): AssetApprovalVerdict {
  const flags = request.riskFlags.filter((f) => f.trim().length > 0);
  const requiresAcknowledgement = request.decision === "approved" && flags.length > 0;

  if (!requiresAcknowledgement) return { allowed: true, requiresAcknowledgement: false };

  const ack = (request.acknowledgement ?? "").trim();
  if (ack.length < MIN_ACKNOWLEDGEMENT_CHARS) {
    return {
      allowed: false,
      reason: "acknowledgement_required",
      message:
        flags.length === 1
          ? `This asset carries a risk flag (${flags[0]}). Say how it was addressed before approving.`
          : `This asset carries ${flags.length} risk flags. Say how they were addressed before approving.`,
      flags,
    };
  }

  return { allowed: true, requiresAcknowledgement: true };
}

/**
 * The note stored on the decision. When flags were acknowledged, the flags
 * themselves are recorded alongside the reviewer's words — so the audit trail
 * answers "what did they know when they approved it?", not just "they approved".
 */
export function buildDecisionNote(request: AssetApprovalRequest, note?: string | null): string | null {
  const flags = request.riskFlags.filter((f) => f.trim().length > 0);
  const ack = (request.acknowledgement ?? "").trim();
  const base = (note ?? "").trim();

  if (request.decision === "approved" && flags.length > 0) {
    const parts = [`Acknowledged: ${flags.join(" · ")}`, ack].filter(Boolean);
    return [base, parts.join(" — ")].filter(Boolean).join("\n");
  }
  return base || null;
}

/** Whether a status means the asset has cleared review. */
export function isAssetApproved(status: string | null | undefined): boolean {
  return status === "approved";
}
