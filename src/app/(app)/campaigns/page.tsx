import {
  humanizePersonaLabel as humanizePersona,
  ASSET_NOUN,
  CAMPAIGN_NOUN,
  countOf,
  WORK_STATE_LABEL, personaAccent,} from "@/domain";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getCampaignWorkspaceList, type CampaignWorkspaceListItem } from "@/lib/campaigns/read-model";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { personasForIndustry } from "@/lib/personas/industry-templates";
import { getOrgPersonaOptions } from "@/lib/personas/read-model";
import { canonicalIndustryKey } from "@/lib/product-language";

import { CampaignsBoard, type CampaignRow, type CampaignTone } from "./_components/campaigns-board";
import { needsOperatorAttention } from "./_components/tone";

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

/** The next-action column answers "what happens next", so it never just repeats
 *  the status pill sitting beside it. */
function nextActionFor(tone: CampaignTone, pendingCount: number): { next: string; nextTone: "" | "go" | "warn" } {
  if (pendingCount > 0) {
    return { next: `Approve ${countOf(pendingCount, ASSET_NOUN)}`, nextTone: "go" };
  }
  switch (tone) {
    case "live":
      return { next: "Going out now", nextTone: "" };
    case "approved":
      return { next: "Waiting to send", nextTone: "go" };
    case "review":
      return { next: "Waiting on your decision", nextTone: "go" };
    case "revise":
      return { next: "Arc is reworking it", nextTone: "warn" };
    case "archived":
      return { next: "Put away", nextTone: "" };
    default:
      return { next: "Arc is still building it", nextTone: "" };
  }
}


function formatAbs(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function toRow(item: CampaignWorkspaceListItem): CampaignRow {
  const tone = toneFor(item.status);
  const { next, nextTone } = nextActionFor(tone, item.pendingCount);
  // Prefer the short persona label for the Audience chip; the fuller
  // audienceSummary sentence is too long for a chip.
  const audience = humanizePersona(item.persona) || item.audienceSummary?.trim() || "";
  return {
    id: item.id,
    name: item.name,
    brief: item.objective?.trim() || item.whyBuilt?.trim() || "New campaign",
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
  };
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
  const rows = list.status === "live" ? list.campaigns.map(toRow) : [];

  // Two different facts, said as two different things — never one claim with two
  // answers. The original bug was a tab reading 4 above a footer reading 9,
  // because the footer regexed the rendered next-action label; the second was a
  // tab reading 0 above a footer reading "7 assets across 3 campaigns", because
  // the tab counted status and the footer counted assets.
  //
  // - needsYou: campaigns on your desk, by the SAME predicate the tab uses. This
  //   number and the "Needs you" badge are the same claim, so they are the same
  //   call.
  // - assets: individual deliverables with no decision recorded — the finer
  //   count, and the one the row-level "Approve N assets" labels add up to.
  //
  // "Undecided" rather than "needs you" on the asset half, on purpose: an asset
  // sent back for changes has no decision but is waiting on ARC to re-draft.
  const needsYou = rows.filter(needsOperatorAttention).length;
  const pendingAssets = rows.reduce((sum, r) => sum + r.pendingCount, 0);

  const parts = [
    needsYou > 0 ? `${countOf(needsYou, CAMPAIGN_NOUN)} need you` : null,
    pendingAssets > 0 ? `${countOf(pendingAssets, ASSET_NOUN)} undecided` : null,
  ].filter(Boolean);
  const arcNote =
    parts.length > 0
      ? parts.join(" · ")
      : "Arc drafts campaigns here as opportunities come in — nothing sends until you approve it";

  return <CampaignsBoard rows={rows} arcNote={arcNote} personaOptions={personaOptions} loadError={loadError} />;
}
