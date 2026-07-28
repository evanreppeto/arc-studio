"use client";

import Link from "next/link";

import { Reveal } from "@/app/landing/_components/reveal";

import { TRIAL_DAYS } from "./plans";

// Pricing-page objections specifically — the landing FAQ answers "what is this",
// this one answers "what am I agreeing to".
//
// Every answer is conservative about what ships TODAY. Where a capability is
// partial (channels other than email are export-and-send; a guided custom
// sending-domain setup isn't built yet) it says so rather than implying more.

function faqs(signupOpen: boolean): Array<{ q: string; a: React.ReactNode }> {
  return [
    {
      q: "How is monthly usage measured?",
      a: (
        <>
          By the work the agent actually does on your behalf — scanning for
          opportunities, drafting campaigns, generating creative, and answering
          you in chat. Higher plans include more of it. We measure the real
          work rather than promising &ldquo;N campaigns a month&rdquo;, because
          a one-line revision and a video render are nothing like the same
          amount of work and any single number would flatter one and punish the
          other. Your running total is visible in the app as it accrues, and
          where your plan lands is confirmed with you during onboarding.
        </>
      ),
    },
    {
      q: "What can the agent do without asking me?",
      a: (
        <>
          It can read your records, watch your signals, find opportunities, write
          drafts, and prepare creative. It cannot send, publish, post, or contact
          anyone. That boundary is structural, not a setting — there is no plan,
          toggle, or support request that moves it.
        </>
      ),
    },
    {
      q: "Do I pay per seat?",
      a: (
        <>
          No. Every plan has unlimited seats. Bring your whole team, plus the
          people who need to approve things — the approval gate only works if the
          approver is actually in the room.
        </>
      ),
    },
    {
      q: "Can I send from my own domain?",
      a: (
        <>
          You can connect your own email provider account today, and approved
          email sends through it. A guided setup for verifying a custom sending
          domain is still in progress — until it lands, that step involves us.
          For channels other than email, you export the approved deliverable and
          send it from the tool you already use.
        </>
      ),
    },
    {
      q: "Where does my data live, and who can see it?",
      a: (
        <>
          Your workspace is isolated at the database level, not just in the UI —
          one workspace cannot read another&rsquo;s records. What Arc learns from
          your campaigns stays in your workspace and improves your next campaign,
          not someone else&rsquo;s.
        </>
      ),
    },
    {
      q: "What happens to my data if I leave?",
      a: (
        <>
          You can export it, and we delete it on request. Cancelling doesn&rsquo;t
          destroy anything on its own: the workspace becomes read-only so you can
          still get to your history while you move. We don&rsquo;t hold your
          records hostage to a renewal.
        </>
      ),
    },
    {
      q: signupOpen ? "What happens when the trial ends?" : "Why is there a waitlist if pricing is published?",
      a: signupOpen ? (
        <>
          Your workspace goes read-only — everything stays visible, but the agent
          stops working and nothing goes outbound. Add a plan and it picks up
          exactly where it left off. Nothing is deleted when a trial lapses.
        </>
      ) : (
        <>
          Because publishing a price and opening the doors are different
          decisions. We&rsquo;re onboarding teams gradually so we can watch the
          first ones closely and fix what we find. The pricing above is what
          you&rsquo;ll be offered when your spot opens — no surprise at the end
          of the queue.
        </>
      ),
    },
    {
      q: "Can I change plans later?",
      a: (
        <>
          Yes, in either direction, from your workspace settings. If you need a
          limit that doesn&rsquo;t match a plan — higher volume, an agency
          running several brands — we can set a custom one;{" "}
          <Link href="/#waitlist" className="text-[var(--accent)] underline-offset-4 hover:underline">
            get in touch
          </Link>{" "}
          and we&rsquo;ll sort it out.
        </>
      ),
    },
  ];
}

export function PricingFaq({ signupOpen }: { signupOpen: boolean }) {
  const items = faqs(signupOpen);
  return (
    <section id="faq" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-24">
      <div className="grid items-start gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <Reveal className="lg:sticky lg:top-28">
          <h2 className="font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
            Before you decide
          </h2>
          <p className="mt-4 max-w-[42ch] text-[0.975rem] leading-relaxed text-[var(--text-secondary)]">
            The things worth knowing about what you&rsquo;re paying for — and
            where the product stops.
          </p>
          <div className="mt-7 flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden />
            <span className="font-[family-name:var(--font-mono)] text-[0.75rem] tracking-[0.02em] text-[var(--text-muted)]">
              {signupOpen ? `${TRIAL_DAYS} days, no card` : "Answers, not a sales call"}
            </span>
          </div>
        </Reveal>

        <div className="divide-y divide-[color:var(--border-panel)] border-t border-[color:var(--border-panel)]">
          {items.map((item, i) => (
            <Reveal key={item.q} delay={0.05 * i} y={14}>
              {/* Native <details>: works without JS, keyboard- and screen-reader
                  accessible for free. Same pattern as the landing FAQ. */}
              <details className="group">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-5 text-[1rem] font-medium text-[var(--text-primary)] transition-colors hover:text-[var(--accent)] [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span
                    className="mt-1 shrink-0 text-[var(--text-muted)] transition-transform duration-300 group-open:rotate-45"
                    aria-hidden
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </span>
                </summary>
                <p className="max-w-[62ch] pb-6 text-[0.925rem] leading-relaxed text-[var(--text-secondary)]">
                  {item.a}
                </p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
