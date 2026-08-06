import {
  HiggsfieldError,
  isTerminalStatus,
  submitHiggsfieldImage,
  submitHiggsfieldVideo,
  waitForHiggsfieldJobs,
  type HiggsfieldJobState,
} from "@/lib/connectors/higgsfield-mcp";

import { ImageEditUnsupportedError, type MediaProvider, type VideoPoll, type VideoStart } from "./types";

/**
 * Higgsfield as a MediaProvider — the app executing a generation itself, rather
 * than asking Arc to ask its MCP connector.
 *
 * This closes the last gap in model selection. Until now a Higgsfield pick could
 * only be *stated* to Arc as the value of a required prompt argument, which is
 * as strong as a prompt can be and no stronger; the same pick made in Studio had
 * nowhere to go at all, because Studio runs in-process and had only Gemini. Now
 * a Higgsfield target is a parameter on a call the app makes.
 *
 * Shape mirrors the Gemini provider so every caller stays engine-agnostic:
 * submit → poll → bytes. The differences that matter:
 *   - Higgsfield is job-based for images too, so `generateImage` polls (Gemini
 *     returns bytes inline).
 *   - It burns the CUSTOMER's credits, not platform ones. Callers meter against
 *     the `higgsfield` connector, never the gemini-media one.
 */

/**
 * How long to wait for an image before giving up.
 *
 * MEASURED, not guessed: a real `nano_banana_pro` generation on 2026-08-06 took
 * ~75s end to end (pending → in_progress → completed). The first version of this
 * file waited 40s and would have abandoned every one of them — a bug no mocked
 * test could see, because the mock answered instantly.
 *
 * 50s is what fits: Studio declares `maxDuration = 60` and still has to download
 * the result and upload it to storage afterwards. That is NOT enough for every
 * model, which is why expiry says so plainly and names the job. The durable fix
 * is the start-then-poll path the video flow already uses — see docs.
 */
const DEFAULT_IMAGE_BUDGET_MS = 50_000;
/** The server's long-poll ceiling is 15s; asking for more is rejected. */
const WAIT_SECONDS = 15;
/** Fallback gap between polls when the server states no preference. */
const POLL_FLOOR_MS = 2_000;

function failureMessage(job: HiggsfieldJobState | undefined, fallback: string): string {
  if (!job) return fallback;
  if (job.error) return job.error;
  if (job.status === "lookup_failed") return "Higgsfield lost track of that generation.";
  return `Higgsfield reported the generation as ${job.status}.`;
}

async function download(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetch(url);
  if (res.status < 200 || res.status >= 300) throw new HiggsfieldError(`Could not download the generated file (${res.status}).`, "transport");
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  return { bytes: Buffer.from(await res.arrayBuffer()), contentType };
}

/**
 * A provider bound to one workspace's access token and one model.
 *
 * The model is fixed at construction rather than passed per call, because the
 * caller has already resolved it (`resolveGenerationTarget`) and re-deciding it
 * here would be a second answer to the question this whole layer exists to have
 * exactly one answer to.
 */
export function createHiggsfieldMediaProvider(accessToken: string, opts: { model: string; imageBudgetMs?: number }): MediaProvider {
  const model = opts.model;
  const imageBudgetMs = opts.imageBudgetMs ?? DEFAULT_IMAGE_BUDGET_MS;

  async function pollUntilTerminal(job: { index: number; jobId: string }, budgetMs: number): Promise<HiggsfieldJobState> {
    const deadline = Date.now() + budgetMs;
    // One immediate snapshot first: a fast model can already be done, and a
    // 15-second long poll for a finished job is 15 seconds of an operator
    // watching a spinner for no reason.
    let wait = await waitForHiggsfieldJobs(accessToken, [job], 0);
    while (!wait.allTerminal) {
      if (Date.now() >= deadline) break;
      // Pace from the server's own request when it makes one (`poll_after_seconds`
      // rides along with an expired long poll), falling back to a local floor.
      // The loop must never depend on the remote end to block for it: a server
      // that answers immediately would otherwise turn this into a hot loop.
      const gapMs = Math.max(POLL_FLOOR_MS, (wait.pollAfterSeconds ?? 0) * 1000);
      await new Promise((resolve) => setTimeout(resolve, Math.min(gapMs, Math.max(0, deadline - Date.now()))));
      wait = await waitForHiggsfieldJobs(accessToken, [job], WAIT_SECONDS);
    }
    const state = wait.jobs.find((j) => j.jobId === job.jobId) ?? wait.jobs[0];
    if (!state || !isTerminalStatus(state.status)) {
      // The job is still running and the customer has been charged for it. Say
      // that, rather than "failed" — the credits are spent either way and the
      // result will land in their Higgsfield library.
      // Name the job. The credits are spent and the render WILL finish on
      // Higgsfield's side, so the operator needs to be able to go and find it
      // rather than being told something failed and generating it again.
      throw new HiggsfieldError(
        `Higgsfield is still rendering after ${Math.round(budgetMs / 1000)}s — this model is slower than one request can wait. It was submitted and paid for, and will finish in your Higgsfield library (job ${job.jobId}).`,
        "transport",
      );
    }
    return state;
  }

  return {
    async generateImage(input) {
      const job = await submitHiggsfieldImage(accessToken, { model, prompt: input.prompt, aspectRatio: input.aspectRatio });
      const state = await pollUntilTerminal(job, imageBudgetMs);
      if (state.status !== "completed" || !state.resultUrl) {
        throw new HiggsfieldError(failureMessage(state, "Higgsfield returned no image."), "tool");
      }
      const { bytes, contentType } = await download(state.resultUrl);
      return { bytes, contentType, model: state.model ?? model, jobId: state.jobId };
    },

    // Images here are jobs, and a real one measured ~75s — longer than a
    // serverless request may live. Callers that can submit-and-poll should:
    // generateImage above still works, but it can only ever wait as long as the
    // request that called it.
    async startImage(input) {
      const job = await submitHiggsfieldImage(accessToken, { model, prompt: input.prompt, aspectRatio: input.aspectRatio });
      return { operationName: job.jobId, model, jobId: job.jobId };
    },

    async pollImage(operationName) {
      const wait = await waitForHiggsfieldJobs(accessToken, [{ index: 0, jobId: operationName }], 0);
      const state = wait.jobs[0];
      if (!state || !isTerminalStatus(state.status)) return { status: "running" };
      if (state.status !== "completed" || !state.resultUrl) {
        throw new HiggsfieldError(failureMessage(state, "Higgsfield returned no image."), "tool");
      }
      const { bytes, contentType } = await download(state.resultUrl);
      // The server's model, not the requested one — it substitutes (observed:
      // nano_banana_pro answered as nano_banana_2).
      return { status: "done", bytes, contentType, model: state.model ?? model, jobId: state.jobId };
    },

    async editImage() {
      // Not a capability gap we can paper over: Higgsfield edits take a
      // `media_id` from its own upload endpoint, not a URL or bytes, so editing
      // means a second flow (media_upload → generate with medias[]) that does
      // not exist yet. This is the typed error the callers already handle, so
      // the operator is told which model can't do it and what to switch to,
      // instead of watching a generic failure.
      throw new ImageEditUnsupportedError(model);
    },

    async startVideo(input): Promise<VideoStart> {
      const job = await submitHiggsfieldVideo(accessToken, {
        model,
        prompt: input.prompt,
        aspectRatio: input.aspectRatio,
        // Higgsfield clamps an unsupported duration to the model's nearest
        // allowed value rather than rejecting it, so passing the caller's number
        // through is safe; omitted means the model's own default.
        duration: input.durationSeconds,
      });
      // The job id IS the operation name. Callers already treat that string as
      // opaque and hand it back to pollVideo, so no caller has to learn which
      // engine rendered the clip.
      return { operationName: job.jobId, model, jobId: job.jobId };
    },

    async pollVideo(operationName): Promise<VideoPoll> {
      const wait = await waitForHiggsfieldJobs(accessToken, [{ index: 0, jobId: operationName }], 0);
      const state = wait.jobs[0];
      if (!state || !isTerminalStatus(state.status)) return { status: "running" };
      if (state.status !== "completed" || !state.resultUrl) {
        throw new HiggsfieldError(failureMessage(state, "Higgsfield returned no video."), "tool");
      }
      const { bytes, contentType } = await download(state.resultUrl);
      return { status: "done", bytes, contentType };
    },
  };
}
