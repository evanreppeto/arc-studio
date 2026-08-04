import Link from "next/link";

import { GhostCta, GoldCta } from "@/app/landing/_components/cta";
import { Reveal } from "@/app/landing/_components/reveal";
import { SiteNav } from "@/app/landing/_components/site-nav";
import { personasForIndustry } from "@/lib/personas/industry-templates";
import { getProductLanguage } from "@/lib/product-language";

import { INDUSTRIES, type Industry } from "../_data/industries";

const NAV_LINKS = [
  { href: "/#product", label: "Product" },
  { href: "/industries", label: "Industries" },
  { href: "/compare", label: "Compare" },
  { href: "/pricing", label: "Pricing" },
];

// Display order for the six CRM objects — the order the app itself lists them in.
const OBJECT_ORDER = ["companies", "contacts", "properties", "leads", "jobs", "outcomes"] as const;

function formatReviewed(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const month = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][(m ?? 1) - 1];
  return `${month} ${d}, ${y}`;
}

/**
 * The vocabulary block — DERIVED, never retyped.
 *
 * Reads `getProductLanguage()`, the same function the signed-in CRM renders its
 * headers from. That is what makes this page's promise safe: it cannot show a
 * label onboarding will not produce, because there is only one source for both.
 */
function VocabularyBlock({ industry }: { industry: Industry }) {
  const language = getProductLanguage(industry.industryKey);

  return (
    <section className="border-y border-[color:var(--border-panel)] bg-[var(--canvas-deep)]">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <Reveal>
            <h2 className="font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
              Your workspace uses your words
            </h2>
            <p className="mt-4 max-w-[44ch] text-[0.95rem] leading-relaxed text-[var(--text-secondary)]">
              Pick <span className="text-[var(--text-primary)]">{industry.industryLabel}</span> when
              you sign up and the CRM relabels itself. These are the actual
              headers your records get — not an illustration of them.
            </p>
            <p className="mt-4 max-w-[44ch] text-[0.875rem] leading-relaxed text-[var(--text-muted)]">
              Anything here that still is not your language can be renamed, and
              you can add the fields you need to any of these objects.
            </p>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="overflow-hidden rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)]">
              <div className="border-b border-[color:var(--border-panel)] px-5 py-3.5">
                <span className="text-[0.85rem] font-semibold text-[var(--text-primary)]">
                  {language.crmLabel}
                </span>
                <span className="ml-2 text-[0.78rem] text-[var(--text-muted)]">
                  the section this becomes in your nav
                </span>
              </div>
              <dl className="grid sm:grid-cols-2">
                {OBJECT_ORDER.map((key, i) => (
                  <div
                    key={key}
                    className={`px-5 py-4 ${
                      i >= 2 ? "border-t border-[color:var(--border-panel)]" : ""
                    } ${i % 2 === 1 ? "sm:border-l sm:border-[color:var(--border-panel)]" : ""}`}
                  >
                    <dt className="text-[0.9rem] font-semibold text-[var(--accent)]">
                      {language.crmObjects[key].label}
                    </dt>
                    <dd className="mt-1 text-[0.78rem] leading-relaxed text-[var(--text-muted)]">
                      generic name: {key}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/**
 * The persona block — also derived, from `personasForIndustry()`, which is the
 * function `seedDefaultPersonas` calls at onboarding. What is listed here is
 * literally what gets written into a new workspace.
 */
function PersonaBlock({ industry }: { industry: Industry }) {
  const personas = personasForIndustry(industry.industryKey);

  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <Reveal>
        <h2 className="font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
          The personas your workspace starts with
        </h2>
        <p className="mt-4 max-w-[62ch] text-[0.95rem] leading-relaxed text-[var(--text-secondary)]">
          Seeded on day one, with the message angle already written. Edit them,
          delete them, add your own — but you are not starting from an empty
          screen and a blinking cursor.
        </p>
      </Reveal>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {personas.map((persona, i) => (
          <Reveal key={persona.slug} delay={0.05 * i} className="h-full">
            <div className="flex h-full flex-col rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)] p-5">
              <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="text-[0.98rem] font-semibold text-[var(--text-primary)]">
                  {persona.name}
                </h3>
                <span className="rounded-full border border-[color:var(--border-panel)] px-2 py-px text-[0.65rem] font-medium text-[var(--text-muted)]">
                  {persona.segment}
                </span>
              </div>
              <p className="mt-2.5 text-[0.85rem] leading-relaxed text-[var(--text-secondary)]">
                {persona.audience}
              </p>
              <p className="mt-3 border-t border-[color:var(--border-panel)] pt-3 text-[0.85rem] leading-relaxed text-[var(--text-primary)]">
                {persona.angle}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

export function IndustryView({
  industry,
  signupOpen,
}: {
  industry: Industry;
  signupOpen: boolean;
}) {
  const ctaHref = signupOpen ? "/sign-up" : "/#waitlist";
  const ctaLabel = signupOpen ? "Start free trial" : "Join waitlist";
  const others = INDUSTRIES.filter((i) => i.slug !== industry.slug);

  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--text-primary)]">
      <SiteNav links={NAV_LINKS} ctaHref={ctaHref} ctaLabel={ctaLabel} homeHref="/" />

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-4 pt-36 sm:pt-40">
        <Reveal>
          <nav aria-label="Breadcrumb" className="mb-6 text-[0.82rem] text-[var(--text-muted)]">
            <Link
              href="/industries"
              className="underline-offset-4 hover:text-[var(--text-secondary)] hover:underline"
            >
              Industries
            </Link>
            <span className="px-2">/</span>
            <span className="text-[var(--text-secondary)]">{industry.shortLabel}</span>
          </nav>
          <h1 className="max-w-[19ch] font-serif text-[2.6rem] font-semibold leading-[1.08] text-[var(--text-primary)] sm:text-[3.3rem]">
            {industry.title}{" "}
            <span className="text-[var(--accent)]">{industry.titleAccent}</span>
          </h1>
          <p className="mt-6 max-w-[60ch] text-[1.02rem] leading-relaxed text-[var(--text-secondary)]">
            {industry.lede}
          </p>
        </Reveal>
      </section>

      {/* The situations. Deliberately not an equal 3-column row. */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <Reveal>
          <h2 className="font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
            Three things that are probably true right now
          </h2>
        </Reveal>
        <div className="mt-9 divide-y divide-[color:var(--border-panel)] border-y border-[color:var(--border-panel)]">
          {industry.situations.map((s, i) => (
            <Reveal key={s.title} delay={0.06 * i}>
              <div className="grid gap-2 py-6 sm:grid-cols-[0.8fr_1.5fr] sm:gap-10">
                <h3 className="font-serif text-lg font-semibold leading-snug text-[var(--text-primary)]">
                  {s.title}
                </h3>
                <p className="max-w-[66ch] text-[0.925rem] leading-relaxed text-[var(--text-secondary)]">
                  {s.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <VocabularyBlock industry={industry} />

      <PersonaBlock industry={industry} />

      {/* What Arc watches for */}
      <section className="border-y border-[color:var(--border-panel)] bg-[var(--canvas-deep)]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Reveal>
            <h2 className="font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
              What Arc watches for
            </h2>
            <p className="mt-4 max-w-[62ch] text-[0.95rem] leading-relaxed text-[var(--text-secondary)]">
              Every one of these arrives as an opportunity with its evidence
              attached, so you can see why Arc raised it before you decide
              anything.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {industry.signals.map((s, i) => (
              <Reveal key={s.title} delay={0.05 * i} className="h-full">
                <div className="h-full rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)] p-5">
                  <h3 className="text-[0.95rem] font-semibold text-[var(--text-primary)]">
                    {s.title}
                  </h3>
                  <p className="mt-2 text-[0.85rem] leading-relaxed text-[var(--text-secondary)]">
                    {s.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Worked example */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <Reveal>
            <h2 className="font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
              {industry.workedExample.title}
            </h2>
            <p className="mt-4 max-w-[40ch] text-[0.9rem] leading-relaxed text-[var(--text-muted)]">
              Written as what would happen, because it is what the product does —
              not a customer story we do not have yet.
            </p>
          </Reveal>
          <Reveal delay={0.08}>
            <ol className="space-y-5">
              {industry.workedExample.steps.map((step, i) => (
                <li key={step} className="flex gap-4">
                  <span className="mt-0.5 font-[family-name:var(--font-mono)] text-[0.75rem] tabular-nums text-[var(--accent)]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="max-w-[66ch] text-[0.925rem] leading-relaxed text-[var(--text-secondary)]">
                    {step}
                  </span>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </section>

      {/* The honesty note. Stages now arrive per-industry too, so this no longer
          apologises for them — but it must keep naming what genuinely is NOT
          configured on day one. The rule this page is built on is that nothing
          here may promise more than onboarding delivers. */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <Reveal>
          <div className="max-w-[74ch] rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)] p-6 sm:p-8">
            <h2 className="font-serif text-xl font-semibold text-[var(--text-primary)]">
              What you still set up yourself
            </h2>
            <p className="mt-3 text-[0.95rem] leading-relaxed text-[var(--text-secondary)]">
              The vocabulary, personas and pipeline stages above arrive
              configured — the stages as a starting set for {industry.trade},
              which you rename, reorder or add to in a couple of minutes if your
              process differs.
            </p>
            <p className="mt-3 text-[0.95rem] leading-relaxed text-[var(--text-secondary)]">
              What is genuinely yours to do: bring your records in, point Arc at
              your website so it learns your voice and proof points, and connect
              the channels you actually send through. Nothing goes out to a
              customer until you approve it.
            </p>
          </div>
        </Reveal>
      </section>

      {/* CTA */}
      <section className="border-t border-[color:var(--border-panel)] bg-[var(--canvas-deep)]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <Reveal className="flex flex-col items-start gap-7">
            <h2 className="max-w-[24ch] font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
              Nothing reaches a customer until you approve it.
            </h2>
            <p className="max-w-[58ch] text-[0.975rem] leading-relaxed text-[var(--text-secondary)]">
              Arc finds the opportunity, drafts the campaign, and prepares the
              creative. You decide what actually goes out — on every piece, with
              no setting that turns the gate off.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <GoldCta href={ctaHref}>{ctaLabel}</GoldCta>
              <GhostCta href="/pricing">See pricing</GhostCta>
            </div>
            <p className="text-[0.8rem] text-[var(--text-muted)]">
              This page was last reviewed on {formatReviewed(industry.lastReviewed)}.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Internal linking */}
      <section className="border-t border-[color:var(--border-panel)]">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <Reveal>
            <h2 className="font-serif text-2xl font-semibold text-[var(--text-primary)]">
              Other industries
            </h2>
          </Reveal>
          <div className="mt-7 grid gap-4 sm:grid-cols-3">
            {others.map((o, i) => (
              <Reveal key={o.slug} delay={0.06 * i}>
                <Link
                  href={`/industries/${o.slug}`}
                  className="group flex h-full flex-col rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)] p-5 transition-colors duration-200 hover:border-[color:color-mix(in_srgb,var(--accent)_40%,var(--border-panel))]"
                >
                  <span className="text-[0.95rem] font-semibold text-[var(--text-primary)]">
                    {o.shortLabel}
                  </span>
                  <span className="mt-1.5 text-[0.82rem] leading-relaxed text-[var(--text-muted)]">
                    {o.titleAccent}
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
