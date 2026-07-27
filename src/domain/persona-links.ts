/**
 * Deep links to a persona.
 *
 * Arc's @-mentions link to `/personas?inspect=<slug>`; the personas page reads
 * the same param back and opens the roster on that persona. Both sides live
 * here so the link format can't drift apart — before this the page ignored the
 * query entirely and every persona mention opened whichever persona sorted
 * first.
 *
 * Personas are per-org, and callers spell them two ways: the slug used by the
 * `personas` table (`team-admin`) and the record key CRM rows carry
 * (`persona_team_admin`). Both resolve.
 */

export const PERSONA_INSPECT_PARAM = "inspect";

export function personaInspectHref(slugOrKey: string): string {
  return `/personas?${PERSONA_INSPECT_PARAM}=${encodeURIComponent(slugOrKey)}`;
}

/** Normalize either spelling to the slug form used by the `personas` table. */
export function normalizePersonaSlug(slugOrKey: string): string {
  return slugOrKey.trim().toLowerCase().replace(/^persona_/, "").replace(/_/g, "-");
}

/**
 * The slug to open, or undefined when the workspace has no such persona — an
 * unknown key must fall through to the default rather than silently selecting
 * an unrelated persona.
 */
export function matchPersonaSlug(inspect: string | undefined | null, slugs: readonly string[]): string | undefined {
  if (!inspect) return undefined;
  const wanted = normalizePersonaSlug(inspect);
  if (!wanted) return undefined;
  return slugs.find((slug) => normalizePersonaSlug(slug) === wanted);
}
