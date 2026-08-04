import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdminClient: vi.fn(),
  isSupabaseAdminConfigured: vi.fn(),
}));
vi.mock("./scan", () => ({ runDeterministicOpportunityScan: vi.fn() }));
vi.mock("./auto-draft", () => ({ runScheduledAutoDraft: vi.fn() }));
vi.mock("./enqueue", () => ({ enqueueOpportunityScanTask: vi.fn() }));
vi.mock("./recent-scan", () => ({ hasRecentOpportunityScan: vi.fn() }));
vi.mock("@/lib/observability/report-degraded", () => ({ reportDegraded: vi.fn() }));

import { reportDegraded } from "@/lib/observability/report-degraded";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { runOpportunityScanAcrossWorkspaces } from "./fan-out";
import { runScheduledAutoDraft } from "./auto-draft";
import { enqueueOpportunityScanTask } from "./enqueue";
import { hasRecentOpportunityScan } from "./recent-scan";
import { runDeterministicOpportunityScan } from "./scan";

const configured = vi.mocked(isSupabaseAdminConfigured);
const getAdmin = vi.mocked(getSupabaseAdminClient);
const scan = vi.mocked(runDeterministicOpportunityScan);
const degraded = vi.mocked(reportDegraded);
const autoDraft = vi.mocked(runScheduledAutoDraft);
const enqueue = vi.mocked(enqueueOpportunityScanTask);
const recent = vi.mocked(hasRecentOpportunityScan);

/** Minimal PostgREST-shaped stub: .select().eq().eq() resolves to {data,error}. */
function dbReturning(result: { data?: unknown; error?: { message: string } | null }) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve, reject),
  };
  return { from: () => chain };
}

const TWO_TENANTS = [
  { id: "ws-a", org_id: "org-a", name: "Tenant A" },
  { id: "ws-b", org_id: "org-b", name: "Tenant B" },
];

beforeEach(() => {
  configured.mockReset().mockReturnValue(true);
  getAdmin.mockReset();
  scan.mockReset();
  degraded.mockReset();
  autoDraft.mockReset().mockResolvedValue({
    ran: false, dryRun: false, considered: 0, selected: 0, drafted: 0,
    failed: 0, unusable: 0, campaignIds: [], wouldDraft: [],
  });
  enqueue.mockReset().mockResolvedValue({ ok: true });
  recent.mockReset().mockResolvedValue(false);
});

describe("runOpportunityScanAcrossWorkspaces", () => {
  it("scans EVERY active workspace, not just one", async () => {
    // The regression this locks down (BSR-626): the scheduled scan relied on
    // ambient tenant resolution, which refuses outright once a second active org
    // exists — so the pass silently produced nothing for anyone.
    getAdmin.mockReturnValue(dbReturning({ data: TWO_TENANTS }) as never);
    scan.mockResolvedValue({ added: 3, filtered: 1 });

    const result = await runOpportunityScanAcrossWorkspaces();

    expect(scan).toHaveBeenCalledTimes(2);
    expect(scan).toHaveBeenCalledWith({ orgId: "org-a", workspaceId: "ws-a" });
    expect(scan).toHaveBeenCalledWith({ orgId: "org-b", workspaceId: "ws-b" });
    expect(result.workspaces).toBe(2);
    expect(result.scanned).toBe(2);
    expect(result.added).toBe(6);
    expect(result.filtered).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("passes an EXPLICIT scope rather than letting the detectors resolve one", async () => {
    // The whole fix: scope is handed down, never inferred from an ambient
    // request that a cron does not have.
    getAdmin.mockReturnValue(dbReturning({ data: [TWO_TENANTS[0]] }) as never);
    scan.mockResolvedValue({ added: 0, filtered: 0 });

    await runOpportunityScanAcrossWorkspaces();

    expect(scan).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-a" }));
    expect(scan).not.toHaveBeenCalledWith(undefined);
  });

  it("keeps scanning the other tenants when one fails", async () => {
    // A single misconfigured tenant must not take detection away from every
    // healthy one — which is precisely what the old swallow did.
    getAdmin.mockReturnValue(dbReturning({ data: TWO_TENANTS }) as never);
    scan
      .mockRejectedValueOnce(new Error("tenant A exploded"))
      .mockResolvedValueOnce({ added: 4, filtered: 0 });

    const result = await runOpportunityScanAcrossWorkspaces();

    expect(result.failed).toBe(1);
    expect(result.scanned).toBe(1);
    expect(result.added).toBe(4);
    expect(result.results.find((r) => r.orgId === "org-a")?.error).toContain("exploded");
    expect(result.results.find((r) => r.orgId === "org-b")?.summary).toEqual({ added: 4, filtered: 0 });
  });

  it("reports a failing tenant instead of counting it as zero opportunities", async () => {
    getAdmin.mockReturnValue(dbReturning({ data: [TWO_TENANTS[0]] }) as never);
    scan.mockRejectedValue(new Error("boom"));

    const result = await runOpportunityScanAcrossWorkspaces();

    expect(degraded).toHaveBeenCalledTimes(1);
    expect(degraded.mock.calls[0]?.[1]).toMatchObject({ scope: "opportunities.fan-out" });
    expect(result.failed).toBe(1);
  });

  it("reports a listing failure rather than reading as 'no workspaces to scan'", async () => {
    // "Could not find out" and "there are none" must not look the same — the
    // same distinction BSR-542/544/546 fixed in the read models.
    getAdmin.mockReturnValue(dbReturning({ error: { message: "connection reset" } }) as never);

    const result = await runOpportunityScanAcrossWorkspaces();

    expect(degraded).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(1);
    expect(result.workspaces).toBe(0);
    expect(scan).not.toHaveBeenCalled();
  });

  it("does nothing when Supabase is not configured", async () => {
    configured.mockReturnValue(false);
    const result = await runOpportunityScanAcrossWorkspaces();
    expect(result).toMatchObject({ workspaces: 0, scanned: 0, failed: 0, added: 0 });
    expect(scan).not.toHaveBeenCalled();
    expect(degraded).not.toHaveBeenCalled();
  });

  it("is a no-op with no active workspaces, without reporting a fault", async () => {
    getAdmin.mockReturnValue(dbReturning({ data: [] }) as never);
    const result = await runOpportunityScanAcrossWorkspaces();
    expect(result.workspaces).toBe(0);
    expect(result.failed).toBe(0);
    expect(degraded).not.toHaveBeenCalled();
  });
});

describe("generative scan stage (BSR-626)", () => {
  it("queues a generative scan per tenant, each with its OWN scope", async () => {
    getAdmin.mockReturnValue(dbReturning({ data: TWO_TENANTS }) as never);
    scan.mockResolvedValue({ added: 0, filtered: 0 });

    const result = await runOpportunityScanAcrossWorkspaces({ generative: true });

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith({
      operator: "Scheduled scan",
      scope: { orgId: "org-a", workspaceId: "ws-a" },
    });
    expect(enqueue).toHaveBeenCalledWith({
      operator: "Scheduled scan",
      scope: { orgId: "org-b", workspaceId: "ws-b" },
    });
    expect(result.generativeQueued).toBe(2);
  });

  it("dedupes recency PER TENANT — one tenant's recent scan cannot suppress another's", async () => {
    // The bug shape this prevents: recency used to be evaluated once, for a
    // single ambient tenant, and gated the whole pass.
    getAdmin.mockReturnValue(dbReturning({ data: TWO_TENANTS }) as never);
    scan.mockResolvedValue({ added: 0, filtered: 0 });
    recent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const result = await runOpportunityScanAcrossWorkspaces({ generative: true });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ scope: { orgId: "org-b", workspaceId: "ws-b" } }));
    expect(result.generativeQueued).toBe(1);
  });

  it("runs auto-draft per tenant with that tenant's scope", async () => {
    getAdmin.mockReturnValue(dbReturning({ data: TWO_TENANTS }) as never);
    scan.mockResolvedValue({ added: 0, filtered: 0 });

    await runOpportunityScanAcrossWorkspaces({ autoDraft: true });

    expect(autoDraft).toHaveBeenCalledTimes(2);
    expect(autoDraft).toHaveBeenCalledWith(
      expect.any(Date),
      expect.objectContaining({ scope: { orgId: "org-a", workspaceId: "ws-a" } }),
    );
  });

  it("skips the optional stages unless asked", async () => {
    // The operator "Scan" button reuses the fan-out and must not also draft or
    // queue agent work as a side effect.
    getAdmin.mockReturnValue(dbReturning({ data: TWO_TENANTS }) as never);
    scan.mockResolvedValue({ added: 0, filtered: 0 });

    await runOpportunityScanAcrossWorkspaces();

    expect(autoDraft).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(recent).not.toHaveBeenCalled();
  });

  it("records a tenant whose enqueue failed without stopping the rest", async () => {
    getAdmin.mockReturnValue(dbReturning({ data: TWO_TENANTS }) as never);
    scan.mockResolvedValue({ added: 0, filtered: 0 });
    enqueue.mockResolvedValueOnce({ ok: false, error: "Arc agent not found." }).mockResolvedValueOnce({ ok: true });

    const result = await runOpportunityScanAcrossWorkspaces({ generative: true });

    expect(result.failed).toBe(1);
    expect(result.generativeQueued).toBe(1);
    expect(result.results.find((r) => r.orgId === "org-a")?.error).toContain("Arc agent not found");
    expect(degraded).toHaveBeenCalled();
  });
});
