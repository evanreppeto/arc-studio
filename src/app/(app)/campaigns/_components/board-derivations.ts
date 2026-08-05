/**
 * Pure derivations for the campaigns board.
 *
 * Kept out of both page.tsx and the "use client" board so the server page and the
 * client table read the same rules, and so the rules can be unit-tested without a
 * renderer — the same reason `tone.ts` sits beside this file.
 */

import { ASSET_NOUN, countOf } from "@/domain";

import { type CampaignTone } from "./tone";

export type NextAction = { next: string; nextTone: "" | "go" | "warn" };

/**
 * Approved / non-archived deliverable counts, from `buildLaunchState`.
 *
 * Deliberately NOT `CampaignRollup`, which is the other count of the same thing
 * and does not agree with it: the roll-up also counts standalone approvals
 * (no `campaign_asset_id`), so a live campaign with 6 assets and 1 standalone
 * approval rolls up to 7 while its own detail page renders "of 6". Whatever
 * this column says has to match the page the operator lands on when they click
 * the row.
 */
export type DeliverableCounts = { approved: number; required: number };

/**
 * What happens next on this campaign.
 *
 * Two rules, in order:
 *
 *  1. **An instruction to a human always wins.** "Approve 6 assets" is the whole
 *     reason this column exists.
 *  2. **With no instruction, say where the package STANDS — never restate the
 *     status pill sitting beside it.** An archived row used to read `Archived` /
 *     "Put away", which is one fact printed twice and a column's worth of space
 *     spent saying nothing.
 *
 * The counts come from `buildLaunchState`, so a row and the campaign page behind
 * it cannot print different totals — see `DeliverableCounts`.
 */
export function nextActionFor(tone: CampaignTone, pendingCount: number, counts: DeliverableCounts): NextAction {
  // 1 — instructions.
  if (pendingCount > 0) return { next: `Approve ${countOf(pendingCount, ASSET_NOUN)}`, nextTone: "go" };
  if (tone === "review") return { next: "Waiting on your decision", nextTone: "go" };
  if (tone === "approved") return { next: "Waiting to send", nextTone: "go" };
  if (tone === "live") return { next: "Going out now", nextTone: "" };
  if (tone === "revise") return { next: "Arc is reworking it", nextTone: "warn" };

  // 2 — no instruction: report the package's state.
  //
  // Archived is deliberately its own phrasing rather than falling through to the
  // approved/required lines below. "All 6 assets approved" on a put-away
  // campaign reads like live, ready work; "6 assets kept" says what it holds.
  if (tone === "archived") {
    return { next: counts.required > 0 ? `${countOf(counts.required, ASSET_NOUN)} kept` : "Nothing in it", nextTone: "" };
  }
  if (counts.required === 0) return { next: "Arc is still building it", nextTone: "" };
  if (counts.approved === counts.required) return { next: `All ${countOf(counts.required, ASSET_NOUN)} approved`, nextTone: "" };
  if (counts.approved > 0) return { next: `${counts.approved} of ${counts.required} approved`, nextTone: "" };
  return { next: "Arc is still building it", nextTone: "" };
}

/**
 * The one audience every row on the board shares, when there is one.
 *
 * A column whose every cell holds the same value carries no information and still
 * costs ~210px — on a single-persona workspace the Audience column was pure
 * overhead while the campaign name beside it was being ellipsed mid-word. When
 * this returns a label the board drops the column and says the fact once, in the
 * subhead.
 *
 * Computed over ALL rows, never the filtered ones: deriving it from the visible
 * set would make a column appear and disappear as the operator types in the
 * filter box.
 */
export function constantAudience(rows: { audience: string }[]): string | null {
  if (rows.length < 2) return null;
  const first = rows[0].audience.trim();
  if (!first) return null;
  return rows.every((row) => row.audience.trim() === first) ? first : null;
}

/** The timing facts Arc recorded on the signal that produced a campaign. */
export type CampaignSignal = {
  urgency: string | null;
  eventType: string | null;
  startsAtIso: string | null;
  endsAtIso: string | null;
};

export type SignalTiming = { label: string; tone: "warn" | "muted" };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * How much life is left in the signal a campaign was built from.
 *
 * A flood-response package built off a weather advisory is worth less every hour
 * and worthless once the advisory expires, but the board sorted and rendered it
 * identically to an evergreen one — the only time on the row was `updatedAt`,
 * which measures OUR activity, not the opportunity's. Returns null when the
 * signal carries no timing, which is most campaigns; an operator-created package
 * has no window to close.
 */
export function signalTiming(signal: CampaignSignal | null, nowMs: number): SignalTiming | null {
  if (!signal) return null;

  const endsAt = signal.endsAtIso ? Date.parse(signal.endsAtIso) : NaN;
  if (Number.isFinite(endsAt)) {
    const remaining = endsAt - nowMs;
    if (remaining <= 0) return { label: `Window closed ${humanizeSpan(-remaining)} ago`, tone: "muted" };
    // Inside a day is the point at which the window is the reason to act now,
    // rather than a fact about the campaign.
    return { label: `Window closes in ${humanizeSpan(remaining)}`, tone: remaining <= DAY ? "warn" : "muted" };
  }

  // No window, but Arc still graded the signal. Only "high" earns row space:
  // "medium urgency" on every row is the Audience column's problem again.
  if ((signal.urgency ?? "").toLowerCase() === "high") return { label: "High urgency", tone: "warn" };
  return null;
}

function humanizeSpan(ms: number): string {
  const hours = Math.round(ms / HOUR);
  if (hours < 1) return "under an hour";
  if (hours < 24) return `${hours}h`;
  return `${Math.round(ms / DAY)}d`;
}
