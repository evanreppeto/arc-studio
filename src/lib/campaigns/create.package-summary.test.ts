import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdminClient: vi.fn(() => ({ from: () => ({ update: () => ({ eq: () => ({ eq: async () => ({}) }) }) }) })),
}));

import { recordCampaignPackageSummary } from "./create";

/** Captures what reaches `.update()`, and the columns each `.eq()` scoped on. */
function spyClient() {
  const calls: { update?: Record<string, unknown>; eqs: Array<[string, unknown]> } = { eqs: [] };
  const chain = {
    eq(col: string, val: unknown) {
      calls.eqs.push([col, val]);
      return this;
    },
    then(resolve: (v: unknown) => void) {
      resolve({});
    },
  };
  const client = {
    from: () => ({
      update(payload: Record<string, unknown>) {
        calls.update = payload;
        return chain;
      },
    }),
  };
  return { client: client as never, calls };
}

const tenant = { org_id: "org-1", workspace_id: "ws-1" };

describe("recordCampaignPackageSummary", () => {
  it("writes both fields, normalized to the shape the read model parses", async () => {
    const { client, calls } = spyClient();
    await recordCampaignPackageSummary({
      campaignId: "camp_1",
      handoffNote: "  Call within 24h.  ",
      consideredAudiences: [{ label: "Property managers", reason: "No owned records", sizeEstimate: 120.4 }],
      client,
      tenant,
    });
    expect(calls.update).toEqual({
      handoff_note: "Call within 24h.",
      considered_audiences: [{ label: "Property managers", reason: "No owned records", sizeEstimate: 120 }],
    });
  });

  it("scopes the update to the campaign AND the org", async () => {
    const { client, calls } = spyClient();
    await recordCampaignPackageSummary({ campaignId: "camp_1", handoffNote: "x", client, tenant });
    expect(calls.eqs).toEqual([["id", "camp_1"], ["org_id", "org-1"]]);
  });

  it("does not write at all when neither field is supplied", async () => {
    const { client, calls } = spyClient();
    await recordCampaignPackageSummary({ campaignId: "camp_1", client, tenant });
    expect(calls.update).toBeUndefined();
  });

  it("is additive — an absent field never blanks what an earlier call recorded", async () => {
    // A package is built across several calls; the asset that carries the
    // audiences must not erase the handoff note written before it.
    const { client, calls } = spyClient();
    await recordCampaignPackageSummary({
      campaignId: "camp_1",
      consideredAudiences: [{ label: "Past clients", reason: "No history" }],
      client,
      tenant,
    });
    expect(calls.update).not.toHaveProperty("handoff_note");
  });

  it("drops entries with no reason rather than showing hollow diligence", async () => {
    const { client, calls } = spyClient();
    await recordCampaignPackageSummary({
      campaignId: "camp_1",
      consideredAudiences: [{ label: "Only a label" }, { label: "Real", reason: "Overlaps nurture" }],
      client,
      tenant,
    });
    expect(calls.update?.considered_audiences).toEqual([{ label: "Real", reason: "Overlaps nurture" }]);
  });

  it("never overwrites a real list with an empty one from malformed input", async () => {
    const { client, calls } = spyClient();
    await recordCampaignPackageSummary({ campaignId: "camp_1", consideredAudiences: "not an array", client, tenant });
    expect(calls.update).toBeUndefined();
  });

  it("treats a blank handoff note as nothing to write", async () => {
    const { client, calls } = spyClient();
    await recordCampaignPackageSummary({ campaignId: "camp_1", handoffNote: "   ", client, tenant });
    expect(calls.update).toBeUndefined();
  });
});
