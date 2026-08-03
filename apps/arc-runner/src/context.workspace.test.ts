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
  records: { contacts: 243, companies: 12, leads: 0, campaigns: 3 },
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

/**
 * BSR-678: Arc reported an empty CRM 85 minutes after 243 contacts were
 * imported, because this block — injected every turn — carried no record counts,
 * so the only figure in context was a remembered one.
 */
describe("record counts in the WORKSPACE STATE block", () => {
  const render = (records: WorkspaceSummary["records"]) =>
    buildSystemPrompt("BASE", { ...base, workspaceState: { ...summary, records } });

  it("puts the live counts in front of the model every turn", () => {
    const out = render({ contacts: 243, companies: 12, leads: 0, campaigns: 3 });
    expect(out).toContain("243 contacts");
    expect(out).toContain("12 companies");
    expect(out).toContain("3 campaigns");
  });

  it("states that the live counts beat a remembered figure", () => {
    // Without this the block is just more numbers; the failure was Arc
    // preferring memory, so the precedence has to be stated.
    expect(render(summary.records)).toContain("override any remembered figure");
  });

  it("reports an unreadable count as unknown, never as zero", () => {
    const out = render({ contacts: null, companies: 12, leads: null, campaigns: 3 });
    expect(out).toContain("unknown contacts");
    expect(out).toContain("unknown leads");
    expect(out).toContain("12 companies");
    expect(out).not.toContain("0 contacts");
  });

  it("keeps a real zero as zero", () => {
    // An empty CRM is a legitimate answer and must stay distinguishable from
    // an unreadable one.
    expect(render({ contacts: 0, companies: 0, leads: 0, campaigns: 0 })).toContain("0 contacts");
  });

  it("renders the rest of the block when an older app deploy omits records", () => {
    for (const missing of [undefined, null] as const) {
      const out = render(missing);
      expect(out).toContain("WORKSPACE STATE");
      expect(out).toContain("1 of 3 connected");
      expect(out).not.toContain("Records:");
    }
  });
});
