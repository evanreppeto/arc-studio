/**
 * Where this campaign is, as four steps.
 *
 * The campaign screen already knows its state — it just says it in three
 * unrelated fragments: a lifecycle pill, an "N of M approved" progress line, and
 * a Launch-readiness panel further down the right rail. None of them says what
 * the whole journey IS, so nothing tells an owner what happens after the thing
 * in front of them.
 *
 * This derives the journey once, and the screen renders it above everything
 * else. It replaces nothing: the pill, the counts and the launch panel all stay.
 *
 * ## Exactly one step is ever `current`
 *
 * The first step that is not done. That is the whole point of the component — a
 * spine with two highlighted steps answers "where am I" with "two places", and
 * a spine with none answers it with silence. Enforced here rather than left to
 * the renderer, and asserted in the tests.
 *
 * ## Send is never `done`
 *
 * Launching unlocks approved deliverables for dispatch; the sends themselves are
 * confirmed one at a time in the Outbox, and this screen does not know how many
 * have gone. Marking Send complete from `deployedCount` would claim delivery
 * this data cannot support — the same class of error as a header reading
 * "Sending" above "0 of 4 sent". So Send becomes `current` once Launch is done
 * and stays there; the Outbox owns the rest.
 */

export type CampaignSpineStepKey = "brief" | "review" | "launch" | "send";
export type CampaignSpineStepState = "done" | "current" | "todo";

export type CampaignSpineStep = {
  key: CampaignSpineStepKey;
  label: string;
  state: CampaignSpineStepState;
  /** The line under the label. Carries a count wherever there is a real one. */
  detail: string;
};

export type CampaignSpineInput = {
  /** The campaign says what it is for — an objective, theme or audience. */
  hasBrief: boolean;
  /**
   * There is SOMETHING, but only the theme — no objective and no audience.
   *
   * Reported rather than treated as missing. Marking the step not-done would
   * make Brief the current step on most campaigns and push Review out of focus,
   * which is worse than a thin brief. But "Set" on a campaign carrying one line
   * is the claim that hid this: every campaign Arc created from a chat had a
   * theme and nothing else, because the route read an objective off the request
   * and dropped it.
   */
  briefIsThin?: boolean;
  /** Non-archived deliverables. */
  requiredCount: number;
  approvedCount: number;
  /** Deliverables with no decision recorded. */
  pendingCount: number;
  /** Approved deliverables released for dispatch. */
  deployedCount: number;
  /** The campaign has been launched (outbound unlocked). */
  live: boolean;
  /** Everything is decided, something is approved, and it has not launched yet. */
  ready: boolean;
};

export function deriveCampaignSpine(input: CampaignSpineInput): CampaignSpineStep[] {
  const { hasBrief, requiredCount, pendingCount, deployedCount, live, ready } = input;
  const decidedCount = Math.max(0, requiredCount - pendingCount);

  // A campaign with no deliverables yet has nothing to review — Arc is still
  // building it. Calling that "0 of 0 decided" would read as finished work.
  const reviewDone = requiredCount > 0 && pendingCount === 0;

  const steps: Array<Omit<CampaignSpineStep, "state"> & { done: boolean }> = [
    {
      key: "brief",
      label: "Brief",
      done: hasBrief,
      detail: !hasBrief ? "Not set yet" : input.briefIsThin ? "Theme only" : "Set",
    },
    {
      key: "review",
      label: "Review",
      done: reviewDone,
      detail: requiredCount === 0 ? "Arc is still building it" : `${decidedCount} of ${requiredCount} decided`,
    },
    {
      key: "launch",
      label: "Launch",
      done: live,
      detail: live ? "Launched" : ready ? "Ready to launch" : "Waiting on review",
    },
    {
      key: "send",
      // Never done — the Outbox confirms each send and owns that count.
      label: "Send",
      done: false,
      detail: live
        ? `${deployedCount} ${deployedCount === 1 ? "piece" : "pieces"} unlocked`
        : "Not unlocked",
    },
  ];

  const currentIndex = steps.findIndex((step) => !step.done);
  return steps.map((step, index) => ({
    key: step.key,
    label: step.label,
    detail: step.detail,
    state: step.done ? "done" : index === currentIndex ? "current" : "todo",
  }));
}
