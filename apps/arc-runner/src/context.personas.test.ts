import { describe, expect, it } from "vitest";

import { buildSystemPrompt, type ArcTurnContext } from "./context";

/**
 * The system prompt tells Arc "use these exact keys when mapping or filtering by
 * persona". That block read a hardcoded 12-key constant mirroring BSR's
 * taxonomy, so a law firm's Arc was INSTRUCTED to map its contacts onto
 * "Emergency Homeowner" and "Plumbing Partner".
 *
 * Personas have been per-org since migration 20260713120000 and the app has been
 * sending the org's own set on the wire the whole time — `fromAppContext` simply
 * flattened them away. This made the agent less tenant-aware than the humans
 * using the same app.
 */
const ctx = (personas: Array<{ key: string; label: string }>): ArcTurnContext => ({
  business: {
    businessName: "Halstead & Roe LLP",
    industry: "Legal services",
    brandVoice: "y",
    creativePolicy: "z",
    compliance: "c",
    personas,
  },
  mode: "ask",
  scope: { conversationId: "c1", projectId: null, campaignId: null, operator: "op" },
  mentions: [],
});

describe("persona taxonomy in the system prompt", () => {
  it("uses the workspace's own personas", () => {
    const prompt = buildSystemPrompt("base", ctx([
      { key: "persona_matter_lead", label: "Matter Lead" },
      { key: "persona_referring_counsel", label: "Referring Counsel" },
    ]));

    expect(prompt).toContain("persona_matter_lead — Matter Lead");
    expect(prompt).toContain("persona_referring_counsel — Referring Counsel");
  });

  it("does not leak another tenant's personas when the workspace has its own", () => {
    const prompt = buildSystemPrompt("base", ctx([{ key: "persona_matter_lead", label: "Matter Lead" }]));

    // The whole point: a law firm must never be told to use these.
    expect(prompt).not.toContain("persona_homeowner_emergency");
    expect(prompt).not.toContain("persona_plumbing_partner");
  });

  it("falls back to the demo taxonomy when none was supplied", () => {
    // A runner started without app context still needs SOME taxonomy — an empty
    // list would leave Arc free to invent keys, which is worse than a wrong one.
    const prompt = buildSystemPrompt("base", ctx([]));

    expect(prompt).toContain("PERSONA TAXONOMY");
    expect(prompt).toContain("persona_homeowner_emergency");
  });

  it("ignores blank or malformed entries rather than emitting empty keys", () => {
    const prompt = buildSystemPrompt("base", ctx([
      { key: "  ", label: "Blank" },
      { key: "persona_real", label: "Real" },
    ] as Array<{ key: string; label: string }>));

    expect(prompt).toContain("persona_real — Real");
    expect(prompt).not.toContain("-  — Blank");
  });
});
