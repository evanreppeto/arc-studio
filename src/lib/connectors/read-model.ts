import { type SupabaseClient } from "@supabase/supabase-js";

import {
  CONNECTOR_REGISTRY,
  computeConnectorStatus,
  connectorConfigSatisfied,
  connectorRequiresCredential,
  effectiveCostTier,
  type ConnectorAccess,
  type ConnectorAuthKind,
  type ConnectorCapability,
  type ConnectorCostTier,
  type ConnectorCredentialSource,
  type ConnectorKind,
  type ConnectorStatus,
} from "@/domain";

import { platformCredentialFor } from "./credentials";

export type ConnectorView = {
  key: string;
  kind: ConnectorKind;
  label: string;
  description: string;
  /**
   * The registry's one-line `capability.summary`. `description` is written for
   * the Settings page and runs long; in a 386px drawer it clamps mid-word. Any
   * surface too narrow for the full description should show this instead of
   * truncating prose the operator can then never read.
   */
  capabilitySummary: string;
  authKind: ConnectorAuthKind;
  access: ConnectorAccess;
  costTier: ConnectorCostTier;
  enabled: boolean;
  credentialPresent: boolean;
  /** True when NO stored credential is needed (public signal source, etc). */
  credentialOptional: boolean;
  /** The deployment supplies a platform key — works with no stored credential
   *  (platform-credits mode, metered). */
  platformCredentialAvailable: boolean;
  /** Which credential a call would actually use right now. */
  activeCredentialSource: ConnectorCredentialSource;
  /** The cost tier that active source runs under (byo bypasses metering;
   *  platform is metered against the plan). */
  activeCostTier: ConnectorCostTier;
  /** Non-secret per-workspace config (locations, endpoint URL, …). */
  config: Record<string, unknown>;
  status: ConnectorStatus;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
};

/** Enabled-connector summary for GET /api/v1/arc/connectors (no secrets). */
export type EnabledConnectorSummary = {
  key: string;
  kind: ConnectorKind;
  costTier: ConnectorCostTier;
  label: string;
  access: ConnectorAccess;
  capability: ConnectorCapability;
};

type ConnectorRow = {
  connector_key: string;
  enabled: boolean;
  credential_ref: string | null;
  config: Record<string, unknown> | null;
  last_tested_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
};

/** Catalog x this workspace's rows → views with computed status. No secrets/refs. */
export async function listWorkspaceConnectors(client: SupabaseClient, workspaceId: string): Promise<ConnectorView[]> {
  const { data, error } = await client
    .from("workspace_connectors")
    .select("connector_key,enabled,credential_ref,config,last_tested_at,last_test_ok,last_test_error")
    .eq("workspace_id", workspaceId);

  if (error) {
    console.warn(`workspace_connectors lookup failed, using registry fallback: ${error.message}`);
  }
  const rows = error ? [] : ((data ?? []) as ConnectorRow[]);
  const byKey = new Map(rows.map((row) => [row.connector_key, row]));

  return CONNECTOR_REGISTRY.map((entry) => {
    const row = byKey.get(entry.key);
    const credentialPresent = Boolean(row?.credential_ref);
    const requiresCredential = connectorRequiresCredential(entry);
    const configPresent = connectorConfigSatisfied(entry, row?.config ?? {});
    const platformCredentialAvailable = Boolean(platformCredentialFor(entry));
    const activeCredentialSource: ConnectorCredentialSource = credentialPresent
      ? "byo"
      : platformCredentialAvailable
        ? "platform"
        : "none";
    return {
      key: entry.key,
      kind: entry.kind,
      label: entry.label,
      description: entry.description,
      capabilitySummary: entry.capability.summary,
      authKind: entry.authKind,
      access: entry.access,
      costTier: entry.costTier,
      enabled: row?.enabled ?? false,
      credentialPresent,
      credentialOptional: !requiresCredential,
      platformCredentialAvailable,
      activeCredentialSource,
      activeCostTier: effectiveCostTier(entry, activeCredentialSource),
      config: row?.config ?? {},
      status: computeConnectorStatus({
        credentialPresent,
        enabled: row?.enabled ?? false,
        lastTestOk: row?.last_test_ok ?? null,
        requiresCredential,
        configPresent,
        availability: entry.availability,
        platformCredentialAvailable,
      }),
      lastTestedAt: row?.last_tested_at ?? null,
      lastTestOk: row?.last_test_ok ?? null,
      lastTestError: row?.last_test_error ?? null,
    };
  });
}

/**
 * Enabled connectors for this workspace, grouped-ready by kind + costTier, for
 * the bearer-gated runner API. Enabled = status "connected" (switch on and any
 * required credential present). No secrets/refs — capability metadata only.
 */
export async function listEnabledConnectorsForApi(
  client: SupabaseClient,
  workspaceId: string,
): Promise<EnabledConnectorSummary[]> {
  const views = await listWorkspaceConnectors(client, workspaceId);
  const enabledKeys = new Set(views.filter((v) => v.status === "connected").map((v) => v.key));
  return CONNECTOR_REGISTRY.filter((entry) => enabledKeys.has(entry.key)).map((entry) => ({
    key: entry.key,
    kind: entry.kind,
    costTier: entry.costTier,
    label: entry.label,
    access: entry.access,
    capability: entry.capability,
  }));
}

/** The Vault ref for an ENABLED connector in this workspace, else null. */
export async function resolveConnectorCredentialRef(
  client: SupabaseClient,
  workspaceId: string,
  connectorKey: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("workspace_connectors")
    .select("credential_ref,enabled")
    .eq("workspace_id", workspaceId)
    .eq("connector_key", connectorKey)
    .maybeSingle<{ credential_ref: string | null; enabled: boolean }>();
  if (error || !data || !data.enabled) return null;
  return data.credential_ref ?? null;
}
