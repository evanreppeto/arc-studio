/**
 * Tool naming for the run surfaces. Pure string work, kept out of the view so
 * the inline trace and the conversation workspace label the same tool call the
 * same way — and so the workspace digest can build rows without importing a
 * component.
 */

import type { ArcStepKind } from "@/domain";

export function formatToolName(name: string) {
  return name.replace(/[._-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function getToolKind(name: string): ArcStepKind {
  const normalized = name.toLowerCase();
  if (/(image|video|media|render|asset|thumbnail)/.test(normalized)) return "media";
  if (/(search|lookup|weather|browse|fetch)/.test(normalized)) return "search";
  if (/(crm|audience|score|match|record|database)/.test(normalized)) return "match";
  if (/(draft|compose|campaign|email|sms|update)/.test(normalized)) return "draft";
  return "tool";
}
