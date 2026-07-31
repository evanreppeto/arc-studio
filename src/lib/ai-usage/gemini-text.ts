import { foldGeminiTextUsage, type GeminiUsageMetadata } from "@/domain";

import { recordUsageEvent } from "./persistence";

/**
 * Who pays for this Gemini call.
 *
 * `keySource` is load-bearing, not decoration. The research route prefers the
 * WORKSPACE'S OWN Gemini key from the Vault and only falls back to the platform
 * `GEMINI_API_KEY`. Those are two different payers: a call on a workspace key is
 * billed to that customer by Google directly and is not our cost at all.
 * Recording both into one undifferentiated total would conflate our spend with
 * theirs, and no later query could separate them — the information simply would
 * not be in the row.
 */
export type GeminiTextScope = {
  orgId: string;
  /** Null for org-scoped callers (brand knowledge sync has no workspace). */
  workspaceId: string | null;
  /** Call-site label (`arc.web-search`, `brand.knowledge-extract`). */
  purpose: string;
  keySource: "workspace_vault" | "platform_env";
  actorUser?: string | null;
};

/**
 * Record one Gemini text generation against the ledger.
 *
 * Best-effort and never throws: metering must not break the call it measures,
 * and `recordUsageEvent` already reports its own failures. Token counts here are
 * MEASURED (Gemini returns a real usage block on generateContent), unlike the
 * embedding path where they have to be estimated from characters.
 */
export async function meterGeminiTextUsage(
  model: string,
  usage: GeminiUsageMetadata | null | undefined,
  scope: GeminiTextScope,
): Promise<void> {
  try {
    const folded = foldGeminiTextUsage(usage);
    await recordUsageEvent({
      orgId: scope.orgId,
      workspaceId: scope.workspaceId,
      service: "gemini_text",
      model,
      actorUser: scope.actorUser ?? null,
      inputTokens: folded.inputTokens,
      outputTokens: folded.outputTokens,
      metadata: {
        purpose: scope.purpose,
        key_source: scope.keySource,
        token_source: "measured",
        // The fold is lossy by construction — four fields collapse into two
        // columns. Keeping the raw breakdown means the arithmetic can be
        // re-derived, and means a `usage` block that arrives EMPTY is visible as
        // six nulls rather than looking like a genuine zero-token call.
        gemini_usage: folded.breakdown,
      },
    });
  } catch {
    // Metering must never break the generation it is measuring.
  }
}
