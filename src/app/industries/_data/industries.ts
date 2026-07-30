// Industry landing pages (BSR-584) — where the M3 universality work becomes
// demand. Priority order is from `docs/POSITIONING.md`: restoration first (it is
// where our only real tenant lives), then the home-services trades.
//
// THE CONSTRAINT THAT SHAPES THIS FILE
//
// The ticket's rule is "do not fake the screenshots — if a page shows a
// vertical's vocabulary, a workspace configured that way must actually exist and
// render." We satisfy it more strongly than a screenshot could: the vocabulary
// and persona blocks on every page are DERIVED AT BUILD TIME from the same
// modules the product uses — `getProductLanguage()` (src/lib/product-language.ts)
// and `personasForIndustry()` (src/lib/personas/industry-templates.ts). A page
// therefore cannot promise a vocabulary onboarding will not deliver: if someone
// edits the templates, these pages change with them or the build fails.
//
// So this file holds ONLY what genuinely varies by trade and cannot be derived —
// the situations, the detectors worth emphasising, and the worked example.
//
// WHAT WE DELIBERATELY DO NOT CLAIM
//
// Pipeline stages. `DEFAULT_PIPELINE_STAGES` (src/domain/pipeline-stages.ts) is
// ONE general set for every industry — a tenant can rename them (the stage
// manager shipped in BSR-495/563) but they do not arrive pre-configured per
// trade. Saying otherwise would be the exact broken promise this rule exists to
// prevent, so every page states plainly that stages are something you set.
//
// NOTE ON OVERLAP: roofing, HVAC/plumbing and commercial cleaning all resolve to
// the same `home_services` template. That is the truth about the product, and it
// means the derived blocks on those three pages are identical by design. Their
// substance has to come from the trade-specific fields below — three pages that
// differ only in the word "roofing" would be doorway pages, which rank badly and
// deserve to.

import type { ProductIndustryKey } from "@/lib/product-language";

export type IndustrySituation = { title: string; body: string };
export type IndustrySignal = { title: string; body: string };

export type Industry = {
  slug: string;
  /** Drives the derived vocabulary + persona blocks. Must be a real template key. */
  industryKey: ProductIndustryKey;
  /** The exact option label in the signup picker, so setup instructions are true. */
  industryLabel: string;
  /** How the trade refers to itself, used throughout the copy. */
  trade: string;
  shortLabel: string;
  title: string;
  titleAccent: string;
  metaTitle: string;
  metaDescription: string;
  lede: string;
  /** Three situations this trade actually recognises. The trade-specific core. */
  situations: IndustrySituation[];
  /** Detectors worth emphasising. Every one maps to a real OPPORTUNITY_KINDS entry. */
  signals: IndustrySignal[];
  /** A concrete walk-through, phrased as what would happen, not as a case study. */
  workedExample: { title: string; steps: string[] };
  lastReviewed: string;
};

const REVIEWED = "2026-07-30";

export const INDUSTRIES: Industry[] = [
  {
    slug: "restoration",
    industryKey: "restoration",
    industryLabel: "Restoration & property recovery",
    trade: "restoration contractors",
    shortLabel: "Restoration",
    title: "Marketing for restoration contractors.",
    titleAccent: "Built around the claim, not the calendar.",
    metaTitle: "Marketing Software for Restoration Contractors — Arc Studio",
    metaDescription:
      "Arc watches your past jobs, your referral partners, and the weather in your service area, then drafts the outreach. Nothing sends without your approval.",
    lede: "Restoration work arrives when something goes wrong, which makes conventional marketing calendars close to useless. What actually drives the next job is the referral relationship you have not touched in four months and the storm that just went through your territory.",
    situations: [
      {
        title: "The adjuster who stopped calling",
        body: "One agent used to send you three jobs a quarter and has sent none since spring. Nobody noticed because nobody is watching the gap between referrals — it is the absence of an event, and absences do not show up in a job list.",
      },
      {
        title: "The storm you found out about late",
        body: "Hail moved through half your service area on a Tuesday. The contractors who called their past customers that afternoon booked the week. You heard about it when a competitor's yard sign went up.",
      },
      {
        title: "Two hundred completed jobs, never contacted again",
        body: "Every one of them is a homeowner who already trusts you, sits in a neighbourhood you have worked, and knows people. They are the cheapest lead source you own and the one nobody has the hours to work.",
      },
    ],
    signals: [
      {
        title: "Severe weather in your service area",
        body: "Arc reads National Weather Service alerts for the points you actually serve, not whole states. Freeze warnings count too — burst pipes are a restoration event even though nothing blew over.",
      },
      {
        title: "Referral partners going quiet",
        body: "When an adjuster, agent, or property manager who used to send work stops sending it, that gap becomes an opportunity with the referral history attached.",
      },
      {
        title: "Past clients worth re-approaching",
        body: "Completed jobs aging past the point where a preventative inspection or a referral ask is welcome rather than pushy.",
      },
      {
        title: "A campaign worth running again",
        body: "When something outperformed your baseline, Arc proposes the repeat with what it learned — the angle that worked, the segment that responded.",
      },
    ],
    workedExample: {
      title: "What a storm week would look like",
      steps: [
        "A severe thunderstorm warning covers eleven of the ZIP codes you serve. Arc files an opportunity with the alert, the affected area, and the customers inside it.",
        "It drafts the package: an email to past clients in the footprint, an SMS for the ones who opted into it, and a short paid-social variant — each one carrying the proof photos you have already approved.",
        "It waits. Everything sits in approvals with the evidence attached and nothing has left the building.",
        "You read it on your phone between jobs, tighten one subject line, and approve. Arc sends, then tracks opens, clicks, and replies back onto each customer record.",
        "What happened gets recorded, so the next storm's draft starts from what worked in this one.",
      ],
    },
    lastReviewed: REVIEWED,
  },

  {
    slug: "roofing",
    industryKey: "home_services",
    industryLabel: "Home & field services",
    trade: "roofing companies",
    shortLabel: "Roofing",
    title: "Marketing for roofing companies.",
    titleAccent: "Storm-driven, without the storm chasers.",
    metaTitle: "Marketing Software for Roofing Companies — Arc Studio",
    metaDescription:
      "Arc turns your completed roofs, your neighbourhoods, and severe weather in your territory into approval-gated campaigns. You approve every message before it sends.",
    lede: "Roofing demand is lumpy and weather-driven, and the companies that win a storm are the ones already in front of the neighbourhood before the door-knockers arrive.",
    situations: [
      {
        title: "You already roofed the street",
        body: "Fourteen completed roofs within a mile of the hail track, every one a homeowner who has met your crew. That is the warmest list in the business and it is sitting in a job history nobody queries.",
      },
      {
        title: "Out-of-town crews got there first",
        body: "Storm chasers move fast because moving fast is the entire business model. Local reputation only beats them if the local company actually shows up in the inbox first.",
      },
      {
        title: "Inspections that never got followed up",
        body: "Someone declined a full replacement eighteen months ago and took the repair. That roof is now eighteen months older and the conversation is worth having again — but only if something remembers to have it.",
      },
    ],
    signals: [
      {
        title: "Hail and wind events in your territory",
        body: "Severe weather alerts scoped to the points you serve, matched against completed jobs and customers inside the affected area.",
      },
      {
        title: "Customers who have gone quiet",
        body: "Past inspections, declined quotes, and completed jobs aging past the point where a follow-up is worth making.",
      },
      {
        title: "Referral and partner lanes",
        body: "Property managers, insurance contacts, and general contractors who used to send work and have not lately.",
      },
      {
        title: "What your competitors are running",
        body: "Competitor activity in your market surfaces as a signal with the evidence attached, rather than as something you notice on a neighbour's lawn.",
      },
    ],
    workedExample: {
      title: "What the week after a hail event would look like",
      steps: [
        "Arc files an opportunity naming the affected ZIP codes, the completed roofs inside them, and the past customers attached to those addresses.",
        "It drafts neighbourhood-specific outreach — the copy references the actual event and date, not a generic storm-damage template.",
        "The package lands in approvals with the proof photos from jobs you already did nearby.",
        "You approve it, or you kill it because you know that neighbourhood took no real damage. Either way the decision is recorded and Arc learns from it.",
        "Replies and booked inspections attach to the customer records, so next season starts with evidence rather than a blank slate.",
      ],
    },
    lastReviewed: REVIEWED,
  },

  {
    slug: "hvac-plumbing",
    industryKey: "home_services",
    industryLabel: "Home & field services",
    trade: "HVAC and plumbing companies",
    shortLabel: "HVAC & plumbing",
    title: "Marketing for HVAC and plumbing.",
    titleAccent: "The service list is the pipeline.",
    metaTitle: "Marketing Software for HVAC and Plumbing Companies — Arc Studio",
    metaDescription:
      "Maintenance renewals, aging equipment, and the first freeze — Arc drafts the campaign from your own service history and waits for your approval before anything sends.",
    lede: "Most HVAC and plumbing companies are sitting on the best marketing list in their market — their own service history — and working it roughly never, because working it is a job nobody has time for.",
    situations: [
      {
        title: "Maintenance plans quietly lapsing",
        body: "Members who did not renew do not announce it. They simply stop appearing on the schedule, and by the time anyone notices they have been someone else's customer for a year.",
      },
      {
        title: "Equipment you installed reaching its age",
        body: "You know exactly what you put in and when. A fifteen-year-old system is a replacement conversation, and you are the company with the service record to have it.",
      },
      {
        title: "The first cold snap",
        body: "The week demand spikes is the week everyone is too busy to market. The campaign has to be drafted and approved before the temperature drops, not during.",
      },
    ],
    signals: [
      {
        title: "Customers who have gone quiet",
        body: "Lapsed maintenance members, service calls with no follow-up, and customers aging past their normal service interval.",
      },
      {
        title: "Weather worth acting on",
        body: "Freeze warnings and heat events scoped to the areas you serve — the trigger for the seasonal campaign you meant to send last year.",
      },
      {
        title: "Referral partners",
        body: "The plumbing, HVAC, and insurance referral flywheel — partners who used to send work, surfaced when the flow stops.",
      },
      {
        title: "Segments nobody is speaking to",
        body: "When a persona in your workspace has no campaign touching it, that gap is filed as an opportunity rather than going unnoticed.",
      },
    ],
    workedExample: {
      title: "What a pre-season campaign would look like",
      steps: [
        "Arc identifies members whose plans lapse in the next sixty days and systems it has on record passing their replacement window.",
        "It drafts a renewal message for one group and a replacement-conversation message for the other, because they are not the same customer.",
        "Both arrive in approvals with the service history that justified the list.",
        "You approve the renewals, revise the replacement copy because it reads too hard, and Arc re-drafts to your note.",
        "The first freeze warning arrives and the follow-up is already drafted, because Arc was watching for it.",
      ],
    },
    lastReviewed: REVIEWED,
  },

  {
    slug: "commercial-cleaning",
    industryKey: "home_services",
    industryLabel: "Home & field services",
    trade: "commercial cleaning and facilities companies",
    shortLabel: "Commercial cleaning",
    title: "Marketing for commercial cleaning.",
    titleAccent: "Contracts renew quietly. Or they don't.",
    metaTitle: "Marketing Software for Commercial Cleaning and Facilities — Arc Studio",
    metaDescription:
      "Contract renewals, multi-site expansion, and accounts drifting toward churn — Arc drafts the outreach from your own account history, gated behind your approval.",
    lede: "Commercial cleaning is a contract business, which means the revenue risk is not a missing lead — it is an account that stopped hearing from you nine months before the renewal.",
    situations: [
      {
        title: "The renewal you found out about at renewal",
        body: "A contract comes up in six weeks and the last real conversation was the onboarding call. The incumbent advantage is enormous and entirely wasted if the relationship went silent.",
      },
      {
        title: "One building out of five",
        body: "You clean one site for a company that operates five. Nobody has asked about the other four, because asking is a task without an owner.",
      },
      {
        title: "The facilities manager who changed jobs",
        body: "Your main contact moved to another company that also needs cleaning, and took no relationship with them because nothing prompted the conversation.",
      },
    ],
    signals: [
      {
        title: "Accounts going quiet",
        body: "Contract accounts with no logged interaction in a period that should have had several — the earliest visible churn signal you get.",
      },
      {
        title: "Expansion inside existing accounts",
        body: "Customers worth growing rather than replacing — additional sites, additional services, additional scope.",
      },
      {
        title: "Referral and partner lanes",
        body: "Property managers and facilities contacts who have sent work before and have not lately.",
      },
      {
        title: "A campaign worth running again",
        body: "When an approach beat your baseline, Arc proposes repeating it with the angle and segment that made it work.",
      },
    ],
    workedExample: {
      title: "What a renewal quarter would look like",
      steps: [
        "Arc surfaces contracts renewing in the next quarter that have had no substantive contact in ninety days, ranked by what they are worth.",
        "It drafts a check-in for each — grounded in that account's own service history, not a template that could go to anyone.",
        "For multi-site accounts it drafts a second message about the locations you do not currently service.",
        "Everything waits in approvals. You send the ones that are right, and kill the two where you know a check-in would land badly.",
        "Replies and meetings attach to the account, so the picture at renewal is a record rather than a recollection.",
      ],
    },
    lastReviewed: REVIEWED,
  },
];

export function getIndustry(slug: string): Industry | undefined {
  return INDUSTRIES.find((i) => i.slug === slug);
}

export const INDUSTRY_SLUGS = INDUSTRIES.map((i) => i.slug);
