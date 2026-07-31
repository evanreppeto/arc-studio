import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ recordUsageEvent: vi.fn() }));
vi.mock("./persistence", () => ({ recordUsageEvent: mocks.recordUsageEvent }));

import { meterGeminiTextUsage } from "./gemini-text";

const USAGE = {
  promptTokenCount: 1_000,
  toolUsePromptTokenCount: 30_000,
  candidatesTokenCount: 800,
  thoughtsTokenCount: 2_200,
  totalTokenCount: 34_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordUsageEvent.mockResolvedValue({ recorded: true, id: "evt-1", costCents: 0 });
});

describe("meterGeminiTextUsage (BSR-502)", () => {
  it("records measured tokens with the full breakdown preserved", async () => {
    await meterGeminiTextUsage("gemini-2.5-flash", USAGE, {
      orgId: "org-1",
      workspaceId: "ws-1",
      purpose: "arc.web-search",
      keySource: "platform_env",
    });

    const arg = mocks.recordUsageEvent.mock.calls[0][0];
    expect(arg.service).toBe("gemini_text");
    expect(arg.inputTokens).toBe(31_000);
    expect(arg.outputTokens).toBe(3_000);
    // Measured, not estimated — the opposite of the embedding path, and the
    // reason a backfill here will be exact rather than approximate.
    expect(arg.metadata.token_source).toBe("measured");
    expect(arg.metadata.gemini_usage).toMatchObject({ tool_use_prompt_token_count: 30_000, thoughts_token_count: 2_200 });
  });

  it("records WHICH key paid, because the two are different payers", async () => {
    // A call on the workspace's own Vault key is billed to that customer by
    // Google directly and is not our spend. If the row doesn't say which key ran
    // it, no later query can separate our cost from theirs — the information is
    // simply not there to recover.
    await meterGeminiTextUsage("gemini-2.5-flash", USAGE, {
      orgId: "org-1",
      workspaceId: "ws-1",
      purpose: "arc.web-search",
      keySource: "workspace_vault",
    });
    expect(mocks.recordUsageEvent.mock.calls[0][0].metadata.key_source).toBe("workspace_vault");
  });

  it("carries a null workspace for org-scoped callers", async () => {
    await meterGeminiTextUsage("gemini-2.5-flash-lite", USAGE, {
      orgId: "org-1",
      workspaceId: null,
      purpose: "brand.knowledge-extract",
      keySource: "platform_env",
    });
    expect(mocks.recordUsageEvent.mock.calls[0][0].workspaceId).toBeNull();
  });

  it("never throws when the ledger write fails", async () => {
    mocks.recordUsageEvent.mockRejectedValue(new Error("ledger down"));
    await expect(
      meterGeminiTextUsage("gemini-2.5-flash", USAGE, {
        orgId: "org-1",
        workspaceId: "ws-1",
        purpose: "arc.web-search",
        keySource: "platform_env",
      }),
    ).resolves.toBeUndefined();
  });
});
