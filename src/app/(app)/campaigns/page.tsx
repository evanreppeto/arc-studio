import {
  humanizePersonaLabel as humanizePersona,
  WORK_STATE_LABEL, personaAccent,} from "@/domain";
import { describeContents, nextActionFor, pieceLabel, signalTiming } from "./_components/board-derivations";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";

// The review queue opens from this screen as well as from a campaign, and every
// rule it needs — .rqwrap, and the .cbtn/.pill/.review it reuses — lives here.
// A route-scoped stylesheet stopped being right when the component stopped
// belonging to one route: without this the queue renders as an unstyled block.
import "./campaign.css";
import { getCampaignWorkspaceList, humanizeChannel, type CampaignWorkspaceListItem } from "@/lib/campaigns/read-model";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { personasForIndustry } from "@/lib/personas/industry-templates";
import { getOrgPersonaOptions } from "@/lib/personas/read-model";
import { canonicalIndustryKey } from "@/lib/product-language";

import { CampaignsBoard, type CampaignRow, type CampaignTone } from "./_components/campaigns-board";

export const metadata = { title: "Campaigns — Arc Studio" };

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const min = Math.round((Date.now() - then) / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function toneFor(status: string): CampaignTone {
  const s = (status || "").toLowerCase();
  if (/archiv/.test(s)) return "archived";
  if (/revis|blocked/.test(s)) return "revise";
  if (/review|pending|await|submitted/.test(s)) return "review";
  if (/live|active|send|running/.test(s)) return "live";
  if (/approv|scheduled|ready/.test(s)) return "approved";
  return "draft";
}

// Status labels come from the one vocabulary (BSR-656) — the board used to say
// "In review" while its own tab said "Needs approval" and Home said "Needs you"
// about the same row.
const TONE_LABEL: Record<CampaignTone, string> = {
  live: WORK_STATE_LABEL.sending,
  review: WORK_STATE_LABEL.needs_you,
  revise: WORK_STATE_LABEL.needs_changes,
  approved: WORK_STATE_LABEL.approved,
  draft: WORK_STATE_LABEL.draft,
  archived: WORK_STATE_LABEL.archived,
};

function formatAbs(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function toRow(item: CampaignWorkspaceListItem, nowMs: number): CampaignRow {
  const tone = toneFor(item.status);
  // launchState's counts, NOT item.rollup — the two disagree, and this column
  // has to match the page the row links to. See `DeliverableCounts`.
  const { next, nextTone } = nextActionFor(tone, item.pendingCount, {
    approved: item.approvedCount,
    required: item.requiredCount,
  });
  // Prefer the short persona label for the Audience chip; the fuller
  // audienceSummary sentence is too long for a chip.
  const audience = humanizePersona(item.persona) || item.audienceSummary?.trim() || "";
  return {
    id: item.id,
    name: item.name,
    // `campaignTheme` sits ahead of `whyBuilt` because it is the only one of the
    // three that is REQUIRED at creation, so it is always a real sentence about
    // this campaign. `whyBuilt` degrades to "Arc has not recorded reasoning yet"
    // when `reasoning_payload` is empty — which it is on every live row — so
    // reaching it would just trade one placeholder for another.
    brief: item.objective?.trim() || item.campaignTheme?.trim() || item.whyBuilt?.trim() || "New campaign",
    timing: signalTiming(item.signal, nowMs),
    tone,
    statusLabel: TONE_LABEL[tone],
    next,
    nextTone,
    pendingCount: item.pendingCount,
    audience,
    dot: personaAccent(item.persona || audience),
    channels: item.channels.join(" · "),
    updatedRel: relativeTime(item.updatedAtIso) || item.updatedAt,
    updatedAbs: formatAbs(item.updatedAtIso),
    href: item.href,
    // The read-model has computed these all along; the board simply never
    // asked for them, so a package with three approved images rendered
    // identically to an empty one.
    thumbnailUrl: item.thumbnailUrl,
    mediaCount: item.mediaCount,
    // Composed from the same kinds the opened card lists, so "An email and a
    // text message" can never disagree with the assets shown underneath it.
    contents: describeContents(
      item.contentPieces.map((piece) => humanizeChannel(piece.kind || piece.channel) || ""),
    ),
    // Through the same `toneFor`/`TONE_LABEL` pair the row's own status pill
    // uses, so a piece and its campaign never label the same state differently.
    pieces: item.contentPieces.map((piece) => {
      const pieceTone = toneFor(piece.status);
      const { label, sub } = pieceLabel(
        piece.title,
        item.name,
        humanizeChannel(piece.kind || piece.channel) || "Deliverable",
      );
      return {
        id: piece.id,
        title: label,
        kind: sub,
        statusLabel: TONE_LABEL[pieceTone],
        tone: pieceTone,
        thumbnailUrl: piece.media[0]?.thumbnailUrl ?? piece.media[0]?.url ?? null,
        needsReview: piece.needsReview,
      };
    }),
  };
}

/**
 * One clock for every row, read once — a per-row `Date.now()` would let two
 * signal windows in the same render be measured against different instants.
 *
 * The read lives in here rather than in the component body because the React
 * compiler (correctly) refuses an impure call during render; `relativeTime`
 * above hides the same call the same way.
 */
function buildRows(campaigns: CampaignWorkspaceListItem[]): CampaignRow[] {
  const nowMs = Date.now();
  return campaigns.map((item) => toRow(item, nowMs));
}

export default async function CampaignsPage() {
  const ctx = await getCurrentWorkspaceContext();
  const [list, storedPersonaOptions] = await Promise.all([
    // Keep the reason. This used to be `.catch(() => ({ status: "unavailable" }))`,
    // which discarded the error entirely — and since the read-model already
    // catches internally and returns its own message, the only thing this
    // wrapper ever did was throw information away.
    getCampaignWorkspaceList(undefined, "Arc", ctx.orgId, ctx.workspaceId).catch((error: unknown) => ({
      status: "unavailable" as const,
      message: error instanceof Error ? error.message : "Campaign workspace is unavailable.",
    })),
    // Correctly silent (BSR-546): picker options. An empty dropdown is
    // visible to the operator; the campaign list still renders.
    getOrgPersonaOptions(ctx.orgId).catch(() => []),
  ]);
  const demoPersonaOptions = personasForIndustry(canonicalIndustryKey(process.env.ARC_DEMO_INDUSTRY))
    .map((persona) => ({ key: persona.slug, label: persona.name }));
  const personaOptions = storedPersonaOptions.length > 0
    ? storedPersonaOptions
    : isDemoDataEnabled()
      ? demoPersonaOptions
      : [];
  // Three states, not two. A failed load and an empty workspace used to render
  // identically — the board showed "0 campaigns" whether the query returned
  // nothing or blew up, so a broken campaigns read looked exactly like a new
  // tenant. That is how a real prod failure went unnoticed while the twice-daily
  // guardrail stayed green (BSR-542).
  const loadError = list.status === "unavailable" ? (list.message ?? "Campaign workspace is unavailable.") : null;
  if (loadError) {
    // Reaches Vercel runtime logs and, via the Sentry Next.js integration's
    // console capture, the error tracker. Deliberately noisy: an operator
    // staring at an empty board deserves to find something when they go looking.
    console.error(`[campaigns] read failed for org ${ctx.orgId}: ${loadError}`);
  }
  const rows = list.status === "live" ? buildRows(list.campaigns) : [];

  // The board groups by `needsOperatorAttention` itself; this page only needs
  // the finer count, which the header sentence and the review button share.
  const pendingAssets = rows.reduce((sum, r) => sum + r.pendingCount, 0);


  // Passed as a NUMBER, not read back out of arcNote. Deriving a count from a
  // rendered label is the exact bug BSR-726 was: the footer regexed its own
  // text and disagreed with the tab above it.
  return (
    <CampaignsBoard
      rows={rows}
      undecidedCount={pendingAssets}
      personaOptions={personaOptions}
      loadError={loadError}
    />
  );
}
