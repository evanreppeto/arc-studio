import { type SupabaseClient } from "@supabase/supabase-js";

import { type ConnectorCostTier, type ConnectorCredentialSource } from "@/domain";
import { resolveConnectorCredential } from "@/lib/connectors/credential-resolution";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

export const MEDIA_CONNECTOR_KEY = "gemini-media";

/**
 * Whether — and on whose credential — media generation runs for a workspace.
 *
 * The per-workspace connector replaces the global `ARC_MEDIA_ENABLED` switch:
 * enable "Media Generation" in Settings → Connections and it runs on platform
 * credits (metered, spend-capped) or the workspace's own Gemini key (their
 * billing, unmetered) via the shared dual-credential resolution.
 *
 * LEGACY: `ARC_MEDIA_ENABLED=1` + `GEMINI_API_KEY` still enables generation
 * deployment-wide, exactly as before, so nothing regresses for a deployment
 * that armed the old flag. It reports as the platform source (that's whose
 * key it is) and is metered the same way.
 */
export type MediaGenerationAccess =
  | { enabled: false; reason: string }
  | { enabled: true; credential: string; source: Exclude<ConnectorCredentialSource, "none">; costTier: ConnectorCostTier };

/**
 * Rendered verbatim on the Studio screen, so it is CUSTOMER copy and obeys the
 * customer vocabulary (DESIGN.md §4.2) — no vendor name, no billing words, no
 * architecture nouns.
 *
 * It did not, and the reason is worth keeping: `plumbing-vocabulary.test.ts`
 * guards exactly this leak, but it walks `src/app/(app)/**\/*.tsx`. This string
 * is authored in `lib/` and handed to the screen as a prop, so it went past the
 * guard and put "platform credits" and "your own Gemini API key" in the corner
 * of the canvas — the two things §4.2 names first.
 */
const OFF_REASON =
  "Arc can’t make images or video for this workspace yet. Switch it on in Settings → Connections.";

function legacyEnvAccess(): MediaGenerationAccess | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (process.env.ARC_MEDIA_ENABLED === "1" && key) {
    return { enabled: true, credential: key, source: "platform", costTier: "metered" };
  }
  return null;
}

export async function resolveMediaGeneration(
  workspaceId: string | null | undefined,
  client?: SupabaseClient,
): Promise<MediaGenerationAccess> {
  const legacy = legacyEnvAccess();

  if (!workspaceId || !isSupabaseAdminConfigured()) {
    return legacy ?? { enabled: false, reason: OFF_REASON };
  }

  try {
    const db = client ?? getSupabaseAdminClient();
    const { data } = await db
      .from("workspace_connectors")
      .select("enabled")
      .eq("workspace_id", workspaceId)
      .eq("connector_key", MEDIA_CONNECTOR_KEY)
      .maybeSingle<{ enabled: boolean }>();

    if (!data?.enabled) {
      return legacy ?? { enabled: false, reason: OFF_REASON };
    }

    const resolved = await resolveConnectorCredential({ connectorKey: MEDIA_CONNECTOR_KEY, workspaceId }, db);
    if (resolved.source === "none" || !resolved.credential) {
      return (
        legacy ?? {
          enabled: false,
          reason: resolved.reason ?? "Image and video generation is on, but isn’t finished setting up. Open Settings → Connections to finish it.",
        }
      );
    }
    return { enabled: true, credential: resolved.credential, source: resolved.source, costTier: resolved.costTier };
  } catch {
    // A connector-row read failure must not take generation down harder than
    // the legacy path would — degrade to the env flag, else an honest off.
    return legacy ?? { enabled: false, reason: OFF_REASON };
  }
}
