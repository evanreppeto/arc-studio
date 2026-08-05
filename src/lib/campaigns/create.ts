import { type SupabaseClient } from "@supabase/supabase-js";

import { type ParsedCampaignDraft, type ViralityScore, channelForAssetType, deriveCampaignTheme, normalizeCampaignAssetType, normalizeHandoffNote, normalizeRestorationFocus, parseConsideredAudiences, resolveCampaignCta } from "@/domain";

import { getSupabaseAdminClient, type TypedSupabaseClient } from "../supabase/server";
import { type AgentTaskTenantFields } from "../agent-tasks/scope";
import { syncCampaignRecordToBrain } from "../brain-ingestion/sync";
import { deferAfterResponse } from "../defer";
import { checkArcGeneratedCopy } from "../arc/guardrails";
import { getBusinessProfile } from "../brand-kit/persistence";
import { workspaceScopeFields } from "@/lib/tenancy/write-scope";

/** Mirror a freshly created/updated campaign into the Brain. Best-effort and
 *  awaited (serverless can kill post-response work) — a sync hiccup must never
 *  fail campaign creation. */
async function mirrorCampaignToBrain(
  client: SupabaseClient,
  campaignId: string,
  tenant?: AgentTaskTenantFields,
): Promise<void> {
  await syncCampaignRecordToBrain(campaignId, {
    client: client as unknown as TypedSupabaseClient,
    orgId: tenant?.org_id,
  }).catch(() => undefined);
}

const SOURCE_SYSTEM = "operator";
const CAMPAIGN_MEDIA_BUCKET = "campaign-media";

export type CampaignPhoto = { filename: string; contentType: string; bytes: Uint8Array };

// Injectable so persistence is unit-testable without real Supabase Storage.
export type ImageUploader = (path: string, bytes: Uint8Array, contentType: string) => Promise<string>;

export function defaultUploader(client: SupabaseClient): ImageUploader {
  return async (path, bytes, contentType) => {
    const { error } = await client.storage.from(CAMPAIGN_MEDIA_BUCKET).upload(path, bytes, { contentType, upsert: true });
    if (error) throw new Error(`image upload failed: ${error.message}`);
    return client.storage.from(CAMPAIGN_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  };
}

export type PhotoAssetInput = {
  client: SupabaseClient;
  campaignId: string;
  operator: string;
  photo: CampaignPhoto;
  index: number;
  channel: string;
  uploader: ImageUploader;
  now: string;
  tenant?: AgentTaskTenantFields;
};

/** Upload one photo and insert its approved asset + approval + decision. Returns the asset id. */
export async function insertPhotoAsset({ client, campaignId, operator, photo, index, channel, uploader, now, tenant }: PhotoAssetInput): Promise<string> {
  // Caller is responsible for sanitizing photo.filename — it is interpolated into the path.
  const path = `operator-campaigns/${campaignId}/${index}-${photo.filename}`;
  const url = await uploader(path, photo.bytes, photo.contentType);

  const assetId = await insertOne(client, "campaign_assets", {
    ...workspaceScopeFields(tenant),
    campaign_id: campaignId,
    asset_type: "social_ad",
    channel,
    title: `Campaign photo ${index + 1}`,
    status: "approved",
    source_system: SOURCE_SYSTEM,
    approved_by: operator,
    approved_at: now,
    dispatch_locked: true,
    audit_payload: { media_assets: [{ url, path }], outbound_locked: true, authored_by: "operator" },
  });

  const approvalItemId = await insertOne(client, "approval_items", {
    ...workspaceScopeFields(tenant),
    campaign_id: campaignId,
    campaign_asset_id: assetId,
    item_type: "campaign_asset",
    status: "approved",
    approval_required: true,
    locked_until_approved: true,
    risk_level: "low",
    requested_by: operator,
    reviewed_by: operator,
    reviewed_at: now,
  });

  await insertNoReturn(client, "approval_decisions", {
    ...workspaceScopeFields(tenant),
    approval_item_id: approvalItemId,
    decision: "approved",
    decided_by: operator,
    previous_status: "pending_approval",
    next_status: "approved",
    metadata: { source: "operator_create" },
  });

  return assetId;
}

export type CreateOperatorCampaignInput = {
  draft: ParsedCampaignDraft;
  operator: string;
  photos: CampaignPhoto[];
  client?: SupabaseClient;
  uploader?: ImageUploader;
  tenant?: AgentTaskTenantFields;
};

export type CreateOperatorCampaignResult = { campaignId: string; assetIds: string[] };

/**
 * Persist an operator-authored campaign + its photo assets.
 *
 * Non-transactional: this is a sequence of independent inserts (Supabase JS has no
 * multi-table transaction surface). If an insert fails after the campaign row is
 * written, a partial campaign may remain. Acceptable for this iteration — operator
 * creates are low-frequency; a cleanup/retry path can be added if it becomes a problem.
 */
export async function createOperatorCampaign({
  draft,
  operator,
  photos,
  client = getSupabaseAdminClient(),
  uploader,
  tenant,
}: CreateOperatorCampaignInput): Promise<CreateOperatorCampaignResult> {
  const upload = uploader ?? defaultUploader(client);
  const now = new Date().toISOString();

  const campaignId = await insertOne(client, "campaigns", {
    ...workspaceScopeFields(tenant),
    name: draft.name,
    persona: draft.persona,
    campaign_theme: draft.campaignTheme,
    restoration_focus: draft.restorationFocus || null,
    status: "draft",
    source_system: SOURCE_SYSTEM,
    launch_locked: true,
    owner: operator,
    objective: draft.objective ?? null,
    audience_summary: draft.audienceSummary ?? null,
    offer_summary: draft.offerSummary ?? null,
    company_id: draft.companyId ?? null,
    lead_id: draft.leadId ?? null,
    source_signal: { authored_by: "operator" },
  });

  const assetIds: string[] = [];
  for (const [index, photo] of photos.entries()) {
    assetIds.push(
      await insertPhotoAsset({ client, campaignId, operator, photo, index, channel: draft.channel ?? "social", uploader: upload, now, tenant }),
    );
  }

  await insertNoReturn(client, "campaign_events", {
    ...workspaceScopeFields(tenant),
    campaign_id: campaignId,
    event_type: "created",
    actor: operator,
    detail: `Campaign authored by ${operator} with ${photos.length} photo${photos.length === 1 ? "" : "s"}.`,
    payload: { source: "operator_create", photo_count: photos.length },
  });

  await mirrorCampaignToBrain(client, campaignId, tenant);
  return { campaignId, assetIds };
}

export async function insertOne(client: SupabaseClient, table: string, values: Record<string, unknown>): Promise<string> {
  const { data, error } = await client.from(table).insert(values).select("id").single<{ id: string }>();
  if (error) throw new Error(`${table} insert failed: ${error.message}`);
  if (!data?.id) throw new Error(`${table} insert did not return an id.`);
  return data.id;
}

export async function insertNoReturn(client: SupabaseClient, table: string, values: Record<string, unknown>): Promise<void> {
  const { error } = await client.from(table).insert(values);
  if (error) throw new Error(`${table} insert failed: ${error.message}`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// CRM subject types that map to a typed FK column on `campaigns`. External
// signals (weather/competitor) and demo ids have no CRM record, so we only set
// the FK when the subject is a real CRM record with a UUID id — a non-UUID
// (e.g. a demo/external subject id) would be rejected by the uuid column.
const CAMPAIGN_SUBJECT_FK: Record<string, string> = {
  lead: "lead_id",
  company: "company_id",
  contact: "contact_id",
  property: "property_id",
};

function campaignSubjectFk(subjectType: string, subjectId: string): Record<string, string> {
  const column = CAMPAIGN_SUBJECT_FK[subjectType];
  if (!column || !UUID_RE.test((subjectId ?? "").trim())) return {};
  return { [column]: subjectId.trim() };
}

export type OpportunityDraftContext = {
  id: string;
  subjectType: string;
  subjectId: string;
  confidence: number;
  urgency: string;
  recommendedAction: string;
  recommendedCampaignType?: string | null;
  evidence?: Record<string, unknown> | null;
};

export type CreateCampaignFromOpportunityInput = {
  operator: string;
  name: string;
  /** Validated official persona mapping (the DB enum rejects anything else). */
  persona: string;
  /** Industry-neutral theme for new callers. */
  campaignTheme?: string;
  /** Legacy restoration enum retained for older callers during migration. */
  restorationFocus?: string;
  /** Message angle — carried onto the campaign's `objective`. */
  objective: string;
  audienceSummary?: string | null;
  /** The source opportunity, tagged into `source_signal` as Arc provenance. */
  opportunity: OpportunityDraftContext;
  /** Configured agent display name, threaded from the caller for the audit-log detail. */
  agentName?: string;
  client?: SupabaseClient;
  tenant?: AgentTaskTenantFields;
};

/**
 * Persist a draft campaign seeded from a surfaced opportunity. Mirrors
 * createCampaignShell (draft, launch-locked, approval-gated) but carries the
 * opportunity's persona/evidence/recommended action and a provenance stamp so
 * the campaign clearly reads as Arc-drafted from that opportunity. The subject
 * CRM record is linked when it's a real UUID record.
 *
 * Draft only — nothing outbound. `launch_locked: true` keeps it in the approval
 * gate; the operator (or Arc) builds out the assets on the detail page.
 */
export async function createCampaignFromOpportunity(
  input: CreateCampaignFromOpportunityInput,
): Promise<{ campaignId: string }> {
  const client = input.client ?? getSupabaseAdminClient();
  const agentName = input.agentName?.trim() || "Arc";
  const opp = input.opportunity;
  const campaignTheme = deriveCampaignTheme(input.campaignTheme, input.restorationFocus) || "Campaign growth";
  // Normalize to a valid enum member (or null) — the legacy column is still an
  // enum type, so a free-text theme must never be written into it.
  const legacyRestorationFocus = normalizeRestorationFocus(input.restorationFocus);

  const campaignId = await insertOne(client, "campaigns", {
    ...workspaceScopeFields(input.tenant),
    name: input.name,
    persona: input.persona,
    campaign_theme: campaignTheme,
    restoration_focus: legacyRestorationFocus,
    status: "draft",
    launch_locked: true,
    owner: input.operator,
    source_system: "arc_opportunity",
    objective: input.objective || null,
    audience_summary: input.audienceSummary ?? null,
    ...campaignSubjectFk(opp.subjectType, opp.subjectId),
    source_signal: {
      authored_by: "arc",
      origin: "opportunity",
      opportunity_id: opp.id,
      subject_type: opp.subjectType,
      subject_id: opp.subjectId,
      confidence: opp.confidence,
      urgency: opp.urgency,
      recommended_action: opp.recommendedAction,
      recommended_campaign_type: opp.recommendedCampaignType ?? null,
      evidence: opp.evidence ?? {},
      outbound_locked: true,
    },
  });

  await insertNoReturn(client, "campaign_events", {
    ...workspaceScopeFields(input.tenant),
    campaign_id: campaignId,
    event_type: "created",
    actor: input.operator,
    detail: `${agentName} drafted this from an opportunity: ${opp.recommendedAction}`,
    payload: {
      source: "arc_opportunity",
      opportunity_id: opp.id,
      subject_type: opp.subjectType,
      subject_id: opp.subjectId,
    },
  });

  // Best-effort brain mirror (re-reads the row + upserts graph nodes/edges) with
  // no dependents — run it after the response so it doesn't serialize extra DB
  // round-trips into the draft-create call.
  deferAfterResponse(() => mirrorCampaignToBrain(client, campaignId, input.tenant));
  return { campaignId };
}

export type CreateCampaignShellInput = {
  operator: string;
  name: string;
  persona: string;
  campaignTheme?: string;
  restorationFocus?: string;
  /** Configured agent display name, threaded from the caller for the audit-log detail. */
  agentName?: string;
  client?: SupabaseClient;
  tenant?: AgentTaskTenantFields;
};

/** Minimal campaign row (draft, launch-locked) for promoting a saved item into a
 *  brand-new campaign. Mirrors the campaign insert in createOperatorCampaign. */
export async function createCampaignShell(input: CreateCampaignShellInput): Promise<{ campaignId: string }> {
  const client = input.client ?? getSupabaseAdminClient();
  const agentName = input.agentName?.trim() || "Agent";
  const campaignTheme = deriveCampaignTheme(input.campaignTheme, input.restorationFocus) || "Campaign growth";
  // Normalize to a valid enum member (or null) — the legacy column is still an
  // enum type, so a free-text theme must never be written into it.
  const legacyRestorationFocus = normalizeRestorationFocus(input.restorationFocus);
  const campaignId = await insertOne(client, "campaigns", {
    ...workspaceScopeFields(input.tenant),
    name: input.name,
    persona: input.persona,
    campaign_theme: campaignTheme,
    restoration_focus: legacyRestorationFocus,
    status: "draft",
    launch_locked: true,
    owner: input.operator,
    source_system: "arc_saved",
  });
  await insertNoReturn(client, "campaign_events", {
    ...workspaceScopeFields(input.tenant),
    campaign_id: campaignId,
    event_type: "created",
    actor: input.operator,
    detail: `created from ${agentName} saved item`,
  });
  // Best-effort brain mirror (re-reads the row + upserts graph nodes/edges) with
  // no dependents — run it after the response so it stops serializing ~2 extra DB
  // round-trips into every Arc draft-asset / campaign-create call.
  deferAfterResponse(() => mirrorCampaignToBrain(client, campaignId, input.tenant));
  return { campaignId };
}

export type CampaignPackageSummaryInput = {
  campaignId: string;
  /** One line: what this campaign is for. */
  objective?: unknown;
  /** One line: who it targets and why they were grouped. */
  audienceSummary?: unknown;
  /** Sales/partner handoff note — the "what a human needs to know" half of the package. */
  handoffNote?: unknown;
  /** Audiences weighed and set aside, each with the reason it lost. */
  consideredAudiences?: unknown;
  client?: SupabaseClient;
  tenant?: AgentTaskTenantFields;
};

/**
 * Record the package-level summary a campaign accumulates as it is drafted
 * (BSR-677).
 *
 * `handoff_note` and `considered_audiences` are named parts of the Campaign
 * Package Builder and are both rendered on the campaign detail page — and until
 * now nothing on any path wrote either, so the UI branch for considered
 * audiences had never once had data. Arc produces both while drafting; they were
 * simply spoken in chat and dropped.
 *
 * Validated through the SAME domain helpers the read model parses with, so what
 * is written is exactly what the reader accepts rather than a second, looser
 * shape that renders as nothing.
 *
 * Additive: a field absent from the input is left alone, because the pieces of a
 * package arrive across several calls and a later asset must not blank the
 * handoff note an earlier one recorded.
 */
export async function recordCampaignPackageSummary(input: CampaignPackageSummaryInput): Promise<boolean> {
  const update: Record<string, unknown> = {};

  // objective/audience_summary were previously only written by
  // createCampaignFromOpportunity, i.e. only when a campaign was CREATED from an
  // opportunity. Documenting an existing campaign could not set them at all:
  // measured on prod, a run that filled handoff_note and considered_audiences on
  // campaign 7bef0d89 left both of these null, because the update path had no
  // way to reach them.
  if (input.objective !== undefined) {
    const objective = typeof input.objective === "string" ? input.objective.trim() : "";
    if (objective) update.objective = objective;
  }
  if (input.audienceSummary !== undefined) {
    const audience = typeof input.audienceSummary === "string" ? input.audienceSummary.trim() : "";
    if (audience) update.audience_summary = audience;
  }
  if (input.handoffNote !== undefined) {
    const note = normalizeHandoffNote(input.handoffNote);
    if (note) update.handoff_note = note;
  }
  if (input.consideredAudiences !== undefined) {
    const audiences = parseConsideredAudiences(input.consideredAudiences);
    // Only write a list that survived parsing. An empty result means the input
    // was malformed, and overwriting a real list with [] would lose more than it
    // records.
    if (audiences.length) update.considered_audiences = audiences;
  }
  // False, not a silent no-op: a caller that supplied only malformed input needs
  // to be able to tell "nothing was worth writing" from "written".
  if (Object.keys(update).length === 0) return false;

  const client = input.client ?? getSupabaseAdminClient();
  let query = client.from("campaigns").update(update as never).eq("id", input.campaignId);
  if (input.tenant?.org_id) query = query.eq("org_id", input.tenant.org_id);
  await query;
  return true;
}

/**
 * Thrown by `resolveOrCreateCampaign` when no `campaignId` is given and the
 * new-campaign fields (name/persona/restorationFocus) are incomplete. Routes
 * catch this to return a 400 rather than a 502, keeping the API contract.
 */
export class CampaignResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignResolutionError";
  }
}

export type ResolveOrCreateCampaignInput = {
  operator: string;
  /** Existing campaign to attach to; when empty, a draft shell is created. */
  campaignId?: string | null;
  name?: string | null;
  persona?: string | null;
  /** Industry-neutral theme for the new draft. */
  campaignTheme?: string | null;
  /** Legacy restoration enum retained for older callers during migration. */
  restorationFocus?: string | null;
  agentName?: string;
  client?: SupabaseClient;
  tenant?: AgentTaskTenantFields;
};

/**
 * Resolve an existing campaign id, or create a fresh draft shell from
 * name/persona/theme. Shared by the Arc draft-asset and submit-variants routes so
 * neither duplicates campaign-creation logic.
 *
 * Industry-neutral: a `campaignTheme` (free text) is the primary field; a legacy
 * `restorationFocus` still satisfies the requirement and seeds the theme. Throws
 * `CampaignResolutionError` (→ 400) when creating a new campaign without the
 * required fields.
 */
export async function resolveOrCreateCampaign(input: ResolveOrCreateCampaignInput): Promise<{ campaignId: string }> {
  const existing = input.campaignId?.trim();
  if (existing) return { campaignId: existing };

  const name = input.name?.trim();
  const persona = input.persona?.trim();
  const campaignTheme = deriveCampaignTheme(input.campaignTheme, input.restorationFocus);
  if (!name || !persona || !campaignTheme) {
    throw new CampaignResolutionError(
      "To create a new campaign, name, persona, and a campaign theme are required (or pass campaign_id to attach to an existing campaign).",
    );
  }

  return createCampaignShell({
    operator: input.operator,
    name,
    persona,
    campaignTheme,
    restorationFocus: input.restorationFocus ?? undefined,
    agentName: input.agentName ?? "Arc",
    client: input.client,
    tenant: input.tenant,
  });
}

/** Provenance for a generated/attached media asset, persisted into audit_payload
 *  so the AI tag + model/job/risk flags survive on the durable record (not just
 *  the ephemeral chat card). All optional — a plain reference URL carries none. */
export type AssetMediaProvenance = {
  source?: string;
  model?: string;
  jobId?: string;
  format?: string;
  riskFlags?: string[];
  libraryAssetId?: string; // exact link back to a media_assets row (powers "Used in")
  /** Virality prediction (video) or computed creative-quality proxy (image). */
  virality?: ViralityScore;
};

export type PromoteAssetInput = {
  operator: string;
  campaignId: string;
  assetType: string; // e.g. "social_ad" | "image_prompt"
  title: string;
  body: string | null;
  mediaUrl: string | null;
  /** Object path/key for the media (e.g. GCS path) so a durable reference is kept
   *  alongside any short-lived signed URL. */
  mediaPath?: string | null;
  /** Generation provenance (AI source, model, jobId, risk flags) for the asset. */
  media?: AssetMediaProvenance;
  /** Configured agent display name, threaded from the caller for the audit-log detail. */
  agentName?: string;
  client?: SupabaseClient;
  tenant?: AgentTaskTenantFields;
};

/** The verdict of the deterministic copy screen, mapped onto the approval queue's
 *  own status/risk vocabulary. */
export type CopyScreen = {
  riskLevel: string;
  status: string;
  complianceNotes: string | null;
  flags: string[];
  blockedPhrases: string[];
  /** The draft body after the CTA placeholder was resolved to a real link, when
   *  that happened; undefined means "persist input.body unchanged". */
  resolvedBody?: string;
};

/** What an asset gets when no screen ran: unchanged from the pre-screen behavior. */
const UNSCREENED: CopyScreen = {
  riskLevel: "medium",
  status: "pending_approval",
  complianceNotes: null,
  flags: [],
  blockedPhrases: [],
};

/**
 * Deterministic copy screen for anything entering the approval queue.
 *
 * This is the cheap, certain layer: it proves copy is not *known*-bad against the
 * org's Brand Kit banned-phrase list. It cannot verify a claim — so copy that
 * passes is `medium` (screened, unverified), never `low`. `low` is reserved for
 * copy a semantic reviewer has actually grounded in workspace evidence.
 *
 * Only an *active* Brand Kit screens, mirroring getBusinessContext: a draft kit
 * means the operator hasn't committed to those rules yet, and there is no banned
 * list to check against.
 *
 * Exported for `reviseCampaignAsset`, which replaces the copy on an asset that is
 * already in the queue. A revision that skipped this would be a way around the
 * screen: submit clean copy, then "revise" the banned phrase back in.
 */
export async function screenDraftCopy(
  body: string | null,
  assetType: string,
  client: SupabaseClient,
  tenant?: AgentTaskTenantFields,
): Promise<CopyScreen> {
  const draftOutput = body?.trim();
  if (!draftOutput || !tenant) return UNSCREENED;

  // A Brand Kit read failure must never block asset creation: an unscreened asset
  // is still pending_approval + dispatch_locked, so the human gate holds either way.
  const profile = await getBusinessProfile(tenant.org_id, client).catch(() => null);
  if (profile?.status !== "active") return UNSCREENED;

  // Resolve the CTA placeholder to a real link, reusing the brand read the screen
  // already did. A click-channel draft (email/landing) with no destination surfaces
  // as a compliance flag rather than silently shipping a dead button — the whole
  // point is to feed dispatch a taggable link, so a placeholder-only body is not
  // done. Not blocked, though: the operator can still approve and route it by hand,
  // same as any other flagged asset. Other channels return not_applicable.
  const cta = resolveCampaignCta(assetType, draftOutput, profile.websiteUrl);
  const resolvedBody = cta.kind === "resolved" ? cta.body : undefined;
  const ctaFlag = cta.kind === "missing_destination" ? ["cta_missing_destination"] : [];
  const ctaNote = cta.kind === "missing_destination" ? cta.reason : null;

  // Screen the copy that will actually ship (the resolved body if we linked it).
  const guardrails = checkArcGeneratedCopy({
    draftOutput: resolvedBody ?? draftOutput,
    bannedPhrases: profile.bannedPhrases,
    complianceNotes: profile.guardrails.complianceNotes,
  });
  const blocked = guardrails.blockedPhrases.length > 0;
  const flags = [...guardrails.flags, ...ctaFlag];
  return {
    riskLevel: blocked ? "blocked" : "medium",
    status: blocked ? "needs_compliance" : "pending_approval",
    complianceNotes: [guardrails.complianceNotes, ctaNote].filter(Boolean).join(" ") || null,
    flags,
    blockedPhrases: guardrails.blockedPhrases,
    ...(resolvedBody ? { resolvedBody } : {}),
  };
}

/** Insert a pending-approval campaign asset + its approval gate + an event, so the
 *  asset shows up in /campaigns awaiting the operator's decision. Mirrors
 *  insertPhotoAsset but stays pending_approval instead of pre-approved.
 *
 *  Every caller funnels copy into the approval queue through here, so the copy
 *  screen lives here too — no caller can forget it. */
export async function promoteAssetToCampaign(input: PromoteAssetInput): Promise<{ assetId: string }> {
  const client = input.client ?? getSupabaseAdminClient();
  const screen = await screenDraftCopy(input.body, input.assetType, client, input.tenant);
  // Persist the CTA-resolved copy, not the placeholder — the operator approves the
  // body that will actually send, and dispatch has a link to stamp.
  const bodyToPersist = screen.resolvedBody ?? input.body;
  const agentName = input.agentName?.trim() || "Agent";
  const provenance = input.media ?? {};
  const mediaAsset = input.mediaUrl
    ? {
        url: input.mediaUrl,
        ...(input.mediaPath ? { path: input.mediaPath } : {}),
        ...(provenance.source ? { source: provenance.source } : {}),
        ...(provenance.model ? { model: provenance.model } : {}),
        ...(provenance.jobId ? { job_id: provenance.jobId } : {}),
        ...(provenance.format ? { format: provenance.format } : {}),
        ...(provenance.riskFlags?.length ? { risk_flags: provenance.riskFlags } : {}),
        ...(provenance.libraryAssetId ? { library_asset_id: provenance.libraryAssetId } : {}),
        ...(provenance.virality ? { virality: provenance.virality } : {}),
      }
    : null;
  const assetId = await insertOne(client, "campaign_assets", {
    ...workspaceScopeFields(input.tenant),
    campaign_id: input.campaignId,
    asset_type: input.assetType,
    // Derived, never omitted: the dispatch enqueue keys off `channel`, so an
    // email asset with a null channel enqueues as non-addressable — a dispatch
    // with no recipient and no subject, which looks real and can never send.
    channel: channelForAssetType(normalizeCampaignAssetType(input.assetType) ?? "other"),
    title: input.title,
    status: screen.status,
    draft_body: bodyToPersist,
    dispatch_locked: true,
    tool_source: "arc_saved",
    ...(screen.complianceNotes ? { compliance_notes: screen.complianceNotes } : {}),
    audit_payload: {
      ...(mediaAsset ? { media_assets: [mediaAsset] } : {}),
      outbound_locked: true,
      ...(screen.flags.length > 0
        ? { guardrail: { flags: screen.flags, blocked_phrases: screen.blockedPhrases } }
        : {}),
    },
  });
  await insertNoReturn(client, "approval_items", {
    ...workspaceScopeFields(input.tenant),
    campaign_id: input.campaignId,
    campaign_asset_id: assetId,
    item_type: "campaign_asset",
    status: screen.status,
    approval_required: true,
    locked_until_approved: true,
    requested_by: input.operator,
    risk_level: screen.riskLevel,
    ...(screen.complianceNotes ? { compliance_notes: screen.complianceNotes } : {}),
  });
  await insertNoReturn(client, "campaign_events", {
    ...workspaceScopeFields(input.tenant),
    campaign_id: input.campaignId,
    campaign_asset_id: assetId,
    event_type: "asset_generated",
    actor: input.operator,
    detail: `promoted from ${agentName} saved`,
  });
  return { assetId };
}


