import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above these declarations, so the factories must not close
// over module-level variables — they reach the spies through vi.mocked() below.
vi.mock("../definitions", () => ({ listFieldDefinitions: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: () => true,
  getSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/lib/demo/demo-mode", () => ({ isDemoDataEnabled: () => false }));

import { listFieldDefinitions } from "../definitions";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

import { saveCustomFieldValues } from "../values";

const upsert = vi.fn();

/**
 * `saveCustomFieldValues` had no test of its own — every caller's suite mocked
 * it. That is how it shipped returning SUCCESS for a write it did not make.
 */

function def(key: string, over: Record<string, unknown> = {}) {
  return {
    id: `f-${key}`,
    objectKey: "equipment",
    key,
    label: key.replace(/_/g, " "),
    fieldType: "text",
    required: false,
    options: [],
    helpText: null,
    sortOrder: 0,
    active: true,
    ...over,
  };
}

describe("saveCustomFieldValues", () => {
  beforeEach(() => {
    upsert.mockResolvedValue({ error: null });
    vi.mocked(getSupabaseAdminClient).mockReturnValue({ from: () => ({ upsert }) } as never);
    vi.mocked(listFieldDefinitions).mockResolvedValue([def("serial_number"), def("condition")] as never);
  });
  afterEach(() => vi.clearAllMocks());

  it("writes the supplied fields", async () => {
    const r = await saveCustomFieldValues("org-1", "equipment", "r1", { serial_number: "X-1183" });

    expect(r).toEqual({ ok: true, saved: 1 });
    const rows = upsert.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      org_id: "org-1",
      field_id: "f-serial_number",
      object_key: "equipment",
      record_id: "r1",
      value: "X-1183",
    });
    // The unique index this conflict target names is what makes a re-write an
    // update instead of a second row.
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: "org_id,record_id,field_id" });
  });

  /**
   * THE REGRESSION. This returned `{ ok: true, saved: 0 }` — so a caller that
   * named a field which does not exist was told it had succeeded, and could
   * not correct a mistake it never heard about.
   */
  it("refuses a field key that does not exist, rather than reporting success", async () => {
    const r = await saveCustomFieldValues("org-1", "equipment", "r1", { warranty_expiry: "2027-01-01" });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unknown_field");
    expect(r.error).toContain("warranty_expiry");
    // Names what IS there, so the caller can recover in one step.
    expect(r.error).toContain("serial_number");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("says so plainly when the record type has no fields at all", async () => {
    vi.mocked(listFieldDefinitions).mockResolvedValue([]);
    const r = await saveCustomFieldValues("org-1", "equipment", "r1", { anything: 1 });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("no custom fields yet");
  });

  /**
   * An ARCHIVED field is a stale form, not an invented key — someone removed
   * the field while the form was open. Failing that whole save would be
   * user-hostile, so it is dropped quietly. This is the distinction the fix
   * had to preserve.
   */
  it("ignores a key naming an archived field, and still writes the rest", async () => {
    vi.mocked(listFieldDefinitions).mockResolvedValue([
      def("serial_number"),
      def("old_tag", { active: false }),
    ] as never);

    const r = await saveCustomFieldValues("org-1", "equipment", "r1", {
      serial_number: "X-1183",
      old_tag: "whatever",
    });

    expect(r).toEqual({ ok: true, saved: 1 });
    expect(upsert.mock.calls[0][0]).toHaveLength(1);
  });

  it("treats an empty values object as a legitimate no-op", async () => {
    const r = await saveCustomFieldValues("org-1", "equipment", "r1", {});

    expect(r).toEqual({ ok: true, saved: 0 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects a value that does not fit its field, and writes nothing", async () => {
    vi.mocked(listFieldDefinitions).mockResolvedValue([
      def("condition", { fieldType: "select", options: [{ value: "good", label: "Good" }] }),
      def("serial_number"),
    ] as never);

    const r = await saveCustomFieldValues("org-1", "equipment", "r1", {
      serial_number: "X-1183",
      condition: "exploded",
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("invalid_value");
    expect(r.fieldKey).toBe("condition");
    // All-or-nothing: the valid field must not land on its own.
    expect(upsert).not.toHaveBeenCalled();
  });
});
