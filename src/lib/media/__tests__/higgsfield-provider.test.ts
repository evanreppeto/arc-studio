import { afterEach, describe, expect, it, vi } from "vitest";

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

/** Answer by tool name — reference-media flows fire two lookups concurrently,
 *  so a positional script would be a race. */
function scriptByName(map: Record<string, unknown>) {
  const calls: Array<{ name?: string; args?: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
    if (!url.includes("mcp.higgsfield.ai")) {
      return { status: 200, headers: new Headers({ "content-type": "image/png" }), arrayBuffer: async () => new ArrayBuffer(4) };
    }
    const body = JSON.parse(init?.body ?? "{}") as { method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    if (body.method === "initialize") return { status: 200, headers: new Headers(), text: async () => "{}" };
    const name = body.params?.name ?? "";
    calls.push({ name, args: body.params?.arguments });
    return mcpResponse(map[name] ?? {});
  }));
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

  it("records the model the server ACTUALLY ran, not the one we asked for", async () => {
    // Observed live 2026-08-06: a submit for `nano_banana_pro` came back
    // reporting `nano_banana_2`. Provenance has to say what rendered the asset,
    // or an approval card credits a model that never touched it.
    scriptMcp([
      { jobs: [{ index: 0, job_id: "job-1", status: "pending" }] },
      { jobs: [{ index: 0, job_id: "job-1", status: "completed", model: "nano_banana_2", result_url: "https://cdn.example/i.png" }], all_terminal: true },
    ]);
    const media = await createHiggsfieldMediaProvider("oat_x", { model: "nano_banana_pro" }).generateImage({ prompt: "x" });
    expect(media.model).toBe("nano_banana_2");
  });

  it("waits long enough for a real render", async () => {
    // MEASURED: a real nano_banana_pro image took ~75s. The first version of
    // this provider gave up at 40s and would have abandoned every one — the
    // mocks answered instantly, so nothing caught it until a live run did.
    vi.useFakeTimers();
    try {
      const pending = { jobs: [{ index: 0, job_id: "job-1", status: "in_progress" }], all_terminal: false, poll_after_seconds: 10 };
      const done = { jobs: [{ index: 0, job_id: "job-1", status: "completed", result_url: "https://cdn.example/i.png" }], all_terminal: true };
      scriptMcp([{ jobs: [{ index: 0, job_id: "job-1", status: "pending" }] }, pending, pending, pending, done]);
      const promise = createHiggsfieldMediaProvider("oat_x", { model: "soul_v2" }).generateImage({ prompt: "x" });
      await vi.advanceTimersByTimeAsync(45_000);
      await expect(promise).resolves.toMatchObject({ jobId: "job-1" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the job when it gives up, because the credits are already spent", async () => {
    vi.useFakeTimers();
    try {
      scriptMcp([
        { jobs: [{ index: 0, job_id: "job-slow", status: "pending" }] },
        { jobs: [{ index: 0, job_id: "job-slow", status: "in_progress" }], all_terminal: false, poll_after_seconds: 10 },
      ]);
      const promise = createHiggsfieldMediaProvider("oat_x", { model: "soul_v2", imageBudgetMs: 5_000 }).generateImage({ prompt: "x" });
      const assertion = expect(promise).rejects.toThrow(/job-slow/);
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
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
      const promise = createHiggsfieldMediaProvider("oat_x", { model: "soul_v2", imageBudgetMs: 5_000 }).generateImage({ prompt: "x" });
      const assertion = expect(promise).rejects.toThrow(/still rendering/);
      await vi.advanceTimersByTimeAsync(30_000);
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

  it("refuses an edit with no public URL, naming the reason", async () => {
    // Higgsfield mints a media_id by fetching a URL itself; bytes alone cannot
    // become one. A caller that sends only bytes gets told that, not a generic
    // failure it would retry.
    scriptMcp([]);
    await expect(
      createHiggsfieldMediaProvider("oat_x", { model: "soul_v2" }).editImage({ bytes: Buffer.from(""), contentType: "image/png", instruction: "x" }),
    ).rejects.toThrow(/public URL/);
  });

  it("does not treat a transport failure as a rejected generation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 502, headers: new Headers(), text: async () => "bad gateway" })));
    await expect(createHiggsfieldMediaProvider("oat_x", { model: "soul_v2" }).generateImage({ prompt: "x" })).rejects.toThrow(/502/);
  });
});

describe("start-then-poll image", () => {
  it("hands back an operation name instead of blocking on a 75s render", async () => {
    const calls = scriptMcp([{ jobs: [{ index: 0, job_id: "img-7", status: "pending" }] }]);
    const start = await createHiggsfieldMediaProvider("oat_x", { model: "soul_v2" }).startImage!({ prompt: "x", aspectRatio: "1:1" });
    expect(calls[0]?.name).toBe("generate_image_batch");
    expect(start).toMatchObject({ operationName: "img-7", jobId: "img-7", model: "soul_v2" });
  });

  it("reports an unfinished image as running rather than an error", async () => {
    scriptMcp([{ jobs: [{ index: 0, job_id: "img-7", status: "in_progress" }], all_terminal: false }]);
    const poll = await createHiggsfieldMediaProvider("oat_x", { model: "soul_v2" }).pollImage!("img-7");
    expect(poll.status).toBe("running");
  });

  it("returns the bytes and the model that actually ran once it finishes", async () => {
    scriptMcp([{ jobs: [{ index: 0, job_id: "img-7", status: "completed", model: "nano_banana_2", result_url: "https://cdn.example/i.png" }], all_terminal: true }]);
    const poll = await createHiggsfieldMediaProvider("oat_x", { model: "nano_banana_pro" }).pollImage!("img-7");
    expect(poll).toMatchObject({ status: "done", model: "nano_banana_2", jobId: "img-7", contentType: "image/png" });
  });

  it("surfaces a failed job's own reason on the poll", async () => {
    scriptMcp([{ jobs: [{ index: 0, job_id: "img-7", status: "failed", error: "content policy" }], all_terminal: true }]);
    await expect(createHiggsfieldMediaProvider("oat_x", { model: "soul_v2" }).pollImage!("img-7")).rejects.toThrow(/content policy/);
  });

  it("is absent on Gemini, which is how a caller knows to block instead", async () => {
    const { createGeminiMediaProvider } = await import("../gemini");
    expect(createGeminiMediaProvider("key").startImage).toBeUndefined();
  });
});

describe("reference media (media_import_url)", () => {
  const IMPORTED = { media_id: "media-42", type: "image", content_type: "image/png" };

  it("imports the picture and sends the media_id, never the URL", async () => {
    // `medias[].value` must be a media_id — Higgsfield rejects an https URL
    // outright, which is exactly why editing was impossible before this.
    const calls = scriptByName({
      media_import_url: IMPORTED,
      models_explore: { medias: [{ roles: ["image"] }] },
      generate_image_batch: { jobs: [{ index: 0, job_id: "e1", status: "pending" }] },
      jobs_wait: { jobs: [{ index: 0, job_id: "e1", status: "completed", result_url: "https://cdn/x.png" }], all_terminal: true },
    });

    await createHiggsfieldMediaProvider("oat_x", { model: "flux_kontext" }).editImage({
      bytes: Buffer.from(""),
      contentType: "image/png",
      instruction: "put our logo on the van door",
      sourceUrl: "https://cdn.example/van.png",
    });

    expect(calls.find((c) => c.name === "media_import_url")?.args).toMatchObject({ url: "https://cdn.example/van.png" });
    const submit = calls.find((c) => c.name === "generate_image_batch")!.args as { requests: Array<{ params: Record<string, unknown> }> };
    expect(submit.requests[0]!.params.medias).toEqual([{ role: "image", value: "media-42" }]);
    expect(submit.requests[0]!.params.prompt).toBe("put our logo on the van door");
  });

  it("uses the role the model declares, not a guessed one", async () => {
    // VERIFIED live: kling3_0_turbo declares only `start_image`, while the image
    // models declare `image`. Sending the wrong one leans on the server's
    // "auto-coerce when unambiguous", which is not a guarantee.
    const calls = scriptByName({
      media_import_url: IMPORTED,
      models_explore: { medias: [{ roles: ["start_image"] }] },
      generate_video_batch: { jobs: [{ index: 0, job_id: "v1", status: "pending" }] },
    });

    await createHiggsfieldMediaProvider("oat_x", { model: "kling3_0_turbo" }).startVideo({
      prompt: "a slow push in",
      image: { bytes: Buffer.from(""), contentType: "image/png", url: "https://cdn.example/still.png" },
    });

    const submit = calls.find((c) => c.name === "generate_video_batch")!.args as { requests: Array<{ params: Record<string, unknown> }> };
    expect(submit.requests[0]!.params.medias).toEqual([{ role: "start_image", value: "media-42" }]);
  });

  it("sends no medias at all when there is no reference", async () => {
    const calls = scriptByName({ generate_video_batch: { jobs: [{ index: 0, job_id: "v2", status: "pending" }] } });
    await createHiggsfieldMediaProvider("oat_x", { model: "kling3_0_turbo" }).startVideo({ prompt: "text only" });
    const submit = calls.find((c) => c.name === "generate_video_batch")!.args as { requests: Array<{ params: Record<string, unknown> }> };
    expect(submit.requests[0]!.params.medias).toBeUndefined();
    expect(calls.some((c) => c.name === "media_import_url")).toBe(false);
  });

  it("fails loudly when the import returns no media_id", async () => {
    // Generating without the reference would silently produce an unrelated
    // picture — the precise bug start-frame support exists to prevent.
    scriptByName({ media_import_url: { error: "unreachable" }, models_explore: { medias: [] } });
    await expect(
      createHiggsfieldMediaProvider("oat_x", { model: "soul_v2" }).startImage!({ prompt: "x", source: { url: "https://cdn.example/p.png" } }),
    ).rejects.toThrow(/could not import/);
  });
});
