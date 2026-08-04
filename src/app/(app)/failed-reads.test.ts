import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * A read that FAILED must not render as an empty workspace.
 *
 * This repo has fixed the same bug four times — BSR-544 (Arc chat), BSR-546
 * (naming "not configured" as an answer rather than an outage), BSR-563 (per
 * persona performance), BSR-578 (the brand kit) — and each fix left the
 * neighbouring read untouched.
 *
 * The two here were found together, and both are the pure form:
 *
 *   listOpenOpportunities  `if (error) return []`, so a broken query rendered an
 *                          empty inbox. That is the most load-bearing empty
 *                          state in the product: a quiet inbox is exactly what
 *                          a working Arc looks like on a slow week, so the
 *                          outage was indistinguishable from success.
 *
 *   listPersonas           a bare `catch { return [] }`, so a broken query
 *                          rendered "No personas yet — create your first
 *                          persona" to a workspace that may have twelve. The
 *                          SAME page already returned `failed` for its
 *                          performance numbers, for exactly this reason.
 *
 * Kept narrow deliberately. A repo-wide scan for `catch(() => [])` would flag
 * the many reads that are CORRECTLY silent — picker options, scan history, the
 * email connection — each already annotated as such. Pinning the two primary
 * reads that carry a page's central claim is the assertion worth making.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const OPPORTUNITIES = read("../../lib/opportunities/read-model.ts");
const PERSONAS = read("../../lib/personas/console.ts");
const OPP_INBOX = read("./opportunities/_components/opportunity-inbox.tsx");
const PERSONAS_VIEW = read("./personas/_components/personas-view.tsx");

describe("a failed read is distinguishable from an empty one", () => {
  it("opportunities reports the failure instead of returning a bare []", () => {
    expect(OPPORTUNITIES).toMatch(/export async function readOpenOpportunities/);
    expect(OPPORTUNITIES).toMatch(/reportDegraded\(error, \{ scope: "opportunities\.listOpenOpportunities"/);
    // The silent early-return is what this replaced; it must not come back.
    expect(OPPORTUNITIES, "an errored opportunity read must not return [] silently")
      .not.toMatch(/if \(error\) return \[\];/);
  });

  it("personas reports the failure instead of swallowing it in a bare catch", () => {
    expect(PERSONAS).toMatch(/export async function readPersonas/);
    expect(PERSONAS).toMatch(/reportDegraded\(error, \{ scope: "personas\.readPersonas"/);
    expect(PERSONAS, "a bare catch that returns [] hides an outage as an empty workspace")
      .not.toMatch(/\}\s*catch\s*\{\s*\n\s*return isDemoDataEnabled\(\) \? DEMO_PERSONAS : \[\];/);
  });

  it("both screens actually render the distinction", () => {
    // A read-model that reports a failure nobody displays is still silent.
    expect(OPP_INBOX).toMatch(/\{failed && \(/);
    expect(PERSONAS_VIEW).toMatch(/\{failed \? \(/);
  });

  /**
   * The onboarding copy is the specific harm on /personas: "create your first
   * persona" is a claim about the workspace, and a failed read must never make
   * it. It has to stay inside the not-failed branch.
   */
  it("never offers first-run onboarding copy on a failed persona read", () => {
    const emptyBranch = PERSONAS_VIEW.slice(PERSONAS_VIEW.indexOf("failed ? ("));
    const failedBranch = emptyBranch.slice(0, emptyBranch.indexOf(") : ("));
    expect(failedBranch).not.toMatch(/Create your first persona/);
    expect(failedBranch).not.toMatch(/No personas yet/);
  });
});
