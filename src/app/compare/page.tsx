import type { Metadata } from "next";
import Link from "next/link";

import { GoldCta } from "@/app/landing/_components/cta";
import { Reveal } from "@/app/landing/_components/reveal";
import { SiteNav } from "@/app/landing/_components/site-nav";
import { isSelfServeSignupOpen } from "@/lib/auth/auth-mode";
import { SITE_URL } from "@/lib/seo/site";

import { COMPARISONS } from "./_data/comparisons";

const TITLE = "Compare Arc Studio — Agencies, ChatGPT, Mailchimp, HubSpot";
const DESCRIPTION =
  "Honest comparisons for service businesses without a marketing team. Each one says where the alternative is the better choice, because that is the version worth reading.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/compare" },
  openGraph: {
    type: "website",
    siteName: "Arc Studio",
    url: `${SITE_URL}/compare`,
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
  { href: "/#how", label: "How it works" },
  { href: "/compare", label: "Compare" },
  { href: "/pricing", label: "Pricing" },
];

// The hub for the comparison set. Exists so the individual pages have a parent
// to link up to (breadcrumbs, internal linking) and so search has one URL that
// represents the whole cluster.
export default function CompareIndexPage() {
  const signupOpen = isSelfServeSignupOpen();
  const ctaHref = signupOpen ? "/sign-up" : "/#waitlist";
  const ctaLabel = signupOpen ? "Start free trial" : "Join waitlist";

  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--text-primary)]">
      <SiteNav links={NAV_LINKS} ctaHref={ctaHref} ctaLabel={ctaLabel} homeHref="/" />

      <section className="mx-auto max-w-6xl px-6 pb-4 pt-36 sm:pt-40">
        <Reveal>
          <h1 className="max-w-[20ch] font-serif text-[2.6rem] font-semibold leading-[1.08] text-[var(--text-primary)] sm:text-[3.3rem]">
            How Arc Studio compares.{" "}
            <span className="text-[var(--accent)]">Including where it loses.</span>
          </h1>
          <p className="mt-6 max-w-[60ch] text-[1.02rem] leading-relaxed text-[var(--text-secondary)]">
            Every comparison below has a section on when the alternative is the
            better choice. We would rather you find that out here than in month
            three, and a comparison that only flatters us is not worth your time
            to read.
          </p>
        </Reveal>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-5 sm:grid-cols-2">
          {COMPARISONS.map((c, i) => (
            <Reveal key={c.slug} delay={0.06 * i} className="h-full">
              <Link
                href={`/compare/${c.slug}`}
                className="group flex h-full flex-col rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)] p-6 transition-colors duration-200 hover:border-[color:color-mix(in_srgb,var(--accent)_40%,var(--border-panel))]"
              >
                <h2 className="font-serif text-xl font-semibold leading-snug text-[var(--text-primary)]">
                  Arc Studio {c.shortLabel}
                </h2>
                <p className="mt-3 flex-1 text-[0.9rem] leading-relaxed text-[var(--text-secondary)]">
                  {c.lede}
                </p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-[0.85rem] font-medium text-[var(--accent)]">
                  Read the comparison
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

      <section className="border-t border-[color:var(--border-panel)] bg-[var(--canvas-deep)]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Reveal className="flex flex-col items-start gap-7">
            <h2 className="max-w-[26ch] font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
              The part every comparison has in common.
            </h2>
            <p className="max-w-[58ch] text-[0.975rem] leading-relaxed text-[var(--text-secondary)]">
              Arc finds the opportunity, drafts the campaign, and prepares the
              creative — then stops. Nothing sends, publishes, or spends without
              you approving it, and there is no setting that turns that off.
            </p>
            <GoldCta href={ctaHref}>{ctaLabel}</GoldCta>
          </Reveal>
        </div>
      </section>
    </main>
  );
}
