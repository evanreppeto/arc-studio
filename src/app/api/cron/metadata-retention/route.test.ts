import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/arc-chat/metadata-retention", () => ({ runMetadataRetention: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ isSupabaseAdminConfigured: vi.fn(() => true) }));
import { runMetadataRetention } from "@/lib/arc-chat/metadata-retention";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { GET } from "./route";

/**
 * BSR-741. This job deletes data irreversibly, so what is tested here is mostly
 * the ways it must REFUSE to run: no secret, not switched on, no database. A
 * retention job that runs when it should not is the worst kind of bug in it.
 */

const runMock = vi.mocked(runMetadataRetention);
const configuredMock = vi.mocked(isSupabaseAdminConfigured);

function req(auth?: string, query = "") {
  return new Request(`http://localhost/api/cron/metadata-retention${query}`, {
    headers: { ...(auth ? { authorization: auth } : {}) },
  });
}

const env = {
  CRON_SECRET: process.env.CRON_SECRET,
  METADATA_RETENTION_CRON_ENABLED: process.env.METADATA_RETENTION_CRON_ENABLED,
};

beforeEach(() => {
  runMock.mockReset();
  configuredMock.mockReset();
  runMock.mockResolvedValue({ eligible: 3, pruned: 3, applied: true, cutoff: "2026-05-06T00:00:00.000Z" });
  configuredMock.mockReturnValue(true);
  process.env.CRON_SECRET = "s3cret";
  process.env.METADATA_RETENTION_CRON_ENABLED = "1";
});

afterEach(() => {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("GET /api/cron/metadata-retention", () => {
  it("401s on a wrong secret and prunes nothing", async () => {
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("401s when no secret is configured at all, rather than running open", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(req("Bearer s3cret"))).status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("does nothing while the flag is off", async () => {
    process.env.METADATA_RETENTION_CRON_ENABLED = "0";
    await expect((await GET(req("Bearer s3cret"))).json()).resolves.toMatchObject({ skipped: "disabled" });
    expect(runMock).not.toHaveBeenCalled();
  });

  it("does nothing without a database", async () => {
    configuredMock.mockReturnValue(false);
    await expect((await GET(req("Bearer s3cret"))).json()).resolves.toMatchObject({ skipped: "not_configured" });
    expect(runMock).not.toHaveBeenCalled();
  });

  it("applies when authorized and enabled", async () => {
    await expect((await GET(req("Bearer s3cret"))).json()).resolves.toMatchObject({ ok: true, pruned: 3 });
    expect(runMock).toHaveBeenCalledWith({ apply: true });
  });

  /** The way to find out what it would touch before letting it touch anything. */
  it("reports without writing when asked for a dry run", async () => {
    runMock.mockResolvedValue({ eligible: 41, pruned: 0, applied: false, cutoff: "2026-05-06T00:00:00.000Z" });
    await expect((await GET(req("Bearer s3cret", "?dryRun=1"))).json()).resolves.toMatchObject({
      eligible: 41,
      pruned: 0,
      applied: false,
    });
    expect(runMock).toHaveBeenCalledWith({ apply: false });
  });
});
