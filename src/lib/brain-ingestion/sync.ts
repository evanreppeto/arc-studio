import {
  buildEdgesForCampaign,
  buildEdgesForCampaignResult,
  buildEdgesForCrmRow,
  buildNodeInputForCampaign,
  buildNodeInputForCampaignResult,
  buildNodeInputForCrmRow,
  buildNodeInputForMedia,
  buildPersonaNodeInput,
  crmChildRefs,
  crmNodeKey,
  mediaNodeKey,
  MEDIA_NODE_KIND,
  CRM_NODE_KINDS,
  type CrmEdgeSpec,
  type CrmIngestTable,
} from "@/domain";
import { getCurrentOrgId } from "@/lib/auth/org";
import { embedText } from "@/lib/embeddings/gemini-embeddings";
import { upsertReferenceEdge, upsertReferenceNode, type WriteResult } from "@/lib/knowledge-graph/persistence";
import { type TypedSupabaseClient, getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

export const CRM_INGEST_TABLES: CrmIngestTable[] = ["companies", "contacts", "leads", "properties", "jobs", "outcomes"];

type SyncDeps = { client?: TypedSupabaseClient; orgId?: string };

async function resolve(deps: SyncDeps): Promise<{ client: TypedSupabaseClient; orgId: string } | null> {
  if (deps.client && deps.orgId) return { client: deps.client, orgId: deps.orgId };
  if (!isSupabaseAdminConfigured()) return null;
  return { client: deps.client ?? getSupabaseAdminClient(), orgId: deps.orgId ?? (await getCurrentOrgId()) };
}

/**
 * `campaigns.org_id` exists at runtime (migration 20260619113000) but is missing
 * from the stale generated types, so a direct `.eq("org_id", …)` fails tsc. Cast
 * to scope by org, mirroring the campaigns read-model's applyOrgScope.
 */
function eqOrg<T>(query: T, orgId: string): T {
  return (query as unknown as { eq(column: string, value: string): T }).eq("org_id", orgId);
}

type LooseRow = Record<string, unknown>;
type LooseResult = { data: unknown; error: { message: string } | null };

/** Read one org-scoped row by id, bypassing the stale generated types. */
async function selectOrgRowById(client: TypedSupabaseClient, table: string, id: string, orgId: string): Promise<LooseRow | null> {
  const builder = (
    client as unknown as {
      from(t: string): {
        select(s: string): { eq(c: string, v: string): { eq(c: string, v: string): { maybeSingle(): PromiseLike<LooseResult> } } };
      };
    }
  ).from(table).select("*").eq("id", id).eq("org_id", orgId).maybeSingle();
  const { data, error } = await builder;
  return error || !data ? null : (data as LooseRow);
}

/** Rows per page when backfilling, and a hard ceiling that bounds a runaway loop. */
export const RESYNC_PAGE_SIZE = 1000;
const RESYNC_HARD_CAP = 50000;

export type PagedRows =
  | { ok: true; rows: LooseRow[]; truncated: boolean }
  | { ok: false };

/**
 * Page through EVERY org-scoped row of a table (no 2000-row cap — that cap is
 * what made the Brain silently miss records past it). Stops when a short page
 * arrives, or flags `truncated` if the hard safety ceiling is hit so the operator
 * knows to investigate rather than lose data silently. Structural cast bypasses
 * the stale generated types (some tables carry org_id only at runtime).
 */
export async function selectAllOrgRows(
  client: TypedSupabaseClient,
  table: string,
  orgId: string,
  pageSize: number = RESYNC_PAGE_SIZE,
  hardCap: number = RESYNC_HARD_CAP,
): Promise<PagedRows> {
  const out: LooseRow[] = [];
  let offset = 0;
  for (;;) {
    const builder = (
      client as unknown as {
        from(t: string): { select(s: string): { eq(c: string, v: string): { range(a: number, b: number): PromiseLike<LooseResult> } } };
      }
    ).from(table).select("*").eq("org_id", orgId).range(offset, offset + pageSize - 1);
    const { data, error } = await builder;
    if (error || !Array.isArray(data)) return out.length ? { ok: true, rows: out, truncated: false } : { ok: false };
    out.push(...(data as LooseRow[]));
    if (data.length < pageSize) return { ok: true, rows: out, truncated: false };
    offset += pageSize;
    if (offset >= hardCap) return { ok: true, rows: out, truncated: true };
  }
}

/** Read child rows that reference a parent: `column = parentId` within the org. */
async function selectChildRows(
  client: TypedSupabaseClient,
  table: string,
  column: string,
  parentId: string,
  orgId: string,
): Promise<LooseRow[] | null> {
  const builder = (
    client as unknown as {
      from(t: string): { select(s: string): { eq(c: string, v: string): { eq(c: string, v: string): PromiseLike<LooseResult> } } };
    }
  ).from(table).select("id").eq(column, parentId).eq("org_id", orgId);
  const { data, error } = await builder;
  return error || !Array.isArray(data) ? null : (data as LooseRow[]);
}

/** Read rows where `column` is in `ids` (no org filter — caller derives org). */
async function selectRowsIn(client: TypedSupabaseClient, table: string, column: string, ids: string[]): Promise<LooseRow[] | null> {
  const builder = (
    client as unknown as { from(t: string): { select(s: string): { in(c: string, v: string[]): PromiseLike<LooseResult> } } }
  ).from(table).select("*").in(column, ids);
  const { data, error } = await builder;
  return error || !Array.isArray(data) ? null : (data as LooseRow[]);
}

/**
 * Resolve a batch of (kind,key)-addressed edge specs to node ids in one query and
 * idempotently upsert each edge. Ends whose node doesn't exist yet are skipped —
 * a backfill's second pass (after all nodes exist) is the completeness backstop.
 * Shared by CRM-row and campaign linking. Best-effort; never throws.
 */
async function linkEdgeSpecs(specs: CrmEdgeSpec[], deps: SyncDeps): Promise<{ linked: number; skipped: number }> {
  if (specs.length === 0) return { linked: 0, skipped: 0 };

  let resolved;
  try { resolved = await resolve(deps); }
  catch { return { linked: 0, skipped: specs.length }; }
  if (!resolved) return { linked: 0, skipped: specs.length };
  const { client, orgId } = resolved;

  const keys = Array.from(new Set(specs.flatMap((s) => [s.fromKey, s.toKey])));
  const { data, error } = await client.from("knowledge_nodes").select("id,key").eq("org_id", orgId).in("key", keys);
  if (error || !Array.isArray(data)) return { linked: 0, skipped: specs.length };

  const idByKey = new Map<string, string>();
  for (const r of data as Array<{ id: string; key: string }>) idByKey.set(r.key, r.id);

  // Persona endpoints are addressable from the key alone (the key IS the persona
  // value). Create any that don't exist yet so a `targets persona` edge always
  // lands instead of silently skipping — this is the fix for "the Brain doesn't
  // link things". CRM/campaign refs are NOT auto-created here (we lack their data;
  // they mirror in through their own sync path).
  const missingPersonaKeys = Array.from(
    new Set(specs.filter((s) => s.toKind === "persona" && !idByKey.has(s.toKey)).map((s) => s.toKey)),
  );
  for (const personaKey of missingPersonaKeys) {
    const res = await upsertReferenceNode(buildPersonaNodeInput(personaKey), { client, orgId });
    if (res.ok) idByKey.set(personaKey, res.id);
  }

  let linked = 0;
  let skipped = 0;
  for (const s of specs) {
    const from = idByKey.get(s.fromKey);
    const to = idByKey.get(s.toKey);
    if (!from || !to || from === to) { skipped++; continue; }
    const res = await upsertReferenceEdge(from, to, s.relation, { client, orgId });
    if (res.ok) linked++; else skipped++;
  }
  return { linked, skipped };
}

/** Upsert a Brain node from an already-read CRM row. Used by backfill + lead ingest. */
export async function syncCrmRowToBrain(
  table: CrmIngestTable,
  row: Record<string, unknown>,
  deps: SyncDeps = {},
): Promise<WriteResult> {
  return upsertReferenceNode(buildNodeInputForCrmRow(table, row), deps);
}

/**
 * Link a CRM row's node to its related nodes (FK parents via belongs_to, persona
 * via targets). Resolves the (kind,key) ends to node ids in one query, then
 * idempotently upserts each edge. Targets that don't have a node yet are skipped
 * — the backfill's second pass (after all nodes exist) is the completeness
 * backstop. Best-effort by design; never throws.
 */
export async function syncCrmRowEdges(
  table: CrmIngestTable,
  row: Record<string, unknown>,
  deps: SyncDeps = {},
): Promise<{ linked: number; skipped: number }> {
  return linkEdgeSpecs(buildEdgesForCrmRow(table, row), deps);
}

// --- Campaigns → Brain (slice 4) ------------------------------------------

/** Upsert a Brain node from an already-read `campaigns` row. */
export async function syncCampaignToBrain(row: Record<string, unknown>, deps: SyncDeps = {}): Promise<WriteResult> {
  return upsertReferenceNode(buildNodeInputForCampaign(row), deps);
}

/** Link a campaign's node to its persona (targets) and CRM records (relates_to). */
export async function syncCampaignEdges(
  row: Record<string, unknown>,
  deps: SyncDeps = {},
): Promise<{ linked: number; skipped: number }> {
  return linkEdgeSpecs(buildEdgesForCampaign(row), deps);
}

/**
 * Read a campaign (org-scoped) by id, upsert its Brain node, then link its edges
 * (best-effort). Call this after creating/updating a campaign so it mirrors in.
 */
export async function syncCampaignRecordToBrain(campaignId: string, deps: SyncDeps = {}): Promise<WriteResult> {
  let resolved;
  try { resolved = await resolve(deps); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "org unavailable" }; }
  if (!resolved) return { ok: false, error: "Supabase is not configured." };
  const { client, orgId } = resolved;
  const { data, error } = await eqOrg(client.from("campaigns").select("*").eq("id", campaignId), orgId)
    .maybeSingle<Record<string, unknown>>();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: `campaign ${campaignId} not found.` };
  const nodeResult = await syncCampaignToBrain(data, { client, orgId });
  await syncCampaignEdges(data, { client, orgId }).catch(() => undefined);
  return nodeResult;
}

/**
 * Link a record to its already-synced *children* (the reverse of its own
 * `belongs_to` edges). When a parent is created/synced after its children, each
 * child's forward edge was skipped (the parent had no node yet); this re-links
 * them from the parent's side so the graph connects regardless of sync order.
 * Best-effort; never throws.
 */
export async function syncRecordBackEdges(
  table: CrmIngestTable,
  recordId: string,
  deps: SyncDeps = {},
): Promise<{ linked: number; skipped: number }> {
  const children = crmChildRefs(table);
  if (children.length === 0) return { linked: 0, skipped: 0 };
  let resolved;
  try { resolved = await resolve(deps); }
  catch { return { linked: 0, skipped: 0 }; }
  if (!resolved) return { linked: 0, skipped: 0 };
  const { client, orgId } = resolved;

  const specs: CrmEdgeSpec[] = [];
  for (const child of children) {
    const rows = await selectChildRows(client, child.table, child.column, recordId, orgId);
    if (!rows) continue;
    for (const row of rows) {
      const childId = typeof row.id === "string" ? row.id : null;
      if (!childId) continue;
      specs.push({
        fromKind: CRM_NODE_KINDS[child.table],
        fromKey: crmNodeKey(child.table, childId),
        toKind: CRM_NODE_KINDS[table],
        toKey: crmNodeKey(table, recordId),
        relation: "belongs_to",
      });
    }
  }
  return linkEdgeSpecs(specs, { client, orgId });
}

/** Read a CRM record (org-scoped, raw row) by id, then upsert its Brain node. */
export async function syncRecordToBrain(table: CrmIngestTable, recordId: string, deps: SyncDeps = {}): Promise<WriteResult> {
  let resolved;
  try { resolved = await resolve(deps); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "org unavailable" }; }
  if (!resolved) return { ok: false, error: "Supabase is not configured." };
  const { client, orgId } = resolved;
  const { data, error } = await client
    .from(table)
    .select("*")
    .eq("id", recordId)
    .eq("org_id", orgId)
    .maybeSingle<Record<string, unknown>>();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: `${table} ${recordId} not found.` };
  const nodeResult = await syncCrmRowToBrain(table, data, { client, orgId });
  // Best-effort linking: a missing parent or edge hiccup must never fail the node
  // write. Forward edges (this row → its parents) AND back-edges (already-synced
  // children → this row) so linking lands regardless of creation order.
  await syncCrmRowEdges(table, data, { client, orgId }).catch(() => undefined);
  await syncRecordBackEdges(table, recordId, { client, orgId }).catch(() => undefined);
  return nodeResult;
}

/**
 * Backfill: upsert a Brain node for every CRM row in the org (paged — no row cap).
 * Returns counts. `truncated` is true only if a table hit the hard safety ceiling
 * (selectAllOrgRows), so the caller can tell the operator to re-run. `ok` is false
 * if any table failed to read.
 */
export async function resyncCrmIntoBrain(
  deps: SyncDeps = {},
): Promise<{ ok: boolean; synced: number; linked: number; errors: number; truncated: boolean }> {
  let resolved;
  try { resolved = await resolve(deps); }
  catch { return { ok: false, synced: 0, linked: 0, errors: 0, truncated: false }; }
  if (!resolved) return { ok: false, synced: 0, linked: 0, errors: 0, truncated: false };
  const { client, orgId } = resolved;

  let synced = 0;
  let linked = 0;
  let errors = 0;
  let truncated = false;
  let tableReadFailed = false;

  // Pass 1: upsert a node for every row, keeping the rows for the edge pass.
  const pulled: Array<{ table: CrmIngestTable; rows: Array<Record<string, unknown>> }> = [];
  for (const table of CRM_INGEST_TABLES) {
    const page = await selectAllOrgRows(client, table, orgId);
    if (!page.ok) { tableReadFailed = true; continue; }
    if (page.truncated) truncated = true;
    const rows = page.rows as Array<Record<string, unknown>>;
    pulled.push({ table, rows });
    for (const row of rows) {
      if (typeof row.id !== "string") { errors++; continue; }
      const res = await syncCrmRowToBrain(table, row, { client, orgId });
      if (res.ok) synced++; else errors++;
    }
  }

  // Pass 2: link edges now that every referenced node exists.
  for (const { table, rows } of pulled) {
    for (const row of rows) {
      if (typeof row.id !== "string") continue;
      const res = await syncCrmRowEdges(table, row, { client, orgId }).catch(() => ({ linked: 0, skipped: 0 }));
      linked += res.linked;
    }
  }

  return { ok: !tableReadFailed, synced, linked, errors, truncated };
}

/**
 * Backfill: mirror every campaign in the org into the Brain (node pass, then edge
 * pass so persona/CRM targets exist before linking). Same shape as the CRM
 * backfill so the operator action can sum them.
 */
export async function resyncCampaignsIntoBrain(
  deps: SyncDeps = {},
): Promise<{ ok: boolean; synced: number; linked: number; errors: number; truncated: boolean }> {
  let resolved;
  try { resolved = await resolve(deps); }
  catch { return { ok: false, synced: 0, linked: 0, errors: 0, truncated: false }; }
  if (!resolved) return { ok: false, synced: 0, linked: 0, errors: 0, truncated: false };
  const { client, orgId } = resolved;

  const page = await selectAllOrgRows(client, "campaigns", orgId);
  if (!page.ok) return { ok: false, synced: 0, linked: 0, errors: 0, truncated: false };
  const rows = page.rows as Array<Record<string, unknown>>;
  const truncated = page.truncated;

  let synced = 0;
  let linked = 0;
  let errors = 0;
  for (const row of rows) {
    if (typeof row.id !== "string") { errors++; continue; }
    const res = await syncCampaignToBrain(row, { client, orgId });
    if (res.ok) synced++; else errors++;
  }
  for (const row of rows) {
    if (typeof row.id !== "string") continue;
    const res = await syncCampaignEdges(row, { client, orgId }).catch(() => ({ linked: 0, skipped: 0 }));
    linked += res.linked;
  }

  return { ok: true, synced, linked, errors, truncated };
}

// --- Media → Brain (slice 4) ----------------------------------------------

type BackfillResult = { ok: boolean; synced: number; linked: number; errors: number; truncated: boolean };

/** Upsert a Brain node from an already-read media_assets row. */
export async function syncMediaAssetToBrain(row: Record<string, unknown>, deps: SyncDeps = {}): Promise<WriteResult> {
  return upsertReferenceNode(buildNodeInputForMedia(row), deps);
}

/** Read a media asset (org-scoped) and mirror it into the Brain. Best-effort caller. */
export async function syncMediaRecordToBrain(mediaId: string, deps: SyncDeps = {}): Promise<WriteResult> {
  let resolved;
  try { resolved = await resolve(deps); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "org unavailable" }; }
  if (!resolved) return { ok: false, error: "Supabase is not configured." };
  const { client, orgId } = resolved;
  const row = await selectOrgRowById(client, "media_assets", mediaId, orgId);
  if (!row) return { ok: false, error: `media ${mediaId} not found.` };
  if (row.available_to_arc === false) return { ok: false, error: "media not available to Arc." };
  return syncMediaAssetToBrain(row, { client, orgId });
}

/** Result of a Brain removal. Distinct from WriteResult: a delete has no row id to hand back. */
export type RemoveResult = { ok: true } | { ok: false; error: string };

/** Remove a media asset's Brain node (org-scoped), so revoking Arc access also drops
 *  it from recall. Edges cascade with the node. No-op when the node isn't there. */
export async function removeMediaRecordFromBrain(mediaId: string, deps: SyncDeps = {}): Promise<RemoveResult> {
  let resolved;
  try { resolved = await resolve(deps); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "org unavailable" }; }
  if (!resolved) return { ok: false, error: "Supabase is not configured." };
  const { client, orgId } = resolved;
  const { error } = await client
    .from("knowledge_nodes")
    .delete()
    .eq("org_id", orgId)
    .eq("kind", MEDIA_NODE_KIND)
    .eq("key", mediaNodeKey(mediaId));
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Backfill: mirror every Arc-available media asset in the org into the Brain. */
export async function resyncMediaIntoBrain(deps: SyncDeps = {}): Promise<BackfillResult> {
  let resolved;
  try { resolved = await resolve(deps); }
  catch { return { ok: false, synced: 0, linked: 0, errors: 0, truncated: false }; }
  if (!resolved) return { ok: false, synced: 0, linked: 0, errors: 0, truncated: false };
  const { client, orgId } = resolved;

  const page = await selectAllOrgRows(client, "media_assets", orgId);
  if (!page.ok) return { ok: false, synced: 0, linked: 0, errors: 0, truncated: false };
  const rows = page.rows;
  const truncated = page.truncated;

  let synced = 0;
  let errors = 0;
  for (const row of rows) {
    if (typeof row.id !== "string") { errors++; continue; }
    if (row.available_to_arc === false) continue; // only media Arc may use belongs in its memory
    const res = await syncMediaAssetToBrain(row, { client, orgId });
    if (res.ok) synced++; else errors++;
  }
  return { ok: true, synced, linked: 0, errors, truncated };
}

// --- Performance (campaign_results) → Brain (slice 4) ----------------------

/** Upsert a Brain node from an already-read campaign_results row. */
export async function syncCampaignResultToBrain(row: Record<string, unknown>, deps: SyncDeps = {}): Promise<WriteResult> {
  return upsertReferenceNode(buildNodeInputForCampaignResult(row), deps);
}

/**
 * Backfill: mirror every campaign_results row in the org into the Brain (node
 * pass, then a `learned_from` edge to its campaign). Campaign nodes must exist
 * for the edge to land — run after the campaign backfill (the operator action does).
 */
export async function resyncPerformanceIntoBrain(deps: SyncDeps = {}): Promise<BackfillResult> {
  let resolved;
  try { resolved = await resolve(deps); }
  catch { return { ok: false, synced: 0, linked: 0, errors: 0, truncated: false }; }
  if (!resolved) return { ok: false, synced: 0, linked: 0, errors: 0, truncated: false };
  const { client, orgId } = resolved;

  const page = await selectAllOrgRows(client, "campaign_results", orgId);
  if (!page.ok) return { ok: false, synced: 0, linked: 0, errors: 0, truncated: false };
  const rows = page.rows;
  const truncated = page.truncated;

  let synced = 0;
  let linked = 0;
  let errors = 0;
  for (const row of rows) {
    if (typeof row.id !== "string") { errors++; continue; }
    const res = await syncCampaignResultToBrain(row, { client, orgId });
    if (res.ok) synced++; else errors++;
  }
  for (const row of rows) {
    if (typeof row.id !== "string") continue;
    const res = await linkEdgeSpecs(buildEdgesForCampaignResult(row), { client, orgId }).catch(() => ({ linked: 0, skipped: 0 }));
    linked += res.linked;
  }
  return { ok: true, synced, linked, errors, truncated };
}

export type EmbeddingBackfillResult = { ok: boolean; embedded: number; skipped: number; errors: number; remaining: boolean };

// A single "Refresh memory" click embeds at most this many nodes, in parallel
// batches of EMBED_CONCURRENCY. Bounding per-invocation keeps the server action
// comfortably under the serverless function timeout even for large graphs; the
// caller re-clicks (guided by `remaining`) to drain the rest.
const EMBED_BACKFILL_BUDGET = 400;
const EMBED_CONCURRENCY = 8;

/**
 * Backfill semantic embeddings for existing Brain nodes that don't have one yet
 * (org-scoped). Nodes written while GEMINI_API_KEY was unset land with a null
 * embedding, so recall silently degrades to keyword-only; run this once the key
 * is live to make the graph semantically searchable.
 *
 * Bounded + parallel: pulls one page of up to `budget` null-embedding nodes and
 * embeds them `concurrency` at a time, so a single call can't run past the
 * function timeout. `remaining` is true when more null nodes exist beyond this
 * batch (the UI surfaces "click Refresh again"). With embedding down (embedText
 * returns null) nothing is written — the nodes stay keyword-only.
 */
export async function backfillMissingEmbeddings(
  deps: SyncDeps & { budget?: number; concurrency?: number } = {},
): Promise<EmbeddingBackfillResult> {
  let resolved;
  try { resolved = await resolve(deps); }
  catch { return { ok: false, embedded: 0, skipped: 0, errors: 0, remaining: false }; }
  if (!resolved) return { ok: false, embedded: 0, skipped: 0, errors: 0, remaining: false };
  const { client, orgId } = resolved;

  const budget = Math.max(1, deps.budget ?? EMBED_BACKFILL_BUDGET);
  const concurrency = Math.max(1, deps.concurrency ?? EMBED_CONCURRENCY);

  // Pull one bounded page. Fetch budget+1 so we can tell the caller whether more
  // remain (→ re-click) without a separate count query.
  const { data, error } = await (
    client as unknown as {
      from(t: string): {
        select(s: string): { eq(c: string, v: string): { is(c: string, v: null): { limit(n: number): PromiseLike<LooseResult> } } };
      };
    }
  ).from("knowledge_nodes").select("id,label,summary,body").eq("org_id", orgId).is("embedding", null).limit(budget + 1);
  if (error) return { ok: false, embedded: 0, skipped: 0, errors: 0, remaining: false };

  const all = (data ?? []) as Array<{ id: string; label: string | null; summary: string | null; body: string | null }>;
  const remaining = all.length > budget;
  const rows = all.slice(0, budget);

  let embedded = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += concurrency) {
    const results = await Promise.all(
      rows.slice(i, i + concurrency).map(async (row): Promise<"ok" | "skip" | "error"> => {
        if (typeof row.id !== "string") return "error";
        const text = [row.label, row.summary, row.body].filter(Boolean).join("\n").trim();
        if (!text) return "skip";
        let vec: number[] | null = null;
        try { vec = await embedText(text, { orgId, purpose: "brain.embed-backfill" }); } catch { vec = null; }
        if (!vec) return "skip"; // embed failed — leave null (keyword recall)
        const { error: upErr } = await (
          client as unknown as {
            from(t: string): { update(v: unknown): { eq(c: string, v: string): { eq(c: string, v: string): PromiseLike<{ error: { message: string } | null }> } } };
          }
        ).from("knowledge_nodes").update({ embedding: JSON.stringify(vec) }).eq("id", row.id).eq("org_id", orgId);
        return upErr ? "error" : "ok";
      }),
    );
    for (const r of results) {
      if (r === "ok") embedded++;
      else if (r === "skip") skipped++;
      else errors++;
    }
  }

  return { ok: true, embedded, skipped, errors, remaining };
}

/**
 * Mirror the results of specific campaigns into the Brain — the per-batch hook
 * for the campaign_results ingest route, so performance flows in as it arrives
 * (not just via the backfill button). The ingest route is global-token gated and
 * doesn't carry org scope, and campaign_results rows have no reliable org_id, so
 * each result's org is derived from its campaign (campaign_id → campaigns.org_id)
 * — the result node lands in the same org as the campaign it measures.
 */
export async function syncPerformanceForCampaigns(campaignIds: string[], deps: SyncDeps = {}): Promise<BackfillResult> {
  const ids = Array.from(new Set(campaignIds.filter((s): s is string => typeof s === "string" && s.length > 0)));
  if (ids.length === 0) return { ok: true, synced: 0, linked: 0, errors: 0, truncated: false };

  const client = deps.client ?? (isSupabaseAdminConfigured() ? getSupabaseAdminClient() : null);
  if (!client) return { ok: false, synced: 0, linked: 0, errors: 0, truncated: false };

  const campaigns = await selectRowsIn(client, "campaigns", "id", ids);
  if (!campaigns) return { ok: false, synced: 0, linked: 0, errors: 0, truncated: false };
  const orgByCampaign = new Map<string, string>();
  for (const c of campaigns) {
    if (typeof c.id === "string" && typeof c.org_id === "string") orgByCampaign.set(c.id, c.org_id);
  }

  const rows = await selectRowsIn(client, "campaign_results", "campaign_id", ids);
  if (!rows) return { ok: false, synced: 0, linked: 0, errors: 0, truncated: false };

  let synced = 0;
  let linked = 0;
  let errors = 0;
  for (const row of rows) {
    const orgId = typeof row.campaign_id === "string" ? orgByCampaign.get(row.campaign_id) : undefined;
    if (typeof row.id !== "string" || !orgId) { errors++; continue; }
    const res = await syncCampaignResultToBrain(row, { client, orgId });
    if (res.ok) synced++; else errors++;
  }
  for (const row of rows) {
    const orgId = typeof row.campaign_id === "string" ? orgByCampaign.get(row.campaign_id) : undefined;
    if (typeof row.id !== "string" || !orgId) continue;
    const res = await linkEdgeSpecs(buildEdgesForCampaignResult(row), { client, orgId }).catch(() => ({ linked: 0, skipped: 0 }));
    linked += res.linked;
  }
  return { ok: true, synced, linked, errors, truncated: false };
}
