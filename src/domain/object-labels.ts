/**
 * Per-workspace CRM object names — the free-text layer over industry vocabulary.
 *
 * `src/lib/product-language.ts` picks a label set from the workspace's industry,
 * one of nine fixed vocabularies. That fits a workspace whose trade is on the
 * list and leaves everyone else on `general`'s neutral nouns — a law firm gets
 * "Organizations", never "Matters". This module is the override on top: a
 * workspace types its own words and they win.
 *
 * Pure logic only. Persistence is one `app_settings` jsonb row (`src/lib/settings/store.ts`).
 *
 * A workspace supplies TWO forms per object — plural and singular — and the four
 * forms the app renders are derived from them. Deriving the singular from the
 * plural is a guess English does not support: "Matters" → "Matter" works,
 * "People" → "Peopl" does not, and the failure surfaces in a button the operator
 * reads every day. Two inputs is the honest price.
 */

export type ObjectLabelOverride = {
  /** As displayed in a tab or heading: "Matters". */
  plural: string;
  /** As displayed in a button or mid-sentence: "matter". */
  singular: string;
};

/** The four forms the app actually renders. Mirrors `CrmObjectLanguage`. */
export type ObjectLabelForms = {
  label: string;
  noun: string;
  nameHeader: string;
  singular: string;
};

/** Long enough for "Commercial service locations"; short enough not to break a tab. */
export const OBJECT_LABEL_MAX_LENGTH = 40;

function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, OBJECT_LABEL_MAX_LENGTH).trim();
}

/**
 * Lowercase for mid-sentence use, but leave acronyms alone: "HOA Boards" must
 * read "No HOA boards yet", not "No hoa boards yet". Same reasoning as
 * `humanizePersonaLabel` — a token that is all-caps was capitalized on purpose.
 */
function lowerForProse(value: string): string {
  return value
    .split(" ")
    .map((word) => (/^[A-Z0-9&/-]{2,}$/.test(word) ? word : word.toLowerCase()))
    .join(" ");
}

function capitalizeFirst(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/**
 * Validate one stored override. Returns null — meaning "fall back to the
 * industry vocabulary" — unless BOTH forms are present.
 *
 * Half an override is worse than none: a workspace that filled in the plural and
 * left the singular blank would get "Matters" in the tab and "Add site" in the
 * button beneath it, mixing two vocabularies on one screen. Refusing the partial
 * keeps the screen internally consistent.
 */
export function parseObjectLabelOverride(raw: unknown): ObjectLabelOverride | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const plural = clean(record.plural);
  const singular = clean(record.singular);
  if (!plural || !singular) return null;
  return { plural, singular };
}

/** Expand a workspace's two words into the four forms the UI renders. */
export function deriveObjectLabelForms(override: ObjectLabelOverride): ObjectLabelForms {
  return {
    label: override.plural,
    noun: lowerForProse(override.plural),
    nameHeader: capitalizeFirst(override.singular),
    singular: lowerForProse(override.singular),
  };
}
