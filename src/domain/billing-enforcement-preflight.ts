/**
 * Pre-flight for arming `ARC_BILLING_ENFORCEMENT` (BSR-621).
 *
 * The failure this exists to prevent: `org_plans` is empty on prod, so every org
 * falls through to `DEFAULT_PLAN_TIER = "free"` and its $2/month cap. Both live
 * orgs are already past it. Arming enforcement would therefore block the
 * workspace that pays the bills, instantly and silently — and BSR-505's
 * checklist literally instructs an operator to arm it.
 *
 * A human reading a checklist is not a safeguard. This is the check that runs
 * before the switch moves.
 *
 * Pure and deterministic — the caller supplies the snapshot, this decides. The
 * reader lives in `src/lib/billing/enforcement-preflight.ts` and the operator
 * entry point is `scripts/check-billing-enforcement-safety.mjs`.
 */

export type OrgEnforcementSnapshot = {
  orgSlug: string;
  /** False when the org has no `org_plans` row and is falling through to free. */
  hasPlanRow: boolean;
  /** Effective cap in cents, already resolved (tier default or negotiated override). */
  capCents: number;
  /** Month-to-date metered spend in cents. */
  usedCents: number;
  /** True when a lapsed trial would put the workspace in read-only. */
  trialReadOnly?: boolean;
};

export type EnforcementRiskReason =
  /** Over cap AND no plan row — the org was never assigned a tier at all. */
  | "over_cap_no_plan_row"
  /** Over cap with a real plan row — a genuine overage, not a configuration gap. */
  | "over_cap"
  /** Lapsed trial would flip the workspace read-only the moment enforcement arms. */
  | "trial_expired";

export type EnforcementRisk = {
  orgSlug: string;
  reason: EnforcementRiskReason;
  usedCents: number;
  capCents: number;
};

export type EnforcementPreflight = {
  /** True when arming enforcement right now would block nobody. */
  safe: boolean;
  blocked: EnforcementRisk[];
  /** Orgs with no `org_plans` row, blocked or not — the configuration gap. */
  missingPlanRows: string[];
  checked: number;
};

/**
 * Decide whether enforcement can be armed safely.
 *
 * Mirrors `checkUsageAllowed`: the block condition is `usedCents >= capCents`
 * (inclusive), plus the read-only trial state, because both ride the same flag.
 * If that gate ever changes, this must change with it or the pre-flight starts
 * lying in the reassuring direction.
 */
export function previewBillingEnforcement(
  snapshots: readonly OrgEnforcementSnapshot[],
): EnforcementPreflight {
  const blocked: EnforcementRisk[] = [];
  const missingPlanRows: string[] = [];

  for (const snap of snapshots) {
    if (!snap.hasPlanRow) missingPlanRows.push(snap.orgSlug);

    // Trial expiry is reported first for the same reason checkUsageAllowed
    // reports it first: it is the actionable message, and an expired workspace
    // is usually also over its allowance.
    if (snap.trialReadOnly) {
      blocked.push({
        orgSlug: snap.orgSlug,
        reason: "trial_expired",
        usedCents: snap.usedCents,
        capCents: snap.capCents,
      });
      continue;
    }

    if (snap.usedCents >= snap.capCents) {
      blocked.push({
        orgSlug: snap.orgSlug,
        reason: snap.hasPlanRow ? "over_cap" : "over_cap_no_plan_row",
        usedCents: snap.usedCents,
        capCents: snap.capCents,
      });
    }
  }

  return {
    safe: blocked.length === 0,
    blocked,
    missingPlanRows,
    checked: snapshots.length,
  };
}

/** One-line operator summary per blocked org. */
export function describeRisk(risk: EnforcementRisk): string {
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const detail = `${money(risk.usedCents)} used of ${money(risk.capCents)} cap`;
  switch (risk.reason) {
    case "over_cap_no_plan_row":
      return `${risk.orgSlug}: ${detail} — NO org_plans row, so it is on the free tier by default`;
    case "over_cap":
      return `${risk.orgSlug}: ${detail} — over its assigned cap`;
    case "trial_expired":
      return `${risk.orgSlug}: trial lapsed — would go read-only immediately`;
  }
}
