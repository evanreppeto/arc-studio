import { assessProvenance, describeExternalMediaProvenance, toWorkState, WORK_STATE_LABEL } from "@/domain";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getMediaLibraryData } from "@/lib/media-library/read-model";
import { listCampaignNames } from "@/lib/campaigns/read-model";
import type { MediaAssetView, MediaFolderView } from "@/lib/media-library/types";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { LibraryView, type Asset, type Folder } from "./_components/library-view";
import { reportDegraded } from "@/lib/observability/report-degraded";
import "./library.css";

export const metadata = { title: "Library — Arc Studio" };

// Purple-free and red-free: folder colours are decoration, and red is reserved
// for destructive controls (DESIGN.md §4.2, BSR-661).
const FOLDER_PALETTE = ["#c8a24a", "#7fb89a", "#88b6d8", "#8fa2ba", "#6fae9e", "#d8935a"];

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
/**
 * Short "added" label. The card had this hardcoded to "" for real assets because
 * the view never carried created_at — so every live asset claimed no age while
 * the demo fixtures showed one.
 */
function addedLabel(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1mo ago" : `${months}mo ago`;
}

/**
 * approval_status → the word a reviewer recognises on a card.
 *
 * The same decision as the one on a campaign deliverable, so the same words: an
 * asset here used to read "In review" while the identical state on /campaigns
 * read "Needs you" (BSR-656).
 */
function reviewLabel(status: string): string {
  return WORK_STATE_LABEL[toWorkState(status)];
}

function mapAsset(v: MediaAssetView, i: number): Asset {
  const pv = provFromSource(v.source);
  const label = v.badge || v.source;
  const external = describeExternalMediaProvenance(v.provenance);
  // BSR-514: an asset whose origin we can't account for must not render clean.
  // The stored flags alone would leave "source unknown" looking reviewed-and-fine.
  const prov = assessProvenance({ source: v.source, provenance: v.provenance, riskFlags: v.riskFlags });
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
    added: addedLabel(v.createdAt),
    recent: 0,
    risk: prov.riskFlags.length ? prov.riskFlags.join(" · ") : undefined,
    img: v.url && v.url !== "pending" ? v.url : undefined,
    src: label,
    lineage: [
      [pv, label],
      ...external.rows,
      // Review state (BSR-538): an asset that has been decided on says so, and
      // by whom — an unreviewed asset simply has no row rather than a
      // reassuring-looking blank.
      ...(v.approvalStatus
        ? ([[
            v.approvalStatus === "approved" ? "real" : "upload",
            `${reviewLabel(v.approvalStatus)}${v.approvalReviewedBy ? ` · ${v.approvalReviewedBy}` : ""}${
              v.approvalReviewedAt ? ` · ${addedLabel(v.approvalReviewedAt)}` : ""
            }`,
          ]] as [string, string][])
        : []),
    ],
    prompt: external.prompt ?? undefined,
    // The review state as a FIELD, not only as the lineage sentence above. The
    // risk box needs to know whether this asset has already been decided on:
    // approving acknowledges a flag, it does not clear it, so without this the
    // box would keep offering "Resolve & approve" on an asset that was approved
    // an hour ago and the operator would have no way to tell (BSR-687).
    approvalStatus: v.approvalStatus ?? undefined,
    uses: v.usedInCount,
  };
}

/**
 * Flat MediaFolderView[] → the view's nested Folder tree, with the "All assets"
 * root prepended.
 *
 * `buildFolderViews` puts a synthetic `{ id: "all", name: "All media" }` row at
 * the head of its list, and this used to map it like any other folder — so live
 * workspaces rendered the root TWICE (an "All media" row under the "All assets"
 * one) with duplicate React keys, while the backend-less preview, which builds
 * its tree from a constant, looked perfectly fine. It is dropped here, once, by
 * the same id the view uses for the root.
 */
function mapFolders(views: MediaFolderView[]): Folder[] {
  const real = views.filter((v) => v.id !== "all");
  const nodes = new Map<string, Folder>();
  real.forEach((v, i) => nodes.set(v.id, { f: v.id, name: v.name, color: FOLDER_PALETTE[i % FOLDER_PALETTE.length], icon: "folder", description: v.description, children: [] }));
  const roots: Folder[] = [];
  real.forEach((v) => {
    const node = nodes.get(v.id);
    if (!node) return;
    const parent = v.parentId ? nodes.get(v.parentId) : null;
    if (parent) (parent.children ??= []).push(node);
    else roots.push(node);
  });
  return [{ f: "all", name: "All assets", color: "#c8a24a", icon: "grid" }, ...roots];
}

export default async function LibraryPage() {
  // Correctly silent (BSR-546): (app)/layout.tsx is the auth boundary; a null
  // context here renders a coherent empty state, not a false claim about data.
  const ctx = await getCurrentWorkspaceContext().catch(() => null);
  if (ctx?.orgId && isSupabaseAdminConfigured()) {
    const [data, campaigns] = await Promise.all([
      // PRIMARY: the media list IS the Library. Empty reads as "you have no
      // approved media", which would send an operator off to re-upload assets
      // they already own.
      getMediaLibraryData(getSupabaseAdminClient(), ctx.orgId).catch((error) => {
        reportDegraded(error, { scope: "library.getMediaLibraryData", surface: "primary" });
        return null;
      }),
      // Campaign options for the selection bar's "Add to campaign" picker.
      // Correctly silent (BSR-546): picker options; an empty dropdown is visible.
      listCampaignNames(ctx.orgId, undefined, ctx.workspaceId).catch(() => []),
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
