import { describe, expect, it } from "vitest";

import {
  DEFAULT_PIPELINE_STAGES,
  derivePipelineStageKey,
  findStage,
  isLostStatus,
  isQualifiedStatus,
  isTerminalStatus,
  isWonStatus,
  orderedStages,
  validateStageSet,
  type PipelineStage,
} from "../pipeline-stages";

const leads = DEFAULT_PIPELINE_STAGES.leads;

describe("semantic flags replace string matching", () => {
  it("recognises won without comparing to a literal", () => {
    // ~26 files currently test `=== "won"`. Renaming the stage must not break them.
    expect(isWonStatus(leads, "converted")).toBe(true);
    expect(isWonStatus(DEFAULT_PIPELINE_STAGES.outcomes, "paid")).toBe(true);
  });

  it("survives a tenant renaming the stage", () => {
    const renamed: PipelineStage[] = leads.map((s) =>
      s.key === "converted" ? { ...s, label: "Retained" } : s,
    );
    // The label changed; the meaning did not.
    expect(isWonStatus(renamed, "converted")).toBe(true);
  });

  it("never counts an unknown status as won", () => {
    // Guessing here would invent revenue — the one direction this must not fail.
    expect(isWonStatus(leads, "some_custom_stage")).toBe(false);
    expect(isWonStatus(leads, null)).toBe(false);
    expect(isWonStatus(leads, "")).toBe(false);
  });

  it("treats archived as terminal but neither won nor lost", () => {
    // Archiving is a filing action, not an outcome; counting it either way
    // would distort conversion rate.
    expect(isTerminalStatus(leads, "archived")).toBe(true);
    expect(isWonStatus(leads, "archived")).toBe(false);
    expect(isLostStatus(leads, "archived")).toBe(false);
  });

  it("marks lost and qualified correctly", () => {
    expect(isLostStatus(leads, "lost")).toBe(true);
    expect(isQualifiedStatus(leads, "qualified")).toBe(true);
    expect(isQualifiedStatus(leads, "new")).toBe(false);
  });

  it("returns null for an unmapped status rather than a default", () => {
    // A record whose status no longer maps needs fixing, not silent relabelling.
    expect(findStage(leads, "gone")).toBeNull();
  });
});

describe("defaults mirror today's enums", () => {
  it("covers every value of each Postgres enum", () => {
    expect(leads.map((s) => s.key)).toEqual([
      "new", "validated", "needs_review", "qualified", "converted", "lost", "archived",
    ]);
    expect(DEFAULT_PIPELINE_STAGES.jobs.map((s) => s.key)).toEqual([
      "pending", "scheduled", "in_progress", "completed", "canceled",
    ]);
    expect(DEFAULT_PIPELINE_STAGES.outcomes.map((s) => s.key)).toEqual([
      "pending", "won", "lost", "paid", "written_off",
    ]);
  });

  it("every default set is itself valid", () => {
    for (const key of Object.keys(DEFAULT_PIPELINE_STAGES) as Array<keyof typeof DEFAULT_PIPELINE_STAGES>) {
      expect(validateStageSet(DEFAULT_PIPELINE_STAGES[key]).ok).toBe(true);
    }
  });
});

describe("validateStageSet checks the SET, not each stage", () => {
  const base = leads.slice();

  it("rejects a pipeline with no won stage", () => {
    // Without one, every conversion and revenue metric silently reads zero.
    const noWon = base.map((s) => ({ ...s, isWon: false }));
    const result = validateStageSet(noWon);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/won/i);
  });

  it("rejects a pipeline with no closing stage", () => {
    const noTerminal = base.map((s) => ({ ...s, isTerminal: false, isWon: false, isLost: false }));
    expect(validateStageSet(noTerminal).ok).toBe(false);
  });

  it("rejects an outcome stage that is not terminal", () => {
    // Otherwise a record counts as revenue and then moves on — double-counted.
    const floating = base.map((s) => (s.key === "converted" ? { ...s, isTerminal: false } : s));
    const result = validateStageSet(floating);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/terminal/i);
  });

  it("rejects a stage that is both won and lost", () => {
    const both = base.map((s) => (s.key === "lost" ? { ...s, isWon: true } : s));
    expect(validateStageSet(both).ok).toBe(false);
  });

  it("rejects duplicate keys and empty pipelines", () => {
    expect(validateStageSet([...base, base[0]]).ok).toBe(false);
    expect(validateStageSet([]).ok).toBe(false);
  });

  it("ignores inactive stages when validating", () => {
    const archivedWon = base.map((s) => (s.isWon ? { ...s, active: false } : s));
    // The only won stage was deactivated, so the set no longer has one.
    expect(validateStageSet(archivedWon).ok).toBe(false);
  });
});

describe("orderedStages / derivePipelineStageKey", () => {
  it("orders by sortOrder and drops inactive", () => {
    const shuffled: PipelineStage[] = [
      { ...leads[2], sortOrder: 5 },
      { ...leads[0], sortOrder: 1 },
      { ...leads[1], sortOrder: 3, active: false },
    ];
    expect(orderedStages(shuffled).map((s) => s.key)).toEqual(["new", "needs_review"]);
  });

  it("slugifies an operator-typed stage name", () => {
    expect(derivePipelineStageKey("Conflicts check")).toBe("conflicts_check");
    expect(derivePipelineStageKey("2nd review")).toBe("s_2nd_review");
    expect(derivePipelineStageKey("###")).toBe("");
  });
});
