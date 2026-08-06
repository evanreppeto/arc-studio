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

/** Total wall-clock an image generation may take before we stop waiting. Studio's
 *  server action budget is 60s (see studio/page.tsx maxDuration), so this has to
 *  leave room for the fetch and the upload that follow. */
const IMAGE_BUDGET_MS = 40_000;
/** The server's long-poll ceiling is 15s; asking for more is rejected. */
const WAIT_SECONDS = 15;
/** Minimum gap between polls, enforced locally — see pollUntilTerminal. */
const POLL_FLOOR_MS = 1_000;

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
export function createHiggsfieldMediaProvider(accessToken: string, opts: { model: string }): MediaProvider {
  const model = opts.model;

  async function pollUntilTerminal(job: { index: number; jobId: string }, budgetMs: number): Promise<HiggsfieldJobState> {
    const deadline = Date.now() + budgetMs;
    // One immediate snapshot first: a fast model can already be done, and a
    // 15-second long poll for a finished job is 15 seconds of an operator
    // watching a spinner for no reason.
    let wait = await waitForHiggsfieldJobs(accessToken, [job], 0);
    while (!wait.allTerminal) {
      if (Date.now() >= deadline) break;
      // A client-side floor between polls. The long poll is supposed to block
      // server-side for its full budget, but a server that answers immediately
      // (or ignores the budget) would otherwise turn this into a hot loop
      // hammering the API for the whole window — the loop must not depend on
      // the remote end for its own pacing.
      await new Promise((resolve) => setTimeout(resolve, POLL_FLOOR_MS));
      wait = await waitForHiggsfieldJobs(accessToken, [job], WAIT_SECONDS);
    }
    const state = wait.jobs.find((j) => j.jobId === job.jobId) ?? wait.jobs[0];
    if (!state || !isTerminalStatus(state.status)) {
      // The job is still running and the customer has been charged for it. Say
      // that, rather than "failed" — the credits are spent either way and the
      // result will land in their Higgsfield library.
      throw new HiggsfieldError(
        `Higgsfield is still rendering after ${Math.round(budgetMs / 1000)}s. The generation was submitted and will finish on their side.`,
        "transport",
      );
    }
    return state;
  }

  return {
    async generateImage(input) {
      const job = await submitHiggsfieldImage(accessToken, { model, prompt: input.prompt, aspectRatio: input.aspectRatio });
      const state = await pollUntilTerminal(job, IMAGE_BUDGET_MS);
      if (state.status !== "completed" || !state.resultUrl) {
        throw new HiggsfieldError(failureMessage(state, "Higgsfield returned no image."), "tool");
      }
      const { bytes, contentType } = await download(state.resultUrl);
      return { bytes, contentType, model: state.model ?? model, jobId: state.jobId };
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
