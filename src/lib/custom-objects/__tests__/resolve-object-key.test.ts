import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const maybeSingle = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: () => true,
  getSupabaseAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) }),
  }),
}));
vi.mock("@/lib/demo/demo-mode", () => ({ isDemoDataEnabled: () => false }));

import { resolveOrgObjectKey } from "../definitions";

/**
 * The one place that answers "is this a record type this workspace has?".
 *
 * It exists because that question was being answered in three places at once —
 * Arc's route resolved tenant keys, the operator's field editor refused them
 * against a constant, and the record editor refused them against a different
 * constant. So a key was writable by the agent and refused to the human, on the
 * same workspace, for the same record type.
 */
describe("resolveOrgObjectKey", () => {
  beforeEach(() => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
  });
  afterEach(() => vi.clearAllMocks());

  it("short-circuits the six built-ins without a lookup", async () => {
    for (const key of ["companies", "contacts", "properties", "leads", "jobs", "outcomes"]) {
      expect(await resolveOrgObjectKey("org-1", key)).toBe(key);
    }
    // They are tables. A round trip per call would be pure waste.
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("resolves a tenant-defined type to its canonical stored key", async () => {
    maybeSingle.mockResolvedValue({
      data: { id: "o1", key: "equipment", label_plural: "Equipment", label_singular: "Unit", active: true },
      error: null,
    });

    expect(await resolveOrgObjectKey("org-1", "equipment")).toBe("equipment");
  });

  it("refuses an ARCHIVED type — it is not a place to put new data", async () => {
    maybeSingle.mockResolvedValue({
      data: { id: "o1", key: "equipment", label_plural: "Equipment", label_singular: "Unit", active: false },
      error: null,
    });

    expect(await resolveOrgObjectKey("org-1", "equipment")).toBeNull();
  });

  it("refuses a key that names nothing", async () => {
    expect(await resolveOrgObjectKey("org-1", "nonsense")).toBeNull();
  });

  it("refuses non-string and empty input rather than querying for it", async () => {
    for (const bad of [null, undefined, "", 42, {}]) {
      expect(await resolveOrgObjectKey("org-1", bad)).toBeNull();
    }
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  /** A failed lookup must not throw into a caller that only wants a verdict. */
  it("returns null when the lookup fails", async () => {
    maybeSingle.mockRejectedValue(new Error("connection reset"));
    expect(await resolveOrgObjectKey("org-1", "equipment")).toBeNull();
  });
});
