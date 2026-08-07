"use server";

import { revalidatePath } from "next/cache";

import { isAllowedPersona } from "@/domain";
import { getOperatorActor, requireOperator } from "@/lib/auth/operator";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { createCampaignShell } from "@/lib/campaigns/create";
import { getWorkspaceReviewQueue, type ReviewQueueEntry } from "@/lib/campaigns/read-model";
import { getOrgPersonaKeys } from "@/lib/personas/read-model";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

/**
 * Real operator write for the "New campaign" button. Creates a draft,
 * launch-locked campaign shell (createCampaignShell) — the operator/Arc then
 * builds it out on the detail page. Nothing goes outbound: the row is
 * launch_locked and approval-gated. `persisted: false` is the honest offline
 * signal so the board can show an optimistic draft without claiming a save.
 */
export type CreateCampaignResult =
  | { ok: true; persisted: boolean; campaignId?: string; href?: string }
  | { ok: false; error: string };

export type NewCampaignInput = { name: string; persona: string; campaignTheme: string };

export async function createCampaign(input: NewCampaignInput): Promise<CreateCampaignResult> {
  await requireOperator();

  const name = input.name?.trim();
  const persona = input.persona?.trim();
  const campaignTheme = input.campaignTheme?.trim();
  if (!name) return { ok: false, error: "A campaign name is required." };
  if (!persona) return { ok: false, error: "Choose a persona for this campaign." };
  if (!campaignTheme || campaignTheme.length > 120) return { ok: false, error: "Add a campaign theme (120 characters or fewer)." };

  const actor = await getOperatorActor();

  // Offline/demo: no DB to write to. Report success-but-unpersisted so the board
  // can show an optimistic draft without claiming it saved.
  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const ctx = await getCurrentWorkspaceContext();
  // Two different failures wore the same sentence. "Choose a persona" is right
  // when nothing was picked (checked above); here the operator DID pick, and the
  // key simply isn't one this workspace has — which reads as the app ignoring
  // them. Say which it is, and what to do about it.
  const allowedKeys = await getOrgPersonaKeys(ctx.orgId);
  if (allowedKeys.length === 0) {
    return { ok: false, error: "This workspace has no personas yet — add one on the Personas page, then create the campaign." };
  }
  if (!isAllowedPersona(persona, allowedKeys)) {
    return { ok: false, error: "That persona isn't in this workspace. Pick one from the list, or add it on the Personas page." };
  }
  try {
    const { campaignId } = await createCampaignShell({
      operator: actor,
      name,
      persona,
      campaignTheme,
      tenant: { org_id: ctx.orgId, workspace_id: ctx.workspaceId ?? "" },
    });
    revalidatePath("/campaigns");
    return { ok: true, persisted: true, campaignId, href: `/campaigns/${campaignId}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not create the campaign." };
  }
}

export type LoadReviewQueueResult =
  | { ok: true; entries: ReviewQueueEntry[] }
  | { ok: false; error: string };

/**
 * Everything on the operator's desk, across every campaign in the workspace —
 * or, given a `campaignId`, just that campaign's share of it.
 *
 * Loaded on demand rather than with the board. The queue needs two tables the
 * list read does not touch — the recommendations and the findings — and the
 * campaigns page is the most-visited screen in the app. Paying for a review
 * nobody asked to see, on every visit, to save one click when they do, is the
 * wrong trade.
 *
 * The narrowing happens HERE rather than in the client: the board only ever
 * renders one campaign's entries when a row is clicked, and shipping the other
 * campaigns' draft copy to the browser to be filtered out is work and exposure
 * for nothing.
 */
export async function loadReviewQueueAction(campaignId?: string): Promise<LoadReviewQueueResult> {
  await requireOperator();
  const ctx = await getCurrentWorkspaceContext();
  const queue = await getWorkspaceReviewQueue(undefined, "Arc", ctx.orgId, ctx.workspaceId);
  if (queue.status !== "live") return { ok: false, error: queue.message };
  const entries = campaignId ? queue.entries.filter((entry) => entry.campaignId === campaignId) : queue.entries;
  return { ok: true, entries };
}
