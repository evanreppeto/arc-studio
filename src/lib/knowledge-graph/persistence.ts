import {
  type ApprovalDecision,
  type DedupCandidate,
  appendMergeRecord,
  decideBrainDedup,
  type KnowledgeEdgeInput,
  type KnowledgeNodeInput,
  type NodeAuthor,
  embedHash,
  normalizeKind,
  normalizeTags,
  resolveDecisionTier,
  resolveInitialTrustTier,
  validateEdgeInput,
  validateNodeInput,
} from "@/domain";
import { getCurrentOrgId } from "@/lib/auth/org";
import { embedText } from "@/lib/embeddings/gemini-embeddings";
import { type TypedSupabaseClient, getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

export type WriteResult = { ok: true; id: string } | { ok: false; error: string };

const NOT_CONFIGURED = "Supabase is not configured, so nothing was written.";
const MISSING_WRITE_ID = "Write succeeded but did not return an id.";

type WriteDeps = {
  client?: TypedSupabaseClient;
  orgId?: string;
  /** "arc" gates gated kinds to proposed; "operator" trusts immediately. */
  createdBy?: NodeAuthor;
  /** Display name stamped as approver when an operator creates a trusted node. */
  actor?: string;
};

async function resolveDeps(deps: WriteDeps): Promise<{ client: TypedSupabaseClient; orgId: string } | null> {
  if (deps.client && deps.orgId) return { client: deps.client, orgId: deps.orgId };
  if (!isSupabaseAdminConfigured()) return null;
  return { client: deps.client ?? getSupabaseAdminClient(), orgId: deps.orgId ?? (await getCurrentOrgId()) };
}

export async function createNode(input: KnowledgeNodeInput, deps: WriteDeps = {}): Promise<WriteResult> {
  const parsed = validateNodeInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const resolved = await resolveDeps(deps);
  if (!resolved) return { ok: false, error: NOT_CONFIGURED };
  const { client, orgId } = resolved;
  const createdBy = deps.createdBy ?? "arc";
  const value = parsed.value;
  // Tier is ALWAYS derived — never trusted from the caller. Arc cannot self-approve.
  const trustTier = resolveInitialTrustTier({ kind: value.kind, createdBy });
  const approvedBy = trustTier === "trusted" && createdBy === "operator" ? deps.actor ?? "Operator" : null;

  // Embedded ONCE and shared. Dedup and the stored vector need the same
  // embedding of the same text; computing it twice would double the embedding
  // cost and latency of every fact Arc learns.
  const embedding = await embedNodeTextBestEffort(value);

  // Same fact, different words? Fold it into the node that already says it
  // rather than adding a fifth phrasing (BSR-531). Best-effort: any failure
  // here falls through to a normal insert — a duplicate is a far cheaper
  // outcome than a lost write.
  const mergedInto = await mergeRestatementBestEffort(client, orgId, value, createdBy, embedding);
  if (mergedInto) return { ok: true, id: mergedInto };

  const { data, error } = await client
    .from("knowledge_nodes")
    .insert({
      org_id: orgId,
      kind: value.kind,
      // NOT normalised, deliberately. Prod holds `crm_contacts_empty`,
      // `crm-empty-state` and `CRM state` for one fact, so normalising here is
      // tempting — but keys are also STRUCTURED identifiers built and matched
      // exactly elsewhere (`media_asset:<uuid>:<category>` in
      // brand-knowledge/brain-sync, compared against a Set of stored keys).
      // Rewriting them on the way in silently breaks that exact-match dedup and
      // re-inserts the same node on every sync. Collapsing key styles needs a
      // backfill that migrates readers too; semantic dedup above is what
      // actually catches the restatements.
      key: value.key,
      label: value.label,
      body: value.body,
      summary: value.summary,
      persona: value.persona as never,
      trust_tier: trustTier,
      confidence: value.confidence,
      ref_table: value.refTable,
      ref_id: value.refId,
      source: value.source ?? createdBy,
      source_reference: value.sourceReference,
      created_by: createdBy,
      approved_by: approvedBy,
      approved_at: approvedBy ? new Date().toISOString() : null,
      tags: value.tags ?? [],
      props: (value.props ?? {}) as never,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) return { ok: false, error: error.message };
  if (!data?.id) return { ok: false, error: MISSING_WRITE_ID };
  // Best-effort: make the node semantically searchable. A failure here must
  // never fail node creation (recall degrades to keyword/graph without it).
  await storeEmbeddingBestEffort(client, orgId, data.id, embedding);
  return { ok: true, id: data.id };
}

/** How many neighbours to consider. Only the nearest can win, so this is small. */
const DEDUP_CANDIDATES = 5;

/**
 * Merge a restatement into the node that already holds the fact, and return
 * that node's id. Null means "insert normally".
 *
 * Everything here degrades to null. Embeddings unavailable, RPC missing, update
 * failed — all end in a plain insert. A duplicate fact is a known, tolerable
 * cost; a dropped one is not, and this runs on the write path for every fact
 * Arc learns.
 */
async function mergeRestatementBestEffort(
  client: TypedSupabaseClient,
  orgId: string,
  value: { kind: string; key?: string | null; label: string; summary?: string | null; body?: string | null; refId?: string | null },
  createdBy: NodeAuthor,
  embedding: number[] | null,
): Promise<string | null> {
  try {
    // Record mirrors are identified by what they point at, not by wording.
    if (value.refId) return null;
    if (!embedding) return null;

    const { data, error } = await (
      client as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
      }
    ).rpc("match_knowledge_nodes", {
      query_embedding: JSON.stringify(embedding),
      match_org_id: orgId,
      match_count: DEDUP_CANDIDATES,
      // `proposed` included on purpose: a fact awaiting review should absorb its
      // own restatement rather than queue a second copy for the same decision.
      tiers: ["trusted", "observed", "proposed"],
    });
    if (error || !Array.isArray(data)) return null;

    const candidates: DedupCandidate[] = (
      data as Array<{ id: string; kind: string; label: string; summary: string | null; trust_tier: string; distance: number | null }>
    ).map((row) => ({
      id: row.id,
      kind: row.kind,
      label: row.label,
      summary: row.summary,
      trustTier: row.trust_tier,
      // The RPC orders by pgvector's `<=>` — cosine distance, 0 = identical.
      ...(typeof row.distance === "number" ? { similarity: 1 - row.distance } : {}),
    }));

    const decision = decideBrainDedup({ kind: value.kind, label: value.label, summary: value.summary }, candidates);
    if (decision.action !== "merge") return null;

    // Read the winner's props so the merged wording is retained rather than
    // dropped — a merge has to stay recoverable.
    const existing = await client
      .from("knowledge_nodes")
      .select("props")
      .eq("id", decision.into)
      .eq("org_id", orgId)
      .maybeSingle<{ props: Record<string, unknown> | null }>();
    if (existing.error) return null;

    const props = existing.data?.props ?? {};
    const merges = appendMergeRecord((props as { brainMerges?: unknown }).brainMerges, {
      label: value.label,
      summary: value.summary ?? null,
      key: value.key ?? null,
      similarity: decision.similarity,
      at: new Date().toISOString(),
      source: createdBy,
    });

    const { error: updateError } = await client
      .from("knowledge_nodes")
      // `updated_at` is the "latest confirmation": a fact restated today is
      // fresher than the same fact last asserted in March, and recency is what
      // decay will rank on.
      .update({ props: { ...props, brainMerges: merges }, updated_at: new Date().toISOString() } as never)
      .eq("id", decision.into)
      .eq("org_id", orgId);
    if (updateError) return null;

    return decision.into;
  } catch {
    return null; // best-effort by design — see the doc comment
  }
}

/** The node's text as one vector, or null when embeddings are unavailable. */
async function embedNodeTextBestEffort(value: {
  label: string;
  summary?: string | null;
  body?: string | null;
}): Promise<number[] | null> {
  try {
    const text = [value.label, value.summary, value.body].filter(Boolean).join("\n").trim();
    if (!text) return null;
    return (await embedText(text)) ?? null;
  } catch {
    return null; // swallow — best-effort
  }
}

async function storeEmbeddingBestEffort(
  client: TypedSupabaseClient,
  orgId: string,
  id: string,
  embedding: number[] | null,
): Promise<void> {
  try {
    if (!embedding) return;
    await client.from("knowledge_nodes").update({ embedding: JSON.stringify(embedding) } as never).eq("id", id).eq("org_id", orgId);
  } catch {
    // swallow — best-effort
  }
}

export async function createEdge(input: KnowledgeEdgeInput, deps: WriteDeps = {}): Promise<WriteResult> {
  const parsed = validateEdgeInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const resolved = await resolveDeps(deps);
  if (!resolved) return { ok: false, error: NOT_CONFIGURED };
  const { client, orgId } = resolved;
  const createdBy = deps.createdBy ?? "arc";
  const trustTier = createdBy === "operator" ? "trusted" : "observed";

  const { data, error } = await client
    .from("knowledge_edges")
    .insert({
      org_id: orgId,
      from_node_id: parsed.value.fromNodeId,
      to_node_id: parsed.value.toNodeId,
      relation: parsed.value.relation,
      weight: parsed.value.weight,
      trust_tier: trustTier,
      source: parsed.value.source ?? createdBy,
      created_by: createdBy,
      approved_by: createdBy === "operator" ? deps.actor ?? "Operator" : null,
      approved_at: createdBy === "operator" ? new Date().toISOString() : null,
      props: (parsed.value.props ?? {}) as never,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) return { ok: false, error: error.message };
  if (!data?.id) return { ok: false, error: MISSING_WRITE_ID };
  return { ok: true, id: data.id };
}

/** Approve or reject a proposed node (operator only). */
export async function decideNode(
  nodeId: string,
  decision: ApprovalDecision,
  deps: WriteDeps & { actor?: string } = {},
): Promise<WriteResult> {
  const resolved = await resolveDeps(deps);
  if (!resolved) return { ok: false, error: NOT_CONFIGURED };
  const { client, orgId } = resolved;

  const current = await client
    .from("knowledge_nodes")
    .select("id,trust_tier")
    .eq("id", nodeId)
    .eq("org_id", orgId)
    .maybeSingle<{ id: string; trust_tier: string }>();
  if (current.error) return { ok: false, error: current.error.message };
  if (!current.data) return { ok: false, error: "Node not found." };

  const next = resolveDecisionTier(current.data.trust_tier as never, decision);
  if (!next.ok) return { ok: false, error: next.error };

  const actor = deps.actor ?? "Operator";
  const { data, error } = await client
    .from("knowledge_nodes")
    .update({
      trust_tier: next.value,
      approved_by: decision === "approve" ? actor : null,
      approved_at: decision === "approve" ? new Date().toISOString() : null,
    })
    .eq("id", nodeId)
    .eq("org_id", orgId)
    .select("id")
    .single<{ id: string }>();
  if (error) return { ok: false, error: error.message };
  if (!data?.id) return { ok: false, error: MISSING_WRITE_ID };
  return { ok: true, id: data.id };
}

/**
 * Edit a node's label and/or body (operator-curated). Trust tier is untouched —
 * the operator is the human gate, so an edit doesn't bounce the node to review.
 */
export async function updateNode(
  nodeId: string,
  fields: { label?: string; body?: string | null },
  deps: WriteDeps = {},
): Promise<WriteResult> {
  const patch: { label?: string; body?: string | null } = {};
  if (fields.label !== undefined) {
    const label = fields.label.trim();
    if (!label) return { ok: false, error: "A node needs a label." };
    patch.label = label;
  }
  if (fields.body !== undefined) {
    patch.body = (fields.body ?? "").trim() || null;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update." };

  const resolved = await resolveDeps(deps);
  if (!resolved) return { ok: false, error: NOT_CONFIGURED };
  const { client, orgId } = resolved;
  const { data, error } = await client
    .from("knowledge_nodes")
    .update(patch)
    .eq("id", nodeId)
    .eq("org_id", orgId)
    .select("id")
    .single<{ id: string }>();
  if (error) return { ok: false, error: error.message };
  if (!data?.id) return { ok: false, error: MISSING_WRITE_ID };
  return { ok: true, id: data.id };
}

/**
 * Change a node's kind (operator-curated). Accepts built-in or custom kinds via
 * normalizeKind. The trust tier is left untouched — this only re-labels the node.
 */
export async function setNodeKind(
  nodeId: string,
  kind: string,
  deps: WriteDeps = {},
): Promise<WriteResult> {
  const normalized = normalizeKind(kind);
  if (!normalized) return { ok: false, error: "That kind isn't valid (start with a letter; letters, numbers, underscores)." };
  const resolved = await resolveDeps(deps);
  if (!resolved) return { ok: false, error: NOT_CONFIGURED };
  const { client, orgId } = resolved;
  const { data, error } = await client
    .from("knowledge_nodes")
    .update({ kind: normalized })
    .eq("id", nodeId)
    .eq("org_id", orgId)
    .select("id")
    .single<{ id: string }>();
  if (error) return { ok: false, error: error.message };
  if (!data?.id) return { ok: false, error: MISSING_WRITE_ID };
  return { ok: true, id: data.id };
}

/** Replace a node's freeform tags (operator-curated metadata, not gated). */
export async function setNodeTags(
  nodeId: string,
  tags: string[],
  deps: WriteDeps = {},
): Promise<WriteResult> {
  const resolved = await resolveDeps(deps);
  if (!resolved) return { ok: false, error: NOT_CONFIGURED };
  const { client, orgId } = resolved;
  const { data, error } = await client
    .from("knowledge_nodes")
    .update({ tags: normalizeTags(tags) })
    .eq("id", nodeId)
    .eq("org_id", orgId)
    .select("id")
    .single<{ id: string }>();
  if (error) return { ok: false, error: error.message };
  if (!data?.id) return { ok: false, error: MISSING_WRITE_ID };
  return { ok: true, id: data.id };
}

/**
 * Insert-or-update a node keyed on (org_id, kind, key), so a repeat write updates the
 * same row instead of duplicating. Two callers: CRM → Brain ingestion (an edited record
 * updates its mirror) and chat memory promotion (a re-learned fact refreshes one node).
 * Always authored "arc" (non-gated kinds resolve to "observed"). Re-embeds only when the
 * embed text hash changed — so an updated fact stays semantically recallable without
 * paying to re-embed unchanged ones. Trust tier is left untouched on update.
 */
export async function upsertReferenceNode(input: KnowledgeNodeInput, deps: WriteDeps = {}): Promise<WriteResult> {
  const parsed = validateNodeInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const value = parsed.value;
  const key = value.key;
  if (!key) return { ok: false, error: "upsertReferenceNode requires a key." };

  const resolved = await resolveDeps(deps);
  if (!resolved) return { ok: false, error: NOT_CONFIGURED };
  const { client, orgId } = resolved;

  const embedTextValue = [value.label, value.summary, value.body].filter(Boolean).join("\n").trim();
  const hash = embedHash(embedTextValue);

  const existing = await client
    .from("knowledge_nodes")
    .select("id, props")
    .eq("org_id", orgId)
    .eq("kind", value.kind)
    .eq("key", key)
    .maybeSingle<{ id: string; props: Record<string, unknown> | null }>();
  if (existing.error) return { ok: false, error: existing.error.message };

  if (existing.data) {
    const id = existing.data.id;
    const prevHash = (existing.data.props as { embed_hash?: string } | null)?.embed_hash;
    const { error } = await client
      .from("knowledge_nodes")
      .update({
        label: value.label,
        summary: value.summary,
        body: value.body,
        persona: value.persona as never,
        ref_table: value.refTable,
        ref_id: value.refId,
        source: value.source ?? "crm-sync",
        tags: value.tags ?? [],
        props: { ...(existing.data.props ?? {}), embed_hash: hash } as never,
      })
      .eq("id", id)
      .eq("org_id", orgId);
    if (error) return { ok: false, error: error.message };
    if (prevHash !== hash) await embedReferenceBestEffort(client, orgId, id, embedTextValue);
    return { ok: true, id };
  }

  const trustTier = resolveInitialTrustTier({ kind: value.kind, createdBy: "arc" });
  const { data, error } = await client
    .from("knowledge_nodes")
    .insert({
      org_id: orgId,
      kind: value.kind,
      key,
      label: value.label,
      body: value.body,
      summary: value.summary,
      persona: value.persona as never,
      trust_tier: trustTier,
      confidence: value.confidence,
      ref_table: value.refTable,
      ref_id: value.refId,
      source: value.source ?? "crm-sync", // CRM-origin default (unlike createNode's createdBy default)
      source_reference: value.sourceReference,
      created_by: "arc",
      approved_by: null,
      approved_at: null,
      tags: value.tags ?? [],
      props: { ...(value.props ?? {}), embed_hash: hash } as never,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    // Concurrent sync already inserted this (org_id, kind, key). Treat the unique
    // violation as benign: re-read and return the existing node.
    if ((error as { code?: string }).code === "23505") {
      const retry = await client
        .from("knowledge_nodes")
        .select("id")
        .eq("org_id", orgId)
        .eq("kind", value.kind)
        .eq("key", key)
        .maybeSingle<{ id: string }>();
      if (retry.data?.id) return { ok: true, id: retry.data.id };
    }
    return { ok: false, error: error.message };
  }
  if (!data?.id) return { ok: false, error: MISSING_WRITE_ID };
  await embedReferenceBestEffort(client, orgId, data.id, embedTextValue);
  return { ok: true, id: data.id };
}

/**
 * Insert-or-return an edge keyed on (org_id, from_node_id, relation, to_node_id).
 * Used by CRM → Brain auto-linking so re-syncing a record doesn't duplicate edges.
 * Always authored "arc" → trust tier "observed" (included in recall, never gated).
 * A 23505 from a concurrent insert is treated as benign.
 */
export async function upsertReferenceEdge(
  fromNodeId: string,
  toNodeId: string,
  relation: string,
  deps: WriteDeps = {},
): Promise<WriteResult> {
  const parsed = validateEdgeInput({ fromNodeId, toNodeId, relation });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const resolved = await resolveDeps(deps);
  if (!resolved) return { ok: false, error: NOT_CONFIGURED };
  const { client, orgId } = resolved;
  const { fromNodeId: from, toNodeId: to, relation: rel } = parsed.value;

  const existing = await client
    .from("knowledge_edges")
    .select("id")
    .eq("org_id", orgId)
    .eq("from_node_id", from)
    .eq("relation", rel)
    .eq("to_node_id", to)
    .maybeSingle<{ id: string }>();
  if (existing.error) return { ok: false, error: existing.error.message };
  if (existing.data?.id) return { ok: true, id: existing.data.id };

  const { data, error } = await client
    .from("knowledge_edges")
    .insert({
      org_id: orgId,
      from_node_id: from,
      to_node_id: to,
      relation: rel,
      weight: parsed.value.weight,
      trust_tier: "observed",
      source: parsed.value.source ?? "crm-sync",
      created_by: "arc",
      approved_by: null,
      approved_at: null,
      props: (parsed.value.props ?? {}) as never,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const retry = await client
        .from("knowledge_edges")
        .select("id")
        .eq("org_id", orgId)
        .eq("from_node_id", from)
        .eq("relation", rel)
        .eq("to_node_id", to)
        .maybeSingle<{ id: string }>();
      if (retry.data?.id) return { ok: true, id: retry.data.id };
    }
    return { ok: false, error: error.message };
  }
  if (!data?.id) return { ok: false, error: MISSING_WRITE_ID };
  return { ok: true, id: data.id };
}

/** Embed pre-joined text; never throws (recall degrades to keyword/graph). */
async function embedReferenceBestEffort(client: TypedSupabaseClient, orgId: string, id: string, text: string): Promise<void> {
  try {
    const embedding = await embedText(text);
    if (!embedding) return;
    await client.from("knowledge_nodes").update({ embedding: JSON.stringify(embedding) } as never).eq("id", id).eq("org_id", orgId);
  } catch {
    // best-effort
  }
}

/** Soft-archive a node. */
export async function archiveNode(nodeId: string, deps: WriteDeps = {}): Promise<WriteResult> {
  const resolved = await resolveDeps(deps);
  if (!resolved) return { ok: false, error: NOT_CONFIGURED };
  const { client, orgId } = resolved;
  const { data, error } = await client
    .from("knowledge_nodes")
    .update({ trust_tier: "archived" })
    .eq("id", nodeId)
    .eq("org_id", orgId)
    .select("id")
    .single<{ id: string }>();
  if (error) return { ok: false, error: error.message };
  if (!data?.id) return { ok: false, error: MISSING_WRITE_ID };
  return { ok: true, id: data.id };
}
