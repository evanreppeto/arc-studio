import { describe, expect, it } from "vitest";

import { MEDIA_RESOLVE_MESSAGE, mediaReviewKey, resolveMediaAssetId } from "./media-identity";

/**
 * A Supabase stand-in that records the filters each query applied, so a test can
 * assert what was ASKED FOR and not merely what came back. That distinction is
 * the point here: `media_assets` is workspace-owned and the service role
 * bypasses RLS, so on a server-side read the app-layer filter is the entire
 * boundary. A resolver that returned the right row while forgetting to ask for
 * the workspace would pass every behavioural assertion and still be the leak.
 */
function fakeClient(rows: Array<{ id: string; org_id: string; workspace_id: string; storage_path?: string }>) {
  const queries: Array<Record<string, string>> = [];
  return {
    queries,
    from() {
      const filters: Record<string, string> = {};
      const builder = {
        select: () => builder,
        eq(column: string, value: string) {
          filters[column] = value;
          return builder;
        },
        maybeSingle: async () => {
          queries.push({ ...filters });
          const hit = rows.find((row) =>
            Object.entries(filters).every(([column, value]) => (row as Record<string, unknown>)[column] === value),
          );
          return { data: hit ? { id: hit.id } : null, error: null };
        },
      };
      return builder;
    },
  };
}

const ORG = "org-1";
const WS = "ws-1";

describe("mediaReviewKey", () => {
  it("prefers the recorded id over the storage path", () => {
    expect(mediaReviewKey({ libraryAssetId: "asset-1", storagePath: "arc-generated/x.jpg" })).toBe("id:asset-1");
  });

  it("falls back to the path, which is all prod entries have today", () => {
    expect(mediaReviewKey({ libraryAssetId: null, storagePath: "arc-generated/x.jpg" })).toBe(
      "path:arc-generated/x.jpg",
    );
  });

  it("is null when the entry has no identity at all", () => {
    expect(mediaReviewKey({ libraryAssetId: null, storagePath: null })).toBeNull();
  });
});

describe("resolveMediaAssetId", () => {
  it("resolves by id when the producer recorded one", async () => {
    const client = fakeClient([{ id: "asset-1", org_id: ORG, workspace_id: WS }]);
    const res = await resolveMediaAssetId(client as never, { libraryAssetId: "asset-1", storagePath: null }, ORG, WS);
    expect(res).toEqual({ ok: true, assetId: "asset-1" });
  });

  it("resolves by storage path when no id was recorded", async () => {
    const client = fakeClient([{ id: "asset-2", org_id: ORG, workspace_id: WS, storage_path: "arc-generated/x.jpg" }]);
    const res = await resolveMediaAssetId(
      client as never,
      { libraryAssetId: null, storagePath: "arc-generated/x.jpg" },
      ORG,
      WS,
    );
    expect(res).toEqual({ ok: true, assetId: "asset-2" });
  });

  // An id pointing at a since-deleted row must not shadow a good path match, or
  // one stale reference would make a decidable picture undecidable forever.
  it("falls through to the path when the recorded id no longer exists", async () => {
    const client = fakeClient([{ id: "asset-3", org_id: ORG, workspace_id: WS, storage_path: "arc-generated/y.jpg" }]);
    const res = await resolveMediaAssetId(
      client as never,
      { libraryAssetId: "deleted-asset", storagePath: "arc-generated/y.jpg" },
      ORG,
      WS,
    );
    expect(res).toEqual({ ok: true, assetId: "asset-3" });
  });

  // The security case. A storage path is guessable, and the id this returns is
  // about to become the subject of an approval record.
  it("refuses a row belonging to another org", async () => {
    const client = fakeClient([
      { id: "asset-4", org_id: "other-org", workspace_id: "other-ws", storage_path: "arc-generated/z.jpg" },
    ]);
    const res = await resolveMediaAssetId(
      client as never,
      { libraryAssetId: null, storagePath: "arc-generated/z.jpg" },
      ORG,
      WS,
    );
    expect(res).toEqual({ ok: false, reason: "not_in_library" });
  });

  // The case that is NOT a live leak today (one workspace per org) and becomes
  // one the day multi-workspace-per-org ships — which is why it is asserted now.
  it("refuses a row in a sibling workspace of the same org", async () => {
    const client = fakeClient([
      { id: "asset-5", org_id: ORG, workspace_id: "ws-2", storage_path: "arc-generated/sibling.jpg" },
    ]);
    const res = await resolveMediaAssetId(
      client as never,
      { libraryAssetId: null, storagePath: "arc-generated/sibling.jpg" },
      ORG,
      WS,
    );
    expect(res).toEqual({ ok: false, reason: "not_in_library" });
  });

  it("carries both tenant filters on every query it issues", async () => {
    const client = fakeClient([]);
    await resolveMediaAssetId(client as never, { libraryAssetId: "a", storagePath: "p" }, ORG, WS);
    expect(client.queries.length).toBe(2); // id attempt, then path attempt
    for (const query of client.queries) {
      expect(query.org_id).toBe(ORG);
      expect(query.workspace_id).toBe(WS);
    }
  });

  // The two failures read differently to an operator, so they must stay distinct
  // rather than collapsing into one "couldn't do it".
  it("distinguishes no-identity from not-in-library", async () => {
    const client = fakeClient([]);
    expect(await resolveMediaAssetId(client as never, { libraryAssetId: null, storagePath: null }, ORG, WS)).toEqual({
      ok: false,
      reason: "no_identity",
    });
    expect(
      await resolveMediaAssetId(client as never, { libraryAssetId: null, storagePath: "arc-composite/a.png" }, ORG, WS),
    ).toEqual({ ok: false, reason: "not_in_library" });
  });

  it("has an operator-readable message for every failure", () => {
    for (const reason of ["no_identity", "not_in_library"] as const) {
      expect(MEDIA_RESOLVE_MESSAGE[reason].length).toBeGreaterThan(20);
      // The deliverable's own approval still works, and saying so stops the
      // message reading as "this campaign is stuck".
      expect(MEDIA_RESOLVE_MESSAGE[reason]).toMatch(/deliverable/i);
    }
  });
});
