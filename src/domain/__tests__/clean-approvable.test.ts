import { describe, expect, it } from "vitest";

import { cleanApprovableDrafts, type ArcActionCard, type ArcDraftFinding } from "@/domain";

const draft = (over: Partial<ArcActionCard> = {}): ArcActionCard => ({
  kind: "draft",
  title: "Email",
  rows: [],
  flags: [],
  approval: { kind: "campaign", campaignId: "c1", assetId: "a1" },
  ...over,
});

const finding = (over: Partial<ArcDraftFinding> = {}): ArcDraftFinding => ({
  id: "f1",
  severity: "warning",
  message: "Could not ground this claim",
  open: true,
  ...over,
});

/**
 * A draft that is genuinely clean needs BOTH halves: findings loaded with
 * nothing open, AND positive evidence a check ran at all.
 *
 * An empty findings array on its own is not enough, and that is the subtle
 * point — `guardrail_findings` records findings, never passes, so "no rows"
 * cannot distinguish "checked, nothing found" from "never checked". The card's
 * own `ok` flag is the only positive pass record available, which is why it is
 * part of the fixture rather than decoration.
 */
const checkedClean = { a1: [] as ArcDraftFinding[] };
const passFlag = [{ tone: "ok" as const, label: "No banned phrase detected" }];

describe("cleanApprovableDrafts", () => {
  it("returns a draft with a recorded pass and nothing unresolved", () => {
    expect(cleanApprovableDrafts([draft({ flags: passFlag })], { checks: checkedClean })).toEqual([
      { campaignId: "c1", assetId: "a1" },
    ]);
  });

  /**
   * An absent finding row is NOT a pass. `guardrail_findings` records findings,
   * so "no rows" means either "checked and clean" or "never checked" and the
   * schema cannot tell them apart. Approving on that basis is exactly the
   * failure mode the gate exists to stop.
   *
   * This is also why bulk approve is not shipped: measured against prod, zero
   * of 14 Arc-referenced assets satisfy undecided + pass recorded + no open
   * finding. A correct implementation would have nothing to approve.
   */
  it("refuses an empty findings array with no positive pass record", () => {
    expect(cleanApprovableDrafts([draft()], { checks: checkedClean })).toEqual([]);
  });

  /**
   * THE regression this signature change exists for.
   *
   * On prod, 13 of 16 approval-bearing cards carry no flags — flags are frozen
   * at draft time while the real results live in `guardrail_findings`. The old
   * signature took only the cards and read "no warn/risk flag" as clean, so it
   * would have bulk-approved all 13, two of them carrying unresolved BLOCKERS.
   */
  it("refuses a draft whose findings have not been loaded", () => {
    // No `checks` entry for a1 => findings undefined => `unknown` => never clean.
    expect(cleanApprovableDrafts([draft()], {})).toEqual([]);
    expect(cleanApprovableDrafts([draft()], { checks: {} })).toEqual([]);
  });

  it("refuses a draft with an unresolved finding, however reassuring the card looks", () => {
    expect(cleanApprovableDrafts([draft()], { checks: { a1: [finding()] } })).toEqual([]);
    expect(cleanApprovableDrafts([draft()], { checks: { a1: [finding({ severity: "blocker" })] } })).toEqual([]);
    expect(
      cleanApprovableDrafts([draft({ flags: [{ tone: "ok", label: "Brand voice" }] })], { checks: { a1: [finding()] } }),
    ).toEqual([]);
  });

  it("allows a draft whose findings are all resolved", () => {
    // A resolved finding IS positive evidence a check ran, so no flag needed.
    expect(cleanApprovableDrafts([draft()], { checks: { a1: [finding({ open: false })] } })).toHaveLength(1);
  });

  it("excludes drafts with a warn or risk flag", () => {
    expect(cleanApprovableDrafts([draft({ flags: [{ tone: "risk", label: "claim risk" }] })], { checks: checkedClean })).toEqual([]);
    expect(cleanApprovableDrafts([draft({ flags: [{ tone: "warn", label: "check" }] })], { checks: checkedClean })).toEqual([]);
  });

  it("excludes already-decided drafts, by card snapshot or live status", () => {
    expect(cleanApprovableDrafts([draft({ status: "approved", flags: passFlag })], { checks: checkedClean })).toEqual([]);
    expect(cleanApprovableDrafts([draft({ status: "revision", flags: passFlag })], { checks: checkedClean })).toEqual([]);
    expect(cleanApprovableDrafts([draft({ status: "rejected", flags: passFlag })], { checks: checkedClean })).toEqual([]);
    // Live status beats the card: decided elsewhere must not be re-approved here.
    expect(cleanApprovableDrafts([draft({ flags: passFlag })], { checks: checkedClean, statuses: { a1: "approved" } })).toEqual([]);
  });

  it("excludes cards without an approval block or that aren't drafts", () => {
    expect(cleanApprovableDrafts([draft({ approval: undefined, flags: passFlag })], { checks: checkedClean })).toEqual([]);
    expect(cleanApprovableDrafts([draft({ kind: "result", flags: passFlag })], { checks: checkedClean })).toEqual([]);
  });
});
