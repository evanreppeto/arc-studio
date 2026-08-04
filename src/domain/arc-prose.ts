import { humanizePersonaLabel } from "./personas";
import { UUID_PATTERN, UUID_SOURCE } from "./identifier-leak";

/**
 * Arc writes the opportunity inbox's prose, and it had been writing it for an
 * engineer. Verbatim from the live inbox on 2026-08-04:
 *
 *   "…"Suburban Home Background Asset" (campaign 0bd41cb3-ff30-4548-92e6-4ba431b61c8d)
 *    … both tagged persona emergency-homeowner (confirmed via query_brain campaign_ref
 *    nodes) … mediaAvailable is 0…"
 *
 * The durable fix is the runner's tool contract, which tells Arc who reads each
 * field (apps/arc-runner/src/tools/opportunities.ts, and src/critic.ts for the
 * claims review). This module is the other half: every row already written was
 * written under the old contract, and no prompt change reaches a persisted row.
 *
 * Lives in the domain because two surfaces need it — the opportunity inbox and
 * the campaign claims review — and `src/lib` must not import from `src/app`.
 *
 * It only ever REMOVES machine tokens — it never paraphrases and never touches a
 * claim. A sanitizer that rewrote what Arc asserted would be a worse lie than
 * the jargon it cleaned up.
 */

/**
 * Leading verbs of Arc's own tool names (`read_recent_activity`, `query_brain`,
 * `search_companies`, `list_opportunities`, …).
 *
 * A verb list rather than a copy of the runner's 51 tool names: the names are
 * defined in a standalone package the app cannot import, so a literal mirror is
 * a list to keep in sync forever, and it would go stale the first time a tool is
 * added. Every tool the runner exposes today is `<verb>_<noun>`, so matching the
 * shape covers the ones that don't exist yet.
 */
const TOOL_VERBS = new Set([
  "analyze", "ask", "attach", "cite", "compose", "create", "emit", "file",
  "generate", "get", "link", "list", "log", "propose", "query", "read",
  "recommend", "record", "research", "search", "submit", "suggest", "update",
]);

/** For `test` — a `g` regex would advance `lastIndex` and answer differently each call. */
const IS_UUID = UUID_PATTERN;

/** `persona_property_manager`, and the internal `unassigned_persona` sentinel. */
const PERSONA_TOKEN = /\bpersona_[a-z0-9_]+|\bunassigned_persona\b/gi;

/** A bare `snake_case` identifier, the shape both tool names and columns take. */
const SNAKE_TOKEN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

/**
 * A short hex id — the first eight characters of a UUID, which is how Arc cites
 * a record in prose: "per learning 8abff0f5".
 *
 * STRICT requires a letter AND a digit. Length alone is not enough: an eight-
 * digit run is a phone number, an order number, or an amount, and this module
 * only ever DELETES what it matches. Eating a real figure out of a claims review
 * is a far worse bug than leaving an id on the screen, so the rule that fires on
 * its own has to be the cautious one.
 */
const STRICT_ID = String.raw`\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{8,}\b`;
/**
 * LOOSE drops the letter requirement, and is only ever used for the SECOND and
 * later items of a run. Once "bc760fde," has established that a list of ids is
 * being read out, "06459096" beside it is one too — all-digit ids exist, and
 * context is what makes them safe to remove.
 */
const LOOSE_ID = String.raw`\b[0-9a-f]{8,}\b`;
/** Same shape, non-global — see `UUID_SOURCE` for why these are separate. */
const IS_SHORT_HEX_ID = new RegExp(`^[0-9a-f]{8,}$`, "i");

/**
 * A RUN of ids, removed as one unit: "asset IDs bc760fde, 06459096, and 90cb3cf2".
 *
 * Taking them out one at a time leaves the punctuation that separated them —
 * "asset IDs, and don't appear anywhere" — which parses worse than the sentence
 * did with the ids still in it. A sanitiser that makes text harder to read has
 * done the opposite of its job, so the separators go with the items.
 */
const ID_RUN = new RegExp(
  `(?:${UUID_SOURCE}|${STRICT_ID})` +
    `(?:\\s*(?:,|,?\\s*(?:and|or))\\s*(?:${UUID_SOURCE}|${LOOSE_ID}))*`,
  "gi",
);

/** True when the token names one of Arc's tools (`mcp__arc__x` or `verb_noun`). */
export function isToolToken(token: string): boolean {
  const t = token.trim().toLowerCase();
  if (!t) return false;
  if (t.startsWith("mcp__")) return true;
  const verb = t.split("_")[0];
  return t.includes("_") && TOOL_VERBS.has(verb);
}

/**
 * Verbs that can only be Arc reading something — used to judge evidence KEYS,
 * where a false positive costs a row of real reasoning.
 *
 * Deliberately narrower than `TOOL_VERBS`: `read_performance_persona_slices` is
 * Arc describing its own lookup and belongs nowhere near an operator, while
 * `record_count` or `create_date` are ordinary business keys that happen to
 * start with a verb Arc also uses. Judging keys on the full verb list would take
 * those with it.
 */
const LOOKUP_VERBS = new Set(["read", "list", "search", "query", "get"]);

/** True when an evidence key describes Arc's own lookup rather than the business. */
export function isProcessKey(key: string): boolean {
  const t = key.trim().toLowerCase();
  if (t.startsWith("mcp__")) return true;
  return t.includes("_") && LOOKUP_VERBS.has(t.split("_")[0]);
}

/**
 * True when a string carries no information an operator can act on: an opaque
 * id, a tool call, or a list of either. This is the test that decides whether a
 * piece of Arc's output is evidence or plumbing.
 */
export function isMachineText(value: string): boolean {
  const t = value.trim();
  if (!t) return false;
  if (/\bmcp__/i.test(t)) return true;
  // Strip call syntax and separators, then ask what is left standing.
  const parts = t
    .replace(/\([^()]*\)/g, " ")
    .split(/[\s,+/|]+/)
    .map((p) => p.replace(/[.:;]+$/, ""))
    .filter(Boolean);
  if (!parts.length) return true;
  return parts.every((p) => isToolToken(p) || IS_UUID.test(p) || IS_SHORT_HEX_ID.test(p));
}

/** True when a parenthetical is an aside for us, not for the reader. */
function isMachineAside(inner: string): boolean {
  // A parenthetical that is nothing but ids or tool calls — `(8abff0f5)`. This
  // check was missing, and it is the shape the claims reviewer writes most: the
  // aside survived every other rule because a short hex id is neither a UUID nor
  // snake_case.
  if (isMachineText(inner)) return true;
  if (IS_UUID.test(inner)) return true;
  if (/\bmcp__/i.test(inner)) return true;
  // `dimension=persona`, `total=10, full roster read` — a settings dump.
  if (/\b[a-z_]+=[^\s)]+/i.test(inner)) return true;
  const tokens = inner.match(SNAKE_TOKEN) ?? [];
  return tokens.some((token) => isToolToken(token));
}

/** Tidy the punctuation left behind once a token is lifted out of a sentence. */
function tidy(text: string): string {
  return text
    .replace(/\s*\(\s*\)/g, "")
    .replace(/""/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/([([])\s+/g, "$1")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s+—\s*$/g, "")
    .replace(/[ \t]*([.,;])\1+/g, "$1")
    .trim();
}

/**
 * Clean one passage of Arc's prose for an operator's eyes.
 *
 * Removes machine asides, bare ids, and Arc's own tool names; spells persona
 * keys the way the rest of the app spells them. Everything else — every claim,
 * number, name, and caveat — survives untouched.
 */
export function humanizeArcProse(text: string | null | undefined): string {
  if (!text) return "";
  let out = text;

  // Asides first: `(campaign 0bd41cb3-…)`, `(confirmed via query_brain campaign_ref nodes)`.
  out = out.replace(/\s*\(([^()]*)\)/g, (whole, inner: string) => (isMachineAside(inner) ? "" : whole));

  // Then the ids and tool names that were written into the sentence itself.
  out = out.replace(ID_RUN, "");
  // `unassigned_persona` is the internal sentinel for "no persona set", not a
  // persona named "unassigned persona" — say the thing it means.
  out = out.replace(PERSONA_TOKEN, (token) =>
    /^unassigned_persona$/i.test(token) ? "unassigned" : humanizePersonaLabel(token).toLowerCase() || "unassigned",
  );
  // A tool name carries nothing for the reader, so it goes. Every other
  // snake_case token is a node kind or a column — `proof_point`, `social_ad`,
  // `sla_minutes` — and those carry real meaning, so they are RESPELLED rather
  // than removed. Deleting them would turn "no proof_point nodes exist" into "no
  // nodes exist", which is a worse sentence than the one with the underscore in
  // it. This transform can only ever lose an underscore.
  out = out.replace(SNAKE_TOKEN, (token) => (isToolToken(token) ? "" : token.replace(/_/g, " ")));

  return tidy(out);
}
