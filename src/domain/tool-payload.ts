/**
 * What a tool call's input/output should look like on screen (BSR-724).
 *
 * The runner stores each call's `input` and `output` as pre-rendered strings and
 * three surfaces printed them verbatim: the inline run trace, the workspace
 * activity rows, and the run detail page. A customer's chat therefore showed
 * lines like `{"limit":0} · {"contacts":[],"total":243,"returned":25}`, and a
 * census of prod found two of them carrying a phone number, because a tool that
 * reads contacts returns contact rows.
 *
 * Two jobs here, both pure:
 *
 *   - `redactToolPayload` removes contact details wherever a payload is shown,
 *     including the inspector. Evidence does not require someone's phone number.
 *   - `summarizeToolPayload` turns the payload into one line. The raw text stays
 *     available behind a disclosure; it is the *default* that changes.
 *
 * ## The constraint that shapes all of this
 *
 * The runner caps these strings at 400 characters, and on prod most of them sit
 * exactly at the cap — meaning they are cut mid-token and **do not parse**. So:
 *
 *   - Never count array elements from a payload that failed to parse. A response
 *     holding 243 contacts truncates to two, and "2 contacts" is a confident lie.
 *     Counts come from the payload's own `total`/`count`/`returned` fields, which
 *     appear early enough to survive, or from an array that parsed cleanly.
 *   - Never assume JSON. Some outputs are plain error text
 *     ("Searching CRM contacts failed: … -> 502"), which is the most useful thing
 *     on the row and must survive intact.
 */

/**
 * Contact details, removed before a payload is rendered anywhere.
 *
 * Each pattern is fenced with `(?<![\w-])` / `(?![\w-])` so it cannot fire inside
 * an identifier. Prod payloads are full of UUIDs (`02a05c97-5f0d-4ab7-8440-…`)
 * and ISO dates, and an unfenced phone pattern happily eats digit runs out of
 * both — redacting an id would be its own kind of lying about the evidence.
 */
const SENSITIVE: { pattern: RegExp; replacement: string }[] = [
  { pattern: /(?<![\w-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![\w-])/g, replacement: "[email]" },
  { pattern: /(?<![\w-])\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?![\w-])/g, replacement: "[phone]" },
  {
    pattern: /(?<![\w-])\d{1,5}\s+[A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)*\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Ter|Terrace)\b\.?/g,
    replacement: "[address]",
  },
];

export function redactToolPayload(text: string): string {
  let out = text;
  for (const { pattern, replacement } of SENSITIVE) out = out.replace(pattern, replacement);
  return out;
}

const MAX_SUMMARY = 120;

function clamp(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > MAX_SUMMARY ? `${line.slice(0, MAX_SUMMARY - 1).trimEnd()}…` : line;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** `contacts` → "contacts"; `campaignId` → "campaign id". Keys are ours, not language. */
function humanKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase().trim();
  return spaced || key;
}

/** Count fields the payload states about itself. Trustworthy even when truncated. */
const COUNT_KEYS = ["total", "count", "returned"];

function describeParsed(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  if (value === null || typeof value !== "object") return clamp(String(value));

  const record = value as Record<string, unknown>;
  const parts: string[] = [];

  // A stated count beats anything inferred, and reads the way a person would say
  // it: "243 contacts", not "contacts: 243".
  const listKey = Object.keys(record).find((k) => Array.isArray(record[k]));
  const stated = COUNT_KEYS.map((k) => record[k]).find((v) => typeof v === "number") as number | undefined;
  if (typeof stated === "number") {
    parts.push(listKey ? `${stated} ${humanKey(listKey)}` : `${stated}`);
  } else if (listKey) {
    const list = record[listKey] as unknown[];
    parts.push(`${list.length} ${humanKey(listKey)}`);
  }

  // Only when it says something a count does not. "ok" alongside a number is noise.
  const status = record.status;
  if (typeof status === "string" && status !== "ok") parts.push(status);
  if (parts.length === 0 && record.ok === true) parts.push("ok");

  if (parts.length > 0) return clamp(parts.join(" · "));

  // Nothing countable — name the fields rather than dumping their values, which
  // is where the ids and contact details live.
  const keys = Object.keys(record);
  if (keys.length === 0) return "no detail";
  return clamp(keys.slice(0, 4).map(humanKey).join(", ") + (keys.length > 4 ? ` +${keys.length - 4}` : ""));
}

/**
 * The one-line form. Returns "" when there is nothing worth a line.
 *
 * Input is redacted first, so a summary can never reintroduce what redaction
 * removed — the two are not independently applied at each call site.
 */
export function summarizeToolPayload(raw: string | null | undefined): string {
  const text = redactToolPayload((raw ?? "").trim());
  if (!text) return "";

  // Not a payload — a message. Errors land here and are the most useful thing on
  // the row, so they pass through rather than being reduced to a shape.
  if (!/^[[{]/.test(text)) return clamp(text);

  const parsed = parse(text);
  if (parsed !== undefined) return describeParsed(parsed);

  // Truncated mid-token, so nothing structural can be trusted — but a stated
  // count is a scalar the payload asserts about itself, and it survives the cut
  // because it sits near the front. `{"leads":[…],"total":142}` should read
  // "142 leads", not a list of field names.
  const keys = [...text.matchAll(/"([A-Za-z_][\w-]*)"\s*:/g)].map((m) => m[1]!);
  const stated = text.match(new RegExp(`"(?:${COUNT_KEYS.join("|")})"\\s*:\\s*(\\d+)`));
  const listKey = keys.find((k) => new RegExp(`"${k}"\\s*:\\s*\\[`).test(text));
  if (stated) return clamp(listKey ? `${stated[1]} ${humanKey(listKey)}` : `${stated[1]}`);

  // Nothing countable survived. Name the fields that did and say the text was
  // cut, because a reader who sees three keys should not conclude there were
  // only three.
  const unique = [...new Set(keys.map(humanKey))].slice(0, 4);
  if (unique.length === 0) return "response was cut short";
  return clamp(`${unique.join(", ")} — cut short`);
}
