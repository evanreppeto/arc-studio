"use client";

import { useMemo, useRef, useState } from "react";

import { formatByteSize } from "@/domain";

import { createLibraryFolder, deleteLibraryAsset, deleteLibraryFolder, importLibraryAssetFromUrl, renameLibraryAsset, renameLibraryFolder, setLibraryAssetArcAvailability, setLibraryAssetTags, uploadLibraryAsset } from "../actions";
import { addLibraryAssetsToCampaign } from "../actions";
import { ImportUrlModal } from "./import-url-modal";
import { NewFolderModal } from "./new-folder-modal";

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
  /** Generation prompt from stored provenance — shown on the detail card. */
  prompt?: string;
  img?: string;
  lineage: [string, string][];
  uses: number;
};

export type Folder = { f: string; name: string; color: string; icon: string; children?: Folder[] };

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
const PVL: Record<Prov, string> = { real: "Real", ai: "AI", comp: "Composite", upload: "Imported", logo: "Logo", doc: "Doc" };
const IMGBASE = "https://d8j0ntlcm91z4.cloudfront.net/user_3FaOq1cCR2Izxa2haYxVnIrhIBK/";
const IMG = {
  team: IMGBASE + "hf_20260625_205928_522fa33a-3aa6-4e05-8a8b-db2bd83a688d_min.webp",
  dash: IMGBASE + "hf_20260625_205928_16464999-955a-4ad8-9f7e-44da9947830a_min.webp",
  gold: IMGBASE + "hf_20260625_205929_a9338cf5-b522-492f-beec-7dbde6855c47_min.webp",
  net: IMGBASE + "hf_20260625_205931_37df2ef4-9e88-4343-ae6d-ef6341c2fdcd_min.webp",
  face: IMGBASE + "hf_20260625_205931_f15ef3f6-cbb7-40e4-a6d8-addb78e7ccb0_min.webp",
};
const SC2IMG: Record<string, string> = { photo: IMG.team, crew: IMG.team, ui: IMG.dash, ai: IMG.gold, ai2: IMG.net, comp: IMG.net, beforeafter: IMG.gold, video: IMG.dash };

const ICONS: Record<string, string> = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  shield: '<path d="M12 3l8 4v6c0 4-3.5 7-8 8-4.5-1-8-4-8-8V7z"/>',
  mark: '<path d="M12 3l2.2 6L20 11l-5.8 2L12 19l-2.2-6L4 11l5.8-2z"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M3 17l5-4 4 3 3-2 6 4"/>',
  sparkle: '<path d="M11 3l1.6 4.4L17 9l-4.4 1.6L11 15l-1.6-4.4L5 9l4.4-1.6z"/><path d="M18.5 13l.6 1.8 1.9.7-1.9.7-.6 1.8-.6-1.8-1.9-.7 1.9-.7z"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  import: '<path d="M12 3v11M8 10l4 4 4-4"/><path d="M5 20h14"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>',
  folder: '<path d="M4 7h6l2 2h8v10H4z"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
};

const TREE: Folder[] = [
  { f: "all", name: "All assets", color: "#c8a24a", icon: "grid" },
  { f: "brand", name: "Brand kit", color: "#c47055", icon: "shield", children: [{ f: "logos", name: "Logos & marks", color: "#9aa0ac", icon: "mark" }] },
  { f: "real", name: "Real photos", color: "#7fb89a", icon: "photo", children: [{ f: "customers", name: "Customer photos", color: "#7fb89a", icon: "photo" }] },
  { f: "ai", name: "AI-generated", color: "#c8a24a", icon: "sparkle" },
  { f: "comp", name: "Composites", color: "#9678c8", icon: "layers" },
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
        <img src={url} loading="lazy" alt="" onError={() => setFailed(true)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      ) : null}
    </>
  );
}
function Ico({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} dangerouslySetInnerHTML={{ __html: d }} />;
}

function descKeys(key: string): string[] {
  const find = (k: string, arr: Folder[]): Folder | null => {
    for (const n of arr) { if (n.f === k) return n; if (n.children) { const r = find(k, n.children); if (r) return r; } }
    return null;
  };
  const node = find(key, TREE);
  if (!node) return [key];
  const out: string[] = [];
  const rec = (n: Folder) => { out.push(n.f); n.children?.forEach(rec); };
  rec(node);
  return out;
}

// The campaigns board is the real create surface (New campaign opens a modal);
// the old /campaigns/new static builder is no longer linked.
const NEW_CAMPAIGN = "/campaigns";
const STUDIO = "/studio";

export function LibraryView({
  assets,
  folders,
  live = false,
  totalBytes,
  campaigns = [],
}: { assets?: Asset[]; folders?: Folder[]; live?: boolean; totalBytes?: number; campaigns?: { id: string; name: string }[] } = {}) {
  const [curFolder, setCurFolder] = useState("all");
  const [curKind, setCurKind] = useState("all");
  const [curColl, setCurColl] = useState("all");
  const [sortBy, setSortBy] = useState<"recent" | "name" | "used">("recent");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ brand: true, real: true });
  const [detail, setDetail] = useState<Asset | null>(null);
  const [arcState, setArcState] = useState<Record<number, boolean>>({});
  // Assets deleted this session — hidden optimistically before the refetch.
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // In-session name/tag edits, overlaid on the immutable base assets.
  const [edits, setEdits] = useState<Record<number, { nm?: string; tags?: string[] }>>({});
  const [renaming, setRenaming] = useState(false);
  const [tagEditing, setTagEditing] = useState(false);
  // Folder management: which folder is being renamed / pending a delete confirm.
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [folderConfirmDelete, setFolderConfirmDelete] = useState<string | null>(null);
  const [suggDismissed, setSuggDismissed] = useState(false);
  // Folders + uploads created this session. Folders persist via createLibraryFolder;
  // uploads are held client-side (real media-store persistence lands with the
  // real data feed). Both show instantly.
  const [tree, setTree] = useState<Folder[]>(folders ?? TREE);
  const [uploaded, setUploaded] = useState<Asset[]>([]);
  const [folderOpen, setFolderOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // "Add to campaign" picker. The control used to be a bare link to /campaigns,
  // which navigated away and silently discarded the selection.
  const [campaignPickOpen, setCampaignPickOpen] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const uidRef = useRef(-1);

  const baseAssets = assets ?? ALL_ASSETS;
  const allAssets = useMemo(
    () => [...uploaded, ...baseAssets]
      .filter((a) => !deletedIds.has(a.id))
      .map((a) => (edits[a.id] ? { ...a, ...(edits[a.id].nm !== undefined ? { nm: edits[a.id].nm! } : {}), ...(edits[a.id].tags !== undefined ? { tags: edits[a.id].tags! } : {}) } : a)),
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

  // Folder counts over the live asset set (base assets + this session's uploads).
  const rcountLive = (f: string): number => {
    if (f === "all") return allAssets.length;
    const ks = descKeys(f);
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
    setTree((prev) => [...prev, { f: key, name, color: "#88b6d8", icon: "folder" }]);
    setNotice(null);
    const res = await createLibraryFolder(name);
    if (!res.ok) {
      setTree((prev) => prev.filter((t) => t.f !== key));
      return { ok: false, error: res.error };
    }
    setCurFolder(key);
    return { ok: true };
  }

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
    const dk = curFolder === "all" ? null : descKeys(curFolder);
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
      arc: allAssets.filter(isArc).length,
      rev: allAssets.filter(needsReview).length,
      un: allAssets.filter((a) => a.uses === 0).length,
      byk,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arcState, allAssets]);

  const toggleSel = (id: number) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selmode = sel.size > 0;

  const sortLabel = sortBy === "recent" ? "Recent" : sortBy === "name" ? "Name" : "Most used";
  const cycleSort = () => setSortBy((s) => (s === "recent" ? "name" : s === "name" ? "used" : "recent"));

  const openDetail = (a: Asset) => { setConfirmDelete(false); setRenaming(false); setTagEditing(false); setDetail(a); };

  // Apply a name/tag edit to the overlay (for the grid) and the open inspector.
  const applyEdit = (id: number, patch: { nm?: string; tags?: string[] }) => {
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

  const CHECK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path d="M5 12l4 4 10-10" /></svg>;

  // Pure tree ops for optimistic folder rename/delete (folders live in `tree`).
  const renameInTree = (nodes: Folder[], id: string, name: string): Folder[] =>
    nodes.map((n) => (n.f === id ? { ...n, name } : n.children ? { ...n, children: renameInTree(n.children, id, name) } : n));
  const removeFromTree = (nodes: Folder[], id: string): Folder[] =>
    nodes.filter((n) => n.f !== id).map((n) => (n.children ? { ...n, children: removeFromTree(n.children, id) } : n));
  const folderName = (nodes: Folder[], id: string): string | undefined => {
    for (const n of nodes) { if (n.f === id) return n.name; if (n.children) { const r = folderName(n.children, id); if (r) return r; } }
    return undefined;
  };

  const saveFolderRename = (id: string, value: string) => {
    setRenamingFolder(null);
    const name = value.trim();
    const current = folderName(tree, id);
    if (!name || name === current) return;
    setTree((t) => renameInTree(t, id, name));
    renameLibraryFolder(id, name).then((res) => { if (!res.ok) { setTree((t) => renameInTree(t, id, current ?? name)); setNotice(res.error); } });
  };
  const handleFolderDelete = (id: string) => {
    setFolderConfirmDelete(null);
    const snapshot = tree;
    // Assets fall back to "All assets" (FK ON DELETE SET NULL); remove the node here.
    setTree((t) => removeFromTree(t, id));
    if (curFolder === id) setCurFolder("all");
    deleteLibraryFolder(id).then((res) => { if (!res.ok) { setTree(snapshot); setNotice(res.error); } });
  };

  const renderFolder = (F: Folder, sub = false) => {
    const hasKids = !!F.children?.length;
    const open = !!expanded[F.f];
    const rows = [
      <div key={F.f} className={`folder${F.f === curFolder ? " on" : ""}`} onClick={() => setCurFolder(F.f)}>
        <span
          className={`tchev${hasKids ? (open ? " open" : "") : " leaf"}`}
          onClick={(e) => { e.stopPropagation(); if (hasKids) setExpanded((p) => ({ ...p, [F.f]: !p[F.f] })); }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} dangerouslySetInnerHTML={{ __html: ICONS.chev }} />
        </span>
        <span className="ficon" style={{ background: `${F.color}22`, border: `1px solid ${F.color}55`, color: F.color }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} dangerouslySetInnerHTML={{ __html: ICONS[F.icon] }} />
        </span>
        {renamingFolder === F.f ? (
          <input
            className="fn-edit"
            autoFocus
            defaultValue={F.name}
            aria-label="Folder name"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") saveFolderRename(F.f, e.currentTarget.value); if (e.key === "Escape") setRenamingFolder(null); }}
            onBlur={(e) => saveFolderRename(F.f, e.currentTarget.value)}
          />
        ) : (
          <span className="fn">{F.name}</span>
        )}
        <span className="fc">{rcountLive(F.f)}</span>
        {F.f !== "all" && renamingFolder !== F.f && (
          folderConfirmDelete === F.f ? (
            <span className="fmanage" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="ficonbtn danger" title="Delete — assets move to All assets" onClick={() => handleFolderDelete(F.f)}>
                <svg viewBox="0 0 24 24"><path d="M5 12l4 4L19 6" /></svg>
              </button>
              <button type="button" className="ficonbtn" title="Cancel" onClick={() => setFolderConfirmDelete(null)}>
                <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </span>
          ) : (
            <span className="fmanage" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="ficonbtn" title="Rename folder" onClick={() => { setRenamingFolder(F.f); setFolderConfirmDelete(null); }}>
                <svg viewBox="0 0 24 24"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 00-3-3L5 17v3z" /></svg>
              </button>
              <button type="button" className="ficonbtn" title="Delete folder" onClick={() => setFolderConfirmDelete(F.f)}>
                <svg viewBox="0 0 24 24"><path d="M4 7h16M6 7l1 13h10l1-13M10 7V4h4v3" /></svg>
              </button>
            </span>
          )
        )}
      </div>,
    ];
    if (hasKids && open) rows.push(<div key={`${F.f}-kids`} className="tchildren">{F.children!.map((c) => renderFolder(c, true))}</div>);
    return sub ? <div key={`${F.f}-w`}>{rows}</div> : <div key={`${F.f}-w`}>{rows}</div>;
  };

  // Arc-approved assets that have never been used in a campaign. Counted over the
  // live set (not the demo constant) so the nudge can't claim assets the library
  // doesn't have, and hidden entirely when there are none to draft from.
  const unshipped = allAssets.filter((a) => isArc(a) && a.uses === 0).length;

  const arcSugg = !suggDismissed && !q && unshipped > 0 ? (
    <div className="arcsugg">
      <span className="am">A</span>
      <span className="at"><b>{unshipped} approved {unshipped === 1 ? "asset has" : "assets have"} never shipped.</b> Want Arc to draft ad variants from your best unused photos?</span>
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
        <div className="obig"><span className="ov">{totals.total}</span><span className="ol">assets</span></div>
        <div className="obars">
          <span className="obar"><i style={{ background: "#7fb89a" }} />{totals.byk.image} images</span>
          <span className="obar"><i style={{ background: "#bd6a58" }} />{totals.byk.video} videos</span>
          <span className="obar"><i style={{ background: "#9aa0ac" }} />{totals.byk.logo} logos</span>
          <span className="obar"><i style={{ background: "#9aa0ac" }} />{totals.byk.document} docs</span>
        </div>
        <div className="ospacer" />
        <span className="ostat ok" onClick={() => setCurColl("arc")}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a3d0b8" strokeWidth={2}><path d="M5 12l4 4 10-10" /></svg><b>{totals.arc}</b> Arc-ready</span>
        <span className="ostat warn" onClick={() => setCurColl("review")}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#e7c486" strokeWidth={2}><path d="M12 9v4M12 17h.01M10.3 3.9l-8 14A2 2 0 004 21h16a2 2 0 001.7-3l-8-14a2 2 0 00-3.4 0z" /></svg><b>{totals.rev}</b> need review</span>
        <span className="ostat" onClick={() => setCurColl("unused")}><b>{totals.un}</b> unused</span>
        {/* Real bytes stored. There is no storage quota in the backend, so this
            reports usage rather than a meter against an invented limit. */}
        {totalBytes != null ? <span className="ostat"><b>{formatByteSize(totalBytes)}</b> stored</span> : null}
      </div>

      <div className={`lib${detail ? " detail" : ""}${selmode ? " selmode" : ""}`}>
        <aside className="tree">
          <div className="treeh">Folders <span className="add" title="New folder" onClick={() => setFolderOpen(true)}>＋</span></div>
          <div>
            {renderFolder(tree[0])}
            <div className="treesec" />
            {tree.slice(1).map((F) => renderFolder(F))}
            <div className="newfolder" onClick={() => setFolderOpen(true)}><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>New folder</div>
          </div>
        </aside>

        <section className="gallery">
          <div className="gtoolbar">
            <span className="lsearch"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter assets…" /></span>
            {([["all", "All"], ["arc", "Arc-ready"], ["review", "Needs review"], ["unused", "Unused"], ["recent", "Recent"]] as const).map(([k, label]) => (
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
            <span className="sortbtn" onClick={cycleSort}><svg viewBox="0 0 24 24"><path d="M7 4v16M7 20l-3-3M7 4l3 3M17 20V4M17 4l3 3M17 20l-3-3" /></svg>{sortLabel}</span>
            <span className="selwrap">
              <span className={`sb${viewMode === "grid" ? " on" : ""}`} title="Grid" onClick={() => setViewMode("grid")}><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg></span>
              <span className={`sb${viewMode === "list" ? " on" : ""}`} title="List" onClick={() => setViewMode("list")}><svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg></span>
            </span>
          </div>

          <div className={`selbar${selmode ? " show" : ""}`}>
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
                  <span className="pickscrim" onClick={() => setCampaignPickOpen(false)} />
                  <span className="pickmenu" role="menu">
                    <span className="pickhd">Add {sel.size} to…</span>
                    {campaigns.map((c) => (
                      <span key={c.id} className="pickopt" role="menuitem" onClick={() => addSelectionToCampaign(c.id, c.name)}>{c.name}</span>
                    ))}
                  </span>
                </>
              )}
            </span>
            <span className="sa"><svg viewBox="0 0 24 24"><path d="M4 7h6l2 2h8v10H4z" /></svg>Move to folder</span>
            <span className="sa"><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>Download</span>
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
              <div className="agrid">
                {list.map((a) => (
                  <div key={a.id} className={`acard${sel.has(a.id) ? " sel" : ""}`} onClick={() => openDetail(a)}>
                    <div className="athumb">
                      <ThumbMedia a={a} />
                      {a.kind === "video" && <span className="vbadge"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>}
                      {a.risk && <span className="risk" title="Risk flag"><Ico d='<path d="M12 9v4M12 17h.01M10.3 3.9l-8 14A2 2 0 004 21h16a2 2 0 001.7-3l-8-14a2 2 0 00-3.4 0z"/>' /></span>}
                      <div className="ov">
                        <span className={`ck${sel.has(a.id) ? " on" : ""}`} onClick={(e) => { e.stopPropagation(); toggleSel(a.id); }}>{CHECK}</span>
                        <div className="qa">
                          <button title="Add to campaign" onClick={(e) => { e.stopPropagation(); window.location.href = NEW_CAMPAIGN; }}><Ico d='<path d="M4 5h16v6H4z"/><path d="M4 15h10v4H4z"/>' /></button>
                          <button title="Edit in Studio" onClick={(e) => { e.stopPropagation(); window.location.href = STUDIO; }}><Ico d='<path d="M4 5h16v14H4z"/><path d="M4 14l5-4 4 3 3-2 4 3"/>' /></button>
                          <button title="Open" onClick={(e) => { e.stopPropagation(); openDetail(a); }}><Ico d='<path d="M7 17L17 7M9 7h8v8"/>' /></button>
                        </div>
                      </div>
                    </div>
                    <div className="ainfo">
                      <div className="an"><span className={`pdot pv-${a.pv}`} />{a.nm}</div>
                      <div className="am">
                        <span>{a.kind}</span><span>·</span><span>{a.dim.split(" · ")[0]}</span>
                        {isArc(a) ? <span className="arcok"><Ico d='<path d="M5 12l4 4 10-10"/>' /> Arc</span> : a.uses === 0 ? <span className="unused">unused</span> : null}
                      </div>
                    </div>
                  </div>
                ))}
                <div className="uptile"><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 20h14" /></svg><div className="ut">Upload assets</div><div className="ud">or drag files here</div></div>
              </div>
            ) : (
              <table className="ltbl">
                <thead><tr><th>Asset</th><th>Provenance</th><th>Kind</th><th>Dimensions</th><th>Arc</th><th>Used in</th><th>Added</th></tr></thead>
                <tbody>
                  {list.map((a) => (
                    <tr key={a.id} className={sel.has(a.id) ? "sel" : ""} onClick={() => openDetail(a)}>
                      <td>
                        <div className="lname">
                          <span className={`ck-l${sel.has(a.id) ? " on" : ""}`} onClick={(e) => { e.stopPropagation(); toggleSel(a.id); }}>{sel.has(a.id) ? CHECK : null}</span>
                          <span className="lthumb"><ThumbMedia a={a} /></span>
                          <span className="ln">{a.nm}</span>
                        </div>
                      </td>
                      <td><span className={`pvtag pvc-${a.pv}`}><span className={`pdot pv-${a.pv}`} />{PVL[a.pv]}</span></td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: "11px" }}>{a.kind}</td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: "11px" }}>{a.dim}</td>
                      <td>{isArc(a) ? <span className="arcok" style={{ color: "var(--ok-text)", fontSize: "11px" }}>✓ Arc</span> : a.risk ? <span style={{ color: "var(--warn-text)", fontSize: "11px" }}>review</span> : <span style={{ color: "var(--muted)", fontSize: "11px" }}>—</span>}</td>
                      <td style={{ fontSize: "11px" }}>{a.uses ? `${a.used[0]}${a.uses > 1 ? ` +${a.uses - 1}` : ""}` : <span style={{ color: "var(--muted)" }}>unused</span>}</td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: "10.5px", color: "var(--muted)" }}>{a.added}</td>
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
                    <div className="rfix"><span className="gbtn" style={{ height: 30, fontSize: "11.5px" }}>Resolve &amp; approve</span></div>
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
                    {detail.used.map((u, i) => <a key={i} className="usedrow" href={NEW_CAMPAIGN}><Ico d='<path d="M4 5h16v6H4z"/><path d="M4 15h10v4H4z"/>' /><span>{u}</span><span className="go">→</span></a>)}
                  </>
                ) : (
                  <>
                    <div className="isec">Usage</div>
                    <div style={{ fontSize: "11.5px", color: "var(--muted)" }}>Not used in any campaign yet.</div>
                  </>
                )}
                <div className="iacts">
                  <a className="gbtn gold full" href={STUDIO}><svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10z" /></svg>Generate a variation</a>
                  <a className="gbtn" href={STUDIO}><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z" /><path d="M4 14l5-4 4 3 3-2 4 3" /></svg>Edit in Studio</a>
                  <a className="gbtn" href={NEW_CAMPAIGN}><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>Add to campaign</a>
                  <span className="gbtn full"><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>Download</span>
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

      {notice && (
        <div className="lib-notice" role="status">
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      )}

      <NewFolderModal
        key={folderOpen ? "open" : "closed"}
        open={folderOpen}
        onClose={() => setFolderOpen(false)}
        onSubmit={handleCreateFolder}
      />

      <ImportUrlModal
        key={importOpen ? "import-open" : "import-closed"}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSubmit={handleImportUrl}
      />
    </div>
  );
}
