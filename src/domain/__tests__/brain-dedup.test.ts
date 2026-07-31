import { describe, expect, it } from "vitest";

import {
  appendMergeRecord,
  decideBrainDedup,
  DEDUP_SIMILARITY_THRESHOLD,
  MAX_MERGE_RECORDS,
  type DedupCandidate,
} from "../brain-dedup";

const learning = (over: Partial<DedupCandidate> = {}): DedupCandidate => ({
  id: "node-1",
  kind: "learning",
  label: "crm_contacts_empty",
  summary: "The operator's CRM contains 0 contacts as of 2026-07-30.",
  similarity: 0.97,
  trustTier: "observed",
  ...over,
});

const incoming = { kind: "learning", label: "crm_status", summary: "CRM has 0 contacts as of 2026-07-30." };

describe("the same fact restated collapses into one node", () => {
  it("merges a near-identical restatement", () => {
    // The measured prod case: five keys, one fact.
    const decision = decideBrainDedup(incoming, [learning()]);
    expect(decision.action).toBe("merge");
    if (decision.action !== "merge") throw new Error("expected merge");
    expect(decision.into).toBe("node-1");
    expect(decision.reason).toContain("restates");
  });

  it("picks the nearest candidate when several qualify", () => {
    const decision = decideBrainDedup(incoming, [
      learning({ id: "near", similarity: 0.94 }),
      learning({ id: "nearest", similarity: 0.99 }),
      learning({ id: "alsonear", similarity: 0.95 }),
    ]);
    if (decision.action !== "merge") throw new Error("expected merge");
    expect(decision.into).toBe("nearest");
  });
});

describe("a false merge destroys a fact, so every rule is a veto", () => {
  it("inserts when nothing clears the threshold", () => {
    // 0.9 is a strong recall match and still nowhere near enough to merge.
    const decision = decideBrainDedup(incoming, [learning({ similarity: 0.9 })]);
    expect(decision.action).toBe("insert");
    expect(decision.reason).toContain("similarity");
  });

  it("uses a threshold far above the recall floor", () => {
    // Recall ranks on ~0.7 and a mediocre match merely sorts lower. Merging
    // cannot be that forgiving.
    expect(DEDUP_SIMILARITY_THRESHOLD).toBeGreaterThanOrEqual(0.9);
  });

  it("never merges across kinds, however similar the wording", () => {
    // A proof point and a learning can read almost identically and mean
    // different things to outbound copy.
    const decision = decideBrainDedup(incoming, [learning({ kind: "proof_point", similarity: 0.99 })]);
    expect(decision.action).toBe("insert");
  });

  it("never merges into an archived or rejected node", () => {
    // Merging into settled work would silently revive it.
    for (const trustTier of ["archived", "rejected"]) {
      expect(decideBrainDedup(incoming, [learning({ trustTier, similarity: 0.99 })]).action).toBe("insert");
    }
  });

  it("never merges a record-backed node by wording", () => {
    // Two contacts can have near-identical summaries and are not one fact.
    const decision = decideBrainDedup({ ...incoming, refId: "contact-1" }, [learning({ similarity: 0.999 })]);
    expect(decision.action).toBe("insert");
    expect(decision.reason).toContain("reference");
  });

  it("inserts when a candidate carries no similarity at all", () => {
    // An unscored candidate means embeddings were unavailable. Absence of a
    // score is not evidence of a match.
    const decision = decideBrainDedup(incoming, [learning({ similarity: undefined })]);
    expect(decision.action).toBe("insert");
  });

  it("inserts when there are no candidates", () => {
    expect(decideBrainDedup(incoming, []).action).toBe("insert");
  });
});

describe("a merge is recoverable, never a deletion", () => {
  const record = { label: "crm_status", summary: "CRM has 0 contacts.", similarity: 0.97, at: "2026-07-31T00:00:00Z" };

  it("retains the wording that was merged away", () => {
    // The acceptance criterion: a superseded fact must be recoverable. A merge
    // that dropped the loser's text would fail it.
    const props = appendMergeRecord(undefined, record);
    expect(props).toHaveLength(1);
    expect(props[0]?.summary).toBe("CRM has 0 contacts.");
  });

  it("accumulates every restatement", () => {
    const first = appendMergeRecord(undefined, record);
    const second = appendMergeRecord(first, { ...record, label: "CRM state" });
    expect(second.map((r) => r.label)).toEqual(["crm_status", "CRM state"]);
  });

  it("caps history so a hot fact cannot grow its row without bound", () => {
    let props = appendMergeRecord(undefined, record);
    for (let i = 0; i < MAX_MERGE_RECORDS + 5; i += 1) {
      props = appendMergeRecord(props, { ...record, label: `restatement-${i}` });
    }
    expect(props).toHaveLength(MAX_MERGE_RECORDS);
    // The most recent are kept — the oldest wording is the least useful.
    expect(props.at(-1)?.label).toBe(`restatement-${MAX_MERGE_RECORDS + 4}`);
  });

  it("ignores junk already sitting in props rather than throwing", () => {
    expect(appendMergeRecord("not an array", record)).toHaveLength(1);
    expect(appendMergeRecord([{ nonsense: true }, null], record)).toHaveLength(1);
  });
});
