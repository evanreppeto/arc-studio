import { describe, expect, it } from "vitest";

import { isLeadIn } from "./arc";

/**
 * The regression this guards, seen on prod: withholding every pre-tool chunk
 * from the reply left a 143-character answer — "All three reads are done —
 * nothing changed. Summary above" — while the summary itself sat in the trace.
 * Arc reports as it goes, so the chunks between tool calls carry findings.
 */
describe("isLeadIn", () => {
  it("treats a short announcement as a lead-in", () => {
    expect(isLeadIn("I'll check these one at a time. First up: CRM contacts — let me pull the live list.")).toBe(true);
  });

  it("does not treat a finding as a lead-in, however short", () => {
    // Bolded label, and it is reporting a result rather than announcing a step.
    expect(isLeadIn("**CRM contacts: confirmed empty.** search_contacts returns total: 0 — no contacts.\n\nNext I'll look at campaigns.")).toBe(false);
  });

  it("keeps anything with structure in the reply", () => {
    expect(isLeadIn("Findings:\n- Leads: 0\n- Companies: 0")).toBe(false);
    expect(isLeadIn("## Summary")).toBe(false);
    expect(isLeadIn("1. First finding")).toBe(false);
    expect(isLeadIn("> quoted result")).toBe(false);
  });

  it("keeps a long passage in the reply even without structure", () => {
    expect(isLeadIn("x".repeat(201))).toBe(false);
    expect(isLeadIn("x".repeat(199))).toBe(true);
  });

  it("is not fooled by whitespace", () => {
    expect(isLeadIn("   ")).toBe(false);
    expect(isLeadIn("")).toBe(false);
  });
});
