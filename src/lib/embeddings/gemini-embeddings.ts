import { GoogleGenAI } from "@google/genai";

import { estimateTokensFromChars } from "@/domain";
import { recordUsageEvent } from "@/lib/ai-usage/persistence";

export const EMBEDDING_DIMS = 768;

// Default to gemini-embedding-2 — the current GA embedding model. The old
// text-embedding-004 was SHUT DOWN 2026-01-14 (calls now fail), and
// gemini-embedding-001 retires 2026-07-14, so both are dead ends. Overridable
// via env for a redeploy-free switch (the Brain "Refresh memory" probe reports
// exactly which model/dimension works). outputDimensionality is pinned to
// EMBEDDING_DIMS on every call because the gemini-embedding-* models default to
// 3072 — the vector must match the pgvector(768) column.
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL?.trim() || "gemini-embedding-2";

/**
 * Who is paying for this embedding, and what for.
 *
 * REQUIRED, not optional — that is the whole point. The meter could not record
 * embeddings at all until BSR-502, and the reason it went unnoticed for weeks is
 * that nothing forced the question. A required parameter makes a new call site
 * impossible to add without deciding who it bills to; an optional one would let
 * the next one default quietly back to unmetered.
 *
 * No workspace here: callers pass an org and the usage ledger resolves the
 * workspace from it. (The Brain itself became workspace-scoped in BSR-715.)
 */
export type EmbedScope = {
  orgId: string;
  /** Free-form call-site label (`brain.recall`, `brain.node-write`, …). Lands in row metadata. */
  purpose: string;
};

/**
 * Embed text with Gemini (768-dim). Returns null when the key is missing, the
 * text is empty, the call fails, or the vector is the wrong size — so every
 * caller degrades gracefully (recall falls back to keyword/graph). For the
 * "why did embedding fail" question, use probeEmbedding() which surfaces the
 * real error instead of collapsing it to null.
 *
 * Meters every SUCCESSFUL call to the usage ledger (BSR-502). Metering is
 * best-effort and awaited-but-swallowed: a ledger failure must never break a
 * Brain write, and `recordUsageEvent` already reports its own failures.
 */
export async function embedText(text: string, scope: EmbedScope): Promise<number[] | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  const input = text?.trim();
  if (!key || !input) return null;
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const res = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: input,
      config: { outputDimensionality: EMBEDDING_DIMS },
    });
    const values = res?.embeddings?.[0]?.values;
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIMS) return null;
    await meterEmbedding(input, scope);
    return values as number[];
  } catch {
    return null;
  }
}

/**
 * Record one embedding call against the org's ledger.
 *
 * The token count is ESTIMATED. Gemini's developer API returns no usage figures
 * for `embedContent` — `billableCharacterCount` and the per-embedding
 * `statistics` block are Enterprise-only — so there is nothing measured to
 * record. What IS exact is the character count, which goes in `units`; the
 * estimate is derived from it and stamped `token_source: "estimated_from_chars"`
 * so it can never be mistaken for a measured number when someone reconciles
 * against a real invoice.
 */
async function meterEmbedding(input: string, scope: EmbedScope): Promise<void> {
  try {
    const chars = input.length;
    await recordUsageEvent({
      orgId: scope.orgId,
      // Null lets recordUsageEvent resolve the workspace from the org. It used
      // to mean "org-scoped by design", on the premise that the Brain had no
      // workspace — BSR-715 made knowledge_nodes.workspace_id NOT NULL, so that
      // premise is gone (BSR-716).
      workspaceId: null,
      service: "gemini_embedding",
      model: EMBEDDING_MODEL,
      inputTokens: estimateTokensFromChars(chars),
      units: chars,
      metadata: {
        purpose: scope.purpose,
        input_chars: chars,
        token_source: "estimated_from_chars",
        output_dims: EMBEDDING_DIMS,
      },
    });
  } catch {
    // Metering must never break the embedding it is measuring.
  }
}

export type EmbedProbeResult =
  | { ok: true; model: string; dims: number }
  | { ok: false; model: string; error: string };

/**
 * Connectivity probe used by the Brain "Refresh memory" flow. Unlike embedText,
 * it returns the ACTUAL failure — the Gemini error message/status, a wrong
 * dimensionality, or "no key" — so the operator sees why semantic recall is off
 * (bad key, model not enabled for this key, quota, billing) rather than a
 * generic "embedding call failed". Never used in the hot backfill path.
 */
export async function probeEmbedding(): Promise<EmbedProbeResult> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return { ok: false, model: EMBEDDING_MODEL, error: "GEMINI_API_KEY is not set in this runtime." };
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const res = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: "brain embedding connectivity probe",
      config: { outputDimensionality: EMBEDDING_DIMS },
    });
    const values = res?.embeddings?.[0]?.values;
    if (!Array.isArray(values)) return { ok: false, model: EMBEDDING_MODEL, error: `no embedding returned for model "${EMBEDDING_MODEL}"` };
    if (values.length !== EMBEDDING_DIMS) {
      return { ok: false, model: EMBEDDING_MODEL, error: `model "${EMBEDDING_MODEL}" returned ${values.length} dims, need ${EMBEDDING_DIMS}` };
    }
    return { ok: true, model: EMBEDDING_MODEL, dims: values.length };
  } catch (e) {
    return { ok: false, model: EMBEDDING_MODEL, error: describeGeminiError(e) };
  }
}

/** Pull the useful signal (HTTP status + message) out of a thrown Gemini/SDK error. */
function describeGeminiError(e: unknown): string {
  const anyE = (e ?? null) as { status?: number | string; code?: number | string; message?: string } | null;
  const status = anyE?.status ?? anyE?.code;
  const parts = [status != null ? `status ${status}` : null, anyE?.message ?? (e instanceof Error ? e.message : String(e))];
  return parts.filter(Boolean).join(" — ").slice(0, 400) || "unknown embedding error";
}
