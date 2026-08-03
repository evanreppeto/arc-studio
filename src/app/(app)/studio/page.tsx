import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getBrandProfileView } from "@/lib/brand-kit/profile-view";
import { listCampaignNames } from "@/lib/campaigns/read-model";
import { resolveMediaGeneration } from "@/lib/media/enablement";
import { getMediaSpendMeter } from "@/lib/media/spend-meter";
import { getMediaLibraryData } from "@/lib/media-library/read-model";
import type { MediaAssetView } from "@/lib/media-library/types";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { MediaSpendMeterBar } from "./_components/media-spend-meter";
import { StudioView, type Item } from "./_components/studio-view";
import { reportDegraded } from "@/lib/observability/report-degraded";
import "./studio.css";

export const metadata = { title: "Studio — Arc Studio" };

function provFromSource(source: string): Item["p"] {
  switch (source) {
    case "ai_generated": return "ai";
    case "composite": return "comp";
    case "uploaded": return "upload";
    default: return "real";
  }
}

/** media_assets → Studio source Item. Only image/video make usable backgrounds. */
function toStudioItem(v: MediaAssetView): Item {
  return { s: "", l: v.fileName, p: provFromSource(v.source), url: v.url };
}

export default async function StudioPage() {
  // Correctly silent (BSR-546): (app)/layout.tsx is the auth boundary; a null
  // context here renders a coherent empty state, not a false claim about data.
  const ctx = await getCurrentWorkspaceContext().catch(() => null);
  const brandName = ctx?.orgName?.trim() || "Your workspace";

  // Real media_assets → the "Approved media" source, so Studio composes over the
  // workspace's actual backgrounds. Undefined/empty offline → the built-in samples.
  let libraryItems: Item[] | undefined;
  if (ctx?.orgId && isSupabaseAdminConfigured()) {
    // PRIMARY: same claim as /library — empty asserts the workspace owns no
    // approved media, which is the input Studio exists to work from.
    const data = await getMediaLibraryData(getSupabaseAdminClient(), ctx.orgId).catch((error) => {
      reportDegraded(error, { scope: "studio.getMediaLibraryData", surface: "primary" });
      return null;
    });
    if (data && data.status === "live") {
      libraryItems = data.assets
        .filter((a) => (a.kind === "image" || a.kind === "video") && a.url && a.url !== "pending")
        .map(toStudioItem);
    }
  }

  // `live` = a real backend is present, so the Arc composer can start a real
  // conversation. Offline (backend-less preview) it stays inert with a note.
  const live = Boolean(ctx?.orgId) && isSupabaseAdminConfigured();

  // Campaign picker options (a generated draft must attach to a campaign for the
  // approval gate) and the media-generation master flag, threaded into StudioView.
  const campaigns = ctx?.orgId && isSupabaseAdminConfigured() ? await listCampaignNames(ctx.orgId, undefined, ctx.workspaceId).catch(() => []) : [];
  // Per-workspace: the gemini-media connector (legacy env flag still honored).
  const mediaEnabled = (await resolveMediaGeneration(ctx?.workspaceId ?? null)).enabled;

  // The workspace's real brand palette drives Studio's accent swatches — the picker
  // used to show a hardcoded list under a note claiming it came from the Brand kit.
  const brandPalette = ctx?.orgId
    ? await getBrandProfileView(ctx.orgId, brandName)
        // On a failed read the palette is NEUTRAL_DEFAULTS, and Studio presents
        // these swatches as coming from the Brand kit. Showing someone else's
        // colours under that label is the false claim this note already warns
        // about, one layer down (BSR-578). No swatches beats wrong ones.
        .then((v) => (v.failed ? [] : v.palette.map((c) => c.hex).filter((hex) => /^#[0-9a-f]{6}$/i.test(hex))))
        .catch(() => [])
    : [];

  // Spend meter: what generation has cost this period and what the next job
  // costs, shown here rather than only in Settings (BSR-515). Never throws.
  const spendMeter = await getMediaSpendMeter();

  return (
    <>
      <MediaSpendMeterBar meter={spendMeter} />
      <StudioView
      brandName={brandName}
      libraryItems={libraryItems}
      live={live}
      campaigns={campaigns}
      mediaEnabled={mediaEnabled}
      brandPalette={brandPalette}
      />
    </>
  );
}
