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

const AUDIENCES = [
  {
    tag: "Solo",
    photo: "/brand/landing/who/solo.jpg",
    title: "You are the marketing team",
    body: "You own marketing between everything else you own. Arc does the legwork and leaves you the part only you can do: deciding.",
  },
  {
    tag: "In-house team",
    photo: "/brand/landing/who/team.jpg",
    title: "More pipeline than hours",
    body: "One or two marketers and a CRM full of signals nobody has time to work. Arc turns those records into specific, evidence-backed openings.",
  },
  {
    tag: "Agency",
    photo: "/brand/landing/who/agency.jpg",
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
                <figure className="group relative h-full overflow-hidden rounded-xl border border-[color:var(--border-panel)] transition-colors duration-300 hover:border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)]">
                  <div className="relative aspect-[16/10] sm:aspect-[16/11] lg:aspect-[16/7]">
                    <img
                      src={a.photo}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.04]"
                    />
                    {/* Scrim: the copy sits on the image like the ad units do. */}
                    <div className="absolute inset-0 bg-gradient-to-t from-[var(--canvas-deep)] via-[color:color-mix(in_srgb,var(--canvas-deep)_72%,transparent)] to-transparent" />
                    <span className="absolute left-5 top-5 inline-flex rounded-full border border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--canvas-deep)_70%,transparent)] px-2.5 py-0.5 font-[family-name:var(--font-mono)] text-[0.65rem] tracking-[0.02em] text-[var(--accent)] backdrop-blur-md">
                      {a.tag}
                    </span>
                    <figcaption className="absolute inset-x-0 bottom-0 p-6">
                      <h3 className="font-serif text-[1.4rem] font-semibold leading-snug text-[var(--text-primary)]">
                        {a.title}
                      </h3>
                      <p className="mt-2 max-w-[52ch] text-[0.9rem] leading-relaxed text-[var(--text-secondary)]">
                        {a.body}
                      </p>
                    </figcaption>
                  </div>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
