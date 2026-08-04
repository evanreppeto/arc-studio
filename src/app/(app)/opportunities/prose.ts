import { humanizePersonaLabel, UUID_PATTERN, UUID_SOURCE } from "@/domain";

/**
 * Arc writes the opportunity inbox's prose, and it had been writing it for an
 * engineer. Verbatim from the live inbox on 2026-08-04:
 *
 *   "…"Suburban Home Background Asset" (campaign 0bd41cb3-ff30-4548-92e6-4ba431b61c8d)
 *    … both tagged persona emergency-homeowner (confirmed via query_brain campaign_ref
 *    nodes) … mediaAvailable is 0…"
 *
 * The durable fix is the runner's tool contract, which now tells Arc who reads
 * these cards (apps/arc-runner/src/tools/opportunities.ts). This module is the
 * other half: every card already in the inbox was written under the old
 * contract, and no prompt change reaches a row that is already persisted.
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

/**
 * For `replace` — global, and therefore stateful; never call `.test` on it.
 * Compiled here rather than imported because a shared `g` regex carries
 * `lastIndex` between callers. The SHAPE is shared (`UUID_SOURCE`); the
 * compiled global is not.
 */
const UUID = new RegExp(UUID_SOURCE, "gi");
/** For `test` — a `g` regex would advance `lastIndex` and answer differently each call. */
const IS_UUID = UUID_PATTERN;

/** `persona_property_manager`, and the internal `unassigned_persona` sentinel. */
const PERSONA_TOKEN = /\bpersona_[a-z0-9_]+|\bunassigned_persona\b/gi;

/** A bare `snake_case` identifier, the shape both tool names and columns take. */
const SNAKE_TOKEN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

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
  return parts.every((p) => isToolToken(p) || IS_UUID.test(p) || /^[0-9a-f]{8,}$/i.test(p));
}

/** True when a parenthetical is an aside for us, not for the reader. */
function isMachineAside(inner: string): boolean {
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
  out = out.replace(UUID, "");
  // `unassigned_persona` is the internal sentinel for "no persona set", not a
  // persona named "unassigned persona" — say the thing it means.
  out = out.replace(PERSONA_TOKEN, (token) =>
    /^unassigned_persona$/i.test(token) ? "unassigned" : humanizePersonaLabel(token).toLowerCase() || "unassigned",
  );
  out = out.replace(SNAKE_TOKEN, (token) => (isToolToken(token) ? "" : token));

  return tidy(out);
}

/** Longest a list row's lead may run before it stops being scannable. */
const MAX_NAME_CHARS = 46;
/** Longest the qualifier beneath it may run. */
const MAX_QUALIFIER_CHARS = 42;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 2).trim()}…` : text;
}

/** The lead of a title — everything before its first em/en dash. */
export function rowName(title: string): string {
  const first = title.split(/\s+[—–]\s+/)[0].trim() || title.trim();
  return clip(first, MAX_NAME_CHARS);
}

/**
 * The part of the title `rowName` cuts — "Cook, IL / DuPage, IL +1 more" out of
 * "Flood Advisory — Cook, IL / DuPage, IL +1 more".
 *
 * Without it, two live flood advisories over different counties render as two
 * rows both reading "Flood Advisory", with nothing to tell them apart: the tail
 * after the dash is precisely the distinguishing part, and it was the part being
 * dropped.
 */
export function rowQualifier(title: string): string | null {
  const rest = title.split(/\s+[—–]\s+/).slice(1).join(" — ").trim();
  return rest ? clip(rest, MAX_QUALIFIER_CHARS) : null;
}
