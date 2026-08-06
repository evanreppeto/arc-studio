import { toBrandTokens } from "@/domain";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getBusinessProfile } from "@/lib/brand-kit/persistence";
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

/**
 * Studio's server actions call an image model, and a model takes longer than the
 * platform's default function budget allows.
 *
 * Found by clicking "Change this image…" on prod: the edit ran, the model
 * returned a picture, and the upload of it died with
 *
 *   media upload failed: This operation was aborted
 *
 * — the function's deadline landing mid-write, not a storage fault. The error
 * names the last thing it was doing rather than the thing that killed it, which
 * is why this looked like a Supabase problem.
 *
 * It hid until now because nothing on this page had ever called a slow provider
 * from the browser. "Generate creative" is `compose`, which renders locally in
 * milliseconds; video is deliberately start-then-poll precisely so no request has
 * to stay open for it. `edit` is the first, and it inherits the same budget.
 *
 * 60s, matching /brain, which reached this conclusion before Studio did.
 */
export const maxDuration = 60;

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
  return { s: "", l: v.fileName, p: provFromSource(v.source), url: v.url, id: v.id };
}

export default async function StudioPage({
  searchParams,
}: {
  /** `?asset=<media_assets uuid>` — Library's "Edit in Studio" deep link. */
  searchParams: Promise<{ asset?: string }>;
}) {
  const { asset: initialAssetId } = await searchParams;
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
  // Keep the REASON, not just the flag: `resolveMediaGeneration` already writes
  // an operator-actionable sentence naming Settings → Connections, and Studio
  // used to discard it and hand-write "set ARC_MEDIA_ENABLED + GEMINI_API_KEY"
  // instead — two env var names shown to someone who came to make an ad, for a
  // switch that is legacy anyway (BSR-731).
  const mediaAccess = await resolveMediaGeneration(ctx?.workspaceId ?? null);
  const mediaEnabled = mediaAccess.enabled;
  const mediaOffReason = mediaAccess.enabled ? null : mediaAccess.reason;

  // The workspace's real brand palette drives Studio's accent swatches — the picker
  // used to show a hardcoded list under a note claiming it came from the Brand kit.
  const brandPalette = ctx?.orgId
    ? await getBrandProfileView(ctx.orgId, brandName, ctx.workspaceId)
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

  // The canvas paints with the Brand Kit's own colours — the same tokens the
  // exporter resolves — so the preview is not a differently-coloured guess at
  // the artifact (BSR-679). Null when there's no kit or the read failed; the
  // canvas then uses the renderer's neutral defaults rather than inventing one.
  const profile = ctx?.orgId && isSupabaseAdminConfigured() ? await getBusinessProfile(ctx.orgId).catch(() => null) : null;
  const t = toBrandTokens(profile);
  const brandTokens = profile
    ? { primary: t.primary, secondary: t.secondary, accent: t.accent, dark: t.dark, light: t.light, displayName: t.displayName, shortMark: t.shortMark }
    : null;

  return (
    <>
      <MediaSpendMeterBar meter={spendMeter} />
      <StudioView
      brandName={brandName}
      brandTokens={brandTokens}
      libraryItems={libraryItems}
      initialAssetId={initialAssetId ?? null}
      live={live}
      campaigns={campaigns}
      mediaEnabled={mediaEnabled}
      mediaOffReason={mediaOffReason}
      brandPalette={brandPalette}
      />
    </>
  );
}
