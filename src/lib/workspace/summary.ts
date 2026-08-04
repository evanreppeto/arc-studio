import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { getBusinessProfile, listPersonaDefinitions } from "@/lib/brand-kit/persistence";
import { getBusinessContext } from "@/lib/brand-kit/read-model";
import { listWorkspaceConnectors } from "@/lib/connectors/read-model";
import { countActiveApprovals, getRecentCorrections } from "@/lib/approvals/read-model";
import { listAvailableArcMedia } from "@/lib/media-library/arc-handoff";
import { getDismissalPatterns } from "@/lib/opportunities/read-model";
import { summarizeCorrections, summarizeDismissals } from "@/domain";

export type WorkspaceSummary = {
  brandKit: "active" | "draft" | "none";
  connectors: { connected: number; total: number };
  mediaAvailable: number;
  pendingApprovals: number;
  personas: number;
  /**
   * Live record counts (BSR-678).
   *
   * Arc told an operator the CRM was empty 85 minutes after 243 contacts were
   * imported, cited `get_workspace_settings` as its live source — a tool that
   * carries no CRM data — and then wrote the false belief back into the Brain
   * stamped with that day's date.
   *
   * The prompt already forbids quoting a remembered count. The reason that
   * wasn't enough: this snapshot is injected every turn and carried no record
   * counts, so when Arc reasoned about the CRM there was no live number in
   * context and the only figure available WAS the remembered one. Adding the
   * counts here is the structural fix — the true number now sits in front of
   * the model on every turn, whether or not it thinks to go looking.
   *
   * Counts only. Row content still needs a real CRM read.
   *
   * `null` means the count could not be read, and is deliberately NOT 0 — "we
   * don't know" and "there are none" are different answers, and collapsing them
   * is the same mistake in miniature.
   */
  records: {
    contacts: number | null;
    companies: number | null;
    leads: number | null;
    campaigns: number | null;
  };
  /**
   * What this workspace keeps dismissing, already phrased as what to change
   * (BSR-686). Empty when no pattern has repeated often enough to be a rule
   * rather than an opinion about one record.
   *
   * Here for the same structural reason as `records` above: the operator's
   * judgement was being written to the database and never put in front of the
   * model, so Arc had no way to know it had been told no forty-six times. A
   * value that only lives in a table the model never reads may as well not
   * exist.
   */
  dismissalPatterns: string[];
  /**
   * What the operator recently sent back, in their own words (BSR-685).
   *
   * Sibling of `dismissalPatterns` above and carried for the same reason, but
   * NOT aggregated: a dismissal is one value from a fixed vocabulary and needs
   * repetition to mean anything, while a correction is free text and specific
   * enough to act on the first time. One of the live tenant's three literally
   * says "in the future, always use this" — waiting for a third occurrence
   * would have thrown it away.
   */
  recentCorrections: string[];
};

export type WorkspaceSettingsDetail = WorkspaceSummary & {
  connectorList: Array<{ key: string; label: string; status: string; connected: boolean; lastTestOk: boolean | null }>;
  personaList: Array<{ key: string; label: string; isActive: boolean }>;
  compliance: { disallowedClaims: string[]; complianceNotes: string };
  identity: { tagline: string | null; websiteUrl: string | null; serviceAreas: string[] };
};

/** Bounded media snapshot — a count proxy, not a full library scan. */
const MEDIA_SNAPSHOT_LIMIT = 100;

/** Degraded snapshot returned when Supabase isn't configured — never throws. */
const NEUTRAL_WORKSPACE_SUMMARY: WorkspaceSummary = {
  brandKit: "none",
  connectors: { connected: 0, total: 0 },
  mediaAvailable: 0,
  pendingApprovals: 0,
  personas: 0,
  // Unconfigured Supabase means the counts are unknown, not zero.
  records: { contacts: null, companies: null, leads: null, campaigns: null },
  dismissalPatterns: [],
  recentCorrections: [],
};

/**
 * Exact row count for one table, head-only so no rows cross the wire.
 *
 * Returns null — not 0 — when the count can't be read. "We don't know" and
 * "there are none" are different answers, and collapsing them is the exact
 * mistake this whole snapshot exists to stop (see the `records` doc comment).
 */
async function countRows(
  db: SupabaseClient,
  table: string,
  column: "org_id" | "workspace_id",
  id: string,
): Promise<number | null> {
  try {
    const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).eq(column, id);
    return error ? null : (count ?? null);
  } catch {
    return null;
  }
}

/** Resolve a piece of the summary, swallowing its error to a fallback so one
 *  unavailable source never sinks the whole snapshot. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function getWorkspaceSummary(
  orgId: string,
  workspaceId: string,
  client?: SupabaseClient,
): Promise<WorkspaceSummary> {
  if (!isSupabaseAdminConfigured()) return { ...NEUTRAL_WORKSPACE_SUMMARY };
  const db = client ?? getSupabaseAdminClient();
  const [profile, connectors, approvals, personas, media, contacts, companies, leads, campaigns, dismissals, corrections] = await Promise.all([
    safe(() => getBusinessProfile(orgId), null),
    safe(() => listWorkspaceConnectors(db, workspaceId), []),
    safe(() => countActiveApprovals(orgId, db), 0),
    safe(() => listPersonaDefinitions(orgId), []),
    safe(() => listAvailableArcMedia(orgId, { limit: MEDIA_SNAPSHOT_LIMIT }, db), []),
    // Customer records are org-owned; generated work is workspace-owned. Scope
    // each to the column that actually carries its tenancy rather than assuming.
    countRows(db, "contacts", "org_id", orgId),
    countRows(db, "companies", "org_id", orgId),
    countRows(db, "leads", "org_id", orgId),
    countRows(db, "campaigns", "workspace_id", workspaceId),
    safe(() => getDismissalPatterns(orgId, db), [] as Awaited<ReturnType<typeof getDismissalPatterns>>),
    safe(() => getRecentCorrections(orgId, db), [] as Awaited<ReturnType<typeof getRecentCorrections>>),
  ]);

  return {
    brandKit: profile ? profile.status : "none",
    connectors: {
      connected: connectors.filter((c) => c.credentialPresent).length,
      total: connectors.length,
    },
    mediaAvailable: media.length,
    pendingApprovals: approvals,
    personas: personas.length,
    records: { contacts, companies, leads, campaigns },
    dismissalPatterns: summarizeDismissals(dismissals),
    recentCorrections: summarizeCorrections(corrections),
  };
}

export async function getWorkspaceSettingsDetail(
  orgId: string,
  workspaceId: string,
  client?: SupabaseClient,
): Promise<WorkspaceSettingsDetail> {
  if (!isSupabaseAdminConfigured()) {
    return {
      ...NEUTRAL_WORKSPACE_SUMMARY,
      connectorList: [],
      personaList: [],
      compliance: { disallowedClaims: [], complianceNotes: "" },
      identity: { tagline: null, websiteUrl: null, serviceAreas: [] },
    };
  }
  const db = client ?? getSupabaseAdminClient();
  const summary = await getWorkspaceSummary(orgId, workspaceId, db);
  const [connectors, personas, context] = await Promise.all([
    safe(() => listWorkspaceConnectors(db, workspaceId), []),
    safe(() => listPersonaDefinitions(orgId), []),
    safe(() => getBusinessContext(orgId), null),
  ]);

  return {
    ...summary,
    connectorList: connectors.map((c) => ({
      key: c.key,
      label: c.label,
      status: c.status,
      connected: c.credentialPresent,
      lastTestOk: c.lastTestOk,
    })),
    personaList: personas.map((p) => ({ key: p.key, label: p.label, isActive: p.isActive })),
    compliance: context
      ? { disallowedClaims: context.guardrails.disallowedClaims, complianceNotes: context.guardrails.complianceNotes }
      : { disallowedClaims: [], complianceNotes: "" },
    identity: context
      ? { tagline: context.tagline, websiteUrl: context.websiteUrl, serviceAreas: context.serviceAreas }
      : { tagline: null, websiteUrl: null, serviceAreas: [] },
  };
}
