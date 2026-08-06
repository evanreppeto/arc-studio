import { describe, expect, it } from "vitest";

import { deriveCampaignSpine, type CampaignSpineInput } from "../campaign-spine";

function input(over: Partial<CampaignSpineInput> = {}): CampaignSpineInput {
  return {
    hasBrief: true,
    requiredCount: 7,
    approvedCount: 1,
    pendingCount: 6,
    deployedCount: 0,
    live: false,
    ready: false,
    ...over,
  };
}

const stateOf = (steps: ReturnType<typeof deriveCampaignSpine>, key: string) =>
  steps.find((s) => s.key === key)!.state;
const detailOf = (steps: ReturnType<typeof deriveCampaignSpine>, key: string) =>
  steps.find((s) => s.key === key)!.detail;

describe("deriveCampaignSpine", () => {
  it("always returns the four steps in order", () => {
    expect(deriveCampaignSpine(input()).map((s) => s.key)).toEqual(["brief", "review", "launch", "send"]);
  });

  /**
   * The component's entire job is answering "where am I". Two highlighted steps
   * answer it with "two places"; none answers it with silence.
   */
  it("marks exactly one step current, in every reachable state", () => {
    const cases: Partial<CampaignSpineInput>[] = [
      {},
      { hasBrief: false },
      { requiredCount: 0, pendingCount: 0 },
      { pendingCount: 0, approvedCount: 7, ready: true },
      { pendingCount: 0, approvedCount: 7, live: true, deployedCount: 7 },
      { pendingCount: 0, approvedCount: 0, requiredCount: 3 },
      { hasBrief: false, requiredCount: 0, pendingCount: 0 },
    ];
    for (const over of cases) {
      const steps = deriveCampaignSpine(input(over));
      const current = steps.filter((s) => s.state === "current");
      expect(current.length, JSON.stringify(over)).toBe(1);
    }
  });

  it("puts you on Review while deliverables are undecided", () => {
    const steps = deriveCampaignSpine(input());
    expect(stateOf(steps, "brief")).toBe("done");
    expect(stateOf(steps, "review")).toBe("current");
    expect(detailOf(steps, "review")).toBe("1 of 7 decided");
    expect(stateOf(steps, "launch")).toBe("todo");
    expect(detailOf(steps, "launch")).toBe("Waiting on review");
    expect(stateOf(steps, "send")).toBe("todo");
  });

  it("moves you to Launch once everything is decided", () => {
    const steps = deriveCampaignSpine(input({ pendingCount: 0, approvedCount: 6, ready: true }));
    expect(stateOf(steps, "review")).toBe("done");
    expect(detailOf(steps, "review")).toBe("7 of 7 decided");
    expect(stateOf(steps, "launch")).toBe("current");
    expect(detailOf(steps, "launch")).toBe("Ready to launch");
  });

  it("moves you to Send once launched", () => {
    const steps = deriveCampaignSpine(input({ pendingCount: 0, approvedCount: 6, live: true, deployedCount: 6 }));
    expect(stateOf(steps, "launch")).toBe("done");
    expect(detailOf(steps, "launch")).toBe("Launched");
    expect(stateOf(steps, "send")).toBe("current");
    expect(detailOf(steps, "send")).toBe("6 pieces unlocked");
  });

  it("singularizes a lone unlocked piece", () => {
    const steps = deriveCampaignSpine(input({ pendingCount: 0, live: true, deployedCount: 1 }));
    expect(detailOf(steps, "send")).toBe("1 piece unlocked");
  });

  /**
   * Launching unlocks dispatch; the Outbox confirms each send and owns that
   * count. Completing Send from `deployedCount` would claim delivery this
   * screen cannot know about — the same error as a header reading "Sending"
   * above "0 of 4 sent".
   */
  it("never marks Send done, however much is unlocked", () => {
    for (const deployedCount of [0, 1, 99]) {
      const steps = deriveCampaignSpine(input({ pendingCount: 0, live: true, deployedCount }));
      expect(stateOf(steps, "send")).not.toBe("done");
    }
  });

  /**
   * A campaign Arc has not finished building has nothing to decide. "0 of 0
   * decided" reads as completed work, which is why review is not done here.
   */
  it("does not call an empty campaign reviewed", () => {
    const steps = deriveCampaignSpine(input({ requiredCount: 0, pendingCount: 0 }));
    expect(stateOf(steps, "review")).toBe("current");
    expect(detailOf(steps, "review")).toBe("Arc is still building it");
    expect(stateOf(steps, "launch")).toBe("todo");
  });

  it("starts you on the Brief when there isn't one", () => {
    const steps = deriveCampaignSpine(input({ hasBrief: false }));
    expect(stateOf(steps, "brief")).toBe("current");
    expect(detailOf(steps, "brief")).toBe("Not set yet");
    expect(stateOf(steps, "review")).toBe("todo");
  });

  /** Declining or asking for changes still counts as decided — see BSR-773. */
  it("counts a decision, not an approval", () => {
    const steps = deriveCampaignSpine(input({ requiredCount: 6, pendingCount: 0, approvedCount: 4, ready: true }));
    expect(detailOf(steps, "review")).toBe("6 of 6 decided");
    expect(stateOf(steps, "launch")).toBe("current");
  });

  it("never renders a negative count", () => {
    const steps = deriveCampaignSpine(input({ requiredCount: 2, pendingCount: 5 }));
    expect(detailOf(steps, "review")).toBe("0 of 2 decided");
  });
});
