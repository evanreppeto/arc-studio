"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";

import { AppWindow } from "./app-window";
import { Faq } from "./faq";
import { FounderNote } from "./founder-note";
import {
  FinalCta,
  HowItWorks,
  Intelligence,
  LandingFooter,
  TrustBand,
} from "./landing-sections";
import { ScrollSequence } from "./scroll-sequence";
import { SiteNav } from "./site-nav";
import { WaitlistForm } from "./waitlist-form";
import { ShowcaseTabs } from "./showcase-tabs";
import { StudioShowcase } from "./studio-showcase";
import { WhoItsFor } from "./who-its-for";

const NAV_LINKS = [
  { href: "#product", label: "Product" },
  { href: "#how", label: "How it works" },
  { href: "#intelligence", label: "Intelligence" },
  { href: "#approvals", label: "Approvals" },
  { href: "/pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

// The floating approval card: Arc's signature object, drifting gently over the
// hero's product screenshot. Reduced motion pins it in place.
function HeroApprovalCard() {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="pointer-events-none absolute -top-10 right-[-1.5rem] z-10 hidden w-[19rem] lg:block xl:right-[-3rem]"
      initial={reduced ? false : { opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ delay: 0.35, duration: 0.9, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <motion.div
        animate={reduced ? undefined : { y: [0, -9, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        className="rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-panel)_88%,transparent)] p-4 shadow-[0_32px_80px_-24px_rgba(0,0,0,0.85)] backdrop-blur-md"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.82rem] font-semibold text-[var(--text-primary)]">
            Pricing-intent campaign
          </span>
          <span className="rounded-full border border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)] px-2 py-0.5 text-[0.65rem] font-medium text-[var(--accent)]">
            Needs approval
          </span>
        </div>
        <p className="mt-1.5 text-[0.72rem] leading-relaxed text-[var(--text-muted)]">
          Drafted from a pricing-page surge · email + SMS · evidence attached
        </p>
        <div className="mt-3 flex items-center gap-2">
          <span className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[0.72rem] font-semibold text-[var(--on-accent)]">
            Approve
          </span>
          <span className="rounded-md border border-[color:var(--border-panel)] px-3 py-1.5 text-[0.72rem] font-medium text-[var(--text-secondary)]">
            Revise
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

// The hero's real product shot: a live capture of the demo workspace that
// straightens out of a slight perspective tilt as it scrolls into view.
function HeroProductShot() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 100%", "start 60%"],
  });
  // Resting state must look finished, not half-animated. The window used to
  // start at opacity 0.55 and a 14deg lean, so if the scroll value never
  // advanced — landing with it already in view, or a backgrounded tab that
  // froze the listener — it sat there washed out with the hero film showing
  // straight through it, reading as a rendering glitch. Now only a slight
  // tilt animates, it resolves as soon as the window is meaningfully in
  // view, and the shot is fully opaque at every point.
  const rotateX = useTransform(scrollYProgress, [0, 1], [7, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.975, 1]);

  return (
    <div ref={ref} className="relative mt-24 [perspective:1400px]">
      <motion.div style={reduced ? undefined : { rotateX, scale, transformOrigin: "center top" }}>
        <div className="relative">
          <HeroApprovalCard />
          <AppWindow
            src="/brand/landing/app/home.png"
            alt="The Arc home screen: waiting approvals, the top opportunity with evidence, live signals, and recent agent activity"
            title="arc — your workspace"
          />
        </div>
      </motion.div>
      {/* Ground the window into the next section */}
      <div className="pointer-events-none absolute inset-x-0 -bottom-1 h-32 bg-gradient-to-t from-[var(--canvas)] to-transparent" aria-hidden />
    </div>
  );
}

function Hero() {
  const reduced = useReducedMotion();
  const heroLoopRef = useRef<HTMLVideoElement>(null);
  const { scrollY } = useScroll();
  const artY = useTransform(scrollY, [0, 720], [0, 130]);
  const fadeOut = useTransform(scrollY, [0, 600], [1, 0.45]);

  // The hero's entrance is CSS (`.rise-in` + `.rise-d*` from globals.css), not
  // Motion. A JS-driven entrance server-renders the headline at opacity:0, so
  // on a slow connection the hero stays blank until the bundle hydrates —
  // measured at ~6.4s LCP on throttled 4G. CSS animates on first paint instead,
  // and the same stylesheet already disables it under reduced motion.
  return (
    <section id="top" className="relative overflow-hidden">
      {/* Higgsfield-generated molten-gold ribbon, parallaxed behind the
          headline. A single perfectly seamless loop (Kling start_image =
          end_image — first and last frames are the same pose, verified
          ~0.9/255 mean pixel diff), so there is no intro/loop handoff to
          see: it simply undulates forever. The poster is the loop's own
          frame 0, so first paint matches and there's no jump when playback
          begins. Reduced motion keeps the poster still. */}
      <motion.div
        className="pointer-events-none absolute inset-0"
        style={reduced ? undefined : { y: artY, opacity: fadeOut }}
        aria-hidden
      >
        <img
          src="/brand/landing/hero-wave-poster.jpg"
          alt=""
          className="h-full w-full object-cover"
        />
        {!reduced && (
          <motion.video
            ref={heroLoopRef}
            src="/brand/landing/hero-wave-loop.mp4"
            muted
            loop
            playsInline
            autoPlay
            preload="auto"
            className="absolute inset-0 h-full w-full object-cover"
            onViewportEnter={() => void heroLoopRef.current?.play().catch(() => {})}
            onViewportLeave={() => heroLoopRef.current?.pause()}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--canvas)]/90 via-[var(--canvas)]/30 to-[var(--canvas)]" />
      </motion.div>

      <div className="relative mx-auto flex max-w-6xl flex-col justify-center px-6 pb-10 pt-40">
        <h1
          className="rise-in rise-d1 max-w-[17ch] font-serif text-[2.9rem] font-semibold leading-[1.06] text-[var(--text-primary)] sm:text-[3.9rem] lg:text-[4.6rem]"
        >
          Marketing that runs itself.{" "}
          <span className="text-[var(--accent)]">Decisions that stay yours.</span>
        </h1>

        <p
          className="rise-in rise-d2 mt-7 max-w-[58ch] text-[1.05rem] leading-relaxed text-[var(--text-secondary)]"
        >
          Arc finds source-backed opportunities, drafts complete campaigns, and
          prepares the creative — then brings everything to you for approval.
          Nothing reaches a customer until you say so.
        </p>

        <div id="waitlist" className="rise-in rise-d3 mt-10 scroll-mt-28">
          <WaitlistForm source="landing-hero" />
          <p className="mt-4 text-[0.85rem] text-[var(--text-secondary)]">
            Already have a workspace?{" "}
            <Link href="/login" className="font-medium text-[var(--accent)] underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </div>

        <HeroProductShot />
      </div>
    </section>
  );
}

export function LandingView() {
  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--text-primary)]">
      <SiteNav links={NAV_LINKS} ctaHref="#waitlist" ctaLabel="Join waitlist" />
      <Hero />
      <ScrollSequence />
      <ShowcaseTabs />
      <WhoItsFor />
      <HowItWorks />
      <Intelligence />
      <StudioShowcase />
      <TrustBand />
      <Faq />
      <FounderNote />
      <FinalCta />
      <LandingFooter />
    </main>
  );
}
