import { describe, expect, it } from "vitest";

import { HiggsfieldError, isTerminalStatus, parseSubmittedJobs, parseWait } from "../higgsfield-mcp";
import { parseMcpBody, unwrapToolResult } from "../mcp-client";

/**
 * These fixtures are RECORDED, not invented: each is a real response from
 * mcp.higgsfield.ai captured on 2026-08-06 via the connected MCP session. A
 * hand-written shape would only prove the parser matches my guess.
 */

/** VERIFIED — `jobs_wait` with one real job id and one nonexistent one. */
const LIVE_WAIT = {
  jobs: [
    {
      index: 0,
      job_id: "a43329d6-8420-4ce7-b278-cf00bca590ae",
      status: "completed",
      type: "image",
      model: "nano_banana_2",
      result_url: "https://d8j0ntlcm91z4.cloudfront.net/user_x/hf_20260727_164912_a43329d6.png",
    },
    { index: 1, job_id: "00000000-0000-0000-0000-000000000000", status: "lookup_failed", error: "Generation not found", retryable: false },
  ],
  summary: { total: 2, completed: 1, failed: 0, active: 0, errors: 1 },
  all_terminal: true,
};

describe("parseWait (recorded live response)", () => {
  it("reads the real jobs_wait envelope", () => {
    const wait = parseWait(LIVE_WAIT);
    expect(wait.allTerminal).toBe(true);
    expect(wait.jobs[0]).toMatchObject({
      index: 0,
      jobId: "a43329d6-8420-4ce7-b278-cf00bca590ae",
      status: "completed",
      model: "nano_banana_2",
      resultUrl: "https://d8j0ntlcm91z4.cloudfront.net/user_x/hf_20260727_164912_a43329d6.png",
    });
  });

  it("carries a per-job failure reason instead of dropping it", () => {
    // "Generation not found" is the sentence worth showing an operator; a bare
    // "failed" would send them looking for a bug that isn't ours.
    expect(parseWait(LIVE_WAIT).jobs[1]).toMatchObject({ status: "lookup_failed", error: "Generation not found" });
  });

  it("carries the server's own poll cadence", () => {
    // VERIFIED: an expired long poll answers `timed_out: true` with
    // `poll_after_seconds: 10`. Inventing our own interval instead would
    // hammer the API for the whole render.
    const expired = { jobs: [{ index: 0, job_id: "j", status: "in_progress", type: "image", model: "nano_banana_2" }], all_terminal: false, timed_out: true, poll_after_seconds: 10 };
    expect(parseWait(expired).pollAfterSeconds).toBe(10);
    expect(parseWait(LIVE_WAIT).pollAfterSeconds).toBeUndefined();
  });

  it("derives all_terminal when the server omits it, so a finished job can't poll forever", () => {
    const wait = parseWait({ jobs: [{ index: 0, job_id: "j", status: "completed" }] });
    expect(wait.allTerminal).toBe(true);
    expect(parseWait({ jobs: [{ index: 0, job_id: "j", status: "in_progress" }] }).allTerminal).toBe(false);
  });

  it("treats an unknown status as still running rather than silently done", () => {
    expect(isTerminalStatus("queued")).toBe(false);
    expect(isTerminalStatus("in_progress")).toBe(false);
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("lookup_failed")).toBe(true);
  });
});

/** VERIFIED — a real (paid) `generate_image_batch` submit, 2026-08-06. */
const LIVE_SUBMIT = {
  jobs: [{ index: 0, job_id: "13af5a4f-85db-470d-8b40-1915fe0b6b30", status: "pending", adjustments: { "params.resolution": { requested: "(unset)", used: "1k" } } }],
  submitted_count: 1,
  failed_count: 0,
};

describe("parseSubmittedJobs (recorded live response)", () => {
  it("reads the real batch-submit envelope", () => {
    expect(parseSubmittedJobs(LIVE_SUBMIT)).toEqual([{ index: 0, jobId: "13af5a4f-85db-470d-8b40-1915fe0b6b30" }]);
  });

  it("treats the submit's own `pending` status as not finished", () => {
    // A fresh submit reports `pending`, then `in_progress`, then `completed`.
    expect(isTerminalStatus("pending")).toBe(false);
    expect(isTerminalStatus("in_progress")).toBe(false);
  });

  it("accepts the plausible spellings — one confirming sample is not a spec", () => {
    expect(parseSubmittedJobs({ results: [{ index: 3, id: "abc" }] })).toEqual([{ index: 3, jobId: "abc" }]);
    expect(parseSubmittedJobs([{ jobId: "abc" }])).toEqual([{ index: 0, jobId: "abc" }]);
  });

  it("THROWS on an envelope it doesn't recognise, rather than returning nothing", () => {
    // The customer has already been charged by the time this parses. Returning
    // an empty list would read as "nothing was submitted" for a generation that
    // is running and billed — the caller must fail loudly and name what it got.
    expect(() => parseSubmittedJobs({ status: "queued" })).toThrow(HiggsfieldError);
    expect(() => parseSubmittedJobs({ jobs: [{ index: 0 }] })).toThrow(/no job ids/);
    expect(() => parseSubmittedJobs({ status: "queued" })).toThrow(/"status":"queued"/);
  });
});

describe("MCP envelope parsing", () => {
  it("reads an SSE body, which is how this server answers", () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\\"credits\\":10}"}]}}\n\n';
    const envelope = parseMcpBody(body, "text/event-stream");
    expect(unwrapToolResult(envelope?.result)).toEqual({ ok: true, value: { credits: 10 } });
  });

  it("reads a plain JSON body too", () => {
    const envelope = parseMcpBody('{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\\"a\\":1}"}]}}', "application/json");
    expect(unwrapToolResult(envelope?.result)).toEqual({ ok: true, value: { a: 1 } });
  });

  it("skips stream noise instead of failing the whole call on one bad line", () => {
    const body = 'data: not-json\ndata: {"jsonrpc":"2.0","id":2,"result":{"structuredContent":{"ok":1}}}\n';
    expect(parseMcpBody(body, "text/event-stream")).toMatchObject({ result: { structuredContent: { ok: 1 } } });
  });

  it("surfaces an isError tool result as the sentence the server wrote", () => {
    const result = { isError: true, content: [{ type: "text", text: 'unknown model "nope".' }] };
    expect(unwrapToolResult(result)).toEqual({ ok: false, value: 'unknown model "nope".' });
  });

  it("returns null for a body that is not a protocol answer", () => {
    expect(parseMcpBody("<html>gateway timeout</html>", "text/html")).toBeNull();
  });
});
