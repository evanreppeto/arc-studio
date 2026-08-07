import { describe, expect, it } from "vitest";

import {
  RAIL_FOLDER_CHATS,
  RAIL_FOLDER_LIMIT,
  RAIL_LOOSE_LIMIT,
  groupRailConversations,
  selectRailConversations,
} from "./rail-sections";

type Row = { id: string; campaignId?: string | null; campaignName?: string | null };

const chat = (id: string, campaignId?: string, campaignName?: string): Row => ({
  id,
  campaignId: campaignId ?? null,
  campaignName: campaignName ?? null,
});

describe("groupRailConversations", () => {
  it("folders a campaign that holds a single chat", () => {
    const { folders, loose } = groupRailConversations([chat("a", "c1", "Flood Response"), chat("b")]);
    expect(folders).toEqual([
      { campaignId: "c1", campaignName: "Flood Response", items: [chat("a", "c1", "Flood Response")] },
    ]);
    expect(loose.map((row) => row.id)).toEqual(["b"]);
  });

  it("orders folders by where the campaign first appears, so a sorted list yields recency order", () => {
    const { folders } = groupRailConversations([
      chat("newest", "c2", "Second"),
      chat("older", "c1", "First"),
      chat("oldest", "c2", "Second"),
    ]);
    expect(folders.map((folder) => folder.campaignId)).toEqual(["c2", "c1"]);
    expect(folders[0]?.items.map((row) => row.id)).toEqual(["newest", "oldest"]);
  });

  it("takes a campaign name from a later row when the first one had none", () => {
    const { folders } = groupRailConversations([chat("a", "c1"), chat("b", "c1", "Service Van")]);
    expect(folders[0]?.campaignName).toBe("Service Van");
  });

  it("names an unnameable campaign rather than dropping its chats", () => {
    const { folders } = groupRailConversations([chat("a", "c1")]);
    expect(folders[0]).toMatchObject({ campaignName: "Campaign", items: [expect.objectContaining({ id: "a" })] });
  });

  it("applies no caps of its own", () => {
    const rows = Array.from({ length: 40 }, (_, index) => chat(`n${index}`));
    expect(groupRailConversations(rows).loose).toHaveLength(40);
  });
});

describe("selectRailConversations", () => {
  /**
   * The regression this whole change exists for. Prod's five newest chats carry
   * no campaign and the campaign-bearing ones sit at 7 and 8, so a flat
   * "top 5 overall" budget renders zero folders no matter what the component
   * does with them. Reverting the split budget fails here.
   */
  it("reaches campaign chats that sit outside the newest five", () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, index) => chat(`loose${index}`)),
      chat("camp-a", "c1", "Flood Response"),
      chat("camp-b", "c1", "Flood Response"),
      chat("camp-c", "c2", "Service Van"),
    ];
    const kept = selectRailConversations(rows).map((row) => row.id);
    expect(kept).toContain("camp-a");
    expect(kept).toContain("camp-b");
    expect(kept).toContain("camp-c");
  });

  it("emits folder chats before unattached ones, folders in recency order", () => {
    const kept = selectRailConversations([
      chat("l1"),
      chat("camp-new", "c2", "Second"),
      chat("camp-old", "c1", "First"),
      chat("l2"),
    ]);
    expect(kept.map((row) => row.id)).toEqual(["camp-new", "camp-old", "l1", "l2"]);
  });

  it("caps folders, per-folder chats, and unattached chats independently", () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, index) => chat(`c1-${index}`, "c1", "One")),
      ...Array.from({ length: 9 }, (_, index) => chat(`c2-${index}`, "c2", "Two")),
      ...Array.from({ length: 3 }, (_, index) => chat(`c3-${index}`, "c3", "Three")),
      ...Array.from({ length: 2 }, (_, index) => chat(`c4-${index}`, "c4", "Four")),
      ...Array.from({ length: 9 }, (_, index) => chat(`loose${index}`)),
    ];
    const { folders, loose } = groupRailConversations(selectRailConversations(rows));

    expect(folders).toHaveLength(RAIL_FOLDER_LIMIT);
    expect(folders.map((folder) => folder.campaignId)).toEqual(["c1", "c2", "c3"]);
    expect(folders[1]?.items).toHaveLength(RAIL_FOLDER_CHATS);
    expect(loose).toHaveLength(RAIL_LOOSE_LIMIT);
  });

  it("keeps a pinned chat the unattached cap would have dropped", () => {
    const rows = Array.from({ length: 9 }, (_, index) => chat(`loose${index}`));
    const kept = selectRailConversations(rows, { pinnedIds: ["loose8"] }).map((row) => row.id);
    expect(kept).toContain("loose8");
    expect(kept).toHaveLength(RAIL_LOOSE_LIMIT + 1);
  });

  it("keeps a pinned chat with its folder when the folder itself missed the cut", () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, index) => chat(`c${index}-x`, `c${index}`, `Campaign ${index}`)),
    ];
    const kept = selectRailConversations(rows, { pinnedIds: ["c3-x"] });
    const { folders } = groupRailConversations(kept);
    expect(folders.map((folder) => folder.campaignId)).toEqual(["c0", "c1", "c2", "c3"]);
    expect(folders.at(-1)?.items.map((row) => row.id)).toEqual(["c3-x"]);
  });

  it("does not duplicate a pinned chat that was already inside the cap", () => {
    const rows = Array.from({ length: 3 }, (_, index) => chat(`loose${index}`));
    expect(selectRailConversations(rows, { pinnedIds: ["loose0"] }).map((row) => row.id)).toEqual([
      "loose0",
      "loose1",
      "loose2",
    ]);
  });

  it("ignores a pinned id that names no chat", () => {
    expect(selectRailConversations([chat("a")], { pinnedIds: ["gone", null, undefined] })).toHaveLength(1);
  });

  it("returns nothing for an empty workspace", () => {
    expect(selectRailConversations([])).toEqual([]);
  });
});
