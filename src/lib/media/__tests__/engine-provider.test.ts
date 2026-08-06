import { describe, expect, it, vi, afterEach } from "vitest";

/**
 * Does a Higgsfield TARGET actually reach the Higgsfield provider, on a real
 * credential, metered against the right connector? The unit tests prove each
 * piece; this proves they are joined. It is the join that has failed before.
 */
vi.mock("@/lib/connectors/read-model", () => ({
  listWorkspaceConnectors: vi.fn(async () => [{ key: "higgsfield", status: "connected" }]),
  resolveConnectorCredentialRef: vi.fn(async () => "ref-1"),
}));
vi.mock("@/lib/connectors/credentials", () => ({
  readConnectorCredential: vi.fn(async () => JSON.stringify({ kind: "api_key", token: "oat_live" })),
}));
vi.mock("@/lib/media/enablement", () => ({
  MEDIA_CONNECTOR_KEY: "gemini-media",
  resolveMediaGeneration: vi.fn(async () => ({ enabled: false, reason: "gemini is off" })),
}));

import { resolveGenerationTarget } from "@/domain";
import { resolveEngineProvider } from "@/lib/media/engine-provider";

afterEach(() => vi.restoreAllMocks());

const CONFIG = { defaults: { image: "higgsfield:soul_v2", video: "auto", audio: "auto" }, autoPick: false };

describe("target -> engine -> provider", () => {
  it("runs a Higgsfield pick on Higgsfield even when Gemini is off", async () => {
    const target = resolveGenerationTarget({
      category: "image",
      config: CONFIG,
      engines: { gemini: false, higgsfield: true },
    });
    expect(target).toMatchObject({ engine: "higgsfield", modelId: "soul_v2", locked: true });

    const engine = await resolveEngineProvider({ client: {} as never, workspaceId: "ws-1", target });
    expect(engine.ok).toBe(true);
    if (!engine.ok) return;
    expect(engine.engine).toBe("higgsfield");
    // Never the platform's gemini-media budget: these are the customer's credits.
    expect(engine.connectorKey).toBe("higgsfield");
    expect(engine.costTier).toBe("byo_key");

    // And the provider it built really calls Higgsfield with that model.
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}");
      if (body.method === "tools/call") calls.push(JSON.stringify(body.params));
      const payload = body.params?.name === "generate_image_batch"
        ? { jobs: [{ index: 0, job_id: "j1" }] }
        : { jobs: [{ index: 0, job_id: "j1", status: "completed", result_url: "https://cdn/x.png" }], all_terminal: true };
      if (url.includes("cdn")) return { status: 200, headers: new Headers({ "content-type": "image/png" }), arrayBuffer: async () => new ArrayBuffer(2) };
      if (body.method === "initialize") return { status: 200, headers: new Headers(), text: async () => "{}" };
      return { status: 200, headers: new Headers({ "content-type": "application/json" }), text: async () => JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: JSON.stringify(payload) }] } }) };
    }));
    await engine.provider.generateImage({ prompt: "a swatch" });
    expect(calls[0]).toContain('"model":"soul_v2"');
  });

  it("refuses with a reason when Higgsfield isn't connected, instead of quietly using Gemini", async () => {
    // Falling back would spend on a different engine than the operator chose and
    // stamp the wrong model onto the asset's provenance. Say no, and say why.
    const { listWorkspaceConnectors } = await import("@/lib/connectors/read-model");
    vi.mocked(listWorkspaceConnectors).mockResolvedValueOnce([] as never);

    const engine = await resolveEngineProvider({
      client: {} as never,
      workspaceId: "ws-1",
      target: { engine: "higgsfield", modelId: "soul_v2", key: "higgsfield:soul_v2", label: "Soul", provider: "Higgsfield", category: "image", source: "workspace", locked: true },
    });
    expect(engine.ok).toBe(false);
    if (engine.ok) return;
    // Copy checked by intent, not by vendor name: off-switch reasons must say
    // what to open rather than naming the engine's owner — the operator bought
    // Arc, not it (src/app/(app)/plumbing-vocabulary.test.ts).
    expect(engine.reason).toMatch(/Settings → Connections/);
    expect(engine.reason).not.toMatch(/Higgsfield|credential/i);
  });

  it("meters a Gemini target against the platform connector, not the customer's", async () => {
    const { resolveMediaGeneration } = await import("@/lib/media/enablement");
    vi.mocked(resolveMediaGeneration).mockResolvedValueOnce({ enabled: true, credential: "key", source: "platform", costTier: "metered" } as never);

    const engine = await resolveEngineProvider({ client: {} as never, workspaceId: "ws-1", target: null });
    expect(engine.ok).toBe(true);
    if (!engine.ok) return;
    expect(engine.connectorKey).toBe("gemini-media");
    expect(engine.costTier).toBe("metered");
  });
});
