"use client";

import { useState } from "react";
import Link from "next/link";

import { GhostCta, GoldCta } from "@/app/landing/_components/cta";
import { LandingFooter } from "@/app/landing/_components/landing-sections";
import { Reveal } from "@/app/landing/_components/reveal";
import { SiteNav } from "@/app/landing/_components/site-nav";

import {
  PRICING_PLANS,
  TRIAL_DAYS,
  allowanceUsd,
  annualPerMonthUsd,
  type PricingPlan,
} from "./plans";
import { PricingFaq } from "./pricing-faq";

const NAV_LINKS = [
  { href: "/#product", label: "Product" },
  { href: "/#how", label: "How it works" },
  { href: "/#approvals", label: "Approvals" },
  { href: "/pricing", label: "Pricing" },
];

function Check() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="mt-[0.15rem] h-4 w-4 shrink-0 text-[var(--accent)]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function PlanCard({
  plan,
  annual,
  ctaHref,
  ctaLabel,
}: {
  plan: PricingPlan;
  annual: boolean;
  ctaHref: string;
  ctaLabel: string;
}) {
  const price = annual ? annualPerMonthUsd(plan) : plan.monthlyUsd;
  const Cta = plan.featured ? GoldCta : GhostCta;

  return (
    // Hover: the card lifts and its border warms toward gold, on the same long
    // ease the landing page uses. Three things worth knowing before editing:
    //
    // - Borders rely on #651, which moved globals.css's universal
    //   `* { border-color: ... }` into @layer base. While it sat unlayered it
    //   beat every @layer utilities rule regardless of specificity, so these
    //   border classes silently never applied — Pro's accent border was
    //   declared but never drawn. If a bare `border-color` rule ever escapes a
    //   layer again, this is the first place it will show.
    // - Tailwind v4 applies the lift via the standalone `translate` property,
    //   so the reduced-motion guard must be `translate-none`; `transform-none`
    //   would not cancel it.
    // - No `group` here on purpose: GoldCta/GhostCta are themselves groups and
    //   drive their sheen and arrow off `group-hover`, so a group on the card
    //   makes the button animate whenever the pointer is anywhere on the card.
    <div
      className={`relative flex h-full flex-col rounded-2xl border p-7 transition-[translate,border-color,box-shadow] duration-300 ease-out hover:-translate-y-1 motion-reduce:translate-none ${
        plan.featured
          ? "border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-panel)_92%,var(--accent))] shadow-[0_28px_70px_-30px_rgba(200,162,74,0.45)] hover:border-[color:color-mix(in_srgb,var(--accent)_80%,transparent)] hover:shadow-[0_34px_80px_-28px_rgba(200,162,74,0.55)] lg:-my-4 lg:py-11"
          : "border-[color:var(--border-panel)] bg-[var(--surface-panel)] hover:border-[color:color-mix(in_srgb,var(--accent)_50%,transparent)] hover:shadow-[0_24px_60px_-28px_rgba(0,0,0,0.85)]"
      }`}
    >
      {plan.featured && (
        <span className="absolute -top-3 left-7 rounded-full border border-[color:color-mix(in_srgb,var(--accent)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_16%,var(--canvas))] px-3 py-1 text-[0.68rem] font-medium text-[var(--accent)]">
          Most teams start here
        </span>
      )}

      <h3 className="font-serif text-[1.5rem] font-semibold text-[var(--text-primary)]">{plan.name}</h3>
      <p className="mt-1.5 text-[0.9rem] leading-relaxed text-[var(--text-secondary)]">{plan.tagline}</p>

      <div className="mt-6 flex items-baseline gap-1.5">
        <span className="font-[family-name:var(--font-mono)] text-[2.6rem] font-semibold leading-none tracking-tight text-[var(--text-primary)] tabular-nums">
          ${price}
        </span>
        <span className="text-[0.9rem] text-[var(--text-muted)]">/ month</span>
      </div>
      <p className="mt-2 text-[0.8rem] text-[var(--text-muted)]">
        {annual ? "Billed annually · two months free" : "Billed monthly · cancel anytime"}
      </p>

      <div className="mt-6 rounded-lg border border-[color:var(--border-panel)] bg-[var(--surface-inset)] px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[0.8rem] text-[var(--text-secondary)]">Included agent work</span>
          <span className="font-[family-name:var(--font-mono)] text-[0.95rem] font-semibold text-[var(--text-primary)] tabular-nums">
            ${allowanceUsd(plan.tier)}/mo
          </span>
        </div>
        <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--text-muted)]">
          What the agent can spend on your behalf each month. You see the running
          total, and nothing is charged beyond your plan.
        </p>
      </div>

      <ul className="mt-6 flex flex-1 flex-col gap-2.5">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-[0.875rem] leading-relaxed text-[var(--text-secondary)]">
            <Check />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <p className="mt-6 border-t border-[color:var(--border-panel)] pt-4 text-[0.8rem] leading-relaxed text-[var(--text-muted)]">
        {plan.bestFor}
      </p>

      <div className="mt-5">
        <Cta href={ctaHref}>{ctaLabel}</Cta>
      </div>
    </div>
  );
}

function BillingToggle({ annual, onChange }: { annual: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      role="group"
      aria-label="Billing period"
      className="inline-flex items-center gap-1 rounded-lg border border-[color:var(--border-panel)] bg-[var(--surface-inset)] p-1"
    >
      {[
        { label: "Monthly", value: false },
        { label: "Annual", value: true },
      ].map((opt) => (
        <button
          key={opt.label}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={annual === opt.value}
          className={`min-h-[38px] rounded-md px-4 text-[0.85rem] font-medium transition-colors ${
            annual === opt.value
              ? "bg-[var(--accent)] text-[var(--on-accent)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function PricingView({ signupOpen }: { signupOpen: boolean }) {
  const [annual, setAnnual] = useState(false);

  // Sign-up is closed until self-serve opens, so the CTA has to be honest about
  // what actually happens when it's clicked. One flag flips the whole page.
  const ctaHref = signupOpen ? "/sign-up" : "/#waitlist";
  const ctaLabel = signupOpen ? `Start ${TRIAL_DAYS}-day trial` : "Join the waitlist";

  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--text-primary)]">
      <SiteNav links={NAV_LINKS} ctaHref={ctaHref} ctaLabel={ctaLabel} homeHref="/" />

      <section className="mx-auto max-w-6xl px-6 pb-4 pt-36 sm:pt-40">
        <Reveal>
          <h1 className="max-w-[20ch] font-serif text-[2.6rem] font-semibold leading-[1.08] text-[var(--text-primary)] sm:text-[3.3rem]">
            Priced for the work it does.{" "}
            <span className="text-[var(--accent)]">Never for the sends you didn&rsquo;t approve.</span>
          </h1>
          <p className="mt-6 max-w-[56ch] text-[1.02rem] leading-relaxed text-[var(--text-secondary)]">
            Every plan includes the whole system — the CRM, the personas, the
            approval gate, the history. What changes is how much work the agent
            does for you each month.
          </p>
        </Reveal>

        <Reveal delay={0.08} className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
          <BillingToggle annual={annual} onChange={setAnnual} />
          <span className="text-[0.85rem] text-[var(--text-muted)]">
            {signupOpen
              ? `${TRIAL_DAYS}-day trial · no card required`
              : "Sign-up is invite-only while we onboard gradually"}
          </span>
        </Reveal>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid items-stretch gap-6 lg:grid-cols-3">
          {PRICING_PLANS.map((plan, i) => (
            <Reveal key={plan.tier} delay={0.06 * i} className="h-full">
              <PlanCard plan={plan} annual={annual} ctaHref={ctaHref} ctaLabel={ctaLabel} />
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.2}>
          <p className="mt-7 max-w-[70ch] text-[0.85rem] leading-relaxed text-[var(--text-muted)]">
            Every plan has unlimited seats. We don&rsquo;t charge per person —
            marketing is a team sport and billing your colleagues out of the room
            makes the product worse.
          </p>
        </Reveal>
      </section>

      <LimitsSection />
      <PricingFaq signupOpen={signupOpen} />
      <FinalCta ctaHref={ctaHref} ctaLabel={ctaLabel} signupOpen={signupOpen} />
      <LandingFooter />
    </main>
  );
}

// The question every usage-priced product dodges. Answering it plainly is worth
// more than another feature column.
function LimitsSection() {
  const items = [
    {
      title: "You see it coming",
      body: "Your running total sits in the app, not in a monthly invoice surprise. We warn you well before you reach the limit — not at it.",
    },
    {
      title: "Nothing is deleted, ever",
      body: "Reaching your limit pauses new agent work. Your records, campaigns, and history stay exactly where they are and stay readable.",
    },
    {
      title: "Nothing outbound changes",
      body: "The approval gate is not a paid feature and never becomes one. Nothing reaches a customer without you, on any plan, at any usage level.",
    },
  ];

  return (
    <section className="border-y border-[color:var(--border-panel)] bg-[var(--canvas-deep)]">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <Reveal>
          <h2 className="font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
            What happens when you hit the limit
          </h2>
          <p className="mt-4 max-w-[58ch] text-[0.975rem] leading-relaxed text-[var(--text-secondary)]">
            Usage-based pricing is only fair if the edges are predictable. Here
            are ours, before you need them.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, i) => (
            <Reveal key={item.title} delay={0.06 * i} y={16}>
              <div className="flex items-center gap-2.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden />
                <h3 className="text-[1rem] font-semibold text-[var(--text-primary)]">{item.title}</h3>
              </div>
              <p className="mt-3 max-w-[46ch] text-[0.9rem] leading-relaxed text-[var(--text-secondary)]">
                {item.body}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta({
  ctaHref,
  ctaLabel,
  signupOpen,
}: {
  ctaHref: string;
  ctaLabel: string;
  signupOpen: boolean;
}) {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <Reveal className="flex flex-col items-start gap-7">
        <h2 className="max-w-[24ch] font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
          See it work on your own records first.
        </h2>
        <p className="max-w-[54ch] text-[0.975rem] leading-relaxed text-[var(--text-secondary)]">
          {signupOpen
            ? `Start the ${TRIAL_DAYS}-day trial without a card. Point Arc at your records and judge it on the first opportunity it brings you.`
            : "We're onboarding teams gradually while we get this right. Join the waitlist and you'll hear from us when a spot opens."}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <GoldCta href={ctaHref}>{ctaLabel}</GoldCta>
          <Link
            href="/#product"
            className="min-h-[48px] px-2 text-[0.9rem] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            See what Arc does
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
