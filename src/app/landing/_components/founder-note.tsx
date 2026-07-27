"use client";

import { Reveal } from "./reveal";

// Pre-launch there are no customer logos or testimonials, and inventing them
// would be worse than having none. This is the honest substitute: the single
// conviction the product is built around, given the weight of a manifesto beat
// right before the closing ask.
//
// Unsigned by design — the copy makes no biographical claims, and every line
// states a design decision that is verifiable in the product itself.
export function FounderNote() {
  return (
    <section id="why" className="relative overflow-hidden border-y border-[color:var(--border-panel)] bg-[var(--canvas-deep)]">
      {/* One soft gold bloom so this reads as the page's closing statement
          rather than another body-copy block. Purely decorative. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 55% at 50% 0%, color-mix(in srgb, var(--accent) 9%, transparent) 0%, transparent 70%)",
        }}
        aria-hidden
      />

      <div className="relative mx-auto max-w-[46rem] scroll-mt-24 px-6 py-28 text-center sm:py-32">
        <Reveal>
          <div className="flex items-center justify-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden />
            <span className="font-[family-name:var(--font-mono)] text-[0.72rem] tracking-[0.04em] text-[var(--text-muted)]">
              Why Arc works this way
            </span>
          </div>

          <p className="mx-auto mt-8 max-w-[24ch] font-serif text-[2.1rem] font-semibold leading-[1.12] text-[var(--text-primary)] sm:text-[2.75rem]">
            It can&rsquo;t send anything{" "}
            <span className="text-[var(--accent)]">without you.</span>
          </p>

          <div className="mx-auto mt-9 max-w-[58ch] space-y-5 text-left sm:text-center">
            <p className="text-[1.02rem] leading-relaxed text-[var(--text-secondary)]">
              Most AI marketing tools pick one of two extremes. They write copy
              you end up rewriting, or they run on their own and put things in
              front of customers you never saw. The first isn&rsquo;t worth
              paying for. The second isn&rsquo;t worth the risk.
            </p>
            <p className="text-[1.02rem] leading-relaxed text-[var(--text-secondary)]">
              So Arc does the whole job and still stops. It watches your records,
              finds the openings, drafts the campaign, prepares the creative —
              and then waits. You approve, revise, or decline, and everything
              that happened is written down.
            </p>
          </div>

          <div className="mx-auto mt-10 flex max-w-[34rem] items-center gap-5">
            <span className="h-px flex-1 bg-[color:var(--border-panel)]" aria-hidden />
            <img src="/icon.png" alt="" className="h-7 w-auto shrink-0 opacity-90" />
            <span className="h-px flex-1 bg-[color:var(--border-panel)]" aria-hidden />
          </div>

          <p className="mt-6 font-serif text-[1.15rem] font-medium italic leading-snug text-[var(--text-primary)]">
            That gate is the product. Everything else exists to make the work
            waiting behind it good enough to approve.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
