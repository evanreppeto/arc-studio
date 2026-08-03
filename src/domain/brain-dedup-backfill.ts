/**
 * Plan the fold of restatements ALREADY stored in the Brain (BSR-531 backfill).
 *
 * Semantic dedup runs on the write path, so it only ever saw facts learned after
 * it shipped. Everything stored before that is untouched — measured on the live
 * org, 29 of 51 nodes carried a near-twin at >= 0.93. Recall is a bounded window,
 * so those duplicates crowd out distinct facts and degrade the answer.
 *
 * Pure: the decision of WHAT to fold is made here and unit-tested; the script
 * that owns the I/O only applies it. The per-node call is delegated to
 * decideBrainDedup so the backfill and the live write path can never drift on
 * threshold or veto rules.
 */
import { decideBrainDedup, DEDUP_SIMILARITY_THRESHOLD, type DedupCandidate } from "./brain-dedup";

/** The subset of a stored node the plan needs. `embedding` null = unreadable vector. */
export type BackfillNode = {
  id: string;
  kind: string;
  label: string;
  summary?: string | null;
  trustTier: string;
  /** Set for record mirrors, which are deduped by reference rather than wording. */
  refId?: string | null;
  createdAt: string;
  /** Present when the caller loads vectors client-side; omitted when similarity is injected. */
  embedding?: number[] | null;
};

export type PlannedFold = {
  loserId: string;
  winnerId: string;
  loserLabel: string;
  winnerLabel: string;
  similarity: number;
};

export type FoldPlan = {
  folds: PlannedFold[];
  /** Node ids that survive, in the order they were kept. */
  survivorIds: string[];
};

/**
 * Cosine similarity, or null when it cannot be scored.
 *
 * The write path reads this from pgvector's `<=>` as `1 - distance`. Computing
 * the full normalized form here rather than a bare dot product keeps the two
 * comparable without assuming stored vectors are unit length.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA <= 0 || normB <= 0) return null;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * How to score two nodes. Null means "not comparable", which is never a match.
 *
 * Injected rather than fixed so the caller chooses where the work happens: a
 * small Brain can compare the vectors it already loaded, while a large one can
 * hand in pairs pgvector scored server-side instead of pulling every embedding
 * over the wire.
 */
export type SimilarityFn = (a: BackfillNode, b: BackfillNode) => number | null;

/** Default: compare the embeddings carried on the nodes themselves. */
export const embeddingSimilarity: SimilarityFn = (a, b) =>
  a.embedding?.length && b.embedding?.length ? cosineSimilarity(a.embedding, b.embedding) : null;

export type PlanOptions = { threshold?: number; similarity?: SimilarityFn };

/**
 * Which nodes fold into which.
 *
 * Oldest wins: later restatements are absorbed by the node that first held the
 * fact, matching the direction the write path already takes. Ordering is by
 * createdAt then id, so the plan is deterministic and a dry run predicts the
 * apply exactly.
 *
 * A node that cannot be scored always survives on its own — an unscored
 * candidate is never treated as a match, the same rule the write path applies.
 */
export function planBrainFolds(nodes: readonly BackfillNode[], options: PlanOptions = {}): FoldPlan {
  const threshold = options.threshold ?? DEDUP_SIMILARITY_THRESHOLD;
  const similarityOf = options.similarity ?? embeddingSimilarity;
  const ordered = [...nodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const survivors: BackfillNode[] = [];
  const folds: PlannedFold[] = [];

  for (const node of ordered) {
    const candidates: DedupCandidate[] = [];
    for (const survivor of survivors) {
      const similarity = similarityOf(node, survivor);
      candidates.push({
        id: survivor.id,
        kind: survivor.kind,
        label: survivor.label,
        summary: survivor.summary,
        trustTier: survivor.trustTier,
        ...(similarity === null ? {} : { similarity }),
      });
    }

    const decision = decideBrainDedup(
      { kind: node.kind, label: node.label, summary: node.summary, refId: node.refId },
      candidates,
      threshold,
    );

    if (decision.action === "merge") {
      const winner = survivors.find((s) => s.id === decision.into);
      if (winner) {
        folds.push({
          loserId: node.id,
          winnerId: winner.id,
          loserLabel: node.label,
          winnerLabel: winner.label,
          similarity: decision.similarity,
        });
        continue;
      }
    }
    survivors.push(node);
  }

  return { folds, survivorIds: survivors.map((s) => s.id) };
}
