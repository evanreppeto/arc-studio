import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { needsOperatorApproval, needsOperatorAttention, type CampaignTone } from "./tone";

const ALL_TONES: CampaignTone[] = ["live", "review", "revise", "approved", "draft", "archived"];

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
    expect(needsOperatorAttention({ tone: "draft", pendingCount: 5 })).toBe(true);
  });

  it("still counts a campaign put on the desk by its status alone", () => {
    expect(needsOperatorAttention({ tone: "review", pendingCount: 0 })).toBe(true);
    expect(needsOperatorAttention({ tone: "revise", pendingCount: 0 })).toBe(true);
  });

  it("counts an approved campaign that still holds an undecided asset", () => {
    // The case the original design DID anticipate: approved by status, but one
    // deliverable never decided. It asks something of you either way.
    expect(needsOperatorAttention({ tone: "approved", pendingCount: 1 })).toBe(true);
  });

  it("leaves alone the campaigns that want nothing", () => {
    for (const tone of ["live", "approved", "draft", "archived"] as CampaignTone[]) {
      expect(needsOperatorAttention({ tone, pendingCount: 0 }), tone).toBe(false);
    }
  });

  it("is never narrower than the status-only predicate", () => {
    // Whatever else changes, the tab may not start hiding a campaign that status
    // alone would have shown.
    for (const tone of ALL_TONES) {
      for (const pendingCount of [0, 1, 9]) {
        if (needsOperatorApproval(tone)) {
          expect(needsOperatorAttention({ tone, pendingCount }), `${tone}/${pendingCount}`).toBe(true);
        }
      }
    }
  });
});

/**
 * The footer is a summary of the tab it sits under. They disagreed in production —
 * tab "Needs approval 4" above "Arc has 9 packages awaiting your approval" — because
 * each derived the count its own way, and the footer's way was a regex over the
 * rendered next-action label.
 *
 * A behavioural test can't easily assert "these two numbers match" across a server
 * page and a client board, so this pins the structural fix instead: both read the
 * one predicate, and neither reconstructs the rule itself.
 */
describe("the tab and its footer count the same thing", () => {
  // Comments are stripped: these files discuss the old bug at length, and prose
  // about a bug must not satisfy an assertion looking for the bug's absence. My
  // first cut of these guards matched its own comment and passed against the
  // reverted code.
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const read = (p: string) => strip(readFileSync(join(__dirname, p), "utf8"));
  const BOARD = read("campaigns-board.tsx");
  const PAGE = read("../page.tsx");

  it("the board's tab filter uses the shared predicate", () => {
    expect(BOARD).toMatch(/tab === "needs"\) return needsOperatorAttention\(row\)/);
  });

  /**
   * Stronger than "both call the same function": every tab badge is counted by
   * running `inTab` — the filter itself — over the rows. There is no separate
   * counting expression that could disagree with what the table shows, for the
   * "Needs you" tab or any other.
   */
  it("the board's tab counts are derived from the filter, not re-implemented", () => {
    expect(BOARD).toMatch(/TABS\.map\(\(t\) => \[t\.key, allRows\.filter\(\(r\) => inTab\(r, t\.key\)\)\.length\]\)/);
    // The old shape: a `by(...)` helper per tab, each free to drift from inTab.
    expect(BOARD).not.toMatch(/needs:\s*by\(/);
  });

  it("the page's footer uses the shared predicate", () => {
    expect(PAGE).toMatch(/rows\.filter\(needsOperatorAttention\)/);
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
  it("counts undecided assets from data, not from the rendered label", () => {
    expect(PAGE).toMatch(/rows\.reduce\(\(sum, r\) => sum \+ r\.pendingCount, 0\)/);
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
