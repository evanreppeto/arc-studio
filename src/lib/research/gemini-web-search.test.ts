import { describe, expect, it, vi } from "vitest";

import { searchWebWithGemini } from "./gemini-web-search";

/** Mirrors the real @google/genai grounded-response shape (models.generateContent + groundingMetadata). */
function groundedResponse() {
  return {
    text: "Found three Chicago property manager lead sources.",
    candidates: [
      {
        content: {
          parts: [{ text: "Found three Chicago property manager lead sources." }],
        },
        groundingMetadata: {
          webSearchQueries: ["Chicago property management associations"],
          groundingChunks: [{ web: { uri: "https://example.com/list", title: "Example list" } }],
          groundingSupports: [{ segment: { startIndex: 0, endIndex: 12 }, groundingChunkIndices: [0] }],
        },
      },
    ],
  };
}

type GenArgs = {
  model: string;
  contents: string;
  config?: { tools?: Array<{ googleSearch: Record<string, never> }> };
};

describe("searchWebWithGemini", () => {
  it("calls models.generateContent with the googleSearch grounding tool", async () => {
    const generateContent = vi.fn<(args: GenArgs) => Promise<unknown>>(() => Promise.resolve(groundedResponse()));

    await searchWebWithGemini({
      query: "Find property management lead sources in Chicago",
      apiKey: "test-key",
      model: "gemini-2.5-flash",
      createClient: () => ({ models: { generateContent } }),
    });

    expect(generateContent).toHaveBeenCalledTimes(1);
    const args = generateContent.mock.calls[0]![0];
    expect(args.model).toBe("gemini-2.5-flash");
    expect(args.config?.tools).toEqual([{ googleSearch: {} }]);
    expect(typeof args.contents).toBe("string");
  });

  it("returns grounded text, citations, and executed search queries", async () => {
    const result = await searchWebWithGemini({
      query: "Find property management lead sources in Chicago",
      apiKey: "test-key",
      model: "gemini-2.5-flash",
      createClient: () => ({ models: { generateContent: async () => groundedResponse() } }),
    });

    expect(result).toEqual({
      model: "gemini-2.5-flash",
      text: "Found three Chicago property manager lead sources.",
      citations: [
        {
          title: "Example list",
          url: "https://example.com/list",
          startIndex: 0,
          endIndex: 12,
        },
      ],
      searchQueries: ["Chicago property management associations"],
      // The fixture carries no usageMetadata; null distinguishes that from a
      // call that genuinely used no tokens (BSR-502).
      usage: null,
    });
  });

  it("surfaces Gemini's token accounting for the ledger (BSR-502)", async () => {
    // Grounded search is exactly where tool-use prompt tokens dominate, so the
    // raw fields have to reach the caller unfolded — the metering layer decides
    // how they map onto the ledger's two columns.
    const response = {
      ...groundedResponse(),
      usageMetadata: {
        promptTokenCount: 1_000,
        toolUsePromptTokenCount: 30_000,
        candidatesTokenCount: 800,
        thoughtsTokenCount: 2_200,
        totalTokenCount: 34_000,
      },
    };
    const result = await searchWebWithGemini({
      query: "Find property management lead sources in Chicago",
      apiKey: "test-key",
      model: "gemini-2.5-flash",
      createClient: () => ({ models: { generateContent: async () => response } }),
    });

    expect(result.usage).toEqual({
      promptTokenCount: 1_000,
      toolUsePromptTokenCount: 30_000,
      candidatesTokenCount: 800,
      thoughtsTokenCount: 2_200,
      cachedContentTokenCount: undefined,
      totalTokenCount: 34_000,
    });
  });

  it("falls back to candidate parts when the top-level text getter is empty", async () => {
    const result = await searchWebWithGemini({
      query: "anything",
      apiKey: "test-key",
      createClient: () => ({
        models: {
          generateContent: async () => ({
            candidates: [{ content: { parts: [{ text: "Body from parts." }] } }],
          }),
        },
      }),
    });

    expect(result.text).toBe("Body from parts.");
    expect(result.citations).toEqual([]);
    expect(result.searchQueries).toEqual([]);
  });

  it("rejects empty queries before calling Gemini", async () => {
    const generateContent = vi.fn();

    await expect(
      searchWebWithGemini({
        query: " ",
        apiKey: "test-key",
        createClient: () => ({ models: { generateContent } }),
      }),
    ).rejects.toThrow("query is required");

    expect(generateContent).not.toHaveBeenCalled();
  });
});
