import { type SupabaseClient } from "@supabase/supabase-js";

import { isFixKind, redactSecrets, type FixKind } from "@/domain";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { addApprovalRecommendation } from "./approvals";
import { type ArcTenantScope } from "./drafts";

/**
 * Persistence for the draft critic's claims review.
 *
 * SAFETY — this is advisory, and the code enforces that:
 *  - It never touches `approval_items.status`, never writes `approval_decisions`,
 *    and never unlocks dispatch. The human decision path is untouched.
 *  - It can RAISE `risk_level` but can never lower a deterministic `blocked`.
 *    `blocked` means the copy screen matched the org's banned-phrase list — a
 *    fact. The critic's judgment is an opinion, and an opinion must not be able
 *    to clear a fact.
 */

export type DraftReviewVerdict = "grounded" | "unsupported" | "fabricated";

/** The one value a finding is asking for (BSR-743). Null for the ordinary case:
 *  most findings are judgement, not a blank to fill in. */
export type DraftReviewFix = {
  target: string;
  label: string;
  kind: FixKind;
};

export type DraftReviewFinding = {
  claim: string;
  verdict: DraftReviewVerdict;
  note: string;
  fix?: DraftReviewFix | null;
};

export type RecordDraftReviewInput = {
  assetId: string;
  /** The critic's derived risk. `blocked` is not reachable — see riskFromFindings. */
  riskLevel: "low" | "medium" | "high";
  recommendation: string;
  rationale?: string | null;
  riskFlags?: string[];
  suggestedEdits?: string | null;
  findings: DraftReviewFinding[];
};

export type RecordDraftReviewResult =
  | { ok: true; approvalItemId: string; riskLevel: string; findingsRecorded: number }
  | { ok: false; reason: "not_found" };

/**
 * The fix columns, or nulls. Trimmed and length-capped like the other text the
 * critic supplies, and dropped entirely unless both halves survive that — the
 * database would reject a target with a blank label, and failing the whole
 * review insert over an optional extra would lose the findings with it.
 */
function fixColumns(fix: DraftReviewFix | null | undefined): {
  fix_target: string | null;
  fix_label: string | null;
  fix_kind: string | null;
} {
  const target = fix?.target?.trim().slice(0, 500) ?? "";
  const label = fix?.label?.trim().slice(0, 120) ?? "";
  if (!target || !label) return { fix_target: null, fix_label: null, fix_kind: null };
  return { fix_target: target, fix_label: label, fix_kind: isFixKind(fix?.kind) ? fix.kind : "text" };
}

/** A grounded claim is the absence of a finding, so only problems become rows. */
const SEVERITY_BY_VERDICT: Record<DraftReviewVerdict, "info" | "warning" | "blocker" | null> = {
  grounded: null,
  unsupported: "warning",
  fabricated: "blocker",
};

export async function recordDraftReview(
  input: RecordDraftReviewInput,
  client: SupabaseClient = getSupabaseAdminClient(),
  scope?: ArcTenantScope,
): Promise<RecordDraftReviewResult> {
  // Resolve the gate this asset already has. The critic reviews copy that is
  // already in the queue; it never creates the gate.
  let query = client
    .from("approval_items")
    .select("id,risk_level")
    .eq("campaign_asset_id", input.assetId);
  if (scope) query = query.eq("org_id", scope.orgId);
  const { data: item, error: lookupError } = await query.maybeSingle<{ id: string; risk_level: string }>();
  if (lookupError) throw new Error(`approval lookup failed: ${lookupError.message}`);
  if (!item) return { ok: false, reason: "not_found" };

  const problems = input.findings.filter((f) => SEVERITY_BY_VERDICT[f.verdict] !== null);
  const grounded = input.findings.length - problems.length;

  if (problems.length > 0) {
    // guardrail_findings carries its own org_id + workspace_id as of BSR-653.
    //
    // It used to rely on being "scoped transitively" by its approval_item_id /
    // campaign_asset_id FKs. That was never true: every one of its four parent
    // FKs is nullable, so a row could be written attached to nothing and
    // belonging to no tenant. The columns are NOT NULL now, so a scope-less
    // caller fails here rather than writing an unplaceable row.
    if (!scope) {
      throw new Error("guardrail_findings requires a resolved org and workspace — call recordDraftReview with a scope.");
    }
    const { error: findingsError } = await client.from("guardrail_findings").insert(
      problems.map((finding) => ({
        org_id: scope.orgId,
        workspace_id: scope.workspaceId,
        approval_item_id: item.id,
        campaign_asset_id: input.assetId,
        scope: "generated_output" as const,
        severity: SEVERITY_BY_VERDICT[finding.verdict],
        status: "open" as const,
        matched_text: redactSecrets(finding.claim).slice(0, 2000),
        finding_message: redactSecrets(finding.note).slice(0, 2000) || `Claim is ${finding.verdict}.`,
        metadata: { verdict: finding.verdict, reviewer: "draft-critic" },
        // All three or nothing — the CHECK constraint rejects a half-fix, so
        // the guard here is the same shape rather than a looser one. A target
        // the critic quoted but that is not in the copy is left for the apply
        // path to refuse: it reads the draft as it stands, and this write does
        // not.
        ...fixColumns(finding.fix),
      })),
    );
    if (findingsError) throw new Error(`guardrail_findings insert failed: ${findingsError.message}`);
  }

  // Advisory summary the operator actually sees on the approval card.
  const recommendation = await addApprovalRecommendation(
    {
      approvalItemId: item.id,
      agent: "draft-critic",
      recommendation: input.recommendation,
      rationale: input.rationale ?? null,
      riskFlags: input.riskFlags ?? [],
      suggestedEdits: input.suggestedEdits ?? null,
      metadata: { claims_checked: input.findings.length, grounded, problems: problems.length },
    },
    client,
    scope,
  );
  if (!recommendation.ok) return { ok: false, reason: "not_found" };

  // An opinion must not clear a fact: a banned-phrase block stands regardless of
  // what the critic concluded.
  const riskLevel = item.risk_level === "blocked" ? "blocked" : input.riskLevel;
  if (riskLevel !== item.risk_level) {
    const { error: riskError } = await client
      .from("approval_items")
      .update({ risk_level: riskLevel })
      .eq("id", item.id);
    if (riskError) throw new Error(`risk_level update failed: ${riskError.message}`);
  }

  return { ok: true, approvalItemId: item.id, riskLevel, findingsRecorded: problems.length };
}
