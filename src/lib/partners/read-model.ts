import { type SupabaseClient } from "@supabase/supabase-js";
import { reportDegraded } from "@/lib/observability/report-degraded";

import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "../supabase/server";

const ACTIVE_APPROVAL_STATUSES = new Set([
  "needs_compliance",
  "needs_review",
  "pending_approval",
  "pending_owner_approval",
  "revision_requested",
]);

export const PARTNER_TRACKS = [
  { label: "Plumbers", match: /plumb/i, cta: "Become a Partner" },
  { label: "Sewer/drain", match: /sewer|drain/i, cta: "Become a Partner" },
  { label: "HVAC", match: /hvac|heating|cooling/i, cta: "Become a Partner" },
  { label: "Roofers", match: /roof/i, cta: "Refer Water Damage" },
  { label: "Electricians", match: /electric/i, cta: "Become a Partner" },
  { label: "GCs", match: /general contractor|\bgc\b|contractor/i, cta: "Coordinate Rebuild" },
  { label: "Remodelers", match: /remodel|rebuild|construction/i, cta: "Coordinate Rebuild" },
  { label: "Insurance agents", match: /insurance|agent|broker/i, cta: "Refer a Client" },
  { label: "Property managers", match: /property manager|portfolio|facility|facilities/i, cta: "Request Vendor Packet" },
  { label: "Real estate agents", match: /real estate|realtor/i, cta: "Request Vendor Packet" },
  { label: "Landlords", match: /landlord|rental/i, cta: "Request Vendor Packet" },
  { label: "HOAs", match: /\bhoa\b|condo association|association/i, cta: "Request Vendor Packet" },
] as const;

export type PartnerTone = "amber" | "green" | "red" | "blue" | "gray";

export type PartnerCard = {
  id: string;
  name: string;
  href: string;
  websiteUrl: string | null;
  status: string;
  persona: string;
  partnerType: string;
  partnerTypeSource: "stored" | "inferred" | "missing";
  tier: string | null;
  score: number | null;
  scoreSource: string;
  scoreTone: PartnerTone;
  relationshipStage: string;
  nextAction: string;
  nextActionHref: string;
  nextActionSource: string;
  cta: string;
  contacts: number;
  leads: number;
  jobs: number;
  outcomes: number;
  campaigns: Array<{ id: string; name: string; status: string; href: string }>;
  approvals: Array<{ id: string; title: string; status: string; riskLevel: string; href: string | null }>;
  openApprovals: number;
  openActions: number;
  revenue: string;
  lastSignal: string;
  evidence: Array<{ label: string; href?: string | null; detail?: string | null }>;
  missingFields: string[];
  riskFlags: string[];
  summary: string;
};

export type PartnerDevelopmentDashboard =
  | {
      status: "live";
      partners: PartnerCard[];
      tracks: Array<{ label: string; count: number; cta: string }>;
      metrics: {
        partnerCandidates: number;
        scoredPartners: number;
        openApprovals: number;
        openActions: number;
        campaignLinks: number;
        totalRevenue: string;
      };
      strongestPartner: PartnerCard | null;
      dataContracts: Array<{ label: string; status: "live" | "needed"; detail: string }>;
    }
  | {
      status: "unavailable";
      message: string;
    };

type JsonObject = Record<string, unknown>;

type CompanyRow = {
  id: string;
  name: string;
  persona: string | null;
  status: string | null;
  website_url: string | null;
  phone: string | null;
  email: string | null;
  partner_tier: string | null;
  metadata: unknown;
  created_at: string | null;
  updated_at: string | null;
};

type ContactRow = {
  id: string;
  company_id: string | null;
  status: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  metadata: unknown;
};

type LeadRow = {
  id: string;
  company_id: string | null;
  persona: string | null;
  status: string | null;
  source: string | null;
  loss_summary: string | null;
  lead_score: number | null;
  metadata: unknown;
  received_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type JobRow = {
  id: string;
  company_id: string | null;
  lead_id: string | null;
  status: string | null;
  estimated_revenue_cents: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type OutcomeRow = {
  id: string;
  company_id: string | null;
  lead_id: string | null;
  status: string | null;
  gross_revenue_cents: number | null;
  closed_at: string | null;
  created_at: string | null;
};

type CampaignRow = {
  id: string;
  name: string;
  persona: string | null;
  status: string | null;
  company_id: string | null;
  lead_id: string | null;
  objective: string | null;
  updated_at: string | null;
};

type ApprovalRow = {
  id: string;
  campaign_id: string | null;
  company_id: string | null;
  lead_id: string | null;
  item_type: string | null;
  status: string | null;
  risk_level: string | null;
  prompt_inputs: unknown;
  submitted_at: string | null;
};

type PartnerHealthRow = {
  id: string;
  company_id: string | null;
  contact_id: string | null;
  persona: string | null;
  health_score: number | null;
  relationship_stage: string | null;
  trailing_90_day_referrals: number | null;
  trailing_90_day_won_revenue_cents: number | null;
  last_referral_at: string | null;
  recommended_action: string | null;
  risk_flags: string[] | null;
  reasoning_payload: unknown;
  created_at: string | null;
};

type NextBestActionRow = {
  id: string;
  approval_item_id: string | null;
  company_id: string | null;
  campaign_id: string | null;
  lead_id: string | null;
  title: string | null;
  action_type: string | null;
  status: string | null;
  priority: number | null;
  approval_required: boolean | null;
  recommendation: string | null;
  reason: string | null;
  due_at: string | null;
  updated_at: string | null;
};

export async function getPartnerDevelopmentDashboard(client?: SupabaseClient, agentName = "Arc"): Promise<PartnerDevelopmentDashboard> {
  if (!client && !isSupabaseAdminConfigured()) {
    return { status: "unavailable", message: "Supabase env vars are not configured." };
  }

  try {
    const supabase = client ?? getSupabaseAdminClient();
    const [companiesResult, contactsResult, leadsResult, jobsResult, outcomesResult, campaignsResult, approvalsResult, health, actions] =
      await Promise.all([
        supabase
          .from("companies")
          .select("id,name,persona,status,website_url,phone,email,partner_tier,metadata,created_at,updated_at")
          .order("updated_at", { ascending: false })
          .limit(250),
        supabase
          .from("contacts")
          .select("id,company_id,status,title,email,phone,metadata")
          .limit(500),
        supabase
          .from("leads")
          .select("id,company_id,persona,status,source,loss_summary,lead_score,metadata,received_at,created_at,updated_at")
          .order("updated_at", { ascending: false })
          .limit(500),
        supabase
          .from("jobs")
          .select("id,company_id,lead_id,status,estimated_revenue_cents,created_at,updated_at")
          .limit(500),
        supabase
          .from("outcomes")
          .select("id,company_id,lead_id,status,gross_revenue_cents,closed_at,created_at")
          .limit(500),
        supabase
          .from("campaigns")
          .select("id,name,persona,status,company_id,lead_id,objective,updated_at")
          .order("updated_at", { ascending: false })
          .limit(250),
        supabase
          .from("approval_items")
          .select("id,campaign_id,company_id,lead_id,item_type,status,risk_level,prompt_inputs,submitted_at")
          .order("submitted_at", { ascending: false })
          .limit(250),
        optionalSelect<PartnerHealthRow>(
          supabase,
          "partner_health_snapshots",
          "id,company_id,contact_id,persona,health_score,relationship_stage,trailing_90_day_referrals,trailing_90_day_won_revenue_cents,last_referral_at,recommended_action,risk_flags,reasoning_payload,created_at",
          "created_at",
        ),
        optionalSelect<NextBestActionRow>(
          supabase,
          "next_best_actions",
          "id,approval_item_id,company_id,campaign_id,lead_id,title,action_type,status,priority,approval_required,recommendation,reason,due_at,updated_at",
          "updated_at",
        ),
      ]);

    assertResult("companies", companiesResult.error);
    assertResult("contacts", contactsResult.error);
    assertResult("leads", leadsResult.error);
    assertResult("jobs", jobsResult.error);
    assertResult("outcomes", outcomesResult.error);
    assertResult("campaigns", campaignsResult.error);
    assertResult("approval_items", approvalsResult.error);

    const bundle = {
      companies: (companiesResult.data ?? []) as CompanyRow[],
      contacts: (contactsResult.data ?? []) as ContactRow[],
      leads: (leadsResult.data ?? []) as LeadRow[],
      jobs: (jobsResult.data ?? []) as JobRow[],
      outcomes: (outcomesResult.data ?? []) as OutcomeRow[],
      campaigns: (campaignsResult.data ?? []) as CampaignRow[],
      approvals: (approvalsResult.data ?? []) as ApprovalRow[],
      health,
      actions,
    };
    const partners = buildPartnerCards(bundle, agentName);

    return {
      status: "live",
      partners,
      tracks: PARTNER_TRACKS.map((track) => ({
        label: track.label,
        cta: track.cta,
        count: partners.filter((partner) => partner.partnerType === track.label).length,
      })),
      metrics: {
        partnerCandidates: partners.length,
        scoredPartners: partners.filter((partner) => typeof partner.score === "number").length,
        openApprovals: partners.reduce((sum, partner) => sum + partner.openApprovals, 0),
        openActions: partners.reduce((sum, partner) => sum + partner.openActions, 0),
        campaignLinks: partners.reduce((sum, partner) => sum + partner.campaigns.length, 0),
        totalRevenue: formatMoney(partners.reduce((sum, partner) => sum + moneyToCents(partner.revenue), 0)),
      },
      strongestPartner: partners[0] ?? null,
      dataContracts: buildDataContracts(partners, health.length, actions.length, agentName),
    };
  } catch (error) {
    // Degrade, but not silently — this read IS the screen, so an empty
    // state here is indistinguishable from an outage (BSR-544).
    reportDegraded(error, { scope: "partners.getPartnerDevelopmentDashboard", surface: "primary" });
    return { status: "unavailable", message: error instanceof Error ? error.message : "Partner development data is unavailable." };
  }
}

function buildPartnerCards(input: {
  companies: CompanyRow[];
  contacts: ContactRow[];
  leads: LeadRow[];
  jobs: JobRow[];
  outcomes: OutcomeRow[];
  campaigns: CampaignRow[];
  approvals: ApprovalRow[];
  health: PartnerHealthRow[];
  actions: NextBestActionRow[];
}, agentName = "Arc"): PartnerCard[] {
  const candidates = input.companies.filter((company) => {
    const metadata = asObject(company.metadata);
    return Boolean(
      company.partner_tier ||
        isPartnerPersona(company.persona) ||
        inferPartnerTrack(company, metadata).source !== "missing" ||
        getNumber(metadata.partner_score) ||
        input.health.some((snapshot) => snapshot.company_id === company.id),
    );
  });

  const visibleCompanies = candidates.length > 0 ? candidates : input.companies.slice(0, 25);

  return visibleCompanies
    .map((company) => {
      const metadata = asObject(company.metadata);
      const contacts = input.contacts.filter((contact) => contact.company_id === company.id);
      const leads = input.leads.filter((lead) => lead.company_id === company.id);
      const leadIds = new Set(leads.map((lead) => lead.id));
      const jobs = input.jobs.filter((job) => job.company_id === company.id || (job.lead_id ? leadIds.has(job.lead_id) : false));
      const outcomes = input.outcomes.filter((outcome) => outcome.company_id === company.id || (outcome.lead_id ? leadIds.has(outcome.lead_id) : false));
      const campaigns = input.campaigns.filter((campaign) => campaign.company_id === company.id || (campaign.lead_id ? leadIds.has(campaign.lead_id) : false));
      const campaignIds = new Set(campaigns.map((campaign) => campaign.id));
      const approvals = input.approvals.filter((approval) => {
        if (approval.company_id === company.id) return true;
        if (approval.lead_id && leadIds.has(approval.lead_id)) return true;
        return Boolean(approval.campaign_id && campaignIds.has(approval.campaign_id));
      });
      const health = input.health.find((snapshot) => snapshot.company_id === company.id);
      const action = input.actions
        .filter((item) => item.company_id === company.id || (item.lead_id ? leadIds.has(item.lead_id) : false) || (item.campaign_id ? campaignIds.has(item.campaign_id) : false))
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
      const track = inferPartnerTrack(company, metadata);
      const score = health?.health_score ?? getNumber(metadata.partner_score) ?? scoreFromTier(company.partner_tier) ?? scoreFromLeads(leads);
      const evidence = buildEvidence(company, metadata, leads);
      const openApprovals = approvals.filter((approval) => ACTIVE_APPROVAL_STATUSES.has(approval.status ?? "")).length;
      const revenueCents =
        health?.trailing_90_day_won_revenue_cents ??
        outcomes.reduce((sum, outcome) => sum + (outcome.gross_revenue_cents ?? 0), 0);
      const nextAction = buildNextAction({ action, health, score, contacts: contacts.length, evidence: evidence.length, approvals: openApprovals }, agentName);
      const missingFields = buildMissingFields({ track, score, contacts: contacts.length, evidence: evidence.length, nextActionSource: nextAction.source, health });
      const riskFlags = uniqueStrings([...(health?.risk_flags ?? []), ...getStringArray(metadata.risk_flags)]);
      const lastSignal = mostRecentDate([
        company.updated_at,
        health?.last_referral_at,
        health?.created_at,
        ...leads.map((lead) => lead.updated_at ?? lead.received_at ?? lead.created_at),
        ...campaigns.map((campaign) => campaign.updated_at),
        ...approvals.map((approval) => approval.submitted_at),
      ]);

      return {
        id: company.id,
        name: company.name,
        href: `/crm/companies/${company.id}`,
        websiteUrl: company.website_url,
        status: humanize(company.status ?? "active"),
        persona: humanize(company.persona ?? "unassigned_persona"),
        partnerType: track.label,
        partnerTypeSource: track.source,
        tier: company.partner_tier,
        score,
        scoreSource: health?.health_score ? "Partner health snapshot" : getNumber(metadata.partner_score) ? "Company metadata" : company.partner_tier ? "Partner tier" : leads.length > 0 ? "Lead score average" : "Missing",
        scoreTone: scoreTone(score),
        relationshipStage: health?.relationship_stage ?? getString(metadata.relationship_stage) ?? relationshipStageFor(company, leads, campaigns, openApprovals),
        nextAction: nextAction.text,
        nextActionHref: nextAction.href,
        nextActionSource: nextAction.source,
        cta: track.cta,
        contacts: contacts.length,
        leads: leads.length,
        jobs: jobs.length,
        outcomes: outcomes.length,
        campaigns: campaigns.slice(0, 3).map((campaign) => ({
          id: campaign.id,
          name: cleanName(campaign.name),
          status: humanize(campaign.status ?? "draft"),
          href: `/campaigns/${campaign.id}`,
        })),
        approvals: approvals.slice(0, 4).map((approval) => ({
          id: approval.id,
          title: approvalTitle(approval),
          status: humanize(approval.status ?? "pending_approval"),
          riskLevel: humanize(approval.risk_level ?? "medium"),
          href: approval.campaign_id ? `/campaigns/${approval.campaign_id}` : null,
        })),
        openApprovals,
        openActions: input.actions.filter((item) => item.company_id === company.id && ["open", "queued", "pending"].includes(item.status ?? "open")).length,
        revenue: formatMoney(revenueCents),
        lastSignal: formatDate(lastSignal ?? company.updated_at ?? company.created_at),
        evidence,
        missingFields,
        riskFlags,
        summary: partnerSummary({ company, track, score, leads, campaigns, approvals, revenueCents }),
      };
    })
    .sort((a, b) => partnerPriority(b) - partnerPriority(a))
    .slice(0, 30);
}

function buildNextAction(input: {
  action?: NextBestActionRow;
  health?: PartnerHealthRow;
  score: number | null;
  contacts: number;
  evidence: number;
  approvals: number;
}, agentName = "Arc") {
  if (input.action) {
    return {
      text: input.action.recommendation ?? input.action.title ?? `Review ${agentName}'s recommended partner action.`,
      source: "next_best_actions",
      href: input.action.campaign_id ? `/campaigns/${input.action.campaign_id}` : "/arc",
    };
  }
  if (input.health?.recommended_action) {
    return { text: input.health.recommended_action, source: "partner_health_snapshots", href: "/arc" };
  }
  if (input.approvals > 0) {
    return { text: `Review the open approval packet before ${agentName} prepares anything else.`, source: "approval queue", href: "/campaigns" };
  }
  if (input.contacts === 0) {
    return { text: `Ask ${agentName} to enrich a decision-maker and evidence before outreach copy.`, source: "missing contact", href: "/arc" };
  }
  if (input.evidence === 0) {
    return { text: `Ask ${agentName} to attach source evidence and classify the partner fit.`, source: "missing evidence", href: "/arc" };
  }
  if (typeof input.score !== "number") {
    return { text: `Ask ${agentName} to score partner fit and create an approval-gated recommendation.`, source: "missing score", href: "/arc" };
  }
  return { text: "Prepare an approval-gated partner campaign brief. No outbound execution.", source: "safe default", href: "/campaigns" };
}

function inferPartnerTrack(company: CompanyRow, metadata: JsonObject) {
  const stored = getString(metadata.partner_type) ?? getString(metadata.partner_category) ?? getString(metadata.relationship_type);
  if (stored) {
    const track = PARTNER_TRACKS.find((item) => item.match.test(stored)) ?? PARTNER_TRACKS.find((item) => item.label.toLowerCase() === stored.toLowerCase());
    return { label: track?.label ?? humanize(stored), cta: track?.cta ?? "Review Partner Fit", source: "stored" as const };
  }

  const searchable = [company.name, company.persona, getString(metadata.industry), getString(metadata.company_type), getString(metadata.notes)]
    .filter(Boolean)
    .join(" ");
  const inferred = PARTNER_TRACKS.find((track) => track.match.test(searchable));

  if (inferred) {
    return { label: inferred.label, cta: inferred.cta, source: "inferred" as const };
  }

  return { label: "Needs classification", cta: "Review Partner Fit", source: "missing" as const };
}

function buildEvidence(company: CompanyRow, metadata: JsonObject, leads: LeadRow[]) {
  const urls = uniqueStrings([
    company.website_url,
    ...getStringArray(metadata.evidence_urls),
    ...getStringArray(metadata.source_urls),
    ...leads.flatMap((lead) => getStringArray(asObject(lead.metadata).evidence_urls)),
    ...leads.flatMap((lead) => getStringArray(asObject(lead.metadata).source_urls)),
  ]);
  const notes = uniqueStrings([
    ...getStringArray(metadata.evidence_notes),
    ...getStringArray(metadata.proof_points),
    ...leads.flatMap((lead) => getStringArray(asObject(lead.metadata).proof_points)),
  ]);

  return [
    ...urls.slice(0, 5).map((url) => ({ label: sourceLabel(url), href: url, detail: "Evidence link" })),
    ...notes.slice(0, 3).map((note) => ({ label: "Evidence note", detail: note })),
  ];
}

function buildMissingFields(input: {
  track: ReturnType<typeof inferPartnerTrack>;
  score: number | null;
  contacts: number;
  evidence: number;
  nextActionSource: string;
  health?: PartnerHealthRow;
}) {
  const missing: string[] = [];
  if (input.track.source === "missing") missing.push("partner_type");
  if (typeof input.score !== "number") missing.push("partner_score");
  if (input.contacts === 0) missing.push("linked_contact");
  if (input.evidence === 0) missing.push("evidence_urls");
  if (!input.health) missing.push("partner_health_snapshot");
  if (input.nextActionSource === "safe default" || input.nextActionSource.startsWith("missing")) missing.push("next_best_action");
  return missing;
}

function relationshipStageFor(company: CompanyRow, leads: LeadRow[], campaigns: CampaignRow[], openApprovals: number) {
  if (openApprovals > 0) return "Needs human review";
  if (campaigns.length > 0) return "Campaign development";
  if (leads.length > 0) return "Lead-linked partner";
  if (company.partner_tier) return `Tier ${company.partner_tier} partner`;
  return "Discovery";
}

function partnerSummary(input: {
  company: CompanyRow;
  track: ReturnType<typeof inferPartnerTrack>;
  score: number | null;
  leads: LeadRow[];
  campaigns: CampaignRow[];
  approvals: ApprovalRow[];
  revenueCents: number;
}) {
  const parts = [
    `${input.company.name} is in the ${input.track.label} lane.`,
    typeof input.score === "number" ? `Current partner score is ${input.score}.` : "Partner score is not captured yet.",
    input.leads.length > 0 ? `${input.leads.length} linked lead signal${input.leads.length === 1 ? "" : "s"}.` : "No linked leads yet.",
    input.campaigns.length > 0 ? `${input.campaigns.length} campaign package${input.campaigns.length === 1 ? "" : "s"} attached.` : "No campaign package attached.",
    input.approvals.some((approval) => ACTIVE_APPROVAL_STATUSES.has(approval.status ?? "")) ? "Open approval work needs human review." : "No active approval blocker found.",
    input.revenueCents > 0 ? `${formatMoney(input.revenueCents)} linked revenue.` : "No linked revenue yet.",
  ];

  return parts.join(" ");
}

function buildDataContracts(partners: PartnerCard[], healthCount: number, actionCount: number, agentName = "Arc") {
  return [
    { label: "Company partner records", status: partners.length > 0 ? "live" : "needed", detail: "companies plus partner_tier/persona classify candidate partners." },
    { label: "Relationship health", status: healthCount > 0 ? "live" : "needed", detail: "partner_health_snapshots stores health score, stage, referrals, revenue, and risk flags." },
    { label: `${agentName} next actions`, status: actionCount > 0 ? "live" : "needed", detail: "next_best_actions stores internal recommendations without outbound execution." },
    { label: "Campaign and approval links", status: partners.some((partner) => partner.campaigns.length > 0 || partner.approvals.length > 0) ? "live" : "needed", detail: "campaigns and approval_items link work back to company_id or lead_id." },
  ] as Array<{ label: string; status: "live" | "needed"; detail: string }>;
}

async function optionalSelect<T>(client: SupabaseClient, table: string, columns: string, orderBy: string): Promise<T[]> {
  const { data, error } = await client.from(table).select(columns).order(orderBy, { ascending: false }).limit(250);
  if (error) return [];
  return (data ?? []) as T[];
}

function assertResult(label: string, error: { message?: string } | null) {
  if (error) {
    throw new Error(`${label} lookup failed: ${error.message ?? "Unknown Supabase error"}`);
  }
}

function partnerPriority(partner: PartnerCard) {
  return (partner.score ?? 0) + partner.openApprovals * 12 + partner.openActions * 8 + partner.campaigns.length * 5 + partner.leads * 3;
}

function isPartnerPersona(persona: string | null | undefined) {
  return /partner|plumb|sewer|drain|insurance|property_manager|contractor|realtor|hoa|landlord/i.test(persona ?? "");
}

function scoreFromTier(tier: string | null) {
  if (tier === "A") return 90;
  if (tier === "B") return 75;
  if (tier === "C") return 58;
  return null;
}

function scoreFromLeads(leads: LeadRow[]) {
  const scores = leads.map((lead) => lead.lead_score).filter((score): score is number => typeof score === "number");
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function scoreTone(score: number | null): PartnerTone {
  if (typeof score !== "number") return "gray";
  if (score >= 80) return "green";
  if (score >= 60) return "blue";
  if (score >= 40) return "amber";
  return "red";
}

function approvalTitle(approval: ApprovalRow) {
  const prompt = asObject(approval.prompt_inputs);
  return getString(prompt.title) ?? getString(prompt.campaign_name) ?? getString(prompt.subject) ?? `${humanize(approval.item_type ?? "approval")} review`;
}

function mostRecentDate(values: Array<string | null | undefined>) {
  const dates = values
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return dates[0]?.toISOString() ?? null;
}

function cleanName(name: string) {
  return name
    .replace(/\s*[-\u2013]\s*\d{4}-\d{2}-\d{2}\s*$/, "")
    .replace(/\s+\d{12,}\s*$/, "")
    .trim() || name;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function moneyToCents(value: string) {
  const parsed = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function sourceLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Evidence link";
  }
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
