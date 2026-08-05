import { type SupabaseClient } from "@supabase/supabase-js";

import { arcAssetStatusFromDb, arcFindingSeverity, campaignDriver, deriveCampaignRollup, describeExternalMediaProvenance, type ArcAssetStatus, type CampaignDriver, type CampaignRollup, type ViralityScore,
  parseConsideredAudiences,
  humanizeArcProse,
  isFixKind,
  type InlineFix,
  normalizeHandoffNote,
  toWorkState,
  WORK_STATE_LABEL,
  type ConsideredAudience,
  type ArcDraftFinding,
} from "@/domain";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { personasForIndustry } from "@/lib/personas/industry-templates";
import { reportDegraded } from "@/lib/observability/report-degraded";
import { canonicalIndustryKey } from "@/lib/product-language";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "../supabase/server";

export const CAMPAIGN_SELECT =
  "id,name,persona,campaign_theme,restoration_focus,status,company_id,contact_id,lead_id,owner,objective,audience_summary,offer_summary,compliance_notes,considered_audiences,handoff_note,launch_locked,source_signal,source_system,reasoning_payload,audit_payload,created_at,updated_at";
export const ASSET_SELECT =
  "id,campaign_id,asset_type,channel,title,status,tool_source,prompt_input,prompt_inputs,draft_body,edited_body,approved_body,dispatch_locked,compliance_notes,reasoning_payload,audit_payload,created_at,updated_at";
const APPROVAL_SELECT =
  "id,campaign_id,campaign_asset_id,company_id,contact_id,lead_id,item_type,status,locked_until_approved,prompt_inputs,draft_output,edited_output,requested_by,submitted_at,risk_level,compliance_notes,decision_notes,reasoning_payload,audit_payload,created_at,updated_at";
const OUTPUT_SELECT =
  "id,task_id,approval_item_id,campaign_asset_id,output_type,title,body,edited_body,structured_payload,risk_level,compliance_status,approval_status,created_at,updated_at";
const AGENT_TASK_SELECT = "id,objective,task_type,status,priority,metadata,created_at,updated_at";
const DECISION_SELECT = "id,approval_item_id,decision,decided_by,decided_at,decision_notes,previous_status,next_status";
const RECOMMENDATION_SELECT = "id,approval_item_id,agent,recommendation,rationale,risk_flags,suggested_edits,created_at";
const FINDING_SELECT =
  "id,campaign_asset_id,severity,status,matched_text,finding_message,created_at,fix_target,fix_label,fix_kind";

export type CampaignWorkspaceAssetCategory = "physical" | "virtual" | "ads" | "media" | "other";

/**
 * Where a media asset came from — the trust signal that decides whether it may
 * render as campaign creative.
 * - `attached`  : an explicit creative reference (a `media`/`creative_assets`
 *                 collection, or an `image_url`-style key). Intentional, renders.
 * - `generated` : an attached asset that carries generation provenance
 *                 (job/model/prompt). Renders, badged as AI-generated.
 * - `referenced`: a bare URL scraped out of free-text prose (a draft body or a
 *                 reasoning payload). NEVER rendered as creative — this is the
 *                 source of fabricated "fake images".
 */
export type CampaignMediaOrigin = "attached" | "generated" | "referenced";

export type CampaignMediaAsset = {
  id: string;
  type: "image" | "video" | "embed" | "file" | "link";
  origin: CampaignMediaOrigin;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string | null;
  description: string | null;
  source: string;
  /** Virality prediction (video) or computed creative-quality proxy (image),
   *  carried from the asset's audit_payload media block. Null when unscored. */
  virality: ViralityScore | null;
  /** External lineage rows (same tuple shape as the Library card): tool/model,
   *  source job, original location. Empty when the entry declared none. */
  lineage: Array<[string, string]>;
  /** Generation prompt when the source tool declared one. */
  prompt: string | null;
  /** Declared aspect ratio as the producer recorded it ("4:3", "9:16"). This is
   *  the entry's own claim, not a measurement — `media_assets.width/height` are
   *  unpopulated (BSR-652), so there is nothing to verify it against. Null when
   *  the producer declared none. */
  format: string | null;
  /** Risk flags recorded against THIS asset ("privacy/redaction", embedded
   *  text, claim risk). Distinct from the deliverable's guardrail notes: these
   *  name the specific image. Empty when none were recorded — which is not the
   *  same as reviewed-and-clean. */
  riskFlags: string[];
  /** The `media_assets` row this creative came from, when the producer recorded
   *  the link. Null for entries written before the id was threaded through, and
   *  for anything that never went through the Library. */
  libraryAssetId: string | null;
  /** Storage path of the object. The only join key that exists on entries with
   *  no `libraryAssetId`, which today is most of them. */
  storagePath: string | null;
  /** This asset's own review decision. */
  review: CampaignMediaReview;
};

/**
 * Review state for one media asset.
 *
 * `unreviewed` is the honest default and by far the common case: asset review
 * writes to `approval_items` with a `media_asset_id`, and there are zero such
 * rows in prod — the path is built and has never run. An asset with no approval
 * row has NOT been reviewed and cleared; it has not been looked at. Those two
 * must never render the same.
 */
export type CampaignMediaReviewState = "unreviewed" | "pending" | "approved" | "declined" | "needs_revision" | "archived";

export type CampaignMediaReview = {
  state: CampaignMediaReviewState;
  /** Who decided. Null while unreviewed, and null on a row that recorded no reviewer. */
  reviewer: string | null;
  reviewedAt: string | null;
  notes: string | null;
};

const UNREVIEWED: CampaignMediaReview = { state: "unreviewed", reviewer: null, reviewedAt: null, notes: null };

/**
 * Media that is allowed to render as campaign creative. `referenced` media —
 * URLs scavenged from prose — is excluded so fabricated images never surface.
 */
export function renderableMedia(media: CampaignMediaAsset[]): CampaignMediaAsset[] {
  return media.filter((asset) => asset.origin !== "referenced");
}

/**
 * Map an `approval_items.status` onto the review state the campaign surface
 * shows. Anything unrecognized becomes `pending` rather than a decision — an
 * unknown status is not evidence that someone approved something.
 */
export function mediaReviewStateFromStatus(status: string | null | undefined): CampaignMediaReviewState {
  const s = (status ?? "").toLowerCase();
  if (/approved/.test(s)) return "approved";
  if (/declined|rejected/.test(s)) return "declined";
  if (/revision/.test(s)) return "needs_revision";
  if (/archiv/.test(s)) return "archived";
  return "pending";
}

export type CampaignWorkspaceListItem = {
  id: string;
  name: string;
  persona: string;
  status: string;
  lifecycle: CampaignLaunchState["lifecycle"];
  pendingCount: number;
  /**
   * Approved / non-archived deliverable counts, straight off `buildLaunchState`
   * — the SAME numbers the campaign's own detail page renders in `.cstate`.
   *
   * The board must not compute this from `rollup` instead. The two disagree:
   * `buildLaunchState` counts built assets and drops archived ones, while
   * `deriveCampaignRollup` also counts standalone approvals (those with no
   * `campaign_asset_id`). One live campaign has 6 assets and 1 standalone
   * approval, so the rollup says 7 where the detail page says 6 — two answers
   * to one question, on two screens, about one campaign.
   */
  approvedCount: number;
  requiredCount: number;
  pendingDeliverables: PendingDeliverable[];
  /**
   * Empty string when the campaign has no objective — NOT a placeholder
   * sentence. This used to be `campaign.objective ?? "No objective captured
   * yet."`, which is a non-null string, so every `objective || theme || …`
   * fallback a caller wrote was dead on arrival and three of five live rows
   * spent their subtitle announcing that a field was blank.
   */
  objective: string;
  /** The operator/Arc-supplied theme. Required at creation, so this is the
   *  reliable thing to say when there is no objective. */
  campaignTheme: string;
  /** Timing of the signal this campaign was built from, when it had one. */
  signal: CampaignSourceSignal | null;
  audienceSummary: string;
  offerSummary: string;
  /** Null when Arc recorded no reasoning — see `CampaignWorkspaceReasoning`. */
  whyBuilt: string | null;
  assetCount: number;
  approvalCount: number;
  mediaCount: number;
  sourceCount: number;
  thumbnailUrl: string | null;
  assetTypes: string[];
  /** "operator" | "agent" — who is driving, for the card avatar. */
  driver: CampaignDriver;
  /** Distinct channel labels for the card subline, e.g. ["Meta", "Email"]. */
  channels: string[];
  previewText: string | null;
  previewLabel: string | null;
  contentPieces: CampaignListContentPiece[];
  updatedAt: string;
  updatedAtIso: string;
  href: string;
  rollup: CampaignRollup;
};

/**
 * The timing Arc recorded on the signal that produced a campaign.
 *
 * Shape censused against the live workspace: `urgency` sits at the top level of
 * `campaigns.source_signal` and the timing under `evidence`
 * (`{origin, urgency, evidence: {eventType, severity, startsAt, endsAt, …}}`).
 * Both levels are read anyway — this column is agent-written JSON with no
 * constraint behind it, and a key that moves should degrade to null rather than
 * throw.
 */
export type CampaignSourceSignal = {
  urgency: string | null;
  eventType: string | null;
  startsAtIso: string | null;
  endsAtIso: string | null;
};

/** Null when the campaign carries no signal timing at all — most of them. An
 *  operator-created package has no window to close. */
export function parseCampaignSourceSignal(raw: unknown): CampaignSourceSignal | null {
  const root = asObject(raw);
  const evidence = asObject(root.evidence);
  const pick = (key: string) => getString(evidence[key]) ?? getString(root[key]);

  const signal: CampaignSourceSignal = {
    urgency: pick("urgency"),
    eventType: pick("eventType") ?? pick("event_type"),
    startsAtIso: pick("startsAt") ?? pick("starts_at"),
    endsAtIso: pick("endsAt") ?? pick("ends_at"),
  };
  return Object.values(signal).some(Boolean) ? signal : null;
}

export type CampaignListContentPiece = {
  id: string;
  title: string;
  kind: string;
  channel: string;
  status: string;
  preview: string;
  media: CampaignMediaAsset[];
  updatedAt: string;
  needsReview: boolean;
};

export type CampaignWorkspaceList =
  | {
      status: "live";
      campaigns: CampaignWorkspaceListItem[];
      totals: {
        campaigns: number;
        assets: number;
        approvals: number;
        media: number;
      };
    }
  | {
      status: "unavailable";
      message: string;
    };

export type CampaignWorkspaceAsset = {
  id: string;
  title: string;
  assetType: string;
  category: CampaignWorkspaceAssetCategory;
  channel: string;
  status: string;
  body: string;
  preview: string;
  complianceNotes: string;
  /** The copy screen's verdict, carried from audit_payload.guardrail — written when
   *  the asset entered the approval queue. Empty when no screen ran (no active
   *  Brand Kit, or an asset with no copy). */
  guardrailFlags: string[];
  /** The org's banned phrases this copy actually contains. Non-empty means the
   *  asset is a compliance block, not a routine pending item. */
  blockedPhrases: string[];
  dispatchLocked: boolean;
  toolSource: string | null;
  updatedAt: string;
  media: CampaignMediaAsset[];
  /** Original draft vs current text, present only when Arc revised the piece.
   *  Drives the "What changed" diff in the review drawer. */
  revision: { draft: string; current: string } | null;
  /** The approval item gating this deliverable, if one exists — drives the
   *  per-asset Approve/Decline controls in the Deliverables tab. */
  approval: { id: string; status: string } | null;
  /** The agent's latest advisory recommendation on this deliverable's approval
   *  item. Advisory only: it never decides, it tells the operator what the agent
   *  would do and why. Null when the agent hasn't weighed in. */
  recommendation: CampaignAssetRecommendation | null;
  /** Open claims the critic could not ground in workspace evidence. Empty when
   *  the copy is clean OR when nothing has reviewed it yet — `claimsReviewed`
   *  is what distinguishes those two. */
  findings: CampaignAssetFinding[];
  /** Whether the independent claims reviewer has actually run on this copy.
   *
   *  NOT the same as "a recommendation exists": recommend_on_approval writes as
   *  `arc`, so Arc's own advisory note would otherwise read as an independent
   *  review of Arc's own work. Only a `draft-critic` row counts.
   *
   *  False + no findings is the dangerous state the card has to name — it looks
   *  exactly like "checked and clean" unless we say otherwise. */
  claimsReviewed: boolean;
};

export type CampaignAssetRecommendation = {
  agent: string;
  verdict: string;
  rationale: string;
  riskFlags: string[];
  suggestedEdits: string;
};

export type CampaignAssetFinding = {
  /** Needed to apply the fix below — the operator's click has to name a row. */
  id: string;
  claim: string;
  severity: string;
  message: string;
  /** The one value this finding is asking for, when it reduces to one (BSR-743).
   *  Null is the ordinary case: most findings are judgement, not a blank to fill,
   *  and every finding written before this existed has none. */
  fix: InlineFix | null;
};

export type CampaignWorkspaceReasoning = {
  /**
   * Null when Arc recorded nothing — the view renders these behind `&&` guards
   * that were written to hide an absent field and could never fire, because the
   * old fallbacks ("Arc has not recorded reasoning for this campaign yet.", "No
   * recommended action recorded.") are truthy. `reasoning_payload` is `{}` on
   * every live campaign, so the reasoning panel — whose whole job is explaining
   * why Arc built the thing — rendered two sentences saying it cannot.
   */
  whyBuilt: string | null;
  recommendedAction: string | null;
  guardrailFlags: string[];
  toolsUsed: string[];
  promptInputs: Array<{ label: string; value: string }>;
};

export type CampaignExecutiveOverview = {
  what: string;
  why: string;
  timeframe: string;
  where: string;
  successTracking: string;
};

export type CampaignWorkspaceApproval = {
  id: string;
  title: string;
  type: string;
  status: string;
  riskLevel: string;
  requestedBy: string;
  submittedAt: string;
  /** null when the approval has no campaign to open — `/approvals` is not a route. */
  href: string | null;
  preview: string;
  media: CampaignMediaAsset[];
  promptInputs: Array<{ label: string; value: string }>;
  complianceNotes: string;
};

export type CampaignWorkspaceSource = {
  id: string;
  label: string;
  detail: string;
  url: string | null;
  /** Internal link to the CRM record page, when this source is a CRM record. */
  recordHref: string | null;
  kind: "company" | "contact" | "lead" | "web" | "evidence";
};

export type CampaignWorkspaceActivity = {
  id: string;
  title: string;
  outputType: string;
  status: string;
  riskLevel: string;
  createdAt: string;
  body: string;
};

export type CampaignWorkspaceEvent = {
  id: string;
  type: string;
  actor: string;
  detail: string;
  occurredAt: string;
};

export type CampaignWorkspaceMeta = {
  id: string;
  name: string;
  persona: string;
  campaignTheme: string;
  status: string;
  objective: string;
  audienceSummary: string;
  offerSummary: string;
  complianceNotes: string;
  /** Audiences weighed and not chosen — the targeting decision, checkable. */
  consideredAudiences: ConsideredAudience[];
  /** Note for the human continuing offline (sales / referral partner). */
  handoffNote: string | null;
  owner: string;
  launchLocked: boolean;
  createdAt: string;
  updatedAt: string;
  rollup: CampaignRollup;
};

export type CampaignWorkspaceMetrics = {
  assets: number;
  approvals: number;
  media: number;
  sources: number;
};

/** One recorded decision in the campaign's approval audit trail. Sourced from
 *  approval_decisions — the real history of who decided what, when, and why. */
export type CampaignDecisionEvent = {
  id: string;
  decision: string;
  action: string;
  tone: "green" | "red" | "amber" | "blue" | "gray";
  itemTitle: string;
  decidedBy: string;
  at: string;
  notes: string | null;
};

/** One entry in the campaign audit trail — a unified, chronological log of what
 *  the operator and Arc did, tagged by actor so it can be filtered. */
export type AuditEntry = {
  id: string;
  actor: string;
  actorKind: "user" | "arc" | "system";
  action: string;
  detail: string;
  at: string;
};

/** One turn in the campaign's conversation with Arc. Operator turns are the
 *  durable directives we queue (agent_tasks); Arc's turns are the work he
 *  produces (agent_outputs). Both are real records, sorted chronologically. */
export type ArcMessage = {
  id: string;
  role: "operator" | "arc";
  author: string;
  kind: string;
  title: string | null;
  body: string;
  at: string;
  status: string | null;
};

/** Derived launch readiness for a campaign — the single source of truth behind
 *  the lifecycle label and the Launch button. Approval happens per deliverable;
 *  the campaign becomes Ready when no gating piece is still pending, and Live
 *  once the operator launches (campaign no longer launch-locked). */
export type CampaignLaunchState = {
  requiredCount: number;
  approvedCount: number;
  pendingCount: number;
  deployedCount: number;
  ready: boolean;
  live: boolean;
  lifecycle: "Drafting" | "In review" | "Ready" | "Live";
};

export type LiveCampaignWorkspace = {
  status: "live";
  campaign: CampaignWorkspaceMeta;
  assets: CampaignWorkspaceAsset[];
  groupedAssets: Record<CampaignWorkspaceAssetCategory, CampaignWorkspaceAsset[]>;
  approvals: CampaignWorkspaceApproval[];
  media: CampaignMediaAsset[];
  sources: CampaignWorkspaceSource[];
  activity: CampaignWorkspaceActivity[];
  events: CampaignWorkspaceEvent[];
  reasoning: CampaignWorkspaceReasoning;
  executiveOverview: CampaignExecutiveOverview;
  metrics: CampaignWorkspaceMetrics;
  launchState: CampaignLaunchState;
  markConversation: ArcMessage[];
  approvalHistory: CampaignDecisionEvent[];
  auditLog: AuditEntry[];
};

export type CampaignWorkspaceDetail =
  | LiveCampaignWorkspace
  | {
      status: "not_found";
    }
  | {
      status: "unavailable";
      message: string;
    };

type JsonObject = Record<string, unknown>;

export type CampaignRow = {
  id: string;
  name: string;
  persona: string;
  campaign_theme: string | null;
  restoration_focus: string | null;
  status: string;
  company_id: string | null;
  contact_id: string | null;
  lead_id: string | null;
  owner: string | null;
  objective: string | null;
  audience_summary: string | null;
  offer_summary: string | null;
  compliance_notes: string | null;
  considered_audiences: unknown;
  handoff_note: string | null;
  launch_locked: boolean;
  source_signal: unknown;
  source_system: string | null | undefined;
  reasoning_payload: unknown;
  audit_payload: unknown;
  created_at: string;
  updated_at: string;
};

export type CampaignAssetRow = {
  id: string;
  campaign_id: string;
  asset_type: string;
  channel: string | null;
  title: string;
  status: string;
  tool_source: string | null;
  prompt_input: string | null;
  prompt_inputs: unknown;
  draft_body: string | null;
  edited_body: string | null;
  approved_body: string | null;
  dispatch_locked: boolean;
  compliance_notes: string | null;
  reasoning_payload: unknown;
  audit_payload: unknown;
  created_at: string;
  updated_at: string;
};

type ApprovalItemRow = {
  id: string;
  campaign_id: string | null;
  campaign_asset_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  lead_id: string | null;
  item_type: string;
  status: string;
  locked_until_approved: boolean;
  prompt_inputs: unknown;
  draft_output: string | null;
  edited_output: string | null;
  requested_by: string | null;
  submitted_at: string;
  risk_level: string;
  compliance_notes: string | null;
  decision_notes: string | null;
  reasoning_payload: unknown;
  audit_payload: unknown;
  created_at: string;
  updated_at: string;
};

type AgentOutputRow = {
  id: string;
  task_id: string;
  approval_item_id: string | null;
  campaign_asset_id: string | null;
  output_type: string;
  title: string;
  body: string | null;
  edited_body: string | null;
  structured_payload: unknown;
  risk_level: string;
  compliance_status: string;
  approval_status: string;
  created_at: string;
  updated_at: string;
};

type CampaignEventRow = {
  id: string;
  event_type: string;
  actor: string | null;
  detail: string | null;
  occurred_at: string;
};

type AgentTaskRow = {
  id: string;
  objective: string;
  task_type: string;
  status: string;
  priority: string;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

type ApprovalDecisionRow = {
  id: string;
  approval_item_id: string;
  decision: string;
  decided_by: string;
  decided_at: string;
  decision_notes: string | null;
  previous_status: string | null;
  next_status: string;
};

type ApprovalRecommendationRow = {
  id: string;
  approval_item_id: string;
  agent: string;
  recommendation: string;
  rationale: string | null;
  risk_flags: string[] | null;
  suggested_edits: string | null;
  created_at: string;
};

type GuardrailFindingRow = {
  id: string;
  campaign_asset_id: string | null;
  severity: string;
  status: string;
  matched_text: string | null;
  finding_message: string;
  created_at: string;
  fix_target: string | null;
  fix_label: string | null;
  fix_kind: string | null;
};

type CompanyRow = {
  id: string;
  name: string;
  website_url: string | null;
  phone: string | null;
  email: string | null;
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
  loss_summary: string | null;
  lead_score: number;
  metadata: unknown;
};

const EMPTY_READABLE_PREVIEW = "No readable draft content has been attached yet.";

export type CampaignNameRef = { id: string; name: string; href: string };

/**
 * Lightweight campaign id/name/href list for pickers and @-mention autocomplete.
 * Unlike getCampaignWorkspaceList this is a single `id,name` query — no asset /
 * approval / output aggregation — so callers that only need names (Arc composer,
 * mention search) don't pay for the full workspace build on every render.
 */
export async function listCampaignNames(orgId?: string, client?: SupabaseClient, workspaceId?: string | null): Promise<CampaignNameRef[]> {
  if (!client && !isSupabaseAdminConfigured()) {
    if (!isDemoDataEnabled()) return [];
    const demo = buildDemoCampaignWorkspaceList();
    return demo.status === "live" ? demo.campaigns.map((c) => ({ id: c.id, name: c.name, href: `/campaigns/${c.id}` })) : [];
  }
  try {
    const supabase = client ?? getSupabaseAdminClient();
    const { data, error } = await applyCampaignScope(supabase.from("campaigns").select("id,name"), orgId, workspaceId)
      .order("updated_at", { ascending: false })
      .limit(100);
    assertSupabaseResult("campaigns", error);
    return (data ?? []).map((c) => ({ id: c.id as string, name: c.name as string, href: `/campaigns/${c.id as string}` }));
  } catch {
    return [];
  }
}

/**
 * Live chat-facing status for a set of campaign assets, keyed by asset id.
 *
 * The Arc chat's action cards carry the status Arc wrote at DRAFT time. Seeding
 * from this makes a decision taken anywhere else — the campaign page, another
 * session, another device — visible in the conversation, instead of the chat
 * asserting a snapshot that stopped being true hours ago.
 *
 * Org-scoped, and returns {} rather than throwing: a stale-but-rendered chat is
 * better than a chat that fails to render.
 */
export async function getArcAssetStatuses(
  assetIds: readonly string[],
  orgId?: string,
  client?: SupabaseClient,
): Promise<Record<string, ArcAssetStatus>> {
  const ids = [...new Set(assetIds.filter((id) => typeof id === "string" && id.trim()))];
  if (ids.length === 0) return {};
  if (!client && !isSupabaseAdminConfigured()) return {};
  try {
    const supabase = client ?? getSupabaseAdminClient();
    // approved_at comes along because `archived` alone can't say how an asset was
    // decided — an archived-but-approved email must not read as "Declined".
    const { data, error } = await applyOrgScope(supabase.from("campaign_assets").select("id,status,approved_at"), orgId).in("id", ids);
    assertSupabaseResult("campaign_assets", error);
    const out: Record<string, ArcAssetStatus> = {};
    for (const row of (data ?? []) as Array<{ id: string; status: string; approved_at: string | null }>) {
      const mapped = arcAssetStatusFromDb(row.status, row.approved_at);
      // Unrecognised status: leave the id absent so the caller falls back to the
      // card snapshot rather than inventing a state.
      if (mapped) out[row.id] = mapped;
    }
    return out;
  } catch {
    return {};
  }
}

/** One deliverable's readable copy, for a surface that renders it rather than links to it. */
export type ArcAssetBody = {
  id: string;
  /** The copy an operator should be reading: the newest authored version. */
  body: string;
  /** True when `body` came from `edited_body` / `approved_body` rather than Arc's original draft. */
  edited: boolean;
};

/**
 * The full copy behind a conversation's action cards, keyed by asset id.
 *
 * An action card carries `preview`, and `preview` is a ~280-character prefix of
 * the body — verified against prod, where the longest one on record is 280 and
 * the median cuts mid-word ("one of the "). It was sized for a receipt, and a
 * receipt is what the chat could render from it. The copy itself only ever
 * existed in `campaign_assets`, which is why reading a draft meant leaving the
 * conversation.
 *
 * Read at render time rather than widened into the card at write time on
 * purpose: cards are frozen JSON in `arc_messages.metadata`, so a card-shape
 * change reaches nothing already written, and every draft an operator has open
 * today predates it. Reading through the asset also means the chat shows the
 * copy as it stands now — an edit made on the campaign page is visible in the
 * conversation instead of the conversation quoting a superseded draft.
 *
 * Org-scoped, and returns {} rather than throwing, for the same reason
 * `getArcAssetStatuses` does: a card that falls back to its stored preview still
 * renders, and a chat that fails to render helps nobody.
 */
export async function getArcAssetBodies(
  assetIds: readonly string[],
  orgId?: string,
  client?: SupabaseClient,
): Promise<Record<string, ArcAssetBody>> {
  const ids = [...new Set(assetIds.filter((id) => typeof id === "string" && id.trim()))];
  if (ids.length === 0) return {};
  if (!client && !isSupabaseAdminConfigured()) return {};
  try {
    const supabase = client ?? getSupabaseAdminClient();
    const { data, error } = await applyOrgScope(
      supabase.from("campaign_assets").select("id,draft_body,edited_body,approved_body"),
      orgId,
    ).in("id", ids);
    assertSupabaseResult("campaign_assets", error);
    const out: Record<string, ArcAssetBody> = {};
    for (const row of (data ?? []) as Array<{ id: string; draft_body: string | null; edited_body: string | null; approved_body: string | null }>) {
      // Newest authored version wins — approving an edit must not make the chat
      // fall back to showing the copy that edit replaced.
      const authored = row.approved_body?.trim() || row.edited_body?.trim() || null;
      const body = authored ?? row.draft_body?.trim() ?? "";
      if (!body) continue;
      out[row.id] = { id: row.id, body, edited: Boolean(authored) };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The guardrail findings recorded against a set of assets, keyed by asset id.
 *
 * The Arc chat rendered a card's frozen `flags` and nothing else. A census of
 * prod found 13 of 16 approval-bearing cards carrying zero flags while those
 * same assets held 15 OPEN findings — 13 warnings and 2 blockers. The checks had
 * run and been recorded; the chat had simply never read the table they land in.
 *
 * Read live for the same reason bodies are (see `getArcAssetBodies`): the card
 * is frozen JSON in `arc_messages.metadata`, so it cannot learn about a finding
 * raised after Arc drafted — and a finding resolved since is no longer a
 * warning. Org-scoped; returns {} rather than throwing, and the caller
 * distinguishes "no findings" from "not loaded" (see `arcDraftCheckState`).
 */
export async function getArcAssetChecks(
  assetIds: readonly string[],
  orgId?: string,
  client?: SupabaseClient,
): Promise<Record<string, ArcDraftFinding[]>> {
  const ids = [...new Set(assetIds.filter((id) => typeof id === "string" && id.trim()))];
  if (ids.length === 0) return {};
  if (!client && !isSupabaseAdminConfigured()) return {};
  try {
    const supabase = client ?? getSupabaseAdminClient();
    const { data, error } = await applyOrgScope(
      supabase.from("guardrail_findings").select("id,campaign_asset_id,severity,status,matched_text,finding_message"),
      orgId,
    ).in("campaign_asset_id", ids);
    assertSupabaseResult("guardrail_findings", error);

    const out: Record<string, ArcDraftFinding[]> = {};
    // Every requested id gets an entry, including an EMPTY one. That empty array
    // is the difference between "we looked and found none" and "we haven't
    // looked" — the caller renders very different things for those two.
    for (const id of ids) out[id] = [];
    for (const row of (data ?? []) as GuardrailFindingRow[]) {
      const assetId = row.campaign_asset_id;
      if (!assetId || !out[assetId]) continue;
      out[assetId].push({
        id: row.id,
        severity: arcFindingSeverity(row.severity),
        message: row.finding_message,
        matchedText: row.matched_text ?? undefined,
        open: (row.status ?? "").toLowerCase() === "open",
      });
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Every deliverable in the workspace still waiting on a decision, wherever it
 * lives (BSR-702 follow-on).
 *
 * The campaign list already builds all of this — it fetches the campaigns, the
 * assets and the approvals, and runs them through `buildWorkspaceAssets`. What
 * it throws away is the review: `approval_recommendations` and
 * `guardrail_findings` are only read on the detail path, so a list item knows a
 * deliverable is undecided but not what the reviewer said about it. A queue
 * that could not show the review would be a list of titles.
 *
 * `assetDecisionState(...) === "pending"` is the SAME predicate the board's
 * "N deliverables undecided" is counted with, on purpose. The count and the
 * queue behind it are one claim, and this file already carries the scars of
 * what happens when two surfaces answer that question separately (BSR-726).
 */
export type ReviewQueueEntry = {
  campaignId: string;
  campaignName: string;
  asset: CampaignWorkspaceAsset;
};

export type WorkspaceReviewQueue =
  | { status: "live"; entries: ReviewQueueEntry[] }
  | { status: "unavailable"; message: string };

export async function getWorkspaceReviewQueue(
  client?: SupabaseClient,
  agentName = "Arc",
  orgId?: string,
  workspaceId?: string | null,
): Promise<WorkspaceReviewQueue> {
  if (!client && !isSupabaseAdminConfigured()) {
    return isDemoDataEnabled()
      ? { status: "live", entries: buildDemoReviewQueue(agentName) }
      : { status: "live", entries: [] };
  }

  try {
    const supabase = client ?? getSupabaseAdminClient();
    const { data, error } = await applyCampaignScope(
      supabase.from("campaigns").select(CAMPAIGN_SELECT),
      orgId,
      workspaceId,
    )
      .order("updated_at", { ascending: false })
      .limit(100);
    assertSupabaseResult("campaigns", error);

    const campaigns = (data ?? []) as CampaignRow[];
    const campaignIds = campaigns.map((campaign) => campaign.id);
    if (campaignIds.length === 0) return { status: "live", entries: [] };

    const [assets, approvals] = await Promise.all([
      selectIn<CampaignAssetRow>(supabase, "campaign_assets", ASSET_SELECT, "campaign_id", campaignIds, "updated_at", orgId, workspaceId),
      selectIn<ApprovalItemRow>(supabase, "approval_items", APPROVAL_SELECT, "campaign_id", campaignIds, "submitted_at", orgId, workspaceId),
    ]);
    const approvalIds = approvals.map((approval) => approval.id);
    const assetIds = assets.map((asset) => asset.id);

    // The review, which the list read does not fetch. Both tolerate failure the
    // same way the detail read does: a missing critique must not take the queue
    // down with it — an un-reviewed deliverable still needs deciding.
    const [outputs, recommendations, findings] = await Promise.all([
      selectIn<AgentOutputRow>(supabase, "agent_outputs", OUTPUT_SELECT, "approval_item_id", approvalIds, "created_at", orgId).catch(() => []),
      selectIn<ApprovalRecommendationRow>(supabase, "approval_recommendations", RECOMMENDATION_SELECT, "approval_item_id", approvalIds, "created_at", orgId, workspaceId)
        .then(groupByApprovalItem)
        .catch(() => new Map<string, ApprovalRecommendationRow[]>()),
      selectIn<GuardrailFindingRow>(supabase, "guardrail_findings", FINDING_SELECT, "campaign_asset_id", assetIds, "created_at", orgId, workspaceId)
        .then(groupFindingsByAsset)
        .catch(() => new Map<string, CampaignAssetFinding[]>()),
    ]);

    const entries: ReviewQueueEntry[] = [];
    for (const campaign of campaigns) {
      const campaignApprovals = approvals.filter((approval) => approval.campaign_id === campaign.id);
      const campaignAssets = buildWorkspaceAssets(
        assets.filter((asset) => asset.campaign_id === campaign.id),
        campaignApprovals,
        outputs.filter((output) => output.approval_item_id && campaignApprovals.some((approval) => approval.id === output.approval_item_id)),
        agentName,
        recommendations,
        findings,
      );
      for (const asset of campaignAssets) {
        if (assetDecisionState(asset) !== "pending") continue;
        entries.push({ campaignId: campaign.id, campaignName: cleanCampaignName(campaign.name), asset });
      }
    }
    return { status: "live", entries };
  } catch (error) {
    // Said out loud rather than returned empty: "nothing is waiting on you" and
    // "we could not find out" are different answers, and only one of them means
    // the reviewer can stop.
    return {
      status: "unavailable",
      message: error instanceof Error ? error.message : "Could not load what is waiting on you.",
    };
  }
}

/** The same queue over the demo campaigns, so the preview can exercise it. */
function buildDemoReviewQueue(agentName: string): ReviewQueueEntry[] {
  const entries: ReviewQueueEntry[] = [];
  for (const campaign of demoCampaigns(agentName)) {
    const detail = buildDemoCampaignWorkspaceDetail(campaign, agentName);
    for (const asset of detail.assets) {
      if (assetDecisionState(asset) !== "pending") continue;
      entries.push({ campaignId: campaign.id, campaignName: campaign.name, asset });
    }
  }
  return entries;
}

export async function getCampaignWorkspaceList(client?: SupabaseClient, agentName = "Arc", orgId?: string, workspaceId?: string | null): Promise<CampaignWorkspaceList> {
  if (!client && !isSupabaseAdminConfigured()) {
    // Local preview has no database. When the demo flag is on, render a realistic
    // read-only campaign library. When off, return an empty live list so real
    // workspaces show real (possibly empty) data.
    return isDemoDataEnabled()
      ? buildDemoCampaignWorkspaceList(agentName)
      : { status: "live", campaigns: [], totals: { campaigns: 0, assets: 0, approvals: 0, media: 0 } };
  }

  try {
    const supabase = client ?? getSupabaseAdminClient();
    const resolvedOrgId = orgId;
    const { data, error } = await applyCampaignScope(
      supabase.from("campaigns").select(CAMPAIGN_SELECT),
      resolvedOrgId,
      workspaceId,
    ).order("updated_at", { ascending: false }).limit(100);
    assertSupabaseResult("campaigns", error);

    const campaigns = (data ?? []) as CampaignRow[];
    const campaignIds = campaigns.map((campaign) => campaign.id);
    const [assets, approvals] = await Promise.all([
      selectIn<CampaignAssetRow>(supabase, "campaign_assets", ASSET_SELECT, "campaign_id", campaignIds, "updated_at", resolvedOrgId, workspaceId),
      selectIn<ApprovalItemRow>(supabase, "approval_items", APPROVAL_SELECT, "campaign_id", campaignIds, "submitted_at", resolvedOrgId, workspaceId),
    ]);
    const approvalOutputs = await selectIn<AgentOutputRow>(
      supabase,
      "agent_outputs",
      OUTPUT_SELECT,
      "approval_item_id",
      approvals.map((approval) => approval.id),
      "created_at",
      resolvedOrgId,
    );
    const mediaByCampaign = buildMediaByCampaign(campaigns, assets, approvals, approvalOutputs, agentName);
    const sourceCountByCampaign = buildSourceCountByCampaign(campaigns, approvals, approvalOutputs);

    const items = campaigns.map((campaign) => {
      const campaignApprovals = approvals.filter((approval) => approval.campaign_id === campaign.id);
      const campaignAssetRows = assets.filter((asset) => asset.campaign_id === campaign.id);
      const campaignAssets = buildWorkspaceAssets(
        campaignAssetRows,
        campaignApprovals,
        approvalOutputs.filter((output) => output.approval_item_id && campaignApprovals.some((approval) => approval.id === output.approval_item_id)),
        agentName,
      );
      const preview = pickWorkspacePreview(campaignAssets);
      const reasoning = buildReasoning(campaign, campaignAssetRows, agentName);
      const launch = buildLaunchState(campaignAssets, campaign.launch_locked);
      const rollup = deriveCampaignRollup(collectPieceStatuses(campaignAssetRows, campaignApprovals));
      const assetTypes = uniqueStrings(campaignAssets.map((asset) => asset.assetType)).slice(0, 4);
      return {
        id: campaign.id,
        name: cleanCampaignName(campaign.name),
        persona: humanize(campaign.persona),
        status: statusLabel(campaign.status),
        lifecycle: launch.lifecycle,
        pendingCount: launch.pendingCount,
        approvedCount: launch.approvedCount,
        requiredCount: launch.requiredCount,
        pendingDeliverables: selectPendingDeliverables(campaignAssets),
        // Empty, not a placeholder sentence — see the field's note on the type.
        objective: campaign.objective?.trim() ?? "",
        campaignTheme: campaign.campaign_theme?.trim() || humanize(campaign.restoration_focus ?? ""),
        signal: parseCampaignSourceSignal(campaign.source_signal),
        audienceSummary: campaign.audience_summary?.trim() ?? "",
        offerSummary: campaign.offer_summary?.trim() ?? "",
        whyBuilt: reasoning.whyBuilt,
        assetCount: campaignAssets.length,
        approvalCount: campaignApprovals.length,
        mediaCount: mediaByCampaign.get(campaign.id)?.length ?? 0,
        sourceCount: sourceCountByCampaign.get(campaign.id) ?? 0,
        thumbnailUrl: pickThumbnail(mediaByCampaign.get(campaign.id) ?? []),
        assetTypes,
        driver: campaignDriver({ sourceSystem: campaign.source_system ?? null, lifecycle: launch.lifecycle }),
        channels: orderedChannels(campaignAssetRows.map((asset) => humanizeChannel(asset.asset_type ?? asset.channel ?? ""))),
        previewText: preview?.text ?? null,
        previewLabel: preview?.label ?? null,
        contentPieces: buildListContentPieces(campaignAssets),
        updatedAt: formatDate(campaign.updated_at),
        updatedAtIso: campaign.updated_at,
        href: `/campaigns/${campaign.id}`,
        rollup,
      };
    });

    // A configured workspace shows its REAL state, even when empty — never fake
    // campaigns. The demo library is only served when Supabase is unconfigured
    // (the local-preview branch at the top); masking a live, empty org with demo
    // data hid real Arc-created campaigns and surfaced "fake data that shouldn't
    // be there".
    return {
      status: "live",
      campaigns: items,
      totals: {
        campaigns: items.length,
        assets: assets.length,
        approvals: approvals.length,
        media: [...mediaByCampaign.values()].reduce((total, media) => total + media.length, 0),
      },
    };
  } catch (error) {
    // Degrade, but not silently. A caught error is invisible to Sentry's
    // automatic instrumentation, which is how a missing column took this board
    // to "0 packages" for every org on 2026-07-28 with nothing raised anywhere.
    reportDegraded(error, {
      scope: "campaigns.getCampaignWorkspaceList",
      surface: "primary",
      detail: { orgId: orgId ?? null },
    });
    return {
      status: "unavailable",
      message: error instanceof Error ? error.message : "Campaign workspace is unavailable.",
    };
  }
}

// ---------------------------------------------------------------------------
// Demo fallback — a realistic, read-only campaign library for local preview
// (no Supabase). Mirrors the shape the real read-model produces so the UI is
// identical to a populated DB view. No piece here is sendable.
// ---------------------------------------------------------------------------

type DemoMedia = { id: string; type: CampaignMediaAsset["type"]; title: string; seed: string; lineage?: Array<[string, string]>; prompt?: string; format?: string; riskFlags?: string[] };

type DemoPiece = {
  id: string;
  title: string;
  kind: string;
  channel: string;
  status: string;
  rawStatus: string;
  preview: string;
  needsReview: boolean;
  media?: DemoMedia[];
  /** Full rendered copy for the detail email/asset preview. Falls back to
   *  `preview` when omitted. */
  body?: string;
  /** Asset-level compliance note shown on the detail piece. */
  compliance?: string;
  /** Original draft vs current copy, drives the "What changed" diff. */
  revision?: { draft: string; current: string };
  /** The claims review sitting on this piece. Prod writes one on every copy
   *  draft, so a fixture without one leaves the review block — the first thing
   *  the deliverable card shows — invisible in the backend-less preview. */
  recommendation?: CampaignAssetRecommendation;
  findings?: CampaignAssetFinding[];
};

/** A source-backed record the detail page lists under "Sources" / "Linked
 *  leads". Mirrors CampaignWorkspaceSource so the demo reads like real CRM
 *  evidence without inventing a separate shape. */
type DemoSource = {
  id: string;
  label: string;
  detail: string;
  kind: CampaignWorkspaceSource["kind"];
  recordHref?: string;
  url?: string;
};

type DemoCampaign = {
  id: string;
  name: string;
  persona: string;
  campaignTheme: string;
  status: string;
  lifecycle: CampaignLaunchState["lifecycle"];
  launchLocked: boolean;
  driver: CampaignDriver;
  owner: string;
  objective: string;
  audienceSummary: string;
  offerSummary: string;
  complianceNotes: string;
  /** Audiences weighed and not chosen — the targeting decision, checkable. */
  consideredAudiences: ConsideredAudience[];
  /** Note for the human continuing offline (sales / referral partner). */
  handoffNote: string | null;
  whyBuilt: string;
  recommendedAction: string;
  guardrailFlags: string[];
  toolsUsed: string[];
  channels: string[];
  /** Only the signal-driven fixtures carry one, same as the live table. */
  signal?: CampaignSourceSignal;
  sourceCount: number;
  sources: DemoSource[];
  createdAtIso: string;
  updatedAt: string;
  updatedAtIso: string;
  pieces: DemoPiece[];
};

function demoMedia(media: DemoMedia): CampaignMediaAsset {
  const url = `https://picsum.photos/seed/${media.seed}/640/400`;
  return {
    id: media.id,
    type: media.type,
    origin: "attached",
    title: media.title,
    url,
    thumbnailUrl: `https://picsum.photos/seed/${media.seed}/240/160`,
    mimeType: media.type === "video" ? "video/mp4" : "image/jpeg",
    description: media.title,
    // Demo media declares a ratio because real prod entries do; without one the
    // offline preview could not exercise the tile's aspect handling at all.
    format: media.format ?? "4:3",
    riskFlags: media.riskFlags ?? [],
    libraryAssetId: null,
    storagePath: null,
    // Demo data has no approval rows behind it, which is also true of prod.
    review: UNREVIEWED,
    lineage: media.lineage ?? [],
    prompt: media.prompt ?? null,
    source: "Approved media",
    virality: null,
  };
}

function demoListContentPiece(piece: DemoPiece): CampaignListContentPiece {
  return {
    id: piece.id,
    title: piece.title,
    kind: piece.kind,
    channel: piece.channel,
    status: piece.status,
    preview: piece.preview,
    media: (piece.media ?? []).map(demoMedia),
    updatedAt: "",
    needsReview: piece.needsReview,
  };
}

function buildDemoListItem(campaign: DemoCampaign): CampaignWorkspaceListItem {
  const contentPieces = campaign.pieces.map(demoListContentPiece);
  const media = contentPieces.flatMap((piece) => piece.media);
  const pendingPieces = campaign.pieces.filter((piece) => piece.needsReview);
  const approvedPieces = campaign.pieces.filter((piece) => /approved/i.test(piece.rawStatus));
  const rollup = deriveCampaignRollup(campaign.pieces.map((piece) => piece.rawStatus));
  const assetTypes = uniqueStrings(campaign.pieces.map((piece) => piece.kind)).slice(0, 4);
  const firstPreview = contentPieces[0]?.preview ?? null;

  return {
    id: campaign.id,
    name: campaign.name,
    persona: campaign.persona,
    status: campaign.status,
    lifecycle: campaign.lifecycle,
    pendingCount: pendingPieces.length,
    approvedCount: approvedPieces.length,
    requiredCount: campaign.pieces.length,
    pendingDeliverables: pendingPieces.map((piece) => ({ assetId: piece.id, title: piece.title, kind: piece.kind })),
    objective: campaign.objective,
    campaignTheme: campaign.campaignTheme,
    signal: campaign.signal ?? null,
    audienceSummary: campaign.audienceSummary,
    offerSummary: campaign.offerSummary,
    whyBuilt: campaign.whyBuilt,
    assetCount: campaign.pieces.length,
    approvalCount: pendingPieces.length + approvedPieces.length,
    mediaCount: media.length,
    sourceCount: campaign.sourceCount,
    thumbnailUrl: media[0]?.thumbnailUrl ?? media[0]?.url ?? null,
    assetTypes,
    driver: campaign.driver,
    channels: campaign.channels.slice(0, 3),
    previewText: firstPreview,
    previewLabel: contentPieces[0]?.channel ?? null,
    contentPieces,
    updatedAt: campaign.updatedAt,
    updatedAtIso: campaign.updatedAtIso,
    href: `/campaigns/${campaign.id}`,
    rollup,
  };
}

export function buildDemoCampaignWorkspaceList(agentName = "Arc"): CampaignWorkspaceList {
  const campaigns = demoCampaigns(agentName).map(buildDemoListItem);
  const assets = campaigns.reduce((total, campaign) => total + campaign.assetCount, 0);
  const approvals = campaigns.reduce((total, campaign) => total + campaign.approvalCount, 0);
  const media = campaigns.reduce((total, campaign) => total + campaign.mediaCount, 0);
  return {
    status: "live",
    campaigns,
    totals: { campaigns: campaigns.length, assets, approvals, media },
  };
}

// --- Demo detail --------------------------------------------------------------

/** Map a demo status string to the same plain status labels the real read-model
 *  emits, so downstream launch/checklist logic behaves identically. */
/**
 * `CampaignWorkspaceAsset.status` carries the STORED status, not a label.
 *
 * It is re-read as a status all over the detail view — `statusMeta`,
 * `isActionable`, `/^approved/i` — and the view writes raw values back into it
 * optimistically (`"revision_requested"`, `"pending_approval"`). Passing it
 * through `statusLabel` used to work only by accident: "Pending approval"
 * happens to contain "pending", so the round-trip survived. The moment the label
 * became "Needs you" — which contains neither "pending" nor "review" — every
 * pending asset rendered as "Draft" (BSR-656). Label at the display boundary,
 * never in the read model.
 */
function demoAssetStatus(rawStatus: string): string {
  return rawStatus;
}

function demoDetailAsset(piece: DemoPiece): CampaignWorkspaceAsset {
  const media = (piece.media ?? []).map(demoMedia);
  const body = (piece.body ?? piece.preview).trim();
  // Every demo piece is a gated deliverable: pending pieces offer Approve/Decline,
  // decided pieces echo their state. Either way the asset carries an approval gate.
  const hasGate = piece.needsReview || /approved|archived/i.test(piece.rawStatus);
  return {
    id: piece.id,
    title: piece.title,
    assetType: piece.kind,
    category: classifyAssetText(`${piece.kind} ${piece.channel} ${piece.title}`),
    channel: piece.channel,
    status: demoAssetStatus(piece.rawStatus),
    body,
    preview: piece.preview,
    complianceNotes: piece.compliance ?? "No asset-level compliance notes captured.",
    guardrailFlags: [],
    blockedPhrases: [],
    recommendation: piece.recommendation ?? null,
    findings: piece.findings ?? [],
    // Only a claims review counts as reviewed, and in the fixtures that is
    // exactly the pieces carrying one — same rule the live read applies.
    claimsReviewed: piece.recommendation?.agent === "draft-critic",
    // Approved demo pieces in a Live campaign are deployable; everything else
    // stays dispatch-locked so the gold "outbound locked" gate shows.
    dispatchLocked: !/approved/i.test(piece.rawStatus),
    toolSource: "Approved media library",
    updatedAt: "",
    media,
    revision: piece.revision ?? null,
    approval: hasGate ? { id: `approval-${piece.id}`, status: demoAssetStatus(piece.rawStatus) } : null,
  };
}

function demoSource(source: DemoSource): CampaignWorkspaceSource {
  return {
    id: source.id,
    label: source.label,
    detail: source.detail,
    url: source.url ?? null,
    recordHref: source.recordHref ?? null,
    kind: source.kind,
  };
}

/** Build a full LiveCampaignWorkspace for a demo campaign id, mirroring the
 *  shape getCampaignWorkspaceDetail produces from Supabase so the detail page
 *  renders the real review workspace with no database. Nothing here is sendable. */
function buildDemoCampaignWorkspaceDetail(campaign: DemoCampaign, agentName: string): LiveCampaignWorkspace {
  const assets = campaign.pieces.map(demoDetailAsset);
  const groupedAssets = groupAssets(assets);
  const media = uniqueMedia(assets.flatMap((asset) => asset.media));
  const sources = campaign.sources.map(demoSource);
  const launchLocked = campaign.launchLocked;
  const launchState = buildLaunchState(assets, launchLocked);
  const rollup = deriveCampaignRollup(campaign.pieces.map((piece) => piece.rawStatus));

  const reasoning: CampaignWorkspaceReasoning = {
    whyBuilt: campaign.whyBuilt,
    recommendedAction: campaign.recommendedAction,
    guardrailFlags: campaign.guardrailFlags,
    toolsUsed: campaign.toolsUsed,
    promptInputs: [
      { label: "Persona", value: campaign.persona },
      { label: "Theme", value: campaign.campaignTheme },
      { label: "Segment", value: "Mid-market accounts — Team & Business plans" },
      { label: "Offer", value: campaign.offerSummary },
    ],
  };

  const approvals: CampaignWorkspaceApproval[] = campaign.pieces
    .filter((piece) => piece.needsReview)
    .map((piece) => ({
      id: `approval-${piece.id}`,
      title: piece.title,
      type: piece.kind,
      status: demoAssetStatus(piece.rawStatus),
      riskLevel: "Low",
      requestedBy: agentName,
      submittedAt: campaign.updatedAt,
      href: `#piece-${piece.id}`,
      preview: piece.preview,
      media: (piece.media ?? []).map(demoMedia),
      promptInputs: [
        { label: "Channel", value: piece.channel },
        { label: "Audience", value: campaign.audienceSummary },
      ],
      complianceNotes: piece.compliance ?? campaign.complianceNotes,
    }));

  const activity: CampaignWorkspaceActivity[] = campaign.pieces.map((piece) => ({
    id: `activity-${piece.id}`,
    title: piece.title,
    outputType: piece.kind,
    status: demoAssetStatus(piece.rawStatus),
    riskLevel: "Low",
    createdAt: campaign.updatedAt,
    body: piece.preview,
  }));

  const events: CampaignWorkspaceEvent[] = [
    {
      id: `${campaign.id}-evt-created`,
      type: "Campaign Drafted",
      actor: agentName,
      detail: campaign.whyBuilt,
      occurredAt: campaign.updatedAt,
    },
    {
      id: `${campaign.id}-evt-package`,
      type: "Package Assembled",
      actor: agentName,
      detail: `${assets.length} deliverable${assets.length === 1 ? "" : "s"} prepared across ${campaign.channels.join(", ")}.`,
      occurredAt: campaign.updatedAt,
    },
  ];

  const executiveOverview: CampaignExecutiveOverview = {
    what: campaign.objective,
    why: `${campaign.whyBuilt} Goal: reduce decision friction and make the next step clear.`,
    timeframe: `Updated ${campaign.updatedAt}. Awaiting human approval before anything goes out.`,
    where: campaign.audienceSummary,
    successTracking: `Track CTA events, form/phone submissions, booked demos, and attribution. Current evidence: ${sources.length} source record${sources.length === 1 ? "" : "s"}, ${assets.length} deliverable${assets.length === 1 ? "" : "s"}, ${approvals.length} approval record${approvals.length === 1 ? "" : "s"}.`,
  };

  const markConversation: ArcMessage[] = [
    {
      id: `${campaign.id}-msg-1`,
      role: "arc",
      author: agentName,
      kind: "Campaign package",
      title: campaign.name,
      body: campaign.whyBuilt,
      at: campaign.updatedAt,
      status: launchState.lifecycle,
    },
    {
      id: `${campaign.id}-msg-2`,
      role: "arc",
      author: agentName,
      kind: "Recommendation",
      title: null,
      body: campaign.recommendedAction,
      at: campaign.updatedAt,
      status: null,
    },
  ];

  const approvalHistory: CampaignDecisionEvent[] = campaign.pieces
    .filter((piece) => /approved/i.test(piece.rawStatus))
    .map((piece) => ({
      id: `${piece.id}-decision`,
      decision: "approved",
      action: "Approved",
      tone: "green",
      itemTitle: piece.title,
      decidedBy: campaign.owner,
      at: campaign.updatedAt,
      notes: null,
    }));

  const auditLog: AuditEntry[] = [
    ...events.map((event) => ({
      id: `audit-${event.id}`,
      actor: event.actor,
      actorKind: "arc" as const,
      action: event.type,
      detail: event.detail,
      at: event.occurredAt,
    })),
    ...approvalHistory.map((decision) => ({
      id: `audit-${decision.id}`,
      actor: decision.decidedBy,
      actorKind: "user" as const,
      action: decision.action,
      detail: decision.itemTitle,
      at: decision.at,
    })),
  ];

  return {
    status: "live",
    campaign: {
      id: campaign.id,
      name: campaign.name,
      persona: campaign.persona,
      campaignTheme: campaign.campaignTheme,
      status: campaign.status,
      objective: campaign.objective,
      audienceSummary: campaign.audienceSummary,
      offerSummary: campaign.offerSummary,
      complianceNotes: campaign.complianceNotes,
      consideredAudiences: campaign.consideredAudiences,
      handoffNote: campaign.handoffNote,
      owner: campaign.owner,
      launchLocked,
      createdAt: formatDate(campaign.createdAtIso),
      updatedAt: campaign.updatedAt,
      rollup,
    },
    assets,
    groupedAssets,
    approvals,
    media,
    sources,
    activity,
    events,
    reasoning,
    executiveOverview,
    metrics: {
      assets: assets.length,
      approvals: approvals.length,
      media: media.length,
      sources: sources.length,
    },
    launchState,
    markConversation,
    approvalHistory,
    auditLog,
  };
}

function genericDemoCampaigns(agentName: string): DemoCampaign[] {
  const personas = personasForIndustry(canonicalIndustryKey(process.env.ARC_DEMO_INDUSTRY));
  const persona = (index: number, fallback: string) => personas[index] ?? {
    slug: `persona-${index + 1}`,
    name: fallback,
    segment: "acquisition" as const,
    stage: "New",
    angle: "Make the next step clear and useful.",
    audience: "People who are ready for a relevant next step.",
    cta: "Take the next step",
  };
  const newLead = persona(0, "New lead");
  const activeCustomer = persona(1, "Active customer");
  const champion = persona(2, "Champion");
  const atRisk = persona(3, "At-risk customer");

  const makeCampaign = ({
    id,
    name,
    target,
    theme,
    objective,
    offer,
    lifecycle,
    pieceStatus,
    updatedAt,
    updatedAtIso,
    signal,
  }: {
    id: string;
    name: string;
    target: typeof newLead;
    theme: string;
    objective: string;
    offer: string;
    lifecycle: DemoCampaign["lifecycle"];
    pieceStatus: "pending_approval" | "approved";
    updatedAt: string;
    updatedAtIso: string;
    signal?: CampaignSourceSignal;
  }): DemoCampaign => {
    const pending = pieceStatus === "pending_approval";
    const status = pending ? "In Review" : lifecycle === "Live" ? "Live" : "Approved";
    // The raw status, exactly as a real row stores it — the view maps it to a
    // label. A fixture holding "Needs you" here would round-trip through
    // `statusMeta` as "Draft", because "Needs you" is not a status.
    const pieceStatusValue = pending ? "pending_approval" : "approved";
    const action = target.cta || "Take the next step";
    // Full email copy, not a one-line summary: the deliverable card renders this
    // as the draft under review, and a single sentence there shows none of what
    // reviewing an actual email is like.
    const emailCopy = [
      target.angle,
      "",
      offer,
      "",
      "You don't have to work out which piece to sort first. That's our job — we take it from the first",
      "conversation through to the part where it's done, and you hear from one team the whole way.",
      "",
      "We answer within the hour, every time — no exceptions.",
      "",
      "Call [phone number] — a real person picks up.",
      "",
      `${action} →`,
      "",
      "Or reply to this email and someone will call you back.",
      "",
      "[Unsubscribe] · You're receiving this because you asked us to keep you posted.",
    ].join("\n");
    return {
      id,
      name,
      persona: target.name,
      campaignTheme: theme,
      status,
      lifecycle,
      launchLocked: lifecycle !== "Live",
      driver: "agent",
      owner: agentName,
      objective,
      audienceSummary: target.audience,
      // Demo campaigns carry a real targeting rationale so the section shows what
      // a populated package looks like, not just its empty state. Derived from
      // the persona so it stays coherent with the rest of the generated campaign.
      consideredAudiences: [
        {
          label: `Everyone outside ${target.name}`,
          reason: "Too broad to personalize — the message only lands for this relationship stage",
        },
        {
          label: "Contacts already in an active sequence",
          reason: "Would double-contact people mid-conversation",
        },
      ],
      handoffNote: `If they reply, pick it up in the thread rather than restarting. Lead with the reason Arc surfaced them — ${action.toLowerCase()} — not with the offer.`,
      offerSummary: offer,
      complianceNotes: "Claims and audience rules require human review before launch. Outbound remains locked until approval.",
      whyBuilt: `${agentName} matched a recent customer signal to the ${target.name} persona and prepared a focused campaign draft.`,
      recommendedAction: pending
        ? "Review the draft copy and approve or request changes before anything is sent."
        : "Review performance and decide whether to extend the campaign.",
      guardrailFlags: ["Human approval required", "Outbound locked until approved"],
      toolsUsed: ["Customer signal", "Persona match", "Approved brand context"],
      channels: ["Email", "LinkedIn"],
      signal,
      sourceCount: 2,
      sources: [
        {
          id: `${id}-signal`,
          label: `${target.name} engagement signal`,
          detail: "Recent activity matched this audience to a timely next step.",
          kind: "evidence",
        },
        {
          id: `${id}-audience`,
          label: `${target.name} persona`,
          detail: target.audience,
          kind: "contact",
          recordHref: "/personas",
        },
      ],
      createdAtIso: "2026-07-14T14:00:00.000Z",
      updatedAt,
      updatedAtIso,
      pieces: [
        {
          id: `${id}-email`,
          title: `${name} — email`,
          kind: "Email",
          channel: "Email",
          status: pieceStatusValue,
          rawStatus: pieceStatus,
          needsReview: pending,
          preview: emailCopy,
          body: emailCopy,
          compliance: "Audience, offer, and CTA require human review before dispatch.",
          recommendation: {
            agent: "draft-critic",
            verdict: "request revision",
            rationale: `The offer and the audience fit are well grounded — both trace back to records in this workspace, and the ${target.name} match is the reason this draft exists. Two things stop it from going out as written. The response-time line commits the business to something no document in this workspace backs up, and the reply-to-callback line describes a handoff no process note covers. Neither needs a rewrite; both are single-line fixes.`,
            riskFlags: ["unsupported_claim"],
            suggestedEdits:
              "1) Point the response-time line at a documented commitment, or soften it to \"we'll come back to you the same day\". 2) Confirm that replying to this email actually reaches someone who can call back — if not, change it to \"reply and we'll follow up\".",
          },
          findings: [
            {
              id: `${id}-finding-placeholder`,
              claim: "Call [phone number] — a real person picks up.",
              severity: "blocker",
              message:
                "This is still the placeholder, so the call-to-action points at nothing. It cannot go out until the real number is in it.",
              // The shape this whole feature exists for: one missing value, and
              // the exact text to put it in place of.
              fix: { target: "[phone number]", label: "The number to call", kind: "phone" },
            },
            {
              id: `${id}-finding-response-time`,
              claim: "We answer within the hour, every time — no exceptions.",
              severity: "blocker",
              message:
                "Nothing in this workspace's evidence sets a response-time commitment, and \"no exceptions\" turns it into a promise the business has to keep on every single inbound. Point it at a documented commitment or soften it before this goes out.",
              fix: null,
            },
            {
              id: `${id}-finding-callback`,
              claim: "Or reply to this email and someone will call you back.",
              severity: "warning",
              message:
                "No proof point or process note describes a reply-to-callback workflow. Plausible operationally, but unsubstantiated here — worth confirming with whoever owns the inbox.",
              fix: null,
            },
          ],
          media: [{ id: `${id}-hero`, type: "image", title: `${name} campaign creative`, seed: id, lineage: [["ai", "Made in Higgsfield · seedream"], ["ai", "Source job · hf_20260722_0917"]], prompt: "Campaign hero creative in the workspace brand style, photoreal, no embedded text." }],
        },
        // Two pieces the review passed with nothing raised. Kept clean on
        // purpose: a package where every deliverable is flagged never exercises
        // the "reviewed and clear" state, and that is the common one.
        {
          id: `${id}-social`,
          title: `${name} — social post`,
          kind: "Social Post",
          channel: "LinkedIn",
          status: pieceStatusValue,
          rawStatus: pieceStatus,
          needsReview: pending,
          preview: `${target.angle} ${action}.`,
          compliance: "No automatic publishing. Human approval is required.",
          recommendation: {
            agent: "draft-critic",
            verdict: "approve",
            rationale:
              "Every claim here traces to something in this workspace — the audience fit, the offer, and the next step all match records the campaign was built from. Nothing overstates what the business does, and there is no commitment in the copy that would need a document behind it.",
            riskFlags: [],
            suggestedEdits: "",
          },
          findings: [],
        },
        {
          id: `${id}-sms`,
          title: `${name} — SMS`,
          kind: "SMS",
          channel: "SMS",
          status: pieceStatusValue,
          rawStatus: pieceStatus,
          needsReview: pending,
          preview: `${target.angle} ${action} — reply STOP to opt out.`,
          compliance: "Opt-out language is required on every message. Human approval before dispatch.",
          recommendation: {
            agent: "draft-critic",
            verdict: "approve",
            rationale:
              "Short enough for one segment, carries the opt-out, and makes no claim beyond the offer already approved elsewhere in this package.",
            riskFlags: [],
            suggestedEdits: "",
          },
          findings: [],
        },
      ],
    };
  };

  return [
    makeCampaign({
      id: "demo-high-intent-follow-up",
      name: "High-intent follow-up",
      target: newLead,
      theme: "Lead conversion",
      objective: "Turn recent high-intent interest into qualified conversations with a clear, low-friction next step.",
      offer: "A short consultation tailored to the questions prospects are already researching.",
      // Urgency with no window — the other half of the timing chip, so the
      // offline preview shows both tones it can render.
      signal: { urgency: "high", eventType: null, startsAtIso: null, endsAtIso: null },
      lifecycle: "In review",
      pieceStatus: "pending_approval",
      updatedAt: "Jul 21, 2026",
      updatedAtIso: "2026-07-21T13:20:00.000Z",
    }),
    makeCampaign({
      id: "demo-customer-adoption",
      name: "Customer next-step adoption",
      target: activeCustomer,
      theme: "Customer adoption",
      objective: "Help active customers discover the next feature, service, or offer most relevant to them.",
      offer: "A personalized recommendation based on recent customer activity.",
      lifecycle: "In review",
      pieceStatus: "pending_approval",
      updatedAt: "Jul 20, 2026",
      updatedAtIso: "2026-07-20T16:10:00.000Z",
    }),
    makeCampaign({
      id: "demo-referral-growth",
      name: "Champion referral growth",
      target: champion,
      theme: "Referral growth",
      objective: "Turn positive customer sentiment into thoughtful referrals and advocacy.",
      offer: "A simple referral path with a useful benefit for both people.",
      lifecycle: "Ready",
      pieceStatus: "approved",
      updatedAt: "Jul 18, 2026",
      updatedAtIso: "2026-07-18T11:45:00.000Z",
    }),
    makeCampaign({
      id: "demo-customer-winback",
      name: "Customer win-back",
      target: atRisk,
      theme: "Customer reactivation",
      objective: "Re-engage customers whose activity has declined with one useful reason to return.",
      offer: "A relevant reminder and a simple path back into the customer journey.",
      lifecycle: "Live",
      pieceStatus: "approved",
      updatedAt: "Jul 16, 2026",
      updatedAtIso: "2026-07-16T09:30:00.000Z",
    }),
  ];
}

function demoCampaigns(agentName: string): DemoCampaign[] {
  return canonicalIndustryKey(process.env.ARC_DEMO_INDUSTRY) === "restoration"
    ? restorationDemoCampaigns(agentName)
    : genericDemoCampaigns(agentName);
}

function restorationDemoCampaigns(agentName: string): DemoCampaign[] {
  return [
    {
      id: "demo-emergency-water-response-2026",
      name: "Emergency Water Response 2026",
      persona: "Homeowner Emergency",
      campaignTheme: "Water Mitigation",
      status: "In Review",
      lifecycle: "In review",
      launchLocked: true,
      driver: "agent",
      owner: agentName,
      objective:
        "Capture high-intent emergency water-loss searches across the North Shore and convert them to same-day mitigation calls before competitors respond.",
      audienceSummary:
        "Homeowners in 60091/60093/60201 with active water emergencies — burst pipes, sump failures, and storm backups in the last 24 hours.",
      consideredAudiences: [],
      handoffNote: null,
      offerSummary: "24/7 emergency response, on-site in 60 minutes, insurance documentation handled from the first call.",
      complianceNotes:
        "No guaranteed-outcome or insurance-payout claims. Response-time language reflects historical North Shore averages, not a contractual promise.",
      whyBuilt: `${agentName} flagged a spike in burst-pipe and sump-failure searches after the cold snap and assembled a ready-to-launch rapid-response package.`,
      recommendedAction:
        "Approve the email and SMS so the rapid-response set is live before the next freeze-thaw cycle this weekend.",
      guardrailFlags: ["No payout guarantees", "Response time stated as historical average"],
      toolsUsed: ["Search-trend signal", "CRM service-area match", "Approved media library"],
      channels: ["Gmail", "Meta", "Instagram", "SMS"],
      // Fixed dates, like every other timestamp in these fixtures — so this one
      // renders the expired-window state rather than a countdown that changes
      // meaning depending on the day the preview is opened.
      signal: {
        urgency: "high",
        eventType: "Freeze-thaw advisory",
        startsAtIso: "2026-07-19T12:00:00.000Z",
        endsAtIso: "2026-07-21T18:00:00.000Z",
      },
      sourceCount: 6,
      sources: [
        {
          id: "demo-ewr-src-trend",
          label: "Search-trend spike — burst pipe + sump failure",
          detail: "Confidence 0.86 / North Shore / +212% week-over-week after the cold snap",
          kind: "evidence",
        },
        {
          id: "demo-ewr-src-lead-1",
          label: "Lead from organic search",
          detail: "New / 88 score / Basement water intrusion reported overnight",
          kind: "lead",
          recordHref: "/crm/leads/demo-ld-donovan-basement",
        },
        {
          id: "demo-ewr-src-lead-2",
          label: "Lead from Google Local Services",
          detail: "Working / 81 score / Sewer backup, Wicker Park garden unit",
          kind: "lead",
          recordHref: "/crm/leads/demo-ld-wicker-sewer",
        },
        {
          id: "demo-ewr-src-contact",
          label: "Claire Donovan",
          detail: "Homeowner / Oak Park / overnight basement-flood lead",
          kind: "contact",
          recordHref: "/crm/contacts/demo-ct-claire-donovan",
        },
        {
          id: "demo-ewr-src-weather",
          label: "weather.gov advisory",
          detail: "Hard-freeze warning issued for Cook + northern suburbs",
          kind: "web",
          url: "https://www.weather.gov",
        },
      ],
      createdAtIso: "2026-06-15T22:10:00.000Z",
      updatedAt: "Jun 16, 2026",
      updatedAtIso: "2026-06-16T14:20:00.000Z",
      pieces: [
        {
          id: "demo-ewr-email",
          title: "Water in your home? We respond in 60 minutes.",
          kind: "Email",
          channel: "Email",
          status: "pending_approval",
          rawStatus: "pending_approval",
          needsReview: true,
          preview: "When a pipe bursts, every minute counts. A Summit Restoration crew is on call 24/7 across the North Shore.",
          compliance:
            "Response-time claim cites historical average. No insurance-payout language. CTA links to the emergency request form, no auto-dial.",
          body:
            "When a pipe bursts or your sump gives out, every minute counts — standing water spreads behind walls and under floors fast.\n\nSummit Restoration crews are on call 24/7 across Wilmette, Winnetka, and Evanston. We typically reach North Shore homes within 60 minutes, start extraction immediately, and document every reading and photo for your insurer from the first minute on site.\n\nOne call gets a crew rolling and your claim documented. Tap below and we'll dispatch the nearest team.\n\nRequest an emergency crew →",
          media: [{ id: "demo-ewr-email-hero", type: "image", title: "Crew arriving on emergency call", seed: "bsr-ewr-hero" }],
        },
        {
          id: "demo-ewr-sms",
          title: "SMS — Same-day mitigation reminder",
          kind: "SMS",
          channel: "SMS",
          status: "pending_approval",
          rawStatus: "pending_approval",
          needsReview: true,
          preview: "A crew can be on-site within the hour for your water emergency. Reply YES and we'll call you right back.",
          compliance: "Includes business identification and a clear opt-out path. No automated outbound until approved.",
          body:
            "Summit Restoration: a crew can be on-site within the hour for your water emergency. Reply YES and we'll call you right back, or STOP to opt out.",
        },
        {
          id: "demo-ewr-meta",
          title: "Meta ad — 60-minute response",
          kind: "Social Ad",
          channel: "Meta",
          status: "Approved",
          rawStatus: "approved",
          needsReview: false,
          preview: "We respond fast. You recover faster. 24/7 emergency water mitigation across the North Shore.",
          compliance: "Approved before/after media. No embedded text overlays that violate ad policy.",
          body:
            "We respond fast. You recover faster.\n\n24/7 emergency water mitigation across the North Shore. Real crews, real before-and-afters, insurance documentation handled.",
          media: [
            { id: "demo-ewr-meta-1", type: "image", title: "Before / after — flooded basement", seed: "bsr-ewr-beforeafter" },
            { id: "demo-ewr-meta-2", type: "image", title: "Restored living room", seed: "bsr-ewr-restored" },
          ],
        },
        {
          id: "demo-ewr-landing",
          title: "Landing page — Emergency water response",
          kind: "Landing Page",
          channel: "Landing page",
          status: "Approved",
          rawStatus: "approved",
          needsReview: false,
          preview: "Request a crew, see live response times, and start your insurance documentation in one tap.",
          compliance: "Form-only CTA. Response-time copy matches the email's historical-average wording.",
          body:
            "Water damage? We're already on the way.\n\nRequest a crew, see live response times for your area, and start your insurance documentation in one tap. Summit Restoration crews arrive ready to extract, dry, and document.",
          media: [{ id: "demo-ewr-landing-hero", type: "image", title: "Landing hero — crew with equipment", seed: "bsr-ewr-landing" }],
        },
      ],
    },
    {
      id: "demo-burst-pipe-rapid-response",
      name: "Burst Pipe Rapid Response",
      persona: "Homeowner Emergency",
      campaignTheme: "Water Mitigation",
      status: "In Review",
      lifecycle: "In review",
      launchLocked: true,
      driver: "agent",
      owner: agentName,
      objective: "Re-engage homeowners who searched for burst-pipe help overnight but never booked a crew.",
      audienceSummary: "Overnight emergency searchers in the North Shore service area with no booked job in the CRM.",
      consideredAudiences: [
        { label: "All North Shore homeowners", reason: "Too broad for an emergency message — would reach people with no active problem", sizeEstimate: 4200 },
        { label: "Past emergency callers", reason: "Already covered by the reactivation nurture; would double-contact", sizeEstimate: 180 },
      ],
      handoffNote:
        "If they call back, lead with response time, not price. The overnight crew is the differentiator here — most competitors quote a next-day window.",
      offerSummary: "Priority morning callback with documented water extraction and drying.",
      complianceNotes: "Follow-up only to inbound inquiries. No cold outreach. Clear opt-out on the SMS.",
      whyBuilt: `${agentName} found unconverted overnight emergency leads and drafted a fast morning-callback package.`,
      recommendedAction: "Approve the email so the morning-callback window isn't missed.",
      guardrailFlags: ["Inbound-only follow-up"],
      toolsUsed: ["CRM unconverted-lead scan", "Approved media library"],
      channels: ["Gmail", "SMS", "WhatsApp"],
      sourceCount: 4,
      sources: [
        {
          id: "demo-bprr-src-lead",
          label: "Lead from overnight search",
          detail: "New / 79 score / Burst supply line, finished basement, no crew booked",
          kind: "lead",
          recordHref: "/crm/leads/demo-ld-donovan-basement",
        },
        {
          id: "demo-bprr-src-signal",
          label: "Unconverted-inquiry signal",
          detail: "Confidence 0.74 / 4 overnight inquiries with no booked job",
          kind: "evidence",
        },
      ],
      createdAtIso: "2026-06-16T06:40:00.000Z",
      updatedAt: "Jun 16, 2026",
      updatedAtIso: "2026-06-16T09:05:00.000Z",
      pieces: [
        {
          id: "demo-bprr-email",
          title: "Still dealing with that burst pipe?",
          kind: "Email",
          channel: "Email",
          status: "pending_approval",
          rawStatus: "pending_approval",
          needsReview: true,
          preview: "We saw you reached out overnight. A crew can be at your door this morning, ready to go.",
          compliance: "Replies to an inbound inquiry only. Response-time language is a historical average.",
          body:
            "We saw you reached out about a burst pipe overnight — we don't want you waiting.\n\nA Summit Restoration crew can be at your door this morning with extraction and drying equipment ready to go, and we'll document everything for your insurer.\n\nReply or tap below and we'll lock in a priority slot.\n\nBook a morning crew →",
          media: [{ id: "demo-bprr-email-img", type: "image", title: "Water extraction in progress", seed: "bsr-bprr-extract" }],
        },
        {
          id: "demo-bprr-sms",
          title: "SMS — Priority callback",
          kind: "SMS",
          channel: "SMS",
          status: "Draft",
          rawStatus: "draft",
          needsReview: false,
          preview: "Your overnight water emergency is still our priority. Want a crew this morning? Reply YES.",
          compliance: "Draft — includes opt-out, pending review.",
          body: "Summit Restoration: your overnight water emergency is still our priority. Want a crew this morning? Reply YES, or STOP to opt out.",
        },
      ],
    },
    {
      id: "demo-commercial-water-mitigation",
      name: "Commercial Water Mitigation",
      persona: "Property Manager",
      campaignTheme: "Water Mitigation",
      status: "Ready",
      lifecycle: "Ready",
      launchLocked: true,
      driver: "operator",
      owner: "Evan Reppeto",
      objective: "Pre-approve Summit Restoration as the priority water-loss vendor for managed multifamily portfolios.",
      audienceSummary: "Property managers and operations directors overseeing multifamily portfolios in 60091/60093/60201.",
      consideredAudiences: [
        { label: "Individual condo owners", reason: "No budget authority for building-wide work", sizeEstimate: 900 },
      ],
      handoffNote:
        "Partner handoff: mention the 4.9 review average before pricing. These buyers shortlist on reputation, then negotiate.",
      offerSummary: "Managed-building SLA, insurance-ready documentation, and a vendor pre-approval packet.",
      complianceNotes: "B2B outreach to named contacts. SLA language reviewed; no contractual commitment until a packet is signed.",
      whyBuilt: `${agentName} assembled a vendor-packet outreach set targeting property managers ahead of the spring storm season.`,
      recommendedAction: "Everything is approved — send the partner intro and attach the vendor packet.",
      guardrailFlags: ["SLA is a proposal, not a contract"],
      toolsUsed: ["CRM company portfolio match", "Approved media library"],
      channels: ["LinkedIn", "Gmail", "Meta"],
      sourceCount: 5,
      sources: [
        {
          id: "demo-cwm-src-company",
          label: "Lakeview Property Mgmt",
          detail: "Property Manager / 1,240-unit portfolio / Tier-A partner",
          kind: "company",
          recordHref: "/crm/companies/demo-co-lakeview-property",
        },
        {
          id: "demo-cwm-src-contact",
          label: "Marisa Nolan",
          detail: "Regional Portfolio Director / Lakeview Property Mgmt",
          kind: "contact",
          recordHref: "/crm/contacts/demo-ct-marisa-nolan",
        },
      ],
      createdAtIso: "2026-06-12T15:00:00.000Z",
      updatedAt: "Jun 14, 2026",
      updatedAtIso: "2026-06-14T16:40:00.000Z",
      pieces: [
        {
          id: "demo-cwm-email",
          title: "Priority water-loss response for your North Shore properties",
          kind: "Email",
          channel: "Email",
          status: "Approved",
          rawStatus: "approved",
          needsReview: false,
          preview: "When a unit floods, your residents call you first. Pre-approve our crews and request the vendor packet.",
          compliance: "B2B intro to a named contact. SLA framed as a proposal.",
          body:
            "When a unit floods, your residents call you first — and the clock starts the moment they do.\n\nSummit Restoration is set up to be your priority water-loss vendor across managed North Shore buildings: documented response SLAs, insurance-ready paperwork on every job, and one named contact for your whole portfolio.\n\nPre-approve our crews now so there's no scramble when the next storm hits. Reply and I'll send the vendor packet.\n\nRequest the vendor packet →",
        },
        {
          id: "demo-cwm-social",
          title: "Social ad — Managed buildings",
          kind: "Social Ad",
          channel: "Meta",
          status: "Approved",
          rawStatus: "approved",
          needsReview: false,
          preview: "Protect your North Shore portfolio. Priority response for managed buildings.",
          media: [{ id: "demo-cwm-social-img", type: "image", title: "Restored multifamily common area", seed: "bsr-cwm-lobby" }],
        },
        {
          id: "demo-cwm-onepager",
          title: "Vendor packet one-pager",
          kind: "One Pager",
          channel: "Export",
          status: "Approved",
          rawStatus: "approved",
          needsReview: false,
          preview: "Services, response SLA, insurance documentation process, and references — formatted for procurement.",
          media: [{ id: "demo-cwm-doc", type: "file", title: "Vendor packet (PDF)", seed: "bsr-cwm-packet" }],
        },
      ],
    },
    {
      id: "demo-spring-storm-prep",
      name: "Spring Storm Prep",
      persona: "Homeowner Preventative",
      campaignTheme: "Storm Readiness",
      status: "Live",
      lifecycle: "Live",
      launchLocked: false,
      driver: "operator",
      owner: "Evan Reppeto",
      objective: "Drive preventative sump-pump and backwater-valve inspections ahead of spring storms.",
      audienceSummary: "Homeowners with finished basements in flood-prone North Shore zips who have not booked an inspection.",
      consideredAudiences: [],
      handoffNote: null,
      offerSummary: "Discounted pre-season basement and sump inspection with a documented readiness report.",
      complianceNotes: "Promotional pricing disclosed with terms. No scare-tactic claims about specific homes.",
      whyBuilt: `${agentName} timed a preventative inspection push to the spring storm forecast.`,
      recommendedAction: "Campaign is live — monitor inspection bookings and reply rates.",
      guardrailFlags: [],
      toolsUsed: ["Weather forecast signal", "CRM finished-basement segment"],
      channels: ["Instagram", "TikTok", "Gmail"],
      sourceCount: 3,
      sources: [
        {
          id: "demo-ssp-src-forecast",
          label: "Spring storm forecast",
          detail: "Confidence 0.7 / above-average rainfall projected for the season",
          kind: "evidence",
        },
        {
          id: "demo-ssp-src-segment",
          label: "Finished-basement segment",
          detail: "312 homeowners in flood-prone zips with no inspection on file",
          kind: "evidence",
        },
      ],
      createdAtIso: "2026-06-08T12:00:00.000Z",
      updatedAt: "Jun 10, 2026",
      updatedAtIso: "2026-06-10T13:00:00.000Z",
      pieces: [
        {
          id: "demo-ssp-email",
          title: "Email — Beat the spring storms",
          kind: "Email",
          channel: "Email",
          status: "Approved",
          rawStatus: "approved",
          needsReview: false,
          preview:
            "Subject: Is your basement ready for spring storms?\n\nA quick pre-season inspection now can save a flooded basement later. Book your readiness check.",
          media: [{ id: "demo-ssp-email-img", type: "image", title: "Sump pump inspection", seed: "bsr-ssp-sump" }],
        },
        {
          id: "demo-ssp-social",
          title: "Social ad — Storm readiness",
          kind: "Social Ad",
          channel: "Meta",
          status: "Approved",
          rawStatus: "approved",
          needsReview: false,
          preview: "Spring storms are coming. Is your basement ready? Book a pre-season inspection.",
          media: [{ id: "demo-ssp-social-img", type: "image", title: "Storm clouds over rooftops", seed: "bsr-ssp-storm" }],
        },
      ],
    },
    {
      id: "demo-mold-remediation-awareness",
      name: "Mold Remediation Awareness",
      persona: "Homeowner Rebuild",
      campaignTheme: "Mold Remediation",
      status: "Live",
      lifecycle: "Live",
      launchLocked: false,
      driver: "agent",
      owner: agentName,
      objective: "Educate homeowners on post-water-loss mold risk and convert to remediation assessments.",
      audienceSummary: "Homeowners with a closed water-loss job in the last 60 days who have not had a mold assessment.",
      consideredAudiences: [],
      handoffNote: null,
      offerSummary: "Free mold risk assessment with lab-backed air sampling and a remediation plan.",
      complianceNotes: "Educational framing. Health claims limited to general mold-growth timelines, no diagnosis language.",
      whyBuilt: `${agentName} identified recently restored homes at elevated mold risk and built a follow-up education set.`,
      recommendedAction: "Live — track assessment bookings from recently restored homes.",
      guardrailFlags: ["No medical/diagnostic claims"],
      toolsUsed: ["CRM closed-job lookback", "Approved media library"],
      channels: ["Meta", "Gmail", "Landing page"],
      sourceCount: 4,
      sources: [
        {
          id: "demo-mra-src-jobs",
          label: "Recently closed water-loss jobs",
          detail: "41 homes restored in the last 60 days with no mold assessment on file",
          kind: "evidence",
        },
        {
          id: "demo-mra-src-lead",
          label: "Lead from a preventative inquiry",
          detail: "Basement waterproofing interest / elevated humidity flagged",
          kind: "lead",
          recordHref: "/crm/leads/demo-ld-skokie-preventative",
        },
      ],
      createdAtIso: "2026-06-06T10:00:00.000Z",
      updatedAt: "Jun 8, 2026",
      updatedAtIso: "2026-06-08T11:30:00.000Z",
      pieces: [
        {
          id: "demo-mra-email",
          title: "Email — Hidden mold after water damage",
          kind: "Email",
          channel: "Email",
          status: "Approved",
          rawStatus: "approved",
          needsReview: false,
          preview:
            "Subject: Water's gone — but is mold growing?\n\nMold can take hold within 48 hours of water exposure. A quick assessment confirms your home is truly dry and safe.",
        },
        {
          id: "demo-mra-landing",
          title: "Landing page — Mold risk assessment",
          kind: "Landing Page",
          channel: "Landing page",
          status: "Approved",
          rawStatus: "approved",
          needsReview: false,
          preview: "Book a lab-backed mold assessment. See what air sampling reveals and get a clear remediation plan.",
          media: [{ id: "demo-mra-landing-img", type: "image", title: "Air sampling equipment", seed: "bsr-mra-sampling" }],
        },
      ],
    },
    {
      id: "demo-insurance-partner-referral",
      name: "Insurance Partner Referral",
      persona: "Insurance Agent",
      campaignTheme: "Partner Development",
      status: "Ready",
      lifecycle: "Ready",
      launchLocked: true,
      driver: "operator",
      owner: "Evan Reppeto",
      objective: "Build a referral pipeline with independent insurance agents for water and fire losses.",
      audienceSummary: "Independent property & casualty agents in the North Shore who place homeowner policies.",
      consideredAudiences: [
        { label: "Captive agents", reason: "Cannot refer outside their carrier network", sizeEstimate: 320 },
      ],
      handoffNote: "Referral partner note: this is a relationship build, not a pitch. No pricing in the first conversation.",
      offerSummary: "Co-branded claims-support packet and a named restoration contact for fast policyholder response.",
      complianceNotes: "B2B partner outreach. No referral-fee language that would violate insurance regulations.",
      whyBuilt: `${agentName} mapped local agents with high homeowner-policy volume and prepared a referral outreach packet.`,
      recommendedAction: "Approved and ready — send the partner intro with the claims-support packet attached.",
      guardrailFlags: ["No referral-fee inducements"],
      toolsUsed: ["Local agent directory match", "CRM partner segment"],
      channels: ["LinkedIn", "Gmail"],
      sourceCount: 5,
      sources: [
        {
          id: "demo-ipr-src-company",
          label: "Evanston Mutual Insurance",
          detail: "Independent P&C agency / high homeowner-policy volume",
          kind: "company",
          recordHref: "/crm/companies/demo-co-evanston-insurance",
        },
        {
          id: "demo-ipr-src-contact",
          label: "Tasha Greene",
          detail: "Principal agent / Evanston Mutual Insurance",
          kind: "contact",
          recordHref: "/crm/contacts/demo-ct-tasha-greene",
        },
      ],
      createdAtIso: "2026-06-04T14:00:00.000Z",
      updatedAt: "Jun 6, 2026",
      updatedAtIso: "2026-06-06T15:10:00.000Z",
      pieces: [
        {
          id: "demo-ipr-email",
          title: "Email — Restoration partner for your policyholders",
          kind: "Email",
          channel: "Email",
          status: "Approved",
          rawStatus: "approved",
          needsReview: false,
          preview:
            "Subject: A restoration partner your policyholders can trust\n\nWhen a claim comes in, give your clients a named contact and fast, documented response. Let's set up a referral path.",
        },
        {
          id: "demo-ipr-onepager",
          title: "Claims-support one-pager",
          kind: "One Pager",
          channel: "Export",
          status: "Approved",
          rawStatus: "approved",
          needsReview: false,
          preview: "How we document losses, coordinate with adjusters, and keep policyholders informed end to end.",
          media: [{ id: "demo-ipr-doc", type: "file", title: "Claims-support packet (PDF)", seed: "bsr-ipr-packet" }],
        },
      ],
    },
    {
      id: "demo-wildfire-smoke-cleanup",
      name: "Wildfire Smoke Cleanup",
      persona: "Homeowner Rebuild",
      campaignTheme: "Smoke & Odor",
      status: "Archived",
      lifecycle: "In review",
      launchLocked: true,
      driver: "agent",
      owner: agentName,
      objective: "Offer smoke and soot remediation to homeowners affected by regional wildfire smoke events.",
      audienceSummary: "Homeowners in affected zips after a regional air-quality advisory from wildfire smoke.",
      consideredAudiences: [],
      handoffNote: null,
      offerSummary: "Smoke and odor remediation with HVAC cleaning and air-quality verification.",
      complianceNotes: "Tied to a specific air-quality advisory window. Archived once the event passed.",
      whyBuilt: `${agentName} drafted this for a wildfire smoke event that has since passed; archived for reuse next season.`,
      recommendedAction: "Archived — reactivate and re-time copy when the next regional smoke advisory issues.",
      guardrailFlags: ["Event-windowed — verify advisory before reuse"],
      toolsUsed: ["Air-quality advisory signal"],
      channels: ["Meta", "Instagram", "Gmail", "SMS"],
      sourceCount: 2,
      sources: [
        {
          id: "demo-wsc-src-advisory",
          label: "Regional air-quality advisory (expired)",
          detail: "Wildfire smoke event / advisory has since lifted",
          kind: "evidence",
        },
      ],
      createdAtIso: "2026-05-26T09:00:00.000Z",
      updatedAt: "May 28, 2026",
      updatedAtIso: "2026-05-28T10:00:00.000Z",
      pieces: [
        {
          id: "demo-wsc-email",
          title: "Email — Clear the smoke from your home",
          kind: "Email",
          channel: "Email",
          status: "Archived",
          rawStatus: "archived",
          needsReview: false,
          preview:
            "Subject: Lingering smoke smell after the wildfires?\n\nSmoke and soot settle into HVAC systems and soft surfaces. We clean, deodorize, and verify your air is clear.",
          media: [{ id: "demo-wsc-email-img", type: "image", title: "HVAC cleaning crew", seed: "bsr-wsc-hvac" }],
        },
        {
          id: "demo-wsc-social",
          title: "Social ad — Smoke remediation",
          kind: "Social Ad",
          channel: "Meta",
          status: "Archived",
          rawStatus: "archived",
          needsReview: false,
          preview: "Breathe easy again. Professional smoke and odor remediation after the wildfires.",
        },
      ],
    },
  ];
}

export async function getCampaignWorkspaceDetail(
  campaignId: string,
  client?: SupabaseClient,
  agentName = "Arc",
  orgId?: string,
  workspaceId?: string | null,
): Promise<CampaignWorkspaceDetail> {
  if (!client && !isSupabaseAdminConfigured()) {
    // Local preview has no database. Build the same rich review workspace from
    // the demo library so /campaigns/[id] renders the real layout instead of an
    // "unavailable" shell. Nothing here is sendable — demo data only.
    const demo = demoCampaigns(agentName).find((campaign) => campaign.id === campaignId);
    if (demo) return buildDemoCampaignWorkspaceDetail(demo, agentName);
    return { status: "not_found" };
  }

  try {
    const supabase = client ?? getSupabaseAdminClient();
    const resolvedOrgId = orgId;
    const { data, error } = await applyCampaignScope(
      supabase.from("campaigns").select(CAMPAIGN_SELECT).eq("id", campaignId),
      resolvedOrgId,
      workspaceId,
    ).maybeSingle();
    assertSupabaseResult("campaigns", error);

    if (!data) {
      return { status: "not_found" };
    }

    const campaign = data as CampaignRow;
    const [assets, events, agentTasks] = await Promise.all([
      selectIn<CampaignAssetRow>(supabase, "campaign_assets", ASSET_SELECT, "campaign_id", [campaignId], "updated_at", resolvedOrgId, workspaceId),
      selectIn<CampaignEventRow>(supabase, "campaign_events", "id,event_type,actor,detail,occurred_at", "campaign_id", [campaignId], "occurred_at", resolvedOrgId, workspaceId),
      selectIn<AgentTaskRow>(supabase, "agent_tasks", AGENT_TASK_SELECT, "campaign_id", [campaignId], "created_at", resolvedOrgId, workspaceId),
    ]);
    const assetIds = assets.map((asset) => asset.id);
    const [campaignApprovals, assetApprovals] = await Promise.all([
      selectIn<ApprovalItemRow>(supabase, "approval_items", APPROVAL_SELECT, "campaign_id", [campaignId], "submitted_at", resolvedOrgId, workspaceId),
      selectIn<ApprovalItemRow>(supabase, "approval_items", APPROVAL_SELECT, "campaign_asset_id", assetIds, "submitted_at", resolvedOrgId, workspaceId),
    ]);
    const approvals = uniqueById([...campaignApprovals, ...assetApprovals]);
    const approvalIds = approvals.map((approval) => approval.id);
    const [assetOutputs, approvalOutputs] = await Promise.all([
      selectIn<AgentOutputRow>(supabase, "agent_outputs", OUTPUT_SELECT, "campaign_asset_id", assetIds, "created_at", resolvedOrgId, workspaceId),
      selectIn<AgentOutputRow>(supabase, "agent_outputs", OUTPUT_SELECT, "approval_item_id", approvalIds, "created_at", resolvedOrgId, workspaceId),
    ]);
    const outputs = uniqueById([...assetOutputs, ...approvalOutputs]);
    const decisions = await selectIn<ApprovalDecisionRow>(supabase, "approval_decisions", DECISION_SELECT, "approval_item_id", approvalIds, "decided_at", resolvedOrgId);
    // selectIn orders descending, so each group's head is the agent's latest word.
    // Advisory data only: if the table is missing or the read fails, the campaign
    // still renders without it — a recommendation must never take down the page.
    const recommendations = groupByApprovalItem(
      await selectIn<ApprovalRecommendationRow>(
        supabase,
        "approval_recommendations",
        RECOMMENDATION_SELECT,
        "approval_item_id",
        approvalIds,
        "created_at",
        resolvedOrgId,
        workspaceId,
      ).catch(() => []),
    );
    // The comment that used to sit here said guardrail_findings has no org_id
    // column and that passing one would query a column that doesn't exist. That
    // stopped being true when BSR-653 made org_id and workspace_id NOT NULL on
    // this table; the read simply never caught up. Scoped explicitly now —
    // transitive scoping through campaign_asset_id was correct but relied on
    // every caller passing ids it had already filtered, which is a property of
    // the callers rather than of this query.
    const findings = groupFindingsByAsset(
      await selectIn<GuardrailFindingRow>(
        supabase,
        "guardrail_findings",
        FINDING_SELECT,
        "campaign_asset_id",
        assetIds,
        "created_at",
        resolvedOrgId,
        workspaceId,
      ).catch(() => []),
    );
    const relatedIds = collectRelatedIds(campaign, approvals);
    const [companies, contacts, leads] = await Promise.all([
      selectIn<CompanyRow>(supabase, "companies", "id,name,website_url,phone,email,partner_tier", "id", relatedIds.companyIds, undefined, resolvedOrgId, workspaceId),
      selectIn<ContactRow>(supabase, "contacts", "id,full_name,email,phone,title", "id", relatedIds.contactIds, undefined, resolvedOrgId, workspaceId),
      selectIn<LeadRow>(supabase, "leads", "id,source,status,loss_summary,lead_score,metadata", "id", relatedIds.leadIds, undefined, resolvedOrgId, workspaceId),
    ]);

    const assetsBeforeReview = addPreviewCampaignPieces(
      campaignId,
      buildWorkspaceAssets(assets, approvals, outputs, agentName, recommendations, findings),
      campaign.updated_at,
    );
    const mediaBeforeReview = renderableMedia(
      uniqueMedia([
        ...collectMediaFromCampaign(campaign),
        ...assetsBeforeReview.flatMap((asset) => asset.media),
        ...approvals.flatMap((approval) => collectMediaFromApproval(approval)),
        ...outputs.flatMap((output) => collectMediaFromOutput(output, agentName)),
      ]),
    );
    // One lookup for the whole page, applied to both the per-deliverable tiles
    // and the campaign-wide creative list, so the same asset cannot report two
    // different review states in two places on one screen.
    const mediaReviews = await resolveMediaReviews(supabase, mediaBeforeReview, resolvedOrgId);
    const assetsView = assetsBeforeReview.map((asset) => ({
      ...asset,
      media: asset.media.map((item) => withMediaReview(item, mediaReviews)),
    }));
    const media = mediaBeforeReview.map((item) => withMediaReview(item, mediaReviews));
    const sources = buildSources({ campaign, assets, approvals, companies, contacts, leads, outputs }, agentName);
    const reasoning = buildReasoning(campaign, assets, agentName);
    const rollup = deriveCampaignRollup(collectPieceStatuses(assets, approvals));

    return {
      status: "live",
      campaign: {
        id: campaign.id,
        name: cleanCampaignName(campaign.name),
        persona: humanize(campaign.persona),
        campaignTheme: campaign.campaign_theme?.trim() || humanize(campaign.restoration_focus ?? ""),
        status: statusLabel(campaign.status),
        // Empty rather than a placeholder sentence, for the same reason as the
        // list read above — and here it un-breaks THREE guards the view already
        // had. The brief list filters falsy values (`.filter(([, v]) => v)`),
        // the header subtitle falls back through `objective || …`, and both were
        // inert because a placeholder is truthy. Three of the five live
        // campaigns have a null objective, so three detail pages headlined with
        // "No objective captured yet." under the campaign's own name.
        objective: campaign.objective?.trim() ?? "",
        audienceSummary: campaign.audience_summary?.trim() ?? "",
        offerSummary: campaign.offer_summary?.trim() ?? "",
        complianceNotes: campaign.compliance_notes ?? "No campaign-level compliance notes captured.",
        // The two package fields that complete the contract: what targeting was
        // weighed and rejected, and the note for whoever continues offline.
        consideredAudiences: parseConsideredAudiences(campaign.considered_audiences),
        handoffNote: normalizeHandoffNote(campaign.handoff_note),
        owner: campaign.owner ?? "Unassigned",
        launchLocked: campaign.launch_locked,
        createdAt: formatDate(campaign.created_at),
        updatedAt: formatDate(campaign.updated_at),
        rollup,
      },
      assets: assetsView,
      groupedAssets: groupAssets(assetsView),
      approvals: approvals.map((approval) => mapApproval(approval, agentName)),
      media,
      sources,
      reasoning,
      executiveOverview: buildExecutiveOverview({ campaign, assets, approvals, sources, reasoning, agentName }),
      activity: outputs.map(mapOutput),
      events: events.map((event) => ({
        id: event.id,
        type: humanize(event.event_type),
        actor: event.actor ?? "System",
        detail: event.detail ?? "Campaign event recorded.",
        occurredAt: formatDate(event.occurred_at),
      })),
      metrics: {
        assets: assetsView.length,
        approvals: approvals.length,
        media: media.length,
        sources: sources.length,
      },
      launchState: buildLaunchState(assetsView, campaign.launch_locked),
      markConversation: buildArcConversation(agentTasks, outputs, agentName),
      approvalHistory: buildApprovalHistory(decisions, approvals),
      auditLog: buildAuditLog(events, outputs, agentName),
    };
  } catch (error) {
    // Degrade, but not silently — this read IS the screen, so an empty
    // state here is indistinguishable from an outage (BSR-544).
    reportDegraded(error, { scope: "campaigns.getCampaignWorkspaceDetail", surface: "primary" });
    return {
      status: "unavailable",
      message: error instanceof Error ? error.message : "Campaign detail is unavailable.",
    };
  }
}

/**
 * Assemble the two-way conversation with Arc, chronological. Operator turns are
 * the human-initiated directives we queue (agent_tasks with a recorded
 * requester); Arc's turns are the work he produced (agent_outputs). Both are
 * durable records — no live chat, just the real handoff trail rendered as a
 * thread.
 */
const DECISION_ACTION: Record<string, { action: string; tone: CampaignDecisionEvent["tone"] }> = {
  approved: { action: "Approved", tone: "green" },
  declined: { action: "Sent back for rework", tone: "red" },
  rejected: { action: "Sent back for rework", tone: "red" },
  archived: { action: "Removed from queue", tone: "gray" },
  revision_requested: { action: "Revision requested", tone: "amber" },
  reverted: { action: "Re-opened for review", tone: "blue" },
};

/** Build the approval audit trail — who decided what, when, and why — newest
 *  first. Sourced from approval_decisions; titles resolved from the items. */
export function buildApprovalHistory(decisions: ApprovalDecisionRow[], approvals: ApprovalItemRow[]): CampaignDecisionEvent[] {
  const titleById = new Map(approvals.map((approval) => [approval.id, buildApprovalTitle(approval)]));

  return decisions
    .slice()
    .sort((a, b) => b.decided_at.localeCompare(a.decided_at))
    .map((decision) => {
      const mapped = DECISION_ACTION[decision.decision] ?? { action: humanize(decision.decision), tone: "gray" as const };
      return {
        id: decision.id,
        decision: decision.decision,
        action: mapped.action,
        tone: mapped.tone,
        itemTitle: titleById.get(decision.approval_item_id) ?? "Approval item",
        decidedBy: decision.decided_by,
        at: formatDate(decision.decided_at),
        notes: getString(decision.decision_notes),
      };
    });
}

/** Classify who an event's actor is, for audit filtering. */
function classifyActor(actor: string | null): AuditEntry["actorKind"] {
  if (!actor || /^system$/i.test(actor)) return "system";
  if (/arc|arc/i.test(actor)) return "arc";
  return "user";
}

/** Unified, newest-first campaign audit trail: every recorded event plus the
 *  concrete work Arc produced, tagged by actor so the UI can filter to user or
 *  Arc activity. */
export function buildAuditLog(events: CampaignEventRow[], outputs: AgentOutputRow[], agentName = "Arc"): AuditEntry[] {
  const items: Array<AuditEntry & { sortAt: string }> = [];

  for (const event of events) {
    items.push({
      id: `evt-${event.id}`,
      actor: event.actor ?? "System",
      actorKind: classifyActor(event.actor),
      action: humanize(event.event_type),
      detail: event.detail ?? "",
      at: formatDate(event.occurred_at),
      sortAt: event.occurred_at,
    });
  }

  for (const output of outputs) {
    items.push({
      id: `out-${output.id}`,
      actor: agentName,
      actorKind: "arc",
      action: `Produced ${humanize(output.output_type)}`,
      detail: output.title,
      at: formatDate(output.created_at),
      sortAt: output.created_at,
    });
  }

  return items
    .sort((a, b) => b.sortAt.localeCompare(a.sortAt))
    .map((entry) => ({
      id: entry.id,
      actor: entry.actor,
      actorKind: entry.actorKind,
      action: entry.action,
      detail: entry.detail,
      at: entry.at,
    }));
}

export function buildArcConversation(tasks: AgentTaskRow[], outputs: AgentOutputRow[], agentName = "Arc"): ArcMessage[] {
  // Raw `at` holds the ISO timestamp for sorting; formatted on the way out.
  const items: ArcMessage[] = [];

  for (const task of tasks) {
    const metadata = asObject(task.metadata);
    const requester = getString(metadata.requested_by);
    const instruction = getString(metadata.human_instruction) ?? task.objective;
    // Only human-initiated directives belong in the conversation; autonomous
    // orchestrator tasks surface through their outputs instead.
    if (!requester && !getString(metadata.human_instruction)) continue;
    items.push({
      id: `task-${task.id}`,
      role: "operator",
      author: requester ?? "Operator",
      kind: humanize(task.task_type),
      title: null,
      body: instruction,
      at: task.created_at,
      status: statusLabel(task.status),
    });
  }

  for (const output of outputs) {
    items.push({
      id: `output-${output.id}`,
      role: "arc",
      author: agentName,
      kind: humanize(output.output_type),
      title: output.title,
      body: buildReadablePreview(output.edited_body ?? output.body ?? "", output.structured_payload),
      at: output.created_at,
      status: statusLabel(output.approval_status),
    });
  }

  return items
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((message) => ({ ...message, at: formatDate(message.at) }));
}

/** Pure: the decided state of a single deliverable. Every asset is a piece that
 *  needs approval — derive from its approval gate if present, else its own
 *  status, so assets without a gate are never a dead-end. */
function assetDecisionState(asset: CampaignWorkspaceAsset): "approved" | "declined" | "archived" | "pending" {
  const status = asset.approval?.status ?? asset.status;
  if (/approved/i.test(status)) return "approved";
  if (/declined|rejected/i.test(status)) return "declined";
  if (/archived/i.test(status)) return "archived";
  return "pending";
}

function collectPieceStatuses(assets: CampaignAssetRow[], approvals: ApprovalItemRow[]): string[] {
  const approvalByAssetId = new Map<string, ApprovalItemRow>();
  const standaloneApprovals: ApprovalItemRow[] = [];
  for (const approval of approvals) {
    if (approval.campaign_asset_id) {
      if (!approvalByAssetId.has(approval.campaign_asset_id)) approvalByAssetId.set(approval.campaign_asset_id, approval);
    } else {
      standaloneApprovals.push(approval);
    }
  }
  return [
    ...assets.map((asset) => approvalByAssetId.get(asset.id)?.status ?? (/approved|deployed/i.test(asset.status) ? asset.status : "draft")),
    ...standaloneApprovals.map((approval) => approval.status),
  ];
}

/** Pure: derive launch readiness + lifecycle. Every (non-removed) deliverable
 *  counts as a required piece; a piece is deployed once it's approved and no
 *  longer dispatch-locked (supports deploying pieces ahead of full launch). */
export function buildLaunchState(assets: CampaignWorkspaceAsset[], launchLocked: boolean): CampaignLaunchState {
  const considered = assets.filter((asset) => assetDecisionState(asset) !== "archived");
  const requiredCount = considered.length;
  const approved = considered.filter((asset) => assetDecisionState(asset) === "approved");
  const approvedCount = approved.length;
  const deployedCount = approved.filter((asset) => !asset.dispatchLocked).length;
  const decidedCount = considered.filter((asset) => assetDecisionState(asset) !== "pending").length;
  const pendingCount = requiredCount - decidedCount;
  const live = !launchLocked;
  const ready = !live && requiredCount > 0 && pendingCount === 0 && approvedCount > 0;
  const lifecycle: CampaignLaunchState["lifecycle"] = live
    ? "Live"
    : requiredCount === 0
      ? "Drafting"
      : pendingCount > 0
        ? "In review"
        : "Ready";

  return { requiredCount, approvedCount, pendingCount, deployedCount, ready, live, lifecycle };
}

export type LinkedCampaignRecordKind = "company" | "contact" | "lead" | "property";

export type LinkedCampaign = {
  id: string;
  name: string;
  persona: string;
  lifecycle: CampaignLaunchState["lifecycle"];
  pendingCount: number;
  href: string;
};

/** Pure: merge the referencing campaign ids from the direct `campaigns` scan and
 *  the `approval_items` scan, dropping nulls and de-duplicating. */
export function collectReferencingCampaignIds(
  directRows: Array<{ id: string }>,
  approvalRows: Array<{ campaign_id: string | null }>,
): string[] {
  return [
    ...new Set([
      ...directRows.map((row) => row.id),
      ...approvalRows.map((row) => row.campaign_id).filter((id): id is string => Boolean(id)),
    ]),
  ];
}

/** Pure: the `campaigns`/`approval_items` FK column for a CRM record kind. */
export function columnFor(kind: LinkedCampaignRecordKind): "company_id" | "contact_id" | "lead_id" | "property_id" {
  switch (kind) {
    case "company":
      return "company_id";
    case "contact":
      return "contact_id";
    case "lead":
      return "lead_id";
    case "property":
      return "property_id";
  }
}

/** Campaigns that reference a CRM record — directly (campaigns.<fk>) or through
 *  an approval item (approval_items.<fk>). Read-only; returns [] when Supabase
 *  isn't configured or on any error, so CRM record pages never break. */
export async function getCampaignsForRecord(
  kind: LinkedCampaignRecordKind,
  recordId: string,
  client?: SupabaseClient,
  agentName = "Arc",
  orgId?: string,
  workspaceId?: string | null,
): Promise<LinkedCampaign[]> {
  if (!client && !isSupabaseAdminConfigured()) return [];

  try {
    const supabase = client ?? getSupabaseAdminClient();
    const column = columnFor(kind);

    // These were previously unscoped, leaning on the record id having been
    // resolved in-tenant. That is inherited isolation, not enforced isolation —
    // scope them explicitly now that campaigns carry a workspace.
    const [{ data: directRows, error: directError }, { data: approvalRows, error: approvalError }] = await Promise.all([
      applyCampaignScope(supabase.from("campaigns").select("id").eq(column, recordId), orgId, workspaceId),
      applyOrgScope(supabase.from("approval_items").select("campaign_id").eq(column, recordId), orgId),
    ]);
    assertSupabaseResult("campaigns", directError);
    assertSupabaseResult("approval_items", approvalError);

    const ids = collectReferencingCampaignIds(
      (directRows ?? []) as Array<{ id: string }>,
      (approvalRows ?? []) as Array<{ campaign_id: string | null }>,
    );
    if (ids.length === 0) return [];

    const { data, error } = await applyCampaignScope(
      supabase.from("campaigns").select(CAMPAIGN_SELECT).in("id", ids),
      orgId,
      workspaceId,
    ).order("updated_at", { ascending: false });
    assertSupabaseResult("campaigns", error);
    const campaigns = (data ?? []) as CampaignRow[];
    const campaignIds = campaigns.map((campaign) => campaign.id);

    const [assets, approvals] = await Promise.all([
      selectIn<CampaignAssetRow>(supabase, "campaign_assets", ASSET_SELECT, "campaign_id", campaignIds, "updated_at"),
      selectIn<ApprovalItemRow>(supabase, "approval_items", APPROVAL_SELECT, "campaign_id", campaignIds, "submitted_at"),
    ]);
    const approvalOutputs = await selectIn<AgentOutputRow>(
      supabase,
      "agent_outputs",
      OUTPUT_SELECT,
      "approval_item_id",
      approvals.map((approval) => approval.id),
      "created_at",
    );

    return campaigns.map((campaign) => {
      const campaignApprovals = approvals.filter((approval) => approval.campaign_id === campaign.id);
      const campaignAssetRows = assets.filter((asset) => asset.campaign_id === campaign.id);
      const campaignAssets = buildWorkspaceAssets(
        campaignAssetRows,
        campaignApprovals,
        approvalOutputs.filter((output) => output.approval_item_id && campaignApprovals.some((approval) => approval.id === output.approval_item_id)),
        agentName,
      );
      const launch = buildLaunchState(campaignAssets, campaign.launch_locked);
      return {
        id: campaign.id,
        name: cleanCampaignName(campaign.name),
        persona: humanize(campaign.persona),
        lifecycle: launch.lifecycle,
        pendingCount: launch.pendingCount,
        href: `/campaigns/${campaign.id}`,
      };
    });
  } catch {
    return [];
  }
}

export type PendingDeliverable = { assetId: string; title: string; kind: string };

/** Pure: the deliverables on a campaign still awaiting an operator decision,
 *  shaped for the inline triage strip. */
export function selectPendingDeliverables(assets: CampaignWorkspaceAsset[]): PendingDeliverable[] {
  return assets
    .filter((asset) => assetDecisionState(asset) === "pending")
    .map((asset) => ({ assetId: asset.id, title: asset.title, kind: asset.assetType }));
}

function buildListContentPieces(assets: CampaignWorkspaceAsset[]): CampaignListContentPiece[] {
  return assets.map((asset) => ({
    id: asset.id,
    title: asset.title,
    kind: asset.assetType,
    channel: asset.channel,
    status: asset.status,
    preview: listPiecePreview(asset),
    media: asset.media.slice(0, 4),
    updatedAt: asset.updatedAt,
    needsReview: assetDecisionState(asset) === "pending",
  }));
}

function listPiecePreview(asset: CampaignWorkspaceAsset) {
  const text = (asset.preview && asset.preview !== EMPTY_READABLE_PREVIEW ? asset.preview : asset.body).trim();
  if (!text) return "No readable draft has been attached yet.";
  return text.length > 420 ? `${text.slice(0, 417).trimEnd()}...` : text;
}

function mapAsset(asset: CampaignAssetRow): CampaignWorkspaceAsset {
  const rawBody = asset.approved_body ?? asset.edited_body ?? asset.draft_body ?? "";
  const readableBody = buildReadablePreview(rawBody, asset.prompt_inputs, asset.reasoning_payload);
  const media = renderableMedia(collectMediaFromAsset(asset));
  const guardrail = asObject(asObject(asset.audit_payload).guardrail);
  // `current` intentionally excludes draft_body — there is no meaningful revision
  // until the operator approves or edits the piece, so draft-vs-draft is no diff.
  const current = asset.approved_body ?? asset.edited_body ?? "";
  const draft = asset.draft_body ?? "";
  const revision = draft && current && draft.trim() !== current.trim() ? { draft, current } : null;
  return {
    id: asset.id,
    title: asset.title,
    assetType: humanize(asset.asset_type),
    category: classifyAssetCategory(asset),
    channel: humanize(asset.channel ?? asset.asset_type),
    // Raw, not labelled — see demoAssetStatus. The view labels it.
    status: asset.status,
    body: readableBody === EMPTY_READABLE_PREVIEW ? rawBody : readableBody,
    preview: readableBody,
    complianceNotes: asset.compliance_notes ?? "No asset-level compliance notes captured.",
    guardrailFlags: asStringArray(guardrail.flags),
    blockedPhrases: asStringArray(guardrail.blocked_phrases),
    // attachApproval fills this in once the gating approval is known.
    recommendation: null,
    findings: [],
    claimsReviewed: false,
    dispatchLocked: asset.dispatch_locked,
    toolSource: getString(asset.tool_source),
    updatedAt: formatDate(asset.updated_at),
    media,
    revision,
    approval: null,
  };
}

function buildWorkspaceAssets(
  assets: CampaignAssetRow[],
  approvals: ApprovalItemRow[],
  outputs: AgentOutputRow[],
  agentName: string,
  recommendations?: Map<string, ApprovalRecommendationRow[]>,
  findings?: Map<string, CampaignAssetFinding[]>,
): CampaignWorkspaceAsset[] {
  const assetIds = new Set(assets.map((asset) => asset.id));
  const outputApprovalIds = new Set(outputs.map((output) => output.approval_item_id).filter((id): id is string => Boolean(id)));

  // First (most recent) approval per asset — prefer a still-pending one so the
  // card offers Approve/Decline rather than echoing a stale decided record.
  const approvalByAssetId = new Map<string, ApprovalItemRow>();
  for (const approval of approvals) {
    if (!approval.campaign_asset_id) continue;
    const existing = approvalByAssetId.get(approval.campaign_asset_id);
    if (!existing || (isDecidedApproval(existing) && !isDecidedApproval(approval))) {
      approvalByAssetId.set(approval.campaign_asset_id, approval);
    }
  }
  const approvalById = new Map(approvals.map((approval) => [approval.id, approval]));
  // Approvals that already gate a real asset — outputs tied to these must NOT
  // become a second card for the same deliverable (the duplicate-email bug).
  const assetApprovalIds = new Set([...approvalByAssetId.values()].map((approval) => approval.id));

  const mappedAssets = assets.map((asset) => ({
    ...attachApproval(mapAsset(asset), approvalByAssetId.get(asset.id), recommendations),
    findings: findings?.get(asset.id) ?? [],
  }));
  const outputAssets = outputs
    .filter(
      (output) =>
        (!output.campaign_asset_id || !assetIds.has(output.campaign_asset_id)) &&
        (!output.approval_item_id || !assetApprovalIds.has(output.approval_item_id)),
    )
    .map((output) =>
      attachApproval(
        mapOutputAsAsset(output, agentName),
        output.approval_item_id ? approvalById.get(output.approval_item_id) : undefined,
        recommendations,
      ),
    );
  const approvalAssets = approvals
    .filter((approval) => !approval.campaign_asset_id && !outputApprovalIds.has(approval.id))
    // These carry their own approval already, so they only need the recommendation.
    .map((approval) => ({
      ...mapApprovalAsAsset(approval, agentName),
      recommendation: pickRecommendation(recommendations?.get(approval.id)),
      claimsReviewed: reviewedByCritic(recommendations?.get(approval.id)),
    }));

  // Real campaign_assets come first, so when an output/approval describes the
  // same deliverable, the real asset (correct id + gating approval) wins and the
  // duplicate is dropped. Dedup by content, not just id — the same email can
  // arrive as an asset AND an output AND an approval.
  return dedupeDeliverables(uniqueById([...mappedAssets, ...outputAssets, ...approvalAssets]));
}

function addPreviewCampaignPieces(campaignId: string, assets: CampaignWorkspaceAsset[], updatedAt: string): CampaignWorkspaceAsset[] {
  if (process.env.NODE_ENV === "production") return assets;
  if (campaignId !== "10000000-0000-4000-8000-000000000021") return assets;
  const existingIds = new Set(assets.map((asset) => asset.id));
  const previewPieces = buildPreviewCampaignPieces(updatedAt).filter((asset) => !existingIds.has(asset.id));
  return [...assets, ...previewPieces];
}

function buildPreviewCampaignPieces(updatedAt: string): CampaignWorkspaceAsset[] {
  const formattedUpdatedAt = formatDate(updatedAt);
  return [
    {
      id: "preview-sms-storm-follow-up",
      title: "SMS reminder for team admins",
      assetType: "SMS",
      category: "virtual",
      channel: "SMS",
      status: "Draft",
      body: "Hi Maya, quick follow-up: if any teams are still stuck on setup, Meridian can walk them through it this week. Want me to hold a walkthrough slot?",
      preview: "Hi Maya, quick follow-up: if any teams are still stuck on setup, Meridian can walk them through it this week.",
      complianceNotes: "Demo preview content for layout review only.",
      guardrailFlags: [],
      blockedPhrases: [],
      recommendation: null,
    findings: [],
    claimsReviewed: false,
            dispatchLocked: true,
      toolSource: "Preview data",
      updatedAt: formattedUpdatedAt,
      media: [],
      revision: null,
      approval: null,
    },
    {
      id: "preview-media-storm-creative",
      title: "Launch social creative",
      assetType: "Social Ad",
      category: "media",
      channel: "Social Ad",
      status: "Draft",
      body: "Visual concept: a product manager reviewing a team dashboard on a laptop in a modern office. Caption focuses on fast onboarding for team admins.",
      preview: "Social creative concept for team admin onboarding outreach.",
      complianceNotes: "Demo preview content for layout review only.",
      guardrailFlags: [],
      blockedPhrases: [],
      recommendation: null,
    findings: [],
    claimsReviewed: false,
            dispatchLocked: true,
      toolSource: "Preview data",
      updatedAt: formattedUpdatedAt,
      media: [
        {
          id: "preview-media-storm-hallway",
          type: "image",
          origin: "attached",
          title: "Launch creative preview",
          url: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=1200&q=80",
          thumbnailUrl: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=600&q=80",
          mimeType: "image/jpeg",
          description: "Demo preview image for a launch social creative.",
          format: "16:9",
          riskFlags: [],
          libraryAssetId: null,
          storagePath: null,
          review: UNREVIEWED,
          lineage: [
            ["ai", "Made in Higgsfield · seedream"],
            ["ai", "Source job · hf_20260722_0917"],
          ],
          prompt: "Product manager reviewing a team dashboard on a laptop in a bright modern office, photoreal, no text.",
          source: "Preview data",
          virality: null,
        },
      ],
      revision: null,
      approval: null,
    },
    {
      id: "preview-draft-landing-page",
      title: "Team onboarding landing page",
      assetType: "Landing Page",
      category: "virtual",
      channel: "Website",
      status: "Draft",
      body: "Headline: Get your team onboarded fast.\n\nBody: Meridian helps team admins set up workspaces, invite members, and configure workflows before small blockers become bigger delays.\n\nCTA: Request a same-week onboarding walkthrough.",
      preview: "Landing page draft for team admins who need to onboard after a launch.",
      complianceNotes: "Demo preview content for layout review only.",
      guardrailFlags: [],
      blockedPhrases: [],
      recommendation: null,
    findings: [],
    claimsReviewed: false,
            dispatchLocked: true,
      toolSource: "Preview data",
      updatedAt: formattedUpdatedAt,
      media: [],
      revision: null,
      approval: null,
    },
    {
      id: "preview-other-call-script",
      title: "Team onboarding callback script",
      assetType: "Call Script",
      category: "other",
      channel: "CRM",
      status: "pending_approval",
      body: "Open by referencing the launch this week, ask whether any teams are still stuck on setup, then offer a short onboarding walkthrough before the schedule fills.",
      preview: "CRM/call script for teams that responded to recent launch outreach.",
      complianceNotes: "Demo preview content for layout review only.",
      guardrailFlags: [],
      blockedPhrases: [],
      recommendation: null,
    findings: [],
    claimsReviewed: false,
            dispatchLocked: true,
      toolSource: "Preview data",
      updatedAt: formattedUpdatedAt,
      media: [],
      revision: null,
      approval: null,
    },
  ];
}

/** One card per deliverable. Keyed by normalized title: the same piece surfaced
 *  from different tables (asset / output / approval) shares a title but differs
 *  in channel/type, so title is the reliable identity within a campaign. Real
 *  assets are ordered first, so the kept copy has the correct id + gating
 *  approval. */
function dedupeDeliverables(assets: CampaignWorkspaceAsset[]): CampaignWorkspaceAsset[] {
  const seen = new Set<string>();
  const result: CampaignWorkspaceAsset[] = [];
  for (const asset of assets) {
    const key = asset.title.toLowerCase().replace(/\s+/g, " ").trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    result.push(asset);
  }
  return result;
}

function groupByApprovalItem(rows: ApprovalRecommendationRow[]): Map<string, ApprovalRecommendationRow[]> {
  const byId = new Map<string, ApprovalRecommendationRow[]>();
  for (const row of rows) {
    const group = byId.get(row.approval_item_id);
    if (group) group.push(row);
    else byId.set(row.approval_item_id, [row]);
  }
  return byId;
}

/** Only OPEN findings reach the card — an acknowledged or resolved one has been
 *  dealt with and would just be noise on a deliverable awaiting a decision. */
function groupFindingsByAsset(rows: GuardrailFindingRow[]): Map<string, CampaignAssetFinding[]> {
  const byAsset = new Map<string, CampaignAssetFinding[]>();
  for (const row of rows) {
    if (!row.campaign_asset_id || row.status !== "open") continue;
    const finding: CampaignAssetFinding = {
      id: row.id,
      claim: row.matched_text ?? "",
      severity: row.severity,
      // The claims reviewer had been narrating its own lookups into this field —
      // "searches for 'reply' returned nothing", learning ids, tool names. The
      // runner's tool contract stops new ones; this reaches the rows already
      // written, which no prompt change ever can. Removes plumbing only: every
      // claim, number and caveat survives.
      message: humanizeArcProse(row.finding_message) || row.finding_message,
      // All three or none — the CHECK constraint makes a half-populated fix
      // unrepresentable, so a missing target here means "no fix", never
      // "a fix we failed to read".
      fix:
        row.fix_target && row.fix_label
          ? { target: row.fix_target, label: row.fix_label, kind: isFixKind(row.fix_kind) ? row.fix_kind : "text" }
          : null,
    };
    const group = byAsset.get(row.campaign_asset_id);
    if (group) group.push(finding);
    else byAsset.set(row.campaign_asset_id, [finding]);
  }
  return byAsset;
}

/** The agent's latest word on an approval item. Rows arrive newest-first, so the
 *  head is the current recommendation; older ones stay in the ledger. */
function pickRecommendation(rows: ApprovalRecommendationRow[] | undefined): CampaignAssetRecommendation | null {
  const row = rows?.[0];
  if (!row) return null;
  return {
    agent: row.agent,
    verdict: row.recommendation,
    // Same treatment as the findings: strip the plumbing, keep the judgement.
    // Falling back to the raw value matters — a passage that is ENTIRELY machine
    // text would otherwise clean to an empty string, and a blank rationale reads
    // as "the reviewer said nothing" rather than "the reviewer said it badly".
    rationale: humanizeArcProse(row.rationale) || row.rationale || "",
    riskFlags: asStringArray(row.risk_flags),
    suggestedEdits: humanizeArcProse(row.suggested_edits) || row.suggested_edits || "",
  };
}

/** The claims reviewer is `draft-critic` specifically. Any other agent leaving a
 *  recommendation (recommend_on_approval writes as `arc`) is Arc advising on its
 *  own work — that is not an independent review and must not read as one. */
const CLAIMS_REVIEWER = "draft-critic";

function reviewedByCritic(rows: ApprovalRecommendationRow[] | undefined): boolean {
  return (rows ?? []).some((row) => row.agent === CLAIMS_REVIEWER);
}

function attachApproval(
  view: CampaignWorkspaceAsset,
  approval: ApprovalItemRow | undefined,
  recommendations?: Map<string, ApprovalRecommendationRow[]>,
): CampaignWorkspaceAsset {
  if (!approval) return view;
  const rows = recommendations?.get(approval.id);
  return {
    ...view,
    approval: { id: approval.id, status: approval.status },
    recommendation: pickRecommendation(rows),
    claimsReviewed: reviewedByCritic(rows),
  };
}

function isDecidedApproval(approval: ApprovalItemRow): boolean {
  return /approved|declined|archived|rejected/i.test(approval.status);
}

function mapOutputAsAsset(output: AgentOutputRow, agentName: string): CampaignWorkspaceAsset {
  const rawBody = output.edited_body ?? output.body ?? "";
  const readableBody = buildReadablePreview(rawBody, output.structured_payload);
  const media = collectMediaFromOutput(output, agentName);
  const type = output.output_type || "mark_output";

  return {
    id: `output-${output.id}`,
    title: output.title || humanize(type),
    assetType: humanize(type),
    category: classifyAssetText(`${type} ${output.title}`),
    channel: channelLabelFromType(type),
    // Raw status — the view labels it (see demoAssetStatus).
    status: output.approval_status,
    body: readableBody === EMPTY_READABLE_PREVIEW ? rawBody : readableBody,
    preview: readableBody,
    complianceNotes: output.compliance_status ? `Compliance: ${humanize(output.compliance_status)}` : "No output-level compliance notes captured.",
    // agent_outputs carries no guardrail block — the copy screen runs on the
    // campaign_assets path, so an output-derived view has nothing to show.
    guardrailFlags: [],
    blockedPhrases: [],
    recommendation: null,
    findings: [],
    claimsReviewed: false,
    dispatchLocked: true,
    toolSource: `${agentName} output`,
    updatedAt: formatDate(output.updated_at),
    media,
    revision: null,
    approval: null,
  };
}

function mapApprovalAsAsset(approval: ApprovalItemRow, agentName: string): CampaignWorkspaceAsset {
  const rawBody = approval.edited_output ?? approval.draft_output ?? "";
  const readableBody = buildReadablePreview(rawBody, approval.prompt_inputs, approval.reasoning_payload);
  const type = approval.item_type || "approval_item";
  const channel = getString(asObject(approval.prompt_inputs).channel) ?? type;
  const media = collectMediaFromApproval(approval);
  const approvalGuardrail = asObject(asObject(approval.audit_payload).guardrail);

  return {
    id: `approval-${approval.id}`,
    title: buildApprovalTitle(approval),
    assetType: humanize(type),
    category: classifyAssetText(`${type} ${channel} ${buildApprovalTitle(approval)}`),
    channel: humanize(channel),
    // Raw status — the view labels it (see demoAssetStatus).
    status: approval.status,
    body: readableBody === EMPTY_READABLE_PREVIEW ? rawBody : readableBody,
    preview: readableBody,
    complianceNotes: approval.compliance_notes ?? "No approval-level compliance notes captured.",
    // Standalone approvals (no linked campaign_asset — e.g. submit_draft) carry no
    // guardrail block today; read it anyway so screening that path later just works.
    guardrailFlags: asStringArray(approvalGuardrail.flags),
    blockedPhrases: asStringArray(approvalGuardrail.blocked_phrases),
    // buildWorkspaceAssets overlays the recommendation for these.
    recommendation: null,
    findings: [],
    claimsReviewed: false,
    dispatchLocked: approval.locked_until_approved,
    toolSource: approval.requested_by ?? agentName,
    updatedAt: formatDate(approval.updated_at),
    media,
    revision: null,
    approval: { id: approval.id, status: approval.status },
  };
}

/**
 * Pure: distill the "thinking behind it" for the Reasoning tab from Arc's
 * stored reasoning/audit payloads and the tools each asset was built with.
 */
export function buildReasoning(campaign: CampaignRow, assets: CampaignAssetRow[], agentName = "Arc"): CampaignWorkspaceReasoning {
  const reasoning = asObject(campaign.reasoning_payload);
  const audit = asObject(campaign.audit_payload);

  const toolsUsed = uniqueStrings([
    ...assets.map((asset) => asset.tool_source),
    getString(audit.provider),
  ]).map(humanize);

  return {
    whyBuilt:
      getString(reasoning.why_arc_created_it) ??
      getString(campaign.objective) ??
      getString(campaign.offer_summary),
    recommendedAction: getString(reasoning.recommended_action),
    guardrailFlags: asStringArray(reasoning.guardrail_flags),
    toolsUsed,
    promptInputs: buildPromptInputs(assets),
  };
}

export function buildExecutiveOverview(input: {
  campaign: CampaignRow;
  assets: CampaignAssetRow[];
  approvals: ApprovalItemRow[];
  sources: CampaignWorkspaceSource[];
  reasoning: CampaignWorkspaceReasoning;
  agentName?: string;
}): CampaignExecutiveOverview {
  const { campaign, assets, approvals, reasoning, sources, agentName = "Arc" } = input;
  const audience = sentenceFragment(campaign.audience_summary ?? `the ${humanize(campaign.persona)} segment`);
  const offer = sentenceFragment(campaign.offer_summary ?? "the proposed offer");
  const objective = sentenceFragment(campaign.objective ?? campaign.offer_summary ?? "No campaign objective has been captured yet");
  const payloads = [
    asObject(campaign.source_signal),
    asObject(campaign.reasoning_payload),
    asObject(campaign.audit_payload),
    ...assets.flatMap((asset) => [asObject(asset.prompt_inputs), asObject(asset.reasoning_payload), asObject(asset.audit_payload)]),
    ...approvals.flatMap((approval) => [asObject(approval.prompt_inputs), asObject(approval.reasoning_payload), asObject(approval.audit_payload)]),
  ];
  // Not pre-trimmed to a string: with no payload answer and no recorded
  // reasoning this is genuinely absent, and interpolating "" into the sentence
  // below would print a headless ". Goal: reduce decision friction…" as the
  // brief's "Why now". The brief list drops falsy rows, so "" removes it.
  const whySignal = findPayloadAnswer(payloads, WHY_KEYS) ?? reasoning.whyBuilt;

  return {
    what:
      findPayloadAnswer(payloads, JOURNEY_OVERVIEW_KEYS) ??
      findPayloadAnswer(payloads, WHAT_KEYS) ??
      `Move ${audience} toward a trusted next step with ${offer}. Objective: ${objective}.`,
    why: whySignal ? `${sentenceFragment(whySignal)}. Goal: reduce decision friction and make the next step clear.` : "",
    timeframe:
      findPayloadAnswer(payloads, TIMEFRAME_KEYS) ??
      buildJourneyTimeframe(campaign, agentName),
    where:
      findPayloadAnswer(payloads, LOCATION_KEYS) ??
      `Client context: ${audience}.`,
    successTracking:
      findPayloadAnswer(payloads, SUCCESS_KEYS) ??
      `Track journey proof: CTA events, form/phone/photo uploads, partner handoffs, booked jobs, revenue, and attribution confidence. Current evidence: ${sources.length} source record${sources.length === 1 ? "" : "s"}, ${assets.length} deliverable${assets.length === 1 ? "" : "s"}, ${approvals.length} approval record${approvals.length === 1 ? "" : "s"}.`,
  };
}

function buildPromptInputs(assets: CampaignAssetRow[]): Array<{ label: string; value: string }> {
  const source = assets.find((asset) => Object.keys(asObject(asset.prompt_inputs)).length > 0);
  if (!source) return [];
  return promptInputEntries(source.prompt_inputs);
}

/** Pure: readable scalar prompt-input pairs from a single prompt_inputs blob. */
function promptInputEntries(value: unknown): Array<{ label: string; value: string }> {
  return Object.entries(asObject(value))
    .filter(([key, entry]) => isReadableKey(key) && entry !== null && entry !== undefined && typeof entry !== "object")
    .slice(0, 8)
    .map(([key, entry]) => ({ label: humanize(key), value: String(entry) }));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

const JOURNEY_OVERVIEW_KEYS = /^(client_journey_overview|customer_journey_overview|journey_overview|executive_overview|journey_summary)$/i;
const WHAT_KEYS = /^(what|campaign_what|campaign_summary|business_goal|goal|objective|summary)$/i;
const WHY_KEYS = /^(why|why_built|why_arc_built_it|why_arc_created_it|rationale|reason|business_reason)$/i;
const TIMEFRAME_KEYS = /^(timeframe|timeline|campaign_window|launch_window|date_range|flight_dates|schedule|start_date|end_date|launch_date|due_date)$/i;
const LOCATION_KEYS =
  /^(where|market|markets|geography|geographies|service_area|service_areas|zip_codes|zips|location|locations|city|cities|county|counties|territory)$/i;
const SUCCESS_KEYS =
  /^(success|success_metrics|success_criteria|kpis|key_metrics|measurement_plan|tracking_plan|attribution_plan|target_outcomes|conversion_goal|goal_metric)$/i;

function buildJourneyTimeframe(campaign: CampaignRow, agentName: string) {
  const objectiveWindow = extractDecisionWindow(campaign.objective ?? "");
  if (objectiveWindow) {
    return `Decision window: ${objectiveWindow}. Updated ${formatDate(campaign.updated_at)}.`;
  }

  return `Customer-journey window is not captured yet. ${agentName} should add launch dates or the client decision window before judging timing. Updated ${formatDate(campaign.updated_at)}.`;
}

function extractDecisionWindow(value: string) {
  const match = value.match(/\b(before|ahead of|during|through|by|after)\s+([^.;]+)/i);
  if (!match) return null;
  return `${match[1]} ${match[2]}`.trim();
}

function sentenceFragment(value: string) {
  return value.trim().replace(/[.!?]+$/g, "");
}

function findPayloadAnswer(payloads: JsonObject[], keyPattern: RegExp): string | null {
  for (const payload of payloads) {
    const answer = findValueByKey(payload, keyPattern);
    if (answer) return answer;
  }
  return null;
}

function findValueByKey(value: unknown, keyPattern: RegExp, depth = 0): string | null {
  if (!isObject(value) || depth > 4) return null;

  for (const [key, entry] of Object.entries(value)) {
    if (keyPattern.test(key)) {
      const formatted = formatPayloadAnswer(entry);
      if (formatted) return formatted;
    }
  }

  for (const entry of Object.values(value)) {
    if (Array.isArray(entry)) {
      for (const item of entry) {
        const nested = findValueByKey(item, keyPattern, depth + 1);
        if (nested) return nested;
      }
      continue;
    }

    const nested = findValueByKey(entry, keyPattern, depth + 1);
    if (nested) return nested;
  }

  return null;
}

function formatPayloadAnswer(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const values = value.map(formatPayloadAnswer).filter((entry): entry is string => Boolean(entry));
    return values.length > 0 ? values.join(", ") : null;
  }
  if (!isObject(value)) return null;

  const direct =
    getString(value.summary) ??
    getString(value.description) ??
    getString(value.value) ??
    getString(value.label) ??
    getString(value.name) ??
    getString(value.plan);
  if (direct) return direct;

  const start = getString(value.start_date) ?? getString(value.start) ?? getString(value.from);
  const end = getString(value.end_date) ?? getString(value.end) ?? getString(value.to);
  if (start || end) return [start ?? "Start pending", end ?? "End pending"].join(" to ");

  const placeParts = uniqueStrings([
    getString(value.city),
    getString(value.state),
    getString(value.county),
    getString(value.region),
    getString(value.market),
  ]);
  if (placeParts.length > 0) return placeParts.join(", ");

  const scalarValues = readableScalarEntries(value).slice(0, 4);
  return scalarValues.length > 0 ? scalarValues.join(" / ") : null;
}

function mapApproval(approval: ApprovalItemRow, agentName: string): CampaignWorkspaceApproval {
  const rawBody = approval.edited_output ?? approval.draft_output ?? "";
  return {
    id: approval.id,
    title: buildApprovalTitle(approval),
    type: humanize(approval.item_type),
    status: statusLabel(approval.status),
    riskLevel: humanize(approval.risk_level),
    requestedBy: approval.requested_by ?? agentName,
    submittedAt: formatDate(approval.submitted_at),
    // `/approvals` is not a route in this app — an approval item is reviewed on
    // the campaign it belongs to.
    href: approval.campaign_id ? `/campaigns/${approval.campaign_id}` : null,
    preview: buildReadablePreview(rawBody, approval.prompt_inputs, approval.reasoning_payload),
    media: collectMediaFromApproval(approval),
    promptInputs: promptInputEntries(approval.prompt_inputs),
    complianceNotes: approval.compliance_notes ?? "No approval-level compliance notes captured.",
  };
}

function mapOutput(output: AgentOutputRow): CampaignWorkspaceActivity {
  return {
    id: output.id,
    title: output.title,
    outputType: humanize(output.output_type),
    status: statusLabel(output.approval_status),
    riskLevel: humanize(output.risk_level),
    createdAt: formatDate(output.created_at),
    body: buildReadablePreview(output.edited_body ?? output.body ?? "", output.structured_payload),
  };
}

function groupAssets(assets: CampaignWorkspaceAsset[]) {
  return {
    physical: assets.filter((asset) => asset.category === "physical"),
    virtual: assets.filter((asset) => asset.category === "virtual"),
    ads: assets.filter((asset) => asset.category === "ads"),
    media: assets.filter((asset) => asset.category === "media"),
    other: assets.filter((asset) => asset.category === "other"),
  };
}

function classifyAssetCategory(asset: CampaignAssetRow): CampaignWorkspaceAssetCategory {
  return classifyAssetText(`${asset.asset_type} ${asset.channel ?? ""} ${asset.title}`);
}

function classifyAssetText(value: string): CampaignWorkspaceAssetCategory {
  const normalized = value.toLowerCase();
  if (/postcard|mailer|direct.?mail|print|flyer|leave.?behind|door.?hanger|script|call/.test(normalized)) return "physical";
  if (/ad|meta|facebook|instagram|google|paid|display|search/.test(normalized)) return "ads";
  if (/image|video|photo|creative|mockup|asset/.test(normalized)) return "media";
  if (/email|sms|text|landing|social|sequence|web|newsletter/.test(normalized)) return "virtual";
  return "other";
}

/**
 * Tables that carry `workspace_id` and must be filtered on it (BSR-711).
 *
 * Kept as a set rather than passed per call so `selectIn` is safe to hand a
 * workspace for ANY table: the org-owned ones (`companies`, `contacts`, `leads`)
 * have no such column, and filtering them on it would return nothing at all
 * rather than erroring — a silent empty result is the worst failure available
 * here.
 */
const WORKSPACE_SCOPED_TABLES = new Set([
  "campaigns",
  "campaign_assets",
  "campaign_events",
  "campaign_dispatches",
  "campaign_results",
  "approval_items",
  "approval_decisions",
  "approval_recommendations",
  "agent_outputs",
  "agent_tasks",
  // Has had workspace_id NOT NULL since BSR-653; it was simply never added
  // here, so passing a workspace id for this table did nothing at all.
  "guardrail_findings",
]);

/**
 * Narrow a query to a workspace, but only for a table that has the column. Same
 * generic shape as `applyOrgScope` — a `typeof query` self-reference here makes
 * the Supabase builder's types recurse infinitely.
 */
function applyWorkspaceScope<Query>(query: Query, table: string, workspaceId?: string | null): Query {
  if (!workspaceId || !WORKSPACE_SCOPED_TABLES.has(table)) return query;
  return (query as { eq(column: string, value: string): Query }).eq("workspace_id", workspaceId);
}

export async function selectIn<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
  column: string,
  values: string[],
  orderBy?: string,
  orgId?: string,
  workspaceId?: string | null,
): Promise<T[]> {
  const uniqueValues = [...new Set(values.filter(Boolean))];
  if (uniqueValues.length === 0) return [];

  let query = applyWorkspaceScope(
    applyOrgScope(client.from(table).select(columns).in(column, uniqueValues), orgId),
    table,
    workspaceId,
  );
  if (orderBy) {
    query = query.order(orderBy, { ascending: false });
  }

  const { data, error } = await query;
  assertSupabaseResult(table, error);
  return (data ?? []) as T[];
}

type MediaAssetIdRow = { id: string; storage_path: string | null };
type MediaApprovalRow = {
  media_asset_id: string | null;
  status: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  decision_notes: string | null;
  created_at: string | null;
};

/** Key a media asset for review lookup. The id is exact; the storage path is
 *  the fallback that works on entries written before the id was threaded
 *  through — which today is all of them in prod. */
function mediaReviewKey(media: Pick<CampaignMediaAsset, "libraryAssetId" | "storagePath">): string | null {
  if (media.libraryAssetId) return `id:${media.libraryAssetId}`;
  if (media.storagePath) return `path:${media.storagePath}`;
  return null;
}

/**
 * Resolve each asset's own review decision from `approval_items`.
 *
 * Campaign media is a JSON blob, not a row, so it has no database identity of
 * its own — the link runs entry → `media_assets` (by id when recorded, else by
 * storage path) → `approval_items.media_asset_id`. An asset we cannot join, or
 * one with no approval row, stays `unreviewed`: this function never invents a
 * decision, and a failed lookup must not read as a clean review.
 */
async function resolveMediaReviews(
  client: SupabaseClient,
  media: CampaignMediaAsset[],
  orgId?: string,
): Promise<Map<string, CampaignMediaReview>> {
  const reviews = new Map<string, CampaignMediaReview>();
  const ids = media.map((m) => m.libraryAssetId).filter((v): v is string => Boolean(v));
  const paths = media.map((m) => (m.libraryAssetId ? null : m.storagePath)).filter((v): v is string => Boolean(v));
  if (ids.length === 0 && paths.length === 0) return reviews;

  const [byId, byPath] = await Promise.all([
    selectIn<MediaAssetIdRow>(client, "media_assets", "id,storage_path", "id", ids, undefined, orgId).catch(() => []),
    selectIn<MediaAssetIdRow>(client, "media_assets", "id,storage_path", "storage_path", paths, undefined, orgId).catch(() => []),
  ]);

  // asset id -> the media keys that resolve to it (a path and an id can both
  // point at the same row).
  const keysByAssetId = new Map<string, string[]>();
  const remember = (assetId: string, key: string) => {
    const existing = keysByAssetId.get(assetId);
    if (existing) existing.push(key);
    else keysByAssetId.set(assetId, [key]);
  };
  for (const row of byId) remember(row.id, `id:${row.id}`);
  for (const row of byPath) if (row.storage_path) remember(row.id, `path:${row.storage_path}`);
  if (keysByAssetId.size === 0) return reviews;

  const approvals = await selectIn<MediaApprovalRow>(
    client,
    "approval_items",
    "media_asset_id,status,reviewed_by,reviewed_at,decision_notes,created_at",
    "media_asset_id",
    [...keysByAssetId.keys()],
    "created_at",
    orgId,
  ).catch(() => []);

  // Ordered newest-first by selectIn, so the first row per asset is current.
  for (const row of approvals) {
    if (!row.media_asset_id) continue;
    const keys = keysByAssetId.get(row.media_asset_id);
    if (!keys || reviews.has(keys[0])) continue;
    const review: CampaignMediaReview = {
      state: mediaReviewStateFromStatus(row.status),
      reviewer: getString(row.reviewed_by),
      reviewedAt: getString(row.reviewed_at),
      notes: getString(row.decision_notes),
    };
    for (const key of keys) reviews.set(key, review);
  }

  return reviews;
}

function withMediaReview(media: CampaignMediaAsset, reviews: Map<string, CampaignMediaReview>): CampaignMediaAsset {
  const key = mediaReviewKey(media);
  const review = key ? reviews.get(key) : undefined;
  return review ? { ...media, review } : media;
}

function applyOrgScope<Query>(query: Query, orgId?: string): Query {
  if (!orgId) return query;
  return (query as { eq(column: string, value: string): Query }).eq("org_id", orgId);
}

/**
 * Scope a query on `campaigns` itself. Campaigns are workspace-owned (BSR-637)
 * and `workspace_id` is NOT NULL as of BSR-639, so a campaign belongs to exactly
 * one workspace and must not be listed in its siblings.
 *
 * `applyOrgScope` above still serves the campaign-*adjacent* tables — assets,
 * approvals, events, outputs — which have no workspace column yet and gain one
 * in a later slice of the boundary migration.
 *
 * A missing `workspaceId` degrades to org-only scoping rather than returning
 * nothing, matching `applyOrgScope`. That path is real: the offline demo, open /
 * operator auth mode, and service-role callers whose bearer token predates
 * workspace scoping all legitimately arrive without one.
 */
function applyCampaignScope<Query>(query: Query, orgId?: string, workspaceId?: string | null): Query {
  const scoped = applyOrgScope(query, orgId);
  if (!workspaceId) return scoped;
  return (scoped as { eq(column: string, value: string): Query }).eq("workspace_id", workspaceId);
}

function collectRelatedIds(campaign: CampaignRow, approvals: ApprovalItemRow[]) {
  return {
    companyIds: uniqueStrings([campaign.company_id, ...approvals.map((approval) => approval.company_id)]),
    contactIds: uniqueStrings([campaign.contact_id, ...approvals.map((approval) => approval.contact_id)]),
    leadIds: uniqueStrings([campaign.lead_id, ...approvals.map((approval) => approval.lead_id)]),
  };
}

export function buildSources(input: {
  campaign: CampaignRow;
  assets: CampaignAssetRow[];
  approvals: ApprovalItemRow[];
  companies: CompanyRow[];
  contacts: ContactRow[];
  leads: LeadRow[];
  outputs: AgentOutputRow[];
}, agentName = "Arc"): CampaignWorkspaceSource[] {
  const sources: CampaignWorkspaceSource[] = [];

  for (const company of input.companies) {
    sources.push({
      id: `company-${company.id}`,
      label: company.name,
      detail: [company.partner_tier ? humanize(company.partner_tier) : null, company.phone, company.email].filter(Boolean).join(" / ") || "Linked company",
      url: company.website_url,
      recordHref: `/crm/companies/${company.id}`,
      kind: "company",
    });
  }

  for (const contact of input.contacts) {
    sources.push({
      id: `contact-${contact.id}`,
      label: contact.full_name ?? "Linked contact",
      detail: [contact.title, contact.email, contact.phone].filter(Boolean).join(" / ") || "Linked contact",
      url: null,
      recordHref: `/crm/contacts/${contact.id}`,
      kind: "contact",
    });
  }

  for (const lead of input.leads) {
    sources.push({
      id: `lead-${lead.id}`,
      label: `Lead from ${lead.source}`,
      detail: `${statusLabel(lead.status)} / ${lead.lead_score} score${lead.loss_summary ? ` / ${lead.loss_summary}` : ""}`,
      url: null,
      recordHref: `/crm/leads/${lead.id}`,
      kind: "lead",
    });
  }

  const evidenceObjects = [
    asObject(input.campaign.source_signal),
    asObject(input.campaign.reasoning_payload),
    asObject(input.campaign.audit_payload),
    ...input.assets.flatMap((asset) => [asObject(asset.prompt_inputs), asObject(asset.reasoning_payload), asObject(asset.audit_payload)]),
    ...input.approvals.flatMap((approval) => [asObject(approval.prompt_inputs), asObject(approval.reasoning_payload), asObject(approval.audit_payload)]),
    ...input.outputs.map((output) => asObject(output.structured_payload)),
    ...input.leads.map((lead) => asObject(lead.metadata)),
  ];

  // The campaign's own creative/media (e.g. an ad's image in our storage bucket) is
  // NOT an external evidence source — exclude those URLs so they don't show up as
  // "Evidence Links" (which surfaced the raw storage host).
  const mediaUrls = new Set(
    [
      ...collectMediaFromCampaign(input.campaign),
      ...input.assets.flatMap(collectMediaFromAsset),
      ...input.approvals.flatMap(collectMediaFromApproval),
      ...input.outputs.flatMap((output) => collectMediaFromOutput(output, agentName)),
    ].map((media) => media.url),
  );

  for (const url of uniqueStrings(evidenceObjects.flatMap(extractUrlsFromObject))) {
    if (mediaUrls.has(url)) continue;
    sources.push({
      id: `url-${stableId(url)}`,
      label: getHostLabel(url),
      detail: `Evidence or source URL captured by ${agentName}.`,
      url,
      recordHref: null,
      kind: "web",
    });
  }

  return uniqueById(sources);
}

function buildMediaByCampaign(campaigns: CampaignRow[], assets: CampaignAssetRow[], approvals: ApprovalItemRow[], outputs: AgentOutputRow[], agentName = "Arc") {
  const mediaByCampaign = new Map<string, CampaignMediaAsset[]>();

  for (const campaign of campaigns) {
    const campaignAssets = assets.filter((asset) => asset.campaign_id === campaign.id);
    const assetIds = new Set(campaignAssets.map((asset) => asset.id));
    const campaignApprovals = approvals.filter((approval) => approval.campaign_id === campaign.id || (approval.campaign_asset_id ? assetIds.has(approval.campaign_asset_id) : false));
    const approvalIds = new Set(campaignApprovals.map((approval) => approval.id));
    const campaignOutputs = outputs.filter((output) => {
      return (output.campaign_asset_id ? assetIds.has(output.campaign_asset_id) : false) || (output.approval_item_id ? approvalIds.has(output.approval_item_id) : false);
    });
    mediaByCampaign.set(
      campaign.id,
      renderableMedia(
        uniqueMedia([
          ...collectMediaFromCampaign(campaign),
          ...campaignAssets.flatMap(collectMediaFromAsset),
          ...campaignApprovals.flatMap(collectMediaFromApproval),
          ...campaignOutputs.flatMap((output) => collectMediaFromOutput(output, agentName)),
        ]),
      ),
    );
  }

  return mediaByCampaign;
}

function buildSourceCountByCampaign(campaigns: CampaignRow[], approvals: ApprovalItemRow[], outputs: AgentOutputRow[]) {
  const sourceCountByCampaign = new Map<string, number>();

  for (const campaign of campaigns) {
    const campaignApprovals = approvals.filter((approval) => approval.campaign_id === campaign.id);
    const campaignApprovalIds = new Set(campaignApprovals.map((approval) => approval.id));
    const values = [
      ...extractUrlsFromObject(asObject(campaign.source_signal)),
      ...extractUrlsFromObject(asObject(campaign.reasoning_payload)),
      ...extractUrlsFromObject(asObject(campaign.audit_payload)),
      ...campaignApprovals.flatMap((approval) => extractUrlsFromObject(asObject(approval.prompt_inputs))),
      ...outputs
        .filter((output) => output.approval_item_id && campaignApprovalIds.has(output.approval_item_id))
        .flatMap((output) => extractUrlsFromObject(asObject(output.structured_payload))),
    ];
    sourceCountByCampaign.set(campaign.id, uniqueStrings(values).length);
  }

  return sourceCountByCampaign;
}

export function collectMediaFromCampaign(campaign: CampaignRow) {
  return buildMediaAssets([
    ["Campaign source", asObject(campaign.source_signal)],
    ["Campaign reasoning", asObject(campaign.reasoning_payload)],
    ["Campaign audit", asObject(campaign.audit_payload)],
  ]);
}

export function collectMediaFromAsset(asset: CampaignAssetRow) {
  return buildMediaAssets([
    ["Asset prompt", asObject(asset.prompt_inputs)],
    ["Asset reasoning", asObject(asset.reasoning_payload)],
    ["Asset audit", asObject(asset.audit_payload)],
    ["Asset body", asset.approved_body ?? asset.edited_body ?? asset.draft_body ?? ""],
  ]);
}

function collectMediaFromApproval(approval: ApprovalItemRow) {
  return buildMediaAssets([
    ["Approval prompt", asObject(approval.prompt_inputs)],
    ["Approval reasoning", asObject(approval.reasoning_payload)],
    ["Approval audit", asObject(approval.audit_payload)],
    ["Approval draft", approval.edited_output ?? approval.draft_output ?? ""],
  ]);
}

function collectMediaFromOutput(output: AgentOutputRow, agentName = "Arc") {
  return buildMediaAssets([
    [`${agentName} output`, asObject(output.structured_payload)],
    [`${agentName} body`, output.edited_body ?? output.body ?? ""],
  ]);
}

function buildMediaAssets(inputs: Array<[string, JsonObject | string]>): CampaignMediaAsset[] {
  const assets: CampaignMediaAsset[] = [];

  for (const [source, value] of inputs) {
    if (typeof value === "string") {
      // URLs found in free-text prose (draft bodies, reasoning) are only
      // *referenced* — never trusted as renderable creative.
      for (const url of extractUrls(value)) {
        if (isMediaLikeUrl(url)) assets.push(createMediaAsset({ url, source, origin: "referenced" }));
      }
      continue;
    }
    collectMediaAssetsFromObject(value, assets, source);
  }

  return uniqueMedia(assets);
}

function collectMediaAssetsFromObject(object: JsonObject, assets: CampaignMediaAsset[], source: string) {
  for (const [key, value] of Object.entries(object)) {
    if (Array.isArray(value) && isCreativeCollectionKey(key)) {
      const collectionOrigin: CampaignMediaOrigin = /generated/i.test(key) ? "generated" : "attached";
      for (const item of value) {
        const asset = mapMediaAsset(item, source, collectionOrigin);
        if (asset) assets.push(asset);
      }
      continue;
    }

    if (isObject(value)) {
      const asset = isCreativeObjectKey(key) ? mapMediaAsset(value, source, "attached") : null;
      if (asset) assets.push(asset);
      collectMediaAssetsFromObject(value, assets, source);
      continue;
    }

    if (typeof value === "string" && isCreativeUrlKey(key) && isUrl(value)) {
      assets.push(createMediaAsset({ url: value, source, title: humanize(key), origin: "attached" }));
    }
  }
}

function mapMediaAsset(value: unknown, source: string, origin: CampaignMediaOrigin): CampaignMediaAsset | null {
  if (typeof value === "string" && isUrl(value)) {
    return createMediaAsset({ url: value, source, origin });
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

  if (!url || !isUrl(url)) return null;

  // An attached asset that carries generation provenance is AI-generated.
  const hasProvenance = Boolean(
    value.job_id ?? value.generation_id ?? value.model ?? value.prompt ?? value.generated_by,
  );
  const resolvedOrigin: CampaignMediaOrigin = origin === "attached" && hasProvenance ? "generated" : origin;

  const virality = isObject(value.virality) ? (value.virality as unknown as ViralityScore) : null;

  // Carry the generation lineage, not just the "generated" badge it implies —
  // the reviewer approving this media should see tool/model/job/prompt. Entry
  // keys arrive snake_cased from audit payloads and camelCased from newer
  // ingest provenance; accept both.
  const external = describeExternalMediaProvenance({
    tool: value.tool,
    model: value.model,
    prompt: value.prompt,
    jobId: value.job_id ?? value.jobId ?? value.generation_id,
    sourceUrl: value.source_url ?? value.sourceUrl,
  });

  return createMediaAsset({
    url,
    source,
    origin: resolvedOrigin,
    title: getString(value.title) ?? getString(value.name) ?? getString(value.label) ?? undefined,
    description: getString(value.description) ?? getString(value.notes) ?? getString(value.caption),
    thumbnailUrl: getString(value.thumbnail_url) ?? getString(value.thumbnailUrl) ?? getString(value.poster_url) ?? null,
    mimeType: getString(value.mime_type) ?? getString(value.mimeType) ?? null,
    hintedType: getString(value.type) ?? getString(value.asset_type) ?? getString(value.media_type) ?? undefined,
    virality,
    lineage: external.rows,
    prompt: external.prompt,
    format: normalizeAspectRatio(getString(value.format) ?? getString(value.aspect_ratio) ?? getString(value.aspectRatio)),
    riskFlags: asStringArray(value.risk_flags ?? value.riskFlags),
    libraryAssetId: getString(value.library_asset_id) ?? getString(value.libraryAssetId),
    storagePath: getString(value.path) ?? getString(value.storage_path) ?? getString(value.storagePath),
  });
}

/**
 * Accept a declared aspect ratio only in the `w:h` shape the producers actually
 * write ("4:3", "9:16"), with both sides positive and sane. Everything here
 * arrives from a tool payload, and this string ends up in a CSS `aspect-ratio`
 * — an unvalidated value would be free rein over the tile's geometry.
 */
function normalizeAspectRatio(value: string | null): string | null {
  if (!value) return null;
  const match = /^\s*(\d{1,4})\s*[:x/]\s*(\d{1,4})\s*$/i.exec(value);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return null;
  // A ratio beyond 10:1 either way is a bad payload, not a real creative.
  if (width / height > 10 || height / width > 10) return null;
  return `${width}:${height}`;
}

/** Test-only alias so unit tests can reach the otherwise module-private mapper. */
export const mapMediaAssetForTest = mapMediaAsset;

/** Test-only alias. The full detail read cannot exercise this deterministically
 *  — the query mock hands responses out per table in call order, and
 *  `approval_items` is read several times before the media lookup. */
export const resolveMediaReviewsForTest = resolveMediaReviews;

function createMediaAsset(input: {
  url: string;
  source: string;
  origin: CampaignMediaOrigin;
  title?: string;
  description?: string | null;
  thumbnailUrl?: string | null;
  mimeType?: string | null;
  hintedType?: string;
  virality?: ViralityScore | null;
  lineage?: Array<[string, string]>;
  prompt?: string | null;
  format?: string | null;
  riskFlags?: string[];
  libraryAssetId?: string | null;
  storagePath?: string | null;
}): CampaignMediaAsset {
  const type = classifyMediaAsset(input.url, input.mimeType, input.hintedType);
  return {
    id: `media-${stableId(input.url)}`,
    type,
    origin: input.origin,
    title: input.title ?? defaultMediaTitle(type),
    url: input.url,
    thumbnailUrl: input.thumbnailUrl ?? null,
    mimeType: input.mimeType ?? null,
    description: input.description ?? null,
    source: input.source,
    virality: input.virality ?? null,
    lineage: input.lineage ?? [],
    prompt: input.prompt ?? null,
    format: input.format ?? null,
    riskFlags: input.riskFlags ?? [],
    libraryAssetId: input.libraryAssetId ?? null,
    storagePath: input.storagePath ?? null,
    // Filled in by resolveMediaReviews when a review exists. Everything starts
    // unreviewed because that is what an absent approval row means.
    review: UNREVIEWED,
  };
}

export function classifyMediaAsset(url: string, mimeType?: string | null, hintedType?: string): CampaignMediaAsset["type"] {
  const hint = `${mimeType ?? ""} ${hintedType ?? ""}`.toLowerCase();
  const lowerUrl = url.toLowerCase();
  // ad / postcard / photo creative are visual; render them as images even
  // when the URL carries no file extension (e.g. dynamic image endpoints).
  if (/image|photo|postcard|\bad\b|mockup/.test(hint) || /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/.test(lowerUrl)) return "image";
  if (/youtube\.com|youtu\.be|vimeo\.com/.test(lowerUrl)) return "embed";
  if (hint.includes("video") || /\.(mp4|webm|mov|m4v)(\?|#|$)/.test(lowerUrl)) return "video";
  if (/\.(pdf|docx?|pptx?)(\?|#|$)/.test(lowerUrl)) return "file";
  return "link";
}

function buildReadablePreview(...values: unknown[]) {
  for (const value of values) {
    const preview = previewValue(value);
    if (preview) return preview;
  }
  return EMPTY_READABLE_PREVIEW;
}

function previewValue(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = parseDraftJson(trimmed);
    if (parsed) return previewValue(parsed);
    return trimmed;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => (isObject(entry) ? previewRecord(entry) : previewValue(entry))).filter(Boolean).slice(0, 6).join("\n\n");
  }
  if (!isObject(value)) {
    return String(value);
  }

  const direct =
    getString(value.summary) ??
    getString(value.headline) ??
    getString(value.title) ??
    getString(value.message) ??
    getString(value.body) ??
    getString(value.copy) ??
    getString(value.recommended_action) ??
    getString(value.suggested_owner_action);
  if (direct) return direct;

  const collection = Object.entries(value).find(([key, entry]) => isReadableCollectionKey(key) && Array.isArray(entry) && entry.length > 0);
  if (collection) {
    const [collectionKey, rawCollectionValue] = collection;
    const collectionValue = Array.isArray(rawCollectionValue) ? rawCollectionValue : [];
    const scalarIntro = readableScalarEntries(value)
      .filter((entry) => !entry.startsWith(`${humanize(collectionKey)}:`))
      .slice(0, 4);
    const rows = collectionValue
      .map((entry) => (isObject(entry) ? previewRecord(entry) : previewValue(entry)))
      .filter(Boolean)
      .slice(0, 8);

    return [...scalarIntro, `${humanize(collectionKey)}:\n${rows.join("\n\n")}`].filter(Boolean).join("\n");
  }

  const entries = readableScalarEntries(value);

  return entries.length > 0 ? entries.join("\n") : null;
}

function readableScalarEntries(value: JsonObject) {
  return Object.entries(value)
    .filter(([key, entry]) => isReadableKey(key) && entry !== null && entry !== undefined && typeof entry !== "object")
    .slice(0, 6)
    .map(([key, entry]) => `${humanize(key)}: ${String(entry)}`);
}

function previewRecord(value: JsonObject) {
  const title =
    getString(value.name) ??
    getString(value.company_name) ??
    getString(value.business_name) ??
    getString(value.title) ??
    getString(value.subject) ??
    getString(value.headline) ??
    "Record";

  const fields: string[] = [];
  for (const key of [
    "score",
    "partner_score",
    "lead_score",
    "channel",
    "website",
    "website_url",
    "phone",
    "email",
    "confidence",
    "status",
    "recommended_action",
    "notes",
    "reason",
    "fit",
  ]) {
    const valueForKey = value[key];
    if (valueForKey !== null && valueForKey !== undefined && typeof valueForKey !== "object") {
      fields.push(`${humanize(key)}: ${String(valueForKey)}`);
    }
  }

  const urls = uniqueStrings(extractUrlsFromObject(value)).slice(0, 3);
  if (urls.length > 0) fields.push(`Sources: ${urls.join(", ")}`);

  return [title, ...fields].filter(Boolean).join("\n");
}

function parseDraftJson(value: string) {
  const firstBrace = value.indexOf("{");
  const lastBrace = value.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;

  try {
    return JSON.parse(value.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function buildApprovalTitle(approval: ApprovalItemRow) {
  const prompt = asObject(approval.prompt_inputs);
  return (
    getString(prompt.title) ??
    getString(prompt.campaign_name) ??
    getString(prompt.subject) ??
    `${humanize(approval.item_type)} review`
  );
}

function extractUrlsFromObject(object: JsonObject): string[] {
  const urls: string[] = [];
  for (const value of Object.values(object)) {
    if (typeof value === "string") {
      urls.push(...extractUrls(value).filter(isUrl));
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") urls.push(...extractUrls(item).filter(isUrl));
        if (isObject(item)) urls.push(...extractUrlsFromObject(item));
      }
    } else if (isObject(value)) {
      urls.push(...extractUrlsFromObject(value));
    }
  }
  return urls;
}

function extractUrls(value: string) {
  return value.match(/https?:\/\/[^\s"'<>),\]]+/g) ?? [];
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const byId = new Map<string, T>();
  for (const item of items) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

export function uniqueMedia(items: CampaignMediaAsset[]) {
  const byUrl = new Map<string, CampaignMediaAsset>();
  for (const item of items) {
    if (!byUrl.has(item.url)) byUrl.set(item.url, item);
  }
  return [...byUrl.values()];
}

// Map an asset_type / channel enum value to the marketing-channel label the
// Campaigns table shows (matches the mockup: Email · SMS · Paid · Landing · One-pager).
// Creative-prompt asset types (image/video) collapse to their delivery channel (Paid).
/** Channel/asset-type casing, e.g. `sms` → "SMS". Exported so the board's
 *  deliverable labels use the same map as its Channels column — otherwise a
 *  generic title-caser renders "Sms". */
export function humanizeChannel(raw: string): string {
  const map: Record<string, string> = {
    email: "Email",
    sms: "SMS",
    landing_page: "Landing",
    web: "Landing",
    one_pager: "One-pager",
    doc: "One-pager",
    search_ad: "Paid",
    google_ads: "Paid",
    social_ad: "Paid",
    meta_ad: "Paid",
    image_prompt: "Paid",
    video_prompt: "Paid",
    media: "Paid",
  };
  return map[raw] ?? raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Stable channel order for the table subline.
const CHANNEL_ORDER = ["Email", "SMS", "Paid", "Landing", "One-pager"];
function orderedChannels(values: string[]): string[] {
  return [...new Set(values)]
    .sort((a, b) => {
      const ia = CHANNEL_ORDER.indexOf(a);
      const ib = CHANNEL_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .slice(0, 3);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function asObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function isReadableKey(key: string) {
  const normalized = key.toLowerCase();
  return !normalized.endsWith("_id") && !normalized.endsWith("_ids") && normalized !== "id" && !/payload|metadata|audit/.test(normalized);
}

function isReadableCollectionKey(key: string) {
  return /candidate|lead|company|contact|asset|creative|deliverable|source|evidence|campaign|ad|email|sms|post|item/i.test(key);
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
  return classifyMediaAsset(url) !== "link";
}

function isUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function pickWorkspacePreview(assets: CampaignWorkspaceAsset[]): { text: string; label: string } | null {
  for (const asset of assets) {
    const text = asset.preview && asset.preview !== EMPTY_READABLE_PREVIEW ? asset.preview : asset.body;
    if (text && text !== EMPTY_READABLE_PREVIEW) {
      return { text: text.slice(0, 360), label: asset.channel || asset.assetType };
    }
  }
  return null;
}

function channelLabelFromType(type: string) {
  if (/email/i.test(type)) return "Email";
  if (/sms|text/i.test(type)) return "SMS";
  if (/ad|meta|google|search|display/i.test(type)) return "Ads";
  if (/video/i.test(type)) return "Video";
  if (/image|creative|media/i.test(type)) return "Media";
  if (/lead|candidate|partner/i.test(type)) return "Lead list";
  if (/landing|web/i.test(type)) return "Landing page";
  return humanize(type);
}

/** Pick a representative thumbnail for a campaign card: first image, else a
 *  video/embed poster if present. Returns null when there's no visual media. */
function pickThumbnail(media: CampaignMediaAsset[]): string | null {
  const image = media.find((asset) => asset.type === "image");
  if (image) return image.thumbnailUrl ?? image.url;

  const posterized = media.find((asset) => (asset.type === "video" || asset.type === "embed") && asset.thumbnailUrl);
  return posterized?.thumbnailUrl ?? null;
}

function defaultMediaTitle(type: CampaignMediaAsset["type"]) {
  if (type === "image") return "Image preview";
  if (type === "video" || type === "embed") return "Video preview";
  if (type === "file") return "Attached file";
  return "Creative link";
}

function getHostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Source link";
  }
}

function stableId(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

/**
 * The stored status, in the product's one vocabulary (BSR-656).
 *
 * This used to spell its own labels — "Pending approval", "Pending owner
 * approval", "Revision requested" — which is how the campaign screen ended up
 * showing four names for one state: this function fed the header while the
 * asset cards went through `WORK_STATE_LABEL`. Both halves now come from the
 * same place. `pending_approval` and `pending_owner_approval` collapse to one
 * label on purpose: to the person looking at it, both mean it is on their desk.
 */
function statusLabel(status: string) {
  // A compliance block is NOT a routine "needs you" — it is stopped by a rule
  // rather than waiting on a decision, and the campaign view already words it
  // this way. Kept distinct, and worded the same as there.
  if (status === "needs_compliance") return "Blocked by a rule";
  return WORK_STATE_LABEL[toWorkState(status)];
}

export function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Strip machine-generated run-id / date suffixes Arc appends to campaign
 *  names (e.g. " 20260529203258", " - 2026-06-01") for cleaner display. */
function cleanCampaignName(name: string) {
  return name
    .replace(/\s*(?:-|\u2013)\s*\d{4}-\d{2}-\d{2}\s*$/, "")
    .replace(/\s+\d{12,}\s*$/, "")
    .trim() || name;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function assertSupabaseResult(label: string, error: { message: string } | null) {
  if (error) {
    throw new Error(`${label} lookup failed: ${error.message}`);
  }
}
