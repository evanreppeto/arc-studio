import { describe, expect, it } from "vitest";

import { createToolCallLog, renderToolText } from "./tool-calls";

describe("createToolCallLog", () => {
  it("records a call and settles it with its result", () => {
    const log = createToolCallLog();
    log.start("t1", "crm_search", { query: "high intent", limit: 25 });
    expect(log.value()).toEqual([
      { name: "crm_search", status: "running", input: '{"query":"high intent","limit":25}' },
    ]);

    log.settle("t1", "142 accounts matched");
    expect(log.value()).toEqual([
      {
        name: "crm_search",
        status: "complete",
        input: '{"query":"high intent","limit":25}',
        output: "142 accounts matched",
      },
    ]);
  });

  it("marks a failed result as an error, not a completion", () => {
    // The whole point of persisting this is to see what went wrong. A tool that
    // errored must never read as a successful call.
    const log = createToolCallLog();
    log.start("t1", "weather_lookup");
    log.settle("t1", "weather_lookup failed: timeout", true);
    expect(log.value()[0]).toMatchObject({ status: "error", output: "weather_lookup failed: timeout" });
  });

  it("leaves a call with no result running rather than claiming it finished", () => {
    const log = createToolCallLog();
    log.start("t1", "media_generate");
    expect(log.value()[0]!.status).toBe("running");
  });

  it("keeps call order", () => {
    const log = createToolCallLog();
    log.start("a", "first");
    log.start("b", "second");
    log.settle("b", "done b");
    log.settle("a", "done a");
    expect(log.value().map((call) => call.name)).toEqual(["first", "second"]);
  });

  it("ignores a result for a call it never saw", () => {
    const log = createToolCallLog();
    log.settle("ghost", "output with no call");
    expect(log.value()).toEqual([]);
  });

  it("ignores a duplicate tool_use id", () => {
    const log = createToolCallLog();
    log.start("t1", "crm_search");
    log.start("t1", "something_else");
    expect(log.value()).toHaveLength(1);
    expect(log.value()[0]!.name).toBe("crm_search");
  });

  it("caps the record and reports what it dropped", () => {
    // No silent caps: a run that called 45 tools must not read as one that
    // called 40.
    const log = createToolCallLog();
    for (let index = 0; index < 45; index += 1) log.start(`t${index}`, `tool_${index}`);
    expect(log.value()).toHaveLength(40);
    expect(log.dropped()).toBe(5);
  });

  it("skips a block with no id or no name", () => {
    const log = createToolCallLog();
    log.start("", "nameless_id");
    log.start("t1", "");
    expect(log.value()).toEqual([]);
  });
});

describe("renderToolText", () => {
  it("redacts anything that looks like a credential", () => {
    const rendered = renderToolText({ apiKey: "sk-live-123", nested: { authorization: "Bearer x" }, keep: "visible" });
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("sk-live-123");
    expect(rendered).not.toContain("Bearer x");
    expect(rendered).toContain("visible");
  });

  it("flattens a tool result's content blocks to their text", () => {
    expect(renderToolText([{ type: "text", text: "142 rows" }, { type: "text", text: "truncated" }]))
      .toBe("142 rows truncated");
  });

  it("collapses whitespace and truncates long output", () => {
    const rendered = renderToolText("x".repeat(900))!;
    expect(rendered).toHaveLength(400);
    expect(rendered.endsWith("…")).toBe(true);
    expect(renderToolText("line one\n\n  line two")).toBe("line one line two");
  });

  it("returns undefined for nothing rather than an empty string", () => {
    expect(renderToolText(undefined)).toBeUndefined();
    expect(renderToolText(null)).toBeUndefined();
    expect(renderToolText("   ")).toBeUndefined();
  });

  it("degrades an unserializable value instead of throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => renderToolText(circular)).not.toThrow();
  });
});
