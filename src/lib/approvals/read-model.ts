import { toWorkState, WORK_STATE_LABEL } from "@/domain";
import { requireCount } from "@/lib/supabase/count";
import { type SupabaseClient } from "@supabase/supabase-js";

import { buildDemoCampaignWorkspaceList } from "../campaigns/read-model";
import { type CorrectionInput } from "@/domain";
import { isDemoDataEnabled } from "../demo/demo-mode";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "../supabase/server";

const ACTIVE_APPROVAL_STATUSES = [
  "needs_compliance",
  "pending_approval",
  "pending_owner_approval",
  "revision_requested",
] as const;

/**
 * The subset of the above that is genuinely waiting on the OPERATOR (BSR-753).
 *
 * `revision_requested` is active but not blocked on a human: the vocabulary
 * defines that state as "You asked for changes. Arc is reworking it." Counting
 * it in a badge headed "needs you" overstates the queue — on the live workspace
 * it was 3 of 7.
 *
 * `needs_compliance` IS one of them (BSR-755). It looked ambiguous — three
 * surfaces read it three ways — but the state machine settles it rather than
 * taste: the guardrail that sets it raises "Human review required", Arc "may
 * READ approvals and ADD a recommendation, but never decides", and nothing
 * redrafts the item. It sits untouched until a person approves, revises or
 * declines it, which is what blocked-on-the-operator means.
 *
 * A literal list because the query needs enum values. `approvals-desk.test.ts`
 * pins it against `toWorkState` so it cannot drift from the vocabulary.
 */
export const OPERATOR_BLOCKED_APPROVAL_STATUSES = [
  "needs_compliance",
  "pending_approval",
  "pending_owner_approval",
] as const;

/** Is this approval item waiting on a person, as opposed to on Arc? */
export function isWaitingOnOperator(status: string | null | undefined): boolean {
  return (OPERATOR_BLOCKED_APPROVAL_STATUSES as readonly string[]).includes((status ?? "").trim());
}

export type ApprovalQueueFilter = {
  statuses?: string[];
  limit?: number;
  orgId?: string;
  /** Operator-configured agent display name used in rendered source/author labels. */
  agentName?: string;
};

export type ApprovalCard = {
  id: string;
  type: string;
  title: string;
  previewText: string;
  status: string;
  statusLabel: string;
  riskLevel: string;
  persona: string;
  channel: string;
  sourceAgent: string;
  submittedAt: string;
  campaign: {
    id: string | null;
    name: string;
    status: string;
    objective: string;
  };
  asset: {
    id: string | null;
    type: string;
    title: string;
    status: string;
  };
  relatedRecords: {
    company: RelatedRecord | null;
    contact: RelatedRecord | null;
    lead: RelatedRecord | null;
  };
  promptInput: string;
  draftOutput: string;
  structuredDraft: ApprovalStructuredDraft | null;
  complianceFlags: string[];
  riskFlags: string[];
  recommendedAction: string;
  evidence: string[];
  creativeAssets: ApprovalCreativeAsset[];
};

export type RelatedRecord = {
  id: string;
  label: string;
  detail: string;
};

export type ApprovalStructuredDraft =
  | {
      kind: "partner_lead_list";
      leadListType: string;
      targetArcet: string;
      targetZips: string[];
      suggestedOwnerAction: string;
      candidates: ApprovalLeadCandidate[];
    }
  | {
      kind: "structured_fields";
      title: string;
      summary: string;
      sections: ApprovalStructuredSection[];
    };

export type ApprovalStructuredSection = {
  label: string;
  value: string;
};

export type ApprovalLeadCandidate = {
  companyName: string;
  persona: string;
  targetZips: string[];
  sourceUrl: string | null;
  sourceUrls: string[];
  phone: string | null;
  confidence: string | null;
  evidenceSummary: string;
  partnerScore: number | null;
  scoreFactors: string[];
  recommendedNextAction: string;
};

export type ApprovalCreativeAsset = {
  id: string;
  type: "image" | "video" | "embed" | "file" | "link";
  title: string;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string | null;
  description: string | null;
  source: string;
};

type JsonObject = Record<string, unknown>;

type ApprovalItemRow = {
  id: string;
  campaign_id: string | null;
  campaign_asset_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  lead_id: string | null;
  item_type: string;
  status: string;
  prompt_inputs: JsonObject | null;
  draft_output: string | null;
  edited_output: string | null;
  requested_by: string | null;
  locked_until_approved: boolean;
  submitted_at: string;
  risk_level: string;
  compliance_notes: string | null;
  decision_notes: string | null;
  reasoning_payload: JsonObject | null;
  audit_payload: JsonObject | null;
  created_at: string;
  updated_at: string;
};

type CampaignRow = {
  id: string;
  name: string;
  persona: string;
  status: string;
  objective: string | null;
  audience_summary: string | null;
  offer_summary: string | null;
  compliance_notes: string | null;
};

type CampaignAssetRow = {
  id: string;
  title: string;
  asset_type: string;
  channel: string | null;
  status: string;
  prompt_input: string | null;
  prompt_inputs: JsonObject | null;
  draft_body: string | null;
  edited_body: string | null;
  approved_body: string | null;
  compliance_notes: string | null;
  reasoning_payload: JsonObject | null;
  audit_payload: JsonObject | null;
};

type CompanyRow = {
  id: string;
  name: string;
  persona: string;
  partner_tier: string | null;
};

type ContactRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
};

type LeadRow = {
  id: string;
  source: string;
  status: string;
  lead_score: number;
  loss_summary: string | null;
  metadata: JsonObject | null;
};

type AgentOutputRow = {
  id: string;
  approval_item_id: string | null;
  output_type: string;
  title: string;
  body: string | null;
  risk_level: string;
  approval_status: string;
  structured_payload: JsonObject | null;
};

/** Lightweight head-only count of items awaiting a decision — for glanceable badges. */
export async function countActiveApprovals(
  orgId?: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<number> {
  return countApprovalsByStatus([...ACTIVE_APPROVAL_STATUSES], orgId, client, "countActiveApprovals");
}

/**
 * Count of approvals genuinely waiting on the operator — what a "needs you"
 * badge should show (BSR-753).
 *
 * A COUNT, not a list length. The nav badge previously read
 * `summary.approvals.length`, and that list is fetched with `limit: 5` — so the
 * badge was structurally incapable of exceeding 5 however much work was
 * waiting. On the live workspace it read 5 beside 7 active items, which looked
 * like a table mismatch and was really a page size.
 */
export async function countApprovalsWaitingOnOperator(
  orgId?: string,
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<number> {
  return countApprovalsByStatus(
    [...OPERATOR_BLOCKED_APPROVAL_STATUSES],
    orgId,
    client,
    "countApprovalsWaitingOnOperator",
  );
}

async function countApprovalsByStatus(
  statuses: string[],
  orgId: string | undefined,
  client: SupabaseClient,
  label: string,
): Promise<number> {
  const { count, error } = await applyOrgScope(
    client.from("approval_items").select("id", { count: "exact", head: true }),
    orgId,
  ).in("status", statuses);

  if (error) {
    throw new Error(`${label} failed: ${error.message}`);
  }

  // null count = missing/inaccessible relation, not zero rows (BSR-575).
  return requireCount("approval_items", { count, error });
}

/**
 * Demo approval queue derived from the same demo campaigns the Campaigns screen
 * renders — one card per pending deliverable — so the home "waiting on you"
 * count, the campaign rows' "N to approve", and this list all describe the same
 * work. Demo-only; the live path below is untouched.
 */
function buildDemoApprovalCards(filter: ApprovalQueueFilter = {}): ApprovalCard[] {
  const agentName = filter.agentName ?? "Arc";
  const list = buildDemoCampaignWorkspaceList(agentName);
  const campaigns = list.status === "live" ? list.campaigns : [];
  const cards: ApprovalCard[] = [];
  const HOUR = 3_600_000;
  for (const campaign of campaigns) {
    for (const deliverable of campaign.pendingDeliverables) {
      // Stagger recent submit times (2h, 9h, 16h…) so freshly-drafted approvals
      // read as just-in from Arc rather than inheriting the demo campaign's date.
      const submittedAt = new Date(Date.now() - (2 + cards.length * 7) * HOUR).toISOString();
      cards.push({
        id: `demo-approval-${campaign.id}-${deliverable.assetId}`,
        type: deliverable.kind,
        title: deliverable.title,
        previewText: campaign.previewText ?? deliverable.title,
        status: "pending_approval",
        statusLabel: WORK_STATE_LABEL.needs_you,
        riskLevel: "low",
        persona: campaign.persona,
        channel: campaign.previewLabel ?? deliverable.kind,
        sourceAgent: agentName,
        submittedAt,
        campaign: {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          objective: campaign.objective,
        },
        asset: {
          id: deliverable.assetId,
          type: deliverable.kind,
          title: deliverable.title,
          status: "pending_approval",
        },
        relatedRecords: { company: null, contact: null, lead: null },
        promptInput: "",
        draftOutput: campaign.previewText ?? "",
        structuredDraft: null,
        complianceFlags: [],
        riskFlags: [],
        recommendedAction: "Approve to unlock send",
        evidence: [],
        creativeAssets: [],
      });
    }
  }
  return cards.slice(0, filter.limit ?? 50);
}

export async function listApprovalCards(
  filter: ApprovalQueueFilter = {},
  providedClient?: SupabaseClient,
): Promise<ApprovalCard[]> {
  // Offline/demo: no admin client to query (resolving one would throw), so serve
  // the demo queue. Prod/tests pass a client or have Supabase configured.
  if (!providedClient && !isSupabaseAdminConfigured()) {
    return isDemoDataEnabled() ? buildDemoApprovalCards(filter) : [];
  }
  const client = providedClient ?? getSupabaseAdminClient();

  const statuses = filter.statuses ?? [...ACTIVE_APPROVAL_STATUSES];
  const limit = filter.limit ?? 50;
  const agentName = filter.agentName ?? "Agent";

  const query = applyOrgScope(
    client
      .from("approval_items")
      .select(
        "id,campaign_id,campaign_asset_id,company_id,contact_id,lead_id,item_type,status,prompt_inputs,draft_output,edited_output,requested_by,locked_until_approved,submitted_at,risk_level,compliance_notes,decision_notes,reasoning_payload,audit_payload,created_at,updated_at",
      ),
    filter.orgId,
  )
    .in("status", statuses)
    .order("submitted_at", { ascending: false })
    .limit(limit);

  const { data, error } = await query;

  if (error) {
    throw new Error(`listApprovalCards failed: ${error.message}`);
  }

  const approvalItems = (data ?? []) as ApprovalItemRow[];

  if (approvalItems.length === 0) {
    return [];
  }

  const [campaigns, assets, companies, contacts, leads, agentOutputs] = await Promise.all([
    fetchByIds<CampaignRow>(
      client,
      "campaigns",
      "id,name,persona,status,objective,audience_summary,offer_summary,compliance_notes",
      collectIds(approvalItems, "campaign_id"),
      filter.orgId,
    ),
    fetchByIds<CampaignAssetRow>(
      client,
      "campaign_assets",
      "id,title,asset_type,channel,status,prompt_input,prompt_inputs,draft_body,edited_body,approved_body,compliance_notes,reasoning_payload,audit_payload",
      collectIds(approvalItems, "campaign_asset_id"),
      filter.orgId,
    ),
    fetchByIds<CompanyRow>(client, "companies", "id,name,persona,partner_tier", collectIds(approvalItems, "company_id"), filter.orgId),
    fetchByIds<ContactRow>(client, "contacts", "id,full_name,email,phone,title", collectIds(approvalItems, "contact_id"), filter.orgId),
    fetchByIds<LeadRow>(client, "leads", "id,source,status,lead_score,loss_summary,metadata", collectIds(approvalItems, "lead_id"), filter.orgId),
    fetchAgentOutputs(client, approvalItems.map((item) => item.id), filter.orgId),
  ]);

  const campaignById = indexById(campaigns);
  const assetById = indexById(assets);
  const companyById = indexById(companies);
  const contactById = indexById(contacts);
  const leadById = indexById(leads);
  const outputByApprovalId = indexAgentOutputs(agentOutputs);

  return approvalItems.map((item) =>
    mapApprovalCard({
      item,
      campaign: item.campaign_id ? campaignById.get(item.campaign_id) : undefined,
      asset: item.campaign_asset_id ? assetById.get(item.campaign_asset_id) : undefined,
      company: item.company_id ? companyById.get(item.company_id) : undefined,
      contact: item.contact_id ? contactById.get(item.contact_id) : undefined,
      lead: item.lead_id ? leadById.get(item.lead_id) : undefined,
      agentOutput: outputByApprovalId.get(item.id),
      agentName,
    }),
  );
}

async function fetchByIds<Row extends { id: string }>(
  client: SupabaseClient,
  table: string,
  select: string,
  ids: string[],
  orgId?: string,
): Promise<Row[]> {
  if (ids.length === 0) {
    return [];
  }

  const { data, error } = await applyOrgScope(client.from(table).select(select).in("id", ids), orgId);

  if (error) {
    throw new Error(`${table} lookup failed: ${error.message}`);
  }

  return (data ?? []) as unknown as Row[];
}

async function fetchAgentOutputs(client: SupabaseClient, approvalItemIds: string[], orgId?: string): Promise<AgentOutputRow[]> {
  if (approvalItemIds.length === 0) {
    return [];
  }

  const { data, error } = await applyOrgScope(
    client
      .from("agent_outputs")
      .select("id,approval_item_id,output_type,title,body,risk_level,approval_status,structured_payload")
      .in("approval_item_id", approvalItemIds),
    orgId,
  ).order("created_at", { ascending: false });

  if (error) {
    throw new Error(`agent_outputs lookup failed: ${error.message}`);
  }

  return (data ?? []) as unknown as AgentOutputRow[];
}

function applyOrgScope<Query>(query: Query, orgId?: string): Query {
  if (!orgId) return query;
  return (query as { eq(column: string, value: string): Query }).eq("org_id", orgId);
}

function mapApprovalCard(input: {
  item: ApprovalItemRow;
  campaign?: CampaignRow;
  asset?: CampaignAssetRow;
  company?: CompanyRow;
  contact?: ContactRow;
  lead?: LeadRow;
  agentOutput?: AgentOutputRow;
  agentName?: string;
}): ApprovalCard {
  const { item, campaign, asset, company, contact, lead, agentOutput } = input;
  const agentName = input.agentName ?? "Agent";
  const promptInputs = mergeObjects(asset?.prompt_inputs, item.prompt_inputs);
  const reasoningPayload = item.reasoning_payload ?? {};
  const leadMetadata = lead?.metadata ?? {};
  const sourceData = getObject(reasoningPayload.source_data);
  const draftOutput = item.edited_output ?? item.draft_output ?? asset?.edited_body ?? asset?.draft_body ?? agentOutput?.body ?? "";
  const structuredDraft = buildStructuredDraft({
    draftOutput,
    structuredPayload: agentOutput?.structured_payload,
    reasoningPayload,
  });

  return {
    id: item.id,
    type: humanize(item.item_type),
    title: agentOutput?.title ?? asset?.title ?? campaign?.name ?? humanize(item.item_type),
    previewText: buildPreviewText(structuredDraft, draftOutput),
    status: item.status,
    statusLabel: statusLabel(item.status),
    riskLevel: item.risk_level,
    persona: campaign?.persona ?? company?.persona ?? getString(promptInputs.persona) ?? "unassigned",
    channel: asset?.channel ?? getString(promptInputs.channel) ?? "review",
    sourceAgent: item.requested_by ?? getString(item.audit_payload?.created_by_agent_id) ?? agentName,
    submittedAt: item.submitted_at,
    campaign: {
      id: campaign?.id ?? null,
      name: campaign?.name ?? "No campaign linked",
      status: campaign?.status ?? "unlinked",
      objective: campaign?.objective ?? "Review generated work before use.",
    },
    asset: {
      id: asset?.id ?? null,
      type: asset?.asset_type ?? item.item_type,
      title: asset?.title ?? agentOutput?.title ?? "Generated approval item",
      status: asset?.status ?? item.status,
    },
    relatedRecords: {
      company: company
        ? {
            id: company.id,
            label: company.name,
            detail: company.partner_tier ? `Tier ${company.partner_tier} partner candidate` : company.persona,
          }
        : null,
      contact: contact
        ? {
            id: contact.id,
            label: contact.full_name ?? contact.email ?? contact.phone ?? "Unnamed contact",
            detail: contact.title ?? contact.email ?? contact.phone ?? "Contact record",
          }
        : null,
      lead: lead
        ? {
            id: lead.id,
            label: `${lead.source} lead`,
            detail: `${lead.status}, score ${lead.lead_score}`,
          }
        : null,
    },
    promptInput: formatPromptInput(promptInputs, asset?.prompt_input),
    draftOutput,
    structuredDraft,
    complianceFlags: buildComplianceFlags(item, asset, campaign),
    riskFlags: buildRiskFlags(item, asset, lead),
    recommendedAction:
      getString(reasoningPayload.recommended_action) ??
      getString(leadMetadata.recommended_action) ??
      "Review the source data, edit if needed, then approve or request revision.",
    evidence: buildEvidence(leadMetadata, sourceData, structuredDraft),
    creativeAssets: buildCreativeAssets({
      promptInputs,
      reasoningPayload,
      auditPayload: item.audit_payload ?? {},
      assetReasoningPayload: asset?.reasoning_payload ?? {},
      agentStructuredPayload: agentOutput?.structured_payload ?? {},
      draftOutput,
      agentName,
    }),
  };
}

function collectIds(rows: ApprovalItemRow[], key: "campaign_id" | "campaign_asset_id" | "company_id" | "contact_id" | "lead_id") {
  return [...new Set(rows.map((row) => row[key]).filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function indexById<Row extends { id: string }>(rows: Row[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

function indexAgentOutputs(rows: AgentOutputRow[]) {
  const byApprovalId = new Map<string, AgentOutputRow>();

  for (const row of rows) {
    if (row.approval_item_id && !byApprovalId.has(row.approval_item_id)) {
      byApprovalId.set(row.approval_item_id, row);
    }
  }

  return byApprovalId;
}

function formatPromptInput(promptInputs: JsonObject, fallback?: string | null) {
  const entries = Object.entries(promptInputs)
    .filter(([, value]) => value !== null && value !== undefined && !isObject(value))
    .map(([key, value]) => `${humanize(key)}: ${String(value)}`);

  if (entries.length > 0) {
    return entries.join("\n");
  }

  return fallback ?? "No structured prompt input was captured.";
}

/**
 * Compliance flags for the queue card.
 *
 * The copy screen writes real, structured flags onto the asset when it runs, so
 * prefer those — they name what was actually found (e.g. a banned phrase). The
 * inference below is the fallback for rows written before the screen existed, or
 * by paths it doesn't cover: it guesses flags by regexing the prose of the
 * compliance note, which by construction cannot see a banned phrase at all.
 */
function buildComplianceFlags(item: ApprovalItemRow, asset?: CampaignAssetRow, campaign?: CampaignRow) {
  const screened = getArray(isObject(asset?.audit_payload) && isObject(asset.audit_payload.guardrail)
    ? asset.audit_payload.guardrail.flags
    : null,
  ).filter((flag): flag is string => typeof flag === "string" && flag.trim().length > 0);
  if (screened.length > 0) return screened;

  const flags = new Set<string>();
  for (const note of [item.compliance_notes, asset?.compliance_notes, campaign?.compliance_notes]) {
    if (!note) continue;
    if (/coverage-neutral/i.test(note)) flags.add("Coverage-neutral");
    if (/claim|insurance/i.test(note)) flags.add("Insurance language reviewed");
    if (/review before outbound|review before use/i.test(note)) flags.add("Human review required");
    if (/no .*promise|no .*guarantee/i.test(note)) flags.add("No guarantee language");
  }

  if (flags.size === 0) {
    flags.add("Needs compliance review");
  }

  return [...flags];
}

function buildRiskFlags(item: ApprovalItemRow, asset?: CampaignAssetRow, lead?: LeadRow) {
  const flags = new Set<string>();

  if (item.risk_level !== "low") {
    flags.add(`${humanize(item.risk_level)} risk`);
  }
  if (item.locked_until_approved !== false) {
    flags.add("Locked until approved");
  }
  if (asset?.status && asset.status !== "approved") {
    flags.add(`Asset ${humanize(asset.status)}`);
  }
  if (lead && lead.lead_score >= 80) {
    flags.add("High-value lead");
  }

  return [...flags];
}

function buildStructuredDraft(input: {
  draftOutput: string;
  structuredPayload?: JsonObject | null;
  reasoningPayload: JsonObject;
}): ApprovalStructuredDraft | null {
  const payloadDraft = getObject(input.structuredPayload?.draft_output);
  const reasoningDraft = getObject(input.reasoningPayload.draft_output);
  const parsedDraft = getObject(parseDraftJson(input.draftOutput));
  const candidateSource = [payloadDraft, reasoningDraft, parsedDraft].find(
    (draft) => Array.isArray(draft.candidates) || Array.isArray(draft.top_candidates),
  );

  if (!candidateSource) {
    return buildGenericStructuredDraft([payloadDraft, reasoningDraft, parsedDraft].find((draft) => Object.keys(draft).length > 0));
  }

  const rawCandidates = getArray(candidateSource.candidates).length > 0 ? getArray(candidateSource.candidates) : getArray(candidateSource.top_candidates);
  const candidates = rawCandidates
    .map(mapLeadCandidate)
    .filter((candidate): candidate is ApprovalLeadCandidate => Boolean(candidate));

  if (candidates.length === 0) {
    return null;
  }

  return {
    kind: "partner_lead_list",
    leadListType:
      getString(candidateSource.lead_list_type) ??
      (getString(candidateSource.bucket) ? `${getString(candidateSource.bucket)} recommendations` : "Partner lead recommendations"),
    targetArcet:
      getString(candidateSource.target_market) ??
      (getString(candidateSource.bucket) ? `Review ${humanize(getString(candidateSource.bucket) ?? "partner")} candidates before any external use.` : "Review partner lead recommendations before any external use."),
    targetZips: getArray(candidateSource.target_zips_used).filter(isString),
    suggestedOwnerAction: getString(candidateSource.suggested_owner_action) ?? "Review the list, approve enrichment, or request revisions.",
    candidates,
  };
}

function mapLeadCandidate(value: unknown): ApprovalLeadCandidate | null {
  if (!isObject(value)) {
    return null;
  }

  const companyName = getString(value.company_name) ?? getString(value.name);
  if (!companyName) {
    return null;
  }

  const sourceUrls = [
    getString(value.source_url),
    getString(value.website),
    ...getArray(value.sources).filter(isString),
  ].filter((url): url is string => Boolean(url));

  return {
    companyName,
    persona: getString(value.persona) ?? "Unassigned",
    targetZips: getArray(value.target_zips).filter(isString),
    sourceUrl: sourceUrls[0] ?? null,
    sourceUrls: [...new Set(sourceUrls)],
    phone: getString(value.phone) ?? null,
    confidence: getString(value.confidence) ?? null,
    evidenceSummary: getString(value.evidence_summary) ?? getString(value.notes) ?? "No evidence summary was provided.",
    partnerScore: getNumber(value.partner_score) ?? getNumber(value.score),
    scoreFactors: getArray(value.score_factors).filter(isString),
    recommendedNextAction: getString(value.recommended_next_action) ?? "Review before next action.",
  };
}

function buildGenericStructuredDraft(source: JsonObject | undefined): ApprovalStructuredDraft | null {
  if (!source) {
    return null;
  }

  const sections = Object.entries(source)
    .filter(([key, value]) => isReadableDraftKey(key) && value !== null && value !== undefined)
    .flatMap(([key, value]) => readableSectionsForValue(key, value))
    .slice(0, 12);

  if (sections.length === 0) {
    return null;
  }

  const summary =
    getString(source.summary) ??
    getString(source.headline) ??
    getString(source.title) ??
    getString(source.message) ??
    getString(source.body) ??
    sections[0]?.value ??
    "Structured draft captured.";

  return {
    kind: "structured_fields",
    title: getString(source.title) ?? getString(source.headline) ?? "Structured draft",
    summary,
    sections,
  };
}

function readableSectionsForValue(key: string, value: unknown): ApprovalStructuredSection[] {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [{ label: humanize(key), value: String(value) }];
  }

  if (Array.isArray(value)) {
    const readable = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    return readable.length > 0 ? [{ label: humanize(key), value: readable.join("\n") }] : [];
  }

  if (isObject(value)) {
    const nested = Object.entries(value)
      .filter(([nestedKey, nestedValue]) => isReadableDraftKey(nestedKey) && nestedValue !== null && nestedValue !== undefined && typeof nestedValue !== "object")
      .map(([nestedKey, nestedValue]) => `${humanize(nestedKey)}: ${String(nestedValue)}`)
      .join("\n");
    return nested ? [{ label: humanize(key), value: nested }] : [];
  }

  return [];
}

function isReadableDraftKey(key: string) {
  const normalized = key.toLowerCase();
  return (
    !normalized.endsWith("_id") &&
    !normalized.endsWith("_ids") &&
    normalized !== "id" &&
    !/payload|metadata|audit|candidate|top_candidates|media|creative|asset|attachment/.test(normalized)
  );
}

function parseDraftJson(value: string) {
  const firstBrace = value.indexOf("{");
  const lastBrace = value.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(value.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function buildCreativeAssets(input: {
  promptInputs: JsonObject;
  reasoningPayload: JsonObject;
  auditPayload: JsonObject;
  assetReasoningPayload: JsonObject;
  agentStructuredPayload: JsonObject;
  draftOutput: string;
  agentName?: string;
}): ApprovalCreativeAsset[] {
  const agentName = input.agentName ?? "Agent";
  const candidates: ApprovalCreativeAsset[] = [];
  const objects = [
    input.promptInputs,
    input.reasoningPayload,
    input.auditPayload,
    input.assetReasoningPayload,
    input.agentStructuredPayload,
    getObject(parseDraftJson(input.draftOutput)),
  ];

  for (const object of objects) {
    collectCreativeAssetsFromObject(object, candidates, `${agentName} output`);
  }

  for (const url of extractUrls(input.draftOutput)) {
    if (isMediaLikeUrl(url)) {
      candidates.push(createCreativeAsset({ url, source: "Draft body" }));
    }
  }

  const byUrl = new Map<string, ApprovalCreativeAsset>();
  for (const candidate of candidates) {
    if (!byUrl.has(candidate.url)) {
      byUrl.set(candidate.url, candidate);
    }
  }

  return [...byUrl.values()];
}

function collectCreativeAssetsFromObject(object: JsonObject, assets: ApprovalCreativeAsset[], source: string) {
  for (const [key, value] of Object.entries(object)) {
    if (Array.isArray(value) && isCreativeCollectionKey(key)) {
      for (const item of value) {
        const asset = mapCreativeAsset(item, source);
        if (asset) assets.push(asset);
      }
      continue;
    }

    if (isObject(value)) {
      const asset = isCreativeObjectKey(key) ? mapCreativeAsset(value, source) : null;
      if (asset) {
        assets.push(asset);
      }
      collectCreativeAssetsFromObject(value, assets, source);
      continue;
    }

    if (typeof value === "string" && isCreativeUrlKey(key) && isUrl(value)) {
      assets.push(createCreativeAsset({ url: value, source, title: humanize(key) }));
    }
  }
}

function mapCreativeAsset(value: unknown, source: string): ApprovalCreativeAsset | null {
  if (typeof value === "string" && isUrl(value)) {
    return createCreativeAsset({ url: value, source });
  }
  if (!isObject(value)) {
    return null;
  }

  const url =
    getString(value.url) ??
    getString(value.asset_url) ??
    getString(value.media_url) ??
    getString(value.image_url) ??
    getString(value.video_url) ??
    getString(value.preview_url) ??
    getString(value.file_url);

  if (!url || !isUrl(url)) {
    return null;
  }

  return createCreativeAsset({
    url,
    source,
    title: getString(value.title) ?? getString(value.name) ?? getString(value.label),
    description: getString(value.description) ?? getString(value.notes) ?? getString(value.caption),
    thumbnailUrl: getString(value.thumbnail_url) ?? getString(value.thumbnailUrl) ?? getString(value.poster_url) ?? null,
    mimeType: getString(value.mime_type) ?? getString(value.mimeType) ?? null,
    hintedType: getString(value.type) ?? getString(value.asset_type) ?? getString(value.media_type),
  });
}

function createCreativeAsset(input: {
  url: string;
  source: string;
  title?: string;
  description?: string | null;
  thumbnailUrl?: string | null;
  mimeType?: string | null;
  hintedType?: string;
}): ApprovalCreativeAsset {
  const type = classifyCreativeAsset(input.url, input.mimeType, input.hintedType);

  return {
    id: stableId(input.url),
    type,
    title: input.title ?? defaultCreativeTitle(type),
    url: input.url,
    thumbnailUrl: input.thumbnailUrl ?? null,
    mimeType: input.mimeType ?? null,
    description: input.description ?? null,
    source: input.source,
  };
}

function classifyCreativeAsset(url: string, mimeType?: string | null, hintedType?: string): ApprovalCreativeAsset["type"] {
  const hint = `${mimeType ?? ""} ${hintedType ?? ""}`.toLowerCase();
  const lowerUrl = url.toLowerCase();
  if (hint.includes("image") || /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/.test(lowerUrl)) return "image";
  if (hint.includes("video") || /\.(mp4|webm|mov|m4v)(\?|#|$)/.test(lowerUrl)) return "video";
  if (/youtube\.com|youtu\.be|vimeo\.com/.test(lowerUrl)) return "embed";
  if (/\.(pdf|docx?|pptx?)(\?|#|$)/.test(lowerUrl)) return "file";
  return "link";
}

function defaultCreativeTitle(type: ApprovalCreativeAsset["type"]) {
  if (type === "image") return "Image preview";
  if (type === "video" || type === "embed") return "Video preview";
  if (type === "file") return "Attached file";
  return "Creative link";
}

function isCreativeCollectionKey(key: string) {
  return /^(media|media_assets|creative_assets|creatives|attachments|previews|files|generated_assets|ad_assets)$/i.test(key);
}

function isCreativeObjectKey(key: string) {
  return /^(media|creative|attachment|preview|asset|image|video|file)$/i.test(key);
}

function isCreativeUrlKey(key: string) {
  return /^(image_url|video_url|media_url|asset_url|creative_url|preview_url|file_url)$/i.test(key);
}

function isMediaLikeUrl(url: string) {
  return classifyCreativeAsset(url) !== "link";
}

function extractUrls(value: string) {
  return value.match(/https?:\/\/[^\s"'<>),]+/g) ?? [];
}

function isUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function stableId(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return `creative-${hash.toString(36)}`;
}

function buildPreviewText(structuredDraft: ApprovalStructuredDraft | null, fallback: string) {
  if (structuredDraft?.kind === "partner_lead_list") {
    const topCandidates = structuredDraft.candidates
      .slice(0, 3)
      .map((candidate) => candidate.companyName)
      .join(", ");
    return `${structuredDraft.candidates.length} partner candidates: ${topCandidates}`;
  }

  if (structuredDraft?.kind === "structured_fields") {
    return structuredDraft.summary;
  }

  // Never surface a raw JSON blob in the inbox preview; pull a human field out
  // of it, or fall back to a plain label.
  const parsed = getObject(parseDraftJson(fallback));
  if (Object.keys(parsed).length > 0) {
    const summary =
      getString(parsed.summary) ??
      getString(parsed.headline) ??
      getString(parsed.target_market) ??
      getString(parsed.message) ??
      getString(parsed.body);
    return summary ?? "Generated draft - open to review the details.";
  }

  return fallback.trim() ? fallback : "Generated draft - open to review the details.";
}

function buildEvidence(leadMetadata: JsonObject, sourceData: JsonObject, structuredDraft?: ApprovalStructuredDraft | null) {
  const evidence = new Set<string>();
  const evidenceUrls = leadMetadata.evidence_urls;

  if (Array.isArray(evidenceUrls)) {
    for (const url of evidenceUrls) {
      if (typeof url === "string") evidence.add(url);
    }
  }

  for (const value of Object.values(sourceData)) {
    if (typeof value === "string" && value.startsWith("http")) {
      evidence.add(value);
    }
  }

  if (structuredDraft?.kind === "partner_lead_list") {
    for (const candidate of structuredDraft.candidates) {
      for (const url of candidate.sourceUrls) {
        evidence.add(url);
      }
    }
  }

  return [...evidence];
}

/** The stored status in the product's one vocabulary — see the twin in
 *  `campaigns/read-model.ts`. Approval items and campaign assets describe the
 *  same decision, so they must not describe it in different words. */
function statusLabel(status: string) {
  if (status === "needs_compliance") return "Blocked by a rule";
  return WORK_STATE_LABEL[toWorkState(status)];
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function mergeObjects(...objects: Array<JsonObject | null | undefined>) {
  return Object.assign({}, ...objects.filter((object): object is JsonObject => Boolean(object)));
}

function getObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function getString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ApprovalHistoryEntry = {
  id: string;
  approvalItemId: string;
  itemType: string;
  decision: string;
  decidedBy: string;
  decidedAt: string;
  decisionNotes: string | null;
  previousStatus: string | null;
  nextStatus: string;
  campaignId: string | null;
  campaignName: string | null;
  riskLevel: string | null;
};

export type ApprovalHistoryFilter = {
  campaignId?: string;
  limit?: number;
  orgId?: string;
};

/**
 * Read-only ledger of approval decisions, newest first. Powers the Activity page
 * and GET /api/v1/approvals/history. Two-step fetch (decisions -> items ->
 * campaigns) indexed by id, mirroring listApprovalCards; no outbound side effects.
 */
export async function listApprovalHistory(
  filter: ApprovalHistoryFilter = {},
  client: SupabaseClient = getSupabaseAdminClient(),
): Promise<ApprovalHistoryEntry[]> {
  const limit = filter.limit ?? 100;

  // When filtering by campaign, resolve that campaign's item ids first.
  let itemIdFilter: string[] | null = null;
  if (filter.campaignId) {
    const { data: campaignItems, error: campaignItemsError } = await client
      .from("approval_items")
      .select("id")
      .eq("campaign_id", filter.campaignId);
    if (campaignItemsError) {
      throw new Error(`approval_items by campaign failed: ${campaignItemsError.message}`);
    }
    itemIdFilter = (campaignItems ?? []).map((row: { id: string }) => row.id);
    if (itemIdFilter.length === 0) return [];
  }

  let decisionsQuery = applyOrgScope(
    client
      .from("approval_decisions")
      .select("id,approval_item_id,decision,decided_by,decided_at,decision_notes,previous_status,next_status"),
    filter.orgId,
  )
    .order("decided_at", { ascending: false })
    .limit(limit);
  if (itemIdFilter) {
    decisionsQuery = decisionsQuery.in("approval_item_id", itemIdFilter);
  }

  const { data: decisions, error: decisionsError } = await decisionsQuery;
  if (decisionsError) {
    throw new Error(`approval_decisions query failed: ${decisionsError.message}`);
  }
  const decisionRows = (decisions ?? []) as Array<{
    id: string;
    approval_item_id: string;
    decision: string;
    decided_by: string;
    decided_at: string;
    decision_notes: string | null;
    previous_status: string | null;
    next_status: string;
  }>;
  if (decisionRows.length === 0) return [];

  const itemIds = Array.from(new Set(decisionRows.map((row) => row.approval_item_id)));
  const { data: items, error: itemsError } = await client
    .from("approval_items")
    .select("id,item_type,risk_level,campaign_id")
    .in("id", itemIds);
  if (itemsError) {
    throw new Error(`approval_items lookup failed: ${itemsError.message}`);
  }
  const itemById = new Map<string, { item_type: string; risk_level: string | null; campaign_id: string | null }>(
    (items ?? []).map((row: { id: string; item_type: string; risk_level: string | null; campaign_id: string | null }) => [
      row.id,
      { item_type: row.item_type, risk_level: row.risk_level, campaign_id: row.campaign_id },
    ]),
  );

  const campaignIds = Array.from(
    new Set(Array.from(itemById.values()).map((i) => i.campaign_id).filter((id): id is string => Boolean(id))),
  );
  const campaignById = new Map<string, string>();
  if (campaignIds.length > 0) {
    const { data: campaigns, error: campaignsError } = await client.from("campaigns").select("id,name").in("id", campaignIds);
    if (campaignsError) {
      throw new Error(`campaigns lookup failed: ${campaignsError.message}`);
    }
    for (const row of (campaigns ?? []) as Array<{ id: string; name: string }>) {
      campaignById.set(row.id, row.name);
    }
  }

  return decisionRows.map((row) => {
    const item = itemById.get(row.approval_item_id) ?? null;
    const campaignId = item?.campaign_id ?? null;
    return {
      id: row.id,
      approvalItemId: row.approval_item_id,
      itemType: item?.item_type ?? "unknown",
      decision: row.decision,
      decidedBy: row.decided_by,
      decidedAt: row.decided_at,
      decisionNotes: row.decision_notes,
      previousStatus: row.previous_status,
      nextStatus: row.next_status,
      campaignId,
      campaignName: campaignId ? campaignById.get(campaignId) ?? null : null,
      riskLevel: item?.risk_level ?? null,
    };
  });
}

/**
 * The operator's recent corrections, for Arc's per-turn context (BSR-685).
 *
 * Reads the decision log rather than the items, because a correction is an
 * EVENT: the same asset can be sent back twice with different notes, and the
 * item only remembers the last one. `item_type` comes from a second read so a
 * note about a creative is not presented to Arc as copy guidance.
 *
 * Org-scoped, and that scoping is load-bearing rather than routine. The
 * archived demo org carries nine identical "Nightly smoke check — no action
 * needed" notes from the prod smoke workflow, one per night. Unscoped, those
 * would be nine-twelfths of everything Arc learned about being corrected.
 *
 * Fails soft to an empty list: this feeds a per-turn prompt, and a degraded
 * read must not take a turn down with it.
 */
export async function getRecentCorrections(
  orgId: string,
  client?: SupabaseClient,
  limit = 25,
): Promise<CorrectionInput[]> {
  if (!client && !isSupabaseAdminConfigured()) return [];
  try {
    const db = client ?? getSupabaseAdminClient();
    const { data: decisions, error } = await db
      .from("approval_decisions")
      .select("approval_item_id,decision,decided_at,decision_notes")
      .eq("org_id", orgId)
      .in("decision", ["revision_requested", "declined"])
      .not("decision_notes", "is", null)
      .order("decided_at", { ascending: false })
      .limit(limit);
    if (error || !decisions) return [];

    const rows = decisions as Array<{
      approval_item_id: string | null;
      decision: string;
      decided_at: string;
      decision_notes: string | null;
    }>;
    if (rows.length === 0) return [];

    const itemIds = [...new Set(rows.map((r) => r.approval_item_id).filter((v): v is string => Boolean(v)))];
    const typeById = new Map<string, string>();
    if (itemIds.length > 0) {
      const { data: items } = await db
        .from("approval_items")
        .select("id,item_type")
        .eq("org_id", orgId)
        .in("id", itemIds);
      for (const item of (items ?? []) as Array<{ id: string; item_type: string | null }>) {
        if (item.item_type) typeById.set(item.id, item.item_type);
      }
    }

    return rows.map((r) => ({
      decision: r.decision,
      note: r.decision_notes,
      itemType: r.approval_item_id ? typeById.get(r.approval_item_id) ?? null : null,
      decidedAt: r.decided_at,
    }));
  } catch {
    return [];
  }
}
