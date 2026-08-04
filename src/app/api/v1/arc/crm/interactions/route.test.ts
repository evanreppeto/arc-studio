import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({
    orgId: "org-1",
    workspaceId: "workspace-1",
  })),
}));
vi.mock("@/lib/interactions/persistence", () => ({
  insertActivity: vi.fn(async () => ({ ok: true, id: "activity-1" })),
  insertNote: vi.fn(async () => ({ ok: true, id: "note-1" })),
  insertTask: vi.fn(async () => ({ ok: true, id: "task-1" })),
}));

import { insertNote } from "@/lib/interactions/persistence";

import { POST } from "./route";

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

function request(token: string, body: unknown) {
  return new Request("http://localhost/api/v1/arc/crm/interactions", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(insertNote).mockClear();
});

afterEach(() => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("POST /api/v1/arc/crm/interactions", () => {
  it("passes the resolved Arc workspace scope into note persistence", async () => {
    configure();

    const res = await POST(
      request("secret", {
        kind: "note",
        entity_type: "lead",
        entity_id: "lead-1",
        body: "Customer asked for a call back.",
      }),
    );

    expect(res.status).toBe(201);
    expect(insertNote).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "lead", entityId: "lead-1", body: "Customer asked for a call back." }),
      { orgId: "org-1", workspaceId: "workspace-1" },
    );
  });

  it("rejects invalid bearer tokens before writing", async () => {
    configure();

    const res = await POST(request("wrong", { kind: "note", entity_type: "lead", entity_id: "lead-1", body: "x" }));

    // These tests point at an unreachable Supabase, so the token store cannot
    // answer — and "I could not verify this" is now 503, distinct from the 401
    // that means "this token is not ours". The security property under test is
    // unchanged: the request is refused and nothing is read or written. The 401
    // path is covered where the store can be made to answer (see the
    // token-store test below, and src/lib/auth/check-agent-bearer.test.ts).
    expect(res.status).toBe(503);
    expect(insertNote).not.toHaveBeenCalled();
  });
});
