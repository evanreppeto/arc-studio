import { describe, expect, it } from "vitest";

import { personaIntelligenceCoverage } from "../read-model";

// The harm this guards against is specific: Arc consumes this payload, and an
// empty array is indistinguishable from "we checked and there is nothing".
// persona_knowledge_entries and guardrail_rules have never been written by
// anything (BSR-671), so the response has to say which kind of empty it is.
describe("persona intelligence coverage", () => {
  it("reports not_recorded when nothing has been written", () => {
    const coverage = personaIntelligenceCoverage(0, 0);
    expect(coverage.knowledgeEntries).toBe("not_recorded");
    expect(coverage.guardrailRules).toBe("not_recorded");
    expect(coverage.note).toBeTruthy();
  });

  it("reports recorded — and drops the note — as soon as rows exist", () => {
    expect(personaIntelligenceCoverage(3, 0).knowledgeEntries).toBe("recorded");
    expect(personaIntelligenceCoverage(0, 2).guardrailRules).toBe("recorded");
    expect(personaIntelligenceCoverage(1, 1).note).toBeNull();
  });

  // Each table is reported on its own: one being populated must not imply the other.
  it("reports the two tables independently", () => {
    const coverage = personaIntelligenceCoverage(5, 0);
    expect(coverage.knowledgeEntries).toBe("recorded");
    expect(coverage.guardrailRules).toBe("not_recorded");
  });
});
