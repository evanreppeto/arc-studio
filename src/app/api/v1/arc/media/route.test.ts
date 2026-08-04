import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({
    orgId: "org-1",
    workspaceId: "workspace-1",
  })),
}));
vi.mock("@/lib/auth/api-token", () => ({
  checkAgentBearer: vi.fn(async () => ({
    ok: true,
    tokenSource: "database",
    orgId: "org-2",
    workspaceId: "20000000-0000-4000-8000-000000000002",
  })),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdminClient: vi.fn(),
  isSupabaseAdminConfigured: vi.fn(() => true),
}));

import { checkAgentBearer } from "@/lib/auth/api-token";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { GET, POST } from "./route";

const bearerMock = vi.mocked(checkAgentBearer);
const getSupabaseMock = vi.mocked(getSupabaseAdminClient);
const configuredMock = vi.mocked(isSupabaseAdminConfigured);

const env = {
  ARC_AGENT_API_TOKEN: process.env.ARC_AGENT_API_TOKEN,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

function configure() {
  process.env.ARC_AGENT_API_TOKEN = "secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
}

function request(token = "secret") {
  return new Request("http://x/api/v1/arc/media", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("GET /api/v1/arc/media", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configuredMock.mockReturnValue(true);
    bearerMock.mockResolvedValue({
      ok: true,
      tokenSource: "database",
      orgId: "org-2",
      workspaceId: "20000000-0000-4000-8000-000000000002",
    });
  });

  it("401s without a valid bearer token", async () => {
    configure();
    bearerMock.mockResolvedValueOnce({ ok: false, reason: "unauthorized", status: 401 });
    const res = await GET(request("wrong"));
    expect(res.status).toBe(401);
  });

  it("503s when Supabase admin is not configured", async () => {
    configure();
    configuredMock.mockReturnValue(false);

    const res = await GET(request());

    expect(res.status).toBe(503);
  });

  it("filters available media by the DB-issued Arc token org", async () => {
    configure();
    const supabase = createSupabaseQueryMock({ media_assets: { data: [], error: null } });
    getSupabaseMock.mockReturnValue(supabase);

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(supabase.calls).toContainEqual(["from", "media_assets"]);
    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-2"]);
    expect(supabase.calls).toContainEqual(["eq", "available_to_arc", true]);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
});

function postRequest(body: unknown, token = "secret") {
  return new Request("http://x/api/v1/arc/media", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/arc/media", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configuredMock.mockReturnValue(true);
    bearerMock.mockResolvedValue({
      ok: true,
      tokenSource: "database",
      orgId: "org-2",
      workspaceId: "20000000-0000-4000-8000-000000000002",
    });
  });

  it("401s without a valid bearer token", async () => {
    configure();
    bearerMock.mockResolvedValueOnce({ ok: false, reason: "unauthorized", status: 401 });
    const res = await POST(postRequest({ action: "create_folder", name: "x" }, "wrong"));
    expect(res.status).toBe(401);
  });

  it("creates a folder scoped to the token org", async () => {
    configure();
    const supabase = createSupabaseQueryMock({ media_folders: { data: { id: "f-9" }, error: null } });
    getSupabaseMock.mockReturnValue(supabase);

    const res = await POST(postRequest({ action: "create_folder", name: "Proof photos" }));

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, folder_id: "f-9" });
    const insert = supabase.calls.find(([m]) => m === "insert") as [string, Record<string, unknown>];
    expect(insert[1]).toMatchObject({ org_id: "org-2", name: "Proof photos" });
  });

  it("files an asset into a folder", async () => {
    configure();
    const supabase = createSupabaseQueryMock({
      media_assets: [
        { data: { org_id: "org-2" }, error: null },
        // Org-scoped move returns the updated row (BSR-707).
        { data: [{ id: "a-1" }], error: null },
      ],
      media_folders: { data: { org_id: "org-2" }, error: null },
    });
    getSupabaseMock.mockReturnValue(supabase);

    const res = await POST(postRequest({ action: "file_asset", asset_id: "a-1", folder_id: "f-1" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, asset_id: "a-1" });
  });

  it("400s on an unknown action", async () => {
    configure();
    const res = await POST(postRequest({ action: "nope" }));
    expect(res.status).toBe(400);
  });

  it("400s on a non-object body", async () => {
    configure();
    const res = await POST(postRequest("not-json-object"));
    expect(res.status).toBe(400);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
});
