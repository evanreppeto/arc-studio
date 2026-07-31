import { describe, expect, it } from "vitest";

import { PLANS } from "../plans";
import {
  describeRisk,
  previewBillingEnforcement,
  type OrgEnforcementSnapshot,
} from "../billing-enforcement-preflight";

const FREE_CAP = PLANS.free.monthlyCapCents;

function org(partial: Partial<OrgEnforcementSnapshot> = {}): OrgEnforcementSnapshot {
  return { orgSlug: "acme", hasPlanRow: true, capCents: 2500, usedCents: 0, ...partial };
}

describe("previewBillingEnforcement", () => {
  it("reproduces the real prod situation that made this necessary", () => {
    // Measured on prod 2026-07-31. `org_plans` is empty, so the workspace falls
    // through to the free tier's $2 cap — and it is already past it at $2.55.
    // Arming enforcement would have blocked the live workspace instantly.
    //
    // Exactly one org here, not two: the caller filters to status='active', so
    // the archived org (also over cap, at $12.23) is correctly excluded. If that
    // filter is ever dropped, this check starts reporting a false alarm about a
    // workspace nobody uses.
    const result = previewBillingEnforcement([
      { orgSlug: "big-shoulders-restoration-2", hasPlanRow: false, capCents: FREE_CAP, usedCents: 255 },
    ]);

    expect(result.safe).toBe(false);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]?.reason).toBe("over_cap_no_plan_row");
    expect(result.missingPlanRows).toEqual(["big-shoulders-restoration-2"]);
  });

  it("is safe when every org is under its cap", () => {
    const result = previewBillingEnforcement([
      org({ usedCents: 100, capCents: 2500 }),
      org({ orgSlug: "beta", usedCents: 0, capCents: 7500 }),
    ]);
    expect(result.safe).toBe(true);
    expect(result.blocked).toEqual([]);
    expect(result.checked).toBe(2);
  });

  it("treats the cap as inclusive, matching checkUsageAllowed", () => {
    // checkUsageAllowed blocks on `usedCents >= capCents`. If this used `>` the
    // pre-flight would report safe for an org that is about to be blocked —
    // wrong in the reassuring direction, which is the only direction that hurts.
    expect(previewBillingEnforcement([org({ usedCents: 2500, capCents: 2500 })]).safe).toBe(false);
    expect(previewBillingEnforcement([org({ usedCents: 2499, capCents: 2500 })]).safe).toBe(true);
  });

  it("distinguishes a missing plan row from a genuine overage", () => {
    // Different fixes: one needs a plan row, the other needs a bigger plan.
    const result = previewBillingEnforcement([
      org({ orgSlug: "no-row", hasPlanRow: false, usedCents: 5000, capCents: FREE_CAP }),
      org({ orgSlug: "real-overage", hasPlanRow: true, usedCents: 5000, capCents: 2500 }),
    ]);
    expect(result.blocked.map((b) => b.reason)).toEqual(["over_cap_no_plan_row", "over_cap"]);
    expect(result.missingPlanRows).toEqual(["no-row"]);
  });

  it("reports a lapsed trial ahead of the cap, as the gate does", () => {
    const result = previewBillingEnforcement([
      org({ orgSlug: "lapsed", trialReadOnly: true, usedCents: 9999, capCents: 2500 }),
    ]);
    expect(result.blocked[0]?.reason).toBe("trial_expired");
  });

  it("flags a missing plan row even when the org is under cap", () => {
    // Not blocked today, but one busy week away from it. The configuration gap
    // is worth surfacing before it becomes an outage.
    const result = previewBillingEnforcement([
      org({ orgSlug: "quiet", hasPlanRow: false, usedCents: 10, capCents: FREE_CAP }),
    ]);
    expect(result.safe).toBe(true);
    expect(result.missingPlanRows).toEqual(["quiet"]);
  });

  it("is trivially safe with no orgs", () => {
    expect(previewBillingEnforcement([])).toEqual({
      safe: true,
      blocked: [],
      missingPlanRows: [],
      checked: 0,
    });
  });
});

describe("describeRisk", () => {
  it("names the actual cause so the operator knows which fix applies", () => {
    expect(
      describeRisk({ orgSlug: "acme", reason: "over_cap_no_plan_row", usedCents: 255, capCents: 200 }),
    ).toContain("NO org_plans row");
    expect(
      describeRisk({ orgSlug: "acme", reason: "over_cap", usedCents: 5000, capCents: 2500 }),
    ).toContain("over its assigned cap");
    expect(
      describeRisk({ orgSlug: "acme", reason: "trial_expired", usedCents: 0, capCents: 200 }),
    ).toContain("read-only");
  });

  it("formats money in dollars, not raw cents", () => {
    expect(
      describeRisk({ orgSlug: "acme", reason: "over_cap", usedCents: 255, capCents: 200 }),
    ).toContain("$2.55 used of $2.00 cap");
  });
});
