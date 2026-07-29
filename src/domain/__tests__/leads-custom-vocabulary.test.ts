import { describe, expect, it } from "vitest";

import { LeadRowSchema } from "../leads";

/**
 * `LeadSchema.parse(row)` runs on EVERY lead read from the database
 * (src/lib/repos/leads.ts, four call sites). While `status` and `persona` were
 * `z.enum(...)` of BSR's values, a tenant using its own vocabulary would throw
 * here — taking down their entire lead list rather than degrading.
 *
 * That made the per-org taxonomies useless in the one place it mattered: the
 * persona enum had already been per-org since 20260713120000, and this schema
 * would still have rejected a custom persona on read.
 */
const row = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  company_id: null,
  contact_id: null,
  property_id: null,
  persona: "persona_property_manager",
  status: "qualified",
  routing_recommendation: "target",
  source: "operator",
  external_lead_id: null,
  loss_summary: null,
  loss_signals: [],
  matched_target_keywords: [],
  matched_non_target_keywords: [],
  lead_score: 71,
  received_at: "2026-07-29T12:00:00.000Z",
  metadata: {},
  created_at: "2026-07-29T12:00:00.000Z",
  updated_at: "2026-07-29T12:00:00.000Z",
  ...over,
});

describe("a lead row accepts the tenant's own vocabulary", () => {
  it("parses a custom pipeline stage", () => {
    // A law firm's pipeline: Intake -> Conflicts check -> Engaged -> Closed.
    const result = LeadRowSchema.safeParse(row({ status: "conflicts_check" }));
    expect(result.success).toBe(true);
  });

  it("parses a custom persona", () => {
    const result = LeadRowSchema.safeParse(row({ persona: "persona_referring_counsel" }));
    expect(result.success).toBe(true);
  });

  it("still parses the built-in values", () => {
    expect(LeadRowSchema.safeParse(row()).success).toBe(true);
    expect(LeadRowSchema.safeParse(row({ status: "converted" })).success).toBe(true);
  });

  it("still rejects an empty or blank status", () => {
    // Permissive is not absent: "" satisfies NOT NULL, matches no stage, and
    // would render as nothing while being invisible to every filter. The DB
    // carries the same guard (leads_status_not_blank_check).
    expect(LeadRowSchema.safeParse(row({ status: "" })).success).toBe(false);
    expect(LeadRowSchema.safeParse(row({ status: "   " })).success).toBe(false);
  });

  it("still rejects an empty persona", () => {
    expect(LeadRowSchema.safeParse(row({ persona: "" })).success).toBe(false);
  });
});
