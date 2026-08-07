import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { deskTone, needsOperatorApproval, needsOperatorAttention, type CampaignTone } from "./tone";

const ALL_TONES: CampaignTone[] = ["live", "review", "revise", "approved", "draft", "archived"];

describe("deskTone", () => {
  /**
   * The prod symptom, in one assertion.
   *
   * "Chicago Flood Response" sat under the board's "Needs you" section wearing a
   * green **Approved** pill, above a button reading "Review 6 assets", while its
   * own detail page said "Needs you · 1 of 7 approved". The board filed by the
   * deliverables and printed the campaign status.
   */
  it("says Needs you when the campaign holds undecided deliverables", () => {
    expect(deskTone("approved", 6)).toBe("review");
    expect(deskTone("draft", 3)).toBe("review");
    expect(deskTone("live", 1)).toBe("review");
  });

  it("leaves a campaign alone when nothing is undecided", () => {
    for (const tone of ["live", "approved", "draft"] as CampaignTone[]) {
      expect(deskTone(tone, 0), tone).toBe(tone);
    }
  });

  /** Something put away asks nothing, whatever it still holds. */
  it("never promotes an archived campaign", () => {
    expect(deskTone("archived", 0)).toBe("archived");
    expect(deskTone("archived", 5)).toBe("archived");
  });

  /**
   * "Needs changes" is the more precise of the two desk states — flattening it
   * into "Needs you" would lose which one it is.
   */
  it("does not flatten a state that already says it is on your desk", () => {
    expect(deskTone("revise", 4)).toBe("revise");
    expect(deskTone("review", 4)).toBe("review");
  });

  /**
   * Section grouping reads `needsOperatorAttention`. If promoting a row could
   * change that answer, cards would move between sections as a side effect.
   */
  it("cannot move a row between board sections", () => {
    for (const tone of ALL_TONES) {
      for (const pending of [0, 1, 6]) {
        const before = needsOperatorAttention({ tone, awaitingCount: pending });
        const after = needsOperatorAttention({ tone: deskTone(tone, pending), awaitingCount: pending });
        expect(after, `${tone}/${pending}`).toBe(before);
      }
    }
  });
});

describe("needsOperatorApproval", () => {
  it("counts the campaigns whose STATUS sits on the operator's desk", () => {
    expect(needsOperatorApproval("review")).toBe(true);
    // Blocked / revision-requested is still the operator's move, and it is what
    // the "Needs approval" tab has always included.
    expect(needsOperatorApproval("revise")).toBe(true);
  });

  it("does not count statuses that need nothing from the operator", () => {
    // "approved" is the one that made the old footer absurd: it announced a
    // campaign as "awaiting your approval" after the operator had approved it.
    for (const tone of ["live", "approved", "draft", "archived"] as CampaignTone[]) {
      expect(needsOperatorApproval(tone), tone).toBe(false);
    }
  });

  it("has an answer for every tone", () => {
    for (const tone of ALL_TONES) expect(typeof needsOperatorApproval(tone)).toBe("boolean");
  });
});

describe("needsOperatorAttention", () => {
  /**
   * The bug this predicate exists for, reproduced from the live workspace: every
   * campaign sat at status `draft` while holding assets at `pending_approval`.
   * The rows read "Approve 5 assets" / "Approve 1 asset" / "Approve 1 asset",
   * the campaign detail pages showed a "Needs you" pill — and the "Needs you"
   * tab read 0 and returned an empty list.
   */
  it("counts a draft campaign that is holding undecided assets", () => {
    expect(needsOperatorAttention({ tone: "draft", awaitingCount: 5 })).toBe(true);
  });

  it("still counts a campaign put on the desk by its status alone", () => {
    expect(needsOperatorAttention({ tone: "review", awaitingCount: 0 })).toBe(true);
    expect(needsOperatorAttention({ tone: "revise", awaitingCount: 0 })).toBe(true);
  });

  it("counts an approved campaign that still holds an undecided asset", () => {
    // The case the original design DID anticipate: approved by status, but one
    // deliverable never decided. It asks something of you either way.
    expect(needsOperatorAttention({ tone: "approved", awaitingCount: 1 })).toBe(true);
  });

  it("leaves alone the campaigns that want nothing", () => {
    for (const tone of ["live", "approved", "draft", "archived"] as CampaignTone[]) {
      expect(needsOperatorAttention({ tone, awaitingCount: 0 }), tone).toBe(false);
    }
  });

  it("is never narrower than the status-only predicate", () => {
    // Whatever else changes, the tab may not start hiding a campaign that status
    // alone would have shown.
    for (const tone of ALL_TONES) {
      for (const awaitingCount of [0, 1, 9]) {
        if (needsOperatorApproval(tone)) {
          expect(needsOperatorAttention({ tone, awaitingCount }), `${tone}/${awaitingCount}`).toBe(true);
        }
      }
    }
  });
});

/**
 * One claim gets one derivation.
 *
 * In production a tab reading "Needs approval 4" sat above a footer reading "Arc
 * has 9 packages awaiting your approval", because each counted its own way and
 * the footer's way was a regex over the rendered next-action label.
 *
 * The tab row and the footer are both gone — the board groups into a "Needs you"
 * section and the page states the asset count in its opening sentence — but the
 * failure they enabled is structural, not cosmetic, so the guard follows the
 * structure rather than retiring with it. What it pins is unchanged in spirit:
 * the campaign-level split reads the one predicate, its count comes from the
 * split itself, and nothing counts by matching a rendered string.
 */
describe("one claim, one derivation", () => {
  // Comments are stripped: these files discuss the old bug at length, and prose
  // about a bug must not satisfy an assertion looking for the bug's absence. My
  // first cut of these guards matched its own comment and passed against the
  // reverted code.
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const read = (p: string) => strip(readFileSync(join(__dirname, p), "utf8"));
  const BOARD = read("campaigns-board.tsx");
  const PAGE = read("../page.tsx");

  /**
   * The two outbound sections must be complements of ONE list, computed by the
   * shared predicate — never by a second hand-rolled rule.
   *
   * This used to pin the source list's literal name (`visible`). That made it
   * fail the moment a legitimate pre-filter was introduced, while still not
   * checking the thing that actually matters: that both halves read the *same*
   * list. It now captures the identifier and compares the two, which is both
   * tolerant of renaming and stricter about drift.
   */
  it("the board's sections split on the shared predicate", () => {
    const waiting = BOARD.match(/waitingRows = useMemo\(\(\) => (\w+)\.filter\(needsOperatorAttention\)/);
    const rest = BOARD.match(/restRows = useMemo\(\(\) => (\w+)\.filter\(\(r\) => !needsOperatorAttention\(r\)\)/);
    expect(waiting, "waitingRows must filter on needsOperatorAttention").not.toBeNull();
    expect(rest, "restRows must be its complement").not.toBeNull();
    expect(waiting![1], "both sections must derive from the same list").toBe(rest![1]);
  });

  /**
   * The creative split must not lose rows.
   *
   * "Creative from Studio" is a third heading, and the danger of a third
   * heading is a row that belongs to none of them — a campaign that silently
   * stops rendering. The two halves are complements of `visible` on the same
   * flag, so every row lands in exactly one branch.
   */
  it("the creative split is a complement, so no row can vanish", () => {
    const creative = BOARD.match(/creativeRows = useMemo\(\(\) => (\w+)\.filter\(\(r\) => r\.creativeOnly\)/);
    const campaigns = BOARD.match(/campaignRows = useMemo\(\(\) => (\w+)\.filter\(\(r\) => !r\.creativeOnly\)/);
    expect(creative, "creativeRows must filter on the creativeOnly flag").not.toBeNull();
    expect(campaigns, "campaignRows must be its complement").not.toBeNull();
    expect(creative![1], "both halves must derive from the same list").toBe(campaigns![1]);
    // And the outbound sections must read the campaign half, not the raw list —
    // otherwise the batches reappear in "Needs you", which is the bug.
    expect(BOARD).toMatch(/waitingRows = useMemo\(\(\) => campaignRows\.filter/);
  });

  /**
   * Stronger than "it calls the same function": the heading's number IS the
   * length of the list under it. There is no second expression that could count
   * differently from what the section renders — which is precisely how a tab
   * reading 0 came to sit above three rows asking to be approved.
   */
  it("the section counts are the rendered lists' own lengths", () => {
    expect(BOARD).toMatch(/Needs you <span className="cmp-secn">\{waitingRows\.length\}/);
    expect(BOARD).toMatch(/\{renderCards\(waitingRows\)\}/);
    // Any separately-computed campaign tally is the drift starting over.
    expect(BOARD).not.toMatch(/needs:\s*by\(/);
  });

  /**
   * The page states the ASSET count; the board owns the campaign count. Two
   * facts, two places, neither recomputing the other's. A campaign-level count
   * here would be a second answer to the section heading's question.
   */
  it("the page does not re-derive the campaign-level count", () => {
    expect(PAGE).not.toMatch(/rows\.filter\(needsOperatorAttention\)/);
    expect(PAGE).not.toMatch(/needsOperatorAttention/);
  });

  it("neither counts approvals by matching a rendered label", () => {
    // The original: rows.reduce(... /Approve/.test(r.next) ...). Reword the label
    // "Approve 1 piece" and the count silently becomes 0.
    for (const [name, src] of [["board", BOARD], ["page", PAGE]] as const) {
      expect(/\/Approve\/\.test/.test(src), name).toBe(false);
    }
  });

  it("neither re-derives the tone rule inline", () => {
    // `tone === "review" || tone === "revise"` written out again anywhere is the
    // drift starting over.
    for (const [name, src] of [["board", BOARD], ["page", PAGE]] as const) {
      expect(/=== "review"\s*\|\|\s*\w+ === "revise"/.test(src), name).toBe(false);
    }
  });

  /**
   * The footer carries a SECOND, finer fact: the individual deliverables with no
   * decision recorded, which is what the row-level "Approve N assets" labels add
   * up to. Two facts, said as two things — never one claim with two answers.
   */
  it("counts the operator's queue from data, not from the rendered label", () => {
    expect(PAGE).toMatch(/rows\.reduce\(\(sum, r\) => sum \+ r\.awaitingCount, 0\)/);
  });

  it("sums what is waiting on the operator, not everything unresolved", () => {
    // The sibling test below has always said a revision_requested asset is
    // waiting on Arc, and the page's COPY has always honoured that. Its NUMBER
    // did not: it summed `pendingCount`, the unresolved set, so the header read
    // "Arc wrote 19 assets for you to check" beside a rail badge of 15 — the gap
    // being exactly the four the operator had already sent back.
    expect(PAGE).not.toMatch(/sum \+ r\.pendingCount/);
    expect(PAGE).toMatch(/awaitingCount: item\.awaitingOperatorCount/);
  });

  it("keeps the campaign count and the asset count as separate claims", () => {
    expect(PAGE).not.toMatch(/awaiting your approval/);
    // The footer must not reintroduce a campaign count computed its own way — the
    // "7 assets across 3 campaigns" clause that sat under a tab reading 0.
    expect(PAGE).not.toMatch(/across \$\{countOf/);
  });

  it("does not claim an undecided asset is waiting on the operator", () => {
    // A revision_requested asset has no decision but is waiting on Arc to
    // re-draft. "Undecided" is true of it; "awaiting your decision" is not.
    expect(PAGE).toMatch(/undecided/);
    expect(PAGE).not.toMatch(/assets?[^\n]{0,40}await(s|ing)? your/i);
  });
});
