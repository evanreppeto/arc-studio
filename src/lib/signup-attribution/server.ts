import { cookies } from "next/headers";

import {
  parseAttributionRecord,
  type AttributionRecord,
} from "@/domain/signup-attribution";

import { ATTRIBUTION_COOKIE } from "./shared";

/**
 * Read the attribution record the browser stored (BSR-586).
 *
 * Returns null when the cookie is absent, malformed, or edited into nonsense —
 * `parseAttributionRecord` validates the shape rather than trusting it, because
 * this value is fully under a visitor's control. Attribution is never worth
 * failing a signup over, so every caller treats null as "unattributed" and
 * carries on.
 */
export async function readAttributionRecord(): Promise<AttributionRecord | null> {
  try {
    const store = await cookies();
    const raw = store.get(ATTRIBUTION_COOKIE)?.value;
    if (!raw) return null;
    return parseAttributionRecord(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

/**
 * The value to write into an `attribution` jsonb column.
 *
 * `{}` rather than null for the unattributed case, matching the column default
 * so readers never have to branch on null (see the migration's note).
 */
export function attributionColumnValue(
  record: AttributionRecord | null,
): AttributionRecord | Record<string, never> {
  return record ?? {};
}
