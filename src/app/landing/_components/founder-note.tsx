"use client";

import { Reveal } from "./reveal";

// Pre-launch there are no customer logos or testimonials to show, and inventing
// them would be worse than having none. This is the honest substitute: the
// conviction the product is actually built around, in the founder's voice.
//
// Deliberately contains no biographical claims — every sentence is about a
// design decision that is verifiable in the product itself.
export function FounderNote() {
  return (
    <section id="why" className="border-y border-[color:var(--border-panel)] bg-[var(--canvas-deep)]">
      <div className="mx-auto max-w-3xl scroll-mt-24 px-6 py-24 sm:py-28">
        <Reveal>
          <div className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden />
            <span className="font-[family-name:var(--font-mono)] text-[0.75rem] tracking-[0.02em] text-[var(--text-muted)]">
              A note from the founder
            </span>
          </div>

          <blockquote className="mt-7 space-y-5">
            <p className="font-serif text-[1.5rem] font-medium leading-snug text-[var(--text-primary)] sm:text-[1.75rem]">
              Arc is built on a rule that sounds like a limitation: it can&rsquo;t
              send anything without you.
            </p>
            <p className="text-[1rem] leading-relaxed text-[var(--text-secondary)]">
              Most AI marketing tools pick one of two extremes. They write copy
              you end up rewriting, or they run on their own and put things in
              front of customers you never saw. The first isn&rsquo;t worth
              paying for. The second isn&rsquo;t worth the risk.
            </p>
            <p className="text-[1rem] leading-relaxed text-[var(--text-secondary)]">
              So Arc does the whole job and still stops. It watches your records,
              finds the openings, drafts the campaign, prepares the creative —
              and then waits. You approve, revise, or decline, and everything
              that happened is written down.
            </p>
            <p className="text-[1rem] leading-relaxed text-[var(--text-secondary)]">
              That gate is the product. Everything else exists to make the work
              waiting behind it good enough to approve.
            </p>
          </blockquote>

          <figcaption className="mt-8 flex items-center gap-3">
            <img src="/icon.png" alt="" className="h-8 w-auto" />
            <span className="text-[0.9rem] text-[var(--text-secondary)]">
              <span className="font-medium text-[var(--text-primary)]">Evan Reppeto</span>
              <span className="text-[var(--text-muted)]"> · Founder, Arc Studio</span>
            </span>
          </figcaption>
        </Reveal>
      </div>
    </section>
  );
}
