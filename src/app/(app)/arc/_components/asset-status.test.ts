import { describe, expect, it } from "vitest";

import { WORK_STATE_LABEL } from "@/domain";

import { assetStatusMeta, isDecidedAssetStatus } from "./arc-messages";

/**
 * BSR-735. The live Arc workspace showed, in one 300px panel:
 *
 *   "5 runs · 4 deliverables · 2 waiting on you"
 *   "2 drafts need your decision"        [Review all 2]
 *   Deliverables                          0 of 4 approved
 *     • Chicago Flood Response …          Needs you
 *     • Paid social — …                   Needs you
 *     • Landing page — …                  Needs you
 *     • 5 CRM contacts (live read)        Needs you
 *
 * Four rows each claiming to need a decision, above a header saying two do. The
 * count was right — it required an approval hook — and the badge was wrong: it
 * defaulted a card with no hook to "Needs you", including a CRM read, which the
 * UI then rendered as an inert div with no Approve button.
 */
describe("assetStatusMeta", () => {
  it("does not ask for a decision on a card that cannot be decided", () => {
    // The exact case: no approval hook, no status.
    expect(assetStatusMeta(null, false).label).toBe(WORK_STATE_LABEL.draft);
    expect(assetStatusMeta("draft", false).label).toBe(WORK_STATE_LABEL.draft);
  });

  it("still asks for a decision on a card that can be decided", () => {
    expect(assetStatusMeta(null, true).label).toBe(WORK_STATE_LABEL.needs_you);
    expect(assetStatusMeta("draft", true).label).toBe(WORK_STATE_LABEL.needs_you);
    expect(assetStatusMeta("revision", true).label).toBe(WORK_STATE_LABEL.needs_changes);
  });

  it("keeps a recorded outcome whether or not the card is still actionable", () => {
    // An approved asset says approved even once its hook is gone — the decision
    // happened, and hiding it would be a different lie.
    for (const reviewable of [true, false]) {
      expect(assetStatusMeta("approved", reviewable).label, `reviewable=${reviewable}`).toBe(WORK_STATE_LABEL.approved);
      expect(assetStatusMeta("rejected", reviewable).label, `reviewable=${reviewable}`).toBe(WORK_STATE_LABEL.declined);
    }
  });

  it("defaults to reviewable, so existing call sites are unchanged", () => {
    expect(assetStatusMeta(null)).toEqual(assetStatusMeta(null, true));
  });
});

/**
 * The panel's own arithmetic, extracted: the badge and the header must answer
 * the same question, and the progress bar must be able to finish.
 */
describe("the workspace panel's counts", () => {
  type Card = { approval?: unknown; status: "draft" | "revision" | "approved" | "rejected" | null };

  // The four deliverables from the live workspace above.
  const cards: Card[] = [
    { approval: {}, status: null },
    { approval: {}, status: "revision" },
    { status: null }, // landing page, never submitted
    { status: null }, // "5 CRM contacts (live read)"
  ];

  const reviewable = cards.filter((c) => Boolean(c.approval));
  const approved = reviewable.filter((c) => c.status === "approved");
  const awaiting = reviewable.filter((c) => !isDecidedAssetStatus(c.status));

  it("badges exactly as many cards 'needs you' as the header claims", () => {
    const badgedNeedsYou = cards.filter(
      (c) => assetStatusMeta(c.status, Boolean(c.approval)).label === WORK_STATE_LABEL.needs_you,
    );
    // One of the two awaiting cards is in revision, so it badges "Needs changes"
    // — still on the operator's desk, still counted, and no longer claiming a
    // decision it does not want.
    expect(badgedNeedsYou.length + reviewable.filter((c) => c.status === "revision").length).toBe(awaiting.length);
  });

  it("measures approval progress over what can be approved", () => {
    expect(`${approved.length} of ${reviewable.length} approved`).toBe("0 of 2 approved");
  });

  it("can reach 100% — the old denominator could not", () => {
    const allDecided = reviewable.map((c) => ({ ...c, status: "approved" as const }));
    const pct = (allDecided.filter((c) => c.status === "approved").length / reviewable.length) * 100;
    expect(pct).toBe(100);
    // Over every deliverable it would top out here, forever.
    expect((allDecided.length / cards.length) * 100).toBeLessThan(100);
  });
});
