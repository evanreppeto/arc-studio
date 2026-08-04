/**
 * Which KIND of thing a tool call was, for the icon beside it.
 *
 * Naming lives in `arcToolLabel` (src/domain/vocabulary.ts) — this file used to
 * carry a second spelling, `formatToolName`, which turned separators into spaces
 * and title-cased the result. It was wrong twice over.
 *
 * It left the transport prefix in place, so `mcp__arc__crm_search` came out as
 * "Mcp Arc Crm Search". Prettifying an identifier is not the same as removing it
 * — and it is worse than leaving it raw, because the spaces defeat every check
 * that looks for identifier shapes. Strip the prefix; do not space it out.
 *
 * It also disagreed with the other spelling in the same file: the digest labelled
 * one row "Crm Lookup" and the next "CRM lookup" (BSR-709).
 */

import type { ArcStepKind } from "@/domain";

export function getToolKind(name: string): ArcStepKind {
  const normalized = name.toLowerCase();
  if (/(image|video|media|render|asset|thumbnail)/.test(normalized)) return "media";
  if (/(search|lookup|weather|browse|fetch)/.test(normalized)) return "search";
  if (/(crm|audience|score|match|record|database)/.test(normalized)) return "match";
  if (/(draft|compose|campaign|email|sms|update)/.test(normalized)) return "draft";
  return "tool";
}
