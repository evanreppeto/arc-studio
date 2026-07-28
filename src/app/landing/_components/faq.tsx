"use client";

import Link from "next/link";

import { Reveal } from "./reveal";

// The objections a skeptical visitor has before joining the waitlist. Every
// answer here is deliberately conservative about what Arc does today — the
// approval gate, evidence, workspace isolation and the export path are all
// shipped behavior, and the channel answer says plainly which one sends.
const FAQS: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "How is this different from asking ChatGPT to write my marketing?",
    a: (
      <>
        A chat window starts from a blank prompt. Arc starts from your records
        and your signals — it watches the CRM, finds the accounts worth acting
        on, and hands you a finished package with the evidence attached. You
        review decisions, not drafts of decisions. And every recommendation
        cites the records behind it, so you can check the reasoning instead of
        trusting it.
      </>
    ),
  },
  {
    q: "Can Arc email my customers without me seeing it first?",
    a: (
      <>
        No — and there is no setting that changes that. Every outbound piece
        passes through an explicit human approval, and approvals, revisions and
        sends are all recorded, so you can always answer &ldquo;why did this go
        out?&rdquo; It&rsquo;s the one rule the whole system is built around.
      </>
    ),
  },
  {
    q: "Do I have to move off the tools I already use?",
    a: (
      <>
        No. Arc can send approved email itself, and for everything else you can
        export an approved deliverable and send it from whatever you already
        run — your ESP, your ad manager, your scheduler. The gate travels with
        the work: only approved deliverables can be exported, no matter which
        tool ultimately sends them.
      </>
    ),
  },
  {
    q: "Which channels does Arc actually send today?",
    a: (
      <>
        Arc drafts complete packages across email, SMS, paid social and landing
        copy. Sending is wired end-to-end for <strong>email</strong>{" "}today; the
        other channels are export-and-send while we finish them. We&rsquo;d
        rather say that plainly than imply more than ships.
      </>
    ),
  },
  {
    q: "Who can see my data?",
    a: (
      <>
        Your workspace is isolated at the database level, not just in the UI —
        one workspace cannot read another&rsquo;s records. What Arc learns from
        your campaigns stays in your workspace and is used to make your next
        campaign better, not anyone else&rsquo;s.
      </>
    ),
  },
  {
    q: "What does it cost?",
    a: (
      <>
        Plans start at $99/month, flat per workspace with unlimited seats —{" "}
        <Link href="/pricing" className="text-[var(--accent)] underline-offset-4 hover:underline">
          see the full pricing
        </Link>
        . It&rsquo;s still a waitlist rather than a checkout because we&rsquo;re
        onboarding teams gradually while we get this right; the price you see is
        the one you&rsquo;ll be offered when your spot opens.
      </>
    ),
  },
  {
    q: "What happens after I join the waitlist?",
    a: (
      <>
        You&rsquo;ll get an email from us when a spot opens — not a drip
        sequence. When you&rsquo;re in, setup is connecting your channels and
        pointing Arc at your records; it starts by bringing you opportunities to
        review, so the first thing you see is work, not an empty dashboard.
      </>
    ),
  },
];

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-14 sm:py-28">
      <div className="grid items-start gap-8 sm:gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <Reveal className="lg:sticky lg:top-28">
          <h2 className="font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
            Questions worth asking
          </h2>
          <p className="mt-4 max-w-[42ch] text-[0.975rem] leading-relaxed text-[var(--text-secondary)]">
            Straight answers about what Arc does today — including where it
            stops.
          </p>
          <div className="mt-7 flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden />
            <span className="font-[family-name:var(--font-mono)] text-[0.75rem] tracking-[0.02em] text-[var(--text-muted)]">
              Still curious? Ask us when we reach out
            </span>
          </div>
        </Reveal>

        <div className="divide-y divide-[color:var(--border-panel)] border-t border-[color:var(--border-panel)]">
          {FAQS.map((item, i) => (
            <Reveal key={item.q} delay={0.05 * i} y={14}>
              {/* Native <details> so it works without JS and is keyboard- and
                  screen-reader-accessible for free. */}
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
