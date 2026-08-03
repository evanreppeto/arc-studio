import Link from "next/link";

import { type MediaSpendMeter } from "@/lib/media/spend-meter";

// The Studio's spend strip: what this period has cost, what the next job will
// cost, and what happens at the cap — shown where the spending happens rather
// than in Settings (BSR-515).
//
// Quiet by default. It only raises its voice at 80%, and only blocks at 100%,
// matching the plan-quota notice so the two read as one system.

export function MediaSpendMeterBar({ meter }: { meter: MediaSpendMeter }) {
  if (!meter.show) return null;

  const tone = meter.isOverCap ? "blocked" : meter.isNearCap ? "warn" : "quiet";

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg border px-4 py-3 ${
        tone === "blocked"
          ? "border-[color:color-mix(in_srgb,var(--priority)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--priority)_10%,var(--surface-panel))]"
          : tone === "warn"
            ? "border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_9%,var(--surface-panel))]"
            : "border-[color:var(--border-panel)] bg-[var(--surface-panel)]"
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
              {meter.remainingLabel} left this period
              {meter.isNearCap && <> — generation pauses at the cap, nothing is deleted</>}
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
            : tone === "warn"
              ? "bg-[var(--accent)] text-[var(--on-accent)]"
              : "border border-[color:var(--border-panel)] bg-[var(--surface-inset)] text-[var(--text-secondary)]"
        }`}
      >
        {meter.isOverCap || meter.isNearCap ? "Raise the cap" : "Spend settings"}
      </Link>
    </div>
  );
}
