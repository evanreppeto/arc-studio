"use server";

import { revalidatePath } from "next/cache";

import { type ApprovalDecision } from "@/domain";
import { getOperatorActor, requireOperator } from "@/lib/auth/operator";
import { getCurrentOrgId } from "@/lib/auth/org";
import {
  backfillMissingEmbeddings,
  resyncCampaignsIntoBrain,
  resyncCrmIntoBrain,
  resyncMediaIntoBrain,
} from "@/lib/brain-ingestion/sync";
import { probeEmbedding } from "@/lib/embeddings/gemini-embeddings";
import { archiveNode, decideNode, updateNode } from "@/lib/knowledge-graph/persistence";
import { listNodes, sanitizeBrainSearch } from "@/lib/knowledge-graph/read-model";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { toFact } from "./_data/fact-vm";
import { type FactVM } from "./_components/brain-view";

/**
 * The Brain trust gate: approve or reject a proposed knowledge node. Approving
 * moves it to `trusted` (usable in outbound copy); rejecting archives it. This
 * is the human gate the whole screen is built around — internal only, nothing
 * outbound. `persisted: false` is the honest offline signal so the review list
 * can drop the card without claiming a real decision was written.
 */
export type BrainDecisionResult = { ok: true; persisted: boolean } | { ok: false; error: string };

export async function decideBrainNode(nodeId: string, decision: ApprovalDecision): Promise<BrainDecisionResult> {
  await requireOperator();
  if (!nodeId) return { ok: false, error: "Missing node." };
  if (decision !== "approve" && decision !== "reject") return { ok: false, error: "Invalid decision." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const actor = await getOperatorActor();
  const result = await decideNode(nodeId, decision, { actor });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/brain");
  return { ok: true, persisted: true };
}

/**
 * Archive a Brain fact — a soft, reversible curation move (trust_tier -> archived)
 * that drops it from the working knowledge without deleting it. Internal only,
 * never outbound; org-scoped in the persistence layer. `persisted: false` is the
 * honest offline signal so the list can drop the row without claiming a write.
 */
export async function archiveBrainNode(nodeId: string): Promise<BrainDecisionResult> {
  await requireOperator();
  if (!nodeId) return { ok: false, error: "Missing node." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const result = await archiveNode(nodeId);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/brain");
  return { ok: true, persisted: true };
}

/**
 * Correct what Arc believes (BSR-531).
 *
 * An operator could already ARCHIVE a wrong fact. They could not fix one — and
 * "wrong memory is worse than no memory" cuts both ways: deleting a fact that is
 * 90% right to remove the 10% that is wrong loses the 90% too.
 *
 * The write re-embeds, which is the part that makes this real rather than
 * cosmetic. The stored vector is built from label+summary+body, so editing the
 * text without rebuilding it would leave the node semantically searchable under
 * its OLD wording: the operator sees the fix on screen and Arc carries on saying
 * the old thing. That is the acceptance criterion — "a corrected fact changes
 * Arc's answer on the next turn" — and it lives or dies on the re-embed.
 *
 * Corrections come from a human, so unlike Arc's own writes this does not touch
 * the trust tier: fixing a trusted fact leaves it trusted, and fixing one that
 * is awaiting review leaves it awaiting review. Correcting a fact is not the
 * same act as approving it.
 */
export async function correctBrainFact(
  nodeId: string,
  fields: { label?: string; summary?: string | null; body?: string | null },
): Promise<BrainDecisionResult> {
  await requireOperator();
  if (!nodeId) return { ok: false, error: "Missing node." };

  const label = fields.label?.trim();
  if (fields.label !== undefined && !label) return { ok: false, error: "A fact needs a label." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  // Org scope is enforced by updateNode's own `.eq("org_id", …)`, resolved from
  // the session rather than accepted from the caller.
  const result = await updateNode(nodeId, fields);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/brain");
  return { ok: true, persisted: true };
}

/**
 * Search Arc's whole memory — not just the recency-capped page the Brain screen
 * loads. `listNodes` already searches label/body/summary server-side (live SQL +
 * demo fallback); this is its front door. Without it the facts table could only
 * filter the newest 200 nodes by kind, so a fact updated longer ago was
 * unreachable from the UI even though the tiles counted it.
 *
 * Read-only + operator-gated; `capped` tells the UI the match set itself hit the
 * 200-row ceiling so it can say so rather than imply the results are exhaustive.
 */
export type BrainSearchResult =
  | { ok: true; facts: FactVM[]; capped: boolean }
  | { ok: false; error: string };

export async function searchBrainFacts(query: string): Promise<BrainSearchResult> {
  await requireOperator();
  const term = sanitizeBrainSearch(query ?? "");
  if (!term) return { ok: true, facts: [], capped: false };
  const result = await listNodes({ search: term });
  if (result.status !== "live") return { ok: false, error: result.message };
  return { ok: true, facts: result.nodes.map(toFact), capped: result.nodes.length >= 200 };
}

export type RebuildBrainResult = { ok: boolean; synced: number; embedded: number; message: string };

// Nodes embedded per click. The full resync (~2 DB round-trips × every node) and
// a large embedding backfill can't BOTH fit in one serverless invocation, so we
// keep each click bounded and let the operator re-click (guided by the message)
// until the backlog is drained. Small enough to finish well under maxDuration.
const EMBED_BATCH = 150;

async function resyncAll(orgId: string): Promise<number> {
  const crm = await resyncCrmIntoBrain({ orgId });
  const camp = await resyncCampaignsIntoBrain({ orgId });
  const media = await resyncMediaIntoBrain({ orgId });
  return crm.synced + camp.synced + media.synced;
}

/**
 * Operator-triggered Brain refresh. Ordered so a single click always fits the
 * function budget:
 *   1. Probe embedding — surface the exact failure if it's off (still resync so
 *      the graph stays current even without semantic recall).
 *   2. Drain the embedding BACKLOG in bounded batches. These nodes already exist
 *      in the graph, so no resync is needed; while a backlog remains we SKIP the
 *      heavy resync (running it alongside a big backfill is what timed out).
 *   3. Once the backlog is clear, resync CRM/campaigns/media to pull in anything
 *      new, then embed just those new nodes.
 * The backfill is what flips recall from keyword-only to semantic.
 */
export async function rebuildBrainMemoryAction(): Promise<RebuildBrainResult> {
  await requireOperator();
  if (!isSupabaseAdminConfigured()) {
    return { ok: false, synced: 0, embedded: 0, message: "Brain refresh needs a connected backend." };
  }
  try {
    const orgId = await getCurrentOrgId();

    // 1. Does embedding actually work in THIS runtime? Surface the exact reason if not.
    const probe = await probeEmbedding();
    if (!probe.ok) {
      const synced = await resyncAll(orgId);
      revalidatePath("/brain");
      return {
        ok: true,
        synced,
        embedded: 0,
        message: `Refreshed ${synced} records. Semantic recall is OFF — ${probe.error} (model "${probe.model}"; set GEMINI_EMBEDDING_MODEL to override).`,
      };
    }

    // 2. Drain the embedding backlog first (the heavy, important part). No resync yet.
    const embed = await backfillMissingEmbeddings({ orgId, budget: EMBED_BATCH });
    if (embed.remaining) {
      revalidatePath("/brain");
      return {
        ok: true,
        synced: 0,
        embedded: embed.embedded,
        message: `Embedded ${embed.embedded} memories. More remain — click Refresh again to finish.`,
      };
    }

    // 3. Backlog clear → resync to catch new records, then embed anything new.
    const synced = await resyncAll(orgId);
    const embedNew = await backfillMissingEmbeddings({ orgId, budget: EMBED_BATCH });
    const embedded = embed.embedded + embedNew.embedded;
    revalidatePath("/brain");
    return {
      ok: true,
      synced,
      embedded,
      message: embedNew.remaining
        ? `Refreshed ${synced} records · embedded ${embedded} memories. More remain — click Refresh again.`
        : embedded > 0
          ? `Refreshed ${synced} records · embedded ${embedded} memories. Semantic recall is ON.`
          : `Refreshed ${synced} records. Semantic recall is ON — everything's already embedded.`,
    };
  } catch (error) {
    return { ok: false, synced: 0, embedded: 0, message: error instanceof Error ? error.message : "Brain refresh failed." };
  }
}
