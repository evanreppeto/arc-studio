import { describe, expect, it } from "vitest";

import { DEFAULT_PIPELINE_STAGES, PIPELINE_OBJECT_KEYS, type PipelineObjectKey } from "@/domain";

import { INDUSTRIES_WITH_STAGE_TEMPLATES, stagesForIndustry } from "./industry-templates";

/** Mirrors `pipeline_stages_key_format_check` in 20260729160000. */
const DB_KEY_FORMAT = /^[a-z][a-z0-9_]{0,62}$/;
/** Mirrors `pipeline_stages_label_length_check`. */
const DB_LABEL_MAX = 80;

const ALL_INDUSTRIES = [...INDUSTRIES_WITH_STAGE_TEMPLATES, "general", "not_a_real_industry", "", null] as const;

describe("stagesForIndustry", () => {
  it("covers every pipeline for every industry", () => {
    for (const industry of ALL_INDUSTRIES) {
      const stages = stagesForIndustry(industry);
      for (const key of PIPELINE_OBJECT_KEYS) {
        expect(stages[key].length, `${industry}/${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("falls back to the general set for an unknown or absent industry", () => {
    for (const industry of ["not_a_real_industry", "", null, undefined]) {
      expect(stagesForIndustry(industry), String(industry)).toEqual({
        leads: DEFAULT_PIPELINE_STAGES.leads,
        jobs: DEFAULT_PIPELINE_STAGES.jobs,
        outcomes: DEFAULT_PIPELINE_STAGES.outcomes,
      });
    }
  });

  // outcomes is the revenue ledger and means the same thing in every trade.
  // Varying it would fragment revenue reporting across tenants for no gain.
  it("never varies the outcomes ledger", () => {
    for (const industry of ALL_INDUSTRIES) {
      expect(stagesForIndustry(industry).outcomes, String(industry)).toEqual(DEFAULT_PIPELINE_STAGES.outcomes);
    }
  });

  it("actually differs from the general set where it claims to", () => {
    for (const industry of INDUSTRIES_WITH_STAGE_TEMPLATES) {
      const stages = stagesForIndustry(industry);
      const differs = (["leads", "jobs"] as PipelineObjectKey[]).some(
        (k) => JSON.stringify(stages[k]) !== JSON.stringify(DEFAULT_PIPELINE_STAGES[k]),
      );
      expect(differs, `${industry} is listed as having a template but matches the general set`).toBe(true);
    }
  });
});

describe("stage template invariants", () => {
  const cases = ALL_INDUSTRIES.flatMap((industry) =>
    PIPELINE_OBJECT_KEYS.map((objectKey) => ({
      name: `${industry || "(empty)"} / ${objectKey}`,
      stages: stagesForIndustry(industry)[objectKey],
    })),
  );

  // The invariant that costs real money if it breaks: reporting reads the FLAGS,
  // not the names. A pipeline with no isWon stage silently reports zero
  // conversion forever — no error, just wrong numbers.
  it.each(cases)("$name has a won and a lost terminal", ({ stages }) => {
    expect(stages.some((s) => s.isWon && s.isTerminal)).toBe(true);
    expect(stages.some((s) => s.isLost && s.isTerminal)).toBe(true);
  });

  it.each(cases)("$name never marks a stage both won and lost", ({ stages }) => {
    expect(stages.filter((s) => s.isWon && s.isLost)).toEqual([]);
  });

  it.each(cases)("$name keeps every won/lost stage terminal", ({ stages }) => {
    expect(stages.filter((s) => (s.isWon || s.isLost) && !s.isTerminal)).toEqual([]);
  });

  // These rows go straight into Postgres. A key or label the check constraints
  // refuse would fail at workspace creation, where a mocked test cannot see it.
  it.each(cases)("$name uses keys and labels Postgres will accept", ({ stages }) => {
    for (const s of stages) {
      expect(s.key, s.key).toMatch(DB_KEY_FORMAT);
      expect(s.label.trim().length).toBeGreaterThan(0);
      expect(s.label.length).toBeLessThanOrEqual(DB_LABEL_MAX);
    }
  });

  it.each(cases)("$name has unique keys and sort orders", ({ stages }) => {
    expect(new Set(stages.map((s) => s.key)).size).toBe(stages.length);
    expect(new Set(stages.map((s) => s.sortOrder)).size).toBe(stages.length);
  });

  it.each(cases)("$name starts every stage active", ({ stages }) => {
    expect(stages.every((s) => s.active)).toBe(true);
  });
});
