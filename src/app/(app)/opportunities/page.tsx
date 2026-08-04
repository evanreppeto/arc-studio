import { buildCampaignSeedFromOpportunity, humanizePersonaLabel, definitionText,} from "@/domain";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { crmRecordHref, listOpenOpportunities, type OpportunityRecord } from "@/lib/opportunities/read-model";
import { getLastScanStatus } from "@/lib/opportunities/scan-status";
import { personasForIndustry } from "@/lib/personas/industry-templates";
import { getOrgPersonaOptions } from "@/lib/personas/read-model";
import { canonicalIndustryKey } from "@/lib/product-language";

import { classify } from "./classify";
import { extraEvidenceRows } from "./evidence";
import { humanizeArcProse, isMachineText, rowName, rowQualifier } from "./prose";
import { scanStatusLine } from "./scan-status-copy";
import { OpportunityInbox, type OpportunityVM } from "./_components/opportunity-inbox";

export const metadata = { title: "Opportunities — Arc Studio" };

function humanize(value: string): string {
  const s = (value || "").replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function humanizePersona(persona: string): string {
  const label = humanizePersonaLabel(persona);
  return /^unassigned/i.test(label) ? "" : label;
}


function urgencyTone(urgency: OpportunityRecord["urgency"]): OpportunityVM["urgencyTone"] {
  return urgency === "high" ? "red" : urgency === "medium" ? "amber" : "info";
}

function campaignTypes(urgency: OpportunityRecord["urgency"]): string[] {
  if (urgency === "high") return ["Rapid response", "Geo-targeted"];
  if (urgency === "medium") return ["Targeted outreach"];
  return ["Nurture sequence"];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Short chip label for opportunities Arc has already begun/finished drafting. */
function statusLabel(status: string): string | null {
  if (status === "drafting") return "Drafting…";
  if (status === "drafted") return "Drafted";
  // The read model wakes a snooze once it expires, so a card can come back with
  // its stored status still "snoozed". Say so, rather than letting it reappear
  // looking like a brand-new signal the operator has never seen.
  if (status === "snoozed") return "Back from snooze";
  return null;
}

/**
 * Approval-routing timeline. Once a draft exists the first step reads as
 * complete ("Draft created") and the pending gate becomes the human approval —
 * keeping the card honest with the campaign's launch-locked state.
 */
function buildRouting(status: string): OpportunityVM["routing"] {
  if (status === "drafting") {
    return [
      { step: "You", note: "Requested a draft", done: true },
      { step: "Arc", note: "Preparing the campaign draft", done: false },
      { step: "Workspace approval", note: "Required before anything sends", done: false },
    ];
  }
  if (status === "drafted") {
    return [
      { step: "You", note: "Draft created", done: true },
      { step: "Workspace approval", note: "Awaiting approval — nothing sends yet", done: false },
    ];
  }
  return [
    { step: "You", note: "Reviewing now", done: true },
    { step: "Workspace approval", note: "Required before anything sends", done: false },
  ];
}

function toVM(rec: OpportunityRecord, allowedPersonaKeys?: readonly string[]): OpportunityVM {
  const ev = rec.evidence ?? {};
  const persona = humanizePersona(ev.persona ?? "");
  // Arc's generative scan writes titles and summaries carrying ids, tool names,
  // and column names. Strip those tokens before display — the claims themselves
  // are left exactly as Arc wrote them. Classification reads the ORIGINAL text,
  // so cleaning it can never move a card into a different bucket.
  const { icon, typeLabel } = classify(`${rec.title} ${rec.summary}`, rec.subject_type);
  const title = humanizeArcProse(rec.title) || rec.title;
  const urgencyLabel = humanize(rec.urgency) || "Medium";
  // "feed_item" humanizes to "Feed item", which reads as jargon in the list row —
  // give it the same friendly name the detail's type chip uses.
  const sourceLabel = rec.subject_type === "feed_item" ? "News" : humanize(rec.subject_type) || "Arc";
  const confidence = Math.round(rec.confidence);
  // Abbreviated for the row: the title already spells it out, and the list is
  // scanned, not read.
  const staleLabel = typeof ev.daysCold === "number" ? `last contacted ${ev.daysCold}d ago` : null;

  // A next-iteration opportunity points back at the campaign it learned from;
  // CRM subjects resolve to their record route.
  const recordHref =
    rec.subject_type === "campaign" ? `/campaigns/${encodeURIComponent(rec.subject_id)}` : crmRecordHref(rec.subject_type, rec.subject_id);
  const recordNoun =
    rec.subject_type === "campaign"
      ? "source campaign"
      : rec.subject_type === "lead"
        ? "lead"
        : rec.subject_type === "contact"
          ? "contact"
          : "company";

  const evidence: OpportunityVM["evidence"] = [];
  // Weather-event signals (kind='weather_event').
  if (ev.eventType) evidence.push({ label: "Alert", value: humanize(ev.severity ?? "") ? `${ev.eventType} (${humanize(ev.severity ?? "")})` : ev.eventType });
  // A heat card and a hail card look alike once rendered, and the claim each makes
  // is different — say which demand this alert was surfaced for.
  if (ev.category) evidence.push({ label: "Signal type", value: humanize(ev.category) });
  if (ev.area) evidence.push({ label: "Coverage area", value: ev.area });
  if (Array.isArray(ev.zipCodes) && ev.zipCodes.length) evidence.push({ label: "ZIPs", value: ev.zipCodes.slice(0, 6).join(", ") });
  // Competitor signals (kind='competitor_signal').
  if (ev.competitor) evidence.push({ label: "Competitor", value: ev.competitor });
  if (ev.channel) evidence.push({ label: "Channel", value: humanize(ev.channel) });
  if (typeof ev.creativeCount === "number" && ev.creativeCount > 0) {
    evidence.push({ label: "Active creatives", value: `${ev.creativeCount}${ev.activityLevel ? ` (${humanize(ev.activityLevel)} activity)` : ""}` });
  }
  if (Array.isArray(ev.keywords) && ev.keywords.length) evidence.push({ label: "Keywords", value: ev.keywords.slice(0, 4).join(", ") });
  // Feed/news signals (kind='news_signal'). Arc's generative scan reuses `source`
  // for the tools it happened to call — "read_recent_activity + query_brain(…)" —
  // which is not a source an operator can go and check.
  if (ev.source && !isMachineText(ev.source)) evidence.push({ label: "Source", value: ev.source });
  if (Array.isArray(ev.matchedKeywords) && ev.matchedKeywords.length) {
    evidence.push({ label: "Matched terms", value: ev.matchedKeywords.slice(0, 4).join(", ") });
  }
  // Next-iteration signals (kind='next_iteration').
  if (ev.topChannel) {
    const booked = typeof ev.bookedJobs === "number" ? ev.bookedJobs : 0;
    const leads = typeof ev.leads === "number" ? ev.leads : 0;
    evidence.push({
      label: "Top channel",
      value: booked > 0 ? `${ev.topChannel} — ${booked} booked from ${leads} leads` : `${ev.topChannel} — ${leads} leads`,
    });
  }
  if (ev.topAsset) evidence.push({ label: "Best asset", value: ev.topAsset });
  // Cold-lead / lifecycle signals.
  if (typeof ev.leadScore === "number") evidence.push({ label: "Lead score", value: `${Math.round(ev.leadScore)} / 100` });
  if (typeof ev.daysCold === "number") {
    evidence.push({
      label: "Last contacted",
      value: ev.daysCold === 1 ? "1 day ago" : `${ev.daysCold} days ago`,
      hint: definitionText("last_contacted"),
    });
  }
  if (ev.lastActivityAt) evidence.push({ label: "Last activity", value: formatDate(ev.lastActivityAt) });
  if (persona) evidence.push({ label: "Persona match", value: persona });
  if (Array.isArray(ev.evidence_urls) && ev.evidence_urls.length) {
    evidence.push({ label: "Sources", value: `${ev.evidence_urls.length} reference link${ev.evidence_urls.length === 1 ? "" : "s"}` });
  }
  // The rows above cover the deterministic detectors, whose keys are fixed. Arc's
  // generative scan names its own key per finding, so anything unclaimed gets a
  // generic row — otherwise the evidence that justifies the card dies in the jsonb.
  evidence.push(...extraEvidenceRows(ev));


  // Deterministic seed for the "Create campaign" confirm modal (persona enum,
  // inferred focus, name). Computed server-side so the modal can pre-fill it.
  // Seeded from the cleaned text: the draft's default name is derived from the
  // title, and a campaign called "…(campaign 0bd41cb3-ff30…)" is a name nobody
  // would keep.
  const seed = buildCampaignSeedFromOpportunity({
    title,
    summary: humanizeArcProse(rec.summary) || rec.summary,
    recommendedAction: humanizeArcProse(rec.recommended_action) || rec.recommended_action,
    urgency: rec.urgency,
    persona: ev.persona,
    recommendedCampaignType: null,
  }, allowedPersonaKeys);

  return {
    id: rec.id,
    name: rowName(title),
    // The staleness field already says "last contacted 30d ago"; repeating the
    // title's own "— quiet 30 days" tail beside it is noise.
    qualifier: staleLabel ? null : rowQualifier(title),
    title,
    confidence,
    urgencyTone: urgencyTone(rec.urgency),
    urgencyLabel,
    typeLabel,
    icon,
    sourceLabel,
    staleLabel,
    summary: humanizeArcProse(rec.summary) || rec.summary,
    recommendedAction: humanizeArcProse(rec.recommended_action) || rec.recommended_action,
    persona,
    personaHref: persona ? "/personas" : null,
    recordHref,
    recordLabel: recordHref ? `Open the ${recordNoun} record` : null,
    audienceNote: persona ? "Primary persona Arc matched to this signal" : `Source: ${sourceLabel}`,
    campaignTypes: campaignTypes(rec.urgency),
    evidence,
    routing: buildRouting(rec.status),
    status: rec.status,
    statusLabel: statusLabel(rec.status),
    campaignHref: rec.campaign_id ? `/campaigns/${rec.campaign_id}` : null,
    seed: { name: seed.name, persona: seed.persona, campaignTheme: seed.campaignTheme },
  };
}

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ selected?: string }>;
}) {
  const ctx = await getCurrentWorkspaceContext();
  const [records, storedPersonaOptions, params, scanStatus] = await Promise.all([
    listOpenOpportunities(undefined, ctx.orgId).catch(() => [] as OpportunityRecord[]),
    // Correctly silent (BSR-546): picker options, as on /campaigns.
    getOrgPersonaOptions(ctx.orgId).catch(() => []),
    searchParams,
    // Also correctly silent: without scan history the inbox still works, it just
    // has nothing to say about Arc's last pass.
    getLastScanStatus(ctx.orgId),
  ]);
  const demoPersonaOptions = personasForIndustry(canonicalIndustryKey(process.env.ARC_DEMO_INDUSTRY))
    .map((persona) => ({ key: persona.slug, label: persona.name }));
  const personaOptions = storedPersonaOptions.length > 0
    ? storedPersonaOptions
    : isDemoDataEnabled()
      ? demoPersonaOptions
      : [];
  const opps = records.map((record) => toVM(record, personaOptions.map((persona) => persona.key)));

  return (
    <OpportunityInbox
      opps={opps}
      personaOptions={personaOptions}
      selectedId={params.selected}
      scanStatus={scanStatusLine(scanStatus)}
    />
  );
}
