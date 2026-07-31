import Link from "next/link";

import { LandingFooter } from "@/app/landing/_components/landing-sections";
import { Reveal } from "@/app/landing/_components/reveal";
import { SiteNav } from "@/app/landing/_components/site-nav";
import { isSelfServeSignupOpen } from "@/lib/auth/auth-mode";

import {
  LAST_UPDATED,
  hasUnresolvedPlaceholders,
  type LegalSection,
} from "../_data/legal-documents";

const NAV_LINKS = [
  { href: "/#product", label: "Product" },
  { href: "/industries", label: "Industries" },
  { href: "/compare", label: "Compare" },
  { href: "/pricing", label: "Pricing" },
];

export const LEGAL_PAGES = [
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/subprocessors", label: "Subprocessors" },
];

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const month = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][(m ?? 1) - 1];
  return `${month} ${d}, ${y}`;
}

/**
 * Rendered while the entity name, address, or jurisdiction is still a
 * placeholder. A policy that names a company which does not exist is worse than
 * no policy, so this says so out loud rather than letting a draft masquerade as
 * a published document.
 */
function DraftNotice() {
  return (
    <div className="mb-10 rounded-xl border border-[color:color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--warn)_10%,transparent)] p-5">
      <p className="text-[0.9rem] font-semibold text-[var(--warn)]">
        Draft — not yet in effect
      </p>
      <p className="mt-2 max-w-[70ch] text-[0.875rem] leading-relaxed text-[var(--text-secondary)]">
        This document is a prepared baseline awaiting legal review and the
        registered entity details. It does not yet form a binding agreement.
        Self-serve signup remains closed until it does.
      </p>
    </div>
  );
}

export function LegalView({
  title,
  intro,
  sections,
  children,
  currentPath,
}: {
  title: string;
  intro?: string;
  sections?: LegalSection[];
  children?: React.ReactNode;
  currentPath: string;
}) {
  const signupOpen = isSelfServeSignupOpen();
  const ctaHref = signupOpen ? "/sign-up" : "/#waitlist";
  const ctaLabel = signupOpen ? "Start free trial" : "Join waitlist";

  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--text-primary)]">
      <SiteNav links={NAV_LINKS} ctaHref={ctaHref} ctaLabel={ctaLabel} homeHref="/" />

      <section className="mx-auto max-w-6xl px-6 pb-4 pt-36 sm:pt-40">
        <Reveal>
          <nav aria-label="Breadcrumb" className="mb-6 text-[0.82rem] text-[var(--text-muted)]">
            <Link href="/legal" className="underline-offset-4 hover:text-[var(--text-secondary)] hover:underline">
              Legal
            </Link>
            <span className="px-2">/</span>
            <span className="text-[var(--text-secondary)]">{title}</span>
          </nav>
          <h1 className="max-w-[22ch] font-serif text-[2.4rem] font-semibold leading-[1.1] text-[var(--text-primary)] sm:text-[3rem]">
            {title}
          </h1>
          <p className="mt-4 text-[0.85rem] text-[var(--text-muted)]">
            Last updated {formatDate(LAST_UPDATED)}
          </p>
          {intro ? (
            <p className="mt-6 max-w-[68ch] text-[1rem] leading-relaxed text-[var(--text-secondary)]">
              {intro}
            </p>
          ) : null}
        </Reveal>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="grid gap-12 lg:grid-cols-[15rem_1fr] lg:gap-16">
          {/* Sibling navigation — a reader who lands on Terms from Stripe or a
              footer link should be able to reach Privacy without going home. */}
          <Reveal>
            <nav aria-label="Legal documents" className="lg:sticky lg:top-28 lg:self-start">
              <ul className="space-y-1">
                {LEGAL_PAGES.map((page) => {
                  const active = page.href === currentPath;
                  return (
                    <li key={page.href}>
                      <Link
                        href={page.href}
                        aria-current={active ? "page" : undefined}
                        className={`block rounded-lg px-3 py-2 text-[0.9rem] transition-colors ${
                          active
                            ? "bg-[color:color-mix(in_srgb,var(--accent)_10%,transparent)] font-medium text-[var(--accent)]"
                            : "text-[var(--text-secondary)] hover:bg-[var(--surface-panel)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        {page.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </Reveal>

          <Reveal delay={0.06}>
            <div className="max-w-[74ch]">
              {hasUnresolvedPlaceholders() ? <DraftNotice /> : null}

              {sections?.map((section) => (
                <section key={section.heading} className="mb-9">
                  <h2 className="font-serif text-xl font-semibold text-[var(--text-primary)]">
                    {section.heading}
                  </h2>
                  {section.body.map((paragraph) => (
                    <p
                      key={paragraph}
                      className="mt-3 text-[0.95rem] leading-relaxed text-[var(--text-secondary)]"
                    >
                      {paragraph}
                    </p>
                  ))}
                </section>
              ))}

              {children}
            </div>
          </Reveal>
        </div>
      </section>

      <LandingFooter />
    </main>
  );
}
