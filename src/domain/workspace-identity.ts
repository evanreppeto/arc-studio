// ---------------------------------------------------------------------------
// Workspace display identity — the rail's workspace block, resolved.
//
// The block has four visible parts and each one used to be derived rather than
// stored: the bold line (workspaces.name), the grey line under it (the *org*
// name, which the coupled rename kept identical to the workspace name), the
// status pill (first word of the org name + " workspace", computed inline in the
// component), and the accent tinting the monogram + dot (one org-wide value, so
// every workspace in the switcher looked the same).
//
// This module owns the fallbacks. A workspace that has customized nothing
// resolves to exactly what the rail rendered before the identity columns
// existed, so the defaults are load-bearing — the tests pin them.
//
// Pure: no I/O. Persistence lives in src/lib/auth/workspace-identity.ts.
// ---------------------------------------------------------------------------

/** Named accents from globals.css (`html[data-accent="…"]`). */
export const WORKSPACE_ACCENT_KEYS = ["gold", "blue", "red", "steel", "emerald"] as const;
export type WorkspaceAccentKey = (typeof WORKSPACE_ACCENT_KEYS)[number];

/**
 * Representative `--accent` of each theme. A workspace accent only ever tints
 * the monogram and the dot — it does not re-skin the app, so a single hex is
 * enough and the soft/border variants are mixed from it in CSS.
 */
export const WORKSPACE_ACCENT_SWATCHES: Record<WorkspaceAccentKey, string> = {
  gold: "#c8a24a",
  blue: "#5bb7e8",
  red: "#d98080",
  steel: "#aeb5c2",
  emerald: "#7fb89a",
};

export const WORKSPACE_NAME_MAX = 80;
export const WORKSPACE_SUBTITLE_MAX = 80;
export const WORKSPACE_SHORT_LABEL_MAX = 32;

/** The stored (nullable) identity of one workspace, straight off the row. */
export type WorkspaceIdentity = {
  name: string;
  subtitle: string | null;
  shortLabel: string | null;
  accentKey: WorkspaceAccentKey | null;
  logoUrl: string | null;
};

/** What the rail actually renders, with every fallback already applied. */
export type ResolvedWorkspaceIdentity = {
  name: string;
  subtitle: string;
  shortLabel: string;
  /** Hex tint for the monogram/dot, or null to inherit the org-wide accent. */
  accentColor: string | null;
  accentKey: WorkspaceAccentKey | null;
  logoUrl: string | null;
};

export function isWorkspaceAccentKey(value: unknown): value is WorkspaceAccentKey {
  return typeof value === "string" && (WORKSPACE_ACCENT_KEYS as readonly string[]).includes(value);
}

/** Blank/whitespace-only becomes null — "cleared", not "set to empty string". */
function trimToNull(value: string | null | undefined, max: number): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * The legacy pill text: first word of the organization name, uppercased, plus
 * the literal " workspace". Kept exactly as the component computed it so an
 * un-customized workspace's pill does not change under anyone.
 */
export function derivedShortLabel(orgName: string): string {
  const first = orgName.trim().split(/\s+/).filter(Boolean)[0];
  return first ? `${first.toUpperCase()} workspace` : "Workspace";
}

/**
 * Monogram for a name: first letter of its first two words.
 *
 * Words that don't START with a letter or digit are skipped — separators are
 * common in a workspace name ("Restoration · Chicago", "Field — Ops"), and
 * taking them literally produced monograms like "R·".
 */
export function workspaceInitials(name: string): string {
  return (
    (name || "")
      .split(/\s+/)
      .filter((word) => /^[\p{L}\p{N}]/u.test(word))
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join("") || "A"
  );
}

/**
 * Apply the stored identity over the organization defaults. `orgName` is the
 * fallback source for both the subtitle and the pill — that is what makes an
 * untouched workspace render identically to before.
 */
export function resolveWorkspaceIdentity(identity: WorkspaceIdentity, orgName: string): ResolvedWorkspaceIdentity {
  const accentKey = isWorkspaceAccentKey(identity.accentKey) ? identity.accentKey : null;
  return {
    name: identity.name.trim() || orgName.trim() || "Workspace",
    subtitle: identity.subtitle?.trim() || orgName.trim(),
    shortLabel: identity.shortLabel?.trim() || derivedShortLabel(orgName),
    accentColor: accentKey ? WORKSPACE_ACCENT_SWATCHES[accentKey] : null,
    accentKey,
    logoUrl: identity.logoUrl?.trim() || null,
  };
}

/** A patch from the identity editor. Every field is optional — absent = leave alone. */
export type WorkspaceIdentityPatch = {
  name?: string;
  orgName?: string;
  subtitle?: string | null;
  shortLabel?: string | null;
  accentKey?: string | null;
};

export type NormalizedWorkspaceIdentityPatch = {
  name?: string;
  orgName?: string;
  subtitle?: string | null;
  shortLabel?: string | null;
  accentKey?: WorkspaceAccentKey | null;
};

export type WorkspaceIdentityPatchResult =
  | { ok: true; patch: NormalizedWorkspaceIdentityPatch }
  | { ok: false; error: string };

/**
 * Validate + normalize an identity patch before it reaches Postgres.
 *
 * Two rules worth stating: a name that is present but blank is an error (you
 * cannot delete a workspace's name by saving an empty box), while a blank
 * subtitle/short label/accent is a *clear* and normalizes to null so the
 * fallback takes over again. Absent keys are untouched.
 */
export function normalizeWorkspaceIdentityPatch(input: WorkspaceIdentityPatch): WorkspaceIdentityPatchResult {
  const patch: NormalizedWorkspaceIdentityPatch = {};

  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, WORKSPACE_NAME_MAX);
    if (!name) return { ok: false, error: "A workspace name is required." };
    patch.name = name;
  }

  if (input.orgName !== undefined) {
    const orgName = input.orgName.trim().slice(0, WORKSPACE_NAME_MAX);
    if (!orgName) return { ok: false, error: "An organization name is required." };
    patch.orgName = orgName;
  }

  if (input.subtitle !== undefined) patch.subtitle = trimToNull(input.subtitle, WORKSPACE_SUBTITLE_MAX);
  if (input.shortLabel !== undefined) patch.shortLabel = trimToNull(input.shortLabel, WORKSPACE_SHORT_LABEL_MAX);

  if (input.accentKey !== undefined) {
    const accent = (input.accentKey ?? "").trim();
    if (!accent) patch.accentKey = null;
    else if (isWorkspaceAccentKey(accent)) patch.accentKey = accent;
    else return { ok: false, error: "Pick one of the available workspace colors." };
  }

  return { ok: true, patch };
}

/** True when the patch would change nothing — lets callers skip a write. */
export function isEmptyIdentityPatch(patch: NormalizedWorkspaceIdentityPatch): boolean {
  return Object.keys(patch).length === 0;
}
