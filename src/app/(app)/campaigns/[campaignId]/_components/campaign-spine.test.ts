import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { deriveCampaignSpine } from "@/domain";

/**
 * The spine renders what the derivation says, and nothing else.
 *
 * Source-scanned rather than rendered, matching `tone.test.ts` next door: the
 * claim is about where the values come from, and a render test would pass just
 * as happily against a component that recomputed them.
 */
describe("the spine does not decide anything", () => {
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const SPINE = strip(readFileSync(join(__dirname, "campaign-spine.tsx"), "utf8"));

  /**
   * A second answer to "where am I" is the bug this screen already had, when
   * the board's pill disagreed with the campaign's own header. The component
   * must read `step.state`, never derive one.
   */
  it("reads the step's state rather than computing one", () => {
    expect(SPINE).toMatch(/is-\$\{step\.state\}/);
    // No status arithmetic in the renderer.
    expect(SPINE).not.toMatch(/pendingCount|approvedCount|requiredCount|deployedCount/);
  });

  /**
   * A control that looks pressable and goes nowhere is worse than no control.
   * There is nothing behind "Send" on a campaign that has not launched, so a
   * `todo` step is text.
   */
  it("only makes a reached step pressable", () => {
    expect(SPINE).toMatch(/const reachable = step\.state !== "todo"/);
    expect(SPINE).toMatch(/reachable \?/);
  });

  it("marks the current step for assistive tech", () => {
    expect(SPINE).toMatch(/aria-current=\{step\.state === "current" \? "step" : undefined\}/);
  });
});

/**
 * The reachability rule, stated against the derivation the component consumes:
 * you can always go back, and never jump ahead.
 */
describe("you can go back, never ahead", () => {
  const reachable = (steps: ReturnType<typeof deriveCampaignSpine>) =>
    steps.filter((s) => s.state !== "todo").map((s) => s.key);

  it("offers the steps already reached, and no more", () => {
    const early = deriveCampaignSpine({
      hasBrief: true,
      requiredCount: 3,
      approvedCount: 0,
      pendingCount: 3,
      deployedCount: 0,
      live: false,
      ready: false,
    });
    expect(reachable(early)).toEqual(["brief", "review"]);

    const launched = deriveCampaignSpine({
      hasBrief: true,
      requiredCount: 3,
      approvedCount: 3,
      pendingCount: 0,
      deployedCount: 3,
      live: true,
      ready: false,
    });
    expect(reachable(launched)).toEqual(["brief", "review", "launch", "send"]);
  });

  /** Reachability only ever grows as a campaign advances — it never retracts. */
  it("never takes a step away as the campaign progresses", () => {
    const stages = [
      { hasBrief: true, requiredCount: 3, approvedCount: 0, pendingCount: 3, deployedCount: 0, live: false, ready: false },
      { hasBrief: true, requiredCount: 3, approvedCount: 2, pendingCount: 0, deployedCount: 0, live: false, ready: true },
      { hasBrief: true, requiredCount: 3, approvedCount: 2, pendingCount: 0, deployedCount: 2, live: true, ready: false },
    ];
    let previous: string[] = [];
    for (const stage of stages) {
      const now = reachable(deriveCampaignSpine(stage));
      expect(now.slice(0, previous.length)).toEqual(previous);
      previous = now;
    }
  });
});
