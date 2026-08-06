"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { formatByteSize, WORK_STATE_LABEL } from "@/domain";

import { createLibraryFolder, decideLibraryAsset, deleteLibraryAsset, deleteLibraryFolder, importLibraryAssetFromUrl, moveLibraryAssets, moveLibraryFolder, renameLibraryAsset, renameLibraryFolder, reorderLibraryFolders, setLibraryAssetArcAvailability, setLibraryAssetTags, updateLibraryFolder, uploadLibraryAsset } from "../actions";
import { addLibraryAssetsToCampaign } from "../actions";
import { FolderDetailsModal } from "./folder-details-modal";
import { ImportUrlModal } from "./import-url-modal";
import { NewFolderModal } from "./new-folder-modal";
import { DRAG_ASSETS, FolderTree, ROOT_FOLDER, type Folder } from "./folder-tree";
import { RAIL_MAX, RAIL_MIN, TILE_SIZES, getLibraryPrefs, getServerLibraryPrefs, setLibraryPrefs, subscribeLibraryPrefs, type TileSize } from "./library-prefs";
import { Define } from "../../_components/define";
import { OverlayPortal } from "../../_components/overlay-portal";
import { AppImage } from "../../_components/app-image";

type Kind = "image" | "video" | "logo" | "document";
type Prov = "real" | "ai" | "comp" | "upload" | "logo" | "doc";

export type Asset = {
  id: number;
  /** Real media_assets uuid when this asset came from the DB (absent for mock/session rows). */
  rid?: string;
  nm: string;
  kind: Kind;
  pv: Prov;
  sc: string;
  folder: string;
  dim: string;
  size: string;
  tags: string[];
  arc: boolean;
  used: string[];
  src?: string;
  by: string;
  added: string;
  recent: number;
  risk?: string;
  /**
   * The asset's recorded approval state, when it has one. Approving a flagged
   * asset acknowledges the flag rather than clearing it, so `risk` alone cannot
   * say whether anyone has reviewed it.
   */
  approvalStatus?: string;
  /** Generation prompt from stored provenance — shown on the detail card. */
  prompt?: string;
  img?: string;
  lineage: [string, string][];
  uses: number;
};

export type { Folder } from "./folder-tree";

// Inline SVG placeholders (verbatim from the mockup) — used when no CDN image is set.
const SC: Record<string, string> = {
  photo: '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="lp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4654"/><stop offset="1" stop-color="#27303a"/></linearGradient></defs><rect width="100" height="100" fill="url(#lp)"/><path d="M0 72 L26 52 L48 66 L74 46 L100 60 V100 H0 Z" fill="#2b343d"/><circle cx="76" cy="26" r="9" fill="rgba(255,240,200,.5)"/></svg>',
  crew: '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><rect width="100" height="100" fill="#2c333b"/><circle cx="38" cy="42" r="11" fill="#4a5663"/><circle cx="64" cy="46" r="9" fill="#3d4854"/><path d="M16 92c0-14 12-20 26-20s24 6 24 20" fill="#404a55"/></svg>',
  ui: '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><rect width="100" height="100" fill="#1a2230"/><rect x="14" y="18" width="72" height="10" rx="2" fill="#2a3850"/><rect x="14" y="34" width="40" height="40" rx="3" fill="#243043"/><rect x="60" y="34" width="26" height="18" rx="3" fill="#2f3e57"/><rect x="60" y="56" width="26" height="18" rx="3" fill="#2f3e57"/></svg>',
  ai: '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="la" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a3052"/><stop offset="1" stop-color="#1c2230"/></linearGradient></defs><rect width="100" height="100" fill="url(#la)"/><circle cx="50" cy="44" r="18" fill="#5a4d7a"/><path d="M18 92c0-15 14-22 32-22s32 7 32 22" fill="#473c66"/></svg>',
  ai2: '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="la2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4452"/><stop offset="1" stop-color="#222a32"/></linearGradient></defs><rect width="100" height="100" fill="url(#la2)"/><path d="M0 60 L30 44 L55 56 L80 40 L100 50 V100 H0 Z" fill="#2c3640"/><circle cx="74" cy="24" r="10" fill="rgba(200,162,74,.4)"/></svg>',
  comp: '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="lc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c333b"/><stop offset="1" stop-color="#191e24"/></linearGradient></defs><rect width="100" height="100" fill="url(#lc)"/><rect x="18" y="38" width="64" height="22" rx="3" fill="rgba(200,162,74,.18)" stroke="rgba(200,162,74,.5)"/><rect x="18" y="66" width="34" height="8" rx="2" fill="rgba(200,162,74,.3)"/></svg>',
  video: '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><rect width="100" height="100" fill="#222a30"/><path d="M0 70 L40 50 L70 64 L100 44 V100 H0 Z" fill="#2e3a42"/></svg>',
  logo: '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><rect width="100" height="100" fill="#1b1b20"/><rect x="34" y="34" width="32" height="32" rx="8" fill="none" stroke="#c8a24a" stroke-width="3"/><text x="50" y="58" text-anchor="middle" font-family="Fraunces,serif" font-size="20" fill="#c8a24a" font-weight="600">A</text></svg>',
  logo2: '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><rect width="100" height="100" fill="#26262d"/><rect x="34" y="34" width="32" height="32" rx="8" fill="none" stroke="#f1ede2" stroke-width="3"/><text x="50" y="58" text-anchor="middle" font-family="Fraunces,serif" font-size="20" fill="#f1ede2" font-weight="600">A</text></svg>',
  doc: '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><rect width="100" height="100" fill="#1b1b20"/><rect x="34" y="24" width="32" height="44" rx="3" fill="#26262d" stroke="#3a3a42"/><path d="M40 36h20M40 44h20M40 52h14" stroke="#83838c" stroke-width="2"/><path d="M58 24v8h8" fill="none" stroke="#3a3a42" stroke-width="2"/></svg>',
  beforeafter: '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><rect width="50" height="100" fill="#34302a"/><rect x="50" width="50" height="100" fill="#2a3b34"/><path d="M8 72 L25 56 L42 72 Z" fill="#4a443a"/><path d="M58 72 L75 56 L92 72 Z" fill="#3e5a4c"/><rect x="48" width="4" height="100" fill="rgba(200,162,74,.5)"/></svg>',
};
/** What a shape is good for. The pixel count is still on the detail panel for
 *  anyone who needs it; the card says where the thing can go. */
function shapeUse(dim: string): string | null {
  const [w, h] = dim.split("×").map((n) => Number.parseInt(n.replace(/\D/g, ""), 10));
  if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) return null;
  const ratio = w / h;
  if (ratio > 1.6) return "wide — web banner";
  if (ratio > 1.15) return "landscape";
  if (ratio > 0.9) return "square — feed post";
  if (ratio > 0.7) return "tall — feed post";
  return "story / reel";
}

const PVL: Record<Prov, string> = { real: "Real", ai: "AI", comp: "Photo + text", upload: "Imported", logo: "Logo", doc: "Doc" };
const SORTS: readonly (readonly ["recent" | "name" | "used", string])[] = [
  ["recent", "Recently added"],
  ["name", "Name (A–Z)"],
  ["used", "Most used"],
] as const;
const IMGBASE = "https://d8j0ntlcm91z4.cloudfront.net/user_3FaOq1cCR2Izxa2haYxVnIrhIBK/";
const IMG = {
  team: IMGBASE + "hf_20260625_205928_522fa33a-3aa6-4e05-8a8b-db2bd83a688d_min.webp",
  dash: IMGBASE + "hf_20260625_205928_16464999-955a-4ad8-9f7e-44da9947830a_min.webp",
  gold: IMGBASE + "hf_20260625_205929_a9338cf5-b522-492f-beec-7dbde6855c47_min.webp",
  net: IMGBASE + "hf_20260625_205931_37df2ef4-9e88-4343-ae6d-ef6341c2fdcd_min.webp",
  face: IMGBASE + "hf_20260625_205931_f15ef3f6-cbb7-40e4-a6d8-addb78e7ccb0_min.webp",
};
const SC2IMG: Record<string, string> = { photo: IMG.team, crew: IMG.team, ui: IMG.dash, ai: IMG.gold, ai2: IMG.net, comp: IMG.net, beforeafter: IMG.gold, video: IMG.dash };

const TREE: Folder[] = [
  { f: "all", name: "All assets", color: "#c8a24a", icon: "grid" },
  { f: "brand", name: "Brand kit", color: "#c47055", icon: "shield", children: [{ f: "logos", name: "Logos & marks", color: "#9aa0ac", icon: "mark" }] },
  { f: "real", name: "Real photos", color: "#7fb89a", icon: "photo", children: [{ f: "customers", name: "Customer photos", color: "#7fb89a", icon: "photo" }] },
  { f: "ai", name: "AI-generated", color: "#c8a24a", icon: "sparkle" },
  { f: "comp", name: "Photo + text mockups", color: "#8fa2ba", icon: "layers" },
  { f: "upload", name: "Imported", color: "#88b6d8", icon: "import" },
  { f: "video", name: "Videos", color: "#bd6a58", icon: "video" },
];

const DIMS: Record<Kind, string[]> = {
  image: ["2400×1600", "1920×1080", "1600×1200", "2000×2000"],
  video: ["1080×1920 · 0:12", "1920×1080 · 0:18", "1080×1080 · 0:08"],
  logo: ["512×512", "1024×1024"],
  document: ["PDF · 2 pages", "PDF · 1 page"],
};

function buildAssets(): Asset[] {
  const A: Asset[] = [
    { id: 1, nm: "Storm-zone roof hero", kind: "image", pv: "real", sc: "photo", folder: "real", dim: "2400×1600", size: "3.4 MB", tags: ["hero", "storm"], arc: true, used: ["Storm Rapid Response"], src: "Upload · brand drive", by: "Evan", added: "2d ago", recent: 1, lineage: [["real", "Uploaded to brand drive"], ["real", "Tagged & approved by you"]], uses: 0 },
    { id: 2, nm: "Crew on site", kind: "image", pv: "real", sc: "crew", folder: "real", dim: "2000×1333", size: "2.1 MB", tags: ["team", "candid"], arc: true, used: [], src: "Upload · brand drive", by: "Evan", added: "5d ago", recent: 0, lineage: [["real", "Uploaded to brand drive"]], uses: 0 },
    { id: 3, nm: "Before / after — storm repair", kind: "image", pv: "comp", sc: "beforeafter", folder: "comp", dim: "1080×1080", size: "820 KB", tags: ["before-after", "proof"], arc: true, used: ["Autumn Boost"], src: "Arc composite", by: "Arc", added: "1d ago", recent: 1, lineage: [["real", "Real before/after photos"], ["comp", "Composited by Arc"], ["comp", "Used in Autumn Boost"]], uses: 0 },
    { id: 4, nm: "AI hero — storm sky", kind: "image", pv: "ai", sc: "ai", folder: "ai", dim: "1024×1024", size: "1.2 MB", tags: ["ai", "storm"], arc: true, used: [], src: "Higgsfield · seedream", by: "Arc", added: "3d ago", recent: 0, lineage: [["ai", "Made in Higgsfield · seedream"], ["ai", "Source job · hf_20260720_1142"], ["ai", "Approved for Arc reuse"]], prompt: "Dramatic storm sky over a suburban Chicago roofline, golden-hour break in the clouds, photoreal, no people, no text.", uses: 0 },
    { id: 5, nm: "AI seasonal banner", kind: "image", pv: "ai", sc: "ai2", folder: "ai", dim: "1536×640", size: "960 KB", tags: ["ai", "banner"], arc: false, risk: "Embedded text detected — may not be legible at small sizes.", used: [], src: "Higgsfield · flux", by: "Arc", added: "4d ago", recent: 0, lineage: [["ai", "Generated by Higgsfield (flux)"], ["ai", "Flagged: embedded text"]], uses: 0 },
    { id: 6, nm: "Logo lockup — gold", kind: "logo", pv: "logo", sc: "logo", folder: "logos", dim: "512×512", size: "48 KB", tags: ["logo", "primary"], arc: true, used: ["all campaigns"], src: "Brand kit", by: "Evan", added: "30d ago", recent: 0, lineage: [["logo", "Brand kit — primary mark"]], uses: 0 },
    { id: 7, nm: "Logo — mono white", kind: "logo", pv: "logo", sc: "logo2", folder: "logos", dim: "512×512", size: "42 KB", tags: ["logo", "mono"], arc: true, used: [], src: "Brand kit", by: "Evan", added: "30d ago", recent: 0, lineage: [["logo", "Brand kit — mono variant"]], uses: 0 },
    { id: 8, nm: "Maple Grove HOA case study PDF", kind: "document", pv: "doc", sc: "doc", folder: "brand", dim: "PDF · 1 page", size: "410 KB", tags: ["case-study", "proof"], arc: true, used: ["Storm Rapid Response"], src: "Upload", by: "Evan", added: "6d ago", recent: 0, lineage: [["doc", "Uploaded case study"], ["doc", "Attached to Storm Rapid Response"]], uses: 0 },
    { id: 9, nm: "Insurance-claim one-pager", kind: "document", pv: "doc", sc: "doc", folder: "brand", dim: "PDF · 1 page", size: "380 KB", tags: ["claim", "trust"], arc: true, used: ["Autumn Boost"], src: "Upload", by: "Evan", added: "8d ago", recent: 0, lineage: [["doc", "Uploaded one-pager"], ["doc", "Attached to Autumn Boost"]], uses: 0 },
    { id: 10, nm: "Composite — warranty card", kind: "image", pv: "comp", sc: "comp", folder: "comp", dim: "1080×1350", size: "740 KB", tags: ["composite", "warranty"], arc: false, risk: "Claim risk — embeds an unverified savings figure.", used: [], src: "Arc composite", by: "Arc", added: "1d ago", recent: 1, lineage: [["ai", "AI background (Higgsfield)"], ["comp", "Composited with claim"], ["comp", "Flagged: unverified claim"]], uses: 0 },
    { id: 11, nm: "midjourney_grid_03.png", kind: "image", pv: "upload", sc: "ai2", folder: "upload", dim: "1456×816", size: "2.8 MB", tags: ["imported", "midjourney"], arc: false, risk: "Imported — provenance unverified before Arc may reuse.", used: [], src: "Imported · Midjourney", by: "Evan", added: "7d ago", recent: 0, lineage: [["upload", "Imported from Midjourney"], ["upload", "Pending provenance review"]], uses: 0 },
    { id: 12, nm: "canva_export_banner.png", kind: "image", pv: "upload", sc: "comp", folder: "upload", dim: "1640×924", size: "1.6 MB", tags: ["imported", "canva"], arc: false, used: [], src: "Imported · Canva", by: "Evan", added: "9d ago", recent: 0, lineage: [["upload", "Imported from Canva"]], uses: 0 },
    { id: 13, nm: "Storm-zone reel clip", kind: "video", pv: "ai", sc: "video", folder: "video", dim: "1080×1920 · 0:15", size: "12.4 MB", tags: ["video", "reels"], arc: true, used: ["Storm Rapid Response"], src: "Higgsfield · video", by: "Arc", added: "2d ago", recent: 1, lineage: [["ai", "Generated by Higgsfield video"], ["ai", "Virality scored · used in reel"]], uses: 0 },
    { id: 14, nm: "Roof crew teaser 16:9", kind: "video", pv: "comp", sc: "video", folder: "video", dim: "1920×1080 · 0:22", size: "18.1 MB", tags: ["video", "crew"], arc: true, used: ["Storm Rapid Response"], src: "Higgsfield · video", by: "Arc", added: "3d ago", recent: 0, lineage: [["real", "Real job-site capture"], ["comp", "Edited + branded"], ["comp", "Used in Storm Rapid Response"]], uses: 0 },
    { id: 15, nm: "Job-site progress photo", kind: "image", pv: "real", sc: "ui", folder: "customers", dim: "2560×1440", size: "1.1 MB", tags: ["job-site", "crew"], arc: true, used: ["Adjuster Referral"], src: "Upload", by: "Evan", added: "10d ago", recent: 0, img: IMG.face, lineage: [["real", "Job-site photo"], ["real", "Used in Adjuster Referral"]], uses: 0 },
    { id: 16, nm: "Homeowner headshot — Linda Powers", kind: "image", pv: "real", sc: "crew", folder: "real", dim: "1200×1200", size: "640 KB", tags: ["headshot", "homeowner"], arc: false, risk: "Privacy — needs a signed release before outbound use.", used: [], src: "Upload · privacy hold", by: "Evan", added: "4d ago", recent: 0, lineage: [["real", "Uploaded headshot"], ["real", "Flagged: privacy / release"]], uses: 0 },
    { id: 17, nm: "Logo animation (MP4)", kind: "video", pv: "comp", sc: "video", folder: "video", dim: "1080×1080 · 0:03", size: "2.2 MB", tags: ["logo", "motion"], arc: true, used: [], src: "Arc composite", by: "Arc", added: "5d ago", recent: 0, lineage: [["logo", "Brand mark"], ["comp", "Animated by Arc"]], uses: 0 },
    { id: 18, nm: "AI thumbnail set", kind: "image", pv: "ai", sc: "ai", folder: "ai", dim: "1280×720", size: "880 KB", tags: ["ai", "thumbnail"], arc: true, used: [], src: "Higgsfield · seedream", by: "Arc", added: "6d ago", recent: 0, lineage: [["ai", "Generated by Higgsfield"]], uses: 0 },
  ];
  const pad = (folder: string, kind: Kind, pv: Prov, sc: string, n: number, prefix: string) => {
    for (let i = 1; i <= n; i++) {
      const id = A.length + 1;
      A.push({
        id, nm: `${prefix} ${String(i).padStart(2, "0")}`, kind, pv, sc, folder,
        dim: DIMS[kind][i % DIMS[kind].length], size: kind === "video" ? `${6 + i}.2 MB` : `${380 + i * 45} KB`,
        tags: [folder, "asset"], arc: pv !== "upload" && i % 4 !== 0, used: [], by: pv === "ai" || pv === "comp" ? "Arc" : "Evan",
        added: `${i + 6}d ago`, recent: 0, lineage: [[pv, `${prefix} added to ${folder}`]], uses: 0,
      });
    }
  };
  pad("real", "image", "real", "photo", 10, "Field photo");
  pad("ai", "image", "ai", "ai", 7, "AI render");
  pad("comp", "image", "comp", "comp", 4, "Composite");
  pad("upload", "image", "upload", "ai2", 3, "Imported");
  pad("video", "video", "comp", "video", 5, "Clip");
  pad("logos", "logo", "logo", "logo", 2, "Logo variant");
  pad("brand", "document", "doc", "doc", 4, "Brand doc");
  // move a few real photos into the Customer photos subfolder (mirrors the mockup)
  A.filter((a) => a.folder === "real" && a.nm.startsWith("Field photo")).slice(0, 3).forEach((a) => { a.folder = "customers"; });
  A.forEach((a) => { a.uses = a.used.length; });
  return A;
}

const ALL_ASSETS = buildAssets();

function Svg({ markup }: { markup: string }) {
  return <span style={{ position: "absolute", inset: 0 }} dangerouslySetInnerHTML={{ __html: markup.replace("<svg ", '<svg style="position:absolute;inset:0;width:100%;height:100%" ') }} />;
}
function ThumbMedia({ a }: { a: Asset }) {
  const url = a.img || SC2IMG[a.sc];
  const [failed, setFailed] = useState(false);
  // The SVG placeholder always renders underneath: a remote thumb that is slow,
  // blocked, or offline leaves art on the card instead of a bare grey box. The
  // image simply covers it once it paints.
  return (
    <>
      <Svg markup={SC[a.sc] || SC.photo} />
      {url && !failed ? (
        <AppImage src={url} alt="" onError={() => setFailed(true)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      ) : null}
    </>
  );
}
function Ico({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} dangerouslySetInnerHTML={{ __html: d }} />;
}

/**
 * A folder plus every folder inside it — what "show me this folder" means.
 *
 * Takes the tree it should search. It used to close over the demo constant, so
 * on a live workspace (whose folders are uuids the constant has never heard of)
 * every lookup missed and returned just the key: selecting a parent folder
 * showed its own assets and hid everything filed in its children.
 */
function descKeys(tree: Folder[], key: string): string[] {
  const find = (k: string, arr: Folder[]): Folder | null => {
    for (const n of arr) { if (n.f === k) return n; if (n.children) { const r = find(k, n.children); if (r) return r; } }
    return null;
  };
  const node = find(key, tree);
  if (!node) return [key];
  const out: string[] = [];
  const rec = (n: Folder) => { out.push(n.f); n.children?.forEach(rec); };
  rec(node);
  return out;
}

// Pure tree ops backing the rail's optimistic edits. At module scope because
// none of them touch component state, and because a folder move is three of
// them composed (find → remove → add) — inline copies drift.
function renameInTree(nodes: Folder[], id: string, name: string): Folder[] {
  return nodes.map((n) => (n.f === id ? { ...n, name } : n.children ? { ...n, children: renameInTree(n.children, id, name) } : n));
}
function removeFromTree(nodes: Folder[], id: string): Folder[] {
  return nodes.filter((n) => n.f !== id).map((n) => (n.children ? { ...n, children: removeFromTree(n.children, id) } : n));
}
function addToTree(nodes: Folder[], parentId: string, node: Folder): Folder[] {
  return nodes.map((n) =>
    n.f === parentId
      ? { ...n, children: [...(n.children ?? []), node] }
      : n.children
        ? { ...n, children: addToTree(n.children, parentId, node) }
        : n,
  );
}
function setDetailsInTree(nodes: Folder[], id: string, name: string, description: string | null): Folder[] {
  return nodes.map((n) =>
    n.f === id
      ? { ...n, name, description }
      : n.children
        ? { ...n, children: setDetailsInTree(n.children, id, name, description) }
        : n,
  );
}
/** Re-sequence one parent's children to `orderedIds`. `parentId: null` is the
 *  top level, which in this tree is every root node except the "All assets"
 *  row — that row is a filter, not a folder, and must stay at the head. */
function reorderInTree(nodes: Folder[], parentId: string | null, orderedIds: string[]): Folder[] {
  const sort = (list: Folder[]): Folder[] => {
    const rank = new Map(orderedIds.map((id, i) => [id, i]));
    return [...list].sort((a, b) => (rank.get(a.f) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.f) ?? Number.MAX_SAFE_INTEGER));
  };
  if (parentId === null) {
    const root = nodes.filter((n) => n.f === ROOT_FOLDER);
    return [...root, ...sort(nodes.filter((n) => n.f !== ROOT_FOLDER))];
  }
  return nodes.map((n) =>
    n.f === parentId
      ? { ...n, children: sort(n.children ?? []) }
      : n.children
        ? { ...n, children: reorderInTree(n.children, parentId, orderedIds) }
        : n,
  );
}
function findInTree(nodes: Folder[], id: string): Folder | undefined {
  for (const n of nodes) {
    if (n.f === id) return n;
    const found = n.children ? findInTree(n.children, id) : undefined;
    if (found) return found;
  }
  return undefined;
}
function folderName(nodes: Folder[], id: string): string | undefined {
  return findInTree(nodes, id)?.name;
}

// The campaigns board is the real create surface (New campaign opens a modal);
// the old /campaigns/new static builder is no longer linked.
const STUDIO = "/studio";
/** The campaigns LIST. Named for what it is — it was called NEW_CAMPAIGN while
 *  pointing here, which is how a button came to say "Add to campaign" and add
 *  nothing. `used` carries campaign NAMES only (and the live read leaves it
 *  empty), so a usage row has no id to deep-link to. */
const CAMPAIGNS = "/campaigns";

/** Studio, opened on a specific asset when it is a real stored one. Session/demo
 *  rows have no `rid`, so they fall back to Studio's own default selection. */
function a_studioHref(asset: { rid?: string | null } | null): string {
  return asset?.rid ? `${STUDIO}?asset=${encodeURIComponent(asset.rid)}` : STUDIO;
}

export function LibraryView({
  assets,
  folders,
  live = false,
  totalBytes,
  campaigns = [],
}: { assets?: Asset[]; folders?: Folder[]; live?: boolean; totalBytes?: number; campaigns?: { id: string; name: string }[] } = {}) {
  const [curFolder, setCurFolder] = useState(ROOT_FOLDER);
  const [curKind, setCurKind] = useState("all");
  const [curColl, setCurColl] = useState("all");
  // View shape — how this operator likes the shelf arranged. Persisted per
  // browser rather than held for the session: rearranging the Library every
  // time you open it is the kind of small friction that makes a tool feel
  // borrowed rather than yours.
  const prefs = useSyncExternalStore(subscribeLibraryPrefs, getLibraryPrefs, getServerLibraryPrefs);
  const { viewMode, tile, sortBy, expanded } = prefs;
  const setViewMode = (value: "grid" | "list") => setLibraryPrefs({ viewMode: value });
  const setSortBy = (value: "recent" | "name" | "used") => setLibraryPrefs({ sortBy: value });
  const setTile = (value: TileSize) => setLibraryPrefs({ tile: value });
  const toggleExpanded = (id: string) => setLibraryPrefs({ expanded: { ...expanded, [id]: !expanded[id] } });
  // While the rail handle is held, the width is local: committing every
  // pointermove would write localStorage sixty times a second.
  const [liveRail, setLiveRail] = useState<number | null>(null);
  const railWidth = liveRail ?? prefs.railWidth;
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [detail, setDetail] = useState<Asset | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  /** A drag is in flight, so every folder row can advertise itself as a target. */
  const [assetDrag, setAssetDrag] = useState(false);
  const [arcState, setArcState] = useState<Record<number, boolean>>({});
  // Assets deleted this session — hidden optimistically before the refetch.
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Risk-flag review, per asset id. `ackOpen` is the inline acknowledgement form
  // (the risk box's own confirm step, mirroring `confirmDelete` below it);
  // `approvedIds` reflects a decision locally so the box updates without a reload.
  const [ackOpen, setAckOpen] = useState(false);
  const [ackText, setAckText] = useState("");
  const [approving, setApproving] = useState(false);
  const [approvedIds, setApprovedIds] = useState<Set<number>>(new Set());
  const [downloading, setDownloading] = useState(false);
  // In-session name/tag edits, overlaid on the immutable base assets.
  // Optimistic per-asset overlay. `folder` joined nm/tags for BSR-707 so a moved
  // asset re-files in the grid immediately instead of after the refetch.
  const [edits, setEdits] = useState<Record<number, { nm?: string; tags?: string[]; folder?: string }>>({});
  const [renaming, setRenaming] = useState(false);
  const [tagEditing, setTagEditing] = useState(false);
  const [suggDismissed, setSuggDismissed] = useState(false);
  // Folders + uploads created this session. Folders persist via createLibraryFolder;
  // uploads are held client-side (real media-store persistence lands with the
  // real data feed). Both show instantly.
  const [tree, setTree] = useState<Folder[]>(folders ?? TREE);
  const [uploaded, setUploaded] = useState<Asset[]>([]);
  const [folderOpen, setFolderOpen] = useState(false);
  /** Which folder the next "New folder" lands in — null is the top level. */
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null);
  /** The folder whose name + description are being edited, if any. */
  const [detailsFolder, setDetailsFolder] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // "Add to campaign" picker. The control used to be a bare link to /campaigns,
  // which navigated away and silently discarded the selection.
  const router = useRouter();
  const [campaignPickOpen, setCampaignPickOpen] = useState(false);
  const [movePickOpen, setMovePickOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const selbarRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLSpanElement>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const uidRef = useRef(-1);

  const baseAssets = assets ?? ALL_ASSETS;
  const allAssets = useMemo(
    () => [...uploaded, ...baseAssets]
      .filter((a) => !deletedIds.has(a.id))
      .map((a) => (edits[a.id] ? { ...a, ...(edits[a.id].nm !== undefined ? { nm: edits[a.id].nm! } : {}), ...(edits[a.id].tags !== undefined ? { tags: edits[a.id].tags! } : {}), ...(edits[a.id].folder !== undefined ? { folder: edits[a.id].folder! } : {}) } : a)),
    [uploaded, baseAssets, deletedIds, edits],
  );

  /**
   * Attach the selected media to a campaign as approval-gated drafts. Uses the real
   * media_assets uuids (Asset.rid); session/demo rows without one can't be promoted,
   * and we say so rather than silently attaching fewer than were selected.
   */
  const addSelectionToCampaign = async (campaignId: string, campaignName: string) => {
    const chosen = allAssets.filter((a) => sel.has(a.id));
    const ids = chosen.map((a) => a.rid).filter(Boolean) as string[];
    setCampaignPickOpen(false);
    if (ids.length === 0) {
      setNotice("Those items aren't saved assets yet, so they can't be added to a campaign.");
      return;
    }
    setAddingTo(campaignId);
    const res = await addLibraryAssetsToCampaign({ assetIds: ids, campaignId });
    setAddingTo(null);
    if (!res.ok) { setNotice(res.error); return; }
    const skipped = chosen.length - ids.length;
    setNotice(
      !res.persisted
        ? "Connect a workspace to add assets to a campaign."
        : `Added ${res.added} ${res.added === 1 ? "asset" : "assets"} to ${res.campaignName ?? campaignName} as drafts — approve them on the campaign.${skipped > 0 ? ` ${skipped} skipped (not saved assets).` : ""}`,
    );
    if (res.persisted) setSel(new Set());
  };

  /**
   * File the selection into a folder, or back out to the root (BSR-707).
   *
   * `folderId: null` is the root and a real destination — an asset that could
   * only ever move deeper would make the tree a one-way trip.
   *
   * Session-only rows have no `rid` and so no database row to move; they are
   * counted out and reported rather than silently dropped from the total.
   */
  const moveSelectionToFolder = async (folderId: string | null, folderName: string) => {
    await moveAssetsToFolder([...sel], folderId, folderName);
  };

  const moveAssetsToFolder = async (assetKeys: number[], folderId: string | null, folderName: string) => {
    const keys = new Set(assetKeys);
    const chosen = allAssets.filter((a) => keys.has(a.id));
    const ids = chosen.map((a) => a.rid).filter(Boolean) as string[];
    setMovePickOpen(false);
    if (ids.length === 0) {
      setNotice("Those items aren't saved assets yet, so they can't be moved.");
      return;
    }
    setMoving(true);
    const res = await moveLibraryAssets({ assetIds: ids, folderId }).catch(() => ({
      ok: false as const,
      error: "Could not reach the server.",
    }));
    setMoving(false);
    if (!res.ok) { setNotice(res.error); return; }
    // Reflect the move locally so the grid re-files without waiting for the
    // refetch; the folder counts read from the same overlay.
    for (const a of chosen) if (a.rid) applyEdit(a.id, { folder: folderId ?? "" });
    const skipped = chosen.length - ids.length;
    setNotice(
      !res.persisted
        ? "Connect a workspace to move assets between folders."
        : `Moved ${res.moved} ${res.moved === 1 ? "asset" : "assets"} to ${res.folderName ?? folderName}.${skipped > 0 ? ` ${skipped} skipped (not saved assets).` : ""}`,
    );
    if (res.persisted) setSel(new Set());
  };

  /**
   * Close either selection-bar picker on an outside click or Escape.
   *
   * Replaces a pair of click-catching scrim overlays. A scrim span cannot be
   * tabbed to and ignored Escape, so a keyboard user who opened a picker was
   * stuck with it — and BSR-664's ratchet counts each one. Covering both
   * pickers here removes the existing scrim as well as the one this change
   * would have added, so the file's baseline drops rather than holds.
   *
   * (Prose avoids naming the old markup literally: that ratchet greps raw
   * source without stripping comments.)
   */
  useEffect(() => {
    if (!campaignPickOpen && !movePickOpen) return;
    const close = () => { setCampaignPickOpen(false); setMovePickOpen(false); };
    function onDown(e: MouseEvent) {
      if (selbarRef.current && !selbarRef.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [campaignPickOpen, movePickOpen]);

  /** Same dismissal contract for the sort menu — outside click or Escape. */
  useEffect(() => {
    if (!sortOpen) return;
    const close = () => setSortOpen(false);
    function onDown(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [sortOpen]);

  /**
   * Folder choices for the move picker, flattened depth-first so nesting reads
   * as indentation rather than being lost. "All assets" is the root and maps to
   * a null folder_id — moving OUT has to be reachable or the tree is one-way.
   */
  const moveTargets = useMemo(() => {
    const out: Array<{ id: string | null; name: string }> = [];
    const walk = (nodes: Folder[], depth: number) => {
      for (const n of nodes) {
        if (n.f === "all") out.push({ id: null, name: "All assets (no folder)" });
        else out.push({ id: n.f, name: `${"— ".repeat(depth)}${n.name}` });
        if (n.children?.length) walk(n.children, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [tree]);

  // Folder counts over the live asset set (base assets + this session's uploads).
  const rcountLive = (f: string): number => {
    if (f === ROOT_FOLDER) return allAssets.length;
    const ks = descKeys(tree, f);
    return allAssets.filter((a) => ks.includes(a.folder) || a.folder === f).length;
  };

  const kindOfType = (type: string): Kind =>
    type.startsWith("video") ? "video" : type === "application/pdf" ? "document" : "image";

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const targetFolder = curFolder === "all" ? "upload" : curFolder;

    // Live (real backend): persist each file to media_assets, then show the
    // stored asset (real URL). The mock/demo path keeps the client-only preview.
    if (live) {
      setNotice(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`);
      let done = 0;
      let failed = 0;
      files.forEach((file) => {
        const formData = new FormData();
        formData.append("file", file);
        if (curFolder !== "all") formData.append("folderId", curFolder);
        uploadLibraryAsset(formData)
          .then((res) => {
            if (res.ok && res.asset) setUploaded((prev) => [{ ...res.asset!, id: uidRef.current-- }, ...prev]);
            else failed++;
          })
          .catch(() => { failed++; })
          .finally(() => {
            done++;
            if (done === files.length) {
              setNotice(failed
                ? `${files.length - failed} uploaded · ${failed} failed. Held for provenance review before Arc may reuse.`
                : `${files.length} file${files.length === 1 ? "" : "s"} uploaded — held for provenance review before Arc may reuse.`);
            }
          });
      });
      return;
    }

    const newAssets: Asset[] = files.map((file) => ({
      id: uidRef.current--,
      nm: file.name,
      kind: kindOfType(file.type),
      pv: "upload",
      sc: "photo",
      folder: targetFolder,
      dim: "—",
      size: file.size >= 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`,
      tags: ["imported"],
      arc: false,
      used: [],
      by: "You",
      added: "just now",
      recent: 1,
      risk: "Imported — provenance unverified before Arc may reuse.",
      img: file.type.startsWith("image") ? URL.createObjectURL(file) : undefined,
      lineage: [["upload", "Uploaded by you"]],
      uses: 0,
    }));
    setUploaded((prev) => [...newAssets, ...prev]);
    setNotice(
      `${files.length} file${files.length === 1 ? "" : "s"} added — held for provenance review before Arc may reuse.`,
    );
  }

  async function handleCreateFolder(name: string): Promise<{ ok: boolean; error?: string }> {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "folder";
    const key = `${base}-${-(uidRef.current--)}`;
    const parent = newFolderParent;
    const node: Folder = { f: key, name, color: "#88b6d8", icon: "folder" };
    setTree((prev) => (parent ? addToTree(prev, parent, node) : [...prev, node]));
    // A subfolder created into a collapsed parent would be invisible the moment
    // it appeared, which reads as "nothing happened".
    if (parent && !expanded[parent]) toggleExpanded(parent);
    setNotice(null);
    const res = await createLibraryFolder(name, parent);
    if (!res.ok) {
      setTree((prev) => removeFromTree(prev, key));
      return { ok: false, error: res.error };
    }
    setCurFolder(key);
    return { ok: true };
  }

  /**
   * Re-parent a folder — the drop target in the rail, and its row menu.
   *
   * Optimistic like every other tree edit here, and restored from a snapshot on
   * failure. The server's refusals are surfaced verbatim: "a folder can't be
   * moved inside itself" is actionable, and a generic failure is not.
   */
  const handleMoveFolder = async (folderId: string, parentId: string | null) => {
    const snapshot = tree;
    const node = findInTree(tree, folderId);
    if (!node) return;
    const detached = removeFromTree(tree, folderId);
    setTree(parentId ? addToTree(detached, parentId, node) : [...detached, node]);
    if (parentId && !expanded[parentId]) toggleExpanded(parentId);
    const res = await moveLibraryFolder({ folderId, parentId }).catch(() => ({
      ok: false as const,
      error: "Could not reach the server.",
    }));
    if (!res.ok) {
      setTree(snapshot);
      setNotice(res.error);
      return;
    }
    if (!res.persisted) setNotice("Connect a workspace to rearrange folders.");
  };

  async function handleImportUrl(value: { url: string; name?: string }): Promise<{ ok: boolean; error?: string }> {
    const clean = value.url.trim();
    try {
      new URL(clean);
    } catch {
      return { ok: false, error: "Enter a valid URL (including https://)." };
    }
    // The server fetches, scans, and stores the file; the returned asset drops
    // straight into the grid. In the backend-less preview it stays session-only.
    const folderId = curFolder === "all" || curFolder === "upload" ? null : curFolder;
    const result = await importLibraryAssetFromUrl({ url: clean, name: value.name, folderId });
    if (!result.ok) return { ok: false, error: result.error };
    if (result.persisted && result.asset) {
      setUploaded((prev) => [{ ...result.asset!, id: uidRef.current--, folder: result.asset!.folder || "upload" }, ...prev]);
      setNotice("Imported from URL — held for provenance review before Arc may reuse.");
      return { ok: true };
    }
    const lower = clean.toLowerCase().split("?")[0];
    const kind: Kind = /\.(mp4|mov|webm|m4v)$/.test(lower) ? "video" : /\.pdf$/.test(lower) ? "document" : "image";
    const fileName = value.name?.trim() || decodeURIComponent(lower.split("/").pop() || "") || "Imported asset";
    const asset: Asset = {
      id: uidRef.current--,
      nm: fileName,
      kind,
      pv: "upload",
      sc: "photo",
      folder: curFolder === "all" ? "upload" : curFolder,
      dim: "—",
      size: "—",
      tags: ["imported", "url"],
      arc: false,
      used: [],
      by: "You",
      added: "just now",
      recent: 1,
      risk: "Imported from URL — provenance unverified before Arc may reuse.",
      img: kind === "image" ? clean : undefined,
      lineage: [["upload", "Imported from URL"]],
      uses: 0,
    };
    setUploaded((prev) => [asset, ...prev]);
    setNotice("Imported from URL — held for provenance review before Arc may reuse.");
    return { ok: true };
  }

  const isArc = (a: Asset) => (a.id in arcState ? arcState[a.id] : a.arc);
  const needsReview = (a: Asset) => !!a.risk || (a.pv === "upload" && !isArc(a));
  const inColl = (a: Asset) => {
    if (curColl === "arc") return isArc(a);
    if (curColl === "review") return needsReview(a);
    if (curColl === "unused") return a.uses === 0;
    if (curColl === "recent") return a.recent === 1;
    return true;
  };

  const list = useMemo(() => {
    const dk = curFolder === ROOT_FOLDER ? null : descKeys(tree, curFolder);
    let out = allAssets.filter((a) => (curFolder === "all" || dk!.includes(a.folder) || a.folder === curFolder) && (curKind === "all" || a.kind === curKind) && inColl(a));
    out = [...out].sort((x, y) => (sortBy === "name" ? (x.nm < y.nm ? -1 : 1) : sortBy === "used" ? y.uses - x.uses : x.id - y.id));
    const needle = q.trim().toLowerCase();
    if (needle) out = out.filter((a) => `${a.nm} ${a.kind} ${a.pv} ${a.tags.join(" ")} ${a.folder}`.toLowerCase().includes(needle));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curFolder, curKind, curColl, sortBy, q, arcState, allAssets]);

  const totals = useMemo(() => {
    const byk = { image: 0, video: 0, logo: 0, document: 0 };
    allAssets.forEach((a) => { byk[a.kind]++; });
    return {
      total: allAssets.length,
      // Readiness — exclusive, and sums to total. `needsReview` wins over
      // `isArc` because a risk flag on an approved asset still needs a look.
      rev: allAssets.filter(needsReview).length,
      arc: allAssets.filter((a) => !needsReview(a) && isArc(a)).length,
      untouched: allAssets.filter((a) => !needsReview(a) && !isArc(a)).length,
      // Usage — a separate axis entirely.
      un: allAssets.filter((a) => a.uses === 0).length,
      byk,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arcState, allAssets]);

  const toggleSel = (id: number) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selmode = sel.size > 0;

  // Select-all acts on what's on screen — the current folder, filter chips and
  // search — never the whole library. Selecting 400 hidden assets from a view
  // showing 6 is how someone makes 400 of them Arc-available by accident.
  const shownIds = useMemo(() => list.map((a) => a.id), [list]);
  const allShownSelected = shownIds.length > 0 && shownIds.every((id) => sel.has(id));
  const someShownSelected = !allShownSelected && shownIds.some((id) => sel.has(id));
  const toggleSelectAllShown = () =>
    setSel((prev) => {
      const next = new Set(prev);
      // Clearing drops only what's shown, so a selection made under a different
      // filter survives — the count in the bar would otherwise lie.
      if (shownIds.every((id) => next.has(id))) shownIds.forEach((id) => next.delete(id));
      else shownIds.forEach((id) => next.add(id));
      return next;
    });

  const sortLabel = SORTS.find(([key]) => key === sortBy)?.[1] ?? "Recent";

  // Every transient bit of the inspector resets here, so opening asset B never
  // shows a confirm step — or a half-typed risk acknowledgement — left over from A.
  const openDetail = (a: Asset) => { setConfirmDelete(false); setRenaming(false); setTagEditing(false); setAckOpen(false); setAckText(""); setDetail(a); };

  // Apply a name/tag edit to the overlay (for the grid) and the open inspector.
  const applyEdit = (id: number, patch: { nm?: string; tags?: string[]; folder?: string }) => {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    setDetail((cur) => (cur && cur.id === id ? { ...cur, ...patch } : cur));
  };
  const saveRename = (a: Asset, value: string) => {
    setRenaming(false);
    const name = value.trim();
    if (!name || name === a.nm) return;
    const prev = a.nm;
    applyEdit(a.id, { nm: name });
    if (a.rid) renameLibraryAsset(a.rid, name).then((res) => { if (!res.ok) { applyEdit(a.id, { nm: prev }); setNotice(res.error); } });
  };
  const saveTags = (a: Asset, value: string) => {
    setTagEditing(false);
    const tags = [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
    if (tags.join("|") === a.tags.join("|")) return;
    const prev = a.tags;
    applyEdit(a.id, { tags });
    if (a.rid) setLibraryAssetTags(a.rid, tags).then((res) => { if (!res.ok) { applyEdit(a.id, { tags: prev }); setNotice(res.error); } });
  };

  // Delete a Library asset: optimistically drop it from the grid + close the
  // inspector, then persist (real DB rows only). Restore on failure. Campaigns
  // that already embedded it keep their own copy, so this only clears the Library.
  const handleDelete = (a: Asset) => {
    if (deleting) return;
    setDeleting(true);
    setNotice(null);
    const id = a.id;
    setDeletedIds((prev) => new Set(prev).add(id));
    setConfirmDelete(false);
    setDetail(null);
    setSel((prev) => { const next = new Set(prev); next.delete(id); return next; });
    const finish = (ok: boolean, error?: string) => {
      setDeleting(false);
      if (!ok) {
        setDeletedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
        setNotice(error ?? "Could not delete the asset.");
      }
    };
    if (a.rid) deleteLibraryAsset(a.rid).then((res) => finish(res.ok, res.ok ? undefined : res.error));
    else finish(true);
  };

  /**
   * Persist the operator's "may Arc reuse this?" decision. Optimistic so the grid
   * responds instantly, but rolled back if the write fails — a provenance gate that
   * lies about being saved is worse than one that reports the failure. Session-only
   * rows (no `rid`) have no DB row yet, so they stay local.
   */
  const applyArc = (assets: Asset[], value: boolean) => {
    setArcState((p) => ({ ...p, ...Object.fromEntries(assets.map((a) => [a.id, value])) }));
    const real = assets.filter((a) => a.rid);
    if (!real.length) return;
    void Promise.all(
      real.map(async (a) => {
        const res = await setLibraryAssetArcAvailability(a.rid!, value).catch(() => ({
          ok: false as const,
          error: "Could not reach the server.",
        }));
        return { a, res };
      }),
    ).then((results) => {
      const failed = results.filter((r) => !r.res.ok);
      if (!failed.length) return;
      setArcState((p) => ({ ...p, ...Object.fromEntries(failed.map((r) => [r.a.id, !value])) }));
      setNotice(
        failed.length === 1 && !failed[0].res.ok && "error" in failed[0].res
          ? failed[0].res.error
          : `${failed.length} asset${failed.length === 1 ? "" : "s"} couldn't be updated.`,
      );
    });
  };

  const toggleArc = (a: Asset) => applyArc([a], !isArc(a));

  /**
   * Download the actual file (BSR-687 — this was a <span> with no handler).
   *
   * Fetched to a blob rather than given to `<a download href={a.img}>`, because
   * the URL is a Supabase storage public URL on another origin and browsers
   * ignore the `download` attribute cross-origin: the tag would navigate to the
   * image instead of saving it, which looks like a broken button. If the fetch
   * is refused (CORS, an expired object) we open it in a new tab rather than
   * failing silently — the operator still gets to the file.
   */
  const downloadAsset = async (a: Asset): Promise<boolean> => {
    if (!a.img) return false;
    try {
      const res = await fetch(a.img);
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const el = document.createElement("a");
      el.href = href;
      // Keep the operator's name for the asset, but never drop the extension —
      // a file called "Warranty card" with no suffix opens in nothing.
      const ext = new URL(a.img).pathname.split(".").pop();
      el.download = ext && !a.nm.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? `${a.nm}.${ext}` : a.nm;
      document.body.appendChild(el);
      el.click();
      el.remove();
      URL.revokeObjectURL(href);
      return true;
    } catch {
      window.open(a.img, "_blank", "noopener,noreferrer");
      return false;
    }
  };

  /** One asset, from the inspector. */
  const handleDownload = async (a: Asset) => {
    if (downloading) return;
    setDownloading(true);
    setNotice(null);
    await downloadAsset(a);
    setDownloading(false);
  };

  /**
   * The selection bar's Download. Sequential on purpose: firing N concurrent
   * saves trips browsers' multiple-download blocking, and the failure mode there
   * is silent. Assets with no stored file (session rows, or an upload still
   * processing) are skipped and reported rather than counted as downloaded.
   */
  const handleDownloadSelection = async () => {
    if (downloading) return;
    const chosen = list.filter((a) => sel.has(a.id));
    const withFile = chosen.filter((a) => a.img);
    const skipped = chosen.length - withFile.length;
    if (withFile.length === 0) {
      setNotice(
        chosen.length === 0
          ? "Nothing selected."
          : `Nothing to download — ${chosen.length === 1 ? "that asset has" : "those assets have"} no stored file yet.`,
      );
      return;
    }
    setDownloading(true);
    setNotice(null);
    let failed = 0;
    for (const a of withFile) {
      // eslint-disable-next-line no-await-in-loop -- sequential is the point; see above
      if (!(await downloadAsset(a))) failed += 1;
    }
    setDownloading(false);
    const parts: string[] = [];
    if (failed) parts.push(`${failed} opened in a new tab instead`);
    if (skipped) parts.push(`${skipped} had no stored file`);
    if (parts.length) setNotice(`Downloaded ${withFile.length - failed} of ${chosen.length} — ${parts.join("; ")}.`);
  };

  const isApproved = (a: Asset) => approvedIds.has(a.id) || a.approvalStatus === "approved";

  /**
   * Approve a flagged asset (BSR-687 — also a <span> with no handler, and the
   * only control offered for clearing a flag, so an operator could believe they
   * had resolved something that recorded nothing).
   *
   * Routed through the existing `decideLibraryAsset` → `decideAssetApproval`
   * path, which is the same `approval_items` table and vocabulary campaigns use.
   * That path REQUIRES a written acknowledgement to approve a flagged asset —
   * deliberately, so a flag has to be weighed rather than clicked past — which
   * is why this is a two-step control and not a one-tap button. The gate lives
   * in the domain and reads flags from the row, so the form cannot talk its way
   * around it; we surface the server's own message when it refuses.
   */
  const handleApproveRisk = async (a: Asset) => {
    if (approving) return;
    const ack = ackText.trim();
    if (!a.rid) {
      setNotice("This asset isn't saved to the workspace yet, so a decision can't be recorded against it.");
      return;
    }
    setApproving(true);
    setNotice(null);
    const res = await decideLibraryAsset({ assetId: a.rid, decision: "approved", acknowledgement: ack }).catch(() => ({
      ok: false as const,
      error: "Could not reach the server.",
    }));
    setApproving(false);
    if (!res.ok) {
      setNotice(res.error);
      return;
    }
    setApprovedIds((prev) => new Set(prev).add(a.id));
    setAckOpen(false);
    setAckText("");
  };

  const CHECK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path d="M5 12l4 4 10-10" /></svg>;

  const saveFolderRename = (id: string, value: string) => {
    const name = value.trim();
    const current = folderName(tree, id);
    if (!name || name === current) return;
    setTree((t) => renameInTree(t, id, name));
    renameLibraryFolder(id, name).then((res) => { if (!res.ok) { setTree((t) => renameInTree(t, id, current ?? name)); setNotice(res.error); } });
  };
  const handleFolderDelete = (id: string) => {
    const snapshot = tree;
    // Assets fall back to "All assets" (FK ON DELETE SET NULL); remove the node here.
    setTree((t) => removeFromTree(t, id));
    if (curFolder === id) setCurFolder(ROOT_FOLDER);
    deleteLibraryFolder(id).then((res) => { if (!res.ok) { setTree(snapshot); setNotice(res.error); } });
  };

  const openNewFolder = (parentId: string | null) => {
    setNewFolderParent(parentId);
    setFolderOpen(true);
  };

  /**
   * Save the folder-details editor. Both fields go in one write — same row,
   * same gate — and the tree updates optimistically so the rail reflects the
   * new name before the refetch.
   */
  const saveFolderDetails = async (id: string, value: { name: string; description: string }): Promise<{ ok: boolean; error?: string }> => {
    const snapshot = tree;
    setTree((t) => setDetailsInTree(t, id, value.name, value.description || null));
    const res = await updateLibraryFolder({ folderId: id, name: value.name, description: value.description }).catch(() => ({
      ok: false as const,
      error: "Could not reach the server.",
    }));
    if (!res.ok) {
      setTree(snapshot);
      return { ok: false, error: res.error };
    }
    if (!res.persisted) setNotice("Connect a workspace to save folder details.");
    return { ok: true };
  };

  /**
   * Persist a sibling order — the drop-between gesture, and Move up / Down.
   *
   * The whole ordered list is sent rather than a delta, so what lands in
   * `sort_order` is exactly the sequence the operator was looking at.
   */
  const handleReorderFolders = async (parentId: string | null, orderedIds: string[]) => {
    const snapshot = tree;
    setTree((t) => reorderInTree(t, parentId, orderedIds));
    const res = await reorderLibraryFolders({ parentId, orderedIds }).catch(() => ({
      ok: false as const,
      error: "Could not reach the server.",
    }));
    if (!res.ok) {
      setTree(snapshot);
      setNotice(res.error);
      return;
    }
    if (!res.persisted) setNotice("Connect a workspace to save the folder order.");
  };

  /**
   * The rail's drop handler. Assets dropped on a folder go through the same
   * org-scoped move the selection bar uses — one path, so a drag can't quietly
   * become a second way to file media that skips the workspace check.
   */
  const handleDropAssets = (assetIds: number[], folderId: string | null) => {
    setAssetDrag(false);
    void moveAssetsToFolder(assetIds, folderId, folderId ? folderName(tree, folderId) ?? "that folder" : "All assets");
  };

  /** Begin dragging an asset. A drag that starts on a selected item carries the
   *  whole selection; one that starts elsewhere carries just that item — the
   *  behaviour every file manager has, and the one people already expect. */
  const assetDragProps = (a: Asset) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      const ids = sel.has(a.id) ? [...sel] : [a.id];
      e.dataTransfer.setData(DRAG_ASSETS, JSON.stringify(ids));
      e.dataTransfer.effectAllowed = "move";
      setAssetDrag(true);
    },
    onDragEnd: () => setAssetDrag(false),
  });


  // Arc-approved assets that have never been used in a campaign. Counted over the
  // live set (not the demo constant) so the nudge can't claim assets the library
  // doesn't have, and hidden entirely when there are none to draft from.
  const unshipped = allAssets.filter((a) => isArc(a) && a.uses === 0).length;

  const arcSugg = !suggDismissed && !q && unshipped > 0 ? (
    <div className="arcsugg">
      <span className="am">A</span>
      <span className="at"><b>{unshipped} approved {unshipped === 1 ? "photo has" : "photos have"} never been used.</b> Want Arc to draft ad variants from your best unused photos?</span>
      <span className="ab">
        <a className="miniabtn" href={STUDIO}>Draft in Studio</a>
        <span className="miniabtn ghost" onClick={() => setSuggDismissed(true)}>Dismiss</span>
      </span>
    </div>
  ) : null;

  return (
    <div className="arc-library">
      <div className="lhead">
        <div>
          <h1 className="pt">Library</h1>
          <div className="psub">Your media store — real photos, AI creative, logos &amp; docs. Mark what Arc may use.</div>
        </div>
        <div className="acts">
          <a className="gbtn" href={STUDIO}><svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10z" /></svg>Generate with Arc</a>
          <button type="button" className="gbtn" onClick={() => setImportOpen(true)}><svg viewBox="0 0 24 24"><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3M8 9l4-4 4 4M12 5v10" /></svg>Import URL</button>
          <button type="button" className="gbtn gold" onClick={() => fileRef.current?.click()}><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>Upload</button>
          <input ref={fileRef} type="file" multiple accept="image/*,video/*,application/pdf" onChange={handleFiles} style={{ display: "none" }} />
        </div>
      </div>

      <div className="oband">
        {/* `obigv`, not `ov`: `.ov` is the card hover OVERLAY (absolute, inset 0,
            opacity 0). It applied to this number too, so the headline asset count
            rendered invisible AND stretched a 1204x58 transparent box across the
            band that swallowed clicks on the Arc-ready / need-you filters. */}
        <div className="obig"><span className="obigv">{totals.total}</span><span className="ol">assets</span></div>
        <div className="obars">
          <span className="obar"><i style={{ background: "#7fb89a" }} />{totals.byk.image} images</span>
          <span className="obar"><i style={{ background: "#bd6a58" }} />{totals.byk.video} videos</span>
          <span className="obar"><i style={{ background: "#9aa0ac" }} />{totals.byk.logo} logos</span>
          <span className="obar"><i style={{ background: "#9aa0ac" }} />{totals.byk.document} docs</span>
        </div>
        <div className="ospacer" />
        <span className="pvlegend" aria-label="What the dot on each item means">
          {(["real", "ai", "comp"] as const).map((k) => (
            <span key={k}><i className={`pdot pv-${k}`} />{PVL[k]}</span>
          ))}
        </span>
        <span className="ostatgrp" title="Every item is in exactly one of these">
          <span className="ostat ok" role="button" tabIndex={0} onClick={() => setCurColl("arc")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCurColl("arc"); } }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a3d0b8" strokeWidth={2}><path d="M5 12l4 4 10-10" /></svg><b>{totals.arc}</b> Arc-ready<Define term="arc_ready" /></span>
          <span className="ostat warn" role="button" tabIndex={0} onClick={() => setCurColl("review")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCurColl("review"); } }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#e7c486" strokeWidth={2}><path d="M12 9v4M12 17h.01M10.3 3.9l-8 14A2 2 0 004 21h16a2 2 0 001.7-3l-8-14a2 2 0 00-3.4 0z" /></svg><b>{totals.rev}</b> need you</span>
          {totals.untouched > 0 ? <span className="ostat"><b>{totals.untouched}</b> not reviewed</span> : null}
        </span>
        <span className="ostatsep" aria-hidden="true" />
        <span className="ostat" role="button" tabIndex={0} title="Separate from the counts on the left — an item can be Arc-ready and still never used" onClick={() => setCurColl("unused")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCurColl("unused"); } }}><b>{totals.un}</b> never used</span>
        {/* Real bytes stored. There is no storage quota in the backend, so this
            reports usage rather than a meter against an invented limit. */}
        {totalBytes != null ? <span className="ostat"><b>{formatByteSize(totalBytes)}</b> stored</span> : null}
      </div>

      <div
        className={`lib${detail ? " detail" : ""}${selmode ? " selmode" : ""}${assetDrag ? " dragging" : ""}`}
        style={{ ["--rail" as string]: `${railWidth}px` }}
      >
        <aside className="tree">
          <FolderTree
            tree={tree}
            current={curFolder}
            onSelect={setCurFolder}
            countOf={rcountLive}
            expanded={expanded}
            onToggleExpanded={toggleExpanded}
            onRename={saveFolderRename}
            onDelete={handleFolderDelete}
            onNewFolder={openNewFolder}
            onMoveFolder={(id, parentId) => void handleMoveFolder(id, parentId)}
            onReorder={(parentId, orderedIds) => void handleReorderFolders(parentId, orderedIds)}
            onEditDetails={setDetailsFolder}
            onDropAssets={handleDropAssets}
            dragging={assetDrag}
          />
        </aside>

        {/* The rail's width is the thing standing between a folder called
            "Before & After / Proof" and reading as "Before & After / Pr…", so
            it is the operator's to set, not a constant someone picked once. */}
        <div
          className="railgrip"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the folder rail"
          aria-valuenow={railWidth}
          aria-valuemin={RAIL_MIN}
          aria-valuemax={RAIL_MAX}
          tabIndex={0}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 32 : 8;
            if (e.key === "ArrowLeft") { e.preventDefault(); setLibraryPrefs({ railWidth: railWidth - step }); }
            if (e.key === "ArrowRight") { e.preventDefault(); setLibraryPrefs({ railWidth: railWidth + step }); }
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            const el = e.currentTarget;
            el.setPointerCapture(e.pointerId);
            const startX = e.clientX;
            const startWidth = railWidth;
            let width = startWidth;
            const onMove = (move: PointerEvent) => {
              width = Math.min(RAIL_MAX, Math.max(RAIL_MIN, startWidth + (move.clientX - startX)));
              setLiveRail(width);
            };
            const onUp = (up: PointerEvent) => {
              el.releasePointerCapture(up.pointerId);
              el.removeEventListener("pointermove", onMove);
              el.removeEventListener("pointerup", onUp);
              setLiveRail(null);
              setLibraryPrefs({ railWidth: width });
            };
            el.addEventListener("pointermove", onMove);
            el.addEventListener("pointerup", onUp);
          }}
          onDoubleClick={() => setLibraryPrefs({ railWidth: 276 })}
        />

        <section className="gallery">
          <div className="gtoolbar">
            <span className="lsearch"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter assets…" /></span>
            {([["all", "All"], ["arc", "Arc-ready"], ["review", WORK_STATE_LABEL.needs_you], ["unused", "Unused"], ["recent", "Recent"]] as const).map(([k, label]) => (
              <span key={k} className={`chip${curColl === k ? " on" : ""}`} onClick={() => setCurColl(k)}>
                {label}
                {k === "review" ? <span className="cn">{totals.rev}</span> : k === "unused" ? <span className="cn">{totals.un}</span> : null}
              </span>
            ))}
            <span className="cdiv" />
            {([["image", "Images"], ["video", "Videos"], ["logo", "Logos"], ["document", "Docs"]] as const).map(([k, label]) => (
              <span key={k} className={`chip${curKind === k ? " on" : ""}`} onClick={() => setCurKind((c) => (c === k ? "all" : k))}>{label}</span>
            ))}
            <span className="gspacer" />
            {/* Selecting many assets at once was already wired end to end — bulk
                Arc-availability, add-to-campaign, move-to-folder — but the only
                way in was a checkbox that appears on hover, so on a trackpad you
                had to find it by accident and on a touch screen not at all.
                This states the capability, and acts on exactly what's filtered
                rather than the whole library. */}
            <button
              type="button"
              className={`selall${allShownSelected ? " on" : ""}`}
              disabled={list.length === 0}
              onClick={toggleSelectAllShown}
              title={allShownSelected ? "Clear the selection" : `Select all ${list.length} assets shown`}
            >
              <span className={`selall-box${allShownSelected ? " on" : someShownSelected ? " some" : ""}`} aria-hidden="true">
                {allShownSelected ? CHECK : someShownSelected ? <span className="selall-dash" /> : null}
              </span>
              {allShownSelected ? "Clear" : `Select all${list.length ? ` (${list.length})` : ""}`}
            </button>
            {/* Was a button that cycled Recent → Name → Most used with nothing
                to say what came next, so finding a sort meant clicking until it
                appeared. The options are simply listed. */}
            <span className="fbtn-wrap" ref={sortRef}>
              <button type="button" className="sortbtn" aria-haspopup="menu" aria-expanded={sortOpen} onClick={() => setSortOpen((o) => !o)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M7 20l-3-3M7 4l3 3M17 20V4M17 4l3 3M17 20l-3-3" /></svg>
                {sortLabel}
              </button>
              {sortOpen && (
                <div className="fmenu fmenu-right" role="menu">
                  <span className="fmenu-hd">Sort by</span>
                  {SORTS.map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="menuitemradio"
                      aria-checked={sortBy === key}
                      className={`fmenu-item${sortBy === key ? " on" : ""}`}
                      onClick={() => { setSortBy(key); setSortOpen(false); }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </span>
            {/* Tile size. A shelf of 400 assets and a shelf of 8 do not want the
                same tile, and which one you are looking at changes hour to hour. */}
            {viewMode === "grid" ? (
              <span className="selwrap" role="group" aria-label="Tile size">
                {(Object.keys(TILE_SIZES) as TileSize[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`sb${tile === key ? " on" : ""}`}
                    aria-pressed={tile === key}
                    aria-label={`${TILE_SIZES[key].label} tiles`}
                    title={`${TILE_SIZES[key].label} tiles`}
                    onClick={() => setTile(key)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="4" y="4" width={key === "s" ? 5 : key === "m" ? 7 : 9} height={key === "s" ? 5 : key === "m" ? 7 : 9} rx="1.4" />
                      <rect x={key === "s" ? 11 : key === "m" ? 13 : 15} y="4" width={key === "s" ? 5 : key === "m" ? 7 : 9} height={key === "s" ? 5 : key === "m" ? 7 : 9} rx="1.4" />
                      <rect x="4" y={key === "s" ? 11 : key === "m" ? 13 : 15} width={key === "s" ? 5 : key === "m" ? 7 : 9} height={key === "s" ? 5 : key === "m" ? 7 : 9} rx="1.4" />
                    </svg>
                  </button>
                ))}
              </span>
            ) : null}
            <span className="selwrap" role="group" aria-label="View">
              <button type="button" className={`sb${viewMode === "grid" ? " on" : ""}`} aria-label="Grid view" aria-pressed={viewMode === "grid"} title="Grid" onClick={() => setViewMode("grid")}><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg></button>
              <button type="button" className={`sb${viewMode === "list" ? " on" : ""}`} aria-label="List view" aria-pressed={viewMode === "list"} title="List" onClick={() => setViewMode("list")}><svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg></button>
            </span>
          </div>

          {/* `menuopen` lifts the bar's `overflow: hidden` so a picker can escape
              it. The rule has existed since the port and was never applied, so
              "Add to campaign" opened a menu that was clipped out of sight —
              verified by hit-testing its centre, which returned a different
              element (BSR-707). It affects both pickers, so both drive it. */}
          <div className={`selbar${selmode ? " show" : ""}${campaignPickOpen || movePickOpen ? " menuopen" : ""}`} ref={selbarRef}>
            <span className="sc">{sel.size} selected</span>
            <span className="sa" onClick={() => { applyArc(allAssets.filter((a) => sel.has(a.id)), true); setSel(new Set()); }}><svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10" /></svg>Make available to Arc</span>
            <span className="sa sa-pick" style={{ position: "relative" }}>
              <span
                onClick={() => { if (campaigns.length > 0) setCampaignPickOpen((o) => !o); else setNotice("Create a campaign first, then you can add media to it."); }}
                {...(addingTo ? { "aria-busy": true } : {})}
              >
                <svg viewBox="0 0 24 24"><path d="M4 5h16v6H4z" /><path d="M4 15h10v4H4z" /></svg>
                {addingTo ? "Adding…" : "Add to campaign"}
              </span>
              {campaignPickOpen && campaigns.length > 0 && (
                <>
                  <span className="pickmenu" role="menu">
                    <span className="pickhd">Add {sel.size} to…</span>
                    {campaigns.map((c) => (
                      <span key={c.id} className="pickopt" role="menuitem" onClick={() => addSelectionToCampaign(c.id, c.name)}>{c.name}</span>
                    ))}
                  </span>
                </>
              )}
            </span>
            {/* Real <button>s, unlike the campaign picker beside it: this file is
                already baselined at 23 keyboard-unreachable click-spans
                (keyboard-reachable.test.ts) and a new control should not add
                the 24th. */}
            <span className="sa sa-pick" style={{ position: "relative" }}>
              <button
                type="button"
                className="sa-pick-trigger"
                aria-haspopup="menu"
                aria-expanded={movePickOpen}
                disabled={moving}
                onClick={() => { setMovePickOpen((o) => !o); setCampaignPickOpen(false); }}
              >
                <svg viewBox="0 0 24 24"><path d="M4 7h6l2 2h8v10H4z" /></svg>
                {moving ? "Moving…" : "Move to folder"}
              </button>
              {movePickOpen && (
                <>
                  <span className="pickmenu" role="menu">
                    <span className="pickhd">Move {sel.size} to…</span>
                    {moveTargets.map((f) => (
                      <button
                        key={f.id ?? "root"}
                        type="button"
                        className="pickopt"
                        role="menuitem"
                        onClick={() => moveSelectionToFolder(f.id, f.name)}
                      >
                        {f.name}
                      </button>
                    ))}
                  </span>
                </>
              )}
            </span>
            <button type="button" className="sa" onClick={handleDownloadSelection} disabled={downloading}>
              <svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>{downloading ? "Downloading…" : "Download"}
            </button>
            <span className="clr" onClick={() => setSel(new Set())}>Clear</span>
          </div>

          <div className="gridscroll">
            {arcSugg}
            {list.length === 0 ? (
              live && allAssets.length === 0 && !q ? (
                <div style={{ padding: "56px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Your library is empty</div>
                  <div style={{ color: "var(--muted)", fontSize: "12.5px", lineHeight: 1.6, maxWidth: 440, margin: "0 auto 16px" }}>
                    Upload your real photos, videos, and docs — this is the authentic media Arc packages into campaigns. You mark what Arc may reuse per asset.
                  </div>
                  <button
                    onClick={() => fileRef.current?.click()}
                    style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--accent-border)", background: "var(--accent-soft)", color: "var(--accent)", font: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                  >
                    Upload media
                  </button>
                </div>
              ) : (
                <div style={{ padding: "44px 16px", textAlign: "center", color: "var(--muted)", fontSize: "12.5px" }}>No assets match “{q}”</div>
              )
            ) : viewMode === "grid" ? (
              <div
                className="agrid"
                style={{ ["--tile" as string]: `${TILE_SIZES[tile].min}px`, ["--thumb" as string]: `${TILE_SIZES[tile].thumb}px` }}
              >
                {list.map((a) => (
                  <div
                    key={a.id}
                    className={`acard${sel.has(a.id) ? " sel" : ""}`}
                    title={a.nm}
                    onClick={() => openDetail(a)}
                    {...assetDragProps(a)}
                  >
                    <div className="athumb">
                      <ThumbMedia a={a} />
                      {a.kind === "video" && <span className="vbadge"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>}
                      {a.risk && <span className="risk" title="Risk flag"><Ico d='<path d="M12 9v4M12 17h.01M10.3 3.9l-8 14A2 2 0 004 21h16a2 2 0 001.7-3l-8-14a2 2 0 00-3.4 0z"/>' /></span>}
                      <div className="ov">
                        {/* A button, not a span: this was the only way to select
                            an asset and it was unreachable by keyboard and
                            invisible to a screen reader. */}
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={sel.has(a.id)}
                          aria-label={`Select ${a.nm}`}
                          className={`ck${sel.has(a.id) ? " on" : ""}`}
                          onClick={(e) => { e.stopPropagation(); toggleSel(a.id); }}
                        >{CHECK}</button>
                        <div className="qa">
                          {/* Was `window.location.href = "/campaigns"`. The button
                              said "Add to campaign" and added nothing — it
                              full-reloaded to the campaigns LIST, discarding the
                              selection on the way, while addLibraryAssetsToCampaign
                              sat wired to the bulk bar a few lines below. It now
                              selects this asset and opens that same picker. */}
                          <button
                            title="Add to campaign"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (campaigns.length === 0) { setNotice("Create a campaign first, then you can add media to it."); return; }
                              setSel(new Set([a.id]));
                              setCampaignPickOpen(true);
                            }}
                          ><Ico d='<path d="M4 5h16v6H4z"/><path d="M4 15h10v4H4z"/>' /></button>
                          {/* Was a full reload to /studio that dropped the asset.
                              Studio now takes ?asset=<id> and opens on it. */}
                          <button
                            title="Edit in Studio"
                            onClick={(e) => { e.stopPropagation(); router.push(a.rid ? `${STUDIO}?asset=${encodeURIComponent(a.rid)}` : STUDIO); }}
                          ><Ico d='<path d="M4 5h16v14H4z"/><path d="M4 14l5-4 4 3 3-2 4 3"/>' /></button>
                          <button title="Open" onClick={(e) => { e.stopPropagation(); openDetail(a); }}><Ico d='<path d="M7 17L17 7M9 7h8v8"/>' /></button>
                        </div>
                      </div>
                    </div>
                    {/* The info block is anchored to the bottom of a
                        fixed-height well, so on hover the name can un-clamp and
                        grow UP over the thumbnail without the card changing
                        size or the grid reflowing. Two clipped lines were the
                        whole story an operator got — "Before / after — storm r…"
                        and "Insurance-claim one-pa…" are not names you can tell
                        apart. */}
                    <div className="ainfowell">
                      <div className="ainfo">
                        <div className="an"><span className={`pdot pv-${a.pv}`} title={`${PVL[a.pv]} — where this came from`} />{a.nm}</div>
                        <div className="am">
                          <span>{PVL[a.pv]}</span>
                          {shapeUse(a.dim.split(" · ")[0]) ? <><span>·</span><span title={a.dim.split(" · ")[0]}>{shapeUse(a.dim.split(" · ")[0])}</span></> : null}
                          {isArc(a) ? <span className="arcok"><Ico d='<path d="M5 12l4 4 10-10"/>' /> Arc</span> : a.uses === 0 ? <span className="unused">unused</span> : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                <button type="button" className="uptile" onClick={() => fileRef.current?.click()}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 20h14" /></svg>
                  <span className="ut">Upload assets</span>
                  <span className="ud">{curFolder === ROOT_FOLDER ? "or drag files here" : `into ${folderName(tree, curFolder) ?? "this folder"}`}</span>
                </button>
              </div>
            ) : (
              <table className="ltbl">
                <thead><tr><th className="lcolname">Asset</th><th>Provenance</th><th>Kind</th><th>Dimensions</th><th>Size</th><th>Arc</th><th>Used in</th><th>Added</th><th className="lcolact"><span className="lvh">Actions</span></th></tr></thead>
                <tbody>
                  {list.map((a) => (
                    <tr key={a.id} className={sel.has(a.id) ? "sel" : ""} onClick={() => openDetail(a)} {...assetDragProps(a)}>
                      <td className="lcolname">
                        <div className="lname">
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={sel.has(a.id)}
                            aria-label={`Select ${a.nm}`}
                            className={`ck-l${sel.has(a.id) ? " on" : ""}`}
                            onClick={(e) => { e.stopPropagation(); toggleSel(a.id); }}
                          >{sel.has(a.id) ? CHECK : null}</button>
                          <span className="lthumb"><ThumbMedia a={a} /></span>
                          {/* The list is where you go when the grid's tiles are
                              too small to read a name — so this one wraps to
                              two lines rather than running off the column. */}
                          <span className="ln" title={a.nm}>{a.nm}</span>
                        </div>
                      </td>
                      <td><span className={`pvtag pvc-${a.pv}`}><span className={`pdot pv-${a.pv}`} />{PVL[a.pv]}</span></td>
                      <td className="lmono">{a.kind}</td>
                      <td className="lmono">{a.dim}</td>
                      <td className="lmono">{a.size}</td>
                      <td>{isArc(a) ? <span className="arcok" style={{ color: "var(--ok-text)", fontSize: "11px" }}>✓ Arc</span> : a.risk ? <span style={{ color: "var(--warn-text)", fontSize: "11px" }}>review</span> : <span style={{ color: "var(--muted)", fontSize: "11px" }}>—</span>}</td>
                      <td className="lcolused" title={a.used.join(", ")}>{a.uses ? `${a.used[0]}${a.uses > 1 ? ` +${a.uses - 1}` : ""}` : <span style={{ color: "var(--muted)" }}>unused</span>}</td>
                      <td className="lmono" style={{ color: "var(--muted)" }}>{a.added}</td>
                      {/* The same three actions the grid's tiles carry. The list
                          used to offer none of them, so choosing the readable
                          view meant giving up every per-asset control. */}
                      <td className="lcolact">
                        <span className="lacts">
                          <button
                            type="button"
                            aria-label={`Add ${a.nm} to a campaign`}
                            title="Add to campaign"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (campaigns.length === 0) { setNotice("Create a campaign first, then you can add media to it."); return; }
                              setSel(new Set([a.id]));
                              setCampaignPickOpen(true);
                            }}
                          ><Ico d='<path d="M4 5h16v6H4z"/><path d="M4 15h10v4H4z"/>' /></button>
                          <button
                            type="button"
                            aria-label={`Edit ${a.nm} in Studio`}
                            title="Edit in Studio"
                            onClick={(e) => { e.stopPropagation(); router.push(a_studioHref(a)); }}
                          ><Ico d='<path d="M4 5h16v14H4z"/><path d="M4 14l5-4 4 3 3-2 4 3"/>' /></button>
                          <button
                            type="button"
                            aria-label={`Open ${a.nm}`}
                            title="Open"
                            onClick={(e) => { e.stopPropagation(); openDetail(a); }}
                          ><Ico d='<path d="M7 17L17 7M9 7h8v8"/>' /></button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <aside className="inspector">
          {detail && (
            <>
              <div className="ihero">
                <ThumbMedia a={detail} />
                <span className="iclose" onClick={() => setDetail(null)}><Ico d='<path d="M6 6l12 12M18 6L6 18"/>' /></span>
                <span className={`ipv pvc-${detail.pv}`} style={{ background: "rgba(16,16,19,.7)" }}>{PVL[detail.pv]} media</span>
              </div>
              <div className="ibody">
                {renaming ? (
                  <input
                    className="iname-edit"
                    autoFocus
                    defaultValue={detail.nm}
                    aria-label="Asset name"
                    onKeyDown={(e) => { if (e.key === "Enter") saveRename(detail, e.currentTarget.value); if (e.key === "Escape") setRenaming(false); }}
                    onBlur={(e) => saveRename(detail, e.currentTarget.value)}
                  />
                ) : (
                  <button type="button" className="iname" onClick={() => setRenaming(true)} title="Click to rename">
                    <span>{detail.nm}</span>
                    <Ico d='<path d="M4 20h4L18.5 9.5a2.1 2.1 0 00-3-3L5 17v3z"/>' />
                  </button>
                )}
                <div className="irow"><span className="il">Kind · size</span><span className="iv">{detail.kind} · {detail.size}</span></div>
                <div className="irow"><span className="il">Dimensions</span><span className="iv">{detail.dim}</span></div>
                <div className="irow"><span className="il">Source</span><span className="iv" style={{ color: "var(--text-2)" }}>{detail.src}</span></div>
                <div className="irow"><span className="il">Added</span><span className="iv" style={{ color: "var(--text-2)" }}>{detail.by} · {detail.added}</span></div>
                <div className="irow"><span className="il">Tags</span>
                  {tagEditing ? (
                    <input
                      className="itag-edit"
                      autoFocus
                      defaultValue={detail.tags.join(", ")}
                      placeholder="tag, tag, tag"
                      aria-label="Asset tags (comma-separated)"
                      onKeyDown={(e) => { if (e.key === "Enter") saveTags(detail, e.currentTarget.value); if (e.key === "Escape") setTagEditing(false); }}
                      onBlur={(e) => saveTags(detail, e.currentTarget.value)}
                    />
                  ) : (
                    <button type="button" className="iv itag-view" onClick={() => setTagEditing(true)} title="Click to edit tags">
                      <span>{detail.tags.length ? detail.tags.join(", ") : "Add tags"}</span>
                      <Ico d='<path d="M4 20h4L18.5 9.5a2.1 2.1 0 00-3-3L5 17v3z"/>' />
                    </button>
                  )}
                </div>
                <div className="arctoggle">
                  <div><div className="at">Available to Arc</div><div className="ad">Arc may reuse this in drafts</div></div>
                  <span className={`toggle${isArc(detail) ? " on" : ""}`} onClick={() => toggleArc(detail)}><span className="sw" /></span>
                </div>
                {detail.risk && (
                  <div className="riskbox">
                    <div className="rt"><Ico d='<path d="M12 9v4M12 17h.01M10.3 3.9l-8 14A2 2 0 004 21h16a2 2 0 001.7-3l-8-14a2 2 0 00-3.4 0z"/>' />Risk flag</div>
                    <div className="rd">{detail.risk}</div>
                    {/* The flag stays on the record after approval — approving
                        acknowledges it, it does not erase it — so the resolved
                        state says "reviewed", not "no longer flagged". */}
                    {isApproved(detail) ? (
                      <div className="rdone">Reviewed and approved, with this flag on the record.</div>
                    ) : ackOpen ? (
                      <div className="rack">
                        <label className="rackl" htmlFor="risk-ack">How was this addressed?</label>
                        <textarea
                          id="risk-ack"
                          className="racki"
                          rows={2}
                          autoFocus
                          value={ackText}
                          onChange={(e) => setAckText(e.target.value)}
                          placeholder="e.g. the claim is backed by the 2026 warranty terms"
                        />
                        <div className="rackb">
                          <button type="button" className="gbtn" onClick={() => { setAckOpen(false); setAckText(""); }} disabled={approving}>Cancel</button>
                          <button type="button" className="gbtn gold" onClick={() => void handleApproveRisk(detail)} disabled={approving || ackText.trim().length < 3}>
                            {approving ? "Recording…" : "Approve"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="rfix">
                        <button type="button" className="gbtn" style={{ height: 30, fontSize: "11.5px" }} onClick={() => setAckOpen(true)}>
                          Resolve &amp; approve
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div className="isec">Provenance lineage</div>
                <div className="lineage">{detail.lineage.map((l, i) => <div key={i} className="lstep"><span className={`ld pv-${l[0]}`} /><div className="lt">{l[1]}</div></div>)}</div>
                {detail.prompt ? (
                  <>
                    <div className="isec">Generation prompt</div>
                    <div className="iprompt">{detail.prompt}</div>
                  </>
                ) : null}
                {detail.used.length ? (
                  <>
                    <div className="isec">Used in {detail.used.length}</div>
                    {detail.used.map((u, i) => <Link key={i} className="usedrow" href={CAMPAIGNS}><Ico d='<path d="M4 5h16v6H4z"/><path d="M4 15h10v4H4z"/>' /><span>{u}</span><span className="go">→</span></Link>)}
                  </>
                ) : (
                  <>
                    <div className="isec">Usage</div>
                    <div style={{ fontSize: "11.5px", color: "var(--muted)" }}>Not used in any campaign yet.</div>
                  </>
                )}
                <div className="iacts">
                  <Link className="gbtn gold full" href={a_studioHref(detail)}><svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10z" /><path d="M19 15l.9 2.6L22 18.5l-2.1.9L19 22l-.9-2.6L16 18.5l2.1-.9z" /></svg>Make an ad from this</Link>
                  <Link className="gbtn" href={a_studioHref(detail)}><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z" /><path d="M4 14l5-4 4 3 3-2 4 3" /></svg>Edit in Studio</Link>
                  <button
                    type="button"
                    className="gbtn"
                    onClick={() => {
                      if (campaigns.length === 0) { setNotice("Create a campaign first, then you can add media to it."); return; }
                      setSel(new Set([detail.id]));
                      setDetail(null);
                      setCampaignPickOpen(true);
                    }}
                  ><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>Add to campaign</button>
                  <button
                    type="button"
                    className="gbtn full"
                    onClick={() => void handleDownload(detail)}
                    disabled={!detail.img || downloading}
                    title={detail.img ? undefined : "No stored file for this asset yet"}
                  >
                    <svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>{downloading ? "Downloading…" : "Download"}
                  </button>
                  {confirmDelete ? (
                    <div className="idelconfirm">
                      <span className="idelwarn">
                        {detail.used.length > 0
                          ? `Used in ${detail.used.length} campaign${detail.used.length === 1 ? "" : "s"} — those keep their copy, but it leaves the Library. Delete?`
                          : "Remove this from the Library? This can’t be undone."}
                      </span>
                      <div className="idelbtns">
                        <button type="button" className="gbtn" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</button>
                        <button type="button" className="gbtn danger" onClick={() => handleDelete(detail)} disabled={deleting}>{deleting ? "Deleting…" : "Delete"}</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="gbtn danger full" onClick={() => setConfirmDelete(true)}>
                      <svg viewBox="0 0 24 24"><path d="M4 7h16M6 7l1 13h10l1-13M10 7V4h4v3" /></svg>Delete from Library
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* Portaled for the same reason the modals are: `.lib-notice` is
          `position: fixed; left: 50%`, which inside `.page-enter` centers it on
          the content pane rather than the window — 118px off-centre at a 1080px
          viewport. See overlay-portal.tsx. */}
      {notice && (
        <OverlayPortal>
          <div className="lib-notice" role="status">
            <span>{notice}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </OverlayPortal>
      )}

      <NewFolderModal
        key={folderOpen ? `open-${newFolderParent ?? "root"}` : "closed"}
        open={folderOpen}
        onClose={() => { setFolderOpen(false); setNewFolderParent(null); }}
        onSubmit={handleCreateFolder}
        parentName={newFolderParent ? folderName(tree, newFolderParent) ?? null : null}
      />

      {/* Keyed by folder id so reopening on a different folder resets the form
          to that folder's own values rather than the last one's. */}
      {detailsFolder && (
        <FolderDetailsModal
          key={`details-${detailsFolder}`}
          open
          folderName={findInTree(tree, detailsFolder)?.name ?? ""}
          description={findInTree(tree, detailsFolder)?.description ?? null}
          onClose={() => setDetailsFolder(null)}
          onSubmit={(value) => saveFolderDetails(detailsFolder, value)}
        />
      )}

      <ImportUrlModal
        key={importOpen ? "import-open" : "import-closed"}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSubmit={handleImportUrl}
      />
    </div>
  );
}
