import { afterEach, describe, expect, it, vi } from "vitest";

import { ImageEditUnsupportedError } from "../types";
import { createHiggsfieldMediaProvider } from "../higgsfield";

afterEach(() => vi.restoreAllMocks());

/** An MCP tool response in the SSE shape this server actually answers with. */
function mcpResponse(payload: unknown) {
  return {
    status: 200,
    headers: new Headers({ "content-type": "text/event-stream" }),
    text: async () => `data: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: JSON.stringify(payload) }] } })}\n`,
  };
}

/**
 * Script the MCP endpoint call-by-call. Every tool call is TWO fetches
 * (initialize, then tools/call), so the script holds one payload per tool call
 * and the initialize handshakes are answered generically.
 */
function scriptMcp(payloads: unknown[], onFile?: () => { status: number; arrayBuffer: () => Promise<ArrayBuffer>; headers: Headers }) {
  const calls: Array<{ name?: string; args?: Record<string, unknown> }> = [];
  let next = 0;
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    if (!url.includes("mcp.higgsfield.ai")) {
      return onFile ? onFile() : { status: 200, headers: new Headers({ "content-type": "image/png" }), arrayBuffer: async () => new ArrayBuffer(4) };
    }
    const body = JSON.parse(init?.body ?? "{}") as { method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    if (body.method === "initialize") return { status: 200, headers: new Headers(), text: async () => "{}" };
    calls.push({ name: body.params?.name, args: body.params?.arguments });
    return mcpResponse(payloads[Math.min(next++, payloads.length - 1)]);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const COMPLETED = {
  jobs: [{ index: 0, job_id: "job-1", status: "completed", type: "image", model: "nano_banana_pro", result_url: "https://cdn.example/img.png" }],
  all_terminal: true,
};

describe("Higgsfield media provider", () => {
  it("submits with the picked model and returns the rendered bytes", async () => {
    const calls = scriptMcp([{ jobs: [{ index: 0, job_id: "job-1" }] }, COMPLETED]);
    const provider = createHiggsfieldMediaProvider("oat_x", { model: "nano_banana_pro" });

    const media = await provider.generateImage({ prompt: "a grey swatch", aspectRatio: "4:5" });

    expect(calls[0]?.name).toBe("generate_image_batch");
    const params = (calls[0]?.args as { requests: Array<{ params: Record<string, unknown> }> }).requests[0]!.params;
    // The whole point: the operator's pick is a PARAMETER on the call, not a
    // preference stated in a prompt and hoped for.
    expect(params.model).toBe("nano_banana_pro");
    expect(params.aspect_ratio).toBe("4:5");
    expect(media).toMatchObject({ model: "nano_banana_pro", jobId: "job-1", contentType: "image/png" });
  });

  it("never lets the server spend the customer's free-trial allowance on its own", async () => {
    // Omitting use_unlim returns `unlim_choice` — a question for a human. An
    // unattended server action has nobody to ask, so the generation would stall
    // on a prompt that never reaches a screen.
    const calls = scriptMcp([{ jobs: [{ index: 0, job_id: "job-1" }] }, COMPLETED]);
    await createHiggsfieldMediaProvider("oat_x", { model: "soul_v2" }).generateImage({ prompt: "x" });
    const params = (calls[0]?.args as { requests: Array<{ params: Record<string, unknown> }> }).requests[0]!.params;
    expect(params.use_unlim).toBe(false);
  });

  it("polls until the job is terminal instead of assuming the first answer", async () => {
    const running = { jobs: [{ index: 0, job_id: "job-1", status: "in_progress" }], all_terminal: false };
    const calls = scriptMcp([{ jobs: [{ index: 0, job_id: "job-1" }] }, running, COMPLETED]);
    const media = await createHiggsfieldMediaProvider("oat_x", { model: "soul_v2" }).generateImage({ prompt: "x" });
    expect(calls.filter((c) => c.name === "jobs_wait").length).toBeGreaterThanOrEqual(2);
    expect(media.jobId).toBe("job-1");
  });

  it("reports the server's own reason when a job fails", async () => {
    const failed = { jobs: [{ index: 0, job_id: "job-1", status: "failed", error: "content policy" }], all_terminal: true };
    scriptMcp([{ jobs: [{ index: 0, job_id: "job-1" }] }, failed]);
    await expect(createHiggsfieldMediaProvider("oat_x", { model: "soul_v2" }).generateImage({ prompt: "x" })).rejects.toThrow(/content policy/);
  });

  it("says a generation is still rendering rather than calling it failed", async () => {
    // The credits are spent either way and the result will land on Higgsfield's
    // side, so "failed" would be a false statement about the customer's money.
    vi.useFakeTimers();
    try {
      const running = { jobs: [{ index: 0, job_id: "job-1", status: "queued" }], all_terminal: false };
      scriptMcp([{ jobs: [{ index: 0, job_id: "job-1" }] }, running]);
      const promise = createHiggsfieldMediaProvider("oat_x", { model: "soul_v2" }).generateImage({ prompt: "x" });
      const assertion = expect(promise).rejects.toThrow(/still rendering/);
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands video back an opaque operation name the poll can use", async () => {
    const calls = scriptMcp([{ jobs: [{ index: 0, job_id: "vid-9" }] }]);
    const start = await createHiggsfieldMediaProvider("oat_x", { model: "kling3_0" }).startVideo({ prompt: "a van pulls in" });
    expect(calls[0]?.name).toBe("generate_video_batch");
    expect(start).toMatchObject({ operationName: "vid-9", jobId: "vid-9", model: "kling3_0" });
  });

  it("reports an unfinished video as running, not as an error", async () => {
    scriptMcp([{ jobs: [{ index: 0, job_id: "vid-9", status: "in_progress" }], all_terminal: false }]);
    const poll = await createHiggsfieldMediaProvider("oat_x", { model: "kling3_0" }).pollVideo("vid-9");
    expect(poll.status).toBe("running");
  });

  it("says which model cannot edit, using the error the callers already handle", async () => {
    // Higgsfield edits need a media_id from their own upload endpoint, which is
    // a flow that does not exist here yet. This is a capability answer, not a
    // failure, and the operator is told what to switch to.
    scriptMcp([]);
    await expect(
      createHiggsfieldMediaProvider("oat_x", { model: "soul_v2" }).editImage({ bytes: Buffer.from(""), contentType: "image/png", instruction: "x" }),
    ).rejects.toThrow(ImageEditUnsupportedError);
  });

  it("does not treat a transport failure as a rejected generation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 502, headers: new Headers(), text: async () => "bad gateway" })));
    await expect(createHiggsfieldMediaProvider("oat_x", { model: "soul_v2" }).generateImage({ prompt: "x" })).rejects.toThrow(/502/);
  });
});
