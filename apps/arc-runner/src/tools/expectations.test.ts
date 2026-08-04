import { describe, expect, it, vi } from "vitest";

import {
  breachResult,
  enforce,
  expectList,
  expectListEnvelope,
  expectRecord,
  ToolExpectationError,
} from "./expectations";
import { runTool } from "./helpers";

const step = vi.fn(async () => {});

describe("empty is an answer; absent is a fault", () => {
  it("passes a genuinely empty list", () => {
    // The single most important case. If an empty CRM tripped this guard, the
    // guard would be noise and would be ignored inside a week.
    expect(expectList("nodes")({ nodes: [] })).toBeNull();
    expect(expectListEnvelope("leads")({ leads: [], total: 0, returned: 0 })).toBeNull();
  });

  it("fails a response that never mentions the field", () => {
    // `return r.nodes ?? []` turned exactly this into "you have no facts".
    expect(expectList("nodes")({ ok: true })?.reason).toContain("no `nodes` field");
  });

  it("fails a field of the wrong type", () => {
    expect(expectList("nodes")({ nodes: "some" })?.reason).toContain("not a list");
    expect(expectList("nodes")({ nodes: null })?.reason).toContain("not a list");
  });

  it("fails a payload that is not an object at all", () => {
    expect(expectList("nodes")(null)?.reason).toContain("got null");
    expect(expectList("nodes")([])?.reason).toContain("got a list");
    expect(expectList("nodes")("oops")?.reason).toContain("got a string");
  });
});

describe("a single-record read", () => {
  it("treats an explicit null as a real answer — that id is not here", () => {
    expect(expectRecord("lead")({ lead: null })).toBeNull();
  });

  it("still fails when the field is absent, which is a different thing entirely", () => {
    // "not found" and "the lookup did not happen" must not collapse together.
    expect(expectRecord("lead")({ ok: true })?.reason).toContain("no `lead` field");
  });
});

describe("a CRM list envelope has to be internally consistent", () => {
  it("requires total, because counts are answered from it", () => {
    // Arc reads `total` rather than counting a capped page — that is how it
    // stopped reporting "at least 64 leads" against a real 200.
    expect(expectListEnvelope("leads")({ leads: [] })?.reason).toContain("no `total`");
    expect(expectListEnvelope("leads")({ leads: [], total: "12" })?.reason).toContain("not a number");
  });

  it("accepts limit=0: a total with no rows is the cheap way to count", () => {
    expect(expectListEnvelope("leads")({ leads: [], total: 200, returned: 0 })).toBeNull();
  });

  it("rejects a `returned` that disagrees with the rows actually sent", () => {
    const breach = expectListEnvelope("leads")({ leads: [{ id: "a" }], total: 9, returned: 5 });
    expect(breach?.reason).toContain("`returned` says 5 but 1 rows were sent");
  });

  it("rejects a total smaller than the page it came with", () => {
    // A page cannot hold more than the whole set.
    expect(expectListEnvelope("leads")({ leads: [{ id: "a" }, { id: "b" }], total: 1 })?.reason).toContain(
      "`total` is 1 but 2 rows were sent",
    );
  });
});

describe("what the model is told", () => {
  it("names the failure as a failure and forbids the empty reading", () => {
    const text = breachResult("Searching CRM leads", { reason: "the response has no `leads` field" }).content[0].text;
    expect(text).toContain("RETRIEVAL FAILED");
    expect(text).toContain("not an empty result");
    expect(text).toContain('Do NOT report it as "none found"');
    expect(text).toContain("Searching CRM leads");
  });

  it("marks the result as an error so the run shows as failed", () => {
    // buildArcWorkspaceRuns already fails a run when any tool call errored, so
    // this lights up the existing UI without touching it.
    expect(breachResult("x", { reason: "y" }).isError).toBe(true);
  });
});

describe("enforce + runTool together", () => {
  it("throws a ToolExpectationError so a breach can be raised from anywhere", () => {
    // listPage builds its envelope before runTool sees it, so it needs to be
    // able to raise from inside the fn.
    expect(() => enforce({ ok: true }, expectList("leads"))).toThrow(ToolExpectationError);
    expect(enforce({ leads: [] }, expectList("leads"))).toEqual({ leads: [] });
  });

  it("renders a breach thrown deep inside the handler as a loud failure", async () => {
    const result = await runTool(step, "Searching CRM leads", async () => {
      enforce({ ok: true } as Record<string, unknown>, expectListEnvelope("leads"));
      return { leads: [] };
    });
    expect(result.content[0].text).toContain("RETRIEVAL FAILED");
    expect(result.isError).toBe(true);
  });

  it("checks the RAW response, not the projection", async () => {
    // Validating after `select` would always find a tidy empty list — the
    // projection is the very step that erases the evidence.
    const result = await runTool(
      step,
      "Searching the marketing brain",
      async () => ({ ok: true }) as { nodes?: unknown[] },
      { expect: expectList("nodes"), select: (r) => r.nodes ?? [] },
    );
    expect(result.content[0].text).toContain("RETRIEVAL FAILED");
    expect(result.isError).toBe(true);
  });

  it("passes the projection through when the response is well formed", async () => {
    const result = await runTool(
      step,
      "Searching the marketing brain",
      async () => ({ nodes: [{ id: "n1" }] }),
      { expect: expectList("nodes"), select: (r) => r.nodes },
    );
    expect(result.content[0].text).toBe('[{"id":"n1"}]');
    expect(result.isError).toBeUndefined();
  });

  it("keeps a thrown error distinct from a breach", async () => {
    // An operator reading the trace needs to tell "the endpoint refused" from
    // "the endpoint answered with something unusable".
    const result = await runTool(step, "Searching CRM leads", async () => {
      throw new Error("connect ETIMEDOUT");
    });
    expect(result.content[0].text).toBe("Searching CRM leads failed: connect ETIMEDOUT");
    expect(result.content[0].text).not.toContain("RETRIEVAL FAILED");
    expect(result.isError).toBeUndefined();
  });

  it("still closes the step so the live trace does not hang on 'running'", async () => {
    const localStep = vi.fn(async () => {});
    await runTool(localStep, "Searching CRM leads", async () => ({ ok: true }), {
      expect: expectList("leads"),
    });
    expect(localStep).toHaveBeenCalledWith("Searching CRM leads", "running");
    expect(localStep).toHaveBeenCalledWith("Searching CRM leads", "done");
  });
});
