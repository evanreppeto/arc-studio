import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({ orgId: "org-1", workspaceId: "workspace-1" })),
}));
// The resolver itself is mocked here, and covered on its own in
// src/lib/custom-objects/__tests__/resolve-object-key.test.ts. Mocking the
// lookup it calls internally would not work: `resolveOrgObjectKey` reaches
// `getCustomObjectByKey` through the module's own binding, which module
// mocking cannot intercept — so a partial mock silently ran the real one.
vi.mock("@/lib/custom-objects/definitions", () => ({ resolveOrgObjectKey: vi.fn() }));
vi.mock("@/lib/custom-fields/definitions", () => ({ listFieldDefinitions: vi.fn() }));
vi.mock("@/lib/custom-fields/values", () => ({
  getCustomFieldContextForRecord: vi.fn(),
  saveCustomFieldValues: vi.fn(),
}));

import { resolveOrgObjectKey } from "@/lib/custom-objects/definitions";
import { listFieldDefinitions } from "@/lib/custom-fields/definitions";
import { getCustomFieldContextForRecord, saveCustomFieldValues } from "@/lib/custom-fields/values";

import { GET, POST } from "./route";

/**
 * Which object keys this route accepts.
 *
 * It used to validate against the six built-ins with `isCustomFieldObjectKey`,
 * a constant — so a workspace could define a record type, put fields on it, and
 * Arc would be refused permission to read the one thing that gives those
 * records meaning. Validity is per-workspace and cannot come from a constant.
 */

const EQUIPMENT = {
  id: "obj-1",
  key: "equipment",
  labelPlural: "Equipment",
  labelSingular: "Equipment item",
  description: null,
  sortOrder: 0,
  active: true,
};

function req(query: string) {
  return new Request(`http://localhost/api/v1/arc/crm/custom-fields${query}`, {
    headers: { authorization: "Bearer secret" },
  });
}
function post(body: unknown) {
  return new Request("http://localhost/api/v1/arc/crm/custom-fields", {
    method: "POST",
    headers: { authorization: "Bearer secret", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const env = {
  ARC_AGENT_API_TOKEN: process.env.ARC_AGENT_API_TOKEN,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};
beforeEach(() => {
  process.env.ARC_AGENT_API_TOKEN = "secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
  // Default: the key names nothing this workspace has.
  vi.mocked(resolveOrgObjectKey).mockResolvedValue(null);
  vi.mocked(listFieldDefinitions).mockResolvedValue([]);
  vi.mocked(getCustomFieldContextForRecord).mockResolvedValue([] as never);
  vi.mocked(saveCustomFieldValues).mockResolvedValue({ ok: true, saved: 1 });
});
afterEach(() => {
  vi.clearAllMocks();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("object keys the custom-fields route accepts", () => {
  it("accepts a built-in", async () => {
    vi.mocked(resolveOrgObjectKey).mockResolvedValue("contacts");
    const res = await GET(req("?object=contacts"));

    expect(res.status).toBe(200);
    expect(listFieldDefinitions).toHaveBeenCalledWith("org-1", "contacts");
  });

  it("accepts a tenant-defined record type", async () => {
    vi.mocked(resolveOrgObjectKey).mockResolvedValue(EQUIPMENT.key);
    const res = await GET(req("?object=equipment"));

    expect(res.status).toBe(200);
    expect(resolveOrgObjectKey).toHaveBeenCalledWith("org-1", "equipment");
    expect(listFieldDefinitions).toHaveBeenCalledWith("org-1", "equipment");
  });

  it("refuses a key this workspace does not have, and says where to look", async () => {
    const res = await GET(req("?object=nonsense"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.message).toContain("object-types");
  });

  /**
   * The write half matters more: a value saved under an unresolved key would be
   * stored against an object nothing reads back.
   */
  it("saves values on a tenant-defined type", async () => {
    vi.mocked(resolveOrgObjectKey).mockResolvedValue(EQUIPMENT.key);
    const res = await POST(post({ object: "equipment", record_id: "r1", values: { serial_number: "X-1183" } }));

    expect(res.status).toBe(200);
    expect(saveCustomFieldValues).toHaveBeenCalledWith("org-1", "equipment", "r1", { serial_number: "X-1183" });
  });

  it("refuses a write to a key this workspace does not have", async () => {
    const res = await POST(post({ object: "nonsense", record_id: "r1", values: { a: 1 } }));

    expect(res.status).toBe(400);
    expect(saveCustomFieldValues).not.toHaveBeenCalled();
  });

  /**
   * The regression that mattered most: naming a field that doesn't exist came
   * back `{ ok: true, saved: 0 }` at HTTP 200. Arc was told a write it never
   * made had succeeded — and since a tenant-defined type IS its custom fields,
   * that was every write to one until fields could be authored on it.
   */
  it("reports an unknown field as a failure, not a successful no-op", async () => {
    vi.mocked(resolveOrgObjectKey).mockResolvedValue("equipment");
    vi.mocked(saveCustomFieldValues).mockResolvedValue({
      ok: false,
      error: 'No field named "warranty_expiry" on this record type.',
      fieldKey: "warranty_expiry",
      reason: "unknown_field",
    });

    const res = await POST(
      post({ object: "equipment", record_id: "r1", values: { warranty_expiry: "2027-01-01" } }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    // Its own status, so a caller can tell "wrong key" from "wrong value".
    expect(body.status).toBe("unknown_field");
    expect(body.message).toContain("warranty_expiry");
  });

  /** The resolved key, not the caller's string — GET already reported that. */
  it("echoes the resolved object key on a successful write", async () => {
    vi.mocked(resolveOrgObjectKey).mockResolvedValue("equipment");
    const res = await POST(post({ object: "equipment", record_id: "r1", values: {} }));
    const body = await res.json();

    expect(body.object).toBe("equipment");
  });
});
