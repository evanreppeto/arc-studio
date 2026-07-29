import { describe, expect, it } from "vitest";
import { buildSystemPrompt, type ArcTurnContext } from "./context";
import type { WorkspaceSummary } from "./workspace-summary";

const base: ArcTurnContext = {
  business: {
    businessName: "Acme",
    industry: "x",
    brandVoice: "y",
    creativePolicy: "z",
    compliance: "c",
    personas: [],
  },
  mode: "ask",
  scope: { conversationId: "c1", projectId: null, campaignId: null, operator: "op" },
  mentions: [],
};

const summary: WorkspaceSummary = {
  brandKit: "draft",
  connectors: { connected: 1, total: 3 },
  mediaAvailable: 12,
  pendingApprovals: 2,
  personas: 5,
};

describe("WORKSPACE STATE block in buildSystemPrompt", () => {
  it("renders the snapshot when present", () => {
    const out = buildSystemPrompt("BASE", { ...base, workspaceState: summary });
    expect(out).toContain("WORKSPACE STATE");
    expect(out).toContain("1 of 3 connected");
    expect(out).toContain("Brand Kit in draft");
  });

  it("omits the block when absent or null", () => {
    expect(buildSystemPrompt("BASE", base)).not.toContain("WORKSPACE STATE");
    expect(buildSystemPrompt("BASE", { ...base, workspaceState: null })).not.toContain("WORKSPACE STATE");
  });
});
