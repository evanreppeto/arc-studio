import { describe, expect, it } from "vitest";

import { collapseTraceRows, type TraceRow } from "./trace-rows";

const row = (over: Partial<TraceRow> & { id: string }): TraceRow => ({
  label: over.id,
  status: "done",
  ...over,
});

describe("collapseTraceRows", () => {
  // The reported symptom: a header reading "Working out an answer · 12s" above a
  // list whose last item also read "Working out an answer".
  it("drops the running step, because the header already names it", () => {
    const out = collapseTraceRows([
      row({ id: "a", label: "Reading your workspace" }),
      row({ id: "b", label: "Working out an answer", status: "running" }),
    ]);

    expect(out.map((r) => r.label)).toEqual(["Reading your workspace"]);
  });

  it("collapses consecutive bookkeeping phases into one quiet line", () => {
    const out = collapseTraceRows([
      row({ id: "a", label: "Reading your workspace" }),
      row({ id: "b", label: "Checking what's active right now" }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]!.label).toBe("Reading your workspace, checking what's active right now");
  });

  it("keeps a step that carried reasoning on its own line", () => {
    const out = collapseTraceRows([
      row({ id: "a", label: "Reading your workspace" }),
      row({ id: "b", label: "Writing the reply", detail: "The CRM came back empty, so I should say so plainly." }),
    ]);

    expect(out.map((r) => r.label)).toEqual([
      "Reading your workspace",
      "Writing the reply",
    ]);
  });

  it("never merges tool calls away — those are the real events", () => {
    const out = collapseTraceRows([
      row({ id: "a", label: "Reading your workspace" }),
      row({ id: "b", label: "search_leads", isTool: true }),
      row({ id: "c", label: "search_companies", isTool: true }),
    ]);

    expect(out.map((r) => r.label)).toEqual(["Reading your workspace", "search_leads", "search_companies"]);
  });

  it("keeps a failure visible rather than folding it into a summary", () => {
    const out = collapseTraceRows([
      row({ id: "a", label: "Reading your workspace" }),
      row({ id: "b", label: "Checking what's active right now", status: "error" }),
    ]);

    expect(out.map((r) => r.status)).toEqual(["done", "error"]);
  });

  it("groups across a run and resumes after a real event", () => {
    const out = collapseTraceRows([
      row({ id: "a", label: "Reading your workspace" }),
      row({ id: "b", label: "Checking what's active right now" }),
      row({ id: "c", label: "search_leads", isTool: true }),
      row({ id: "d", label: "Working out an answer" }),
      row({ id: "e", label: "Writing the reply" }),
    ]);

    expect(out.map((r) => r.label)).toEqual([
      "Reading your workspace, checking what's active right now",
      "search_leads",
      "Working out an answer, writing the reply",
    ]);
  });

  it("leaves a single row alone", () => {
    const out = collapseTraceRows([row({ id: "a", label: "Reading your workspace" })]);
    expect(out).toEqual([row({ id: "a", label: "Reading your workspace" })]);
  });
});
