import { describe, expect, it } from "vitest";

import { parseRecall } from "@/domain";

describe("parseRecall", () => {
  it("parses well-formed items", () => {
    const out = parseRecall([
      { label: "Landlord playbook", confidence: 0.9, kind: "note", nodeId: "n1" },
      { label: "Storm email won 31%", confidence: 0.7 },
    ]);
    expect(out).toEqual([
      { label: "Landlord playbook", confidence: 0.9, kind: "note", nodeId: "n1" },
      { label: "Storm email won 31%", confidence: 0.7 },
    ]);
  });

  it("drops items without a label and never throws", () => {
    expect(parseRecall([{ confidence: 0.5 }, "junk", null, 42])).toEqual([]);
  });

  it("clamps confidence to [0,1] and drops non-numeric", () => {
    expect(parseRecall([{ label: "A", confidence: 5 }])[0].confidence).toBe(1);
    expect(parseRecall([{ label: "B", confidence: -2 }])[0].confidence).toBe(0);
    expect(parseRecall([{ label: "C", confidence: "x" }])[0].confidence).toBeUndefined();
  });

  it("returns [] for non-arrays", () => {
    expect(parseRecall(undefined)).toEqual([]);
    expect(parseRecall({})).toEqual([]);
  });

  it("returns every item — no cap (BSR-624)", () => {
    // It used to stop at 8, a limit sized for the inline chip row. The parser is
    // shared, so the workspace panel inherited it and reported "8" for a turn
    // that recalled 15 — a cap presented as a count. If this ever goes back in,
    // this fails here rather than silently in the UI.
    const many = Array.from({ length: 40 }, (_, i) => ({ label: `n${i}` }));
    expect(parseRecall(many)).toHaveLength(40);

    // The shape prod actually stores, at the size prod actually sends.
    const prodShaped = Array.from({ length: 15 }, (_, i) => ({
      kind: "learning",
      label: `fact_${i}`,
      summary: `Fact number ${i}.`,
      confidence: 0.5,
      nodeId: `node-${i}`,
    }));
    expect(parseRecall(prodShaped)).toHaveLength(15);
  });
});
