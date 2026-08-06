import { describe, expect, it, vi } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { buildStoragePath, createFolder, createsFolderCycle, insertAsset, insertAssetWithUrl, moveAsset, reorderFolders, sanitizeFileName, setAvailableToArc, updateFolder, DEFAULT_MEDIA_FOLDERS, seedDefaultMediaFolders } from "./persistence";

/**
 * The invariant behind dragging one folder onto another.
 *
 * A cycle is not a cosmetic problem: `buildFolderViews` and the rail's renderer
 * both walk children recursively, so a folder made its own ancestor either
 * vanishes from the tree or recurses without end in the browser. The check is
 * pure so it can be exercised here rather than only against a database.
 */
describe("createsFolderCycle", () => {
  const rows = [
    { id: "a", parent_id: null },
    { id: "b", parent_id: "a" },
    { id: "c", parent_id: "b" },
    { id: "d", parent_id: null },
  ];

  it("refuses a folder's direct child", () => {
    expect(createsFolderCycle(rows, "a", "b")).toBe(true);
  });

  it("refuses a deeper descendant, not just the child", () => {
    expect(createsFolderCycle(rows, "a", "c")).toBe(true);
  });

  it("allows an unrelated branch, and allows moving a child up under a sibling", () => {
    expect(createsFolderCycle(rows, "a", "d")).toBe(false);
    expect(createsFolderCycle(rows, "c", "d")).toBe(false);
  });

  it("terminates on data that is already cyclic, and refuses rather than widening it", () => {
    const broken = [
      { id: "x", parent_id: "y" },
      { id: "y", parent_id: "x" },
      { id: "z", parent_id: null },
    ];
    expect(createsFolderCycle(broken, "z", "x")).toBe(true);
  });
});

describe("sanitizeFileName", () => {
  it("strips path separators and unsafe chars", () => {
    expect(sanitizeFileName("../../etc/p w!d.jpg")).toBe("p-w-d.jpg");
    expect(sanitizeFileName("photo.PNG")).toBe("photo.PNG");
  });
});

describe("buildStoragePath", () => {
  it("namespaces by org and asset id", () => {
    expect(buildStoragePath("org1", "asset1", "before.jpg")).toBe("library/org1/asset1-before.jpg");
  });
});

describe("createFolder", () => {
  // Two reads now: the existing siblings' sort_order, then the insert.
  const responses = (siblings: { sort_order: number }[]) => ({
    media_folders: [
      { data: siblings, error: null },
      { data: { id: "folder-2" }, error: null },
    ],
  });

  it("persists a parent folder when creating a subfolder", async () => {
    const supabase = createSupabaseQueryMock(responses([]));

    await createFolder({
      orgId: "org-1",
      name: "After photos",
      parentId: "folder-1",
      client: supabase,
    });

    expect(supabase.calls).toContainEqual([
      "insert",
      expect.objectContaining({
        org_id: "org-1",
        name: "After photos",
        parent_id: "folder-1",
      }),
    ]);
  });

  /**
   * `sort_order` is `not null default 0`, and this used to leave it there — so
   * every folder an operator made tied with whichever seeded folder also held
   * 0, and a tie on the only ORDER BY column lets Postgres return the rail in a
   * different order on different reads. Confirmed on the live tenant before
   * this was written: two folders both sat at 0.
   */
  it("puts a new folder after its existing siblings instead of tying them at 0", async () => {
    const supabase = createSupabaseQueryMock(responses([{ sort_order: 0 }, { sort_order: 3 }, { sort_order: 1 }]));

    await createFolder({ orgId: "org-1", name: "Storm 2026", client: supabase });

    expect(supabase.calls).toContainEqual(["insert", expect.objectContaining({ sort_order: 4 })]);
  });

  it("starts at 0 when the parent has no children yet", async () => {
    const supabase = createSupabaseQueryMock(responses([]));

    await createFolder({ orgId: "org-1", name: "First", client: supabase });

    expect(supabase.calls).toContainEqual(["insert", expect.objectContaining({ sort_order: 0 })]);
  });

  it("scopes the sibling lookup to the top level with `is`, not `eq`, for a null parent", async () => {
    const supabase = createSupabaseQueryMock(responses([]));

    await createFolder({ orgId: "org-1", name: "Top", client: supabase });

    // `.eq("parent_id", null)` does not match NULL rows in PostgREST — it would
    // silently see no siblings and hand every root folder the same 0.
    expect(supabase.calls).toContainEqual(["is", "parent_id", null]);
  });
});

describe("reorderFolders", () => {
  it("writes each id's position, and refuses ids that are not this parent's children", async () => {
    const supabase = createSupabaseQueryMock({
      media_folders: [
        { data: [{ id: "a" }, { id: "b" }], error: null },
        { data: [{ id: "a" }], error: null },
        { data: [{ id: "b" }], error: null },
      ],
    });

    // "zz" is not in the org's rows for this parent; the browser sent it, so it
    // does not get to decide membership.
    const written = await reorderFolders("org-1", "parent-1", ["b", "zz", "a"], supabase);

    expect(written).toBe(2);
    expect(supabase.calls).toContainEqual(["update", { sort_order: 0 }]);
    expect(supabase.calls).toContainEqual(["update", { sort_order: 1 }]);
    expect(supabase.calls).not.toContainEqual(["eq", "id", "zz"]);
  });
});

describe("updateFolder", () => {
  it("leaves a field alone when its key is absent, and clears it on an explicit null", async () => {
    const nameOnly = createSupabaseQueryMock({ media_folders: { data: [{ id: "f1" }], error: null } });
    await updateFolder("f1", { name: "Renamed" }, "org-1", nameOnly);
    expect(nameOnly.calls).toContainEqual(["update", { name: "Renamed" }]);

    const cleared = createSupabaseQueryMock({ media_folders: { data: [{ id: "f1" }], error: null } });
    await updateFolder("f1", { description: null }, "org-1", cleared);
    expect(cleared.calls).toContainEqual(["update", { description: null }]);
  });

  it("does not issue a write at all when the patch is empty", async () => {
    const supabase = createSupabaseQueryMock({ media_folders: { data: [{ id: "f1" }], error: null } });
    await updateFolder("f1", {}, "org-1", supabase);
    expect(supabase.calls).toEqual([]);
  });
});

describe("insertAsset", () => {
  it("persists source provenance for imported Google Drive files", async () => {
    const supabase = createSupabaseQueryMock({
      media_assets: [
        { data: { id: "asset-1" }, error: null },
        { data: null, error: null },
      ],
    });
    const uploaded: Array<{ path: string; contentType: string; bytes: Uint8Array }> = [];

    await insertAsset({
      orgId: "org-1",
      folderId: null,
      fileName: "Capabilities.pdf",
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
      kind: "document",
      byteSize: 3,
      source: "google_drive",
      provenance: {
        googleDriveFileId: "file-123",
        googleDriveWebUrl: "https://drive.google.com/file/d/file-123/view",
      },
      uploadedBy: "operator",
      client: supabase,
      uploader: async (path, bytes, contentType) => {
        uploaded.push({ path, bytes, contentType });
        return `https://cdn.example/${path}`;
      },
    });

    expect(uploaded).toEqual([
      {
        path: "library/org-1/asset-1-Capabilities.pdf",
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "application/pdf",
      },
    ]);
    expect(supabase.calls).toContainEqual([
      "insert",
      expect.objectContaining({
        source: "google_drive",
        provenance: {
          googleDriveFileId: "file-123",
          googleDriveWebUrl: "https://drive.google.com/file/d/file-123/view",
        },
      }),
    ]);
  });

  it("can return the uploaded public URL for brand profile assets", async () => {
    const supabase = createSupabaseQueryMock({
      media_assets: [
        { data: { id: "asset-logo" }, error: null },
        { data: null, error: null },
      ],
    });

    const result = await insertAssetWithUrl({
      orgId: "org-1",
      folderId: null,
      fileName: "logo.png",
      bytes: new Uint8Array([4, 5, 6]),
      contentType: "image/png",
      kind: "image",
      byteSize: 3,
      source: "uploaded",
      provenance: { brandRole: "logo" },
      uploadedBy: "operator",
      client: supabase,
      uploader: async (path) => `https://cdn.example/${path}`,
    });

    expect(result).toEqual({
      id: "asset-logo",
      url: "https://cdn.example/library/org-1/asset-logo-logo.png",
    });
  });
});

describe("DEFAULT_MEDIA_FOLDERS", () => {
  it("is a non-empty list with names and descriptions", () => {
    expect(DEFAULT_MEDIA_FOLDERS.length).toBeGreaterThan(0);
    for (const f of DEFAULT_MEDIA_FOLDERS) {
      expect(f.name.trim().length).toBeGreaterThan(0);
      expect(f.description.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("seedDefaultMediaFolders", () => {
  function clientWithFolderCount(count: number) {
    const insert = vi.fn(async (_rows: unknown) => ({ error: null }));
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ count, error: null })),
        })),
        insert,
      })),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;
    return { client, insert };
  }

  it("inserts the default set when the org has no folders", async () => {
    const { client, insert } = clientWithFolderCount(0);
    const created = await seedDefaultMediaFolders({ orgId: "org-1", client });
    expect(created).toBe(DEFAULT_MEDIA_FOLDERS.length);
    expect(insert).toHaveBeenCalledTimes(1);
    const rows = insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ org_id: "org-1", name: DEFAULT_MEDIA_FOLDERS[0].name, sort_order: 0 });
  });

  it("skips seeding when the org already has folders", async () => {
    const { client, insert } = clientWithFolderCount(3);
    const created = await seedDefaultMediaFolders({ orgId: "org-1", client });
    expect(created).toBe(0);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("available_to_arc on insert", () => {
  function assetClient() {
    return createSupabaseQueryMock({
      media_assets: [
        { data: { id: "asset-1" }, error: null },
        { data: null, error: null },
      ],
    });
  }

  const base = {
    orgId: "org-1",
    folderId: null,
    fileName: "roof.png",
    bytes: new Uint8Array([1]),
    contentType: "image/png",
    kind: "image",
    byteSize: 1,
    uploadedBy: "operator",
    uploader: async (path: string) => `https://cdn.example/${path}`,
  };

  // Regression: the row used to inherit the DB's `default true`, so operator uploads
  // were reusable by Arc (and mirrored into the Brain) the moment they landed —
  // while the Library promised they were held for provenance review.
  it("holds new uploads from Arc by default", async () => {
    const supabase = assetClient();
    await insertAssetWithUrl({ ...base, client: supabase });
    expect(supabase.calls).toContainEqual(["insert", expect.objectContaining({ available_to_arc: false })]);
  });

  it("lets brand-kit callers opt an asset in explicitly", async () => {
    const supabase = assetClient();
    await insertAssetWithUrl({ ...base, availableToArc: true, client: supabase });
    expect(supabase.calls).toContainEqual(["insert", expect.objectContaining({ available_to_arc: true })]);
  });
});

describe("setAvailableToArc", () => {
  function updateClient(rows: Array<{ id: string }>) {
    const calls: Array<[string, unknown]> = [];
    const builder: Record<string, unknown> = {};
    for (const method of ["update", "eq"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push([method, args.length > 1 ? args : args[0]]);
        return builder;
      };
    }
    builder.select = () => Promise.resolve({ data: rows, error: null });
    const client = { from: () => builder } as unknown as import("@supabase/supabase-js").SupabaseClient;
    return { client, calls };
  }

  // The service-role client bypasses RLS, so the org filter is the only thing
  // stopping an operator from flipping another tenant's asset.
  it("scopes the write to the caller's org", async () => {
    const { client, calls } = updateClient([{ id: "asset-1" }]);
    const matched = await setAvailableToArc("asset-1", true, "org-1", client);
    expect(matched).toBe(true);
    expect(calls).toContainEqual(["update", { available_to_arc: true }]);
    expect(calls).toContainEqual(["eq", ["org_id", "org-1"]]);
    expect(calls).toContainEqual(["eq", ["id", "asset-1"]]);
  });

  it("reports no match when the asset belongs to another org", async () => {
    const { client } = updateClient([]);
    expect(await setAvailableToArc("asset-1", true, "other-org", client)).toBe(false);
  });
});


/**
 * BSR-707. `moveAsset` was the one mutator in this file that took no orgId — it
 * updated on `id` alone. That was safe only because its single caller checked
 * ownership first, and "safe by external convention" runs out at the second
 * caller. The Library's move action is that second caller.
 */
describe("moveAsset", () => {
  it("scopes the update to the org, not just the id", async () => {
    const supabase = createSupabaseQueryMock({ media_assets: { data: [{ id: "a-1" }], error: null } });
    await moveAsset("a-1", "f-1", "org-1", supabase);
    expect(supabase.calls).toContainEqual(["update", { folder_id: "f-1" }]);
    expect(supabase.calls).toContainEqual(["eq", "id", "a-1"]);
    expect(supabase.calls).toContainEqual(["eq", "org_id", "org-1"]);
  });

  it("reports false when the row is not this org's, rather than a silent no-op", async () => {
    // An org-scoped UPDATE that matches nothing succeeds and changes nothing.
    // Returning void there would have reported someone else's asset as moved.
    const supabase = createSupabaseQueryMock({ media_assets: { data: [], error: null } });
    await expect(moveAsset("a-1", "f-1", "other-org", supabase)).resolves.toBe(false);
  });

  it("treats a null folder as the root, not as a missing argument", async () => {
    const supabase = createSupabaseQueryMock({ media_assets: { data: [{ id: "a-1" }], error: null } });
    await expect(moveAsset("a-1", null, "org-1", supabase)).resolves.toBe(true);
    expect(supabase.calls).toContainEqual(["update", { folder_id: null }]);
  });
});
