import type { Metadata } from "next";
import Link from "next/link";

import { LandingFooter } from "@/app/landing/_components/landing-sections";
import { Reveal } from "@/app/landing/_components/reveal";
import { SiteNav } from "@/app/landing/_components/site-nav";
import { isSelfServeSignupOpen } from "@/lib/auth/auth-mode";
import { SITE_URL } from "@/lib/seo/site";

import { LEGAL_PAGES } from "./_components/legal-view";
import { ENTITY, hasUnresolvedPlaceholders } from "./_data/legal-documents";

const TITLE = "Legal — Arc Studio";
const DESCRIPTION =
  "Terms of Service, Privacy Policy, and the full subprocessor list for Arc Studio.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/legal" },
  openGraph: {
    type: "website",
    siteName: "Arc Studio",
    url: `${SITE_URL}/legal`,
    title: TITLE,
    description: DESCRIPTION,
  },
};

const NAV_LINKS = [
  { href: "/#product", label: "Product" },
  { href: "/industries", label: "Industries" },
  { href: "/compare", label: "Compare" },
  { href: "/pricing", label: "Pricing" },
];

const BLURBS: Record<string, string> = {
  "/legal/terms": "What the service does, what you are responsible for approving, and how plans and billing work.",
  "/legal/privacy": "What we collect, what the AI providers see, how workspaces are isolated, and your rights over the data.",
  "/legal/subprocessors": "Every third party that processes data on our behalf, and which ones are optional per workspace.",
};

export default function LegalIndexPage() {
  const signupOpen = isSelfServeSignupOpen();
  const ctaHref = signupOpen ? "/sign-up" : "/#waitlist";
  const ctaLabel = signupOpen ? "Start free trial" : "Join waitlist";

  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--text-primary)]">
      <SiteNav links={NAV_LINKS} ctaHref={ctaHref} ctaLabel={ctaLabel} homeHref="/" />

      <section className="mx-auto max-w-6xl px-6 pb-4 pt-36 sm:pt-40">
        <Reveal>
          <h1 className="max-w-[20ch] font-serif text-[2.4rem] font-semibold leading-[1.1] text-[var(--text-primary)] sm:text-[3rem]">
            Legal
          </h1>
          <p className="mt-6 max-w-[62ch] text-[1rem] leading-relaxed text-[var(--text-secondary)]">
            Written to be read rather than to be survived. If something here is
            unclear, ask us at {ENTITY.contactEmail} and we will fix the wording.
          </p>
          {hasUnresolvedPlaceholders() ? (
            <p className="mt-5 max-w-[62ch] text-[0.9rem] leading-relaxed text-[var(--warn)]">
              These documents are a prepared baseline awaiting legal review and
              registered entity details. They are not yet in effect, and
              self-serve signup stays closed until they are.
            </p>
          ) : null}
        </Reveal>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-5 sm:grid-cols-3">
          {LEGAL_PAGES.map((page, i) => (
            <Reveal key={page.href} delay={0.06 * i} className="h-full">
              <Link
                href={page.href}
                className="group flex h-full flex-col rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)] p-6 transition-colors duration-200 hover:border-[color:color-mix(in_srgb,var(--accent)_40%,var(--border-panel))]"
              >
                <h2 className="font-serif text-lg font-semibold leading-snug text-[var(--text-primary)]">
                  {page.label}
                </h2>
                <p className="mt-3 flex-1 text-[0.875rem] leading-relaxed text-[var(--text-secondary)]">
                  {BLURBS[page.href]}
                </p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-[0.85rem] font-medium text-[var(--accent)]">
                  Read
                  <span className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden>
                    &rarr;
                  </span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      <LandingFooter />
    </main>
  );
}
