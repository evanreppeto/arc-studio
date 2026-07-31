import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/observability/report-degraded", () => ({ reportDegraded: vi.fn() }));

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";
import { reportDegraded } from "@/lib/observability/report-degraded";

import { listNodes, listProposed, brainSummary, getBrainCrmCoverage, sanitizeBrainSearch, nodeMatchesSearch } from "./read-model";

const reported = vi.mocked(reportDegraded);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const NODES = [
  { id: "n-1", kind: "brand_fact", label: "We answer 24/7", trust_tier: "trusted", persona: null },
  { id: "n-2", kind: "brand_fact", label: "Mold draft", trust_tier: "proposed", persona: null },
  { id: "n-3", kind: "learning", label: "SMS wins", trust_tier: "observed", persona: "persona_homeowner_emergency" },
];

describe("listNodes", () => {
  it("returns mapped nodes when live", async () => {
    const supabase = createSupabaseQueryMock({ knowledge_nodes: { data: NODES, error: null } });
    const result = await listNodes({}, supabase as never, "org-1");
    expect(result.status).toBe("live");
    if (result.status !== "live") throw new Error("expected live");
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[0]).toMatchObject({ id: "n-1", kind: "brand_fact" });
  });

  it("reports unavailable on a Supabase error", async () => {
    const supabase = createSupabaseQueryMock({ knowledge_nodes: { data: null, error: { message: "boom" } } });
    const result = await listNodes({}, supabase as never, "org-1");
    expect(result.status).toBe("unavailable");
  });

  it("does not fail silently — it reports, naming the org it queried (BSR-547)", async () => {
    // This path RETURNS `unavailable` rather than throwing, so the page's
    // `.catch(unavailable(...))` never sees it. Before BSR-547 that meant 20 of
    // 22 Brain failure returns produced no log, no Sentry event and no org at
    // all: an empty screen and total silence.
    const supabase = createSupabaseQueryMock({
      knowledge_nodes: { data: null, error: { message: "column does not exist", code: "42703" } },
    });
    const result = await listNodes({}, supabase as never, "org-1");

    expect(result.status).toBe("unavailable");
    expect(reported).toHaveBeenCalledTimes(1);
    expect(reported.mock.calls[0]?.[1]).toMatchObject({
      scope: "knowledge-graph.listNodes",
      surface: "primary",
      detail: expect.objectContaining({ orgId: "org-1", code: "42703" }),
    });
  });

  it("stays quiet when the read succeeds", async () => {
    // A report on a healthy read would make the signal worthless.
    const supabase = createSupabaseQueryMock({ knowledge_nodes: { data: NODES, error: null } });
    await listNodes({}, supabase as never, "org-1");
    expect(reported).not.toHaveBeenCalled();
  });

  it("can suppress the empty-brain demo fallback", async () => {
    const supabase = createSupabaseQueryMock({ knowledge_nodes: { data: [], error: null } });
    const result = await listNodes({}, supabase as never, "org-1", { demoFallback: false });
    expect(result.status).toBe("live");
    if (result.status !== "live") throw new Error("expected live");
    expect(result.nodes).toEqual([]);
  });

  it("serves an empty brain for an empty workspace when demo data is disabled (the default)", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "");
    const supabase = createSupabaseQueryMock({ knowledge_nodes: { data: [], error: null } });
    const result = await listNodes({}, supabase as never, "org-1");
    expect(result.status).toBe("live");
    if (result.status !== "live") throw new Error("expected live");
    expect(result.nodes).toEqual([]);
  });

  it("still serves the demo brain for an empty workspace when ARC_DEMO_DATA=1", async () => {
    vi.stubEnv("ARC_DEMO_DATA", "1");
    const supabase = createSupabaseQueryMock({ knowledge_nodes: { data: [], error: null } });
    const result = await listNodes({}, supabase as never, "org-1");
    expect(result.status).toBe("live");
    if (result.status !== "live") throw new Error("expected live");
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it("hides archived nodes from a default read", async () => {
    const supabase = createSupabaseQueryMock({ knowledge_nodes: { data: NODES, error: null } });
    await listNodes({}, supabase as never, "org-1");
    expect(supabase.calls).toContainEqual(["neq", "trust_tier", "archived"]);
  });

  it("does not add the archived filter when an explicit tier is requested", async () => {
    const supabase = createSupabaseQueryMock({ knowledge_nodes: { data: NODES, error: null } });
    await listNodes({ trustTier: "trusted" }, supabase as never, "org-1");
    expect(supabase.calls).toContainEqual(["eq", "trust_tier", "trusted"]);
    expect(supabase.calls.some((c) => c[0] === "neq" && c[1] === "trust_tier")).toBe(false);
  });

  it("searches title, body AND summary — not the label alone", async () => {
    const supabase = createSupabaseQueryMock({ knowledge_nodes: { data: NODES, error: null } });
    await listNodes({ search: "arrival time" }, supabase as never, "org-1");
    expect(supabase.calls).toContainEqual([
      "or",
      "label.ilike.*arrival time*,body.ilike.*arrival time*,summary.ilike.*arrival time*",
    ]);
    // The old label-only query is exactly the bug this fixes — it must be gone.
    expect(supabase.calls.some((c) => c[0] === "ilike" && c[1] === "label")).toBe(false);
  });

  it("neutralizes PostgREST structural characters in the search term", async () => {
    const supabase = createSupabaseQueryMock({ knowledge_nodes: { data: NODES, error: null } });
    await listNodes({ search: "fast, cheap (guaranteed)" }, supabase as never, "org-1");
    // Commas/parens would break — or inject into — the .or() grammar; they're stripped.
    expect(supabase.calls).toContainEqual([
      "or",
      "label.ilike.*fast cheap guaranteed*,body.ilike.*fast cheap guaranteed*,summary.ilike.*fast cheap guaranteed*",
    ]);
  });

  it("applies no search filter when the term is all structural junk", async () => {
    const supabase = createSupabaseQueryMock({ knowledge_nodes: { data: NODES, error: null } });
    await listNodes({ search: "(),*" }, supabase as never, "org-1");
    expect(supabase.calls.some((c) => c[0] === "or")).toBe(false);
    expect(supabase.calls.some((c) => c[0] === "ilike")).toBe(false);
  });
});

describe("sanitizeBrainSearch", () => {
  it("strips the characters that would break PostgREST's .or() grammar", () => {
    expect(sanitizeBrainSearch("a,b(c)*d%e\"f\\g")).toBe("a b c d e f g");
  });

  it("preserves dots and hyphens so numbers and compounds still match", () => {
    expect(sanitizeBrainSearch("3.2h 60-minute")).toBe("3.2h 60-minute");
  });

  it("collapses whitespace and returns empty for an all-junk term", () => {
    expect(sanitizeBrainSearch("  a   b  ")).toBe("a b");
    expect(sanitizeBrainSearch("(),*%")).toBe("");
  });
});

describe("nodeMatchesSearch", () => {
  const node = { label: "IICRC certification", body: "Median arrival is 3.2 hours in the Chicago metro.", summary: "Fast response proof point" };

  it("matches evidence in the body, not just the title", () => {
    expect(nodeMatchesSearch(node, "3.2 hours")).toBe(true);
    expect(nodeMatchesSearch(node, "arrival")).toBe(true);
  });

  it("matches evidence in the summary", () => {
    expect(nodeMatchesSearch(node, "response proof")).toBe(true);
  });

  it("still matches the title", () => {
    expect(nodeMatchesSearch(node, "iicrc")).toBe(true);
  });

  it("is case-insensitive and returns false for a genuine miss", () => {
    expect(nodeMatchesSearch(node, "CHICAGO")).toBe(true);
    expect(nodeMatchesSearch(node, "flood insurance")).toBe(false);
  });

  it("treats an empty or all-junk term as no filter (matches everything)", () => {
    expect(nodeMatchesSearch(node, "")).toBe(true);
    expect(nodeMatchesSearch(node, "(),*")).toBe(true);
  });

  it("tolerates null body/summary", () => {
    expect(nodeMatchesSearch({ label: "Solo", body: null, summary: null }, "solo")).toBe(true);
    expect(nodeMatchesSearch({ label: "Solo", body: null, summary: null }, "missing")).toBe(false);
  });
});

describe("listProposed", () => {
  it("returns only the items awaiting a decision", async () => {
    const supabase = createSupabaseQueryMock({
      knowledge_nodes: { data: NODES.filter((n) => n.trust_tier === "proposed"), error: null },
    });
    const result = await listProposed(supabase as never, "org-1");
    expect(result.status).toBe("live");
    if (result.status !== "live") throw new Error("expected live");
    expect(result.nodes.every((n) => n.trustTier === "proposed")).toBe(true);
  });
});

describe("getBrainCrmCoverage", () => {
  it("reports how far the brain trails the CRM (sum of CRM rows minus crm_* nodes)", async () => {
    const supabase = createSupabaseQueryMock({
      companies: { data: null, error: null, count: 3 },
      contacts: { data: null, error: null, count: 5 },
      leads: { data: null, error: null, count: 4 },
      properties: { data: null, error: null, count: 0 },
      jobs: { data: null, error: null, count: 0 },
      outcomes: { data: null, error: null, count: 0 },
      knowledge_nodes: { data: null, error: null, count: 2 },
    });
    const res = await getBrainCrmCoverage(supabase as never, "org-1");
    expect(res).toEqual({ status: "live", crmRecords: 12, brainRecords: 2, behind: 10 });
  });

  it("reports caught up (behind 0) when the brain meets or exceeds the CRM", async () => {
    const supabase = createSupabaseQueryMock({
      companies: { data: null, error: null, count: 2 },
      contacts: { data: null, error: null, count: 0 },
      leads: { data: null, error: null, count: 0 },
      properties: { data: null, error: null, count: 0 },
      jobs: { data: null, error: null, count: 0 },
      outcomes: { data: null, error: null, count: 0 },
      knowledge_nodes: { data: null, error: null, count: 9 },
    });
    const res = await getBrainCrmCoverage(supabase as never, "org-1");
    expect(res).toMatchObject({ status: "live", crmRecords: 2, behind: 0 });
  });

  it("reports unavailable on a Supabase error", async () => {
    const supabase = createSupabaseQueryMock({
      companies: { data: null, error: { message: "boom" } },
    });
    const res = await getBrainCrmCoverage(supabase as never, "org-1");
    expect(res.status).toBe("unavailable");
  });
});

describe("brainSummary", () => {
  it("counts nodes by kind and tier", async () => {
    const supabase = createSupabaseQueryMock({ knowledge_nodes: { data: NODES, error: null } });
    const result = await brainSummary(supabase as never, "org-1");
    expect(result.status).toBe("live");
    if (result.status !== "live") throw new Error("expected live");
    expect(result.total).toBe(3);
    expect(result.byTier.trusted).toBe(1);
    expect(result.byTier.proposed).toBe(1);
    expect(result.byKind.brand_fact).toBe(2);
  });
});
