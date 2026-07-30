import { humanizePersonaLabel as humanizePersona } from "@/domain";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getCampaignWorkspaceList, type CampaignWorkspaceListItem } from "@/lib/campaigns/read-model";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { personasForIndustry } from "@/lib/personas/industry-templates";
import { getOrgPersonaOptions } from "@/lib/personas/read-model";
import { canonicalIndustryKey } from "@/lib/product-language";

import { CampaignsBoard, type CampaignRow, type CampaignTone } from "./_components/campaigns-board";
import { needsOperatorApproval } from "./_components/tone";

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

const TONE_LABEL: Record<CampaignTone, string> = {
  live: "Live",
  review: "In review",
  revise: "Needs revision",
  approved: "Approved",
  draft: "Draft",
  archived: "Archived",
};

function nextActionFor(tone: CampaignTone, pendingCount: number): { next: string; nextTone: "" | "go" | "warn" } {
  if (pendingCount > 0) {
    return { next: `Approve ${pendingCount} piece${pendingCount === 1 ? "" : "s"}`, nextTone: "go" };
  }
  switch (tone) {
    case "live":
      return { next: "Sending", nextTone: "" };
    case "approved":
      return { next: "Scheduled to send", nextTone: "go" };
    case "review":
      return { next: "In review", nextTone: "go" };
    case "revise":
      return { next: "Revision requested", nextTone: "warn" };
    case "archived":
      return { next: "Paused", nextTone: "" };
    default:
      return { next: "Draft in progress", nextTone: "" };
  }
}

function personaDot(persona: string): string {
  const p = (persona || "").toLowerCase();
  if (/storm|hail|weather|damage/.test(p)) return "#7fb89a";
  if (/property|manager|realtor|hoa|commercial/.test(p)) return "#c8a24a";
  if (/insurance|adjuster/.test(p)) return "#88b6d8";
  if (/past|repeat|existing|customer|reactivation/.test(p)) return "#9678c8";
  return "#c8a24a";
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
    brief: item.objective?.trim() || item.whyBuilt?.trim() || "Campaign package",
    tone,
    statusLabel: TONE_LABEL[tone],
    next,
    nextTone,
    pendingCount: item.pendingCount,
    audience,
    dot: personaDot(item.persona || audience),
    channels: item.channels.join(" · "),
    updatedRel: relativeTime(item.updatedAtIso) || item.updatedAt,
    updatedAbs: formatAbs(item.updatedAtIso),
    href: item.href,
  };
}

export default async function CampaignsPage() {
  const ctx = await getCurrentWorkspaceContext();
  const [list, storedPersonaOptions] = await Promise.all([
    // Keep the reason. This used to be `.catch(() => ({ status: "unavailable" }))`,
    // which discarded the error entirely — and since the read-model already
    // catches internally and returns its own message, the only thing this
    // wrapper ever did was throw information away.
    getCampaignWorkspaceList(undefined, "Arc", ctx.orgId).catch((error: unknown) => ({
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
  // identically — the board showed "0 packages" whether the query returned
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

  // Two different facts, said as two different things. They used to be one claim
  // with two answers — a tab reading 4 above a footer reading 9 — because the
  // footer regexed the rendered next-action label to find packages with an
  // undecided piece. Both numbers were real; only the wording pretended they were
  // the same number.
  //
  // - submitted: packages whose STATUS is on your desk. Matches the tab exactly
  //   (same predicate), because the tab is what it summarises.
  // - pieces: deliverables with no decision recorded. This is the count the tab
  //   cannot show: a package can be Approved and still hold an undecided piece,
  //   so it sits under "Approved" while its row reads "Approve 1 piece".
  //
  // "Undecided" rather than "awaiting you" on purpose: a revision-requested piece
  // has no decision but is waiting on ARC to re-draft, not on you.
  const submitted = rows.filter((r) => needsOperatorApproval(r.tone)).length;
  const pendingPieces = rows.reduce((sum, r) => sum + r.pendingCount, 0);
  const packagesWithPieces = rows.filter((r) => r.pendingCount > 0).length;

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const parts = [
    pendingPieces > 0
      ? `${plural(pendingPieces, "piece")} across ${plural(packagesWithPieces, "package")} undecided`
      : null,
    submitted > 0 ? `${plural(submitted, "package")} submitted for approval` : null,
  ].filter(Boolean);
  const arcNote = parts.length > 0 ? parts.join(" · ") : "Arc drafts approval-gated packages here as opportunities come in";

  return <CampaignsBoard rows={rows} arcNote={arcNote} personaOptions={personaOptions} loadError={loadError} />;
}
