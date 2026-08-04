import { describe, expect, it } from "vitest";

import {
  addStage,
  archiveStage,
  DEFAULT_PIPELINE_STAGES,
  derivePipelineStageKey,
  findStage,
  isLostStatus,
  isQualifiedStatus,
  isTerminalStatus,
  isWonStatus,
  moveStage,
  orderedStages,
  statusAccent,
  statusTone,
  updateStage,
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

describe("display tone", () => {
  // NOTE the two different inputs. The heuristic reads the HUMAN LABEL, because
  // that is what the CRM row carries ("In Progress", not "in_progress") — its
  // patterns are spaced words and would miss every underscored key. The stage
  // lookup reads the KEY. Passing one where the other belongs silently drops a
  // status to the neutral tone, so the call sites pass both explicitly.
  const label = (key: string) => key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  it("keeps every default stage on the colour it has today", () => {
    // The acceptance criterion is that a workspace which never touches its
    // stages sees no change at all, so these are pinned to the pre-existing
    // mappings rather than to what the flags alone would suggest.
    const tone = (key: string, set = leads) => statusTone(label(key), findStage(set, key));
    expect(tone("new")).toBe("new");
    expect(tone("needs_review")).toBe("review");
    expect(tone("qualified")).toBe("qualified");
    expect(tone("converted")).toBe("won");
    expect(tone("lost")).toBe("lost");
    expect(tone("archived")).toBe("inactive");

    const jobs = DEFAULT_PIPELINE_STAGES.jobs;
    expect(tone("scheduled", jobs)).toBe("sched");
    expect(tone("in_progress", jobs)).toBe("active");
    expect(tone("completed", jobs)).toBe("won");
  });

  it("follows the meaning, not the name, once a tenant renames a stage", () => {
    // "Retained" matches none of the won regexes. The flag is what saves it.
    const renamed = leads.map((s) => (s.key === "converted" ? { ...s, label: "Retained" } : s));
    expect(statusTone("Retained", findStage(renamed, "converted"))).toBe("won");
    expect(statusAccent("Retained", findStage(renamed, "converted"))).toBe("green");
  });

  it("does not paint a closing-but-neutral stage as a loss", () => {
    const held: PipelineStage = {
      key: "on_hold", label: "On hold", sortOrder: 9,
      isTerminal: true, isWon: false, isLost: false, isQualified: false, active: true,
    };
    expect(statusTone("on_hold", held)).toBe("inactive");
  });

  it("carries non-pipeline statuses on the heuristic alone", () => {
    // Companies and contacts have no stages; passing null must still work.
    expect(statusTone("Do Not Contact")).toBe("dnc");
    // statusAccent matches on the raw key, which is what the read-model has here.
    expect(statusAccent("active")).toBe("green");
    expect(statusAccent("do_not_contact")).toBe("red");
  });

  it("reads the label for tone and the key for meaning", () => {
    // The trap: the heuristic's patterns are spaced words, so handing it a raw
    // key drops "in_progress" to neutral. Pinned so a future call site that
    // passes the wrong one fails here instead of quietly greying out a board.
    expect(statusTone("in_progress")).toBe("inactive");
    expect(statusTone("In Progress")).toBe("active");
  });

  it("keeps Scheduled blue even though it is a qualified stage", () => {
    // isQualified deliberately does not force green, or this repaints on ship.
    const jobs = DEFAULT_PIPELINE_STAGES.jobs;
    expect(findStage(jobs, "scheduled")?.isQualified).toBe(true);
    expect(statusAccent("scheduled", findStage(jobs, "scheduled"))).toBe("blue");
  });
});

describe("authoring transforms", () => {
  it("adds a stage with a derived key", () => {
    const result = addStage(leads, { label: "Conflicts check" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stages.find((s) => s.key === "conflicts_check")?.label).toBe("Conflicts check");
  });

  it("refuses a duplicate name", () => {
    const result = addStage(leads, { label: "Qualified" });
    expect(result).toEqual({ ok: false, error: '"Qualified" already uses that name.' });
  });

  it("revives an archived stage rather than inserting a second row", () => {
    // The archived key is still stored on every record that sat in it, so
    // reviving re-maps those records instead of stranding them behind a new row.
    const withArchived = leads.map((s) => (s.key === "validated" ? { ...s, active: false } : s));
    const result = addStage(withArchived, { label: "Validated" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stages.filter((s) => s.key === "validated")).toHaveLength(1);
    expect(findStage(result.stages, "validated")?.active).toBe(true);
  });

  it("renames without touching the stored key", () => {
    const result = updateStage(leads, "qualified", { label: "Engaged" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stage = findStage(result.stages, "qualified");
    expect(stage?.label).toBe("Engaged");
    // Records store the key, so they follow the rename for free.
    expect(isQualifiedStatus(result.stages, "qualified")).toBe(true);
  });

  it("refuses to archive the last won stage", () => {
    // The failure this whole feature has to prevent: revenue quietly reads zero.
    const outcomes = DEFAULT_PIPELINE_STAGES.outcomes;
    const noPaid = archiveStage(outcomes, "paid");
    expect(noPaid.ok).toBe(true);
    if (!noPaid.ok) return;
    const result = archiveStage(noPaid.stages, "won");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/won/i);
  });

  it("refuses to archive the last closing stage", () => {
    const minimal: PipelineStage[] = [
      { key: "open", label: "Open", sortOrder: 0, isTerminal: false, isWon: false, isLost: false, isQualified: false, active: true },
      { key: "done", label: "Done", sortOrder: 1, isTerminal: true, isWon: true, isLost: false, isQualified: true, active: true },
    ];
    expect(archiveStage(minimal, "done").ok).toBe(false);
  });

  it("refuses an outcome stage that is not terminal", () => {
    const result = updateStage(leads, "qualified", { isWon: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/terminal/i);
  });

  it("reorders and renumbers densely", () => {
    const result = moveStage(leads, "needs_review", "up");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(orderedStages(result.stages).map((s) => s.key).slice(0, 3)).toEqual([
      "new", "needs_review", "validated",
    ]);
    expect(orderedStages(result.stages).map((s) => s.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("is a no-op at the ends rather than an error", () => {
    const result = moveStage(leads, "new", "up");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(orderedStages(result.stages)[0].key).toBe("new");
  });

  it("closes the gap left by an archived stage so reorder stays adjacent", () => {
    const archived = archiveStage(leads, "validated");
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(orderedStages(archived.stages).map((s) => s.sortOrder)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
