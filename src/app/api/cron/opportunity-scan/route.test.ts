import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/opportunities/enqueue", () => ({ enqueueOpportunityScanTask: vi.fn() }));
vi.mock("@/lib/opportunities/recent-scan", () => ({ hasRecentOpportunityScan: vi.fn() }));
// The route fans out across active workspaces rather than calling the scan
// directly (BSR-626), so the fan-out is what this suite drives.
vi.mock("@/lib/opportunities/fan-out", () => ({ runOpportunityScanAcrossWorkspaces: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ isSupabaseAdminConfigured: vi.fn(() => true) }));
import { enqueueOpportunityScanTask } from "@/lib/opportunities/enqueue";
import { hasRecentOpportunityScan } from "@/lib/opportunities/recent-scan";
import { runOpportunityScanAcrossWorkspaces } from "@/lib/opportunities/fan-out";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { GET } from "./route";

const enqueueMock = vi.mocked(enqueueOpportunityScanTask);
const recentMock = vi.mocked(hasRecentOpportunityScan);
const scanMock = vi.mocked(runOpportunityScanAcrossWorkspaces);
const configuredMock = vi.mocked(isSupabaseAdminConfigured);
function req(auth?: string) { return new Request("http://localhost/api/cron/opportunity-scan", { headers: { ...(auth ? { authorization: auth } : {}) } }); }
const env = { CRON_SECRET: process.env.CRON_SECRET, OPPORTUNITY_SCAN_CRON_ENABLED: process.env.OPPORTUNITY_SCAN_CRON_ENABLED };
beforeEach(() => {
  enqueueMock.mockReset(); recentMock.mockReset(); scanMock.mockReset(); configuredMock.mockReset();
  enqueueMock.mockResolvedValue({ ok: true }); recentMock.mockResolvedValue(false); scanMock.mockResolvedValue({ workspaces: 1, scanned: 1, failed: 0, added: 0, filtered: 0, results: [] }); configuredMock.mockReturnValue(true);
  process.env.CRON_SECRET = "s3cret"; process.env.OPPORTUNITY_SCAN_CRON_ENABLED = "1";
});
afterEach(() => { for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

describe("GET /api/cron/opportunity-scan", () => {
  it("401s without the cron secret and never enqueues", async () => {
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
  it("401s when CRON_SECRET is unset (fail closed)", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(req("Bearer s3cret"))).status).toBe(401);
  });
  it("skips (no enqueue, no deterministic scan) when the flag is off", async () => {
    process.env.OPPORTUNITY_SCAN_CRON_ENABLED = "0";
    expect(await (await GET(req("Bearer s3cret"))).json()).toMatchObject({ skipped: "disabled" });
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(scanMock).not.toHaveBeenCalled();
  });
  it("still runs the deterministic detectors even when the generative scan is skipped-recent", async () => {
    recentMock.mockResolvedValue(true);
    expect(await (await GET(req("Bearer s3cret"))).json()).toMatchObject({ deterministic: "ok", skipped: "recent" });
    expect(scanMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
  it("runs deterministic detectors + enqueues the generative scan when not recent", async () => {
    const res = await GET(req("Bearer s3cret"));
    expect(await res.json()).toMatchObject({ ok: true, deterministic: "ok", queued: true });
    expect(scanMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith({ operator: "Scheduled scan" });
  });
  it("reports deterministic:error but still enqueues when a detector pass throws", async () => {
    scanMock.mockRejectedValue(new Error("detector boom"));
    const res = await GET(req("Bearer s3cret"));
    expect(await res.json()).toMatchObject({ ok: true, deterministic: "error", queued: true });
    expect(enqueueMock).toHaveBeenCalledWith({ operator: "Scheduled scan" });
  });
});

describe("multi-tenant fan-out (BSR-626)", () => {
  it("reports deterministic=error when any tenant's scan failed", async () => {
    // The bug this replaces: a tenant that could not be scanned was swallowed and
    // the pass reported success with zero opportunities — indistinguishable from
    // a quiet night. A failed tenant must be visible in the cron result.
    scanMock.mockResolvedValue({
      workspaces: 3, scanned: 2, failed: 1, added: 5, filtered: 0, results: [],
    });
    const body = await (await GET(req("Bearer s3cret"))).json();
    expect(body.deterministic).toBe("error");
    expect(body.fanOut).toMatchObject({ workspaces: 3, scanned: 2, failed: 1 });
  });

  it("carries the per-tenant counts into the response so a quiet pass is legible", async () => {
    scanMock.mockResolvedValue({
      workspaces: 2, scanned: 2, failed: 0, added: 7, filtered: 2, results: [],
    });
    const body = await (await GET(req("Bearer s3cret"))).json();
    expect(body.deterministic).toBe("ok");
    expect(body.scan).toMatchObject({ added: 7, filtered: 2 });
    expect(body.fanOut).toMatchObject({ workspaces: 2, scanned: 2, failed: 0 });
  });
});
