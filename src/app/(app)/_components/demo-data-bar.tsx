import { DEMO_DATA_LABEL, DEMO_DATA_MEANING } from "@/domain";

/**
 * Says once, console-wide, that the numbers on screen are illustrative.
 *
 * Before this, `/journeys` badged its funnel "demo data", Settings said "Sample
 * data", and `/analytics` and `/crm` rendered `710 leads` and `$225k won
 * revenue` with nothing at all. Three wordings and a silence, for one thing —
 * and the silence was the dangerous half, because the first thing anyone does
 * with a number that looks real is believe it.
 *
 * Console-wide rather than per-screen on purpose. Demo data is a deployment
 * decision (`ARC_DEMO_DATA`), not a property of one page, and twenty-seven read
 * models can serve fixtures — hand-placing a badge on each is how the next
 * screen gets forgotten, which is the bug this replaces.
 *
 * Deliberately the quiet register, matching the healthy-trial billing line:
 * a single ambient row, present and ignorable. Nothing is wrong, and a warning
 * tone here would spend attention that the approval gate needs.
 */
export function DemoDataBar({ show }: { show: boolean }) {
  if (!show) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[color:var(--border-panel)] px-6 py-2 text-[0.78rem] text-[var(--text-muted)]"
      // Announced, not alerted: someone arriving mid-session should be told what
      // they are looking at, without it interrupting them.
      role="note"
      aria-label={`${DEMO_DATA_LABEL}. ${DEMO_DATA_MEANING}`}
      data-demo-data-bar
    >
      <span className="font-medium text-[var(--text-secondary)]">{DEMO_DATA_LABEL}</span>
      <span>{DEMO_DATA_MEANING}</span>
    </div>
  );
}
