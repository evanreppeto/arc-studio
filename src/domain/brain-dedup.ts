/**
 * Stop the Brain remembering the same fact five times (BSR-531).
 *
 * Chat → fact promotion fires every turn, so the Brain grows continuously.
 * Keyed upsert handles a fact restated under the SAME key. It does nothing for
 * the same fact restated in different words, which is what actually happens.
 *
 * Measured on prod 2026-07-31 — one turn recalled 15 facts, and five of them
 * were one fact:
 *
 *   crm_contacts_empty · crm_contact_count · CRM state · crm-empty-state · crm_status
 *
 *   "The operator's CRM contains 0 contacts as of 2026-07-30."
 *   "CRM has 0 contacts as of 2026-07-30."
 *   "The CRM is empty: 0 leads/opportunities, 0 companies, 0 contacts."
 *
 * Roughly half of what Arc "remembered" about that workspace was three facts,
 * restated. Duplicates crowd out distinct facts in a bounded recall window, so
 * this degrades the answer, not just the row count.
 *
 * ── Why this is deliberately hard to trigger ─────────────────────────────────
 * A false merge DESTROYS a distinct fact, and a Brain that quietly loses facts
 * is worse than one that repeats them. So every rule here is a veto, the
 * threshold is far above the recall floor (~0.7), and anything uncertain
 * inserts. Being too shy costs a duplicate; being too eager costs knowledge.
 */

export type DedupCandidate = {
  id: string;
  kind: string;
  label: string;
  summary?: string | null;
  /** Cosine similarity, 1 = identical direction. Absent when not scored. */
  similarity?: number;
  trustTier: string;
};

export type DedupIncoming = {
  kind: string;
  label: string;
  summary?: string | null;
  /** Set for CRM mirror nodes, which are keyed and handled by upsert instead. */
  refId?: string | null;
};

export type DedupDecision =
  | { action: "insert"; reason: string }
  | { action: "merge"; into: string; similarity: number; reason: string };

/**
 * Well above the ~0.7 floor recall uses. Recall ranking is forgiving — a
 * mediocre match just sorts lower. Merging is not: it is the one operation here
 * that can lose a fact, so it demands near-identity.
 */
export const DEDUP_SIMILARITY_THRESHOLD = 0.93;

/** Tiers a node must not be merged into — reviving settled work by accident. */
const CLOSED_TIERS = new Set(["archived", "rejected"]);

export function decideBrainDedup(
  incoming: DedupIncoming,
  candidates: DedupCandidate[],
  threshold: number = DEDUP_SIMILARITY_THRESHOLD,
): DedupDecision {
  // A record mirror is identified by what it points AT, not by how it reads.
  // Two contacts can have near-identical summaries and are not the same fact.
  if (incoming.refId) return { action: "insert", reason: "record-backed nodes are deduped by reference, not by wording" };

  const eligible = candidates.filter((candidate) => {
    if (candidate.kind !== incoming.kind) return false; // a proof point is not a learning
    if (CLOSED_TIERS.has(candidate.trustTier)) return false;
    return typeof candidate.similarity === "number" && candidate.similarity >= threshold;
  });

  if (!eligible.length) {
    return { action: "insert", reason: `no candidate at or above ${threshold} similarity of the same kind` };
  }

  const best = eligible.reduce((a, b) => ((b.similarity ?? 0) > (a.similarity ?? 0) ? b : a));
  return {
    action: "merge",
    into: best.id,
    similarity: best.similarity ?? 0,
    reason: `restates "${best.label}" at ${(best.similarity ?? 0).toFixed(3)} similarity`,
  };
}

/**
 * The record kept on the surviving node when a restatement is merged into it.
 *
 * Nothing is deleted: the alternate wording is retained here so a merge is
 * recoverable and auditable. "A superseded fact is recoverable, never silently
 * destroyed" is an acceptance criterion, and a merge that dropped the loser's
 * text on the floor would fail it.
 */
export type BrainMergeRecord = {
  label: string;
  summary?: string | null;
  key?: string | null;
  similarity: number;
  at: string;
  source?: string | null;
};

/** Cap the retained history so a hot fact cannot grow its row without bound. */
export const MAX_MERGE_RECORDS = 20;

export function appendMergeRecord(existing: unknown, record: BrainMergeRecord): BrainMergeRecord[] {
  const prior = Array.isArray(existing) ? (existing as BrainMergeRecord[]).filter(isMergeRecord) : [];
  return [...prior, record].slice(-MAX_MERGE_RECORDS);
}

function isMergeRecord(value: unknown): value is BrainMergeRecord {
  return Boolean(value) && typeof value === "object" && typeof (value as BrainMergeRecord).label === "string";
}
