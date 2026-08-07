import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MIN_ACKNOWLEDGEMENT_CHARS } from "@/domain";

/**
 * The review queue's half of the blocking-findings gate.
 *
 * The gate itself lives in `decisions.ts` and is tested there against the
 * database — that is the one that actually decides. This file covers the two
 * ways the FORM could undermine it, both of which are easy to reintroduce:
 *
 * 1. Enabling Approve on a shorter acknowledgement than the server accepts, so
 *    the refusal arrives after the click instead of the button being unavailable.
 * 2. Letting the acknowledgement written about one deliverable satisfy the next
 *    one. Approving takes the piece out of the queue, so the next arrives at the
 *    same index without `move` running — clearing on navigation alone misses it,
 *    and since the button enables on that text the second approval would go
 *    through with nobody reading its blockers.
 *
 * Source assertions, because the repo has no jsdom. They check the shape that
 * makes the hole impossible rather than simulating the clicks.
 */

const DIR = new URL(".", import.meta.url).pathname;
const queue = readFileSync(join(DIR, "review-queue.tsx"), "utf8");

describe("the acknowledgement form cannot undercut the server gate", () => {
  it("disables Approve on the same minimum the server refuses on", () => {
    expect(queue).toMatch(/MIN_ACKNOWLEDGEMENT_CHARS/);
    // Imported, not re-typed: a local `3` here drifts the moment the domain
    // changes its mind, and the drift is silent in both directions.
    expect(queue).toMatch(/from "@\/domain"/);
    expect(queue).not.toMatch(/ack\.trim\(\)\.length < \d/);
  });

  it("shows the field only when the draft actually has blockers", () => {
    expect(queue).toMatch(/summary\.blockers > 0 && \(/);
  });

  /** The keyboard path is a second door to the same action. */
  it("makes the approve shortcut obey the gate too", () => {
    const handler = queue.match(/if \(action === "approve"\) \{[\s\S]*?\n      \}/)?.[0] ?? "";
    expect(handler, "the approve shortcut branch").not.toBe("");
    expect(handler).toMatch(/blockers > 0 && ack\.trim\(\)\.length < MIN_ACKNOWLEDGEMENT_CHARS/);
    // Leads somewhere rather than doing nothing.
    expect(handler).toMatch(/ackRef\.current\?\.focus\(\)/);
  });

  /**
   * Scoped by construction. The acknowledgement is stored WITH the asset id it
   * was written under and read back only for that asset, so there is no "clear
   * it on the way out" step for a later edit to forget.
   */
  it("stores the acknowledgement against the deliverable it belongs to", () => {
    // `[\s\S]` rather than the `s` flag: tsc's target rejects dotAll here, and
    // vitest transpiles it happily — so this passed the tests and failed the
    // typecheck, which is the wrong way round to find out.
    expect(queue).toMatch(/ackEntry[\s\S]*assetId/);
    expect(queue).toMatch(/ackEntry\.assetId === \(asset\?\.id \?\? null\) \? ackEntry\.text : ""/);
  });

  it("passes the acknowledgement to the decision, not just to the screen", () => {
    expect(queue).toMatch(/onDecide\(asset, "approved", ack\)/);
  });
});

describe("the shared minimum", () => {
  it("is long enough that a single keystroke is not an acknowledgement", () => {
    expect(MIN_ACKNOWLEDGEMENT_CHARS).toBeGreaterThan(1);
  });
});
