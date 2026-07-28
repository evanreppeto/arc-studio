// The backend-less demo data layer for the Arc chat. When no Supabase backend is
// present (the offline preview / `ARC_DEMO_DATA`), the view renders from these
// fixtures instead of live records. Pure data + one pure builder — no JSX, no I/O
// — so the demo path stays fully separable from the live path in arc-view.tsx.
//
// This is illustrative sample content for a demo tenant, not a hardcoded customer.

import type { ArcActionCard, ArcMention, ArcRecall } from "@/domain";
import type { ArcAttachment, ArcStep, ArcToolCall } from "@/lib/arc-chat/persistence";
import type { ArcRecentConversationVM, ArcThreadGroupVM } from "@/lib/arc-chat/read-model";

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

export const DEMO_RECENT_CONVERSATIONS: ArcRecentConversationVM[] = DEMO_THREADS
  .flatMap((group) => group.items)
  .slice(0, 3)
  .map(({ id, title, when }) => ({ id, title, when }));

export const DEMO_STEPS: ArcStep[] = [
  { label: "Read the pricing-intent brief", status: "done", at: "9:38 AM", kind: "think" },
  { label: "Matched high-intent accounts in CRM", status: "done", at: "9:38 AM", kind: "match" },
  { label: "Ranked accounts by demo urgency", status: "done", at: "9:38 AM", kind: "search" },
  { label: "Prepared a review-safe campaign package", status: "done", at: "9:38 AM", kind: "draft" },
];

export const DEMO_TOOLS: ArcToolCall[] = [
  { name: "weather.lookup", status: "complete", output: "pricing-page surge" },
  { name: "crm.search", status: "complete", output: "142 high-intent accounts" },
  { name: "audience.score", status: "complete", output: "$1.4M estimated opportunity" },
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
    flags: [{ tone: "ok", label: "Brand voice" }, { tone: "warn", label: "Needs image" }],
    approval: { kind: "campaign", campaignId: "demo-campaign", assetId: "demo-asset-social" },
  },
  {
    kind: "draft",
    title: "Demo landing page",
    channel: "Landing page",
    format: "Mobile-ready",
    status: "draft",
    preview: "Free personalized walkthrough for teams evaluating Meridian. See how it fits your workflow before your trial winds down.",
    rows: [{ name: "Destination", meta: "Campaign-matched" }],
    flags: [{ tone: "ok", label: "No overclaim" }],
    approval: { kind: "campaign", campaignId: "demo-campaign", assetId: "demo-asset-landing" },
  },
];

export const DEMO_ATTACHMENTS: ArcAttachment[] = [
  { url: "/brand/login-background-v2.png", name: "product-tour-reference.png", contentType: "image/png", objectPath: "demo-ref-1" },
];

export const DEMO_SOURCES: ArcMention[] = [
  { type: "property", id: "demo-prop", label: "142 high-intent accounts", href: "/crm/properties" },
  { type: "campaign", id: "demo-camp", label: "Pricing-Intent Fast Track", href: "/campaigns" },
  { type: "company", id: "demo-co", label: "High-intent accounts", href: "/crm/companies" },
];

export const DEMO_RECALL: ArcRecall[] = [
  { label: "Demo-first beats discount-led", confidence: 0.86, nodeId: "demo-node-inspection" },
  { label: "Active-trial segment books fastest", confidence: 0.72, nodeId: "demo-node-insured" },
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
        "Draft the next iteration of the Quarterly Nurture Refresh campaign based on what worked: For the next iteration, lead with Email, reuse “Trial-watch SMS nudge”. Keep it approval-gated.",
    },
    {
      id: "demo-opp-storm-riverside",
      title: "Usage dropped 40% — Riverside Labs trial at risk",
      urgency: "high",
      prompt: "Help me act on this opportunity: “Usage dropped 40% — Riverside Labs trial at risk”. What should we draft? Keep it approval-gated.",
    },
    {
      id: "demo-opp-partner-northside",
      title: "Larkfield Partners sent 3 referrals — no co-marketing in place",
      urgency: "medium",
      prompt: "Help me act on this opportunity: “Larkfield Partners sent 3 referrals — no co-marketing in place”. What should we draft? Keep it approval-gated.",
    },
  ],
};
