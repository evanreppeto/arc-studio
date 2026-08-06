import { describe, expect, it, vi } from "vitest";

import { searchArcMessages } from "./message-search";

type Row = { id: string; conversation_id: string; role: string; body: string; created_at: string };

/** Records what the query builder was asked for, so scoping can be asserted. */
function stubClient(rows: Row[], error: { message: string } | null = null) {
  const calls: Record<string, unknown> = {};
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    in: vi.fn((column: string, values: string[]) => { calls.in = { column, values }; return builder; }),
    ilike: vi.fn((column: string, pattern: string) => { calls.ilike = { column, pattern }; return builder; }),
    order: vi.fn(() => builder),
    limit: vi.fn((n: number) => { calls.limit = n; return Promise.resolve({ data: rows, error }); }),
  };
  return {
    calls,
    client: { from: vi.fn((table: string) => { calls.table = table; return builder; }) } as never,
  };
}

const row = (overrides: Partial<Row> = {}): Row => ({
  id: "message-1",
  conversation_id: "conversation-1",
  role: "arc",
  body: "142 accounts hit the pricing page twice.",
  created_at: "2026-08-05T12:00:00.000Z",
  ...overrides,
});

describe("searchArcMessages", () => {
  it("returns a hit with a snippet showing why it matched", async () => {
    const { client } = stubClient([row()]);
    const hits = await searchArcMessages(["conversation-1"], "pricing", {}, client);

    expect(hits).toHaveLength(1);
    expect(hits[0]!.messageId).toBe("message-1");
    expect(hits[0]!.snippet.match).toBe("pricing");
  });

  /**
   * The scoping guarantee. Access is bounded entirely by the ids the caller
   * passes; an empty list must mean "nothing", never "everything". Getting this
   * backwards would search every conversation in the database.
   */
  it("never queries at all when the viewer has no conversations", async () => {
    const { client, calls } = stubClient([row()]);
    await expect(searchArcMessages([], "pricing", {}, client)).resolves.toEqual([]);
    expect(calls.table).toBeUndefined();
  });

  it("restricts the query to exactly the conversations it was given", async () => {
    const { client, calls } = stubClient([]);
    await searchArcMessages(["a", "b"], "pricing", {}, client);
    expect(calls.in).toEqual({ column: "conversation_id", values: ["a", "b"] });
  });

  it("escapes ilike wildcards so a '%' query cannot match everything", async () => {
    const { client, calls } = stubClient([]);
    await searchArcMessages(["a"], "50%", {}, client);
    expect(calls.ilike).toEqual({ column: "body", pattern: "%50\\%%" });
  });

  it("skips an empty query without a round-trip", async () => {
    const { client, calls } = stubClient([row()]);
    await expect(searchArcMessages(["a"], "   ", {}, client)).resolves.toEqual([]);
    expect(calls.table).toBeUndefined();
  });

  it("drops a row whose match only existed in markup the reader never sees", async () => {
    // The DB matched the raw body; the snippet builder works on flattened prose.
    // Showing a result with no visible reason is worse than showing none.
    const { client } = stubClient([row({ body: "Totals **by** segment" })]);
    await expect(searchArcMessages(["conversation-1"], "**", {}, client)).resolves.toEqual([]);
  });

  it("still finds code Arc wrote inside a fenced block", async () => {
    // The thread preview drops fenced code; search must not, or the snippet
    // Arc wrote for you becomes the one thing you can never find again.
    const { client } = stubClient([row({ body: "Here:\n```sql\nselect lead_score from leads\n```" })]);
    const hits = await searchArcMessages(["conversation-1"], "lead_score", {}, client);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.snippet.match).toBe("lead_score");
  });

  it("surfaces a query failure instead of reporting no results", async () => {
    const { client } = stubClient([], { message: "connection reset" });
    await expect(searchArcMessages(["a"], "pricing", {}, client)).rejects.toThrow(/connection reset/);
  });
});
