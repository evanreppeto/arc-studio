import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A decision that was not saved has to say so.
 *
 * `decideCampaignAsset` returns `{ ok: true, persisted: false }` when the
 * workspace has no database, and its own comment calls that "the honest
 * offline/demo signal so the UI can reflect the decision without saving". The
 * decide path was the one caller that ignored it — `applyFix` in the same file
 * already surfaces it, and Settings reads `persisted` in a dozen places.
 *
 * What that produced on screen was a page arguing with itself: the card flipped
 * to Approved while the header held at "0 of 3 approved" and the readiness panel
 * still said three assets needed approving. Both halves were correct — the spine
 * deliberately reads server state, because deriving it from optimistic state
 * would let a failed approve unlock a real outbound control — but nothing
 * reconciled them, so the app simply looked broken.
 *
 * Source assertions; the repo has no jsdom. They check the shape, and the shape
 * is what regressed.
 */

const DIR = new URL(".", import.meta.url).pathname;
const view = readFileSync(join(DIR, "campaign-detail-view.tsx"), "utf8");
const css = readFileSync(join(DIR, "..", "..", "campaign.css"), "utf8");

describe("an unsaved decision says so", () => {
  it("checks persisted on the single decision", () => {
    // Anchored on the signature, not on `function decide(`: this file holds two
    // of those — the deliverable decision and the media lightbox's — and the
    // loose form matched the wrong one and passed while the real path was
    // unguarded.
    const decide = view.match(/function decide\(\s*\n\s*asset: CampaignWorkspaceAsset[\s\S]*?\n  \}/)?.[0] ?? "";
    expect(decide, "the deliverable decide function").not.toBe("");
    // The exact guard, not just the substring. `/!res\.persisted/` alone passes
    // on `if (false && !res.persisted)` — checked by writing exactly that and
    // watching this test stay green, which is how a guard ends up guarding
    // nothing.
    expect(decide).toMatch(/if \(!res\.persisted\) \{/);
    expect(decide).toMatch(/setNotice\(/);
  });

  /** A bulk approve that saved nothing must not read like one that did. */
  it("checks persisted on the bulk approve too", () => {
    const bulk = view.match(/function approveAllClean\(\)[\s\S]*?\n  \}/)?.[0] ?? "";
    expect(bulk, "approveAllClean").not.toBe("");
    expect(bulk).toMatch(/r\.ok && !r\.persisted/);
    expect(bulk).toMatch(/setNotice\(/);
  });

  it("explains why the counts beside it did not move", () => {
    // Without the second clause this reads as a bug report rather than an
    // explanation — the header disagreeing with the card is the visible thing.
    expect(view).toMatch(/counts and the launch step stay where they are/);
  });

  it("announces it, so the fact is not sight-only", () => {
    expect(view).toMatch(/Not saved — no workspace connected/);
  });

  /**
   * Not an error. `decideCampaignAsset` returning `persisted: false` is the
   * preview working as designed, and DESIGN.md reserves red for destructive and
   * priority — dressing this as a failure would be wrong twice over.
   */
  it("is styled as a notice, not as an error", () => {
    expect(view).toMatch(/className="cnotice" role="status"/);
    expect(css).toMatch(/\.arc-campaign \.cnotice \{/);
    const rule = css.match(/^\.arc-campaign \.cnotice \{[^}]*\}/m)?.[0] ?? "";
    expect(rule).not.toMatch(/--red-/);
  });

  /**
   * Fourteen places begin an action. Each would have to remember to clear the
   * notice as well as the error, and a missed one leaves "approved, but not
   * saved" sitting above the result of whatever was done next — stale
   * reassurance about a different deliverable.
   */
  it("clears both channels through one call, so no site can forget one", () => {
    expect(view).toMatch(/const resetFeedback = useCallback\(/);
    // No bare setErr(null) left to drift from the pair.
    const stray = [...view.matchAll(/setErr\(null\)/g)].length;
    expect(stray, "bare setErr(null) calls outside resetFeedback").toBe(1);
  });
});
