/**
 * Shaping the SDK's `usage` payload for the ledger (BSR-502).
 *
 * History matters here. The first pass captured only the two fields the
 * hypothesis named — `cache_read_input_tokens` and `cache_creation_input_tokens`
 * — plus the raw KEY SET as a hedge. The key set is what paid off: the first
 * production row revealed `cache_creation` (an object, the per-TTL split, whose
 * halves bill at DIFFERENT multipliers), `service_tier`, and `server_tool_use` —
 * none of which anyone knew to ask for, and the values of which were therefore
 * not captured. That cost a second round trip through review and deploy.
 *
 * So this no longer enumerates. It records the WHOLE payload, and the guard is
 * structural rather than a field list: scalars and one level of scalar-valued
 * objects survive, anything deeper or larger is dropped BY NAME so its absence
 * is visible in the row rather than silent. A third "we didn't capture the field
 * we needed" round is the thing being designed out.
 */

/** Cap on captured keys. Generous vs. today's ~10; a runaway payload is the real risk. */
const MAX_KEYS = 40;
/** Cap on nested keys per object, same reasoning. */
const MAX_NESTED_KEYS = 20;
/** Strings are tier/geo labels; anything longer is not a label. */
const MAX_STRING_CHARS = 200;

export type UsageDetail = Record<string, unknown>;

type Scalar = number | string | boolean;

function scalar(value: unknown): Scalar | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, MAX_STRING_CHARS);
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One level of nesting, scalars only. Returns undefined if nothing survives. */
function nested(value: Record<string, unknown>): Record<string, Scalar> | undefined {
  const out: Record<string, Scalar> = {};
  let kept = 0;
  for (const [key, raw] of Object.entries(value)) {
    if (kept >= MAX_NESTED_KEYS) break;
    const s = scalar(raw);
    if (s === undefined) continue;
    out[key] = s;
    kept += 1;
  }
  return kept > 0 ? out : undefined;
}

/**
 * Flatten one SDK `usage` payload into something safe to store as JSONB.
 *
 * Always includes `usage_keys` — the full sorted key list as the SDK sent it,
 * INCLUDING keys that were dropped. That list is the tripwire: it is how the
 * missing `cache_creation` values were noticed in the first place, and it keeps
 * working when the SDK adds a field nobody is looking for.
 */
export function buildUsageDetail(usage: Record<string, unknown> | null | undefined): UsageDetail | null {
  if (!isPlainObject(usage)) return null;

  const detail: UsageDetail = {};
  const dropped: string[] = [];
  let kept = 0;

  for (const [key, raw] of Object.entries(usage)) {
    if (kept >= MAX_KEYS) {
      dropped.push(key);
      continue;
    }
    const s = scalar(raw);
    if (s !== undefined) {
      detail[key] = s;
      kept += 1;
      continue;
    }
    if (isPlainObject(raw)) {
      const inner = nested(raw);
      if (inner) {
        detail[key] = inner;
        kept += 1;
        continue;
      }
    }
    // Arrays, nulls, functions, and anything deeper than one level. Named, not
    // silently discarded — a field we chose not to store must still be visible.
    dropped.push(key);
  }

  detail.usage_keys = Object.keys(usage).sort();
  if (dropped.length > 0) detail.dropped_keys = dropped.sort();
  return detail;
}
