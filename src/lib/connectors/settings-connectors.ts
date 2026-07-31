// ---------------------------------------------------------------------------
// Settings → Connections view. Real per-workspace connector state when Supabase
// is configured (via listWorkspaceConnectors); otherwise a registry-only
// fallback so the offline preview shows the real 2-connector catalog as
// "not configured" (never fabricated as connected). Secrets never appear here —
// ConnectorView carries only presence + status.
// ---------------------------------------------------------------------------

import { CONNECTOR_REGISTRY, computeConnectorStatus, connectorRequiresCredential, effectiveCostTier, type ConnectorCredentialSource } from "@/domain";

import { platformCredentialFor } from "./credentials";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { listWorkspaceConnectors, type ConnectorView } from "./read-model";

export type SettingsConnectorsView = {
  configured: boolean;
  connectors: ConnectorView[];
};

/** Registry-only views (no workspace rows) — every connector "not configured". */
function registryFallback(): ConnectorView[] {
  return CONNECTOR_REGISTRY.map((entry) => {
    const requiresCredential = connectorRequiresCredential(entry);
    // Env is server-side truth even without Supabase, so platform-credits
    // availability is real here — the offline preview honestly shows which
    // connectors would work out of the box.
    const platformCredentialAvailable = Boolean(platformCredentialFor(entry));
    const activeCredentialSource: ConnectorCredentialSource = platformCredentialAvailable ? "platform" : "none";
    return {
      key: entry.key,
      kind: entry.kind,
      label: entry.label,
      description: entry.description,
      capabilitySummary: entry.capability.summary,
      authKind: entry.authKind,
      access: entry.access,
      costTier: entry.costTier,
      enabled: false,
      credentialPresent: false,
      credentialOptional: !requiresCredential,
      platformCredentialAvailable,
      activeCredentialSource,
      activeCostTier: effectiveCostTier(entry, activeCredentialSource),
      config: {},
      status: computeConnectorStatus({ credentialPresent: false, enabled: false, lastTestOk: null, requiresCredential, availability: entry.availability, platformCredentialAvailable }),
      lastTestedAt: null,
      lastTestOk: null,
      lastTestError: null,
    };
  });
}

export async function getSettingsConnectorsView(): Promise<SettingsConnectorsView> {
  if (!isSupabaseAdminConfigured()) return { configured: false, connectors: registryFallback() };

  try {
    const ctx = await getCurrentWorkspaceContext();
    if (!ctx.workspaceId) return { configured: false, connectors: registryFallback() };
    const connectors = await listWorkspaceConnectors(getSupabaseAdminClient(), ctx.workspaceId);
    return { configured: true, connectors };
  } catch {
    return { configured: false, connectors: registryFallback() };
  }
}
