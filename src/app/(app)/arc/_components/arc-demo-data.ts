// The backend-less demo data layer for the Arc chat. When no Supabase backend is
// present (the offline preview / `ARC_DEMO_DATA`), the view renders from these
// fixtures instead of live records. Pure data + one pure builder — no JSX, no I/O
// — so the demo path stays fully separable from the live path in arc-view.tsx.
//
// This is illustrative sample content for a demo tenant, not a hardcoded customer.

import type { ArcActionCard, ArcDraftFinding, ArcMention, ArcRecall } from "@/domain";
import type { ArcAssetBody } from "@/lib/campaigns/read-model";
import type { ArcAttachment, ArcMessage, ArcStep, ArcToolCall } from "@/lib/arc-chat/persistence";
import type { ArcRecentConversationVM, ArcThreadGroupVM } from "@/lib/arc-chat/read-model";
import { selectRailConversations } from "@/lib/arc-chat/rail-sections";

import type { ArcWaiting } from "./arc-view.types";

export { buildDemoLiveWork } from "@/lib/arc-chat/demo-live-work";

export const DEMO_THREADS: ArcThreadGroupVM[] = [
  {
    group: "Today",
    items: [
      { id: "storm", title: "High-intent accounts", when: "9:38 AM", active: true, pinned: true, running: false, campaignId: "demo-camp" },
      { id: "past", title: "Past-customer outreach", when: "8:12 AM", active: false, pinned: false, running: true, campaignId: "past-customer" },
    ],
  },
  {
    group: "Yesterday",
    items: [
      { id: "property", title: "Multi-seat team list", when: "4:46 PM", active: false, pinned: false, running: false, campaignId: "property-partners" },
      { id: "noaa", title: "Engagement signal read", when: "2:10 PM", active: false, pinned: false, running: false, campaignId: "demo-camp" },
    ],
  },
  {
    group: "Previous 7 days",
    items: [
      { id: "inspection", title: "Demo page rewrite", when: "Jul 10", active: false, pinned: false, running: false, campaignId: "demo-camp" },
      { id: "adjuster", title: "Procurement follow-ups", when: "Jul 8", active: false, pinned: false, running: false, campaignId: null },
    ],
  },
];

// Carries `running`/`active` straight off the thread fixtures so the offline
// preview shows the same rail states a live workspace does — a fixture that
// flattened them would make the preview lie about a field prod really sets.
/**
 * The campaigns the demo threads belong to.
 *
 * One list, in mention shape, because two things read it: the rail's campaign
 * labels and folders, and the header's campaign picker. The live path resolves
 * both from the campaigns table. Dropping this left the preview unable to
 * render either — which is how a fixture hides a feature rather than
 * demonstrating it, and it is the surface the design actually gets reviewed on.
 *
 * There used to be a second copy of these names inside arc-view.tsx, and the two
 * had already drifted: this file called one "Past-customer win-back" while the
 * drawer's copy called the same id "Past Customer Re-engagement".
 */
export const DEMO_CAMPAIGNS: ArcMention[] = [
  { type: "campaign", id: "demo-camp", label: "Pricing-Intent Fast Track", href: "/campaigns" },
  { type: "campaign", id: "past-customer", label: "Past-customer win-back", href: "/campaigns" },
  { type: "campaign", id: "property-partners", label: "Multi-seat expansion", href: "/campaigns" },
];

const DEMO_CAMPAIGN_NAMES: Record<string, string> = Object.fromEntries(
  DEMO_CAMPAIGNS.map((campaign) => [campaign.id, campaign.label]),
);

/**
 * Budgeted by the same function the live read model uses, rather than a hand-cut
 * `.slice(0, 5)`. The old slice took the five newest threads, which in this
 * fixture are all campaign-bearing — so the preview rendered folders and never
 * once rendered the unattached chats below them, and the offline screen this
 * design gets reviewed on could not show the section it spends most of its
 * height on.
 */
export const DEMO_RECENT_CONVERSATIONS: ArcRecentConversationVM[] = selectRailConversations(
  DEMO_THREADS.flatMap((group) => group.items).map(({ id, title, when, running, active, pinned, campaignId }) => ({
    id,
    title,
    when,
    running,
    pinned,
    defaultActive: active,
    campaignId: campaignId ?? null,
    campaignName: campaignId ? DEMO_CAMPAIGN_NAMES[campaignId] ?? null : null,
  })),
);

export const DEMO_STEPS: ArcStep[] = [
  { label: "Read the pricing-intent brief", status: "done", at: "9:38 AM", kind: "think" },
  { label: "Matched high-intent accounts in CRM", status: "done", at: "9:38 AM", kind: "match" },
  { label: "Ranked accounts by demo urgency", status: "done", at: "9:38 AM", kind: "search" },
  { label: "Prepared a review-safe campaign package", status: "done", at: "9:38 AM", kind: "draft" },
];

/** Named the way the SDK delivers them, MCP prefix and all, so the preview
 *  exercises the same label cleanup production needs. */
export const DEMO_TOOLS: ArcToolCall[] = [
  { name: "mcp__arc__weather_lookup", status: "complete", output: "pricing-page surge" },
  { name: "mcp__arc__crm_search", status: "complete", output: "142 high-intent accounts" },
  { name: "mcp__arc__audience_score", status: "complete", output: "$1.4M estimated opportunity" },
];

export const DEMO_BREAKDOWN_MD = `Here's how the 142 high-intent accounts break down, and the tracking I'd attach so we can attribute booked demos back to this run:

| Segment | Accounts | Est. value | Top signal |
| --- | --: | --: | --- |
| Active trial · high intent | 64 | $612K | No demo booked |
| Trial expiring soon | 41 | $455K | Trial age 8d+ |
| Multi-seat team · expansion | 37 | $333K | Prior usage activity |

Every link gets tagged so attribution is clean:

\`\`\`text
?utm_source=arc&utm_medium=email&utm_campaign=pricing_intent&segment={persona}
\`\`\`
`;

export const DEMO_DRAFT_CARD: ArcActionCard = {
  kind: "draft",
  title: "Demo follow-up email",
  channel: "Email",
  format: "64-account segment",
  status: "draft",
  preview:
    "Hi {first_name}, your team spent time on our pricing page this week. We're offering a free, no-pressure walkthrough this week — and if it's a fit, we can help you map Meridian to how your team already works.",
  rows: [
    { name: "Audience", meta: "64 active trial · high intent" },
    { name: "Subject", meta: "You looked at pricing — here's a walkthrough" },
  ],
  flags: [
    { tone: "ok", label: "Brand voice" },
    { tone: "ok", label: "No overclaim" },
  ],
  approval: { kind: "campaign", campaignId: "demo-campaign", assetId: "demo-asset-email" },
};

export const DEMO_PACKAGE_CARDS: ArcActionCard[] = [
  DEMO_DRAFT_CARD,
  {
    kind: "draft",
    title: "Warm demo check-in",
    channel: "SMS",
    format: "152 / 160 chars",
    status: "draft",
    preview: "Hi {first_name} — it’s the {brand} team. Saw your team exploring Meridian, no charge and no pressure. Want a quick walkthrough?",
    rows: [{ name: "Audience", meta: "142-account segment" }],
    flags: [{ tone: "ok", label: "No overclaim" }],
    approval: { kind: "campaign", campaignId: "demo-campaign", assetId: "demo-asset-sms" },
  },
  {
    kind: "draft",
    title: "High-intent awareness",
    channel: "Paid social",
    format: "1:1 · Meta",
    status: "draft",
    preview: "Comparing options? The right workflow can save your team hours every week — book a personalized demo while it's top of mind.",
    rows: [{ name: "Headline", meta: "See Meridian tailored to your team" }, { name: "CTA", meta: "Book now" }],
    flags: [{ tone: "ok", label: "Brand voice" }],
    // Prod attaches media to a draft card whenever the asset has real creative
    // (three such cards exist live today, all Supabase storage urls). Without one
    // here the workspace panel's thumbnail would only ever be exercised in prod.
    media: { kind: "image", url: "/brand/login-background-v2.png", alt: "Paid social creative", source: "ai_generated", format: "1:1" },
    approval: { kind: "campaign", campaignId: "demo-campaign", assetId: "demo-asset-social" },
  },
  {
    kind: "draft",
    // Creative with NO copy — the shape prod holds 4 of (asset_type
    // `image_prompt`, channel `media`). The draft critic grounds claims in text,
    // so it correctly never runs on these; without one here the preview could
    // not show the "Creative — not automatically checked" state at all.
    title: "Service van — driveway, bright morning",
    channel: "Media",
    format: "1:1 · generated",
    status: "draft",
    rows: [{ name: "Source", meta: "AI generated" }],
    flags: [],
    media: { kind: "image", url: "/brand/login-background-v2.png", alt: "Service van in a driveway", source: "ai_generated", format: "1:1" },
    approval: { kind: "campaign", campaignId: "demo-campaign", assetId: "demo-asset-creative" },
  },
  {
    kind: "draft",
    title: "Demo landing page",
    channel: "Landing page",
    format: "Mobile-ready",
    status: "draft",
    preview: "Free personalized walkthrough for teams evaluating Meridian. See how it fits your workflow before your trial winds down.",
    rows: [{ name: "Destination", meta: "Campaign-matched" }],
    // Deliberately flagless, and it is the COMMON case: a census of prod found
    // 13 of 16 approval-bearing draft cards carrying no flags at all. With every
    // fixture flagged, the preview only ever showed "checks passed" and the
    // state an operator actually meets most often — "no checks recorded" —
    // could not be reviewed on the one screen where this design gets reviewed.
    flags: [],
    approval: { kind: "campaign", campaignId: "demo-campaign", assetId: "demo-asset-landing" },
  },
];

/**
 * What the workspace panel holds, which is more than the approval package.
 *
 * Arc is told to emit a `result` card whenever it presents records it found, and
 * prod is full of them — "5 CRM contacts (live read, Aug 3)" sitting beside four
 * drafts. They are not deliverables and cannot be approved, so the panel lists
 * them separately; the demo carries one so the preview shows the same split.
 */
export const DEMO_WORKSPACE_CARDS: ArcActionCard[] = [
  ...DEMO_PACKAGE_CARDS,
  {
    kind: "result",
    title: "142 high-intent accounts (live read)",
    rows: [{ name: "Source", meta: "CRM · companies" }],
    flags: [],
    href: "/crm/companies",
  },
];

/**
 * The full copy behind the demo cards, standing in for `getArcAssetBodies`.
 *
 * The offline preview is where this design gets reviewed, and without these the
 * preview only ever exercises the FALLBACK path — every card on its stored
 * ~280-character `preview`, no lead-in fields parsed, no clamp, no disclosure.
 * The review would then pass on a card that never rendered a full draft.
 *
 * Written in the shape prod actually stores (`SUBJECT:` / `PREHEADER:` lead-in
 * lines above the copy for email, bare prose for SMS, `Headline:` /
 * `Primary text:` for a social ad) so the preview exercises the real parse
 * rather than a tidied-up one. The `preview` on each card stays a genuine prefix
 * of the body here, exactly as the live pair behaves.
 *
 * `demo-asset-landing` is deliberately ABSENT. A conversation can hold a card
 * whose asset row is gone, out of scope, or simply not fetched yet, and that
 * card has to still render — so the preview shows one deliverable on the
 * fallback path next to three on the full path, rather than only ever showing
 * the happy one.
 */
export const DEMO_ASSET_BODIES: Record<string, ArcAssetBody> = {
  "demo-asset-email": {
    id: "demo-asset-email",
    edited: false,
    title: "Demo follow-up email",
    body: [
      "SUBJECT: You looked at pricing — here's a walkthrough",
      "PREHEADER: Fifteen minutes, no pitch. We'll map Meridian to how your team already works.",
      "",
      "Hi {first_name},",
      "",
      "Your team spent time on our pricing page this week. We're offering a free, no-pressure walkthrough this week — and if it's a fit, we can help you map Meridian to how your team already works.",
      "",
      "Most teams your size use the first fifteen minutes to answer three questions:",
      "",
      "- Which of our existing tools does this replace, and which does it sit beside?",
      "- What does the first month actually look like for the people doing the work?",
      "- Where does this stop being worth it as we grow?",
      "",
      "If those are your questions too, book a time that suits you and we'll work through them with your own data on screen. If they aren't, tell me what is and I'll come prepared for that instead.",
      "",
      "— The Meridian team",
    ].join("\n"),
  },
  "demo-asset-sms": {
    id: "demo-asset-sms",
    edited: false,
    // Drifted from the card's frozen "Warm demo check-in", and SMS carries no
    // lead-in headline — so this is the one fixture that actually exercises the
    // live-title tier rather than being shadowed by the copy's own headline.
    title: "Warm demo check-in (revised, opt-out added)",
    body: "Hi {first_name} — it's the {brand} team. Saw your team exploring Meridian, no charge and no pressure. Want a quick walkthrough? Reply STOP to opt out.",
  },
  "demo-asset-social": {
    id: "demo-asset-social",
    title: "High-intent awareness — \"See it on your data\"",
    edited: false,
    body: [
      "Headline: See Meridian tailored to your team",
      "Primary text: Comparing options? The right workflow can save your team hours every week — book a personalized demo while it's top of mind.",
      "CTA: Book now",
      "",
      "Fifteen minutes, your own data on screen, no pitch. We'll show the parts that matter to how your team already works and skip the rest.",
    ].join("\n"),
  },
};

/**
 * Guardrail findings for the demo cards, standing in for `getArcAssetChecks`.
 *
 * Shaped like prod, which is the point: there, 13 of 16 draft cards carry NO
 * flags while the assets behind them hold 15 open findings — 13 `warning` and
 * 2 `blocker`. So the landing page carries an open blocker while its card
 * carries nothing, which is exactly the case that used to render as "nothing
 * flagged" one click from approval.
 *
 * `demo-asset-sms` is present but EMPTY on purpose — that is the "we looked and
 * found none" answer, which must render differently from "we have not looked".
 */
export const DEMO_ASSET_CHECKS: Record<string, ArcDraftFinding[]> = {
  "demo-asset-landing": [
    {
      id: "demo-finding-1",
      severity: "blocker",
      message: "Contradicts the documented plan list: the page offers a tier the brand kit does not sell.",
      matchedText: "every plan includes onboarding",
      open: true,
    },
    {
      id: "demo-finding-2",
      severity: "warning",
      message: "Could not ground the \"15 minutes\" claim in any brain node.",
      open: true,
    },
  ],
  "demo-asset-sms": [],
};

export const DEMO_ATTACHMENTS: ArcAttachment[] = [
  { url: "/brand/login-background-v2.png", name: "product-tour-reference.png", contentType: "image/png", objectPath: "demo-ref-1" },
];

export const DEMO_SOURCES: ArcMention[] = [
  { type: "property", id: "demo-prop", label: "142 high-intent accounts", href: "/crm/properties" },
  { type: "campaign", id: "demo-camp", label: "Pricing-Intent Fast Track", href: "/campaigns" },
  { type: "company", id: "demo-co", label: "High-intent accounts", href: "/crm/companies" },
];

export const DEMO_RECALL: ArcRecall[] = [
  // `label` is the brain's node key and `summary` is the fact in Arc's words —
  // the shape prod actually stores. The panel renders the sentence.
  //
  // Sized like a real turn (prod recalls ~15), not like a sample of two, so the
  // preview exercises the overflow control instead of a case that never happens.
  { label: "demo_first_beats_discount", summary: "Leading with a demo outperforms a discount offer on this segment by a wide margin.", confidence: 0.86, nodeId: "demo-node-inspection" },
  { label: "active_trial_speed", summary: "Accounts in an active trial book a demo faster than any other segment.", confidence: 0.72, nodeId: "demo-node-insured" },
  { label: "pricing_page_signal", summary: "Three or more pricing-page visits in a week is the strongest booking signal in the workspace.", confidence: 0.81, nodeId: "demo-node-pricing" },
  { label: "multi_seat_expansion", summary: "Multi-seat teams expand rather than churn when contacted before renewal, not after.", confidence: 0.64, nodeId: "demo-node-expansion" },
  { label: "plain_text_preference", summary: "Plain-text email outperforms designed templates with technical buyers here.", confidence: 0.77, nodeId: "demo-node-plaintext" },
  { label: "tuesday_send_window", summary: "Tuesday and Wednesday mornings hold the highest reply rate for this audience.", confidence: 0.58, nodeId: "demo-node-timing" },
  { label: "trial_expiry_urgency", summary: "Trials contacted within 48 hours of expiry convert at roughly twice the base rate.", confidence: 0.69, nodeId: "demo-node-expiry" },
  { label: "champion_referral_path", summary: "Referrals from an existing champion close faster than any outbound sequence.", confidence: 0.74, nodeId: "demo-node-referral" },
];

/**
 * The conversation the workspace panel digests in the offline preview.
 *
 * The demo path has no persisted messages, so without this the panel's evidence
 * section would render empty here while being populated in production — the
 * exact way a preview lies about a new surface. Same shape as a real row, fed
 * from the same fixtures the rest of the demo conversation uses.
 */
export const DEMO_WORKSPACE_MESSAGES: ArcMessage[] = [
  {
    id: "demo-workspace-operator",
    conversationId: "demo-conversation",
    role: "operator",
    body: "Build the pricing-intent package for the high-intent accounts",
    status: "sent",
    agentTaskId: null,
    mentions: DEMO_SOURCES,
    media: [],
    steps: [],
    toolCalls: [],
    feedback: null,
    actions: [],
    suggestions: [],
    attachments: [],
    contextScopes: ["workspace", "crm", "campaigns"],
    createdAt: "2026-07-30T14:40:00.000Z",
  },
  {
    id: "demo-workspace-arc",
    conversationId: "demo-conversation",
    role: "arc",
    body: "",
    status: "complete",
    agentTaskId: null,
    mentions: [],
    media: [],
    steps: DEMO_STEPS,
    toolCalls: DEMO_TOOLS,
    recall: DEMO_RECALL,
    feedback: null,
    actions: [],
    suggestions: [],
    attachments: [],
    createdAt: "2026-07-30T14:41:00.000Z",
  },
];

/** Offline preview: mirrors the demo opportunity inbox so the launcher's "waiting
 *  on you" nudges render without a backend. */
export const DEMO_WAITING: ArcWaiting = {
  approvals: 3,
  opportunities: 6,
  items: [
    {
      id: "demo-opp-next-iteration-storm-prep",
      title: "Trial nurture is converting — draft the next iteration",
      urgency: "high",
      prompt:
        "Draft the next iteration of the Quarterly Nurture Refresh campaign based on what worked: For the next iteration, lead with Email, reuse “Trial-watch SMS nudge”. Keep it a draft for my approval.",
    },
    {
      id: "demo-opp-storm-riverside",
      title: "Usage dropped 40% — Riverside Labs trial at risk",
      urgency: "high",
      prompt: "Help me act on this opportunity: “Usage dropped 40% — Riverside Labs trial at risk”. What should we draft? Keep it a draft for my approval.",
    },
    {
      id: "demo-opp-partner-northside",
      title: "Larkfield Partners sent 3 referrals — no co-marketing in place",
      urgency: "medium",
      prompt: "Help me act on this opportunity: “Larkfield Partners sent 3 referrals — no co-marketing in place”. What should we draft? Keep it a draft for my approval.",
    },
  ],
};
