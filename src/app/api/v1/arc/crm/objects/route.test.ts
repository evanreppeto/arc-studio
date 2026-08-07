import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({ orgId: "org-1", workspaceId: "workspace-1" })),
}));
vi.mock("@/lib/custom-objects/definitions", () => ({
  listCustomObjects: vi.fn(),
  getCustomObjectByKey: vi.fn(),
}));
vi.mock("@/lib/custom-objects/records", () => ({
  listCustomRecords: vi.fn(),
  countCustomRecords: vi.fn(),
  createCustomRecord: vi.fn(),
}));
vi.mock("@/lib/custom-fields/definitions", () => ({ listFieldDefinitions: vi.fn() }));
vi.mock("@/lib/custom-fields/values", () => ({ getCustomFieldsForRecords: vi.fn() }));

import { getCustomObjectByKey, listCustomObjects } from "@/lib/custom-objects/definitions";
import { countCustomRecords, createCustomRecord, listCustomRecords } from "@/lib/custom-objects/records";
import { listFieldDefinitions } from "@/lib/custom-fields/definitions";
import { getCustomFieldsForRecords } from "@/lib/custom-fields/values";

import { GET as listTypes } from "../object-types/route";
import { GET, POST } from "./[key]/route";

/**
 * Arc's window onto tenant-defined record types.
 *
 * The point of these routes is that Arc cannot guess a key — the keys are
 * per-workspace — so discovery has to work and a wrong key has to say where to
 * look. A 404 that just says "not found" sends the model guessing again.
 */

const EQUIPMENT = {
  id: "obj-1",
  key: "equipment",
  labelPlural: "Equipment",
  labelSingular: "Equipment item",
  description: "Machines you own.",
  sortOrder: 0,
  active: true,
};

function req(path: string, init?: RequestInit) {
  return new Request(`http://localhost/api/v1/arc/crm/${path}`, {
    headers: { authorization: "Bearer secret", "content-type": "application/json" },
    ...init,
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
  vi.mocked(listCustomObjects).mockResolvedValue([EQUIPMENT]);
  vi.mocked(getCustomObjectByKey).mockResolvedValue(EQUIPMENT);
  vi.mocked(countCustomRecords).mockResolvedValue(3);
  vi.mocked(listFieldDefinitions).mockResolvedValue([
    { id: "f1", objectKey: "equipment", key: "serial", label: "Serial number", fieldType: "text", required: true, options: [], helpText: null, sortOrder: 0, active: true },
  ] as never);
  vi.mocked(listCustomRecords).mockResolvedValue([
    { id: "r1", title: "Extractor #3", subtitle: "Van 2", updatedAt: "2026-08-07T00:00:00Z", createdAt: "", archivedAt: null, origin: "operator" },
    { id: "r2", title: "Air scrubber", subtitle: null, updatedAt: "2026-08-06T00:00:00Z", createdAt: "", archivedAt: null, origin: "operator" },
  ]);
  vi.mocked(getCustomFieldsForRecords).mockResolvedValue(
    new Map([["r1", [{ definition: { key: "serial" }, value: "X1", display: "X1" }]]]) as never,
  );
  vi.mocked(createCustomRecord).mockResolvedValue({ ok: true, persisted: true, id: "new-1" });
});
afterEach(() => {
  vi.clearAllMocks();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("GET /api/v1/arc/crm/object-types", () => {
  /**
   * Fields come back with the type, in one call. A custom object's shape IS its
   * fields — a list of names without them tells the model nothing it can act on,
   * and a second required round trip is a step that gets skipped.
   */
  it("returns each type with its fields and record count", async () => {
    const res = await listTypes(req("object-types"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.object_types).toHaveLength(1);
    expect(body.object_types[0]).toMatchObject({
      key: "equipment",
      label: "Equipment",
      singular: "Equipment item",
      record_count: 3,
    });
    expect(body.object_types[0].fields[0]).toMatchObject({ key: "serial", label: "Serial number", required: true });
  });

  /** Archived types are out of the operator's CRM; Arc reasoning about them
   *  would be reasoning about records nobody can see. */
  it("asks only for live types", async () => {
    await listTypes(req("object-types"));
    expect(listCustomObjects).toHaveBeenCalledWith("org-1");
  });
});

describe("GET /api/v1/arc/crm/objects/[key]", () => {
  it("returns rows with their custom field values inline", async () => {
    const res = await GET(req("objects/equipment"), { params: Promise.resolve({ key: "equipment" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.records[0]).toMatchObject({ id: "r1", title: "Extractor #3", fields: { serial: "X1" } });
    // A record with no values still comes back — absent values are not absent rows.
    expect(body.records[1]).toMatchObject({ id: "r2", fields: {} });
    expect(body.total).toBe(2);
  });

  /**
   * The keys are per-workspace, so a wrong one is nearly always a model that
   * guessed instead of listing. Naming the discovery route is what turns the
   * 404 into a recoverable step rather than another guess.
   */
  it("points a bad key at discovery instead of just refusing", async () => {
    vi.mocked(getCustomObjectByKey).mockResolvedValue(null);
    const res = await GET(req("objects/nope"), { params: Promise.resolve({ key: "nope" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.message).toContain("object-types");
  });

  /** `limit=0` is the count-only mode the six already honour. */
  it("counts without returning rows at limit=0", async () => {
    const res = await GET(req("objects/equipment?limit=0"), { params: Promise.resolve({ key: "equipment" }) });
    const body = await res.json();

    expect(body.total).toBe(2);
    expect(body.records).toHaveLength(0);
  });

  it("filters on the name and the line under it", async () => {
    const res = await GET(req("objects/equipment?q=scrubber"), { params: Promise.resolve({ key: "equipment" }) });
    const body = await res.json();

    expect(body.total).toBe(1);
    expect(body.records[0].title).toBe("Air scrubber");
  });
});

describe("POST /api/v1/arc/crm/objects/[key]", () => {
  it("creates a record and returns somewhere to go", async () => {
    const res = await POST(
      req("objects/equipment", { method: "POST", body: JSON.stringify({ title: "Dehumidifier" }) }),
      { params: Promise.resolve({ key: "equipment" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.record).toMatchObject({ id: "new-1", href: "/crm/equipment/new-1" });
  });

  it("refuses a record with no name, in the tenant's own word", async () => {
    const res = await POST(
      req("objects/equipment", { method: "POST", body: JSON.stringify({}) }),
      { params: Promise.resolve({ key: "equipment" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.message).toContain("equipment item");
  });

  /**
   * Offline, the write layer reports `persisted: false` rather than throwing.
   * Returning 201 there would hand Arc a success it cannot verify — and it
   * would go on to reference an id that does not exist.
   */
  it("says 202, not 201, when nothing was actually saved", async () => {
    vi.mocked(createCustomRecord).mockResolvedValue({ ok: true, persisted: false });
    const res = await POST(
      req("objects/equipment", { method: "POST", body: JSON.stringify({ title: "X" }) }),
      { params: Promise.resolve({ key: "equipment" }) },
    );

    expect(res.status).toBe(202);
    expect((await res.json()).persisted).toBe(false);
  });
});
