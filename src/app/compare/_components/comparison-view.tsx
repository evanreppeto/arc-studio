import Link from "next/link";

import { GhostCta, GoldCta } from "@/app/landing/_components/cta";
import { Reveal } from "@/app/landing/_components/reveal";
import { SiteNav } from "@/app/landing/_components/site-nav";

import { COMPARISONS, type Comparison } from "../_data/comparisons";

// Shared marketing nav. Matches /pricing so the header never drifts between the
// public pages — comparison pages are a real entry point from search, so this is
// often the first Arc Studio chrome a stranger sees.
const NAV_LINKS = [
  { href: "/#product", label: "Product" },
  { href: "/#how", label: "How it works" },
  { href: "/compare", label: "Compare" },
  { href: "/pricing", label: "Pricing" },
];

function formatReviewed(iso: string): string {
  // Explicit UTC parts rather than toLocaleDateString: this renders on the
  // server and would otherwise drift by a day depending on the runtime's zone.
  const [y, m, d] = iso.split("-").map(Number);
  const month = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][(m ?? 1) - 1];
  return `${month} ${d}, ${y}`;
}

/**
 * The comparison table.
 *
 * Asymmetric 3-column grid on desktop (label / us / them); stacks into labelled
 * blocks on mobile, where a real table would either overflow or shrink below a
 * readable size. The Arc column carries a faint accent wash so the eye can hold
 * its place across a long row — a tint, not a border, since side-stripes over
 * 1px are a DESIGN.md anti-pattern.
 */
function ComparisonTable({ comparison }: { comparison: Comparison }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)]">
      {/* Column headers — desktop only. On mobile each cell is labelled inline. */}
      <div
        className="hidden border-b border-[color:var(--border-panel)] sm:grid sm:grid-cols-[minmax(8.5rem,0.9fr)_1.25fr_1.25fr]"
        aria-hidden
      >
        <div className="px-5 py-3.5" />
        <div className="border-l border-[color:var(--border-panel)] bg-[color:color-mix(in_srgb,var(--accent)_7%,transparent)] px-5 py-3.5 text-[0.85rem] font-semibold text-[var(--accent)]">
          Arc Studio
        </div>
        <div className="border-l border-[color:var(--border-panel)] px-5 py-3.5 text-[0.85rem] font-semibold text-[var(--text-secondary)]">
          {comparison.otherLabel}
        </div>
      </div>

      <dl>
        {comparison.rows.map((row, i) => (
          <div
            key={row.dimension}
            className={`sm:grid sm:grid-cols-[minmax(8.5rem,0.9fr)_1.25fr_1.25fr] ${
              i > 0 ? "border-t border-[color:var(--border-panel)]" : ""
            }`}
          >
            <dt className="px-5 pb-1 pt-4 text-[0.8rem] font-medium leading-snug text-[var(--text-muted)] sm:py-5 sm:text-[0.82rem]">
              {row.dimension}
            </dt>
            <dd className="border-l-0 px-5 py-3 text-[0.875rem] leading-relaxed text-[var(--text-primary)] sm:border-l sm:border-[color:var(--border-panel)] sm:bg-[color:color-mix(in_srgb,var(--accent)_5%,transparent)] sm:py-5">
              {/* Mobile-only source label; the desktop header carries it above. */}
              <span className="mb-1 block text-[0.72rem] font-semibold text-[var(--accent)] sm:hidden">
                Arc Studio
              </span>
              {row.arc}
            </dd>
            <dd className="px-5 pb-5 pt-3 text-[0.875rem] leading-relaxed text-[var(--text-secondary)] sm:border-l sm:border-[color:var(--border-panel)] sm:py-5">
              <span className="mb-1 block text-[0.72rem] font-semibold text-[var(--text-muted)] sm:hidden">
                {comparison.otherLabel}
              </span>
              {row.other}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Small inline check used only in the "better choice" list. */
function Bullet() {
  return (
    <span
      className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-[var(--text-muted)]"
      aria-hidden
    />
  );
}

export function ComparisonView({
  comparison,
  signupOpen,
}: {
  comparison: Comparison;
  signupOpen: boolean;
}) {
  const ctaHref = signupOpen ? "/sign-up" : "/#waitlist";
  const ctaLabel = signupOpen ? "Start free trial" : "Join waitlist";
  const others = COMPARISONS.filter((c) => c.slug !== comparison.slug);

  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--text-primary)]">
      <SiteNav links={NAV_LINKS} ctaHref={ctaHref} ctaLabel={ctaLabel} homeHref="/" />

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-4 pt-36 sm:pt-40">
        <Reveal>
          <nav aria-label="Breadcrumb" className="mb-6 text-[0.82rem] text-[var(--text-muted)]">
            <Link href="/compare" className="underline-offset-4 hover:text-[var(--text-secondary)] hover:underline">
              Compare
            </Link>
            <span className="px-2">/</span>
            <span className="text-[var(--text-secondary)]">{comparison.shortLabel}</span>
          </nav>
          <h1 className="max-w-[20ch] font-serif text-[2.6rem] font-semibold leading-[1.08] text-[var(--text-primary)] sm:text-[3.3rem]">
            {comparison.title}{" "}
            <span className="text-[var(--accent)]">{comparison.titleAccent}</span>
          </h1>
          <p className="mt-6 max-w-[58ch] text-[1.02rem] leading-relaxed text-[var(--text-secondary)]">
            {comparison.lede}
          </p>
        </Reveal>
      </section>

      {/* The short answer — the one paragraph that has to survive a skim. */}
      <section className="mx-auto max-w-6xl px-6 py-10">
        <Reveal delay={0.06}>
          <div className="max-w-[74ch] rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)] p-6 sm:p-8">
            <h2 className="font-serif text-xl font-semibold text-[var(--text-primary)]">
              The short answer
            </h2>
            <p className="mt-3 text-[0.975rem] leading-relaxed text-[var(--text-secondary)]">
              {comparison.shortAnswer}
            </p>
          </div>
        </Reveal>
      </section>

      {/* Side by side */}
      <section className="mx-auto max-w-6xl px-6 py-8">
        <Reveal>
          <h2 className="font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
            Side by side
          </h2>
        </Reveal>
        <Reveal delay={0.08} className="mt-8">
          <ComparisonTable comparison={comparison} />
        </Reveal>

        {comparison.sources && comparison.sources.length > 0 ? (
          <Reveal delay={0.1}>
            <p className="mt-5 max-w-[74ch] text-[0.8rem] leading-relaxed text-[var(--text-muted)]">
              Sources:{" "}
              {comparison.sources.map((s, i) => (
                <span key={s.url}>
                  {i > 0 ? ", " : ""}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="underline underline-offset-4 hover:text-[var(--text-secondary)]"
                  >
                    {s.label}
                  </a>
                </span>
              ))}
              .
            </p>
          </Reveal>
        ) : null}
      </section>

      {/* Where the other option wins. Non-negotiable section — see the data file. */}
      <section className="border-y border-[color:var(--border-panel)] bg-[var(--canvas-deep)]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <Reveal>
              <h2 className="font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
                {comparison.betterChoiceTitle}
              </h2>
              <p className="mt-4 max-w-[42ch] text-[0.95rem] leading-relaxed text-[var(--text-secondary)]">
                We would rather you read this now than find it out in month three.
              </p>
            </Reveal>
            <Reveal delay={0.08}>
              <ul className="space-y-4">
                {comparison.betterChoice.map((item) => (
                  <li key={item} className="flex gap-3.5">
                    <Bullet />
                    <span className="max-w-[68ch] text-[0.95rem] leading-relaxed text-[var(--text-secondary)]">
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <Reveal className="flex flex-col items-start gap-7">
          <h2 className="max-w-[24ch] font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
            Nothing reaches a customer until you approve it.
          </h2>
          <p className="max-w-[56ch] text-[0.975rem] leading-relaxed text-[var(--text-secondary)]">
            Arc finds the opportunity, drafts the campaign, and prepares the
            creative. You decide what actually goes out — on every single piece,
            with no setting that turns the gate off.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <GoldCta href={ctaHref}>{ctaLabel}</GoldCta>
            <GhostCta href="/pricing">See pricing</GhostCta>
          </div>
          <p className="text-[0.8rem] text-[var(--text-muted)]">
            This comparison was last reviewed on {formatReviewed(comparison.lastReviewed)}.
          </p>
        </Reveal>
      </section>

      {/* Internal linking: keeps a searcher who landed on the wrong comparison. */}
      <section className="border-t border-[color:var(--border-panel)] bg-[var(--canvas-deep)]">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <Reveal>
            <h2 className="font-serif text-2xl font-semibold text-[var(--text-primary)]">
              Other comparisons
            </h2>
          </Reveal>
          <div className="mt-7 grid gap-4 sm:grid-cols-2">
            {others.map((c, i) => (
              <Reveal key={c.slug} delay={0.06 * i}>
                <Link
                  href={`/compare/${c.slug}`}
                  className="group flex h-full flex-col rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)] p-5 transition-colors duration-200 hover:border-[color:color-mix(in_srgb,var(--accent)_40%,var(--border-panel))]"
                >
                  <span className="text-[0.95rem] font-semibold text-[var(--text-primary)]">
                    Arc Studio {c.shortLabel}
                  </span>
                  <span className="mt-1.5 text-[0.85rem] leading-relaxed text-[var(--text-muted)]">
                    {c.lede}
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
