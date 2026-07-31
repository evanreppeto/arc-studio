import { enrichRecall, selectRecall, type RecallCandidate, type RecallGraph, type RecallItem } from "@/domain";
import { embedText } from "@/lib/embeddings/gemini-embeddings";
import { type TypedSupabaseClient, getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { getBrainGraph } from "./graph";

/** trusted before observed; anything else sorts last (defensive). */
const TIER_PRIORITY: Record<string, number> = { trusted: 0, observed: 1 };

const SEMANTIC_K = 12;

/**
 * Top-K semantically-nearest nodes for the message, each carrying the cosine
 * similarity it scored. [] when embeddings or the RPC are unavailable, and for a
 * blank message — an empty string has no meaningful nearest neighbours, and the
 * recall contract is that it returns the core set only.
 */
async function semanticCandidates(
  orgId: string,
  message: string,
  client: TypedSupabaseClient,
): Promise<RecallCandidate[]> {
  if (!message.trim()) return [];
  const embedding = await embedText(message, { orgId, purpose: "brain.recall" });
  if (!embedding) return [];
  const { data, error } = await (client as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> }).rpc("match_knowledge_nodes", {
    query_embedding: JSON.stringify(embedding),
    match_org_id: orgId,
    match_count: SEMANTIC_K,
    tiers: ["trusted", "observed"],
  });
  if (error || !Array.isArray(data)) return [];
  return (data as Array<{ id: string; kind: string; label: string; summary: string | null; tags: string[] | null; trust_tier: string; distance: number | null }>).map((r) => ({
    id: r.id,
    kind: r.kind,
    label: r.label,
    summary: r.summary,
    tags: r.tags ?? [],
    trustTier: r.trust_tier as RecallCandidate["trustTier"],
    // The RPC orders by pgvector's `<=>` — cosine distance, 0 = identical direction.
    // Fold to a 0–1-ish similarity so ranking reads the intuitive way (higher = nearer).
    ...(typeof r.distance === "number" ? { similarity: 1 - r.distance } : {}),
  }));
}

/**
 * Assemble the bounded "memory" Arc recalls each turn: the org's trusted + observed
 * brain nodes, selected (a small always-on core, plus the best matches for `message`
 * ranked by fusing keyword and semantic order) and enriched with multi-hop
 * relationship lines from the brain's edges. Fetches the graph once via getBrainGraph
 * with an explicit trustTiers filter — trusted+observed only (never
 * proposed/rejected/archived), and the filter avoids the empty-brain demo fallback.
 * Semantic hits score the candidates they match and are unioned in when the graph
 * window missed them. Degrades gracefully whenever embeddings or the RPC are
 * unavailable — falls back to graph-only keyword recall. Empty on any unavailable read.
 */
export async function getRecallMemory(
  orgId: string,
  message: string,
  client?: TypedSupabaseClient,
): Promise<RecallItem[]> {
  const graph = await getBrainGraph({ trustTiers: ["trusted", "observed"] }, client, orgId);
  if (graph.status !== "live") return [];

  const candidates: RecallCandidate[] = [...graph.nodes]
    .sort((a, b) => (TIER_PRIORITY[a.trustTier] ?? 9) - (TIER_PRIORITY[b.trustTier] ?? 9))
    .map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      summary: n.summary,
      tags: n.tags,
      trustTier: n.trustTier,
      // Dates the fact in the prompt. A semantic-only hit has no timestamp (the
      // RPC doesn't return one), so it simply renders undated rather than
      // guessing an age.
      recordedAt: n.createdAt,
    }));

  // Fold the vector search in as a RANKING signal, not just as extra candidates:
  // score the nodes already in the window, and append only the ones it missed.
  //
  // Attaching is the part that matters. The window holds up to NODE_CAP nodes, so
  // for any brain smaller than that every semantic hit is already a candidate — a
  // union-only merge contributes literally nothing, which is what it did here: the
  // search ran, paid for an embedding, and was discarded every turn. selectRecall
  // reads `similarity` off the candidates, so attaching is what lets a paraphrased
  // question reach a node that shares none of its literal wording.
  //
  // If Supabase isn't configured or embedText returns null, semanticCandidates
  // returns [] and the result is identical to graph-only keyword recall.
  if (isSupabaseAdminConfigured() || client) {
    const resolvedClient = client ?? getSupabaseAdminClient();
    const byId = new Map(candidates.map((c) => [c.id, c]));
    for (const hit of await semanticCandidates(orgId, message, resolvedClient)) {
      const known = byId.get(hit.id);
      if (known) known.similarity = hit.similarity;
      else {
        candidates.push(hit);
        byId.set(hit.id, hit);
      }
    }
  }

  const selected = selectRecall(candidates, message);
  const recallGraph: RecallGraph = {
    nodes: graph.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind })),
    edges: graph.edges.map((e) => ({ fromNodeId: e.fromNodeId, toNodeId: e.toNodeId, relation: e.relation })),
  };
  return enrichRecall(selected, recallGraph, { message });
}
