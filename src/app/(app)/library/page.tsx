import { describeExternalMediaProvenance } from "@/domain";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getMediaLibraryData } from "@/lib/media-library/read-model";
import { listCampaignNames } from "@/lib/campaigns/read-model";
import type { MediaAssetView, MediaFolderView } from "@/lib/media-library/types";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { LibraryView, type Asset, type Folder } from "./_components/library-view";
import "./library.css";

export const metadata = { title: "Library — Arc Studio" };

const FOLDER_PALETTE = ["#c47055", "#7fb89a", "#c8a24a", "#9678c8", "#88b6d8", "#bd6a58"];

function provFromSource(source: string): Asset["pv"] {
  switch (source) {
    case "ai_generated": return "ai";
    case "composite": return "comp";
    case "real": return "real";
    case "logo": return "logo";
    case "document": return "doc";
    default: return "upload";
  }
}

function kindForView(kind: string): Asset["kind"] {
  return kind === "video" ? "video" : kind === "document" ? "document" : kind === "logo" ? "logo" : "image";
}

function scForKind(kind: string): string {
  return kind === "video" ? "video" : kind === "document" ? "doc" : kind === "logo" ? "logo" : "photo";
}

/** MediaAssetView (read model) → the Library view's Asset shape. */
function mapAsset(v: MediaAssetView, i: number): Asset {
  const pv = provFromSource(v.source);
  const label = v.badge || v.source;
  const external = describeExternalMediaProvenance(v.provenance);
  return {
    id: i + 1,
    rid: v.id,
    nm: v.fileName,
    kind: kindForView(v.kind),
    pv,
    sc: scForKind(v.kind),
    folder: v.folderId ?? "",
    dim: v.dimensions ?? "—",
    size: v.size ?? "—",
    tags: v.tags,
    arc: v.availableToArc,
    used: [],
    by: v.uploadedBy ?? "",
    added: "",
    recent: 0,
    risk: v.riskFlags.length ? v.riskFlags.join(" · ") : undefined,
    img: v.url && v.url !== "pending" ? v.url : undefined,
    src: label,
    lineage: [[pv, label], ...external.rows],
    prompt: external.prompt ?? undefined,
    uses: v.usedInCount,
  };
}

/** Flat MediaFolderView[] → the view's nested Folder tree, with the "All assets" root prepended. */
function mapFolders(views: MediaFolderView[]): Folder[] {
  const nodes = new Map<string, Folder>();
  views.forEach((v, i) => nodes.set(v.id, { f: v.id, name: v.name, color: FOLDER_PALETTE[i % FOLDER_PALETTE.length], icon: "folder", children: [] }));
  const roots: Folder[] = [];
  views.forEach((v) => {
    const node = nodes.get(v.id);
    if (!node) return;
    const parent = v.parentId ? nodes.get(v.parentId) : null;
    if (parent) (parent.children ??= []).push(node);
    else roots.push(node);
  });
  return [{ f: "all", name: "All assets", color: "#c8a24a", icon: "grid" }, ...roots];
}

export default async function LibraryPage() {
  const ctx = await getCurrentWorkspaceContext().catch(() => null);
  if (ctx?.orgId && isSupabaseAdminConfigured()) {
    const [data, campaigns] = await Promise.all([
      getMediaLibraryData(getSupabaseAdminClient(), ctx.orgId).catch(() => null),
      // Campaign options for the selection bar's "Add to campaign" picker.
      listCampaignNames(ctx.orgId).catch(() => []),
    ]);
    if (data && data.status === "live") {
      return (
        <LibraryView
          assets={data.assets.map(mapAsset)}
          folders={mapFolders(data.folders)}
          live
          totalBytes={data.totalBytes}
          campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
        />
      );
    }
  }
  // Offline / not configured → the built-in demo set (keeps the preview populated).
  return <LibraryView />;
}
