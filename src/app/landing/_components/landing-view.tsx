"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";

import { AppWindow } from "./app-window";
import { GoldCta } from "./cta";
import { Faq } from "./faq";
import {
  FinalCta,
  HowItWorks,
  Intelligence,
  LandingFooter,
  TrustBand,
} from "./landing-sections";
import { ScrollSequence } from "./scroll-sequence";
import { WaitlistForm } from "./waitlist-form";
import { ShowcaseTabs } from "./showcase-tabs";
import { StudioShowcase } from "./studio-showcase";

const NAV_LINKS = [
  { href: "#product", label: "Product" },
  { href: "#how", label: "How it works" },
  { href: "#intelligence", label: "Intelligence" },
  { href: "#approvals", label: "Approvals" },
  { href: "#faq", label: "FAQ" },
];

function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 12));

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-[background-color,border-color,backdrop-filter] duration-300 ${
        scrolled
          ? "border-b border-[color:var(--border-panel)] bg-[color:color-mix(in_srgb,var(--canvas)_82%,transparent)] backdrop-blur-md"
          : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
        <a href="#top" className="flex items-center gap-2.5" aria-label="Arc Studio — back to top">
          <img src="/icon.png" alt="" className="h-7 w-auto" />
          <img src="/brand/arc-studio-wordmark.png" alt="Arc Studio" className="h-[1.15rem] w-auto" />
        </a>
        <nav className="hidden items-center gap-7 md:flex" aria-label="Page sections">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[0.875rem] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2.5">
          <Link
            href="/login"
            className="flex min-h-[38px] items-center rounded-lg px-3.5 text-[0.875rem] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            Sign in
          </Link>
          <GoldCta href="#waitlist" size="sm">
            Join waitlist
          </GoldCta>
        </div>
      </div>
    </header>
  );
}

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
            Storm-response campaign
          </span>
          <span className="rounded-full border border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)] px-2 py-0.5 text-[0.65rem] font-medium text-[var(--accent)]">
            Needs approval
          </span>
        </div>
        <p className="mt-1.5 text-[0.72rem] leading-relaxed text-[var(--text-muted)]">
          Drafted from a weather signal · email + SMS · evidence attached
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
    offset: ["start 95%", "start 35%"],
  });
  const rotateX = useTransform(scrollYProgress, [0, 1], [14, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.94, 1]);
  const opacity = useTransform(scrollYProgress, [0, 0.4], [0.55, 1]);

  return (
    <div ref={ref} className="relative mt-24 [perspective:1400px]">
      <motion.div style={reduced ? undefined : { rotateX, scale, opacity, transformOrigin: "center top" }}>
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
      <LandingNav />
      <Hero />
      <ScrollSequence />
      <ShowcaseTabs />
      <HowItWorks />
      <Intelligence />
      <StudioShowcase />
      <TrustBand />
      <Faq />
      <FinalCta />
      <LandingFooter />
    </main>
  );
}
