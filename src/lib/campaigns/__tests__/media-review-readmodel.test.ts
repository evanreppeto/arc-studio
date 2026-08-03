import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { mapMediaAssetForTest, mediaReviewStateFromStatus, resolveMediaReviewsForTest } from "../read-model";

/** A campaign media entry shaped like prod's: a storage path, no library id. */
function mediaFixture() {
  return mapMediaAssetForTest({ url: "https://x/a.png", path: "arc-generated/org/a.png" }, "Asset audit", "attached")!;
}

describe("media review join keys", () => {
  it("carries the library asset id and the storage path off the entry", () => {
    const asset = mapMediaAssetForTest(
      { url: "https://x/a.png", library_asset_id: "lib-1", path: "arc-generated/org/a.png" },
      "Asset audit",
      "attached",
    );

    expect(asset?.libraryAssetId).toBe("lib-1");
    expect(asset?.storagePath).toBe("arc-generated/org/a.png");
  });

  // Every campaign media entry in prod lacks a library_asset_id, so the path is
  // the only join key that resolves anything today.
  it("still carries the path when no id was recorded", () => {
    const asset = mapMediaAssetForTest({ url: "https://x/b.png", path: "arc-generated/org/b.png" }, "s", "attached");

    expect(asset?.libraryAssetId).toBeNull();
    expect(asset?.storagePath).toBe("arc-generated/org/b.png");
  });

  it("starts unreviewed — an absent approval row is not a clean review", () => {
    const asset = mapMediaAssetForTest({ url: "https://x/c.png" }, "s", "attached");

    expect(asset?.review).toEqual({ state: "unreviewed", reviewer: null, reviewedAt: null, notes: null });
  });
});

describe("mediaReviewStateFromStatus", () => {
  it("maps the decisions approval_items records", () => {
    expect(mediaReviewStateFromStatus("approved")).toBe("approved");
    expect(mediaReviewStateFromStatus("declined")).toBe("declined");
    expect(mediaReviewStateFromStatus("rejected")).toBe("declined");
    expect(mediaReviewStateFromStatus("needs_revision")).toBe("needs_revision");
    expect(mediaReviewStateFromStatus("archived")).toBe("archived");
    expect(mediaReviewStateFromStatus("pending_approval")).toBe("pending");
  });

  // The failure that matters: an unrecognized status must never read as a
  // decision. Falling through to "approved" would unlock nothing, but it would
  // tell a reviewer someone signed off when nobody did.
  it("treats an unknown or empty status as pending, never as approved", () => {
    for (const status of ["", null, undefined, "wat", "queued", "in_review"]) {
      expect(mediaReviewStateFromStatus(status)).toBe("pending");
    }
  });
});

describe("resolveMediaReviews", () => {
  it("joins entry.path -> media_assets.storage_path -> approval_items", async () => {
    const client = createSupabaseQueryMock({
      media_assets: { data: [{ id: "ma-1", storage_path: "arc-generated/org/a.png" }], error: null },
      approval_items: {
        data: [
          {
            media_asset_id: "ma-1",
            status: "declined",
            reviewed_by: "evan@bsr.test",
            reviewed_at: "2026-08-01T10:00:00.000Z",
            decision_notes: "Face is identifiable.",
            created_at: "2026-08-01T10:00:00.000Z",
          },
        ],
        error: null,
      },
    });

    const reviews = await resolveMediaReviewsForTest(client, [mediaFixture()], "org-1");

    expect(reviews.get("path:arc-generated/org/a.png")).toEqual({
      state: "declined",
      reviewer: "evan@bsr.test",
      reviewedAt: "2026-08-01T10:00:00.000Z",
      notes: "Face is identifiable.",
    });
  });

  // The prod state today: Library rows exist, approval rows do not.
  it("returns nothing when the asset has no approval row, so it stays unreviewed", async () => {
    const client = createSupabaseQueryMock({
      media_assets: { data: [{ id: "ma-1", storage_path: "arc-generated/org/a.png" }], error: null },
      approval_items: { data: [], error: null },
    });

    const reviews = await resolveMediaReviewsForTest(client, [mediaFixture()], "org-1");

    expect(reviews.size).toBe(0);
  });

  it("returns nothing when the media cannot be joined at all", async () => {
    const client = createSupabaseQueryMock({
      media_assets: { data: [], error: null },
      approval_items: { data: [], error: null },
    });

    const reviews = await resolveMediaReviewsForTest(client, [mediaFixture()], "org-1");

    expect(reviews.size).toBe(0);
  });

  // A failed lookup must degrade to "nobody reviewed this", never to a decision.
  it("degrades to unreviewed when the lookup errors", async () => {
    const client = createSupabaseQueryMock({
      media_assets: { data: null, error: { message: "boom" } },
      approval_items: { data: null, error: { message: "boom" } },
    });

    const reviews = await resolveMediaReviewsForTest(client, [mediaFixture()], "org-1");

    expect(reviews.size).toBe(0);
  });

  it("scopes both lookups to the org", async () => {
    const client = createSupabaseQueryMock({
      media_assets: { data: [{ id: "ma-1", storage_path: "arc-generated/org/a.png" }], error: null },
      approval_items: { data: [], error: null },
    });

    await resolveMediaReviewsForTest(client, [mediaFixture()], "org-1");

    expect(client.calls.filter((call) => call[0] === "eq" && call[1] === "org_id" && call[2] === "org-1").length).toBeGreaterThan(0);
  });

  it("does no work when nothing carries a join key", async () => {
    const client = createSupabaseQueryMock({});
    const noKeys = mapMediaAssetForTest({ url: "https://x/keyless.png" }, "Asset audit", "attached")!;

    const reviews = await resolveMediaReviewsForTest(client, [noKeys], "org-1");

    expect(reviews.size).toBe(0);
    expect(client.calls.filter((call) => call[0] === "from")).toHaveLength(0);
  });
});
