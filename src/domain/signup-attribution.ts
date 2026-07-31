/**
 * Signup-source attribution (BSR-586): which channel produced a waitlist signup
 * or a workspace.
 *
 * NOT to be confused with `src/domain/attribution.ts`, which resolves which
 * *campaign* an outbound touchpoint belongs to. This module is the other
 * direction — inbound, pre-account, "where did this person come from."
 *
 * Pure and deterministic: no I/O, no cookies, no `document`. The browser shim
 * and the server reader live in `src/lib/signup-attribution/`.
 *
 * PRIVACY IS PART OF THE CONTRACT HERE, not a later pass:
 *
 *  - The referrer is reduced to its HOST. Full referrer URLs routinely carry
 *    search queries and, from some sites, identifiers — none of which we need to
 *    know which channel worked.
 *  - The landing path keeps `pathname` only. Query strings on our own pages can
 *    contain anything, including values a visitor typed.
 *  - Every field is length-capped, so a hostile or broken URL cannot write an
 *    unbounded blob into the database through a public endpoint.
 *  - Nothing here reads or stores an email, a name, or an IP. The stored record
 *    describes a *channel*, not a person.
 */

/** Max characters kept per field. Long enough for real campaigns, short enough to be safe. */
const MAX_FIELD = 128;

/** UTM keys we recognise, in the order they are conventionally written. */
export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

export type AttributionTouch = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
  /** Referrer HOST only (e.g. "www.google.com"), never the full URL. */
  referrerHost: string | null;
  /** Path only, no query string. */
  landingPath: string | null;
  /** ISO timestamp. Passed in rather than read from a clock so this stays pure. */
  at: string;
};

export type AttributionRecord = {
  firstTouch: AttributionTouch;
  lastTouch: AttributionTouch;
};

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Strip C0/C1 control characters. Written as explicit \u escapes rather
  // than a literal class: literal control bytes render as invisible
  // whitespace in a diff, which makes the line impossible to review.
  const stripped = trimmed.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  if (!stripped) return null;
  return stripped.slice(0, MAX_FIELD);
}

/**
 * Reduce a referrer to its host, dropping the path and query entirely.
 *
 * Returns null for our OWN origin: an internal navigation is not a channel, and
 * recording it would make every multi-page visit look like a self-referral.
 */
export function referrerHostFrom(referrer: unknown, selfHost?: string | null): string | null {
  const raw = clean(referrer);
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(raw).host;
  } catch {
    return null;
  }
  if (!host) return null;
  if (selfHost && host.toLowerCase() === selfHost.toLowerCase()) return null;
  return host.slice(0, MAX_FIELD);
}

/** Keep the pathname, discard the query string — see the privacy note above. */
export function landingPathFrom(pathOrUrl: unknown): string | null {
  const raw = clean(pathOrUrl);
  if (!raw) return null;
  let path = raw;
  try {
    // Absolute URL: take its pathname. Relative: cut at ? or #.
    path = raw.startsWith("http") ? new URL(raw).pathname : raw.split(/[?#]/)[0] ?? raw;
  } catch {
    path = raw.split(/[?#]/)[0] ?? raw;
  }
  if (!path.startsWith("/")) path = `/${path}`;
  return path.slice(0, MAX_FIELD);
}

export type TouchInput = {
  /** Query string, with or without a leading "?". */
  search?: string | null;
  referrer?: string | null;
  path?: string | null;
  /** Our own host, so self-referrals are dropped. */
  selfHost?: string | null;
  /** ISO timestamp — injected, never read from a clock in here. */
  at: string;
};

/** Build one touch from a page view's URL + referrer. */
export function buildTouch({ search, referrer, path, selfHost, at }: TouchInput): AttributionTouch {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search ?? "");
  } catch {
    params = new URLSearchParams();
  }

  return {
    source: clean(params.get("utm_source")),
    medium: clean(params.get("utm_medium")),
    campaign: clean(params.get("utm_campaign")),
    term: clean(params.get("utm_term")),
    content: clean(params.get("utm_content")),
    referrerHost: referrerHostFrom(referrer, selfHost),
    landingPath: landingPathFrom(path),
    at: clean(at) ?? new Date(0).toISOString(),
  };
}

/** True when a touch carries no channel information worth recording. */
export function isEmptyTouch(touch: AttributionTouch): boolean {
  return (
    !touch.source && !touch.medium && !touch.campaign && !touch.term && !touch.content && !touch.referrerHost
  );
}

/**
 * Merge a new touch into an existing record.
 *
 * **First touch is written once and never overwritten.** That is the whole point:
 * the channel that *found* the customer is the one worth crediting, and it is the
 * one a later direct visit would otherwise erase.
 *
 * Last touch updates only when the new touch actually carries channel
 * information — otherwise someone who arrives from G2 and then navigates back
 * later by typing the URL would have their last touch overwritten with nothing.
 */
export function mergeTouch(
  existing: AttributionRecord | null,
  incoming: AttributionTouch,
): AttributionRecord {
  if (!existing) return { firstTouch: incoming, lastTouch: incoming };
  if (isEmptyTouch(incoming)) return existing;

  // Promotion rule. A stored first touch that carries NO channel is a direct
  // landing — it attributes nothing. If a real channel shows up later, it
  // becomes the first touch rather than being filed forever as "direct".
  //
  // Found by running this: someone who lands on the homepage untagged and only
  // afterwards clicks a G2 listing would otherwise credit "direct" permanently,
  // and the listing that actually produced the signup would never be creditable —
  // which defeats the point of the feature.
  //
  // Once first touch names a real channel it is immutable, which is the rule
  // that actually matters.
  const firstTouch = isEmptyTouch(existing.firstTouch) ? incoming : existing.firstTouch;
  return { firstTouch, lastTouch: incoming };
}

function parseTouch(value: unknown): AttributionTouch | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const at = clean(v.at);
  if (!at) return null;
  return {
    source: clean(v.source),
    medium: clean(v.medium),
    campaign: clean(v.campaign),
    term: clean(v.term),
    content: clean(v.content),
    referrerHost: clean(v.referrerHost),
    landingPath: clean(v.landingPath),
    at,
  };
}

/**
 * Parse a stored/transported record. Returns null for anything malformed rather
 * than throwing — this reads from a cookie a visitor can edit, and attribution
 * is never worth failing a signup over.
 */
export function parseAttributionRecord(value: unknown): AttributionRecord | null {
  let raw: unknown = value;
  if (typeof value === "string") {
    if (!value.trim()) return null;
    try {
      raw = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const firstTouch = parseTouch(r.firstTouch);
  const lastTouch = parseTouch(r.lastTouch);
  if (!firstTouch || !lastTouch) return null;
  return { firstTouch, lastTouch };
}

/** Compact JSON for cookie transport. */
export function serializeAttributionRecord(record: AttributionRecord): string {
  return JSON.stringify(record);
}

/**
 * The channel label a report groups by.
 *
 * Precedence is deliberate: an explicit utm_source is the most trustworthy
 * signal because we put it there ourselves (the listing kit's UTM convention
 * depends on this). A referrer host is the next best. Everything else is
 * "direct", which honestly includes untagged links someone pasted.
 */
export function channelLabel(touch: AttributionTouch | null | undefined): string {
  if (!touch) return "direct";
  if (touch.source) {
    return touch.medium ? `${touch.source} / ${touch.medium}` : touch.source;
  }
  if (touch.referrerHost) return touch.referrerHost;
  return "direct";
}

/** Group a set of records by first-touch channel, descending by count. */
export function rollupByChannel(
  records: Array<AttributionRecord | null>,
  which: "firstTouch" | "lastTouch" = "firstTouch",
): Array<{ channel: string; count: number }> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const label = channelLabel(record ? record[which] : null);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([channel, count]) => ({ channel, count }))
    // Count desc, then channel asc so the order is stable for equal counts.
    .sort((a, b) => b.count - a.count || a.channel.localeCompare(b.channel));
}
