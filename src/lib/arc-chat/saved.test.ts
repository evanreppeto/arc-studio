import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock, type MockSupabase } from "@/lib/repos/__tests__/test-helpers";

import { saveItem, listSavedItems, removeSavedItem, getSavedItem, markPromoted } from "./saved";

function calls(supabase: MockSupabase, method: string): Array<Record<string, unknown>> {
  return supabase.calls.filter(([m]) => m === method).map(([, arg]) => arg as Record<string, unknown>);
}

const ROW = {
  id: "s1",
  operator: "op",
  kind: "media",
  title: "t",
  body: null,
  media_url: "u",
  caption: "c",
  source_conversation_id: "c1",
  source_message_id: "m1",
  source_campaign_id: null,
  source_asset_id: null,
  note: null,
  promoted_campaign_id: null,
  promoted_asset_id: null,
  created_at: "2026-01-01",
};

describe("saved.ts", () => {
  it("saveItem maps camelCase input to snake_case columns and returns a SavedItem", async () => {
    const supabase = createSupabaseQueryMock({ arc_saved_items: { data: ROW, error: null } });

    const item = await saveItem(
      { operator: "op", orgId: "org-1", kind: "media", title: "t", mediaUrl: "u", caption: "c", sourceConversationId: "c1", sourceMessageId: "m1" },
      supabase,
    );

    const payload = calls(supabase, "insert")[0];
    expect(payload.media_url).toBe("u");
    expect(payload.source_conversation_id).toBe("c1");
    expect(payload.kind).toBe("media");
    // arc_saved_items.org_id is NOT NULL with no default. This test used to omit
    // it and still pass, because a mocked client cannot enforce a constraint —
    // the insert it asserted on would have been rejected by Postgres.
    expect(payload.org_id).toBe("org-1");
    expect(item.mediaUrl).toBe("u");
    expect(item.kind).toBe("media");
  });

  it("listSavedItems maps rows and filters by operator newest-first", async () => {
    const supabase = createSupabaseQueryMock({ arc_saved_items: { data: [{ ...ROW, kind: "angle", body: "B" }], error: null } });

    const items = await listSavedItems("op", supabase);

    expect(supabase.calls).toContainEqual(["eq", "operator", "op"]);
    expect(supabase.calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(items[0].kind).toBe("angle");
    expect(items[0].body).toBe("B");
  });

  it("getSavedItem returns null when no row", async () => {
    const supabase = createSupabaseQueryMock({ arc_saved_items: { data: null, error: null } });
    expect(await getSavedItem("nope", "op", supabase)).toBeNull();
  });

  it("markPromoted writes promoted ids", async () => {
    const supabase = createSupabaseQueryMock({ arc_saved_items: { data: null, error: null } });

    await markPromoted("s1", { campaignId: "camp", assetId: "asset" }, supabase);

    const payload = calls(supabase, "update")[0];
    expect(payload.promoted_campaign_id).toBe("camp");
    expect(payload.promoted_asset_id).toBe("asset");
  });

  it("removeSavedItem resolves", async () => {
    const supabase = createSupabaseQueryMock({ arc_saved_items: { data: null, error: null } });
    await expect(removeSavedItem("s1", "op", supabase)).resolves.toBeUndefined();
  });
});
