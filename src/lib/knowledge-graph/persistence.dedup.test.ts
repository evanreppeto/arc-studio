import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/embeddings/gemini-embeddings", () => ({ embedText: vi.fn() }));

import { embedText } from "@/lib/embeddings/gemini-embeddings";
import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { createNode } from "./persistence";

const embedMock = vi.mocked(embedText);
const ORG = "org-dedup-1";
const VEC = Array.from({ length: 8 }, (_, i) => i / 8);

/** The measured prod case: five keys, one fact. */
const EXISTING = {
  id: "node-crm-empty",
  kind: "learning",
  label: "crm_contacts_empty",
  summary: "The operator's CRM contains 0 contacts as of 2026-07-30.",
  trust_tier: "observed",
  distance: 0.02, // similarity 0.98
};

const RESTATEMENT = {
  kind: "learning" as const,
  key: "CRM state",
  label: "crm_status",
  summary: "CRM has 0 contacts as of 2026-07-30.",
};

beforeEach(() => {
  embedMock.mockReset();
  embedMock.mockResolvedValue(VEC);
});
afterEach(() => vi.restoreAllMocks());

function mock(rpcRows: unknown, nodeResponses?: unknown[]) {
  return createSupabaseQueryMock({
    "rpc:match_knowledge_nodes": { data: rpcRows, error: null },
    knowledge_nodes: (nodeResponses as never) ?? [
      { data: { props: {} }, error: null }, // read the winner's props
      { data: null, error: null }, // update the winner
    ],
  });
}

describe("a restatement folds into the fact that already exists", () => {
  it("merges instead of inserting, and returns the surviving node", async () => {
    const supabase = mock([EXISTING]);
    const result = await createNode(RESTATEMENT, { client: supabase as never, orgId: ORG });

    expect(result).toEqual({ ok: true, id: "node-crm-empty" });
    // The decisive assertion: no insert happened.
    expect(supabase.calls.some((c) => c[0] === "insert")).toBe(false);
  });

  it("retains the merged wording so nothing is silently destroyed", async () => {
    const supabase = mock([EXISTING]);
    await createNode(RESTATEMENT, { client: supabase as never, orgId: ORG });

    const update = supabase.calls.find((c) => c[0] === "update");
    const props = (update?.[1] as { props: { brainMerges: Array<Record<string, unknown>> } }).props;
    expect(props.brainMerges).toHaveLength(1);
    expect(props.brainMerges[0]).toMatchObject({
      label: "crm_status",
      summary: "CRM has 0 contacts as of 2026-07-30.",
      key: "CRM state", // retained verbatim — see the key comment in createNode
    });
  });

  it("stamps updated_at as the latest confirmation of the fact", async () => {
    // A fact restated today is fresher than the same fact last asserted in
    // March; recency is what decay will rank on.
    const supabase = mock([EXISTING]);
    await createNode(RESTATEMENT, { client: supabase as never, orgId: ORG });
    const update = supabase.calls.find((c) => c[0] === "update");
    expect((update?.[1] as { updated_at?: string }).updated_at).toBeTruthy();
  });

  it("scopes both the lookup and the update to the org", async () => {
    const supabase = mock([EXISTING]);
    await createNode(RESTATEMENT, { client: supabase as never, orgId: ORG });
    expect(supabase.calls).toContainEqual(["eq", "org_id", ORG]);
  });

  it("embeds once, not once per purpose", async () => {
    // Dedup and the stored vector need the same embedding of the same text.
    // Computing it twice doubles the cost and latency of every fact learned.
    const supabase = mock([EXISTING]);
    await createNode(RESTATEMENT, { client: supabase as never, orgId: ORG });
    expect(embedMock).toHaveBeenCalledTimes(1);
  });
});

describe("anything short of near-identity is inserted", () => {
  it("inserts when the nearest node is merely related", async () => {
    const supabase = mock([{ ...EXISTING, distance: 0.2 }], [{ data: { id: "new-1" }, error: null }]);
    const result = await createNode(RESTATEMENT, { client: supabase as never, orgId: ORG });
    expect(result).toEqual({ ok: true, id: "new-1" });
    expect(supabase.calls.some((c) => c[0] === "insert")).toBe(true);
  });

  it("inserts when the RPC is unavailable", async () => {
    // A missing RPC must not stop Arc learning.
    const supabase = createSupabaseQueryMock({
      "rpc:match_knowledge_nodes": { data: null, error: { message: "function does not exist" } },
      knowledge_nodes: [{ data: { id: "new-2" }, error: null }],
    });
    const result = await createNode(RESTATEMENT, { client: supabase as never, orgId: ORG });
    expect(result).toEqual({ ok: true, id: "new-2" });
  });

  it("inserts when embeddings are unavailable", async () => {
    embedMock.mockResolvedValue(null);
    const supabase = createSupabaseQueryMock({ knowledge_nodes: [{ data: { id: "new-3" }, error: null }] });
    const result = await createNode(RESTATEMENT, { client: supabase as never, orgId: ORG });
    expect(result).toEqual({ ok: true, id: "new-3" });
  });

  it("inserts rather than losing the fact when the merge update fails", async () => {
    // The whole path is best-effort: a duplicate is a tolerable cost, a dropped
    // fact is not.
    const supabase = mock([EXISTING], [
      { data: { props: {} }, error: null },
      { data: null, error: { message: "update denied" } },
      { data: { id: "new-4" }, error: null },
    ]);
    const result = await createNode(RESTATEMENT, { client: supabase as never, orgId: ORG });
    expect(result).toEqual({ ok: true, id: "new-4" });
  });

  it("never merges a record-backed node by wording", async () => {
    // Two contacts can read almost identically and are not one fact.
    const supabase = mock([{ ...EXISTING, distance: 0.001 }], [{ data: { id: "new-5" }, error: null }]);
    const result = await createNode(
      { ...RESTATEMENT, refTable: "contacts", refId: "11111111-1111-4111-8111-111111111111" },
      { client: supabase as never, orgId: ORG },
    );
    expect(result).toEqual({ ok: true, id: "new-5" });
    expect(embedMock).toHaveBeenCalledTimes(1); // still embedded for storage, just not used to merge
  });
});
