/**
 * Higgsfield's MCP tool contract, as the app calls it.
 *
 * Verified against the live server on 2026-08-06 (see each function). Only the
 * pieces the app executes are modelled — submit a generation, wait for it, read
 * its result URL. The interactive `generate_image` / `generate_video` tools are
 * deliberately NOT used: they exist to render a widget in a chat client, and the
 * app has its own canvas. Their headless `*_batch` siblings are the API.
 */

import { callMcpTool, type McpCallErr } from "./mcp-client";

export const HIGGSFIELD_MCP_URL = "https://mcp.higgsfield.ai/mcp";

/** A submitted generation, identified for polling. */
export type HiggsfieldJob = { index: number; jobId: string };

/**
 * One job's state. `completed` and `failed` are terminal; `lookup_failed` means
 * the server has no such job (terminal, and not our job's fault).
 * VERIFIED shape — a live `jobs_wait` returned exactly these fields.
 */
export type HiggsfieldJobState = {
  index: number;
  jobId: string;
  status: string;
  model?: string;
  type?: string;
  resultUrl?: string;
  error?: string;
};

export type HiggsfieldWait = {
  jobs: HiggsfieldJobState[];
  allTerminal: boolean;
  /** The server's own requested gap before polling again, in seconds. It sends
   *  `poll_after_seconds: 10` alongside `timed_out: true` on an expired long
   *  poll; honouring it beats a cadence we invented. */
  pollAfterSeconds?: number;
};

// Observed live: a fresh submit reports `pending`, then `in_progress`, then
// `completed`. Only the last is done — an unknown status is treated as still
// running, because calling a live job finished loses the result.
const TERMINAL = new Set(["completed", "failed", "canceled", "cancelled", "lookup_failed"]);
export function isTerminalStatus(status: string): boolean {
  return TERMINAL.has(status.toLowerCase());
}

export class HiggsfieldError extends Error {
  readonly kind: McpCallErr["kind"] | "contract";
  constructor(message: string, kind: McpCallErr["kind"] | "contract") {
    super(message);
    this.name = "HiggsfieldError";
    this.kind = kind;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Pull the submitted jobs out of a `*_batch` response.
 *
 * VERIFIED by a real (paid) submit on 2026-08-06:
 *   {"jobs":[{"index":0,"job_id":"…","status":"pending","adjustments":{…}}],
 *    "submitted_count":1,"failed_count":0}
 *
 * The lenient spellings stay: they cost nothing and this is the one envelope
 * with a single confirming sample. What matters is the failure mode — on an
 * unrecognised envelope this THROWS naming what it received, and never returns
 * an empty list, which would read as "nothing submitted" for a generation the
 * customer has already been charged for.
 */
export function parseSubmittedJobs(value: unknown): HiggsfieldJob[] {
  const root = record(value);
  const rows = [root.jobs, root.results, root.items, Array.isArray(value) ? value : null].find(Array.isArray) as unknown[] | undefined;
  if (!rows) {
    throw new HiggsfieldError(`Higgsfield accepted the request but returned no job list: ${JSON.stringify(value).slice(0, 300)}`, "contract");
  }
  const jobs = rows.flatMap((row, i) => {
    const r = record(row);
    const jobId = str(r.job_id) ?? str(r.jobId) ?? str(r.id);
    if (!jobId) return [];
    const index = typeof r.index === "number" ? r.index : i;
    return [{ index, jobId }];
  });
  if (jobs.length === 0) {
    throw new HiggsfieldError(`Higgsfield returned a job list with no job ids: ${JSON.stringify(value).slice(0, 300)}`, "contract");
  }
  return jobs;
}

/** VERIFIED shape: `{jobs:[{index, job_id, status, type, model, result_url}], summary, all_terminal}`. */
export function parseWait(value: unknown): HiggsfieldWait {
  const root = record(value);
  const rows = Array.isArray(root.jobs) ? root.jobs : [];
  const jobs = rows.map((row, i) => {
    const r = record(row);
    return {
      index: typeof r.index === "number" ? r.index : i,
      jobId: str(r.job_id) ?? str(r.jobId) ?? "",
      status: str(r.status) ?? "unknown",
      model: str(r.model),
      type: str(r.type),
      resultUrl: str(r.result_url) ?? str(r.resultUrl),
      error: str(r.error),
    };
  });
  // Trust the server's own verdict when it gives one; otherwise derive it, so a
  // missing flag cannot turn a finished job into an infinite poll.
  const allTerminal = typeof root.all_terminal === "boolean" ? root.all_terminal : jobs.every((j) => isTerminalStatus(j.status));
  const pollAfter = typeof root.poll_after_seconds === "number" ? root.poll_after_seconds : undefined;
  return { jobs, allTerminal, ...(pollAfter !== undefined ? { pollAfterSeconds: pollAfter } : {}) };
}

async function call(token: string, name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
  const res = await callMcpTool({ url: HIGGSFIELD_MCP_URL, token, name, args, timeoutMs });
  if (!res.ok) throw new HiggsfieldError(res.error, res.kind);
  return res.result;
}

export type HiggsfieldSubmit = {
  model: string;
  prompt: string;
  aspectRatio?: string;
  /** Seconds. Video only; the server clamps to the model's allowed values. */
  duration?: number;
  /** Reference media, already imported. `value` is a media_id or a prior job id
   *  — NEVER a URL; the server rejects those outright. */
  medias?: Array<{ role: string; value: string }>;
};

function submitParams(input: HiggsfieldSubmit): Record<string, unknown> {
  return {
    model: input.model,
    prompt: input.prompt,
    ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
    ...(input.duration ? { duration: input.duration } : {}),
    ...(input.medias?.length ? { medias: input.medias } : {}),
    // NEVER let the server decide to spend the customer's free-trial allowance
    // on our behalf. Omitting this returns `unlim_choice` — a question for a
    // human — which an unattended server action has no way to answer, so the
    // generation would stall on a prompt nobody sees. Explicit `false` charges
    // credits, which is what an operator pressing Generate has asked for.
    use_unlim: false,
  };
}

/** Submit one image generation. Returns its job, already charged for. */
export async function submitHiggsfieldImage(token: string, input: HiggsfieldSubmit): Promise<HiggsfieldJob> {
  const result = await call(token, "generate_image_batch", { requests: [{ index: 0, params: submitParams(input) }] });
  const [job] = parseSubmittedJobs(result);
  return job!;
}

/** Submit one video generation. */
export async function submitHiggsfieldVideo(token: string, input: HiggsfieldSubmit): Promise<HiggsfieldJob> {
  const result = await call(token, "generate_video_batch", { requests: [{ index: 0, params: submitParams(input) }] });
  const [job] = parseSubmittedJobs(result);
  return job!;
}

/**
 * Wait for jobs. `timeoutSeconds` is the server's long-poll budget (max 15 —
 * larger values are rejected); 0 takes an immediate snapshot, which is what a
 * caller running its own poll loop wants.
 */
export async function waitForHiggsfieldJobs(token: string, jobs: HiggsfieldJob[], timeoutSeconds = 15): Promise<HiggsfieldWait> {
  const budget = Math.max(0, Math.min(15, Math.round(timeoutSeconds)));
  const result = await call(
    token,
    "jobs_wait",
    { jobs: jobs.map((j) => ({ index: j.index, job_id: j.jobId })), timeout_seconds: budget },
    // Outlive the server's own long poll, or every wait would abort locally
    // right as the answer arrives.
    (budget + 20) * 1000,
  );
  return parseWait(result);
}

/**
 * Import a publicly-reachable URL into Higgsfield storage and get its media_id.
 *
 * This is the missing piece that made "put our logo on the van door" and
 * "animate this photo" impossible on Higgsfield: its generators take a
 * `media_id`, and passing an `https://` URL in `medias[].value` is rejected
 * outright. Every caller here already holds a permanent public URL (the
 * campaign-media bucket), so importing beats uploading bytes — one call instead
 * of presign → PUT → confirm.
 *
 * VERIFIED 2026-08-06: `{media_id, type, content_type, source_url}`. Max 50 MB.
 * The URL must be reachable by Higgsfield, not merely by us — a signed or
 * private URL will fail here rather than silently generating without the
 * reference, which is the failure mode worth having.
 */
export async function importHiggsfieldMedia(token: string, url: string, type: "image" | "video" | "auto" = "auto"): Promise<string> {
  const result = await call(token, "media_import_url", { url, type });
  const mediaId = str(record(result).media_id) ?? str(record(result).mediaId);
  if (!mediaId) {
    throw new HiggsfieldError(`Higgsfield could not import that image: ${JSON.stringify(result).slice(0, 300)}`, "contract");
  }
  return mediaId;
}

/**
 * The reference-media roles a model declares.
 *
 * Roles are per-model and NOT interchangeable — verified live: `kling3_0_turbo`
 * declares only `start_image`, while `marketing_studio_image` declares `image`.
 * Sending the wrong one relies on the server's "auto-coerce when unambiguous",
 * which is not a guarantee, so the roster is asked instead of guessed.
 *
 * Cached per process: the catalog is static relative to a deployment's life, and
 * an extra round trip before every generation is a real cost for an answer that
 * does not change.
 */
const roleCache = new Map<string, string[]>();

export async function higgsfieldModelRoles(token: string, modelId: string): Promise<string[]> {
  const cached = roleCache.get(modelId);
  if (cached) return cached;
  try {
    const result = await call(token, "models_explore", { action: "get", model_id: modelId });
    const medias = Array.isArray(record(result).medias) ? (record(result).medias as unknown[]) : [];
    const roles = medias.flatMap((m) => {
      const list = record(m).roles;
      return Array.isArray(list) ? list.filter((r): r is string => typeof r === "string") : [];
    });
    roleCache.set(modelId, roles);
    return roles;
  } catch {
    // A catalog lookup failing must not block a generation. An empty list makes
    // the caller fall back to its preference order, which is what it would have
    // guessed anyway.
    return [];
  }
}

/** Pick the role to send: the first preference the model actually declares,
 *  else the first preference (the server may still coerce it). */
export function pickMediaRole(declared: string[], preference: string[]): string {
  return preference.find((role) => declared.includes(role)) ?? declared[0] ?? preference[0]!;
}

/**
 * Preflight the credit cost of a generation without submitting it.
 *
 * VERIFIED: `{cost:{credits, credits_exact}, adjustments:{…}}`. Not on the
 * generation path — kept because it is the only way to tell an operator what a
 * model costs before they spend on it, and it costs nothing to ask.
 */
export async function higgsfieldImageCost(token: string, input: HiggsfieldSubmit): Promise<number | null> {
  const result = await call(token, "generate_image", { params: { ...submitParams(input), get_cost: true } });
  const cost = record(record(result).cost);
  return typeof cost.credits === "number" ? cost.credits : null;
}
