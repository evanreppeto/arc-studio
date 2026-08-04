import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { INVALID_JSON, arcGuard, fail, readJson } from "@/app/api/v1/arc/_lib/http";
import { isFixKind } from "@/domain";
import { recordDraftReview, type DraftReviewFinding, type DraftReviewFix, type DraftReviewVerdict } from "@/lib/arc-api/draft-review";

/**
 * The draft critic records an independent claims review of a campaign asset.
 *
 * ADVISORY ONLY. This writes guardrail findings, one approval recommendation,
 * and (at most) a raised risk_level. It never approves, declines, changes
 * status, or unlocks dispatch — the human gate is untouched.
 *
 *   POST /api/v1/arc/drafts/review
 *   { asset_id, risk_level, recommendation, rationale?, risk_flags?,
 *     suggested_edits?, findings: [{ claim, verdict, note }] }
 *   -> 200 { ok, status:"recorded", approvalItemId, riskLevel, findingsRecorded }
 */

const VERDICTS = new Set<DraftReviewVerdict>(["grounded", "unsupported", "fabricated"]);
const CRITIC_RISK_LEVELS = new Set(["low", "medium", "high"]);

/**
 * The optional one-value fix (BSR-743).
 *
 * Dropped rather than rejected when it is malformed: a review whose findings
 * are sound should not 400 because an optional extra came back the wrong shape.
 * The finding still lands, just as prose — which is exactly what every finding
 * was before this existed.
 */
function parseFix(value: unknown): DraftReviewFix | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const target = typeof row.target === "string" ? row.target.trim() : "";
  const label = typeof row.label === "string" ? row.label.trim() : "";
  if (!target || !label) return null;
  const kind = typeof row.kind === "string" ? row.kind : "";
  return { target, label, kind: isFixKind(kind) ? kind : "text" };
}

function parseFindings(value: unknown): DraftReviewFinding[] | null {
  if (!Array.isArray(value)) return null;
  const findings: DraftReviewFinding[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const row = entry as Record<string, unknown>;
    const claim = typeof row.claim === "string" ? row.claim.trim() : "";
    const verdict = typeof row.verdict === "string" ? row.verdict : "";
    const note = typeof row.note === "string" ? row.note.trim() : "";
    if (!claim || !VERDICTS.has(verdict as DraftReviewVerdict)) return null;
    findings.push({ claim, verdict: verdict as DraftReviewVerdict, note, fix: parseFix(row.fix) });
  }
  return findings;
}

export async function POST(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;

  const payload = await readJson(request);
  if (payload === INVALID_JSON || typeof payload !== "object" || payload === null) {
    return fail("rejected", "Request body must be valid JSON.", 400);
  }
  const body = payload as Record<string, unknown>;

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const assetId = str(body.asset_id);
  const recommendation = str(body.recommendation);
  const riskLevel = str(body.risk_level);

  if (!assetId) return fail("rejected", "asset_id is required.", 400);
  if (!recommendation) return fail("rejected", "A non-empty recommendation is required.", 400);
  // `blocked` is intentionally not accepted: it means a banned phrase was matched,
  // which only the deterministic copy screen can establish.
  if (!CRITIC_RISK_LEVELS.has(riskLevel)) {
    return fail("rejected", `risk_level must be one of: ${[...CRITIC_RISK_LEVELS].join(", ")}.`, 400);
  }

  const findings = parseFindings(body.findings ?? []);
  if (!findings) {
    return fail("rejected", "findings must be an array of { claim, verdict, note } with a known verdict.", 400);
  }

  try {
    const result = await recordDraftReview(
      {
        assetId,
        riskLevel: riskLevel as "low" | "medium" | "high",
        recommendation,
        rationale: str(body.rationale) || null,
        riskFlags: Array.isArray(body.risk_flags)
          ? body.risk_flags.filter((flag): flag is string => typeof flag === "string")
          : [],
        suggestedEdits: str(body.suggested_edits) || null,
        findings,
      },
      undefined,
      { orgId: allowed.scope.orgId, workspaceId: allowed.scope.workspaceId },
    );

    if (!result.ok) {
      return fail("rejected", "No approval item found for that asset.", 404);
    }

    // Surface the critique on the campaign workspace immediately.
    revalidatePath("/campaigns");

    return NextResponse.json({
      ok: true,
      status: "recorded",
      approvalItemId: result.approvalItemId,
      riskLevel: result.riskLevel,
      findingsRecorded: result.findingsRecorded,
    });
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Failed to record the review.", 502);
  }
}
