import { describe, expect, it } from "vitest";

import {
  GOLDEN_QUESTIONS,
  gradeGoldenAnswer,
  selfAnsweringFacts,
  summarizeGoldenRun,
  type GoldenQuestion,
} from "../arc-eval";

const partners: GoldenQuestion = {
  id: "crm-partners",
  capability: "crm",
  question: "List the plumbing partner companies in our CRM by name.",
  facts: ["Rapid Response Plumbing", "Lakeside Mechanical", "Halsted Drain & Sewer"],
  minHits: 2,
  why: "test fixture",
};

const exact: GoldenQuestion = {
  id: "brain-reviews",
  capability: "brain",
  question: "What is our aggregate customer rating, and across how many reviews?",
  facts: ["4.9", "380"],
  minHits: 2,
  requireAll: ["4.9", "380"],
  why: "test fixture",
};

describe("the suite catches a broken retrieval path", () => {
  it("fails an answer that says it could not retrieve, even when it names a partner", () => {
    // The case that matters most. A reply can name something from context or
    // memory while the retrieval underneath returned nothing — grading it on
    // hits alone would score that as a partial success.
    const grade = gradeGoldenAnswer(
      partners,
      "I don't have access to the CRM right now, though Rapid Response Plumbing and Lakeside Mechanical are partners.",
    );
    expect(grade.passed).toBe(false);
    expect(grade.failure).toContain("lacks access");
  });

  it("fails on the tool-expectation guard's own failure text (BSR-508)", () => {
    // When a tool breaches its contract it now says so in the result. That text
    // reaching the user IS the break this suite must catch.
    const grade = gradeGoldenAnswer(partners, "RETRIEVAL FAILED — Searching CRM companies did not return usable data.");
    expect(grade.passed).toBe(false);
    expect(grade.failure).toContain("BSR-508");
  });

  it("fails an empty answer rather than treating it as no facts required", () => {
    expect(gradeGoldenAnswer(partners, "").passed).toBe(false);
    expect(gradeGoldenAnswer(partners, "   ").failure).toContain("empty");
  });

  it("fails a fluent answer that retrieved nothing", () => {
    const grade = gradeGoldenAnswer(
      partners,
      "You don't appear to have any plumbing partners in the CRM yet. Would you like me to add some?",
    );
    expect(grade.passed).toBe(false);
    expect(grade.failure).toContain("expected at least 2");
    expect(grade.hits).toEqual([]);
  });

  it("fails when only one of the two required numbers is present", () => {
    // A plausible-but-invented figure. Requiring both is what makes this bite.
    const grade = gradeGoldenAnswer(exact, "We hold a 4.9 star rating from our customers.");
    expect(grade.passed).toBe(false);
    expect(grade.failure).toContain("missing required fact");
    expect(grade.failure).toContain("380");
  });
});

describe("a correct answer passes regardless of phrasing", () => {
  it("accepts the facts in any wording, case, or order", () => {
    // Grading is for factual correctness, not prose. Phrasing is not what breaks.
    const grade = gradeGoldenAnswer(
      partners,
      "Sure — among others you work with LAKESIDE MECHANICAL and\n  rapid   response   plumbing.",
    );
    expect(grade.passed).toBe(true);
    expect(grade.hits).toHaveLength(2);
  });

  it("keeps punctuation that is load-bearing", () => {
    // "Halsted Drain & Sewer" must not match "Halsted Drain and Sewer" by
    // accident of over-normalizing — and 4.9 must not match 49.
    const grade = gradeGoldenAnswer(exact, "The rating is 49 across 380 reviews.");
    expect(grade.passed).toBe(false);
  });

  it("reports which facts were matched and which were not", () => {
    const grade = gradeGoldenAnswer(partners, "Rapid Response Plumbing and Halsted Drain & Sewer.");
    expect(grade.hits).toEqual(["Rapid Response Plumbing", "Halsted Drain & Sewer"]);
    expect(grade.missing).toEqual(["Lakeside Mechanical"]);
  });
});

describe("a question must never contain its own answer", () => {
  it("detects a self-answering question", () => {
    // Otherwise a model that retrieved nothing passes by echoing the prompt.
    const bad: GoldenQuestion = { ...partners, question: "Is Lakeside Mechanical one of our partners?" };
    expect(selfAnsweringFacts(bad)).toEqual(["Lakeside Mechanical"]);
  });

  it("holds for every question actually in the suite", () => {
    // The property that makes the whole suite meaningful, enforced rather than
    // trusted to whoever adds the next question.
    for (const question of GOLDEN_QUESTIONS) {
      expect(selfAnsweringFacts(question), `${question.id} gives away its own answer`).toEqual([]);
    }
  });
});

describe("the shipped question set", () => {
  it("covers the capabilities that break", () => {
    const covered = new Set(GOLDEN_QUESTIONS.map((q) => q.capability));
    expect(covered).toContain("crm");
    expect(covered).toContain("brain");
    expect(covered).toContain("multi-hop");
  });

  it("gives every question a unique id, since results are reported per question", () => {
    const ids = GOLDEN_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never sets minHits to zero, which would pass on any answer at all", () => {
    for (const question of GOLDEN_QUESTIONS) {
      expect(question.minHits, question.id).toBeGreaterThan(0);
      expect(question.minHits, question.id).toBeLessThanOrEqual(question.facts.length);
    }
  });

  it("explains why each question earns its place", () => {
    for (const question of GOLDEN_QUESTIONS) {
      expect(question.why.length, question.id).toBeGreaterThan(20);
    }
  });
});

describe("reporting is per question", () => {
  it("names which capability degraded rather than only a total", () => {
    // "3 of 6 failed" hides WHERE, and slow degradation in one area is exactly
    // what this suite exists to make visible.
    const summary = summarizeGoldenRun([
      gradeGoldenAnswer(partners, "Rapid Response Plumbing, Lakeside Mechanical"),
      gradeGoldenAnswer(exact, "no idea"),
    ]);
    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.ok).toBe(false);
    expect(summary.lines[0]).toContain("PASS  crm-partners (crm)");
    expect(summary.lines[1]).toContain("FAIL  brain-reviews (brain)");
  });

  it("is ok only when every question passed", () => {
    const summary = summarizeGoldenRun([gradeGoldenAnswer(partners, "Rapid Response Plumbing, Lakeside Mechanical")]);
    expect(summary.ok).toBe(true);
  });
});
