import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Things that happen without a page change have to be said out loud.
 *
 * The app renders plenty of `role="status"` text and most of it is fine. What it
 * lacked was a region that is ALREADY IN THE DOM when a message arrives. A live
 * region that mounts and fills in the same commit is unreliable — several screen
 * readers only announce changes to a region they were already observing, so
 * `{status ? <div role="status">…</div> : null}` announces on some setups and
 * silently does nothing on others.
 *
 * That is exactly how Settings wrote its save confirmations, in 19 places
 * through one `<Status>` component: every "Saved" and every "Couldn't save",
 * across Team, Connections, Records and the rest, hung on that timing.
 *
 * Worse, the app's central action said nothing at all. Approving a deliverable
 * — the gate the entire outbound model turns on — folded the card away and
 * ticked a count over. Both are invisible without sight. There was no live
 * region on that path in any form.
 *
 * `announcer.tsx` is the fix: two regions mounted once for the life of the
 * shell, whose text changes. Callers keep rendering what they rendered before,
 * so nothing about the layout moves.
 *
 * ## What this file can and cannot prove
 *
 * It proves the DOM contract — the regions exist, are mounted unconditionally,
 * and the code paths post to them. It cannot prove a screen reader SPEAKS them.
 * That needs a real assistive technology driven by a person, and nothing in this
 * repo can stand in for it. Verified by hand in a browser as far as the DOM
 * goes: approving two deliverables in a row produced two distinct region states,
 * and a Settings save posted "Saved…" to the polite region.
 */

const APP_DIR = new URL(".", import.meta.url).pathname;
const read = (...parts: string[]) => readFileSync(join(APP_DIR, ...parts), "utf8");

describe("the announcer", () => {
  const src = read("_components", "announcer.tsx");

  it("mounts both regions unconditionally, with no early return", () => {
    // The whole point is that the region is observed BEFORE it has anything to
    // say. A conditional render here would reintroduce the bug it exists to fix.
    expect(src).not.toMatch(/if \(!\w+\) return null/);
    expect(src).toMatch(/role="status"[\s\S]{0,80}aria-live="polite"/);
    expect(src).toMatch(/role="alert"[\s\S]{0,80}aria-live="assertive"/);
  });

  it("keeps polite and assertive as separate regions", () => {
    // Sharing one node lets a routine "Saved" cancel an error mid-sentence.
    expect((src.match(/aria-live=/g) ?? []).length).toBe(2);
  });

  /**
   * A screen reader announces a CHANGE. Posting the same string twice leaves the
   * DOM identical, so the second is silent — "Couldn't save" twice in a row
   * would be read once, and the operator would think the second attempt worked.
   */
  it("forces a DOM change when the same message repeats", () => {
    expect(src).toMatch(/endsWith\("​"\)/);
  });

  it("is mounted in the shell, once", () => {
    const shell = read("_components", "app-shell.tsx");
    expect(shell).toMatch(/import \{ Announcer \}/);
    expect((shell.match(/<Announcer \/>/g) ?? []).length).toBe(1);
  });
});

describe("outcomes that are otherwise invisible get announced", () => {
  it("announces a settings save and its failure, for all 19 call sites at once", () => {
    const src = read("settings", "_components", "settings-view.tsx");
    const status = src.match(/function Status\(\{ status \}[\s\S]*?\n\}/)?.[0] ?? "";
    expect(status, "the Status component").not.toBe("");
    expect(status).toMatch(/announce\(/);
    // A failure means the thing just asked for did not happen. Finding that out
    // at the next natural pause is too late to be useful.
    expect(status).toMatch(/"polite"\s*:\s*"assertive"|tone === "ok" \? "polite" : "assertive"/);
  });

  it("announces a deliverable decision — the action the outbound gate turns on", () => {
    const src = read("campaigns", "[campaignId]", "_components", "campaign-detail-view.tsx");
    expect(src).toMatch(/announce\(`\$\{decision === "approved" \? "Approved" : "Declined"\}/);
    // Outcome first: titles here are whole sentences, so appending the verb
    // produced "…60 minutes. approved." and made the listener wait through the
    // title to learn what happened.
    expect(src).not.toMatch(/announce\(`\$\{asset\.title\} \$\{decision/);
  });

  it("says how a bulk approve actually went, including a partial failure", () => {
    const src = read("campaigns", "[campaignId]", "_components", "campaign-detail-view.tsx");
    const bulk = src.match(/function approveAllClean\(\)[\s\S]*?\n  \}/)?.[0] ?? "";
    expect(bulk).not.toBe("");
    // Intent, not the exact interpolation: the count must come from `targets`,
    // however it is worded. Pinning the literal `${targets.length}` made this
    // fail when the string moved to `countOf(..., ASSET_NOUN)` — the shared
    // vocabulary helper the noun rule requires — which is the same claim said
    // properly, not a regression.
    expect(bulk, "the all-succeeded case").toMatch(/announce\(`[^`]*targets\.length/);
    // A partial success looks identical to a full one until you count the cards.
    expect(bulk, "the partial-failure case").toMatch(/announce\(message, "assertive"\)/);
  });
});
