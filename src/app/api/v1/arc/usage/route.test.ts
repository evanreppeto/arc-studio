import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  arcGuard: vi.fn(),
  recordUsageEvent: vi.fn(),
}));

vi.mock("@/app/api/v1/arc/_lib/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/api/v1/arc/_lib/http")>();
  return { ...actual, arcGuard: mocks.arcGuard };
});
vi.mock("@/lib/ai-usage/persistence", () => ({ recordUsageEvent: mocks.recordUsageEvent }));

import { POST } from "./route";

const SCOPE = { orgId: "org-1", workspaceId: "ws-1" };

function post(body: unknown) {
  return new Request("http://localhost/api/v1/arc/usage", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.arcGuard.mockResolvedValue({ ok: true, scope: SCOPE });
  mocks.recordUsageEvent.mockResolvedValue({ recorded: true, id: "evt-1", costCents: 3 });
});

describe("POST /api/v1/arc/usage", () => {
  it("takes org and workspace from the bearer scope, never the body", async () => {
    // The body deliberately asserts a different tenant. A runner must not be able
    // to bill someone else's workspace by saying so.
    await POST(post({ model: "claude-opus-4-8", output_tokens: 100, org_id: "org-EVIL", workspace_id: "ws-EVIL" }));

    const arg = mocks.recordUsageEvent.mock.calls[0][0];
    expect(arg.orgId).toBe("org-1");
    expect(arg.workspaceId).toBe("ws-1");
  });

  it("rejects a request with no model", async () => {
    const res = await POST(post({ output_tokens: 100 }));
    expect(res.status).toBe(400);
    expect(mocks.recordUsageEvent).not.toHaveBeenCalled();
  });

  it("persists the prompt-cache token counts to row metadata (BSR-502)", async () => {
    // Finding 3: production shows 620 input tokens across 69 turns — an average
    // of nine — because the SDK's input_tokens excludes cached tokens. Nothing
    // read the cache_* fields, so the undercount stayed a hypothesis. This is
    // the assertion that makes it measurable.
    await POST(
      post({
        model: "claude-opus-4-8",
        input_tokens: 9,
        output_tokens: 5000,
        usage_detail: {
          cache_read_input_tokens: 41000,
          cache_creation_input_tokens: 1200,
          usage_keys: ["cache_creation_input_tokens", "cache_read_input_tokens", "input_tokens", "output_tokens"],
        },
      }),
    );

    const arg = mocks.recordUsageEvent.mock.calls[0][0];
    // input_tokens keeps meaning exactly what the SDK reported. Folding cache
    // tokens into it would silently redefine a column mid-ledger and make the
    // whole series uncomparable.
    expect(arg.inputTokens).toBe(9);
    expect(arg.metadata.usage_detail).toMatchObject({
      cache_read_input_tokens: 41000,
      cache_creation_input_tokens: 1200,
    });
  });

  it("ignores a non-object usage_detail rather than writing junk to metadata", async () => {
    await POST(post({ model: "claude-opus-4-8", output_tokens: 1, usage_detail: "not-an-object" }));
    expect(mocks.recordUsageEvent.mock.calls[0][0].metadata).not.toHaveProperty("usage_detail");
  });

  it("drops an oversized usage_detail entirely rather than truncating it", async () => {
    // This writes caller-supplied JSON into a JSONB column on every turn, so the
    // bound is enforced here as well as in the runner. Dropped, not truncated —
    // half a payload would read as a complete one.
    await POST(
      post({
        model: "claude-opus-4-8",
        output_tokens: 1,
        usage_detail: { blob: "x".repeat(20_000) },
      }),
    );
    expect(mocks.recordUsageEvent.mock.calls[0][0].metadata).not.toHaveProperty("usage_detail");
  });

  it("keeps a realistic payload including the per-TTL cache split", async () => {
    await POST(
      post({
        model: "claude-opus-4-8",
        output_tokens: 1051,
        usage_detail: {
          cache_read_input_tokens: 92_215,
          cache_creation: { ephemeral_5m_input_tokens: 12_707, ephemeral_1h_input_tokens: 0 },
          service_tier: "standard",
          usage_keys: ["cache_creation", "cache_read_input_tokens", "service_tier"],
        },
      }),
    );
    const detail = mocks.recordUsageEvent.mock.calls[0][0].metadata.usage_detail;
    expect(detail.cache_creation).toEqual({ ephemeral_5m_input_tokens: 12_707, ephemeral_1h_input_tokens: 0 });
    expect(detail.service_tier).toBe("standard");
  });

  it("acks with 202 rather than erroring when the ledger skips the write", async () => {
    // A retry-storm from the runner would be worse than a missed row, and the
    // ledger reports its own failures.
    mocks.recordUsageEvent.mockResolvedValue({ recorded: false, reason: "not_configured" });
    const res = await POST(post({ model: "claude-opus-4-8", output_tokens: 1 }));
    expect(res.status).toBe(202);
  });
});
