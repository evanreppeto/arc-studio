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
export type DeliverableCounts = {
  approved: number;
  required: number;
  /**
   * How many deliverables the row actually SHOWS, i.e. `contentPieces.length`.
   *
   * Distinct from `required`, which counts non-archived gating work and is 0 for
   * an archived campaign by definition. Reporting `required` on an archived row
   * printed "Nothing in it" directly above a disclosure reading "Show 5 assets"
   * — the row contradicting itself in adjacent controls. Optional so existing
   * callers keep their behaviour; falls back to `required`.
   */
  held?: number;
};

/**
 * What happens next on this campaign.
 *
 * Two rules, in order:
 *
 *  1. **An instruction to a human always wins.** "Review 6 assets" is the whole
 *     reason this column exists.
 *
 *     The verb is `Review`, not `Approve`, because review is what the button
 *     does: it opens the one-at-a-time queue (`ReviewQueue`) with this
 *     campaign's undecided deliverables. It has never approved anything in
 *     bulk. Labelling it "Approve 6 assets" advertised a blind bulk-approve of
 *     six pieces of customer-facing copy — the one action this product exists
 *     to prevent — and undersold the queue, which is the good path.
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
  if (pendingCount > 0) return { next: `Review ${countOf(pendingCount, ASSET_NOUN)}`, nextTone: "go" };
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
    const held = counts.held ?? counts.required;
    return { next: held > 0 ? `${countOf(held, ASSET_NOUN)} kept` : "Nothing in it", nextTone: "" };
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

/**
 * What to call a deliverable inside its own campaign's opened row.
 *
 * Arc names pieces after the package they belong to — "High-intent follow-up —
 * Email", "High-intent follow-up — Social Post" — which is right in a list that
 * spans campaigns and wrong underneath the campaign's own name, where every card
 * opens with the same words and then ellipses away the one part that tells them
 * apart. The parent's name is already on the row above; strip it.
 *
 * When nothing distinguishing survives (the title WAS just the parent plus the
 * channel), the kind becomes the label and the second line goes — a card reading
 * "Email" over "Email" is the redundancy this function exists to remove.
 */
export function pieceLabel(
  title: string,
  campaignName: string,
  kind: string,
): { label: string; sub: string } {
  const parent = campaignName.trim().toLowerCase();
  let rest = title.trim();
  if (parent && rest.toLowerCase().startsWith(parent)) {
    rest = rest.slice(parent.length).replace(/^\s*[—–\-:·|]\s*/, "").trim();
  }
  if (!rest || rest.toLowerCase() === kind.trim().toLowerCase()) return { label: kind || title.trim(), sub: "" };
  return { label: rest, sub: kind };
}

/**
 * Plain nouns for the things Arc makes. "SMS" is our word; "a text message" is
 * the one an owner-operator already uses.
 */
const PLAIN_KIND: Record<string, string> = {
  sms: "a text message",
  email: "an email",
  "social post": "a social post",
  "social ad": "an ad",
  paid: "an ad",
  landing: "a landing page",
  "one-pager": "a one-pager",
};

/**
 * "a" or "an", by SOUND rather than by first letter.
 *
 * The letter test put "an one pager" on the live campaigns board — `one_pager`
 * is not in `PLAIN_KIND` (that map is keyed "one-pager", with a hyphen), so it
 * fell through to the fallback, and `o` is a vowel letter. It is not a vowel
 * sound: "one" starts /w/.
 *
 * Two exception classes, both of which a first-letter test gets backwards:
 *
 *  - **Vowel letter, consonant sound** → "a". `u` pronounced /juː/ (a user
 *    guide, a unit), and `one`/`once` (a one-pager), and `eu` (a European).
 *  - **Consonant letter, vowel sound** → "an". Silent `h` (an hour-long ad,
 *    an honest review).
 *
 * Deliberately explicit prefixes rather than a pronunciation heuristic. A
 * cleverer rule ("u" + consonant + vowel → /juː/) reads as more general and
 * quietly answers "a unable"; this list only claims the words it names, and
 * anything outside it falls through to the ordinary letter rule.
 */
const SOUNDS_CONSONANT = /^(?:one|once|uni|user|use|usual|utility|eu)/;
const SOUNDS_VOWEL = /^(?:hour|honest|hono|heir)/;

export function indefiniteArticle(word: string): "a" | "an" {
  const key = word.trim().toLowerCase();
  if (!key) return "a";
  if (SOUNDS_VOWEL.test(key)) return "an";
  if (SOUNDS_CONSONANT.test(key)) return "a";
  return /^[aeiou]/.test(key) ? "an" : "a";
}

function plainKind(kind: string): string {
  const key = kind.trim().toLowerCase();
  if (PLAIN_KIND[key]) return PLAIN_KIND[key];
  if (!key) return "a draft";
  return `${indefiniteArticle(key)} ${key}`;
}

/**
 * What is actually in this campaign, in words an owner reads once.
 *
 * The card used to lead with Arc's objective — "Turn recent high-intent interest
 * into qualified conversations with a clear, low-friction next step" — which is
 * consultant prose about a goal, and never says what the thing IS. This does:
 * "An email, a social post and a text message." Same failure as
 * arc-writes-for-engineers-not-owners, on the surface the owner sees first.
 *
 * Repeats collapse ("2 emails and a text message") because three cards reading
 * "an email, an email, an email" is a list, not a description.
 */
export function describeContents(kinds: string[]): string {
  if (kinds.length === 0) return "";

  const counts = new Map<string, number>();
  for (const kind of kinds) {
    const plain = plainKind(kind);
    counts.set(plain, (counts.get(plain) ?? 0) + 1);
  }

  const parts = [...counts.entries()].map(([plain, n]) => (n === 1 ? plain : pluralize(plain, n)));
  const sentence =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** "an email" + 2 → "2 emails". The article goes; the noun takes an s. */
function pluralize(plain: string, n: number): string {
  const noun = plain.replace(/^(a|an) /, "");
  return `${n} ${noun.endsWith("s") ? noun : `${noun}s`}`;
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
