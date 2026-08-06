"use server";

import { revalidatePath } from "next/cache";

import {
  buildCampaignSeedFromOpportunity,
  isAllowedPersona,
  type DismissReason,
  type OpportunityPackageBrief,
  RESTORATION_FOCUS_VALUES,
} from "@/domain";
import { getOperatorActor, requireOperator } from "@/lib/auth/operator";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { createCampaignFromOpportunity } from "@/lib/campaigns/create";
import { getBusinessProfile } from "@/lib/brand-kit/persistence";
import { getOrgPersonaKeys } from "@/lib/personas/read-model";
import { runDeterministicOpportunityScan } from "@/lib/opportunities/scan";
import { executeOpportunityDraftTask } from "@/lib/opportunities/draft-package";
import { enqueueArcOpportunityTask } from "@/lib/opportunities/enqueue";
import { dismissOpportunity, markOpportunityDrafted, markOpportunityDrafting, snoozeOpportunity } from "@/lib/opportunities/persistence";
import { getOpportunityForCampaign } from "@/lib/opportunities/read-model";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { reportDegraded } from "@/lib/observability/report-degraded";

/**
 * Operator-triggered opportunity scan: runs the deterministic detectors over the
 * current workspace's signals and persists any new source-backed opportunities,
 * then refreshes the inbox. Built-in sources — cold CRM leads, ingested weather
 * alerts (geo-targeted storm response), and captured competitor flights (defensive
 * response) — plus every ENABLED signal_source connector (e.g. live NWS/NOAA
 * weather signals, BSR-364) via the connector orchestrator. Org-scoped through the
 * authenticated request context. Each source is best-effort so one failing source
 * can't sink the whole scan. Read-only detection — nothing outbound, nothing drafted.
 */
export type ScanFeedback =
  | { ok: true; added: number; filtered: number }
  | { ok: false; error: string };

export async function scanForOpportunitiesAction(
  _prev: ScanFeedback | null,
  _formData: FormData,
): Promise<ScanFeedback> {
  if (!isSupabaseAdminConfigured()) {
    return { ok: false, error: "Connect a workspace to scan for opportunities." };
  }
  try {
    // Ensures the caller is authenticated + establishes the org scope the detectors read.
    await getCurrentWorkspaceContext();
    // Same deterministic detectors the scheduled cron runs — one shared path so the
    // manual scan and the daily scan can never surface different opportunities.
    const summary = await runDeterministicOpportunityScan();
    revalidatePath("/opportunities");
    return { ok: true, ...summary };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The scan could not complete." };
  }
}

export type OpportunityTriageResult = { ok: true; persisted: boolean } | { ok: false; error: string };

/**
 * Triage an opportunity out of the open inbox. Both wrap already-built persistence
 * (`dismissOpportunity` / `snoozeOpportunity`) that flips status to dismissed/snoozed
 * — which the read-model's open-status filter drops from the list. Read-only to the
 * outside world: triage records a decision, never sends or contacts anything. Gated
 * by requireOperator() and org-scoped. `persisted: false` is the honest offline signal.
 */
export async function dismissOpportunityAction(
  opportunityId: string,
  reason?: DismissReason | null,
): Promise<OpportunityTriageResult> {
  await requireOperator();
  if (!opportunityId) return { ok: false, error: "Missing opportunity." };
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };
  try {
    const ctx = await getCurrentWorkspaceContext();
    // `reason` is optional by design (BSR-686): a dismissal that says nothing is
    // still a dismissal, and making it mandatory would cost the volume that
    // makes the signal worth having.
    await dismissOpportunity(opportunityId, reason ?? null, undefined, { orgId: ctx.orgId });
    revalidatePath("/opportunities");
    return { ok: true, persisted: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not dismiss the opportunity." };
  }
}

export async function snoozeOpportunityAction(opportunityId: string, days: number): Promise<OpportunityTriageResult> {
  await requireOperator();
  if (!opportunityId) return { ok: false, error: "Missing opportunity." };
  const span = Number.isFinite(days) && days > 0 ? Math.min(days, 90) : 7;
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };
  try {
    const ctx = await getCurrentWorkspaceContext();
    const until = new Date(Date.now() + span * 86_400_000).toISOString();
    await snoozeOpportunity(opportunityId, until, undefined, { orgId: ctx.orgId });
    revalidatePath("/opportunities");
    return { ok: true, persisted: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not snooze the opportunity." };
  }
}

export type DraftCampaignFromOpportunityInput = {
  opportunityId: string;
  name: string;
  persona: string;
  campaignTheme?: string;
  /** Legacy input retained for older clients during the campaign-theme migration. */
  restorationFocus?: string;
};

export type DraftCampaignFromOpportunityResult =
  | { ok: true; persisted: boolean; campaignId?: string; href?: string }
  | { ok: false; error: string };

/** `persona_property_manager` / `water_backup` → "Property Manager" / "Water Backup". */
function humanizeKey(key: string): string {
  return key.replace(/^persona_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type PreparedDraft =
  | { status: "error"; error: string }
  | { status: "offline" }
  | { status: "existing"; campaignId: string }
  | {
      status: "created";
      campaignId: string;
      ctx: { orgId: string; workspaceId: string };
      actor: string;
      persona: string;
      focus: string;
      opp: {
        id: string;
        subjectType: string;
        urgency: "low" | "medium" | "high";
        recommendedAction: string;
        title: string;
        /** Carried so the package builder can tell a partner from a customer. */
        recommendedCampaignType: string | null;
      };
    };

/**
 * Shared core for both inbox draft actions: validate, re-read the authoritative
 * opportunity server-side (so evidence can't be forged), and create the
 * approval-gated, launch-locked campaign draft (provenance-stamped as
 * Arc-drafted). Returns `offline` when Supabase isn't configured so the UI can
 * confirm without claiming a save. Draft only — nothing outbound.
 */
async function createDraftCampaign(input: DraftCampaignFromOpportunityInput): Promise<PreparedDraft> {
  await requireOperator();

  const name = input.name?.trim();
  const persona = input.persona?.trim();
  const suppliedTheme = input.campaignTheme?.trim();
  const legacyFocus = input.restorationFocus?.trim();
  const focus = suppliedTheme || legacyFocus || "";
  if (!name) return { status: "error", error: "A campaign name is required." };
  if (!persona) {
    return { status: "error", error: "Choose a persona for this campaign." };
  }
  if (suppliedTheme) {
    if (suppliedTheme.length > 120) return { status: "error", error: "Add a campaign theme (120 characters or fewer)." };
  } else if (!legacyFocus || !(RESTORATION_FOCUS_VALUES as readonly string[]).includes(legacyFocus)) {
    return { status: "error", error: "Choose a focus for this campaign." };
  }

  const actor = await getOperatorActor();
  if (!isSupabaseAdminConfigured()) return { status: "offline" };

  const ctx = await getCurrentWorkspaceContext();
  const allowedPersonaKeys = await getOrgPersonaKeys(ctx.orgId);
  if (!isAllowedPersona(persona, allowedPersonaKeys)) {
    return { status: "error", error: "Choose a persona for this campaign." };
  }
  // Secondary, not primary: a failure here is recoverable by retrying, and the
  // operator sees an error either way. But it must be recorded, because a read
  // FAILURE and a genuinely-missing opportunity produce the identical message —
  // so without this, "no longer available" could mean the database is down.
  const opp = await getOpportunityForCampaign(input.opportunityId, ctx.orgId).catch((error) => {
    reportDegraded(error, {
      scope: "opportunities.getOpportunityForCampaign",
      surface: "secondary",
      detail: { opportunityId: input.opportunityId },
    });
    return null;
  });
  if (!opp) return { status: "error", error: "That opportunity is no longer available." };

  // Idempotency: a drafted opportunity keeps showing in the inbox, so a re-submit
  // (or double-click) would otherwise spawn a duplicate campaign — and, via "Ask
  // Arc to draft", a second package run. If it already links to a campaign, route
  // callers to that existing draft instead of creating another.
  if (opp.campaignId) return { status: "existing", campaignId: opp.campaignId };

  try {
    // The Brand Kit is what says where this business operates. Read it here so a
    // signal-driven campaign is scoped by the workspace rather than by whatever
    // geography the alert happened to cover (BSR-756). Best-effort: an
    // unreadable profile must not block the draft — the summary says the scope
    // is unverified instead of quietly implying coverage.
    const profile = await getBusinessProfile(ctx.orgId).catch(() => null);
    const seed = buildCampaignSeedFromOpportunity(
      {
        title: opp.title,
        summary: opp.summary,
        recommendedAction: opp.recommendedAction,
        urgency: opp.urgency,
        persona: opp.persona,
        recommendedCampaignType: opp.recommendedCampaignType,
        signalArea: typeof opp.evidence?.area === "string" ? opp.evidence.area : null,
        serviceAreas: profile?.serviceAreas ?? null,
      },
      allowedPersonaKeys,
    );

    const { campaignId } = await createCampaignFromOpportunity({
      operator: actor,
      name,
      persona,
      ...(suppliedTheme ? { campaignTheme: suppliedTheme } : { restorationFocus: legacyFocus }),
      objective: opp.recommendedAction,
      audienceSummary: seed.audienceSummary,
      opportunity: {
        id: opp.id,
        subjectType: opp.subjectType,
        subjectId: opp.subjectId,
        confidence: opp.confidence,
        urgency: opp.urgency,
        recommendedAction: opp.recommendedAction,
        recommendedCampaignType: opp.recommendedCampaignType,
        evidence: opp.evidence,
      },
      tenant: { org_id: ctx.orgId, workspace_id: ctx.workspaceId ?? "" },
    });

    return {
      status: "created",
      campaignId,
      ctx: { orgId: ctx.orgId, workspaceId: ctx.workspaceId ?? "" },
      actor,
      persona,
      focus,
      opp: {
        id: opp.id,
        subjectType: opp.subjectType,
        urgency: opp.urgency,
        recommendedAction: opp.recommendedAction,
        title: name,
        recommendedCampaignType: opp.recommendedCampaignType,
      },
    };
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : "Could not create the campaign." };
  }
}

/**
 * "Create campaign" — convert the opportunity into an operator-owned draft shell.
 * The campaign lands launch-locked in the approval gate; the operator builds the
 * assets. The opportunity reads as `drafted`. Nothing outbound.
 */
export async function draftCampaignFromOpportunityAction(
  input: DraftCampaignFromOpportunityInput,
): Promise<DraftCampaignFromOpportunityResult> {
  const prepared = await createDraftCampaign(input);
  if (prepared.status === "error") return { ok: false, error: prepared.error };
  if (prepared.status === "offline") return { ok: true, persisted: false };
  if (prepared.status === "existing") {
    return { ok: true, persisted: true, campaignId: prepared.campaignId, href: `/campaigns/${prepared.campaignId}` };
  }

  // Link the campaign back + advance the opportunity so it reads as drafted.
  // Best-effort: the campaign already exists, so a link failure must not fail it.
  //
  // But it must not fail SILENTLY. If this write is lost the opportunity stays
  // `pending` while its campaign exists, so the next scan re-detects it and
  // drafts a DUPLICATE — with nothing anywhere explaining why.
  await markOpportunityDrafted(prepared.opp.id, prepared.campaignId, undefined, { orgId: prepared.ctx.orgId }).catch(
    (error) =>
      reportDegraded(error, {
        scope: "opportunities.markOpportunityDrafted",
        surface: "primary",
        detail: { opportunityId: prepared.opp.id, campaignId: prepared.campaignId },
      }),
  );

  revalidatePath("/opportunities");
  revalidatePath("/campaigns");
  return { ok: true, persisted: true, campaignId: prepared.campaignId, href: `/campaigns/${prepared.campaignId}` };
}

/**
 * "Ask Arc to draft" — create the same draft campaign, then enqueue an
 * approval-gated Arc draft run that fills it with a starter package (email, SMS,
 * paid, landing) as pending-approval assets, and execute that run inline so the
 * operator returns to a populated, review-ready package. The opportunity passes
 * through `drafting`. Every generated asset is dispatch-locked — nothing sends.
 */
export async function askArcToDraftFromOpportunityAction(
  input: DraftCampaignFromOpportunityInput,
): Promise<DraftCampaignFromOpportunityResult> {
  const prepared = await createDraftCampaign(input);
  if (prepared.status === "error") return { ok: false, error: prepared.error };
  if (prepared.status === "offline") return { ok: true, persisted: false };
  if (prepared.status === "existing") {
    // Already converted — route to the existing draft rather than re-running Arc.
    return { ok: true, persisted: true, campaignId: prepared.campaignId, href: `/campaigns/${prepared.campaignId}` };
  }

  const { campaignId, ctx, actor, persona, focus, opp } = prepared;
  const brief: OpportunityPackageBrief = {
    title: opp.title,
    angle: opp.recommendedAction,
    personaLabel: humanizeKey(persona),
    focusLabel: humanizeKey(focus),
    urgency: opp.urgency,
    subjectLabel: opp.subjectType ? humanizeKey(opp.subjectType) : undefined,
    campaignType: opp.recommendedCampaignType ?? undefined,
  };

  try {
    const taskId = await enqueueArcOpportunityTask({
      opportunityId: opp.id,
      objective: `Draft a campaign package for: ${opp.recommendedAction}`,
      operator: actor,
      campaignId,
      brief,
    });
    // Reads as "drafting" while the run is in flight, then the executor flips it
    // to "drafted" once the package lands.
    await markOpportunityDrafting(opp.id, taskId, undefined, { orgId: ctx.orgId }).catch((error) =>
      reportDegraded(error, {
        scope: "opportunities.markOpportunityDrafting",
        surface: "primary",
        detail: { opportunityId: opp.id, agentTaskId: taskId },
      }),
    );
    await executeOpportunityDraftTask({ agentTaskId: taskId, orgId: ctx.orgId, agentName: "Arc" });
  } catch {
    // No Arc agent registered (or the run failed): the draft shell still exists,
    // so settle the opportunity as drafted rather than leaving it stuck.
    // The settle-after-failure path. Losing THIS write is the worst of the
    // three: the run already failed, and now the opportunity is stuck mid-flight
    // with no record of either problem.
    await markOpportunityDrafted(opp.id, campaignId, undefined, { orgId: ctx.orgId }).catch((error) =>
      reportDegraded(error, {
        scope: "opportunities.markOpportunityDrafted.afterRunFailure",
        surface: "primary",
        detail: { opportunityId: opp.id, campaignId },
      }),
    );
  }

  revalidatePath("/opportunities");
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true, persisted: true, campaignId, href: `/campaigns/${campaignId}` };
}
