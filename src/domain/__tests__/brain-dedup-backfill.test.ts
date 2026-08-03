import { describe, expect, it } from "vitest";

import { cosineSimilarity, planBrainFolds, type BackfillNode } from "../brain-dedup-backfill";

/** A unit vector at `angle` radians in the first two dimensions. */
function vec(angle: number): number[] {
  return [Math.cos(angle), Math.sin(angle), 0];
}

function node(over: Partial<BackfillNode> & Pick<BackfillNode, "id">): BackfillNode {
  return {
    kind: "learning",
    label: over.id,
    trustTier: "observed",
    createdAt: "2026-07-30T00:00:00.000Z",
    embedding: vec(0),
    ...over,
  };
}

describe("cosineSimilarity", () => {
  it("scores identical direction as 1 regardless of magnitude", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 10);
    // Unnormalized vectors must still score 1 — the reason this is a full
    // cosine and not a bare dot product.
    expect(cosineSimilarity([3, 0], [9, 0])).toBeCloseTo(1, 10);
  });

  it("refuses to score what it cannot compare", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBeNull();
    expect(cosineSimilarity([], [])).toBeNull();
    expect(cosineSimilarity([0, 0], [1, 0])).toBeNull();
  });
});

describe("planBrainFolds", () => {
  it("folds a restatement into the node that said it first", () => {
    const plan = planBrainFolds([
      node({ id: "first", label: "crm_contacts_empty", createdAt: "2026-07-30T10:00:00.000Z" }),
      node({ id: "restated", label: "crm-empty-state", createdAt: "2026-07-30T11:00:00.000Z" }),
    ]);

    expect(plan.folds).toHaveLength(1);
    expect(plan.folds[0]).toMatchObject({ loserId: "restated", winnerId: "first" });
    expect(plan.survivorIds).toEqual(["first"]);
  });

  it("collapses a whole cluster into one survivor", () => {
    const plan = planBrainFolds(
      ["a", "b", "c", "d", "e"].map((id, i) =>
        node({ id, createdAt: `2026-07-30T1${i}:00:00.000Z` }),
      ),
    );
    expect(plan.survivorIds).toEqual(["a"]);
    expect(plan.folds.map((f) => f.loserId)).toEqual(["b", "c", "d", "e"]);
  });

  it("keeps distinct facts apart", () => {
    // ~66 degrees apart — far below the 0.93 threshold.
    const plan = planBrainFolds([
      node({ id: "personas", embedding: vec(0), createdAt: "2026-07-30T10:00:00.000Z" }),
      node({ id: "connectors", embedding: vec(1.16), createdAt: "2026-07-30T11:00:00.000Z" }),
    ]);
    expect(plan.folds).toEqual([]);
    expect(plan.survivorIds).toEqual(["personas", "connectors"]);
  });

  it("never folds across kinds — a proof point is not a learning", () => {
    const plan = planBrainFolds([
      node({ id: "learning", kind: "learning" }),
      node({ id: "proof", kind: "proof_point", createdAt: "2026-07-30T11:00:00.000Z" }),
    ]);
    expect(plan.folds).toEqual([]);
  });

  it("never folds a record-backed node, however alike it reads", () => {
    // Two CRM mirrors with byte-identical wording are still two records.
    const plan = planBrainFolds([
      node({ id: "lead-1", kind: "crm_lead", label: "Lead: csv", refId: "11111111-1111-1111-1111-111111111111" }),
      node({ id: "lead-2", kind: "crm_lead", label: "Lead: csv", refId: "22222222-2222-2222-2222-222222222222", createdAt: "2026-07-30T11:00:00.000Z" }),
    ]);
    expect(plan.folds).toEqual([]);
    expect(plan.survivorIds).toEqual(["lead-1", "lead-2"]);
  });

  it("never merges into an archived or rejected node", () => {
    const plan = planBrainFolds([
      node({ id: "archived", trustTier: "archived" }),
      node({ id: "live", createdAt: "2026-07-30T11:00:00.000Z" }),
    ]);
    expect(plan.folds).toEqual([]);
    expect(plan.survivorIds).toContain("live");
  });

  it("lets a node with no readable embedding survive rather than guessing", () => {
    const plan = planBrainFolds([
      node({ id: "scored" }),
      node({ id: "unscored", embedding: null, createdAt: "2026-07-30T11:00:00.000Z" }),
    ]);
    expect(plan.folds).toEqual([]);
    expect(plan.survivorIds).toEqual(["scored", "unscored"]);
  });

  it("is deterministic — a dry run predicts the apply", () => {
    const nodes = ["x", "y", "z"].map((id, i) => node({ id, createdAt: `2026-07-30T1${i}:00:00.000Z` }));
    expect(planBrainFolds([...nodes].reverse())).toEqual(planBrainFolds(nodes));
  });

  it("honours a caller-supplied threshold", () => {
    const nodes = [node({ id: "a", embedding: vec(0) }), node({ id: "b", embedding: vec(0.3), createdAt: "2026-07-30T11:00:00.000Z" })];
    // ~0.955 apart: folds at the shipped 0.93, survives at a stricter 0.99.
    expect(planBrainFolds(nodes).folds).toHaveLength(1);
    expect(planBrainFolds(nodes, { threshold: 0.99 }).folds).toHaveLength(0);
  });

  it("returns an empty plan for an empty Brain", () => {
    expect(planBrainFolds([])).toEqual({ folds: [], survivorIds: [] });
  });

  it("accepts scores from elsewhere, so a large Brain need not ship its vectors", () => {
    // No embeddings at all — similarity comes from pgvector server-side.
    const nodes = [
      node({ id: "a", embedding: null, createdAt: "2026-07-30T10:00:00.000Z" }),
      node({ id: "b", embedding: null, createdAt: "2026-07-30T11:00:00.000Z" }),
    ];
    const scored = new Map([["a|b", 0.98]]);
    const plan = planBrainFolds(nodes, {
      similarity: (x, y) => scored.get(`${x.id}|${y.id}`) ?? scored.get(`${y.id}|${x.id}`) ?? null,
    });
    expect(plan.folds).toHaveLength(1);
    expect(plan.folds[0]).toMatchObject({ loserId: "b", winnerId: "a" });
  });

  it("treats an unscorable pair as no match, never as a match", () => {
    const nodes = [
      node({ id: "a", embedding: null, createdAt: "2026-07-30T10:00:00.000Z" }),
      node({ id: "b", embedding: null, createdAt: "2026-07-30T11:00:00.000Z" }),
    ];
    expect(planBrainFolds(nodes, { similarity: () => null }).folds).toEqual([]);
  });
});
