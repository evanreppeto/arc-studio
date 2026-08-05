/**
 * Turning a matched message body into something readable in a narrow rail.
 *
 * Thread search only ever matched titles, previews and date labels
 * (`filterThreadGroups`), so "where did Arc give me that segment breakdown"
 * was unanswerable once a workspace had more than a screenful of chats — the
 * answer was always in a message body, and nothing looked there.
 *
 * Pure and deterministic: no I/O, no clock. The query path lives in
 * `@/lib/arc-chat/message-search`.
 */

export type ArcMessageSnippet = {
  /** Text before the match. */
  before: string;
  /** The matched text, in the body's own casing (not the query's). */
  match: string;
  /** Text after the match. */
  after: string;
  /** True when text was dropped from the front, so the UI can prefix an ellipsis. */
  truncatedStart: boolean;
  truncatedEnd: boolean;
};

/** Roughly a rail's worth of context on either side of the hit. */
const LEAD = 32;
const TRAIL = 96;

/**
 * Flatten a markdown body to one line of prose.
 *
 * Shared with the thread rail's summary preview (`summaryPreview` in
 * `@/lib/arc-chat/read-model`), which had this inline. Two copies of "strip
 * markdown for a narrow rail" would drift, and the drift would show up as the
 * search result and the thread preview quoting the same message differently.
 */
export function flattenArcMarkdown(body: string, options: { dropCodeBlocks?: boolean } = {}): string {
  // The preview drops fenced code entirely — a wall of code says nothing about
  // what a thread was for. Search keeps the contents and removes only the
  // fence markers, because code Arc wrote is exactly the kind of thing an
  // operator comes back looking for, and dropping it would make it unfindable.
  const withoutFences = options.dropCodeBlocks
    ? body.replace(/```[\s\S]*?```/g, " ")
    : body.replace(/```[^\n]*\n?/g, " ");
  return withoutFences
    .replace(/[#>*`[\]()]/g, " ")
    // Underscores only where they act as emphasis. Stripping them wholesale
    // turned `lead_score` into `lead score`, so searching for a field name —
    // the most likely thing to come back looking for — silently found nothing.
    .replace(/(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract a window around the first case-insensitive occurrence of `query`.
 *
 * Returns null when the query isn't present — the caller treats that as "no
 * snippet" rather than falling back to the head of the message, because a
 * result that doesn't show why it matched is worse than no result.
 */
export function buildArcMessageSnippet(body: string, query: string): ArcMessageSnippet | null {
  const text = flattenArcMarkdown(body);
  const needle = query.trim();
  if (!text || !needle) return null;

  const at = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (at === -1) return null;

  const start = Math.max(0, at - LEAD);
  const end = Math.min(text.length, at + needle.length + TRAIL);
  return {
    before: text.slice(start, at),
    // Sliced from the body, so the result shows the workspace's own casing
    // rather than echoing back however the operator typed it.
    match: text.slice(at, at + needle.length),
    after: text.slice(at + needle.length, end),
    truncatedStart: start > 0,
    truncatedEnd: end < text.length,
  };
}

/**
 * Is this query worth a round-trip?
 *
 * One character matches most of a workspace and tells the reader nothing, so
 * the search stays idle until there is enough to narrow on.
 */
export const ARC_SEARCH_MIN_LENGTH = 2;

export function isSearchableArcQuery(query: string): boolean {
  return query.trim().length >= ARC_SEARCH_MIN_LENGTH;
}

/**
 * Escape a user's query for a Postgres `ilike` pattern.
 *
 * Without this a message containing `%` — or an operator searching for "50%" —
 * turns into a wildcard that matches everything, and `_` silently matches any
 * single character. Both read as "search is broken" rather than as an injection,
 * which is why it's easy to leave out.
 */
export function escapeLikePattern(query: string): string {
  return query.replace(/[\\%_]/g, (character) => `\\${character}`);
}
