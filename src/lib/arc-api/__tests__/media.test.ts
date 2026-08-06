import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { arcCreateFolder, arcFileAsset } from "../media";

const ORG = "org-1";
const OTHER = "org-2";

/**
 * `createFolder` reads its new sibling's `sort_order` before inserting, so a
 * creation is two round trips now — the folder used to land on the column's
 * `default 0` and tie with whatever else held 0, which let Postgres return the
 * rail in a different order on different reads.
 */
const SIBLINGS_THEN_INSERT = (id: string) => [
  { data: [], error: null },
  { data: { id }, error: null },
];

describe("arcCreateFolder", () => {
  it("creates a folder at the Library root", async () => {
    const supabase = createSupabaseQueryMock({ media_folders: SIBLINGS_THEN_INSERT("f-1") });
    const result = await arcCreateFolder({ name: "  Proof photos  " }, { client: supabase as never, orgId: ORG });
    expect(result).toEqual({ ok: true, id: "f-1" });
    const insert = supabase.calls.find(([m]) => m === "insert") as [string, Record<string, unknown>];
    expect(insert[1]).toMatchObject({ org_id: ORG, name: "Proof photos", parent_id: null });
  });

  it("creates a folder under a same-org parent", async () => {
    const supabase = createSupabaseQueryMock({
      media_folders: [
        { data: { org_id: ORG }, error: null }, // parent ownership lookup
        { data: [], error: null }, // sibling sort_order lookup
        { data: { id: "f-2" }, error: null }, // insert
      ],
    });
    const result = await arcCreateFolder({ name: "Nested", parent_id: "parent-1" }, { client: supabase as never, orgId: ORG });
    expect(result).toEqual({ ok: true, id: "f-2" });
    const insert = supabase.calls.find(([m]) => m === "insert") as [string, Record<string, unknown>];
    expect(insert[1]).toMatchObject({ parent_id: "parent-1" });
  });

  it("rejects an empty name", async () => {
    const supabase = createSupabaseQueryMock({ media_folders: { data: null, error: null } });
    const result = await arcCreateFolder({ name: "   " }, { client: supabase as never, orgId: ORG });
    expect(result.ok).toBe(false);
    expect(supabase.calls.some(([m]) => m === "insert")).toBe(false);
  });

  it("rejects a parent folder owned by another org (service role bypasses RLS)", async () => {
    const supabase = createSupabaseQueryMock({ media_folders: { data: { org_id: OTHER }, error: null } });
    const result = await arcCreateFolder({ name: "Sneaky", parent_id: "other-folder" }, { client: supabase as never, orgId: ORG });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error).toMatch(/another workspace/i);
    expect(supabase.calls.some(([m]) => m === "insert")).toBe(false);
  });

  it("rejects a missing parent folder", async () => {
    const supabase = createSupabaseQueryMock({ media_folders: { data: null, error: null } });
    const result = await arcCreateFolder({ name: "x", parent_id: "ghost" }, { client: supabase as never, orgId: ORG });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error).toMatch(/not found/i);
  });

  it("passes a trimmed description through to createFolder", async () => {
    const supabase = createSupabaseQueryMock({ media_folders: SIBLINGS_THEN_INSERT("f-1") });
    const result = await arcCreateFolder(
      { name: "Proof", description: "  Before/after proof  " },
      { client: supabase as never, orgId: ORG },
    );
    expect(result).toEqual({ ok: true, id: "f-1" });
    const insert = supabase.calls.find(([m]) => m === "insert") as [string, Record<string, unknown>];
    expect(insert[1]).toMatchObject({ org_id: ORG, name: "Proof", description: "Before/after proof" });
  });
});

describe("arcFileAsset", () => {
  it("files an asset into a same-org folder", async () => {
    const supabase = createSupabaseQueryMock({
      media_assets: [
        { data: { org_id: ORG }, error: null }, // asset ownership lookup
        // The move is org-scoped now and returns the updated row (BSR-707);
        // `null` here meant "nothing matched", i.e. not this org's asset.
        { data: [{ id: "a-1" }], error: null }, // move (update ... select)
      ],
      media_folders: { data: { org_id: ORG }, error: null }, // target folder lookup
    });
    const result = await arcFileAsset({ asset_id: "a-1", folder_id: "f-1" }, { client: supabase as never, orgId: ORG });
    expect(result).toEqual({ ok: true, id: "a-1" });
    const update = supabase.calls.find(([m]) => m === "update") as [string, Record<string, unknown>];
    expect(update[1]).toMatchObject({ folder_id: "f-1" });
  });

  it("files an asset to the root when folder_id is null", async () => {
    const supabase = createSupabaseQueryMock({
      media_assets: [
        { data: { org_id: ORG }, error: null },
        { data: [{ id: "a-1" }], error: null },
      ],
    });
    const result = await arcFileAsset({ asset_id: "a-1", folder_id: null }, { client: supabase as never, orgId: ORG });
    expect(result).toEqual({ ok: true, id: "a-1" });
    const update = supabase.calls.find(([m]) => m === "update") as [string, Record<string, unknown>];
    expect(update[1]).toMatchObject({ folder_id: null });
  });

  it("rejects an asset owned by another org", async () => {
    const supabase = createSupabaseQueryMock({ media_assets: { data: { org_id: OTHER }, error: null } });
    const result = await arcFileAsset({ asset_id: "a-x", folder_id: "f-1" }, { client: supabase as never, orgId: ORG });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error).toMatch(/another workspace/i);
    expect(supabase.calls.some(([m]) => m === "update")).toBe(false);
  });

  it("rejects a target folder owned by another org", async () => {
    const supabase = createSupabaseQueryMock({
      media_assets: { data: { org_id: ORG }, error: null },
      media_folders: { data: { org_id: OTHER }, error: null },
    });
    const result = await arcFileAsset({ asset_id: "a-1", folder_id: "other-folder" }, { client: supabase as never, orgId: ORG });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error).toMatch(/another workspace/i);
    expect(supabase.calls.some(([m]) => m === "update")).toBe(false);
  });

  it("rejects a missing asset", async () => {
    const supabase = createSupabaseQueryMock({ media_assets: { data: null, error: null } });
    const result = await arcFileAsset({ asset_id: "ghost", folder_id: null }, { client: supabase as never, orgId: ORG });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error).toMatch(/not found/i);
  });

  it("requires an asset_id", async () => {
    const supabase = createSupabaseQueryMock({ media_assets: { data: null, error: null } });
    const result = await arcFileAsset({ folder_id: "f-1" }, { client: supabase as never, orgId: ORG });
    expect(result.ok).toBe(false);
  });
});
