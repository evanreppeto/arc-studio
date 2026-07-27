"use client";

import { Reveal } from "./reveal";

// Helps a visitor place themselves. Framed by situation rather than industry —
// Arc is vertical-agnostic (the creative desk below shows a roaster, a run club
// and a hotel), so the thing that actually predicts fit is who owns marketing
// and how much time they have. The three shapes mirror the account types the
// product actually supports at sign-up: in-house team, agency, solo.
//
// Each card leads with a fragment of the actual product rather than an
// illustration: the argument for "this is for you" is more convincing shown
// than described, which is why the product tour and creative desk land.

/** Solo: Arc worked while you were doing the job. */
function QueueFragment() {
  const rows = [
    ["High-intent follow-up — email", "2h"],
    ["Customer next-step adoption — social", "9h"],
    ["Win-back sequence — email", "16h"],
  ] as const;
  return (
    <div className="space-y-1.5">
      {rows.map(([label, when]) => (
        <div
          key={label}
          className="flex items-center gap-2.5 rounded-lg border border-[color:var(--border-panel)] bg-[var(--surface-inset)] px-3 py-2"
        >
          <span className="shrink-0 rounded-full border border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)] px-2 py-px text-[0.6rem] font-medium text-[var(--accent)]">
            Needs you
          </span>
          <span className="min-w-0 flex-1 truncate text-[0.78rem] text-[var(--text-primary)]">{label}</span>
          <span className="shrink-0 font-[family-name:var(--font-mono)] text-[0.62rem] text-[var(--text-muted)]">
            {when}
          </span>
        </div>
      ))}
      <p className="pt-1 font-[family-name:var(--font-mono)] text-[0.62rem] text-[var(--text-muted)]">
        3 waiting · drafted while you were on the job
      </p>
    </div>
  );
}

/** In-house team: a record turned into a specific, evidenced opportunity. */
function OpportunityFragment() {
  return (
    <div className="rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_28%,transparent)] bg-[var(--surface-inset)] p-3.5">
      <p className="font-[family-name:var(--font-mono)] text-[0.58rem] tracking-[0.14em] text-[var(--accent)]">
        TOP OPPORTUNITY
      </p>
      <p className="mt-2 font-serif text-[0.95rem] font-semibold leading-snug text-[var(--text-primary)]">
        New lead returned to the pricing page three times
      </p>
      <div className="mt-3 flex items-center gap-2">
        <span className="font-[family-name:var(--font-mono)] text-[0.58rem] tracking-[0.08em] text-[var(--text-muted)]">
          EVIDENCE
        </span>
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className="flex h-4 w-4 items-center justify-center rounded border border-[color:var(--border-panel)] font-[family-name:var(--font-mono)] text-[0.58rem] text-[var(--text-secondary)]"
          >
            {n}
          </span>
        ))}
        <span className="ml-auto font-[family-name:var(--font-mono)] text-[0.62rem] text-[var(--accent)]">91%</span>
      </div>
    </div>
  );
}

/** Agency: one operator, several client workspaces, kept apart. */
function WorkspacesFragment() {
  const clients = [
    ["NR", "Northline Roasting", "4 waiting"],
    ["KR", "Kestrel Run Club", "2 waiting"],
    ["CE", "Cove & Ember Hotel", "1 waiting"],
  ] as const;
  return (
    <div className="space-y-1.5">
      {clients.map(([initials, name, waiting], i) => (
        <div
          key={name}
          className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${
            i === 0
              ? "border-[color:color-mix(in_srgb,var(--accent)_38%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_7%,transparent)]"
              : "border-[color:var(--border-panel)] bg-[var(--surface-inset)]"
          }`}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_10%,transparent)] font-[family-name:var(--font-mono)] text-[0.55rem] text-[var(--accent)]">
            {initials}
          </span>
          <span className="min-w-0 flex-1 truncate text-[0.78rem] text-[var(--text-primary)]">{name}</span>
          <span className="shrink-0 font-[family-name:var(--font-mono)] text-[0.62rem] text-[var(--text-muted)]">
            {waiting}
          </span>
        </div>
      ))}
      <p className="pt-1 font-[family-name:var(--font-mono)] text-[0.62rem] text-[var(--text-muted)]">
        separate voice, personas and audit trail each
      </p>
    </div>
  );
}

const AUDIENCES = [
  {
    tag: "Solo",
    fragment: <QueueFragment />,
    title: "You are the marketing team",
    body: "You own marketing between everything else you own. Arc does the legwork and leaves you the part only you can do: deciding.",
  },
  {
    tag: "In-house team",
    fragment: <OpportunityFragment />,
    title: "More pipeline than hours",
    body: "One or two marketers and a CRM full of signals nobody has time to work. Arc turns those records into specific, evidence-backed openings.",
  },
  {
    tag: "Agency",
    fragment: <WorkspacesFragment />,
    title: "Several brands, one operator",
    body: "Each client gets its own workspace. Arc scales the production work without blurring the brands together.",
  },
];

export function WhoItsFor() {
  return (
    <section id="who" className="border-y border-[color:var(--border-panel)] bg-[var(--canvas-deep)]">
      <div className="mx-auto max-w-6xl scroll-mt-24 px-6 py-24 sm:py-28">
        <div className="grid items-start gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <Reveal className="lg:sticky lg:top-28">
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
                <div className="group flex h-full flex-col overflow-hidden rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)] transition-colors duration-300 hover:border-[color:color-mix(in_srgb,var(--accent)_38%,transparent)]">
                  {/* A fragment of the real product, not an illustration. */}
                  <div className="border-b border-[color:var(--border-panel)] bg-[color:color-mix(in_srgb,var(--canvas-deep)_55%,transparent)] p-4">
                    {a.fragment}
                  </div>
                  <div className="p-6">
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
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
