"use client";

import { Reveal } from "./reveal";

// Helps a visitor place themselves. Framed by situation rather than industry —
// Arc is vertical-agnostic (the creative desk below shows a roaster, a run club
// and a hotel), so the thing that actually predicts fit is who owns marketing
// and how much time they have. The three shapes mirror the account types the
// product actually supports at sign-up: solo, in-house team, agency.
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
    body: "One or two marketers and a CRM full of signals nobody has time to work. Arc turns those records into evidence-backed openings.",
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
      <div className="mx-auto max-w-6xl scroll-mt-24 px-6 py-14 sm:py-28">
        {/* Header reads across the top so the three cards can take the full
            width below. Stacked in a side column they read as a list and made
            the section roughly twice as tall as it needed to be. */}
        <Reveal>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
            <h2 className="max-w-[16ch] font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
              Who Arc is for
            </h2>
            <p className="max-w-[52ch] text-[0.975rem] leading-relaxed text-[var(--text-secondary)] lg:text-right">
              Not an industry — a situation. The same loop runs for a coffee
              roaster, a run club and a B2B software team. What matters is that
              someone owns marketing and doesn&rsquo;t have enough hours for it.
            </p>
          </div>
        </Reveal>

        <div className="mt-8 grid gap-5 sm:mt-12 sm:grid-cols-2 lg:grid-cols-3">
          {AUDIENCES.map((a, i) => (
            <Reveal key={a.tag} delay={0.09 * i}>
              {/* Two card shapes, one markup.
                  From sm up the photo sits above the copy — the full-width row
                  this section is built around, where a tall crop is the point.
                  Below sm the three cards stack, and photo-above-copy makes each
                  one ~361px; three of those added ~660px to the phone page. So
                  on mobile the caption goes back over the image (absolute →
                  static at sm), which is how this section read before and costs
                  only the photo's height. */}
              <figure className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)] transition-colors duration-300 hover:border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)]">
                <div className="relative aspect-[5/4] overflow-hidden sm:aspect-[4/3]">
                  <img
                    src={a.photo}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.05]"
                  />
                  {/* Mobile carries text on the image, so it needs a real scrim;
                      from sm up the original soft blend into the panel returns. */}
                  <div className="absolute inset-0 bg-gradient-to-t from-[var(--surface-panel)] via-[color:color-mix(in_srgb,var(--surface-panel)_70%,transparent)] to-transparent sm:via-transparent" />
                  <span className="absolute left-4 top-4 inline-flex rounded-full border border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--canvas-deep)_72%,transparent)] px-2.5 py-0.5 font-[family-name:var(--font-mono)] text-[0.65rem] tracking-[0.02em] text-[var(--accent)] backdrop-blur-md">
                    {a.tag}
                  </span>
                </div>
                <figcaption className="absolute inset-x-0 bottom-0 flex flex-col p-5 sm:static sm:flex-1 sm:p-6 sm:pt-5">
                  <h3 className="font-serif text-[1.3rem] font-semibold leading-snug text-[var(--text-primary)]">
                    {a.title}
                  </h3>
                  <p className="mt-2 text-[0.9rem] leading-relaxed text-[var(--text-secondary)] sm:mt-2.5">
                    {a.body}
                  </p>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>

        {/* The honest note sits under the row as a single quiet line rather than
            a fourth box competing with the cards. */}
        <Reveal delay={0.2}>
          <div className="mt-8 flex flex-col gap-2 border-t sm:mt-10 border-[color:var(--border-panel)] pt-6 sm:flex-row sm:items-baseline sm:gap-5">
            <p className="shrink-0 font-[family-name:var(--font-mono)] text-[0.72rem] tracking-[0.02em] text-[var(--accent)]">
              Who it isn&rsquo;t for
            </p>
            <p className="max-w-[70ch] text-[0.9rem] leading-relaxed text-[var(--text-secondary)]">
              Anyone who wants marketing to run itself completely. Every send
              waits for a human, by design — if you&rsquo;re looking for full
              autopilot, that isn&rsquo;t what Arc does.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
