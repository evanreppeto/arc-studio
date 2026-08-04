import Link from "next/link";

import { type MediaSpendMeter } from "@/lib/media/spend-meter";

// The Studio's spend strip: what this period has cost, what the next job will
// cost, and what happens at the cap — shown where the spending happens rather
// than in Settings (BSR-515).
//
// Quiet MEANS quiet (BSR-703). This claimed to be "quiet by default" while
// rendering a full-width bordered banner above the page at $0 spent, which read
// as a warning about nothing and was the first thing on the screen every visit.
// Below the cap it is now one line of muted text; the banner treatment is held
// back for the two states that actually need a decision — near the cap, and
// paused at it.
//
// What it must NOT do is disappear: M6 requires the operator sees cost BEFORE
// generating, so the per-job price and the remaining budget stay visible in
// every state. This is a volume change, not a removal.

export type SpendStripTone = "quiet" | "warn" | "blocked";

/**
 * How loud the strip should be. Pure and exported so the thresholds are
 * assertable — "quiet until it matters" is the behaviour BSR-703 asked for, and
 * a silent drift back to always-loud is exactly what would go unnoticed.
 */
export function spendStripTone(meter: Pick<MediaSpendMeter, "isOverCap" | "isNearCap">): SpendStripTone {
  if (meter.isOverCap) return "blocked";
  if (meter.isNearCap) return "warn";
  return "quiet";
}

export function MediaSpendMeterBar({ meter }: { meter: MediaSpendMeter }) {
  if (!meter.show) return null;

  const tone = spendStripTone(meter);

  // Under the cap: one muted line. Still carries the two facts M6 needs — what a
  // job costs and what is left — just without asking for attention it hasn't
  // earned.
  if (tone === "quiet") {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pb-1 text-[0.76rem] leading-relaxed text-[var(--text-muted)]">
        {meter.perJob && (
          <span>
            About {meter.perJob.image} an image, {meter.perJob.video} a video clip
          </span>
        )}
        <span aria-hidden="true">·</span>
        <span>
          {meter.remainingLabel} left of your {meter.capLabel} this month
        </span>
        <Link
          href="/settings"
          className="underline decoration-dotted underline-offset-2 transition-colors duration-200 hover:text-[var(--text-secondary)]"
        >
          Spend settings
        </Link>
      </p>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg border px-4 py-3 ${
        tone === "blocked"
          ? "border-[color:color-mix(in_srgb,var(--priority)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--priority)_10%,var(--surface-panel))]"
          : "border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_9%,var(--surface-panel))]"
      }`}
    >
      <div className="min-w-0">
        {/* The cap is shared across every metered connector, so the headline is
            total spend against it — that is what refuses the next generate.
            Generation's own share follows only when it isn't the whole figure. */}
        <p className="text-[0.85rem] font-semibold text-[var(--text-primary)]">
          {meter.isOverCap
            ? `Generation paused — ${meter.capLabel} spend cap reached`
            : `${meter.spentLabel} of your ${meter.capLabel} monthly creative budget used`}
          {!meter.isOverCap && !meter.mediaIsAllSpend && (
            <span className="ml-2 font-normal text-[var(--text-secondary)]">
              ({meter.mediaSpentLabel} on generation)
            </span>
          )}
          <span className="ml-2 font-normal text-[var(--text-muted)]">{meter.periodLabel}</span>
        </p>
        <p className="mt-1 text-[0.78rem] leading-relaxed text-[var(--text-secondary)]">
          {meter.isOverCap ? (
            <>Approved assets and everything already generated are unaffected. Raise the cap to carry on.</>
          ) : (
            <>
              {meter.perJob && (
                <>
                  About {meter.perJob.image} an image and {meter.perJob.video} a video clip
                  {" · "}
                </>
              )}
              {meter.remainingLabel} left this period — generation pauses at the cap, nothing is deleted
            </>
          )}
        </p>
      </div>

      {/* The cap lives in Settings → Usage; raising it is the operator's
          explicit approval of more spend, so the action stays where that
          decision is recorded rather than being a one-click escape here. */}
      <Link
        href="/settings"
        className={`shrink-0 rounded-lg px-3.5 py-2 text-[0.78rem] font-semibold transition-[filter,transform] duration-200 hover:brightness-110 active:translate-y-px ${
          tone === "blocked"
            ? "bg-[var(--priority-solid)] text-[var(--on-priority)]"
            : "bg-[var(--accent)] text-[var(--on-accent)]"
        }`}
      >
        Raise the cap
      </Link>
    </div>
  );
}
