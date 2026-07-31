import { GoogleGenAI } from "@google/genai";

import type { GeminiUsageMetadata } from "@/domain";

export type WebSearchCitation = {
  title: string;
  url: string;
  startIndex?: number;
  endIndex?: number;
};

export type GeminiWebSearchResult = {
  model: string;
  text: string;
  citations: WebSearchCitation[];
  searchQueries: string[];
  /**
   * Gemini's token accounting for this call, passed up UNFOLDED so the caller —
   * which is where org/workspace scope and the API-key source live — can meter
   * it (BSR-502). Null when the response carried no usage block.
   */
  usage: GeminiUsageMetadata | null;
};

/**
 * Minimal structural shape of the @google/genai client we depend on. Declaring it
 * here (rather than mocking a fictional surface) keeps tests honest: a fake injected
 * via `createClient` must mirror the REAL SDK — `models.generateContent` with a
 * Google Search grounding tool — the same call the live `GoogleGenAI` makes.
 */
type GenerateContentArgs = {
  model: string;
  contents: string;
  config?: { tools?: Array<{ googleSearch: Record<string, never> }> };
};

type GeminiWebSearchClient = {
  models: {
    generateContent: (args: GenerateContentArgs) => Promise<unknown>;
  };
};

type SearchWebWithGeminiInput = {
  query: string;
  context?: string;
  apiKey?: string;
  model?: string;
  createClient?: (apiKey: string) => GeminiWebSearchClient;
};

const DEFAULT_MODEL = "gemini-2.5-flash";

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength).trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** First candidate of a generateContent response (the only one we request). */
function firstCandidate(response: unknown): Record<string, unknown> {
  return asRecord(array(asRecord(response).candidates)[0]);
}

/** Grounding metadata attached to the first candidate (Google Search results). */
function groundingMetadata(response: unknown): Record<string, unknown> {
  return asRecord(firstCandidate(response).groundingMetadata);
}

/** Executed Google searches the model ran, from groundingMetadata.webSearchQueries. */
function extractSearchQueries(response: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of array(groundingMetadata(response).webSearchQueries)) {
    const query = cleanText(raw, 240);
    const key = query.toLowerCase();
    if (!query || seen.has(key)) continue;
    seen.add(key);
    out.push(query);
  }
  return out;
}

/** Model answer text — the `.text` convenience getter, falling back to candidate parts. */
function extractModelOutputText(response: unknown): string {
  const direct = cleanText(asRecord(response).text, 12000);
  if (direct) return direct;

  const parts = array(asRecord(firstCandidate(response).content).parts);
  const chunks = parts.map((part) => cleanText(asRecord(part).text, 12000)).filter(Boolean);
  return chunks.join("\n\n");
}

/**
 * Citations from groundingMetadata.groundingChunks[].web, enriched with the text
 * offsets in groundingSupports[] (a support points at chunk indices via
 * groundingChunkIndices and carries the segment start/end for the cited span).
 */
function extractCitations(response: unknown): WebSearchCitation[] {
  const meta = groundingMetadata(response);
  const chunks = array(meta.groundingChunks);

  const indexToSpan = new Map<number, { startIndex?: number; endIndex?: number }>();
  for (const support of array(meta.groundingSupports)) {
    const item = asRecord(support);
    const segment = asRecord(item.segment);
    const span = {
      startIndex: numberOrUndefined(segment.startIndex),
      endIndex: numberOrUndefined(segment.endIndex),
    };
    for (const rawIndex of array(item.groundingChunkIndices)) {
      const index = numberOrUndefined(rawIndex);
      if (index === undefined || indexToSpan.has(index)) continue;
      indexToSpan.set(index, span);
    }
  }

  const out: WebSearchCitation[] = [];
  const seen = new Set<string>();
  chunks.forEach((chunk, index) => {
    const web = asRecord(asRecord(chunk).web);
    const url = cleanText(web.uri, 1000);
    if (!url || seen.has(url)) return;
    seen.add(url);
    const span = indexToSpan.get(index);
    out.push({
      title: cleanText(web.title, 180) || url,
      url,
      startIndex: span?.startIndex,
      endIndex: span?.endIndex,
    });
  });
  return out;
}

/**
 * Gemini's token accounting for the call. Read defensively: this response is
 * parsed structurally throughout (see the `asRecord`/`array` helpers) because a
 * shape change must degrade, not throw. A missing block yields null, which the
 * ledger records as six explicit nulls rather than a fake zero-token call.
 */
function extractUsage(response: unknown): GeminiUsageMetadata | null {
  const meta = asRecord(response).usageMetadata;
  if (!meta || typeof meta !== "object") return null;
  const m = asRecord(meta);
  return {
    promptTokenCount: numberOrUndefined(m.promptTokenCount),
    candidatesTokenCount: numberOrUndefined(m.candidatesTokenCount),
    thoughtsTokenCount: numberOrUndefined(m.thoughtsTokenCount),
    toolUsePromptTokenCount: numberOrUndefined(m.toolUsePromptTokenCount),
    cachedContentTokenCount: numberOrUndefined(m.cachedContentTokenCount),
    totalTokenCount: numberOrUndefined(m.totalTokenCount),
  };
}

function buildInput(query: string, context?: string): string {
  const parts = [
    "Research this for Arc, a marketing operations agent. Return practical findings and cite sources.",
    "Focus on lead discovery, local market context, competitor signals, source-backed opportunities, or campaign research when relevant.",
    `Research request: ${query}`,
  ];
  const cleanContext = cleanText(context, 4000);
  if (cleanContext) parts.push(`Business/app context: ${cleanContext}`);
  return parts.join("\n\n");
}

/**
 * Read-only grounded web research via Gemini + Google Search. Returns the model's
 * answer with citations and the searches it ran. Throws on missing input/key or any
 * Gemini failure — the caller (the research route) maps a throw to HTTP 502.
 */
export async function searchWebWithGemini(input: SearchWebWithGeminiInput): Promise<GeminiWebSearchResult> {
  const query = cleanText(input.query, 1000);
  if (!query) throw new Error("query is required");

  const apiKey = input.apiKey ?? process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is required");

  const model = cleanText(input.model ?? process.env.GEMINI_WEB_SEARCH_MODEL, 120) || DEFAULT_MODEL;
  const client: GeminiWebSearchClient = input.createClient
    ? input.createClient(apiKey)
    : (new GoogleGenAI({ apiKey }) as unknown as GeminiWebSearchClient);

  const response = await client.models.generateContent({
    model,
    contents: buildInput(query, input.context),
    config: { tools: [{ googleSearch: {} }] },
  });

  const text = extractModelOutputText(response);
  if (!text) throw new Error("Gemini returned no research text");

  return {
    model,
    text,
    citations: extractCitations(response),
    searchQueries: extractSearchQueries(response),
    usage: extractUsage(response),
  };
}
