"use client";

import { useRef } from "react";
import { motion, useReducedMotion } from "motion/react";

import { Reveal } from "./reveal";

// The creative desk: draft creative from three different practice workspaces —
// a roaster, a run club, a coastal hotel — shown the way the app reviews it:
// finished ad units with copy, format, provenance, and approval state. Arc is
// tenant-agnostic and the creative should look it. The 9:16 story is a
// Higgsfield-animated cinemagraph.
const CAMPAIGN_ASSETS = [
  {
    key: "feed",
    src: "/brand/landing/studio/asset-coffee-4x5.jpg",
    alt: "Draft 4:5 feed ad for a coffee roaster: espresso pouring into a ceramic cup with the headline “Mornings, taken seriously.”",
    format: "4:5",
    channel: "Feed",
    ratio: "aspect-[4/5]",
    span: "",
    delay: 0,
    brand: "Northline Roasting Co.",
    headline: "Mornings, taken seriously.",
    body: "Single-origin roasts, shipped the week they leave the drum.",
    cta: "Find your roast",
    variant: "craft" as const,
  },
  {
    key: "paid",
    src: "/brand/landing/studio/asset-run-1x1.jpg",
    alt: "Draft 1:1 paid-social ad for a run club: a lone runner crossing an empty bridge at dawn with the headline “The city is quietest at 6 a.m. Take it.”",
    format: "1:1",
    channel: "Paid social",
    ratio: "aspect-square",
    span: "lg:mt-14",
    delay: 0.12,
    brand: "Kestrel Run Club",
    headline: "The city is quietest at 6 a.m.",
    body: "Group runs every weekday. Every pace welcome.",
    cta: "Claim your lane",
    variant: "athletic" as const,
  },
  {
    key: "story",
    src: "/brand/landing/studio/asset-pool-9x16.jpg",
    video: "/brand/landing/studio/asset-pool-9x16.mp4",
    alt: "Draft 9:16 story ad for a coastal hotel: an infinity pool at dusk with the headline “Out of office. Into the water.”",
    format: "9:16",
    channel: "Story",
    ratio: "aspect-[16/10] lg:aspect-[9/16]",
    span: "col-span-2 lg:col-span-1 lg:mt-7",
    delay: 0.24,
    brand: "Cove & Ember Hotel",
    headline: "Out of office.",
    body: "",
    cta: "Book the escape",
    variant: "luxury" as const,
  },
];

function StoryVideo({ src, poster, alt }: { src: string; poster: string; alt: string }) {
  const reduced = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  if (reduced) {
    return <img src={poster} alt={alt} loading="lazy" className="h-full w-full object-cover" />;
  }
  return (
    <motion.video
      ref={videoRef}
      className="h-full w-full object-cover"
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
      aria-label={alt}
      onViewportEnter={() => void videoRef.current?.play().catch(() => {})}
      onViewportLeave={() => videoRef.current?.pause()}
      viewport={{ margin: "80px" }}
    />
  );
}

export function StudioShowcase() {
  return (
    <section id="studio" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-14 sm:py-28">
      <Reveal>
        <h2 className="max-w-[22ch] font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
          Creative that shows up ready for review
        </h2>
        <p className="mt-3 max-w-[62ch] text-[0.975rem] leading-relaxed text-[var(--text-secondary)]">
          Whatever the business — a roaster, a run club, a hotel — Arc hands
          creative over finished: ad units in every format the channels want,
          copy written in the brand’s voice, provenance tagged, and locked
          behind your approval.
        </p>
      </Reveal>

      {/* Campaign header, the way the campaigns queue frames a package */}
      <Reveal delay={0.08}>
        <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[color:var(--border-panel)] pb-4">
          <span className="text-[0.95rem] font-semibold text-[var(--text-primary)]">Draft creative</span>
          <span className="font-[family-name:var(--font-mono)] text-[0.78rem] sm:text-[0.68rem] text-[var(--text-muted)]">
            3 workspaces · 3 formats
          </span>
          <span className="ml-auto rounded-full border border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)] px-2.5 py-0.5 text-[0.65rem] font-medium text-[var(--accent)]">
            0 of 3 approved
          </span>
        </div>
      </Reveal>

      <div className="mt-10 grid grid-cols-2 items-start gap-4 sm:gap-6 lg:grid-cols-[1.05fr_1fr_0.62fr]">
        {CAMPAIGN_ASSETS.map((asset) => (
          <Reveal key={asset.key} delay={asset.delay} className={asset.span}>
            <figure className="group overflow-hidden rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)] shadow-[0_28px_70px_-30px_rgba(0,0,0,0.85)]">
              <div className={`relative overflow-hidden ${asset.ratio}`}>
                {asset.video ? (
                  <StoryVideo src={asset.video} poster={asset.src} alt={asset.alt} />
                ) : (
                  <img
                    src={asset.src}
                    alt={asset.alt}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.035]"
                  />
                )}

                <span className={`absolute top-3 rounded-full border border-[color:color-mix(in_srgb,var(--text-primary)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--canvas-deep)_72%,transparent)] px-2.5 py-1 font-[family-name:var(--font-mono)] text-[0.62rem] text-[var(--text-secondary)] backdrop-blur-md ${asset.variant === "athletic" ? "right-3" : "left-3"}`}>
                  {asset.video ? "AI video · Higgsfield" : "AI-generated · Higgsfield"}
                </span>

                {/* Each ad wears its own brand's design language — the point is
                    that Arc drafts in the workspace's voice, not a template. */}
                {asset.variant === "craft" && (
                  <div className="absolute inset-0 flex flex-col justify-end text-center">
                    <div className="w-full bg-gradient-to-t from-black/80 via-black/40 to-transparent px-5 pb-6 pt-12">
                      <p className="mb-2 text-[0.6rem] font-medium uppercase tracking-[0.34em] text-[#f3e9d7]/75">
                        Northline · Roasting · Co.
                      </p>
                      <p className="font-serif text-[1.5rem] font-medium italic leading-tight text-[#f6eddc]">
                        {asset.headline}
                      </p>
                      <p className="mx-auto mt-1.5 max-w-[26ch] text-[0.72rem] leading-relaxed text-[#f3e9d7]/70">
                        {asset.body}
                      </p>
                      <span className="mt-3 inline-block border-b border-[#e8c87e] pb-0.5 text-[0.78rem] font-medium tracking-[0.04em] text-[#e8c87e]">
                        {asset.cta} →
                      </span>
                    </div>
                  </div>
                )}
                {asset.variant === "athletic" && (
                  <div className="absolute inset-0">
                    <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/75 via-black/30 to-transparent px-4 pb-14 pt-4">
                      <p className="font-[family-name:var(--font-display)] text-[1.6rem] font-bold uppercase leading-[1.02] tracking-[-0.01em] text-white">
                        The city is
                        <br />
                        quietest at 6 a.m.
                      </p>
                      <p className="mt-0.5 font-[family-name:var(--font-display)] text-[1.6rem] font-bold uppercase italic leading-none text-[#ffb43a]">
                        Take it.
                      </p>
                    </div>
                    <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/70 to-transparent p-4">
                      <p className="text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-white/80">
                        Kestrel
                        <br />
                        Run Club
                      </p>
                      <span className="inline-flex rounded-full bg-white px-3.5 py-1.5 text-[0.7rem] font-bold uppercase tracking-[0.06em] text-black">
                        {asset.cta}
                      </span>
                    </div>
                  </div>
                )}
                {asset.variant === "luxury" && (
                  <div className="absolute inset-x-0 bottom-0 flex flex-col items-center bg-gradient-to-t from-black/75 via-black/35 to-transparent px-4 pb-6 pt-16 text-center">
                    <p className="flex w-full items-center justify-center gap-3 text-[0.58rem] font-medium uppercase tracking-[0.4em] text-white/70">
                      <span className="h-px w-8 bg-white/30" aria-hidden />
                      Cove &amp; Ember
                      <span className="h-px w-8 bg-white/30" aria-hidden />
                    </p>
                    <p className="mt-3 font-serif text-[1.5rem] font-normal leading-snug text-white">
                      Out of office.
                      <br />
                      <span className="italic">Into the water.</span>
                    </p>
                    <span className="mt-4 inline-flex rounded-full border border-white/60 px-4 py-1.5 text-[0.7rem] font-medium tracking-[0.08em] text-white">
                      {asset.cta}
                    </span>
                  </div>
                )}
              </div>
              <figcaption className="flex items-center justify-between gap-3 border-t border-[color:var(--border-panel)] px-3.5 py-2.5">
                <span className="font-[family-name:var(--font-mono)] text-[0.65rem] text-[var(--text-muted)]">
                  {asset.format} · {asset.channel}
                </span>
                <span className="rounded-full border border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)] px-2.5 py-0.5 text-[0.65rem] font-medium text-[var(--accent)]">
                  Needs review
                </span>
              </figcaption>
            </figure>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.2}>
        <p className="mt-8 font-[family-name:var(--font-mono)] text-[0.72rem] text-[var(--text-muted)]">
          Practice campaigns from demo workspaces — every asset records its source, model, prompt, and reviewer.
        </p>
      </Reveal>
    </section>
  );
}
