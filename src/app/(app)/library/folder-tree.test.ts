import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { dropZoneFor, flattenFolders, reorderIds, ROOT_FOLDER, siblingsOf, subtreeIds, type Folder } from "./_components/folder-tree";

/**
 * The rail's pure parts.
 *
 * `subtreeIds` is the client half of the same invariant `createsFolderCycle`
 * enforces on the server (see media-library/persistence.test.ts): it decides
 * which rows may light up as drop targets while a folder is in the air. The
 * server is the authority, but a rail that offers a drop it knows will be
 * refused is a rail that lies.
 */
const TREE: Folder[] = [
  { f: ROOT_FOLDER, name: "All assets", color: "#c8a24a", icon: "grid" },
  {
    f: "brand",
    name: "Brand kit",
    color: "#c47055",
    icon: "shield",
    children: [{ f: "logos", name: "Logos & marks", color: "#9aa0ac", icon: "mark", children: [{ f: "mono", name: "Mono", color: "#9aa0ac", icon: "mark" }] }],
  },
  { f: "real", name: "Real photos", color: "#7fb89a", icon: "photo" },
];

describe("subtreeIds", () => {
  it("includes the folder and every descendant, however deep", () => {
    expect([...subtreeIds(TREE, "brand")].sort()).toEqual(["brand", "logos", "mono"]);
  });

  it("does not include a sibling, so an unrelated branch stays a legal target", () => {
    expect(subtreeIds(TREE, "brand").has("real")).toBe(false);
  });

  it("returns an empty set for an id the tree no longer has", () => {
    expect([...subtreeIds(TREE, "deleted")]).toEqual([]);
  });
});

describe("flattenFolders", () => {
  it("lists folders depth-first with their depth, for the move-into menu's indentation", () => {
    expect(flattenFolders(TREE).map(({ node, depth }) => `${depth}:${node.f}`)).toEqual([
      "0:brand",
      "1:logos",
      "2:mono",
      "0:real",
    ]);
  });

  it("leaves the root row out — it is a filter, not a destination folder", () => {
    expect(flattenFolders(TREE).some(({ node }) => node.f === ROOT_FOLDER)).toBe(false);
  });
});

/**
 * The drop-position model. One gesture has to do two different things — file a
 * folder INSIDE another, or place it BETWEEN two — so which one is decided by
 * where in the row the pointer is. Filing into is the common intent, so it gets
 * the widest band.
 */
describe("dropZoneFor", () => {
  it("reads the top and bottom edges as re-order, the middle as re-parent", () => {
    expect(dropZoneFor(2, 36)).toBe("before");
    expect(dropZoneFor(18, 36)).toBe("into");
    expect(dropZoneFor(34, 36)).toBe("after");
  });

  it("gives the middle a wider band than either edge, because filing in is the common intent", () => {
    const zones = Array.from({ length: 36 }, (_, y) => dropZoneFor(y, 36));
    const width = (zone: string) => zones.filter((z) => z === zone).length;
    expect(width("into")).toBeGreaterThan(width("before"));
    expect(width("into")).toBeGreaterThan(width("after"));
    // And the edges stay big enough to hit — a 3px reorder strip is a target
    // nobody lands on deliberately.
    expect(Math.min(width("before"), width("after"))).toBeGreaterThanOrEqual(8);
  });

  it("answers 'into' for a zero-height row rather than dividing by it", () => {
    expect(dropZoneFor(0, 0)).toBe("into");
  });
});

describe("siblingsOf", () => {
  it("finds a nested folder's parent and that parent's children in order", () => {
    expect(siblingsOf(TREE, "mono")).toEqual({ parentId: "logos", siblings: [expect.objectContaining({ f: "mono" })] });
  });

  it("reports the top level as a null parent, and leaves the root row out of it", () => {
    const found = siblingsOf(TREE, "real");
    expect(found?.parentId).toBeNull();
    expect(found?.siblings.map((n) => n.f)).toEqual(["brand", "real"]);
  });
});

describe("reorderIds", () => {
  const ids = ["a", "b", "c", "d"];

  it("lifts the moved id out of its slot before re-inserting it", () => {
    // Not ["a","b","b","c"] — the naive splice-in-place that forgets to remove
    // first duplicates the folder and drops another.
    expect(reorderIds(ids, "b", "d", "before")).toEqual(["a", "c", "b", "d"]);
    expect(reorderIds(ids, "d", "a", "before")).toEqual(["d", "a", "b", "c"]);
    expect(reorderIds(ids, "a", "c", "after")).toEqual(["b", "c", "a", "d"]);
  });

  it("leaves the list alone when the anchor isn't in it", () => {
    expect(reorderIds(ids, "a", "zz", "before")).toEqual(ids);
  });
});

/**
 * `buildFolderViews` puts a synthetic `{ id: "all" }` row at the head of its
 * list, and `mapFolders` used to map it like any other folder — so a live
 * workspace rendered the root twice, with duplicate React keys, while the
 * backend-less preview (which builds its tree from a constant) looked fine.
 * Asserted against the source because the page is an async server component
 * whose helper is not exported.
 */
describe("the library page's folder mapping", () => {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

  it("drops the read model's synthetic root before building the tree", () => {
    expect(source).toMatch(/views\.filter\(\(v\) => v\.id !== "all"\)/);
  });

  it("carries each folder's description through to the rail", () => {
    expect(source).toContain("description: v.description");
  });
});
