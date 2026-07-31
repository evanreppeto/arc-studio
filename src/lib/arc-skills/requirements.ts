import type { ArcSkillDefinition } from "./catalog";

/**
 * Whether a skill's data sources are actually reachable in this workspace.
 *
 * A skill like "Competitor watch" is installable, clickable and runnable with
 * the Competitor Ad Intel connector switched off — it just comes back with
 * whatever it could produce without that source, and nobody is told the source
 * was missing. This module is the "tell them first" half: it resolves a skill's
 * declared `requiresConnectors` against live connector status so the UI can name
 * the gap before the turn is sent.
 *
 * It deliberately does not gate anything. The operator may have a reason to run
 * a skill without one of its sources, and refusing would be worse than the
 * silence it replaces.
 */

/** The slice of a connector view this resolver needs. Kept structural so both
 *  `ConnectorView` and `ConnectionView` satisfy it without a conversion. */
export type SkillConnectorStatus = {
  key: string;
  label: string;
  status: "connected" | "disabled" | "error" | "not_configured" | "unavailable";
};

export type SkillRequirementReason =
  /** In the catalog, credentialed, but switched off for this workspace. */
  | "disabled"
  /** Known connector with no credential or no usable config yet. */
  | "not_configured"
  /** Configured and enabled, but its last check failed. */
  | "error"
  /** Catalogued as planned — not built, so it cannot be switched on. */
  | "unavailable"
  /** Declared by the skill but absent from this workspace's catalog entirely.
   *  Usually a stale `requiresConnectors` entry rather than an operator problem. */
  | "unknown";

export type SkillRequirement = {
  key: string;
  label: string;
  reason: SkillRequirementReason;
};

/**
 * The connectors a skill needs that are not usable right now.
 *
 * Every declared connector must be `connected` to count as met — these are
 * declared as things the skill "cannot do its stated job without", not as a
 * menu of alternatives. Returns `[]` for a skill that declares nothing, which
 * is the common case and must stay silent.
 */
export function unmetSkillConnectors(
  skill: Pick<ArcSkillDefinition, "requiresConnectors">,
  connectors: readonly SkillConnectorStatus[],
): SkillRequirement[] {
  const required = skill.requiresConnectors ?? [];
  if (required.length === 0) return [];

  const byKey = new Map(connectors.map((connector) => [connector.key, connector]));
  const unmet: SkillRequirement[] = [];
  const seen = new Set<string>();

  for (const key of required) {
    // A skill may legitimately list the same source twice across edits; report once.
    if (seen.has(key)) continue;
    seen.add(key);

    const connector = byKey.get(key);
    if (!connector) {
      unmet.push({ key, label: key, reason: "unknown" });
      continue;
    }
    if (connector.status === "connected") continue;
    unmet.push({ key, label: connector.label, reason: connector.status });
  }

  return unmet;
}

/** One connector's gap, in the operator's words. */
export function describeSkillRequirement(requirement: SkillRequirement): string {
  if (requirement.reason === "disabled") return `${requirement.label} is off`;
  if (requirement.reason === "not_configured") return `${requirement.label} is not set up`;
  if (requirement.reason === "error") return `${requirement.label} needs attention`;
  if (requirement.reason === "unavailable") return `${requirement.label} is not available yet`;
  return `${requirement.label} is not in this workspace`;
}

/**
 * The whole gap as one sentence, for the composer and the skill row.
 * Names every missing source rather than "1 connector missing" — the point is
 * to say *which* data the answer will be missing.
 */
export function describeSkillRequirements(requirements: readonly SkillRequirement[]): string {
  if (requirements.length === 0) return "";
  const described = requirements.map(describeSkillRequirement);
  if (described.length === 1) return `${described[0]} — Arc will answer without it.`;
  const last = described[described.length - 1]!;
  return `${described.slice(0, -1).join(", ")} and ${last} — Arc will answer without them.`;
}
