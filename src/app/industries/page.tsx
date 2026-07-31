import type { Metadata } from "next";
import Link from "next/link";

import { GoldCta } from "@/app/landing/_components/cta";
import { Reveal } from "@/app/landing/_components/reveal";
import { SiteNav } from "@/app/landing/_components/site-nav";
import { isSelfServeSignupOpen } from "@/lib/auth/auth-mode";
import { INDUSTRY_OPTIONS } from "@/lib/personas/industry-templates";
import { SITE_URL } from "@/lib/seo/site";

import { INDUSTRIES } from "./_data/industries";

const TITLE = "Arc Studio by Industry — Restoration, Roofing, HVAC, Cleaning";
const DESCRIPTION =
  "Arc speaks your trade's vocabulary from day one: your CRM relabels itself and your personas arrive written. See what that looks like for your industry.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/industries" },
  openGraph: {
    type: "website",
    siteName: "Arc Studio",
    url: `${SITE_URL}/industries`,
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/brand/og-card.jpg", width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/brand/og-card.jpg"],
  },
};

const NAV_LINKS = [
  { href: "/#product", label: "Product" },
  { href: "/industries", label: "Industries" },
  { href: "/compare", label: "Compare" },
  { href: "/pricing", label: "Pricing" },
];

export default function IndustriesIndexPage() {
  const signupOpen = isSelfServeSignupOpen();
  const ctaHref = signupOpen ? "/sign-up" : "/#waitlist";
  const ctaLabel = signupOpen ? "Start free trial" : "Join waitlist";

  // Derived from the real picker options, so this list cannot claim support for
  // an industry the product does not actually have a template for.
  const supportedElsewhere = INDUSTRY_OPTIONS.filter(
    (o) => o.value !== "general" && !INDUSTRIES.some((i) => i.industryKey === o.value),
  );

  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--text-primary)]">
      <SiteNav links={NAV_LINKS} ctaHref={ctaHref} ctaLabel={ctaLabel} homeHref="/" />

      <section className="mx-auto max-w-6xl px-6 pb-4 pt-36 sm:pt-40">
        <Reveal>
          <h1 className="max-w-[20ch] font-serif text-[2.6rem] font-semibold leading-[1.08] text-[var(--text-primary)] sm:text-[3.3rem]">
            It should already know{" "}
            <span className="text-[var(--accent)]">what you call things.</span>
          </h1>
          <p className="mt-6 max-w-[62ch] text-[1.02rem] leading-relaxed text-[var(--text-secondary)]">
            Pick your industry when you sign up and the CRM relabels itself,
            your personas arrive with their message angles already written, and
            Arc starts watching the signals that matter in your trade. Nothing
            about the setup asks you to think in someone else&rsquo;s nouns.
          </p>
        </Reveal>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-5 sm:grid-cols-2">
          {INDUSTRIES.map((industry, i) => (
            <Reveal key={industry.slug} delay={0.06 * i} className="h-full">
              <Link
                href={`/industries/${industry.slug}`}
                className="group flex h-full flex-col rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)] p-6 transition-colors duration-200 hover:border-[color:color-mix(in_srgb,var(--accent)_40%,var(--border-panel))]"
              >
                <h2 className="font-serif text-xl font-semibold leading-snug text-[var(--text-primary)]">
                  {industry.shortLabel}
                </h2>
                <p className="mt-1 text-[0.85rem] font-medium text-[var(--accent)]">
                  {industry.titleAccent}
                </p>
                <p className="mt-3 flex-1 text-[0.9rem] leading-relaxed text-[var(--text-secondary)]">
                  {industry.lede}
                </p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-[0.85rem] font-medium text-[var(--accent)]">
                  See it for {industry.shortLabel.toLowerCase()}
                  <span
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                    aria-hidden
                  >
                    &rarr;
                  </span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {supportedElsewhere.length > 0 ? (
        <section className="border-y border-[color:var(--border-panel)] bg-[var(--canvas-deep)]">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <Reveal>
              <h2 className="font-serif text-2xl font-semibold text-[var(--text-primary)]">
                Supported, without a page yet
              </h2>
              <p className="mt-3 max-w-[62ch] text-[0.925rem] leading-relaxed text-[var(--text-secondary)]">
                These industries have the same treatment inside the product —
                their own CRM vocabulary and their own seeded personas. We just
                have not written the page. Pick yours at signup and it works the
                same way.
              </p>
            </Reveal>
            <Reveal delay={0.08}>
              <ul className="mt-7 flex flex-wrap gap-2.5">
                {supportedElsewhere.map((o) => (
                  <li
                    key={o.value}
                    className="rounded-full border border-[color:var(--border-panel)] bg-[var(--surface-panel)] px-3.5 py-1.5 text-[0.85rem] text-[var(--text-secondary)]"
                  >
                    {o.label}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>
      ) : null}

      <section className="mx-auto max-w-6xl px-6 py-20">
        <Reveal className="flex flex-col items-start gap-7">
          <h2 className="max-w-[26ch] font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
            Same rule in every industry.
          </h2>
          <p className="max-w-[58ch] text-[0.975rem] leading-relaxed text-[var(--text-secondary)]">
            Arc drafts, you approve. Nothing sends, publishes, or spends without
            you signing off on it, whatever business you are in.
          </p>
          <GoldCta href={ctaHref}>{ctaLabel}</GoldCta>
        </Reveal>
      </section>
    </main>
  );
}
