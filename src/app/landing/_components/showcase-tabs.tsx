"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { AppWindow } from "./app-window";
import { Reveal } from "./reveal";

type TabKey = "arc" | "opportunities" | "campaigns" | "crm" | "brain" | "analytics";

const TABS: Array<{
  key: TabKey;
  label: string;
  title: string;
  description: string;
  bullets: string[];
  shot: string;
  shotTitle: string;
  shotAlt: string;
}> = [
  {
    key: "arc",
    label: "Arc",
    title: "A marketing operator you talk to",
    description:
      "Ask Arc what to run this week and it answers with work, not links — drafted campaigns, cited evidence, and an approval card waiting for your decision.",
    bullets: [
      "Ask, draft, and act modes — with a governance gate on anything outbound",
      "Every recommendation cites the records and signals behind it",
      "Approve, revise, or decline without leaving the conversation",
    ],
    shot: "/brand/landing/app/arc.png",
    shotTitle: "arc — campaign package in review",
    shotAlt: "The Arc workspace: a drafted campaign package with four assets waiting for review",
  },
  {
    key: "opportunities",
    label: "Opportunities",
    title: "An inbox of reasons to act",
    description:
      "Arc watches your CRM, weather signals, and engagement data — and files source-backed opportunities with evidence and confidence, not hunches.",
    bullets: [
      "CRM inactivity, weather events, engagement spikes, segment gaps",
      "Every opportunity carries its evidence and a confidence score",
      "One click turns an opportunity into a drafted campaign",
    ],
    shot: "/brand/landing/app/opportunities.png",
    shotTitle: "opportunities — inbox",
    shotAlt: "The Opportunities inbox: a high-urgency lead signal with evidence, confidence, and approval routing",
  },
  {
    key: "campaigns",
    label: "Campaigns",
    title: "Complete packages, not blank pages",
    description:
      "A campaign in Arc holds every asset: brief, audience, email, SMS, ad copy, landing copy, and creative — assembled by Arc, approved by you.",
    bullets: [
      "Brief, audience, persona logic, and every deliverable in one record",
      "Assets carry provenance — real media, AI-generated, or composite",
      "Nothing sends until a human approves the package",
    ],
    shot: "/brand/landing/app/campaigns.png",
    shotTitle: "campaigns — approval queue",
    shotAlt: "The Campaigns board: drafted campaign packages moving through the approval queue",
  },
  {
    key: "crm",
    label: "CRM",
    title: "Records that know who they are",
    description:
      "Companies, contacts, and leads enriched with persona intelligence — who they are, where the relationship stands, and the next best action.",
    bullets: [
      "Persona match, relationship stage, and lead score on every record",
      "Notes, follow-ups, and a full activity timeline",
      "Arc and your team work the same records, with the same rules",
    ],
    shot: "/brand/landing/app/crm.png",
    shotTitle: "crm — relationships",
    shotAlt: "The CRM: companies and contacts with persona intelligence fields",
  },
  {
    key: "brain",
    label: "Brain",
    title: "A memory that compounds",
    description:
      "Everything Arc learns — voice rules, proof points, what won and why — lands in a workspace brain that makes the next campaign smarter than the last.",
    bullets: [
      "Facts promoted from conversations, records, and outcomes",
      "Semantic recall — Arc finds what matters, not what matches",
      "Your workspace's knowledge stays yours",
    ],
    shot: "/brand/landing/app/brain.png",
    shotTitle: "brain — workspace memory",
    shotAlt: "The Brain: the workspace knowledge graph of facts Arc has learned",
  },
  {
    key: "analytics",
    label: "Analytics",
    title: "A learning loop, not a dashboard",
    description:
      "Outcomes flow back into the system — which angle, which persona, which asset — so every approval teaches Arc what your audience actually responds to.",
    bullets: [
      // Was "Attribution by campaign, channel, persona, and asset". Removed for
      // the same reason it came off the pricing page: attribution depends on
      // the engagement pipeline, which is inert on production (no Resend
      // webhook configured, `journey_touchpoints` empty). Performance grouped
      // by campaign/persona/asset IS real, so that's what this now claims.
      "Performance grouped by campaign, channel, persona, and asset",
      "Approvals and outcomes feed straight back into scoring",
      "Arc recommends the next iteration, you decide",
    ],
    shot: "/brand/landing/app/analytics.png",
    shotTitle: "analytics — learning loop",
    shotAlt: "Analytics: campaign and persona performance feeding Arc's next recommendation",
  },
];

// The app's own nav icons (from the app shell), so the landing page and the
// product share one iconography. Keep these in sync with app-shell.tsx.
const TAB_ICONS: Record<TabKey, React.ReactNode> = {
  arc: (
    <>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 9h8M8 12.5h5" />
    </>
  ),
  opportunities: (
    <path d="M12 3l2.5 5 5.5.8-4 4 1 5.5L12 21l-5-2.7 1-5.5-4-4 5.5-.8z" />
  ),
  campaigns: (
    <>
      <path d="M4 5h16v6H4z" />
      <path d="M4 15h10v4H4z" />
    </>
  ),
  crm: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M4 20c0-3 2-5 5-5s5 2 5 5" />
      <path d="M16 6h5M16 10h5" />
    </>
  ),
  brain: (
    <path d="M12 4a4 4 0 00-4 4 3 3 0 00-1 6 3 3 0 003 3 3 3 0 006 0 3 3 0 003-3 3 3 0 00-1-6 4 4 0 00-4-4z" />
  ),
  analytics: (
    <path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-8" />
  ),
};

// The tabbed product tour: one tab per surface of the app, each pairing copy
// with a real screenshot of the live product (demo workspace).
export function ShowcaseTabs() {
  const [active, setActive] = useState<TabKey>("arc");
  const [hovered, setHovered] = useState<TabKey | null>(null);
  const reduced = useReducedMotion();
  const tab = TABS.find((t) => t.key === active)!;

  return (
    <section id="product" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-14 sm:py-28">
      <Reveal>
        <h2 className="font-serif text-3xl font-semibold leading-tight text-[var(--text-primary)] sm:text-4xl">
          One system, every surface of marketing
        </h2>
        <p className="mt-3 max-w-[62ch] text-[0.975rem] leading-relaxed text-[var(--text-secondary)]">
          Arc isn&apos;t a chatbot bolted onto a CRM. It&apos;s a marketing operating
          system — opportunities, campaigns, records, memory, and outcomes sharing
          one intelligence layer.
        </p>
      </Reveal>

      <Reveal delay={0.1} className="mt-7 sm:mt-9">
        <div
          role="tablist"
          aria-label="Product areas"
          onMouseLeave={() => setHovered(null)}
          className="relative grid grid-cols-3 gap-1 rounded-2xl border border-[color:var(--border-panel)] bg-[color:color-mix(in_srgb,var(--canvas-deep)_78%,transparent)] p-1.5 shadow-[inset_0_2px_6px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(0,0,0,0.6),0_1px_0_rgba(241,237,226,0.04)] sm:grid-cols-6"
        >
          {TABS.map((t) => {
            const isActive = active === t.key;
            const isHovered = hovered === t.key && !isActive;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActive(t.key)}
                onMouseEnter={() => setHovered(t.key)}
                onFocus={() => setHovered(t.key)}
                className={`group relative flex min-h-[44px] items-center justify-center gap-2 rounded-[0.7rem] px-3 text-[0.85rem] transition-colors duration-200 ${
                  isActive
                    ? "font-semibold text-[var(--text-primary)]"
                    : "font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {/* Cursor-following hover glow, separate from the active pill */}
                {isHovered && (
                  <motion.span
                    layoutId={reduced ? undefined : "showcase-tab-hover"}
                    className="absolute inset-0 rounded-[0.7rem] bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)]"
                    transition={{ type: "spring", bounce: 0, duration: 0.35 }}
                    aria-hidden
                  />
                )}
                {isActive && (
                  <motion.span
                    layoutId={reduced ? undefined : "showcase-tab-pill"}
                    className="absolute inset-0 rounded-[0.7rem] border border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] shadow-[inset_0_1px_0_rgba(241,237,226,0.1),0_14px_30px_-16px_rgba(200,162,74,0.5)]"
                    style={{
                      background:
                        "linear-gradient(to bottom, color-mix(in srgb, var(--accent) 16%, transparent), color-mix(in srgb, var(--accent) 7%, transparent))",
                    }}
                    transition={{ type: "spring", bounce: 0.16, duration: 0.6 }}
                    aria-hidden
                  />
                )}
                <svg
                  viewBox="0 0 24 24"
                  className={`relative z-10 h-4 w-4 shrink-0 transition-[opacity,transform] duration-200 ${
                    isActive
                      ? "scale-105 text-[var(--accent)] opacity-100"
                      : "opacity-55 group-hover:opacity-90"
                  }`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  {TAB_ICONS[t.key]}
                </svg>
                <span className="relative z-10">{t.label}</span>
              </button>
            );
          })}
        </div>
      </Reveal>

      <AnimatePresence mode="wait">
        <motion.div
          key={active}
          role="tabpanel"
          initial={reduced ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0, y: -14 }}
          transition={{ duration: 0.38, ease: [0.22, 0.61, 0.36, 1] }}
          className="mt-10"
        >
          <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:gap-14">
            <div>
              <h3 className="font-serif text-2xl font-semibold leading-snug text-[var(--text-primary)]">
                {tab.title}
              </h3>
              <p className="mt-3 max-w-[52ch] text-[0.95rem] leading-relaxed text-[var(--text-secondary)]">
                {tab.description}
              </p>
            </div>
            <ul className="space-y-3 lg:pt-2">
              {tab.bullets.map((bullet) => (
                <li key={bullet} className="flex items-start gap-3.5">
                  <span className="mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden />
                  <span className="text-[0.9rem] leading-relaxed text-[var(--text-secondary)]">
                    {bullet}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <AppWindow
            src={tab.shot}
            alt={tab.shotAlt}
            title={tab.shotTitle}
            className="mt-10"
          />
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
