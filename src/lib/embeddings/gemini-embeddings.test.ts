import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { embedContent } = vi.hoisted(() => ({ embedContent: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function () {
    return { models: { embedContent } };
  }),
}));
vi.mock("@/lib/ai-usage/persistence", () => ({ recordUsageEvent: vi.fn() }));

import { recordUsageEvent } from "@/lib/ai-usage/persistence";

import { embedText, probeEmbedding, EMBEDDING_DIMS } from "./gemini-embeddings";

const metered = vi.mocked(recordUsageEvent);
const SCOPE = { orgId: "org-1", purpose: "test" };

const KEY = process.env.GEMINI_API_KEY;
beforeEach(() => { embedContent.mockReset(); metered.mockReset(); process.env.GEMINI_API_KEY = "k"; });
afterEach(() => { if (KEY === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = KEY; });

const vec = (n: number) => Array.from({ length: n }, (_, i) => i / n);

describe("embedText", () => {
  it("returns the embedding vector on success", async () => {
    embedContent.mockResolvedValue({ embeddings: [{ values: vec(EMBEDDING_DIMS) }] });
    const out = await embedText("homeowners like fast response", SCOPE);
    expect(out).toHaveLength(EMBEDDING_DIMS);
  });
  it("returns null when the key is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    expect(await embedText("x", SCOPE)).toBeNull();
    expect(embedContent).not.toHaveBeenCalled();
  });
  it("returns null on empty text", async () => {
    expect(await embedText("   ", SCOPE)).toBeNull();
    expect(embedContent).not.toHaveBeenCalled();
  });
  it("returns null when the API throws", async () => {
    embedContent.mockRejectedValue(new Error("boom"));
    expect(await embedText("x", SCOPE)).toBeNull();
  });
  it("returns null on a wrong-sized vector", async () => {
    embedContent.mockResolvedValue({ embeddings: [{ values: vec(10) }] });
    expect(await embedText("x", SCOPE)).toBeNull();
  });
});

describe("metering the embedding path (BSR-502)", () => {
  // Finding 1: the meter could not record embeddings AT ALL — the service enum
  // had no value for them — while every Brain write embedded. These lock down
  // that a successful embedding now reaches the ledger, and that the paths which
  // never called Gemini do NOT bill for a call that didn't happen.
  it("records a usage event with exact chars and an estimated token count", async () => {
    embedContent.mockResolvedValue({ embeddings: [{ values: vec(EMBEDDING_DIMS) }] });
    await embedText("homeowners like fast response", { orgId: "org-7", purpose: "brain.recall" });

    expect(metered).toHaveBeenCalledTimes(1);
    const arg = metered.mock.calls[0][0];
    expect(arg.service).toBe("gemini_embedding");
    expect(arg.orgId).toBe("org-7");
    // Org-scoped by design — the Brain has no workspace. A resolved default here
    // would be a fabricated attribution, not a recovered one.
    expect(arg.workspaceId).toBeNull();
    // 29 characters is measured; the token figure is derived from it and must be
    // labelled as such so nobody reconciles an invoice against an estimate.
    expect(arg.units).toBe(29);
    expect(arg.inputTokens).toBe(8);
    expect(arg.metadata).toMatchObject({ purpose: "brain.recall", input_chars: 29, token_source: "estimated_from_chars" });
  });

  it("does not meter when no API call was made", async () => {
    delete process.env.GEMINI_API_KEY;
    await embedText("x", SCOPE);
    expect(metered).not.toHaveBeenCalled();

    process.env.GEMINI_API_KEY = "k";
    await embedText("   ", SCOPE);
    expect(metered).not.toHaveBeenCalled();
  });

  it("does not meter a failed or wrong-sized embedding", async () => {
    embedContent.mockRejectedValue(new Error("boom"));
    await embedText("x", SCOPE);
    embedContent.mockResolvedValue({ embeddings: [{ values: vec(10) }] });
    await embedText("x", SCOPE);
    expect(metered).not.toHaveBeenCalled();
  });

  it("still returns the vector when the ledger write throws", async () => {
    // Metering must never break the thing it measures.
    embedContent.mockResolvedValue({ embeddings: [{ values: vec(EMBEDDING_DIMS) }] });
    metered.mockRejectedValueOnce(new Error("ledger down"));
    expect(await embedText("x", SCOPE)).toHaveLength(EMBEDDING_DIMS);
  });
});

describe("probeEmbedding", () => {
  it("reports ok with the dimension on success", async () => {
    embedContent.mockResolvedValue({ embeddings: [{ values: vec(EMBEDDING_DIMS) }] });
    expect(await probeEmbedding()).toEqual({ ok: true, model: expect.any(String), dims: EMBEDDING_DIMS });
  });
  it("surfaces the real error (status + message) instead of collapsing to null", async () => {
    embedContent.mockRejectedValue(Object.assign(new Error("permission denied"), { status: 403 }));
    const r = await probeEmbedding();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("status 403");
    if (!r.ok) expect(r.error).toContain("permission denied");
  });
  it("flags a wrong dimensionality distinctly from a failure", async () => {
    embedContent.mockResolvedValue({ embeddings: [{ values: vec(3072) }] });
    const r = await probeEmbedding();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("3072");
  });
  it("reports the missing key without calling the API", async () => {
    delete process.env.GEMINI_API_KEY;
    const r = await probeEmbedding();
    expect(r.ok).toBe(false);
    expect(embedContent).not.toHaveBeenCalled();
  });
});
