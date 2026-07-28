# Semantic Recall (pgvector) SP3b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add embedding-based retrieval that widens Arc's recall: embed `knowledge_nodes` (Gemini `text-embedding-004`, pgvector), best-effort on write, and union semantic top-K candidates into `getRecallMemory` — degrading to today's behavior whenever embeddings are unavailable.

**Architecture:** New `embedText` module; a migration adding the `vector` extension + `embedding vector(768)` column + HNSW index + a `match_knowledge_nodes` RPC that returns candidate fields; a best-effort embedding write in `createNode`; an additive union in `getRecallMemory`; a backfill script. No domain changes, no runner changes.

**Tech Stack:** TypeScript, Vitest, Supabase (pgvector), `@google/genai` (already a dep).

**Test command:** `pnpm test <path>`.

**Verified facts:**
- `@google/genai`'s `GoogleGenAI` is used in `src/lib/media/gemini.ts` + `src/lib/brand-knowledge/gemini-parser.ts` (the latter reads the key via `process.env.GEMINI_API_KEY` — **confirm exact env name in `src/lib/media/index.ts` before coding**). The SDK exposes `ai.models.embedContent(...)`.
- `getBrainGraph({trustTiers}, client, orgId)` returns **bounded** nodes (`limit(NODE_CAP+1)`), so semantic can surface nodes beyond the window.
- `getRecallMemory(orgId, message, client?)` (`src/lib/knowledge-graph/recall.ts`): builds `candidates: RecallCandidate[]` from `graph.nodes`, then `selectRecall(candidates, message)` → `enrichRecall(selected, recallGraph)`.
- `RecallCandidate = { id, kind, label, summary: string|null, tags: string[], trustTier }` (`src/domain/brain-recall.ts`); `selectRecall(candidates, message, options?) → RecallCandidate[]`.
- `createNode(input, deps)` (`src/lib/knowledge-graph/persistence.ts`): inserts the node, returns `{ ok:true, id }`; `resolved = { client, orgId }`; `value` has `label/summary/body`.
- `knowledge_nodes` columns: `id, org_id, kind, label, body, summary, tags, trust_tier, …`.
- RPC pattern: `arc_create_vault_secret` (SECURITY DEFINER, service-role) in `20260619154500_google_drive_vault_rpc_wrappers.sql`.

---

## File Structure
- `src/lib/embeddings/gemini-embeddings.ts` (create) + test
- `supabase/migrations/20260621130000_knowledge_node_embeddings.sql` (create)
- `src/lib/knowledge-graph/persistence.ts` (modify — best-effort embed on createNode)
- `src/lib/knowledge-graph/recall.ts` (modify — semantic union) + test
- `scripts/backfill-embeddings.mjs` (create) + `package.json` script

---

## Task 1: `embedText` embeddings module

**Files:** Create `src/lib/embeddings/gemini-embeddings.ts` + `gemini-embeddings.test.ts`

- [ ] **Step 1: Confirm the key env name** — `rg -n "GEMINI_API_KEY|process.env" src/lib/media/index.ts`. Use that exact name below (assume `GEMINI_API_KEY`).

- [ ] **Step 2: Write the failing test** (`gemini-embeddings.test.ts`) — mock `@google/genai`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const embedContent = vi.fn();
vi.mock("@google/genai", () => ({ GoogleGenAI: vi.fn(() => ({ models: { embedContent } })) }));
import { embedText, EMBEDDING_DIMS } from "./gemini-embeddings";

const KEY = process.env.GEMINI_API_KEY;
beforeEach(() => { embedContent.mockReset(); process.env.GEMINI_API_KEY = "k"; });
afterEach(() => { if (KEY === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = KEY; });

const vec = (n: number) => Array.from({ length: n }, (_, i) => i / n);

describe("embedText", () => {
  it("returns the embedding vector on success", async () => {
    embedContent.mockResolvedValue({ embeddings: [{ values: vec(EMBEDDING_DIMS) }] });
    const out = await embedText("homeowners like fast response");
    expect(out).toHaveLength(EMBEDDING_DIMS);
  });
  it("returns null when the key is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    expect(await embedText("x")).toBeNull();
    expect(embedContent).not.toHaveBeenCalled();
  });
  it("returns null on empty text", async () => {
    expect(await embedText("   ")).toBeNull();
    expect(embedContent).not.toHaveBeenCalled();
  });
  it("returns null when the API throws", async () => {
    embedContent.mockRejectedValue(new Error("boom"));
    expect(await embedText("x")).toBeNull();
  });
  it("returns null on a wrong-sized vector", async () => {
    embedContent.mockResolvedValue({ embeddings: [{ values: vec(10) }] });
    expect(await embedText("x")).toBeNull();
  });
});
```

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Implement** `gemini-embeddings.ts`:

```typescript
import { GoogleGenAI } from "@google/genai";

export const EMBEDDING_DIMS = 768;
const EMBEDDING_MODEL = "text-embedding-004";

/**
 * Embed text with Gemini text-embedding-004 (768-dim). Returns null when the
 * key is missing, the text is empty, the call fails, or the vector is the wrong
 * size — so every caller degrades gracefully (recall falls back to keyword/graph).
 */
export async function embedText(text: string): Promise<number[] | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  const input = text?.trim();
  if (!key || !input) return null;
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const res = await ai.models.embedContent({ model: EMBEDDING_MODEL, contents: input });
    const values = res?.embeddings?.[0]?.values;
    return Array.isArray(values) && values.length === EMBEDDING_DIMS ? (values as number[]) : null;
  } catch {
    return null;
  }
}
```
> If `pnpm typecheck` shows the SDK's `embedContent` request/response shape differs (e.g. `contents` must be `[{ parts: [{ text }] }]`, or the response is `res.embedding.values`), adapt to the installed `@google/genai` version's types — keep the null-guards. Verify the exact shape from `node_modules/@google/genai` before finalizing.

- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** — `git add src/lib/embeddings && git commit -m "feat(brain): embedText — Gemini text-embedding-004 with graceful fallback"`

---

## Task 2: Migration — pgvector column + match RPC

**Files:** Create `supabase/migrations/20260621130000_knowledge_node_embeddings.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Semantic recall (SP3b): embeddings on knowledge_nodes + a cosine-match RPC.
create extension if not exists vector;

alter table public.knowledge_nodes
  add column if not exists embedding vector(768);

create index if not exists knowledge_nodes_embedding_idx
  on public.knowledge_nodes using hnsw (embedding vector_cosine_ops);

-- Service-role-only cosine match. Returns candidate fields (not just ids) so the
-- recall path needs no second query. query_embedding arrives as text ('[..]') and
-- is cast to vector to avoid PostgREST array-binding ambiguity.
create or replace function public.match_knowledge_nodes(
  query_embedding text,
  match_org_id uuid,
  match_count int,
  tiers text[]
)
returns table (id uuid, kind text, label text, summary text, tags text[], trust_tier text, distance float)
language sql
security definer
set search_path = public
as $$
  select n.id, n.kind, n.label, n.summary, n.tags, n.trust_tier,
         (n.embedding <=> query_embedding::vector) as distance
  from public.knowledge_nodes n
  where n.org_id = match_org_id
    and n.trust_tier = any(tiers)
    and n.embedding is not null
  order by n.embedding <=> query_embedding::vector
  limit match_count;
$$;

revoke all on function public.match_knowledge_nodes(text, uuid, int, text[]) from public;
grant execute on function public.match_knowledge_nodes(text, uuid, int, text[]) to service_role;
```

- [ ] **Step 2: Commit** — `git add supabase/migrations/20260621130000_knowledge_node_embeddings.sql && git commit -m "feat(brain): knowledge_nodes embedding column + match_knowledge_nodes RPC"`

> **Deploy note (plan-level):** this migration + a one-time backfill (Task 5) are applied by hand on prod `qqbecyrhnowmooyjiztz`. pgvector is supported by Supabase (`create extension vector`). Flag for the operator at PR time.

---

## Task 3: Best-effort embedding on `createNode`

**Files:** Modify `src/lib/knowledge-graph/persistence.ts`; test `persistence.test.ts` (if present) or a new colocated test

- [ ] **Step 1: Add a failing test** (mirror the file's existing Supabase-mock style; if no persistence test exists, add `persistence.embeddings.test.ts`)

Assert: when `createNode` succeeds, `embedText` is called with the node's `label/summary/body` text and `knowledge_nodes` receives an `update({ embedding })` for the new id; and when `embedText` returns `null`, no update is attempted and `createNode` still returns `{ ok:true }`; and when the update errors, `createNode` STILL returns `{ ok:true }` (best-effort). Mock `@/lib/embeddings/gemini-embeddings`'s `embedText`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — in `persistence.ts`, import `embedText`, and after the successful insert (`if (!data?.id) …; ` then before `return { ok:true, id: data.id }`):

```typescript
  // Best-effort: make the node semantically searchable. A failure here must
  // never fail node creation (recall degrades to keyword/graph without it).
  await embedNodeBestEffort(client, orgId, data.id, value);
  return { ok: true, id: data.id };
```
and add the helper (module-private):
```typescript
async function embedNodeBestEffort(
  client: TypedSupabaseClient,
  orgId: string,
  id: string,
  value: { label: string; summary: string | null; body: string | null },
): Promise<void> {
  try {
    const text = [value.label, value.summary, value.body].filter(Boolean).join("\n").trim();
    const embedding = await embedText(text);
    if (!embedding) return;
    await client.from("knowledge_nodes").update({ embedding: JSON.stringify(embedding) as never }).eq("id", id).eq("org_id", orgId);
  } catch {
    // swallow — best-effort
  }
}
```
(`JSON.stringify(embedding)` yields `[0.1,0.2,…]`, valid pgvector text input. The `as never` matches how the file already casts jsonb/array columns the generated types don't model.)

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add src/lib/knowledge-graph/persistence.ts <test> && git commit -m "feat(brain): best-effort embed knowledge nodes on create"`

---

## Task 4: Semantic union in `getRecallMemory`

**Files:** Modify `src/lib/knowledge-graph/recall.ts`; test `recall.test.ts`

- [ ] **Step 1: Add failing tests** (`recall.test.ts` — mock `getBrainGraph`, `embedText`, and the client's `.rpc`)

Cases:
- **Regression guard:** when `embedText → null`, the candidate set + result equal today's (no `.rpc` call; `selectRecall` sees only graph candidates).
- **Union:** when `embedText` returns a vector and `.rpc("match_knowledge_nodes", …)` returns a node id NOT in the graph window, that node appears as a candidate (assert it survives into the result, or that `selectRecall` received it). Dedup: a semantic id already in the graph isn't duplicated.

```typescript
// shape sketch — adapt to the file's mocking
vi.mock("./graph", () => ({ getBrainGraph: vi.fn() }));
vi.mock("@/lib/embeddings/gemini-embeddings", () => ({ embedText: vi.fn() }));
// graph returns nodes [g1]; rpc returns [{id:"s1", kind, label, summary, tags, trust_tier, distance}]
// → expect s1 present in candidates passed to selectRecall (spy) and not duplicated when rpc returns g1
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** the union in `recall.ts`:

```typescript
import { embedText } from "@/lib/embeddings/gemini-embeddings";

const SEMANTIC_K = 12;

/** Top-K semantically-nearest nodes for the message, as RecallCandidates. [] when embeddings unavailable. */
async function semanticCandidates(
  orgId: string,
  message: string,
  client: TypedSupabaseClient,
): Promise<RecallCandidate[]> {
  const embedding = await embedText(message);
  if (!embedding) return [];
  const { data, error } = await client.rpc("match_knowledge_nodes", {
    query_embedding: JSON.stringify(embedding),
    match_org_id: orgId,
    match_count: SEMANTIC_K,
    tiers: ["trusted", "observed"],
  });
  if (error || !Array.isArray(data)) return [];
  return (data as Array<{ id: string; kind: string; label: string; summary: string | null; tags: string[] | null; trust_tier: string }>).map((r) => ({
    id: r.id, kind: r.kind, label: r.label, summary: r.summary, tags: r.tags ?? [], trustTier: r.trust_tier as RecallCandidate["trustTier"],
  }));
}
```
Then in `getRecallMemory`, after building `candidates` and BEFORE `selectRecall`, union the semantic candidates (requires a `client` — `getBrainGraph` already resolves one; thread the resolved client, or fetch a default admin client when `client` is undefined, mirroring how `getBrainGraph` resolves it):

```typescript
  const seen = new Set(candidates.map((c) => c.id));
  for (const c of await semanticCandidates(orgId, message, client ?? getSupabaseAdminClient())) {
    if (!seen.has(c.id)) { candidates.push(c); seen.add(c.id); }
  }

  const selected = selectRecall(candidates, message);
```
(Import `getSupabaseAdminClient` from `@/lib/supabase/server` if not already; guard with `isSupabaseAdminConfigured()` so an unconfigured env still no-ops. If `getBrainGraph` returned live, Supabase is configured, so the client is safe — but keep the guard for clarity.)

- [ ] **Step 4: Run → PASS** (both the union case and the regression guard).
- [ ] **Step 5: Commit** — `git add src/lib/knowledge-graph/recall.ts src/lib/knowledge-graph/recall.test.ts && git commit -m "feat(brain): blend semantic top-K into recall (additive, graceful)"`

---

## Task 5: Backfill script

**Files:** Create `scripts/backfill-embeddings.mjs`; add a `package.json` script

- [ ] **Step 1: Write the script** — connects with the service-role key (mirror an existing `scripts/seed-*.mjs` for client setup), selects `knowledge_nodes` where `embedding is null` and `trust_tier in ('trusted','observed')` in batches (e.g. 50), embeds `label+summary+body` via the same Gemini call, and updates `embedding`. Idempotent (only null rows); logs counts; continues past per-row errors.
> Reuse the embedding logic: import from the built lib if the script runner supports TS, else inline the same `embedContent` call. Match an existing script's env loading (`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `GEMINI_API_KEY`).

- [ ] **Step 2: Add the npm script** — in `package.json` scripts: `"backfill:embeddings": "node scripts/backfill-embeddings.mjs"`.

- [ ] **Step 3: Commit** — `git add scripts/backfill-embeddings.mjs package.json && git commit -m "chore(brain): backfill script for knowledge-node embeddings"`

> Run `pnpm backfill:embeddings` once, post-migration, against prod env (operator step; documented in the PR).

---

## Task 6: Sweep + build

- [ ] **Step 1:** `pnpm test src/lib/embeddings src/lib/knowledge-graph/recall.test.ts` (+ the persistence embedding test) → pass.
- [ ] **Step 2:** `pnpm build` → succeeds (`pnpm install` first if deps missing). Fix only feature-caused failures (notably the `@google/genai` embedContent type shape).
- [ ] **Step 3 (if fixups):** `git add -A && git commit -m "test(brain): semantic-recall verification fixups"`

---

## Self-Review (plan author)

- **Spec coverage:** embeddings module → T1; schema + RPC → T2; best-effort write hook → T3; additive recall union → T4; backfill → T5; sweep → T6. All spec sections covered.
- **Refinement vs spec:** the RPC returns candidate fields (not just id+distance) so recall needs no second query — noted. The blend unions semantic candidates **into the candidate set before `selectRecall`** (correct because `getBrainGraph` is bounded, so semantic can add nodes beyond the window); confirmed against the real `getRecallMemory` body.
- **Placeholder scan:** none. Two explicit "verify against the installed `@google/genai`/`src/lib/media/index.ts`" checks (the SDK response shape + the key env name) — deliberate version-pinning steps, not vague TODOs.
- **Type consistency:** `embedText(): Promise<number[]|null>` used by the write hook + recall. `semanticCandidates → RecallCandidate[]` matches `selectRecall`'s input. RPC return columns map 1:1 to `RecallCandidate`. `getRecallMemory(orgId, message, client?)` arg order preserved.
- **Safety / regression:** additive union (semantic only adds, dedup by id); `embedText → null` ⇒ no `.rpc`, candidates == today (explicit regression test); best-effort write can't fail `createNode`; migration additive (`add column if not exists`); RPC service-role only. No outbound/approval/runner change.
