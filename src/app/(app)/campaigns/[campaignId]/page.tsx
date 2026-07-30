import Link from "next/link";
import { notFound } from "next/navigation";

import { getCampaignAudiencePreview } from "@/lib/audience/campaign-audience";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { listAttachableMedia, type AttachableMediaItem } from "@/lib/campaigns/attach-media";
import { getCampaignWorkspaceDetail } from "@/lib/campaigns/read-model";
import { getCampaignPerformancePanel } from "@/lib/performance/campaign-panel";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { CampaignDetailView } from "./_components/campaign-detail-view";
import { reportDegraded } from "@/lib/observability/report-degraded";
import "./campaign.css";

export const metadata = { title: "Campaign — Arc Studio" };

// Offline preview only: a small set of "approved Library media" so the attach
// picker has something to show without a backend. Live mode reads the real library.
const DEMO_ATTACHABLE_MEDIA: AttachableMediaItem[] = [
  { id: "demo-lib-1", fileName: "storm-job-after.jpg", url: "/brand/login-background-v2.png", kind: "image", dimensions: "1600 × 1067" },
  { id: "demo-lib-2", fileName: "crew-on-site.jpg", url: "/brand/login-background-v2.png", kind: "image", dimensions: "1600 × 1067" },
  { id: "demo-lib-3", fileName: "before-after-roof.jpg", url: "/brand/login-background-v2.png", kind: "image", dimensions: "1200 × 800" },
  { id: "demo-lib-4", fileName: "bsr-logo-mark.png", url: "/brand/login-background-v2.png", kind: "logo", dimensions: "512 × 512" },
];

export default async function CampaignDetailPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const orgId = (await getCurrentWorkspaceContext()).orgId;
  const detail = await getCampaignWorkspaceDetail(decodeURIComponent(campaignId), undefined, "Arc", orgId);

  if (detail.status === "not_found") notFound();
  if (detail.status !== "live") {
    return (
      <div className="arc-campaign">
        <div className="cband">
          <Link className="back" href="/campaigns">
            <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: '<path d="M15 5l-7 7 7 7"/>' }} />
            Back to Campaigns
          </Link>
          <p style={{ padding: "24px 4px", color: "var(--muted)" }}>{detail.message}</p>
        </div>
      </div>
    );
  }

  const performance = await getCampaignPerformancePanel(decodeURIComponent(campaignId));
  // Read-only preview of who this campaign would email — no dispatch rows, no send.
  const audience =
    orgId && isSupabaseAdminConfigured()
      ? await getCampaignAudiencePreview({ campaignId: decodeURIComponent(campaignId), orgId }).catch((error) => {
          // PRIMARY: this is the "who would this email" panel an operator reads
          // BEFORE approving a send. Failing to null renders as "no recipients",
          // which is a different decision than "we couldn't check" — and the
          // decision it invites is to go looking for a problem that isn't there,
          // or worse, to approve believing the audience is empty.
          reportDegraded(error, {
            scope: "campaigns.getCampaignAudiencePreview",
            surface: "primary",
            detail: { campaignId: decodeURIComponent(campaignId) },
          });
          return null;
        })
      : null;

  // Approved Library media the operator can attach to a deliverable. Live reads the
  // real workspace library; the offline preview shows a demo set.
  const attachableMedia =
    orgId && isSupabaseAdminConfigured()
      // Correctly silent (BSR-546): an empty attach-media picker is visible, and
      // the deliverable still renders and can be approved without media.
      ? await listAttachableMedia(orgId).catch(() => [])
      : DEMO_ATTACHABLE_MEDIA;

  return (
    <CampaignDetailView detail={detail} performance={performance} audience={audience} attachableMedia={attachableMedia} />
  );
}
