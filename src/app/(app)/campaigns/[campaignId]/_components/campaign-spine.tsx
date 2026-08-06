import { type CampaignSpineStep, type CampaignSpineStepKey } from "@/domain";

/**
 * Where this campaign is, above everything else on the screen.
 *
 * The page already knew its state and said it in three unrelated fragments — a
 * lifecycle pill, an "N of M approved" line, and a Launch-readiness panel down
 * the right rail. None of them said what the whole journey is, so nothing told
 * an owner what happens after the thing in front of them.
 *
 * This replaces none of those. It is the index above them.
 *
 * Presentational only: every step, its state and its wording come from
 * `deriveCampaignSpine`, which is pure and unit-tested. Nothing here decides
 * anything — a renderer that computed its own step states would be a second
 * answer to "where am I", which is the bug this screen already had.
 *
 * ## You can always go back, never jump ahead
 *
 * A step is a destination once you have reached it — `done` steps and the
 * `current` one. A `todo` step renders as plain text, because there is nothing
 * useful behind "Send" on a campaign that has not launched, and a control that
 * looks pressable and goes nowhere is worse than no control.
 *
 * That rule is also why the Brief earns its place: it was the only step with
 * nowhere to point. Its content — what, why now, who, the offer, the timeframe —
 * has always existed, filed under a tab nobody opens before approving.
 *
 * Rendered as an ordered list because that is what it is: four steps in a fixed
 * sequence. A screen reader announces the position and the count for free, and
 * the current step carries `aria-current="step"`.
 */
export function CampaignSpine({
  steps,
  onSelect,
}: {
  steps: CampaignSpineStep[];
  /** Called for a reachable step. Not called for `todo` — those are not links. */
  onSelect: (key: CampaignSpineStepKey) => void;
}) {
  return (
    <nav className="cspine" aria-label="Campaign progress">
      <ol>
        {steps.map((step) => {
          const reachable = step.state !== "todo";
          return (
            <li
              key={step.key}
              className={`cspine-step is-${step.state}`}
              aria-current={step.state === "current" ? "step" : undefined}
            >
              {reachable ? (
                <button type="button" className="cspine-hit" onClick={() => onSelect(step.key)}>
                  <span className="cspine-label">{step.label}</span>
                  <span className="cspine-detail">{step.detail}</span>
                </button>
              ) : (
                <span className="cspine-hit is-static">
                  <span className="cspine-label">{step.label}</span>
                  <span className="cspine-detail">{step.detail}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
