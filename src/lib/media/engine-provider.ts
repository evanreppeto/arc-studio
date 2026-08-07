import { type SupabaseClient } from "@supabase/supabase-js";

import { geminiModelForTarget, type ArcRoute, type ConnectorCostTier, type GenerationTarget, type MediaEngine } from "@/domain";
import { readConnectorCredential } from "@/lib/connectors/credentials";
import { ensureFreshAccessToken } from "@/lib/connectors/oauth-refresh";
import { listWorkspaceConnectors, resolveConnectorCredentialRef } from "@/lib/connectors/read-model";
import { reportDegraded } from "@/lib/observability/report-degraded";
import { parseConnectorCredential } from "@/domain";

import { getMediaProviderWithKey } from "./index";
import { createHiggsfieldMediaProvider } from "./higgsfield";
import { MEDIA_CONNECTOR_KEY, resolveMediaGeneration } from "./enablement";
import { type MediaProvider } from "./types";

export const HIGGSFIELD_CONNECTOR_KEY = "higgsfield";

/**
 * The provider that actually executes a resolved generation target.
 *
 * `resolveGenerationTarget` answers "which model"; this answers "on whose
 * credential, through which engine". Keeping them separate is what lets the
 * target be decided identically everywhere (Studio, the Arc media routes) while
 * the execution details — a Gemini API key vs a per-workspace OAuth token, and
 * two different meters — stay in one place.
 *
 * `connectorKey` and `costTier` come back with the provider because they are not
 * interchangeable: Higgsfield spends the CUSTOMER's own credits and must never
 * be metered against the platform's gemini-media budget, and a Gemini call on
 * platform credits must never be recorded as the customer's spend.
 */
export type ResolvedEngineProvider =
  | {
      ok: true;
      provider: MediaProvider;
      engine: "gemini" | "higgsfield";
      /** Which connector's meter this call belongs to. */
      connectorKey: string;
      costTier: ConnectorCostTier;
    }
  | { ok: false; reason: string };

// Operator-facing copy, so it says what to open rather than naming a vendor or
// an architecture noun — enforced by the off-switch vocabulary guard
// (src/app/(app)/plumbing-vocabulary.test.ts). The operator picked a MODEL, so
// that is the thing to talk about; which company runs it is our problem.
const ENGINE_OFF =
  "That model's engine isn't connected for this workspace. Connect it in Settings → Connections, or pick a built-in model.";

/**
 * Resolve the workspace's Higgsfield access token, refreshing it first.
 *
 * The refresh token is the credential — the access token is short-lived and is
 * exchanged before every use, which is exactly why a headless server action can
 * use a personal-account OAuth connection at all.
 */
async function higgsfieldToken(client: SupabaseClient, workspaceId: string): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  const views = await listWorkspaceConnectors(client, workspaceId).catch(() => []);
  const view = views.find((v) => v.key === HIGGSFIELD_CONNECTOR_KEY);
  if (!view || view.status !== "connected") return { ok: false, reason: ENGINE_OFF };

  const ref = await resolveConnectorCredentialRef(client, workspaceId, HIGGSFIELD_CONNECTOR_KEY);
  const raw = await readConnectorCredential(client, ref);
  // Enabled and reporting a credential, but the bundle won't read: an
  // inconsistency, not a configuration choice. Name it rather than falling back
  // to another engine behind the operator's back — they picked this one.
  if (!raw) return { ok: false, reason: "That model's connection needs setting up again — reconnect it in Settings → Connections." };

  const cred = parseConnectorCredential(raw);
  if (cred.kind !== "oauth_refresh") return { ok: true, token: cred.token };

  const fresh = await ensureFreshAccessToken(client, ref, cred);
  if (!fresh.ok) {
    // The operator gets the sentence that tells them what to open; the actual
    // failure goes where failures go, rather than being lost to keep the copy
    // clean. A revoked or rotated token otherwise removes a capability they
    // deliberately enabled with nothing anywhere to explain it.
    reportDegraded(new Error(`higgsfield token refresh failed: ${fresh.error}`), {
      scope: "media.resolveEngineProvider",
      surface: "primary",
      detail: { connector: HIGGSFIELD_CONNECTOR_KEY, workspaceId, reason: fresh.reason },
    });
    return { ok: false, reason: "That model's connection has expired — reconnect it in Settings → Connections." };
  }
  return { ok: true, token: fresh.accessToken };
}

export async function resolveEngineProvider(input: {
  client: SupabaseClient;
  workspaceId: string | null;
  target: GenerationTarget | null;
  /** The turn's tier, which the Gemini path maps to a model when nothing is pinned. */
  level?: ArcRoute;
  /**
   * Force an engine regardless of the target. For POLLING an in-flight job,
   * whose engine is already decided and must not be re-derived from a workspace
   * default that may have changed since the job started.
   */
  engine?: MediaEngine;
}): Promise<ResolvedEngineProvider> {
  const { client, workspaceId, target } = input;

  if ((input.engine ?? target?.engine) === "higgsfield") {
    if (!workspaceId) return { ok: false, reason: ENGINE_OFF };
    const token = await higgsfieldToken(client, workspaceId);
    if (!token.ok) return { ok: false, reason: token.reason };
    return {
      ok: true,
      // Empty model when only an engine was forced (polling selects nothing).
      provider: createHiggsfieldMediaProvider(token.token, { model: target?.modelId ?? "" }),
      engine: "higgsfield",
      connectorKey: HIGGSFIELD_CONNECTOR_KEY,
      // Always the customer's own credits — Higgsfield has no platform key, so
      // this is never metered against a platform budget.
      costTier: "byo_key",
    };
  }

  const access = await resolveMediaGeneration(workspaceId);
  if (!access.enabled) return { ok: false, reason: access.reason };
  return {
    ok: true,
    provider: getMediaProviderWithKey(access.credential, {
      level: input.level,
      // Only a locked Gemini target pins a model; Auto leaves the provider's own
      // level → env → default chain intact.
      imageModel: target?.category === "image" ? geminiModelForTarget(target) : undefined,
      videoModel: target?.category === "video" ? geminiModelForTarget(target) : undefined,
    }),
    engine: "gemini",
    connectorKey: MEDIA_CONNECTOR_KEY,
    costTier: access.costTier,
  };
}
