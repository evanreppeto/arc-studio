import Link from "next/link";

import { type BillingNotice } from "@/domain";

// The console-wide billing signal — trial AND quota, resolved to one message by
// `resolveBillingNotice` so two strips can never stack. Deliberately restrained:
// persistent but not nagging.
//
//  - quiet   → a single ambient line (healthy trial). Present, ignorable.
//  - warn    → a bordered strip while there is still time to act (near cap,
//              trial ending).
//  - blocked → work has actually stopped (allowance spent, trial lapsed).
//
// A paying workspace under its allowance renders nothing at all.

export function BillingNoticeBar({ banner }: { banner: BillingNotice | null }) {
  if (!banner) return null;

  if (banner.tone === "quiet") {
    return (
      <div className="flex items-center justify-between gap-4 border-b border-[color:var(--border-panel)] px-6 py-2 text-[0.78rem] text-[var(--text-muted)]">
        <span>{banner.label}</span>
        <Link
          href={banner.ctaHref}
          className="font-medium text-[var(--text-secondary)] underline-offset-4 transition-colors hover:text-[var(--accent)] hover:underline"
        >
          {banner.ctaLabel}
        </Link>
      </div>
    );
  }

  const blocked = banner.tone === "blocked";

  return (
    <div
      // The blocked state is the one moment the console should feel different.
      // Still a tint + hairline, never a red wall — nothing is broken and
      // nothing was lost, so the tone stays calm and factual.
      className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b px-6 py-3 ${
        blocked
          ? "border-[color:color-mix(in_srgb,var(--priority)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--priority)_10%,var(--surface-panel))]"
          : "border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_9%,var(--surface-panel))]"
      }`}
      role={blocked ? "status" : undefined}
    >
      <div className="min-w-0">
        <p className="text-[0.875rem] font-semibold text-[var(--text-primary)]">{banner.label}</p>
        {banner.detail && (
          <p className="mt-0.5 max-w-[78ch] text-[0.8rem] leading-relaxed text-[var(--text-secondary)]">
            {banner.detail}
          </p>
        )}
      </div>
      <Link
        href={banner.ctaHref}
        className={`shrink-0 rounded-lg px-4 py-2 text-[0.8rem] font-semibold transition-[filter,transform] duration-200 hover:brightness-110 active:translate-y-px ${
          blocked
            ? "bg-[var(--priority-solid)] text-[var(--on-priority)]"
            : "bg-[var(--accent)] text-[var(--on-accent)]"
        }`}
      >
        {banner.ctaLabel}
      </Link>
    </div>
  );
}
