import { type CampaignSpineStep } from "@/domain";

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
 * Rendered as an ordered list because that is what it is: four steps in a fixed
 * sequence. A screen reader announces the position and the count for free, and
 * the current step carries `aria-current="step"`.
 */
export function CampaignSpine({ steps }: { steps: CampaignSpineStep[] }) {
  return (
    <nav className="cspine" aria-label="Campaign progress">
      <ol>
        {steps.map((step) => (
          <li
            key={step.key}
            className={`cspine-step is-${step.state}`}
            aria-current={step.state === "current" ? "step" : undefined}
          >
            <span className="cspine-label">{step.label}</span>
            <span className="cspine-detail">{step.detail}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
