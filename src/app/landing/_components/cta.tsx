"use client";

import Link from "next/link";

// The landing page's two CTA treatments, shared by the nav, hero, and final
// band so hover behavior stays identical everywhere:
// - Gold: lifts, blooms, and a light sheen sweeps across once per hover.
// - Ghost: border and text warm to gold with a soft raise.
// Sheen and lift are transform/filter only (cheap) and hidden under reduced motion.

const SHEEN =
  "pointer-events-none absolute inset-0 -translate-x-[130%] bg-[linear-gradient(105deg,transparent_38%,rgba(255,255,255,0.42)_50%,transparent_62%)] transition-transform duration-700 ease-out group-hover:translate-x-[130%] motion-reduce:hidden";

export function GoldCta({
  href,
  children,
  size = "lg",
}: {
  href: string;
  children: React.ReactNode;
  size?: "lg" | "sm";
}) {
  // whitespace-nowrap: a CTA label must never break mid-phrase ("Start 14-" /
  // "day trial") when the bar gets tight on small screens.
  const sizing =
    size === "lg"
      ? "min-h-[48px] whitespace-nowrap px-7 text-[0.95rem]"
      : "min-h-[38px] whitespace-nowrap px-4 text-[0.875rem]";
  return (
    <Link
      href={href}
      className={`group relative flex items-center justify-center overflow-hidden rounded-lg bg-[var(--accent)] font-semibold text-[var(--on-accent)] transition-[transform,box-shadow,filter] duration-300 ease-out hover:scale-[1.04] hover:brightness-110 hover:shadow-[0_14px_36px_-10px_rgba(200,162,74,0.6)] active:scale-100 active:translate-y-px motion-reduce:transform-none ${sizing}`}
    >
      <span aria-hidden className={SHEEN} />
      <span className="relative z-10 flex items-center gap-2">
        {children}
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 -translate-x-0.5 opacity-0 transition-[transform,opacity] duration-300 group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:hidden"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </Link>
  );
}

export function GhostCta({
  href,
  children,
  size = "lg",
}: {
  href: string;
  children: React.ReactNode;
  size?: "lg" | "sm";
}) {
  // whitespace-nowrap: a CTA label must never break mid-phrase ("Start 14-" /
  // "day trial") when the bar gets tight on small screens.
  const sizing =
    size === "lg"
      ? "min-h-[48px] whitespace-nowrap px-7 text-[0.95rem]"
      : "min-h-[38px] whitespace-nowrap px-4 text-[0.875rem]";
  return (
    <Link
      href={href}
      className={`group relative flex items-center justify-center overflow-hidden rounded-lg border border-[color:var(--border-panel)] bg-[color:color-mix(in_srgb,var(--surface-raised)_65%,transparent)] font-medium text-[var(--text-primary)] backdrop-blur transition-[transform,border-color,background-color,box-shadow,color] duration-300 ease-out hover:scale-[1.03] hover:border-[color:color-mix(in_srgb,var(--accent)_75%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--surface-raised))] hover:text-[var(--accent)] hover:shadow-[0_12px_32px_-12px_rgba(200,162,74,0.35),inset_0_1px_0_rgba(241,237,226,0.07)] active:scale-100 active:translate-y-px motion-reduce:transform-none ${sizing}`}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-[130%] bg-[linear-gradient(105deg,transparent_38%,rgba(200,162,74,0.18)_50%,transparent_62%)] transition-transform duration-700 ease-out group-hover:translate-x-[130%] motion-reduce:hidden"
      />
      <span className="relative z-10">{children}</span>
    </Link>
  );
}
