"use client";

import { useState } from "react";
import Link from "next/link";
import { useMotionValueEvent, useScroll } from "motion/react";

import { GoldCta } from "./cta";

// The shared marketing header, used by both the landing page and /pricing so the
// two never drift apart. Links are passed in rather than hardcoded because the
// landing scrolls to in-page anchors ("#how") while /pricing has to send people
// back to the landing to reach them ("/#how").

export type SiteNavLink = { href: string; label: string };

export function SiteNav({
  links,
  ctaHref,
  ctaLabel,
  homeHref = "#top",
}: {
  links: SiteNavLink[];
  ctaHref: string;
  ctaLabel: string;
  /** Where the wordmark points — the landing scrolls to top, other pages go home. */
  homeHref?: string;
}) {
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 12));

  // An in-page anchor stays an <a> (native scroll); a real route uses <Link> so
  // it client-side navigates instead of reloading the document.
  const isAnchor = (href: string) => href.startsWith("#");

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-[background-color,border-color,backdrop-filter] duration-300 ${
        scrolled
          ? "border-b border-[color:var(--border-panel)] bg-[color:color-mix(in_srgb,var(--canvas)_82%,transparent)] backdrop-blur-md"
          : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
        {isAnchor(homeHref) ? (
          <a href={homeHref} className="flex items-center gap-2.5" aria-label="Arc Studio — back to top">
            <img src="/icon.png" alt="" className="h-7 w-auto" />
            <img src="/brand/arc-studio-wordmark.png" alt="Arc Studio" className="h-[1.15rem] w-auto" />
          </a>
        ) : (
          <Link href={homeHref} className="flex min-h-[44px] items-center gap-2.5 sm:min-h-0" aria-label="Arc Studio — home">
            <img src="/icon.png" alt="" className="h-7 w-auto" />
            <img src="/brand/arc-studio-wordmark.png" alt="Arc Studio" className="h-[1.15rem] w-auto" />
          </Link>
        )}
        <nav className="hidden items-center gap-7 md:flex" aria-label="Page sections">
          {links.map((link) =>
            isAnchor(link.href) ? (
              <a
                key={link.href}
                href={link.href}
                className="text-[0.875rem] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className="text-[0.875rem] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              >
                {link.label}
              </Link>
            ),
          )}
        </nav>
        <div className="flex items-center gap-2.5">
          {/* Hidden on the narrowest screens: at 375px the wordmark + "Sign in" +
              CTA exactly consume the bar, so both wrap to two lines and collide.
              The CTA is the priority action on mobile, and sign-in is still in
              the footer on every page. */}
          <Link
            href="/login"
            className="hidden min-h-[44px] items-center rounded-lg px-3.5 sm:min-h-[38px] text-[0.875rem] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] sm:flex"
          >
            Sign in
          </Link>
          <GoldCta href={ctaHref} size="sm">
            {ctaLabel}
          </GoldCta>
        </div>
      </div>
    </header>
  );
}
