"use client";

import { Reveal } from "./reveal";

// Helps a visitor place themselves. Framed by situation rather than industry —
// Arc is vertical-agnostic (the creative desk below shows a roaster, a run club
// and a hotel), so the thing that actually predicts fit is who owns marketing
// and how much time they have. The three shapes mirror the account types the
// product actually supports at sign-up: in-house team, agency, solo.
const AUDIENCES = [
  {
    tag: "Solo",
    title: "You are the marketing team",
    body: "You own marketing between everything else you own. Arc does the legwork — watching for openings, drafting the campaign, preparing the creative — and leaves you the part only you can do: deciding.",
  },
  {
    tag: "In-house team",
    title: "More pipeline than hours",
    body: "One or two marketers and a CRM full of signals nobody has time to work. Arc turns those records into specific, evidence-backed opportunities so the week starts with drafts instead of a blank page.",
  },
  {
    tag: "Agency",
    title: "Several brands, one operator",
    body: "Each client gets its own workspace — its own voice, personas, approvals and audit trail. Arc scales the production work without blurring the brands together.",
  },
];

export function WhoItsFor() {
  return (
    <section id="who" className="border-y border-[color:var(--border-panel)] bg-[var(--canvas-deep)]">
      <div className="mx-auto max-w-6xl scroll-mt-24 px-6 py-24 sm:py-28">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <Reveal>
            <h2 className="font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
              Who Arc is for
            </h2>
            <p className="mt-4 max-w-[44ch] text-[0.975rem] leading-relaxed text-[var(--text-secondary)]">
              Not an industry — a situation. The same loop runs for a coffee
              roaster, a run club and a B2B software team. What matters is that
              someone owns marketing and doesn&rsquo;t have enough hours for it.
            </p>
            <div className="mt-7 rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)] p-5">
              <p className="text-[0.875rem] font-semibold text-[var(--text-primary)]">
                Who it isn&rsquo;t for
              </p>
              <p className="mt-1.5 max-w-[40ch] text-[0.85rem] leading-relaxed text-[var(--text-secondary)]">
                Anyone who wants marketing to run itself completely. Every send
                waits for a human, by design — if you&rsquo;re looking for full
                autopilot, that isn&rsquo;t what Arc does.
              </p>
            </div>
          </Reveal>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {AUDIENCES.map((a, i) => (
              <Reveal key={a.tag} delay={0.08 * i}>
                <div className="h-full rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)] p-6">
                  <span className="inline-flex rounded-full border border-[color:color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_10%,transparent)] px-2.5 py-0.5 font-[family-name:var(--font-mono)] text-[0.65rem] tracking-[0.02em] text-[var(--accent)]">
                    {a.tag}
                  </span>
                  <h3 className="mt-3 font-serif text-xl font-semibold leading-snug text-[var(--text-primary)]">
                    {a.title}
                  </h3>
                  <p className="mt-2 max-w-[58ch] text-[0.9rem] leading-relaxed text-[var(--text-secondary)]">
                    {a.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
