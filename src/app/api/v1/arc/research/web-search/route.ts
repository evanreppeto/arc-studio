import { INVALID_JSON, arcGuard, fail, ok, readJson } from "@/app/api/v1/arc/_lib/http";
import { readConnectorCredential } from "@/lib/connectors/credentials";
import { resolveConnectorCredentialRef } from "@/lib/connectors/read-model";
import { meterGeminiTextUsage } from "@/lib/ai-usage/gemini-text";
import { searchWebWithGemini } from "@/lib/research/gemini-web-search";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength).trim() : "";
}

/**
 * Workspace's own Gemini key (Vault) if connected + enabled; else the global env var.
 *
 * Returns WHICH of the two answered, because the two are different payers: a call
 * on a workspace's own key is billed to that customer by Google directly and is
 * not our spend. The usage ledger records the distinction (BSR-502) — without it,
 * no later query could separate our cost from theirs.
 */
async function resolveGeminiKey(
  workspaceId: string,
): Promise<{ key: string; source: "workspace_vault" | "platform_env" } | null> {
  const client = getSupabaseAdminClient();
  const ref = await resolveConnectorCredentialRef(client, workspaceId, "gemini-research").catch(() => null);
  if (ref) {
    const key = await readConnectorCredential(client, ref).catch(() => null);
    if (key) return { key, source: "workspace_vault" };
  }
  const envKey = process.env.GEMINI_API_KEY?.trim();
  return envKey ? { key: envKey, source: "platform_env" } : null;
}

/**
 * Read-only external research for Arc. Uses Gemini Grounding with Google Search
 * and returns citations; it does not create leads, opportunities, or outbound work.
 */
export async function POST(request: Request) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;

  const credential = await resolveGeminiKey(allowed.scope.workspaceId);
  if (!credential) {
    return fail(
      "not_configured",
      "Gemini web search isn't enabled. Connect a Gemini key in Settings → Connectors, or set GEMINI_API_KEY.",
      503,
    );
  }

  const payload = await readJson(request);
  if (payload === INVALID_JSON || typeof payload !== "object" || payload === null) {
    return fail("rejected", "Request body must be valid JSON.", 400);
  }

  const body = payload as Record<string, unknown>;
  const query = cleanText(body.query, 1000);
  const context = cleanText(body.context, 4000) || undefined;
  if (!query) return fail("rejected", "query is required.", 400);

  try {
    const { usage, ...research } = await searchWebWithGemini({
      query,
      context,
      apiKey: credential.key,
      model: process.env.GEMINI_WEB_SEARCH_MODEL?.trim() || undefined,
    });
    // Metered here rather than inside searchWebWithGemini: this is where tenant
    // scope and the key source exist. Awaited but non-fatal — a ledger problem
    // must not turn a successful research call into a 502.
    await meterGeminiTextUsage(research.model, usage, {
      orgId: allowed.scope.orgId,
      workspaceId: allowed.scope.workspaceId,
      purpose: "arc.web-search",
      keySource: credential.source,
    });
    return ok({ research });
  } catch (error) {
    return fail("failed", error instanceof Error ? error.message : "Gemini web search failed.", 502);
  }
}
