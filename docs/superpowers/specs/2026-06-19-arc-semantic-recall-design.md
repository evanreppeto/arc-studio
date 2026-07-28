# Semantic Recall (pgvector) — SP3b Design

**Date:** 2026-06-19
**Status:** Approved (design) — pending spec review
**Scope:** Add embedding-based ("semantic") retrieval to Arc's memory recall so it surfaces relevant past learnings/facts even when the wording differs — the last unbuilt second-brain piece. Additive: semantic results *widen* the existing keyword+graph recall, never replace it.

> Completes the second brain. SP1 brand-learning, SP2 cross-chat recall, SP3a graph traversal are live; this is **SP3b** (semantic/embedding retrieval), tracked as the only remaining piece.

## Problem

`getRecallMemory(message, …)` (`src/lib/knowledge-graph/recall.ts`) recalls by pulling trusted+observed `knowledge_nodes`, scoring them against the message with `selectRecall` (keyword/overlap + graph traversal via `enrichRecall`), and returning the top `RecallItem`s shown to Arc as "WHAT YOU REMEMBER." This misses memories phrased differently from the current message (synonyms, paraphrases, related concepts). Embedding retrieval closes that gap: a learning recorded as "homeowners respond to fast-response framing" should surface for a chat about "speed messaging for residential leads."

## What exists (reuse)

- `knowledge_nodes` (`20260612210000_marketing_brain_knowledge_graph.sql`): `id uuid, org_id, kind, label, body, summary, persona, trust_tier, …`. No embedding column yet.
- `createNode(input, deps)` (`src/lib/knowledge-graph/persistence.ts`) — the single write path for nodes (the hook for generating embeddings on write).
- `getRecallMemory(message, client?, orgId?)` → candidates → `selectRecall(candidates, message)` → `enrichRecall(…)` (`src/lib/knowledge-graph/recall.ts` + `@/domain` brain-recall).
- `getBrainGraph({ trustTiers })` (`src/lib/knowledge-graph/graph.ts`) — the graph/candidate source.
- Gemini API key + `src/lib/media/gemini.ts` (image/video today; no embeddings yet).
- The SECURITY DEFINER RPC pattern from `arc_create_vault_secret`/`arc_read_vault_secret` (vault wrappers) — the model for the cosine-match RPC.

## Architecture

### a. Embeddings module — `src/lib/embeddings/gemini-embeddings.ts` (new)
- `embedText(text: string): Promise<number[] | null>` — calls Gemini **`text-embedding-004`** (`:embedContent`, 768-dim) with the existing key. Returns `null` when the key is missing, the text is empty, or the call errors (callers degrade gracefully). Pure-ish I/O wrapper; unit-tested with a mocked `fetch`.
- Constant `EMBEDDING_DIMS = 768`.

### b. Schema — migration `…_knowledge_node_embeddings.sql`
- `create extension if not exists vector;`
- `alter table public.knowledge_nodes add column if not exists embedding vector(768);`
- HNSW cosine index: `create index if not exists knowledge_nodes_embedding_idx on public.knowledge_nodes using hnsw (embedding vector_cosine_ops);`
- A SECURITY DEFINER RPC for retrieval (service-role only):
  `match_knowledge_nodes(query_embedding vector(768), match_org_id uuid, match_count int, tiers text[]) returns table(id uuid, distance float)` → `select id, embedding <=> query_embedding as distance from knowledge_nodes where org_id = match_org_id and trust_tier = any(tiers) and embedding is not null order by embedding <=> query_embedding limit match_count`.
- **Operational:** applied by hand on prod `qqbecyrhnowmooyjiztz` (pgvector is supported by Supabase). Captured in this migration; flagged in the plan.

### c. Write hook (best-effort) — `createNode`
- After a node persists, generate its embedding from `label + summary + body` and `update knowledge_nodes set embedding = … where id = …`. **Best-effort**: wrapped so an embedding failure never fails node creation (same posture as `linkConversationToCampaign`). New facts/learnings become semantically searchable as written.

### d. Semantic retrieval + blend — `getRecallMemory`
- New helper `semanticCandidateIds(message, orgId, client)` in the recall lib: `embedText(message)` → if `null`, return `[]`; else `client.rpc("match_knowledge_nodes", { query_embedding, match_org_id: orgId, match_count: K, tiers: ["trusted","observed"] })` → ids.
- In `getRecallMemory`: after building the graph candidates, fetch the semantic ids and **union** any not already present (look them up from the same graph, or fetch the missing nodes) into the candidate set passed to `selectRecall`. Ranking/selection unchanged — semantic only *adds* candidates the keyword/graph pass missed. **No embeddings / no key → identical to today's behavior** (pure widening).

### e. Backfill — `scripts/backfill-embeddings.mjs` (+ `pnpm` script)
- Batch over trusted/observed `knowledge_nodes where embedding is null`, embed `label+summary+body`, update. Idempotent (skips already-embedded). Run once after the migration; safe to re-run.

## Data flow

```
write:  createNode → persist node → embedText(label+summary+body) → update embedding   [best-effort]
recall: getRecallMemory(message)
          → graph candidates (today)            ──┐
          → embedText(message) → match_knowledge_nodes RPC → top-K ids → fetch nodes ──┤ union
          → selectRecall(candidates, message) → enrichRecall → RecallItem[]            ─┘
        (no key/error on either embed → falls back to exactly today's candidate set)
```

## Testing

- **`embedText`**: mocked `fetch` → returns 768-vector; `null` on missing key / empty text / non-200 / network error.
- **`semanticCandidateIds`** / **`getRecallMemory` blend**: with a mocked embed + mocked `rpc`, semantic ids are unioned into candidates; with `embedText → null`, the candidate set equals today's (regression guard). (Mock the client + embeddings.)
- **RPC**: SQL-level smoke (manual, post-deploy) — `match_knowledge_nodes` returns rows ordered by distance.
- Full `pnpm build`.

## Safety & degradation

- Recall stays read-only; the write-path embedding is best-effort and cannot break node creation.
- **Graceful everywhere:** missing `GEMINI_API_KEY`, embedding errors, or an unmigrated DB → recall silently behaves as it does today. Additive design = no regression risk.
- No outbound/approval-gate change. Only new external call is the embeddings API (behind the existing key + guards).
- App + lib → Vercel; runner unaffected (recall runs app-side behind `/api/v1/arc/brain/recall`). The migration + backfill are manual prod steps.

## Out of scope

- Re-embedding on node *edits* (v1 embeds on create + backfill; edits are rare and the next backfill catches them).
- Embedding non-brain tables (CRM, campaigns) — knowledge_nodes only.
- Swapping the keyword/graph recall for pure-vector — this augments, not replaces.
- A larger/newer embedding model or dimensionality tuning (start at `text-embedding-004` / 768).
