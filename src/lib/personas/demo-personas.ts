/**
 * Neutral, cross-industry demo personas for the generic Personas console.
 *
 * This is intentionally NOT BSR-specific — the Personas surface is a product
 * for any business, so the roster, segments, and fields are generic. Real
 * deployments load each org's own persona + segment definitions; until that
 * per-org wiring lands, the page renders this sample set so the experience is
 * complete and obviously industry-agnostic.
 */

export type PersonaSegmentKey = "acquisition" | "engagement" | "retention";

export type PersonaStage = "New" | "Hot lead" | "Active" | "Champion" | "At risk" | "Dormant";

export type ScoreSignalKey = "engagement" | "fit" | "intent";

// "Needs you" rather than a local "Awaiting approval": one name per state,
// from `domain/vocabulary.ts` (BSR-656).
export type ArcActivityStatus = "Needs you" | "Draft ready" | "Prepared";

export type PersonaArcActivity = { title: string; status: ArcActivityStatus; when: string };

export type DemoPersona = {
  slug: string;
  name: string;
  initials: string;
  segment: PersonaSegmentKey;
  stage: PersonaStage;
  score: number;
  signals: Record<ScoreSignalKey, number>;
  /** Evidence behind each signal score — the "why". */
  signalDrivers: Record<ScoreSignalKey, string[]>;
  /** Share of the total audience, as a percent. */
  audienceShare: number;
  /** Recent lead-score history (oldest → newest), 0–100. */
  scoreTrend: number[];
  live: boolean;
  /** A representative line in the persona's own voice. */
  quote: string;
  /** One or two sentences on who this audience is. */
  profile: string;
  /** What they're trying to achieve. */
  goals: string[];
  /** What holds them back / objections to address. */
  objections: string[];
  angle: string;
  audience: string;
  cta: string;
  channel: string;
  bestTiming: string;
  nextAction: string;
  proofPoints: string[];
  /** Illustrative example of what Arc would draft. */
  sampleMessage: { subject: string; preview: string };
  /** What Arc has recently prepared for this persona (approval-gated). */
  arcActivity: PersonaArcActivity[];
};

export type PersonaSegment = { key: PersonaSegmentKey; label: string; blurb: string };

export const PERSONA_SEGMENTS: PersonaSegment[] = [
  { key: "acquisition", label: "Acquisition", blurb: "People discovering and evaluating you." },
  { key: "engagement", label: "Engagement", blurb: "Recently active — building the habit." },
  { key: "retention", label: "Retention", blurb: "Keeping, growing, and winning back customers." },
];

/**
 * The explainable signals a lead score is composed of. Scoring is deterministic
 * and app-owned (not a model black box) — the persona page shows this breakdown.
 */
export const SCORE_SIGNALS: Array<{ key: ScoreSignalKey; label: string; hint: string }> = [
  { key: "engagement", label: "Engagement", hint: "Recency and frequency of activity" },
  { key: "fit", label: "Fit", hint: "Match to your ideal customer profile" },
  { key: "intent", label: "Intent", hint: "Buying and readiness signals" },
];

export const DEMO_PERSONAS: DemoPersona[] = [
  {
    slug: "new-prospect",
    name: "New Prospect",
    initials: "NP",
    segment: "acquisition",
    stage: "New",
    score: 71,
    signals: { engagement: 55, fit: 80, intent: 78 },
    signalDrivers: {
      engagement: ["First visit within the last week", "Viewed a few pages but hasn't returned yet"],
      fit: ["Matches your core target profile", "Right industry and company size"],
      intent: ["Landed on a high-intent page (product or pricing)", "No trial or demo action yet"],
    },
    audienceShare: 18,
    scoreTrend: [40, 48, 55, 60, 66, 71],
    live: false,
    quote: "I've heard of you, but why should I trust you with this?",
    profile: "Someone in the early research stage who just discovered you and is sizing up whether you're credible and worth their time.",
    goals: ["Quickly understand what you do and who it's for", "See proof that people like them succeeded", "Try it with minimal risk"],
    objections: ["Doesn't know your brand yet", "Unsure it fits their exact situation", "Wary of sharing info before seeing value"],
    angle: "Discovering you for the first time — needs trust and a reason to start.",
    audience: "First-touch visitors who don't know you yet.",
    cta: "Start free / Learn more",
    channel: "Search & social",
    bestTiming: "First 48 hours after discovery",
    nextAction: "Offer a low-friction first step backed by recognizable social proof.",
    proofPoints: ["Recognizable customers", "Clear, no-risk starting offer"],
    sampleMessage: {
      subject: "See how teams like yours get started",
      preview: "A two-minute look at what's possible — no signup required.",
    },
    arcActivity: [
      { title: "Welcome / intro email", status: "Draft ready", when: "Today" },
      { title: "Social-proof landing block", status: "Prepared", when: "2 days ago" },
    ],
  },
  {
    slug: "high-intent-lead",
    name: "High-Intent Lead",
    initials: "HL",
    segment: "acquisition",
    stage: "Hot lead",
    score: 86,
    signals: { engagement: 82, fit: 84, intent: 92 },
    signalDrivers: {
      engagement: ["Opened the last 4 emails", "Returned to the site 3 times this week"],
      fit: ["Strong match to your ideal customer profile", "Decision-maker role identified"],
      intent: ["Viewed pricing and comparison pages", "Started a demo request"],
    },
    audienceShare: 9,
    scoreTrend: [60, 66, 72, 78, 82, 86],
    live: true,
    quote: "I'm comparing a couple of options and I'm close to deciding.",
    profile: "An actively evaluating buyer showing strong signals — they've engaged repeatedly and are weighing you against alternatives right now.",
    goals: ["Confirm you solve their exact problem", "De-risk the decision with proof and specifics", "Move quickly once convinced"],
    objections: ["Comparing against a competitor", "Needs to justify the choice internally", "Wants certainty on time-to-value"],
    angle: "Actively comparing options and close to a decision.",
    audience: "Engaged leads showing strong buying signals.",
    cta: "Book a demo / Talk to sales",
    channel: "Email & retargeting",
    bestTiming: "Within 24 hours — they're deciding now",
    nextAction: "Reach out quickly with a tailored comparison and a fast next step.",
    proofPoints: ["Side-by-side comparison", "Fast time-to-value"],
    sampleMessage: {
      subject: "You vs. the alternatives, side by side",
      preview: "Here's exactly how we compare on the things you're weighing.",
    },
    arcActivity: [
      { title: "Comparison one-pager", status: "Needs you", when: "2 hours ago" },
      { title: "Demo follow-up email", status: "Draft ready", when: "Yesterday" },
    ],
  },
  {
    slug: "bargain-seeker",
    name: "Bargain Seeker",
    initials: "BS",
    segment: "acquisition",
    stage: "New",
    score: 58,
    signals: { engagement: 60, fit: 50, intent: 64 },
    signalDrivers: {
      engagement: ["Opened promotional emails", "Clicked an offer but didn't convert"],
      fit: ["Partial fit — budget runs below typical", "Use case fits; spend is the open question"],
      intent: ["Repeated visits to the pricing page", "Compared plan tiers"],
    },
    audienceShare: 14,
    scoreTrend: [50, 54, 57, 55, 56, 58],
    live: false,
    quote: "Is this actually worth it — and can I get a better deal?",
    profile: "A price-sensitive shopper who's interested but anchored on cost, looking for proof that the value justifies the spend (ideally with an incentive).",
    goals: ["Get the best possible price or offer", "Confirm the value is real before paying", "Avoid buyer's remorse"],
    objections: ["Sees price as the main barrier", "Skeptical of value claims", "May wait for a discount"],
    angle: "Price-driven — responds to offers and clear proof of value.",
    audience: "Deal-sensitive shoppers weighing cost against value.",
    cta: "See pricing / Claim offer",
    channel: "Email & promotions",
    bestTiming: "Around promotions and renewals",
    nextAction: "Lead with transparent value and a time-bound incentive.",
    proofPoints: ["Transparent pricing", "Money-back guarantee"],
    sampleMessage: {
      subject: "Your price, locked in",
      preview: "The full value, a transparent price, and a risk-free guarantee.",
    },
    arcActivity: [
      { title: "Limited-time offer email", status: "Needs you", when: "Today" },
      { title: "Pricing FAQ snippet", status: "Prepared", when: "3 days ago" },
    ],
  },
  {
    slug: "first-time-buyer",
    name: "First-time Buyer",
    initials: "FB",
    segment: "engagement",
    stage: "Active",
    score: 79,
    signals: { engagement: 85, fit: 78, intent: 74 },
    signalDrivers: {
      engagement: ["Logged in within a day of purchase", "Completed the initial setup steps"],
      fit: ["Solid match to your ideal customer profile", "Typical first-purchase profile"],
      intent: ["Active in onboarding", "Hasn't reached the core 'aha' moment yet"],
    },
    audienceShare: 11,
    scoreTrend: [55, 62, 70, 74, 77, 79],
    live: false,
    quote: "Okay, I bought it — now help me get this right.",
    profile: "A brand-new customer in their first days who needs a confident, simple path to their first win so the purchase feels validated.",
    goals: ["Get set up without friction", "Reach a first meaningful result fast", "Feel confident they chose well"],
    objections: ["Unsure where to start", "Worried about a steep learning curve", "Needs quick reassurance"],
    angle: "Just converted — needs a confident, simple onboarding.",
    audience: "Brand-new customers in their first days with you.",
    cta: "Finish setup / Quick start",
    channel: "Email & in-product",
    bestTiming: "First week post-purchase",
    nextAction: "Guide them to a first meaningful win quickly.",
    proofPoints: ["Step-by-step onboarding", "Responsive support"],
    sampleMessage: {
      subject: "Let's get your first win",
      preview: "Three quick steps to the result you signed up for.",
    },
    arcActivity: [
      { title: "Onboarding nudge series", status: "Draft ready", when: "Today" },
      { title: "First-win checklist", status: "Prepared", when: "Yesterday" },
    ],
  },
  {
    slug: "repeat-customer",
    name: "Repeat Customer",
    initials: "RC",
    segment: "engagement",
    stage: "Active",
    score: 84,
    signals: { engagement: 90, fit: 82, intent: 80 },
    signalDrivers: {
      engagement: ["Frequent, regular activity", "Multiple purchases on record"],
      fit: ["Strong fit — an established customer", "Usage matches the expansion profile"],
      intent: ["Browsed adjacent products", "Responds to recommendations"],
    },
    audienceShare: 13,
    scoreTrend: [78, 80, 81, 83, 84, 84],
    live: true,
    quote: "I keep coming back — what else have you got for me?",
    profile: "A steady, returning customer with healthy activity who's a natural candidate for the next relevant offer or upgrade.",
    goals: ["Keep getting reliable value", "Discover relevant new options", "Feel recognized for their loyalty"],
    objections: ["Comfortable with current usage", "Needs a clear reason to expand", "Sensitive to being over-sold"],
    angle: "Comes back regularly and is ready for more.",
    audience: "Returning customers with steady, healthy activity.",
    cta: "Recommended for you / Upgrade",
    channel: "Email & in-product",
    bestTiming: "Right after a positive interaction",
    nextAction: "Surface the next relevant offer based on their history.",
    proofPoints: ["Personalized recommendations", "Loyalty perks"],
    sampleMessage: {
      subject: "Picked for you",
      preview: "Based on what you use most — here's what's worth a look.",
    },
    arcActivity: [
      { title: "Personalized recommendations", status: "Draft ready", when: "Today" },
      { title: "Upgrade offer", status: "Needs you", when: "1 day ago" },
    ],
  },
  {
    slug: "loyal-advocate",
    name: "Loyal Advocate",
    initials: "LA",
    segment: "retention",
    stage: "Champion",
    score: 95,
    signals: { engagement: 97, fit: 95, intent: 93 },
    signalDrivers: {
      engagement: ["Among your most active customers", "High retention over a long tenure"],
      fit: ["Ideal-fit, long-tenured customer", "Strong product-market match"],
      intent: ["Left positive feedback and reviews", "Highly likely to refer if asked"],
    },
    audienceShare: 8,
    scoreTrend: [88, 90, 92, 93, 94, 95],
    live: false,
    quote: "I love this — who else can I tell?",
    profile: "One of your happiest, most engaged customers — a prime candidate to refer others and amplify your reputation.",
    goals: ["Share their positive experience", "Be recognized as a power user", "Help peers succeed too"],
    objections: ["Needs an easy way to refer", "Wants any reward to feel genuine, not transactional"],
    angle: "Loves you — ready to refer and leave a review.",
    audience: "Your happiest, most engaged customers.",
    cta: "Refer a friend / Leave a review",
    channel: "Email & community",
    bestTiming: "After a win or milestone",
    nextAction: "Invite them to refer, and reward it.",
    proofPoints: ["Referral rewards", "Community recognition"],
    sampleMessage: {
      subject: "Know someone who'd love this?",
      preview: "Share it and you'll both get something for it.",
    },
    arcActivity: [
      { title: "Referral invite", status: "Needs you", when: "Today" },
      { title: "Review request", status: "Draft ready", when: "2 days ago" },
    ],
  },
  {
    slug: "at-risk-customer",
    name: "At-Risk Customer",
    initials: "AR",
    segment: "retention",
    stage: "At risk",
    score: 46,
    signals: { engagement: 35, fit: 60, intent: 43 },
    signalDrivers: {
      engagement: ["Activity down sharply versus their norm", "No logins in recent weeks"],
      fit: ["Still a good profile fit", "Was originally a strong match"],
      intent: ["Visited a cancellation or help page", "Low recent interaction overall"],
    },
    audienceShare: 15,
    scoreTrend: [72, 68, 62, 56, 50, 46],
    live: false,
    quote: "I'm not sure this is still worth it for me.",
    profile: "A customer whose engagement is slipping — still a good fit, but trending toward churn and in need of a reason to stay.",
    goals: ["Get value without extra effort", "See that you still care", "Solve whatever's blocking them"],
    objections: ["Lost momentum or hit a snag", "Questioning the ongoing value", "May be evaluating alternatives"],
    angle: "Engagement slipping — needs a reason to stay.",
    audience: "Customers trending toward churn.",
    cta: "Re-engage / Check in",
    channel: "Email & SMS",
    bestTiming: "Before the next renewal",
    nextAction: "Reach out with help and a concrete reason to return.",
    proofPoints: ["Proactive support", "What's new since they last engaged"],
    sampleMessage: {
      subject: "Did we miss something?",
      preview: "We noticed you've been away — here's how to get back on track fast.",
    },
    arcActivity: [
      { title: "Re-engagement email", status: "Needs you", when: "Today" },
      { title: "Check-in + help offer", status: "Draft ready", when: "Yesterday" },
    ],
  },
  {
    slug: "lapsed-customer",
    name: "Lapsed Customer",
    initials: "LC",
    segment: "retention",
    stage: "Dormant",
    score: 34,
    signals: { engagement: 20, fit: 55, intent: 27 },
    signalDrivers: {
      engagement: ["No activity in an extended period", "Stopped opening emails"],
      fit: ["Profile still fits your audience", "Was a healthy customer before"],
      intent: ["No recent buying signals", "Dormant across channels"],
    },
    audienceShare: 12,
    scoreTrend: [60, 54, 48, 42, 38, 34],
    live: false,
    quote: "I used to use this… what's changed?",
    profile: "A previously active customer who has gone quiet — a win-back opportunity that needs the right reason and timing to return.",
    goals: ["Be reminded why they valued you", "See what's new or improved", "Return with low friction"],
    objections: ["Out of the habit", "May have switched or paused", "Needs a compelling reason to come back"],
    angle: "Gone quiet — a win-back moment worth timing well.",
    audience: "Previously active customers who have lapsed.",
    cta: "Win-back offer / We miss you",
    channel: "Email",
    bestTiming: "Around a relevant new release",
    nextAction: "Time a win-back around a fresh reason to return.",
    proofPoints: ["What's improved", "Welcome-back incentive"],
    sampleMessage: {
      subject: "A lot has changed since you left",
      preview: "Here's what's new — and a reason to give it another look.",
    },
    arcActivity: [
      { title: "Win-back offer", status: "Draft ready", when: "Today" },
      { title: "“What's new” recap", status: "Prepared", when: "4 days ago" },
    ],
  },
];

export function parsePersonaSegment(value: string | undefined): PersonaSegmentKey | "all" {
  return PERSONA_SEGMENTS.some((segment) => segment.key === value) ? (value as PersonaSegmentKey) : "all";
}

export function getPersonaBySlug(slug: string | undefined): DemoPersona | null {
  return DEMO_PERSONAS.find((persona) => persona.slug === slug) ?? null;
}

export function getAdjacentPersonas(slug: string): { prev: DemoPersona | null; next: DemoPersona | null } {
  const index = DEMO_PERSONAS.findIndex((persona) => persona.slug === slug);
  if (index < 0) return { prev: null, next: null };
  return { prev: DEMO_PERSONAS[index - 1] ?? null, next: DEMO_PERSONAS[index + 1] ?? null };
}

export function segmentLabel(key: PersonaSegmentKey): string {
  return PERSONA_SEGMENTS.find((segment) => segment.key === key)?.label ?? key;
}
