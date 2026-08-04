import { canonicalIndustryKey } from "@/lib/product-language";
import { personasForIndustry } from "@/lib/personas/industry-templates";

import { type OpportunityRecord } from "./read-model";

/**
 * Read-only demo opportunity inbox. Used when Supabase is not configured (local
 * preview / ARC_DEMO_DATA) so the Opportunities screen — and the home hero
 * count, "open opportunities" list, and Signals rail that all read the same
 * source — render a populated, industry-aware inbox instead of empty states.
 *
 * The records span every card type the inbox classifies (weather, partner,
 * competitor, lifecycle, buyer intent) with full evidence so the impact/evidence
 * panels look real. Everything is display-only; nothing here sends anything.
 */

const DAY = 86_400_000;

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString();
}

function buildGenericDemoOpportunities(industry?: string | null): OpportunityRecord[] {
  const personas = personasForIndustry(canonicalIndustryKey(industry));
  const persona = (index: number) => personas[index]?.slug ?? personas[0]?.slug ?? "new-lead";
  const name = (index: number, fallback: string) => personas[index]?.name ?? fallback;

  return [
    {
      id: "demo-opp-high-intent-lead",
      subject_type: "lead",
      subject_id: "demo-lead-high-intent",
      title: `${name(0, "New lead")} returned to the pricing page three times`,
      summary:
        "A recent lead revisited pricing and implementation content across three sessions, then opened the comparison guide. Their activity suggests they are actively evaluating the next step.",
      confidence: 91,
      urgency: "high",
      status: "pending",
      recommended_action: "Offer a short, personalized consultation that answers the lead's remaining buying questions",
      evidence: {
        persona: persona(0),
        leadScore: 93,
        daysCold: 1,
        lastActivityAt: daysAgoIso(0),
        evidence_urls: [],
      },
    },
    {
      id: "demo-opp-customer-adoption",
      subject_type: "company",
      subject_id: "demo-account-adoption",
      title: `${name(1, "Active customer")} is ready for the next best offer`,
      summary:
        "This customer has strong recent engagement and has completed the core journey. Similar customers respond well when shown one clear next step tied to the value they already receive.",
      confidence: 84,
      urgency: "medium",
      status: "drafting",
      recommended_action: "Prepare a targeted adoption campaign around the most relevant next step",
      evidence: {
        persona: persona(1),
        leadScore: 86,
        lastActivityAt: daysAgoIso(2),
        evidence_urls: [],
      },
    },
    {
      id: "demo-opp-referral-champion",
      subject_type: "contact",
      subject_id: "demo-contact-champion",
      title: `${name(2, "Champion")} has shared positive feedback twice this month`,
      summary:
        "A highly engaged customer recently left positive feedback and mentioned your team in a public post. This is a natural moment for a thoughtful referral or advocacy ask.",
      confidence: 79,
      urgency: "medium",
      status: "pending",
      recommended_action: "Draft a referral campaign that makes it easy to introduce a peer",
      evidence: {
        persona: persona(2),
        leadScore: 88,
        lastActivityAt: daysAgoIso(3),
        evidence_urls: [],
      },
    },
    {
      id: "demo-opp-winback",
      subject_type: "company",
      subject_id: "demo-account-at-risk",
      title: `${name(3, "At-risk customer")} engagement dropped after a strong start`,
      summary:
        "A previously active customer has not returned in 45 days. Their earlier engagement was strong, so a useful, low-pressure reactivation message is more likely to work than a generic promotion.",
      confidence: 76,
      urgency: "medium",
      status: "drafted",
      campaign_id: "demo-customer-winback",
      recommended_action: "Re-engage with a useful reminder and one simple reason to return",
      evidence: {
        persona: persona(3),
        leadScore: 72,
        daysCold: 45,
        lastActivityAt: daysAgoIso(45),
        evidence_urls: [],
      },
    },
    {
      id: "demo-opp-competitor-positioning",
      subject_type: "competitor_signal",
      subject_id: "demo-competitor-positioning",
      title: "A competitor launched a new comparison campaign",
      summary:
        "A direct competitor began promoting a new comparison offer across paid social and search. A focused response can clarify your strongest differentiator without copying their message.",
      confidence: 72,
      urgency: "medium",
      status: "pending",
      recommended_action: "Create a proof-led campaign around the differentiator customers mention most",
      evidence: {
        persona: persona(0),
        competitor: "Direct competitor",
        channel: "paid_social",
        activityLevel: "high",
        creativeCount: 5,
        lastActivityAt: daysAgoIso(1),
        evidence_urls: ["https://www.facebook.com/ads/library/"],
      },
    },
  ];
}

function buildRestorationDemoOpportunities(): OpportunityRecord[] {
  return [
    {
      id: "demo-opp-next-iteration-storm-prep",
      subject_type: "campaign",
      subject_id: "demo-spring-storm-prep",
      title: "Spring Storm Prep is converting — draft the next iteration",
      summary:
        "Email booked 6 jobs from 45 leads. Next time, lead with Email and reuse “Storm-watch SMS nudge”. Arc can draft round two now — nothing sends until you approve it.",
      confidence: 90,
      urgency: "high",
      status: "pending",
      recommended_action:
        "Draft the next iteration — For the next iteration, lead with Email, reuse “Storm-watch SMS nudge”.",
      evidence: {
        persona: "persona_homeowner_emergency",
        campaignName: "Spring Storm Prep",
        topChannel: "Email",
        bookedJobs: 6,
        leads: 45,
        topAsset: "Storm-watch SMS nudge",
        arcPrompt:
          "Draft the next iteration of the Spring Storm Prep campaign based on what worked: For the next iteration, lead with Email, reuse “Storm-watch SMS nudge”. Keep it a draft for my approval.",
      },
    },
    {
      id: "demo-opp-storm-riverside",
      subject_type: "weather_event",
      subject_id: "demo-weather-riverside-flood",
      title: "Flash-flood warning — Riverside basements at risk",
      summary:
        "The NWS issued an overnight flash-flood warning for Riverside and Brookfield; 30+ homes in the coverage area sit in the flood plain. This pattern historically drives same-week water-mitigation calls.",
      confidence: 92,
      urgency: "high",
      status: "pending",
      recommended_action: "Launch a geo-targeted storm-response campaign to Riverside / Brookfield homeowners",
      evidence: {
        persona: "persona_homeowner_emergency",
        lastActivityAt: daysAgoIso(0),
        evidence_urls: ["https://www.weather.gov/lot/", "https://water.noaa.gov/"],
      },
    },
    {
      id: "demo-opp-news-hail",
      subject_type: "feed_item",
      subject_id: "https://news.example.com/naperville-hail-june",
      title: "Naperville Sun: 'Hailstorm damages hundreds of North Side roofs'",
      summary:
        "A watched news feed just published coverage of last night's hailstorm across Naperville's North Side. A timely post tying your inspection offer to the story reaches affected homeowners while it's front of mind.",
      confidence: 66,
      urgency: "medium",
      status: "pending",
      recommended_action: "Draft a timely post responding to this while it's fresh",
      evidence: {
        feedKind: "industry",
        source: "Naperville Sun",
        link: "https://news.example.com/naperville-hail-june",
        evidence_urls: ["https://news.example.com/naperville-hail-june"],
      },
    },
    {
      id: "demo-opp-intent-donovan",
      subject_type: "lead",
      subject_id: "demo-ld-donovan-basement",
      title: "Oak Park homeowner comparing water-damage estimates",
      summary:
        "The Donovan overnight basement-flood lead has visited the water-damage service page three times in two days and asked for a second quote. They're actively comparing estimates — speed of response is the deciding factor.",
      confidence: 88,
      urgency: "high",
      status: "pending",
      recommended_action: "Fast-track a same-day estimate to the Donovan lead with proof-of-work photos",
      evidence: {
        persona: "persona_homeowner_emergency",
        leadScore: 91,
        daysCold: 1,
        lastActivityAt: daysAgoIso(1),
        evidence_urls: ["https://bigshouldersrestoration.example/water-damage"],
      },
    },
    {
      id: "demo-opp-partner-northside",
      subject_type: "company",
      subject_id: "demo-co-northside-plumbing",
      title: "Northside Plumbing Co. sent 3 referrals — no co-marketing in place",
      summary:
        "Northside Plumbing Co. referred three water-backup jobs in the last month with no formal co-marketing agreement. Formalizing the pipeline protects the relationship before a competitor courts a Tier-A partner.",
      confidence: 78,
      urgency: "medium",
      status: "pending",
      recommended_action: "Draft a partner referral + co-marketing agreement for Northside Plumbing Co.",
      evidence: {
        persona: "persona_plumbing_partner",
        leadScore: 84,
        lastActivityAt: daysAgoIso(3),
        evidence_urls: ["https://northsideplumbing.example/service-area"],
      },
    },
    {
      id: "demo-opp-competitor-oakpark",
      subject_type: "competitor_signal",
      subject_id: "demo-competitor-servpro-oakpark",
      title: "ServPro is running ads in Oak Park — contested territory",
      summary:
        "Competitor ServPro launched a new paid-search and Meta flight targeting Oak Park water-damage queries this week. Arc's share of voice there is strong; a defensive push protects the lead flow.",
      confidence: 71,
      urgency: "medium",
      status: "drafting",
      recommended_action: "Prepare a defensive Oak Park search + social flight emphasizing 60-minute response",
      evidence: {
        persona: "persona_homeowner_emergency",
        lastActivityAt: daysAgoIso(1),
        evidence_urls: ["https://www.facebook.com/ads/library/"],
      },
    },
    {
      id: "demo-opp-lakeview-inspection",
      subject_type: "company",
      subject_id: "demo-co-lakeview-property",
      title: "Lakeview Property Mgmt portfolio due for annual moisture inspection",
      summary:
        "Lakeview Property Mgmt's 1,240-unit portfolio is approaching the anniversary of last year's moisture survey. An annual inspection offer keeps Arc front-of-mind with a Tier-A partner and surfaces new mitigation work.",
      confidence: 69,
      urgency: "medium",
      status: "drafted",
      campaign_id: "demo-emergency-water-response-2026",
      recommended_action: "Offer Lakeview an annual portfolio moisture-inspection package",
      evidence: {
        persona: "persona_property_manager",
        leadScore: 73,
        daysCold: 340,
        lastActivityAt: daysAgoIso(340),
        evidence_urls: [],
      },
    },
    {
      id: "demo-opp-harborpoint-quiet",
      subject_type: "company",
      subject_id: "demo-co-harborpoint-hoa",
      title: "Harbor Point HOA has gone quiet 90 days after mitigation",
      summary:
        "The Harbor Point HOA board hasn't been contacted since their basement mitigation wrapped. Post-job is the window for a preventative maintenance plan and referral ask before the relationship cools.",
      confidence: 64,
      urgency: "low",
      status: "pending",
      recommended_action: "Re-engage the Harbor Point board with a preventative maintenance + referral nurture",
      evidence: {
        persona: "persona_hoa_board",
        leadScore: 58,
        daysCold: 92,
        lastActivityAt: daysAgoIso(92),
        evidence_urls: [],
      },
    },
  ];
}

/**
 * Industry-aware, read-only demo inbox. Neutral growth examples are the default;
 * the original restoration showcase remains available with
 * `ARC_DEMO_INDUSTRY=restoration` for that vertical's sales demo.
 */
export function buildDemoOpportunities(
  industry: string | null | undefined = process.env.ARC_DEMO_INDUSTRY,
): OpportunityRecord[] {
  return canonicalIndustryKey(industry) === "restoration"
    ? buildRestorationDemoOpportunities()
    : buildGenericDemoOpportunities(industry);
}
