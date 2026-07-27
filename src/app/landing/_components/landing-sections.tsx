"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";

import { Constellation } from "./constellation";
import { Reveal } from "./reveal";
import { WaitlistForm } from "./waitlist-form";

// ————— How it works: a week with Arc, told as the app's own activity feed —————

const STEPS = [
  {
    number: "01",
    title: "Arc scouts",
    body: "Watches your CRM, weather signals, and engagement data — files opportunities with evidence.",
  },
  {
    number: "02",
    title: "Arc drafts",
    body: "Assembles the whole campaign package, every asset tagged with where it came from.",
  },
  {
    number: "03",
    title: "You approve",
    body: "One gate for everything outbound. The system records the decision and learns either way.",
  },
];

type TimelineTone = "gold" | "ivory" | "green" | "gray";

const WEEK: Array<{
  day: string;
  actor: "Arc" | "You";
  title: string;
  detail: string;
  status: string;
  tone: TimelineTone;
}> = [
  {
    day: "MON",
    actor: "Arc",
    title: "Filed 3 opportunities from live signals",
    detail: "Pricing-page surge · 14 accounts gone quiet · reply spike",
    status: "Evidence attached",
    tone: "gray",
  },
  {
    day: "TUE",
    actor: "Arc",
    title: "Drafted the Pricing-Intent Fast Track package",
    detail: "Email · SMS · paid social · landing page — 4 assets, provenance tagged",
    status: "Needs approval",
    tone: "gold",
  },
  {
    day: "WED",
    actor: "You",
    title: "Approved with one revision",
    detail: "Tightened the email subject — decision recorded to the audit trail",
    status: "Approved",
    tone: "green",
  },
  {
    day: "THU",
    actor: "Arc",
    title: "Outbound unlocked, sends delivered",
    detail: "142 highest-intent accounts · engagement tracking live",
    status: "Sent",
    tone: "ivory",
  },
  {
    day: "FRI",
    actor: "Arc",
    title: "Logged outcomes to the Brain",
    detail: "Urgency angle outperformed — next iteration recommended",
    status: "Learning saved",
    tone: "gray",
  },
];

const TIMELINE_TONES: Record<TimelineTone, string> = {
  gold: "border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]",
  green: "border-[color:color-mix(in_srgb,var(--ok)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--ok)_12%,transparent)] text-[var(--ok)]",
  ivory: "border-[color:var(--border-panel)] bg-[var(--surface-raised)] text-[var(--text-primary)]",
  gray: "border-[color:var(--border-panel)] bg-[var(--surface-inset)] text-[var(--text-secondary)]",
};

export function HowItWorks() {
  return (
    <section id="how" className="border-y border-[color:var(--border-panel)] bg-[var(--canvas-deep)]">
      <div className="mx-auto max-w-6xl scroll-mt-24 px-6 py-24 sm:py-28">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div>
            <Reveal>
              <h2 className="font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
                How a week with Arc works
              </h2>
              <p className="mt-4 max-w-[48ch] text-[0.975rem] leading-relaxed text-[var(--text-secondary)]">
                Arc runs the legwork on a loop — scouting, drafting, learning —
                and your week narrows to the decisions that matter.
              </p>
            </Reveal>
            <div className="mt-9 space-y-6">
              {STEPS.map((step, i) => (
                <Reveal key={step.number} delay={0.08 * i}>
                  <div className="flex items-start gap-4">
                    <span className="mt-0.5 font-[family-name:var(--font-mono)] text-[0.75rem] text-[var(--accent)]">
                      {step.number}
                    </span>
                    <div>
                      <h3 className="font-serif text-lg font-semibold text-[var(--text-primary)]">{step.title}</h3>
                      <p className="mt-1 max-w-[44ch] text-[0.875rem] leading-relaxed text-[var(--text-secondary)]">
                        {step.body}
                      </p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>

          {/* The week rendered the way the app itself renders activity */}
          <Reveal delay={0.12}>
            <div className="overflow-hidden rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)] shadow-[0_24px_64px_-32px_rgba(0,0,0,0.8)]">
              <div className="flex items-center justify-between border-b border-[color:var(--border-panel)] px-5 py-3.5">
                <span className="text-[0.9rem] font-semibold text-[var(--text-primary)]">One week, one campaign</span>
                <span className="font-[family-name:var(--font-mono)] text-[0.68rem] text-[var(--text-muted)]">
                  sample timeline
                </span>
              </div>
              <div>
                {WEEK.map((row, i) => {
                  const isFocal = row.actor === "You";
                  return (
                    <Reveal key={row.day} delay={0.08 * i} y={14}>
                      <div
                        className={`group grid grid-cols-[2.6rem_1.1rem_1fr] items-start gap-x-3 px-5 py-4 transition-colors duration-200 sm:grid-cols-[2.6rem_1.1rem_1fr_auto] ${
                          isFocal
                            ? "bg-[color:color-mix(in_srgb,var(--accent)_5%,transparent)]"
                            : "hover:bg-[color:color-mix(in_srgb,var(--surface-inset)_60%,transparent)]"
                        }`}
                      >
                        <span className="mt-1 font-[family-name:var(--font-mono)] text-[0.68rem] tracking-[0.04em] text-[var(--text-muted)]">
                          {row.day}
                        </span>
                        {/* The thread: each row draws its segment; the human
                            decision is the bright node the week runs through. */}
                        <span className="relative flex h-full min-h-[3.2rem] justify-center">
                          <span
                            className={`w-px bg-[color:var(--border-panel)] ${i === 0 ? "mt-2.5" : ""} ${
                              i === WEEK.length - 1 ? "max-h-2.5" : ""
                            }`}
                            aria-hidden
                          />
                          <span
                            className={`absolute top-[0.45rem] h-2 w-2 rounded-full ${
                              isFocal
                                ? "bg-[var(--accent)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_20%,transparent)]"
                                : "border border-[color:var(--border-strong,var(--border-panel))] bg-[var(--surface-raised)]"
                            }`}
                            aria-hidden
                          />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full border px-2 py-px text-[0.62rem] font-semibold ${
                                isFocal
                                  ? "border-[color:color-mix(in_srgb,var(--accent)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]"
                                  : "border-[color:var(--border-panel)] text-[var(--text-secondary)]"
                              }`}
                            >
                              {row.actor}
                            </span>
                            <p className="text-[0.85rem] font-medium text-[var(--text-primary)]">{row.title}</p>
                          </div>
                          <p className="mt-1 text-[0.75rem] leading-relaxed text-[var(--text-muted)]">{row.detail}</p>
                        </div>
                        <span
                          className={`mt-0.5 hidden shrink-0 rounded-full border px-2.5 py-0.5 text-[0.65rem] font-medium sm:inline-flex ${TIMELINE_TONES[row.tone]}`}
                        >
                          {row.status}
                        </span>
                      </div>
                    </Reveal>
                  );
                })}
              </div>
              <div className="flex items-center gap-2.5 border-t border-[color:var(--border-panel)] bg-[color:color-mix(in_srgb,var(--canvas-deep)_55%,transparent)] px-5 py-3">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden />
                <span className="font-[family-name:var(--font-mono)] text-[0.68rem] text-[var(--text-muted)]">
                  Wednesday is the only step that needed you
                </span>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ————— Intelligence —————

export function Intelligence() {
  return (
    <section id="intelligence" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-24 sm:py-28">
      <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <Reveal>
          <Constellation />
        </Reveal>
        <div>
          <Reveal>
            <h2 className="font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
              Persona intelligence underneath everything
            </h2>
            <p className="mt-4 max-w-[56ch] text-[0.975rem] leading-relaxed text-[var(--text-secondary)]">
              Every contact, campaign, and outcome feeds one shared intelligence
              layer — who your personas are, what they respond to, and what to do
              next. It powers the CRM, the campaign drafts, the approval cards,
              and Arc itself.
            </p>
          </Reveal>
          <div className="mt-8 space-y-5">
            {[
              ["Persona-scored records", "Match, confidence, stage, and next best action on companies, contacts, and leads."],
              ["Deterministic scoring", "Lead scoring and routing that behaves the same way every time — auditable, not vibes."],
              ["Compounding memory", "Wins, losses, and voice rules persist in the workspace brain and sharpen every draft."],
            ].map(([title, body], i) => (
              <Reveal key={title} delay={0.08 * i}>
                <div className="flex items-start gap-3.5">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                  <div>
                    <p className="text-[0.95rem] font-semibold text-[var(--text-primary)]">{title}</p>
                    <p className="mt-1 max-w-[52ch] text-[0.88rem] leading-relaxed text-[var(--text-secondary)]">
                      {body}
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

// ————— Trust / approval gate —————

export function TrustBand() {
  return (
    <section id="approvals" className="border-y border-[color:var(--border-panel)] bg-[var(--canvas-deep)]">
      <div className="mx-auto max-w-6xl scroll-mt-24 px-6 py-24 sm:py-28">
        <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
          <Reveal>
            <h2 className="font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
              Nothing reaches the outside world without you
            </h2>
            <p className="mt-4 max-w-[54ch] text-[0.975rem] leading-relaxed text-[var(--text-secondary)]">
              Arc is built on one non-negotiable rule: the agent does the work,
              a human approves the decisions, and the database remembers
              everything. There is no &ldquo;auto-send&rdquo; to switch on.
            </p>
            <div className="mt-7 flex items-center gap-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden />
              <span className="font-[family-name:var(--font-mono)] text-[0.75rem] tracking-[0.02em] text-[var(--text-muted)]">
                Outbound stays locked until you approve
              </span>
            </div>
          </Reveal>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["Human approval on every send", "Email, SMS, ads, publishing — each one passes through an explicit approval gate."],
              ["A full audit trail", "Every draft, decision, revision, and send is recorded. You can always answer “why did this go out?”"],
              ["Provenance on every asset", "Real media, AI-generated, or composite — each asset says what it is and where it came from."],
              ["Your workspace, your data", "Workspaces are isolated end to end. Your records and your brain belong to you."],
            ].map(([title, body], i) => (
              <Reveal key={title} delay={0.07 * i}>
                <div className="h-full rounded-xl border border-[color:var(--border-panel)] bg-[var(--surface-panel)] p-5">
                  <p className="text-[0.92rem] font-semibold text-[var(--text-primary)]">{title}</p>
                  <p className="mt-1.5 text-[0.85rem] leading-relaxed text-[var(--text-secondary)]">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ————— Final CTA + footer —————

export function FinalCta() {
  const reduced = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <section className="relative overflow-hidden">
      {/* The Higgsfield brand film plays once as the CTA enters view — the gold
          arc draws itself live behind the closing ask, then holds its final
          frame. Reduced motion keeps the finished still. */}
      {reduced ? (
        <div
          className="pointer-events-none absolute inset-0 bg-cover bg-bottom opacity-70"
          style={{ backgroundImage: "url(/brand/landing/hero-arc.jpg)" }}
          aria-hidden
        />
      ) : (
        <motion.video
          ref={videoRef}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-bottom opacity-70"
          src="/brand/landing/arc-draw.mp4"
          muted
          playsInline
          preload="metadata"
          aria-hidden
          onViewportEnter={() => {
            const video = videoRef.current;
            if (!video) return;
            video.currentTime = 0;
            void video.play().catch(() => {});
          }}
          onViewportLeave={() => videoRef.current?.pause()}
          viewport={{ margin: "60px" }}
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[var(--canvas)] via-[var(--canvas)]/70 to-[var(--canvas)]/30" aria-hidden />
      <div className="relative mx-auto max-w-3xl px-6 py-28 text-center sm:py-36">
        <Reveal>
          <h2 className="font-serif text-4xl font-semibold leading-[1.1] text-[var(--text-primary)] sm:text-5xl">
            Put a marketing operator on your team
          </h2>
          <p className="mx-auto mt-5 max-w-[52ch] text-[1rem] leading-relaxed text-[var(--text-secondary)]">
            We&rsquo;re onboarding teams gradually while pricing is finalized —
            join the waitlist and we&rsquo;ll reach out when your spot opens.
          </p>
          <div className="mt-9">
            <WaitlistForm source="landing-cta" align="center" />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-[color:var(--border-panel)] bg-[var(--canvas-deep)]">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-6 py-12 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <img src="/icon.png" alt="" className="h-7 w-auto" />
          <img src="/brand/arc-studio-wordmark.png" alt="Arc Studio" className="h-[1.35rem] w-auto" />
        </div>
        <nav className="flex flex-wrap items-center gap-x-7 gap-y-2 text-[0.85rem] text-[var(--text-secondary)]">
          <a href="#product" className="transition-colors hover:text-[var(--text-primary)]">Product</a>
          <a href="#how" className="transition-colors hover:text-[var(--text-primary)]">How it works</a>
          <a href="#approvals" className="transition-colors hover:text-[var(--text-primary)]">Approvals</a>
          <a href="#faq" className="transition-colors hover:text-[var(--text-primary)]">FAQ</a>
          <Link href="/login" className="transition-colors hover:text-[var(--text-primary)]">Sign in</Link>
          <a href="#waitlist" className="font-medium text-[var(--accent)] transition-colors hover:text-[color:color-mix(in_srgb,var(--accent)_85%,white)]">
            Join the waitlist
          </a>
        </nav>
      </div>
      <div className="border-t border-[color:var(--border-panel)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-5">
          <span className="font-[family-name:var(--font-mono)] text-[0.7rem] text-[var(--text-muted)]">
            © {new Date().getFullYear()} Arc Studio
          </span>
          <span className="font-[family-name:var(--font-mono)] text-[0.7rem] text-[var(--text-muted)]">
            Agent does the work · Human approves · Database remembers
          </span>
        </div>
      </div>
    </footer>
  );
}
