import { CRM_NODE_KINDS, type CrmIngestTable, type TrustTier } from "@/domain";
import { reportDegraded } from "@/lib/observability/report-degraded";
import { getCurrentOrgId } from "@/lib/auth/org";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { type TypedSupabaseClient, getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { demoBrainNodes } from "./demo";

export type BrainNode = {
  id: string;
  kind: string;
  label: string;
  body: string | null;
  summary: string | null;
  persona: string | null;
  trustTier: TrustTier;
  confidence: number | null;
  refTable: string | null;
  refId: string | null;
  source: string | null;
  tags: string[];
  createdBy: string | null;
  createdAt: string | null;
};

export type BrainEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relation: string;
  weight: number | null;
  trustTier: TrustTier;
};

export type NodeFilters = {
  kind?: string;
  trustTier?: TrustTier;
  persona?: string;
  refTable?: string;
  refId?: string;
  search?: string;
};

export type ListNodesOptions = {
  demoFallback?: boolean;
};

type Live<T> = { status: "live" } & T;
type Unavailable = { status: "unavailable"; message: string };

const NODE_COLUMNS =
  "id,kind,label,body,summary,persona,trust_tier,confidence,ref_table,ref_id,source,tags,created_by,created_at";
const EDGE_COLUMNS = "id,from_node_id,to_node_id,relation,weight,trust_tier";

type NodeRow = {
  id: string;
  kind: string;
  label: string;
  body: string | null;
  summary: string | null;
  persona: string | null;
  trust_tier: TrustTier;
  confidence: number | null;
  ref_table: string | null;
  ref_id: string | null;
  source: string | null;
  tags: string[] | null;
  created_by: string | null;
  created_at: string | null;
};

type EdgeRow = {
  id: string;
  from_node_id: string;
  to_node_id: string;
  relation: string;
  weight: number | null;
  trust_tier: TrustTier;
};

export function mapNode(row: NodeRow): BrainNode {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    body: row.body,
    summary: row.summary,
    persona: row.persona,
    trustTier: row.trust_tier,
    confidence: row.confidence,
    refTable: row.ref_table,
    refId: row.ref_id,
    source: row.source,
    tags: row.tags ?? [],
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function mapEdge(row: EdgeRow): BrainEdge {
  return {
    id: row.id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    relation: row.relation,
    weight: row.weight,
    trustTier: row.trust_tier,
  };
}

async function resolveRead(
  client: TypedSupabaseClient | undefined,
  orgId: string | undefined,
): Promise<{ client: TypedSupabaseClient; orgId: string } | null> {
  if (client && orgId) return { client, orgId };
  if (!isSupabaseAdminConfigured()) return null;
  return { client: client ?? getSupabaseAdminClient(), orgId: orgId ?? (await getCurrentOrgId()) };
}

/**
 * Neutralize a free-text search term for PostgREST's `.or()` grammar.
 *
 * `.or()` embeds the term in a comma/paren-delimited filter string and treats
 * `*` as the wildcard, so a raw comma, paren, or star from the search text would
 * break the filter — or inject an extra OR condition. A substring search needs
 * none of those characters, so strip them and collapse whitespace. Returns "" when
 * nothing usable remains, letting the caller skip the filter rather than emit an
 * all-matching `**`. Dots and hyphens survive, so "3.2h" and "60-minute" still match.
 */
export function sanitizeBrainSearch(raw: string): string {
  return raw.replace(/[,()*%"\\]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Does a node match a free-text search? Matches the term as a substring of the
 * node's title, body, OR summary — the same three columns the live SQL searches.
 *
 * Body and summary are the point: a proof point's evidence ("median arrival 3.2h",
 * "IICRC-certified") lives in its body, not its short label. Searching the label
 * alone let a text query for a real fact return empty, which reads as "not in the
 * brain" when it only means "not in a title" — and blinded the draft critic, whose
 * whole job is to go find that evidence. An empty/all-junk term excludes nothing,
 * mirroring the live path skipping the filter.
 */
export function nodeMatchesSearch(
  node: Pick<BrainNode, "label" | "body" | "summary">,
  term: string,
): boolean {
  const q = sanitizeBrainSearch(term).toLowerCase();
  if (!q) return true;
  return (
    node.label.toLowerCase().includes(q) ||
    (node.body ?? "").toLowerCase().includes(q) ||
    (node.summary ?? "").toLowerCase().includes(q)
  );
}

/**
 * Apply NodeFilters to an in-memory node list, mirroring the SQL filters in
 * listNodes so the demo fallback responds to the same kind/tier/persona/search
 * controls the live query would.
 */
function filterDemoNodes(filters: NodeFilters): BrainNode[] {
  let nodes = demoBrainNodes();
  if (filters.kind) nodes = nodes.filter((n) => n.kind === filters.kind);
  if (filters.trustTier) nodes = nodes.filter((n) => n.trustTier === filters.trustTier);
  else nodes = nodes.filter((n) => n.trustTier !== "archived");
  if (filters.persona) nodes = nodes.filter((n) => n.persona === filters.persona);
  if (filters.refTable) nodes = nodes.filter((n) => n.refTable === filters.refTable);
  if (filters.refId) nodes = nodes.filter((n) => n.refId === filters.refId);
  if (filters.search) nodes = nodes.filter((n) => nodeMatchesSearch(n, filters.search as string));
  return nodes;
}

export async function listNodes(
  filters: NodeFilters = {},
  client?: TypedSupabaseClient,
  orgId?: string,
  options: ListNodesOptions = {},
): Promise<Live<{ nodes: BrainNode[] }> | Unavailable> {
  const resolved = await resolveRead(client, orgId);
  // Demo fallbacks are OFF by default so real (possibly empty) workspaces show
  // real data; ARC_DEMO_DATA=1 opts a sales/preview deployment into the seeded
  // demo brain. Callers can also force it off with { demoFallback: false }.
  // Mirrors getBrainGraph() in graph.ts so the node list and the graph agree.
  const demoFallback = options.demoFallback !== false && isDemoDataEnabled();
  if (!resolved) return { status: "live", nodes: demoFallback ? filterDemoNodes(filters) : [] };
  try {
    let query = resolved.client
      .from("knowledge_nodes")
      .select(NODE_COLUMNS)
      .eq("org_id", resolved.orgId)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (filters.kind) query = query.eq("kind", filters.kind);
    // Archived nodes are soft-deleted: hidden from normal reads (browser, summary)
    // unless a caller explicitly asks for the archived tier.
    if (filters.trustTier) query = query.eq("trust_tier", filters.trustTier);
    else query = query.neq("trust_tier", "archived");
    if (filters.persona) query = query.eq("persona", filters.persona as never);
    if (filters.refTable) query = query.eq("ref_table", filters.refTable);
    if (filters.refId) query = query.eq("ref_id", filters.refId);
    // Search the node's substance, not just its title. label is a short heading;
    // the evidence a caller is looking for lives in body/summary. Matching label
    // alone made a text search for a real fact return empty — see nodeMatchesSearch.
    if (filters.search) {
      const term = sanitizeBrainSearch(filters.search);
      if (term) query = query.or(`label.ilike.*${term}*,body.ilike.*${term}*,summary.ilike.*${term}*`);
    }

    const { data, error } = await query;
    if (error) return { status: "unavailable", message: error.message };
    const nodes = ((data ?? []) as NodeRow[]).map(mapNode);
    // An empty brain (no nodes seeded yet) shows the demo memory only when demo
    // mode is on (handled via demoFallback above) and only for an unfiltered
    // read, so a genuine no-match on a specific filter still returns empty.
    const unfiltered =
      !filters.kind && !filters.trustTier && !filters.persona && !filters.refTable && !filters.refId && !filters.search;
    if (nodes.length === 0 && unfiltered && demoFallback) return { status: "live", nodes: filterDemoNodes({}) };
    return { status: "live", nodes };
  } catch (error) {
    // Degrade, but not silently — this read IS the screen, so an empty
    // state here is indistinguishable from an outage (BSR-544).
    reportDegraded(error, { scope: "knowledge-graph.listNodes", surface: "primary" });
    return { status: "unavailable", message: error instanceof Error ? error.message : "Brain is unavailable." };
  }
}

/**
 * Exact tier counts for the Brain's summary tiles.
 *
 * listNodes caps at 200 rows ordered by updated_at, which is right for a browsable
 * list and wrong for a count. The Brain page derived all four tiles from that
 * capped list, so on a 422-node brain it read:
 *
 *   Knowledge nodes 200 (of 422) · Trusted 0 (of 37) · Observed 200 (of 384)
 *   · Awaiting review 0 (of 1)
 *
 * Every tile wrong, and not merely truncated: the cap is a recency window, so the
 * 37 trusted nodes — updated longer ago — fell outside it entirely and the tile
 * reported that Arc has NO knowledge approved for outbound. A page size rendered
 * as a total is a lie the number itself can't reveal; it looks like a plausible
 * count, and 200 looks like a fact rather than a limit.
 *
 * Counts are exact and O(1) on the wire (head requests), and exclude archived —
 * matching what listNodes shows by default.
 */
export type BrainTierCounts = { total: number; trusted: number; observed: number; proposed: number };

export async function countNodesByTier(
  client?: TypedSupabaseClient,
  orgId?: string,
  options: ListNodesOptions = {},
): Promise<Live<{ counts: BrainTierCounts }> | Unavailable> {
  const resolved = await resolveRead(client, orgId);
  const demoFallback = options.demoFallback !== false && isDemoDataEnabled();
  if (!resolved) {
    const nodes = demoFallback ? filterDemoNodes({}) : [];
    return { status: "live", counts: countTiers(nodes) };
  }
  try {
    const base = () => resolved.client.from("knowledge_nodes").select("id", { count: "exact", head: true }).eq("org_id", resolved.orgId);
    const [total, trusted, observed, proposed] = await Promise.all([
      base().neq("trust_tier", "archived"),
      base().eq("trust_tier", "trusted"),
      base().eq("trust_tier", "observed"),
      base().eq("trust_tier", "proposed"),
    ]);
    const firstError = [total, trusted, observed, proposed].find((r) => r.error);
    if (firstError?.error) return { status: "unavailable", message: firstError.error.message };
    const counts: BrainTierCounts = {
      total: total.count ?? 0,
      trusted: trusted.count ?? 0,
      observed: observed.count ?? 0,
      proposed: proposed.count ?? 0,
    };
    // An empty brain falls back to the demo memory only in demo mode, mirroring listNodes.
    if (counts.total === 0 && demoFallback) return { status: "live", counts: countTiers(filterDemoNodes({})) };
    return { status: "live", counts };
  } catch (error) {
    return { status: "unavailable", message: error instanceof Error ? error.message : "Brain is unavailable." };
  }
}

/** Tier counts over an in-memory list (demo mode), mirroring the SQL above. */
function countTiers(nodes: BrainNode[]): BrainTierCounts {
  const tier = (t: string) => nodes.filter((n) => (n.trustTier ?? "").toLowerCase() === t).length;
  return { total: nodes.filter((n) => (n.trustTier ?? "").toLowerCase() !== "archived").length, trusted: tier("trusted"), observed: tier("observed"), proposed: tier("proposed") };
}

/** All edges for the workspace graph (Knowledge Web). Empty when unconfigured. */
export async function listGraphEdges(
  client?: TypedSupabaseClient,
  orgId?: string,
): Promise<Live<{ edges: BrainEdge[] }> | Unavailable> {
  const resolved = await resolveRead(client, orgId);
  if (!resolved) return { status: "live", edges: [] };
  try {
    const { data, error } = await resolved.client
      .from("knowledge_edges")
      .select(EDGE_COLUMNS)
      .eq("org_id", resolved.orgId)
      .limit(600);
    if (error) return { status: "unavailable", message: error.message };
    return { status: "live", edges: ((data ?? []) as EdgeRow[]).map(mapEdge) };
  } catch (error) {
    return { status: "unavailable", message: error instanceof Error ? error.message : "Brain edges are unavailable." };
  }
}

export async function listProposed(
  client?: TypedSupabaseClient,
  orgId?: string,
): Promise<Live<{ nodes: BrainNode[] }> | Unavailable> {
  return listNodes({ trustTier: "proposed" }, client, orgId);
}

export async function getNode(
  nodeId: string,
  client?: TypedSupabaseClient,
  orgId?: string,
): Promise<Live<{ node: BrainNode; edges: BrainEdge[]; neighbors: BrainNode[] }> | Unavailable> {
  const resolved = await resolveRead(client, orgId);
  if (!resolved) return { status: "unavailable", message: "Supabase is not configured." };
  try {
    const node = await resolved.client
      .from("knowledge_nodes")
      .select(NODE_COLUMNS)
      .eq("id", nodeId)
      .eq("org_id", resolved.orgId)
      .maybeSingle();
    if (node.error) return { status: "unavailable", message: node.error.message };
    if (!node.data) return { status: "unavailable", message: "Node not found." };

    const edges = await resolved.client
      .from("knowledge_edges")
      .select(EDGE_COLUMNS)
      .eq("org_id", resolved.orgId)
      .or(`from_node_id.eq.${nodeId},to_node_id.eq.${nodeId}`)
      .limit(200);
    if (edges.error) return { status: "unavailable", message: edges.error.message };

    const edgeRows = (edges.data ?? []) as EdgeRow[];
    const neighborIds = [
      ...new Set(edgeRows.flatMap((e) => [e.from_node_id, e.to_node_id]).filter((id) => id !== nodeId)),
    ];
    let neighbors: BrainNode[] = [];
    if (neighborIds.length) {
      const neighborRows = await resolved.client
        .from("knowledge_nodes")
        .select(NODE_COLUMNS)
        .eq("org_id", resolved.orgId)
        .in("id", neighborIds);
      if (neighborRows.error) return { status: "unavailable", message: neighborRows.error.message };
      neighbors = ((neighborRows.data ?? []) as NodeRow[]).map(mapNode);
    }

    return { status: "live", node: mapNode(node.data as NodeRow), edges: edgeRows.map(mapEdge), neighbors };
  } catch (error) {
    return { status: "unavailable", message: error instanceof Error ? error.message : "Brain is unavailable." };
  }
}

/** The six CRM tables and the brain node kinds they mirror into. */
const CRM_COVERAGE_TABLES = Object.keys(CRM_NODE_KINDS) as CrmIngestTable[];
const CRM_COVERAGE_KINDS = Object.values(CRM_NODE_KINDS);

export type BrainCrmCoverage = { crmRecords: number; brainRecords: number; behind: number };

/**
 * How far the Brain trails the CRM: total CRM rows (across the six objects) vs the
 * number of `crm_*` reference nodes already mirrored in. `behind` drives the
 * "your Brain is N records behind — sync now" prompt so a stale/empty graph is
 * visible and one click from being fixed, instead of silently looking complete.
 */
export async function getBrainCrmCoverage(
  client?: TypedSupabaseClient,
  orgId?: string,
): Promise<Live<BrainCrmCoverage> | Unavailable> {
  const resolved = await resolveRead(client, orgId);
  if (!resolved) return { status: "unavailable", message: "Supabase is not configured." };
  try {
    let crmRecords = 0;
    for (const table of CRM_COVERAGE_TABLES) {
      const { count, error } = await resolved.client
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("org_id", resolved.orgId);
      if (error) return { status: "unavailable", message: error.message };
      crmRecords += count ?? 0;
    }
    const brain = await resolved.client
      .from("knowledge_nodes")
      .select("id", { count: "exact", head: true })
      .eq("org_id", resolved.orgId)
      .in("kind", CRM_COVERAGE_KINDS);
    if (brain.error) return { status: "unavailable", message: brain.error.message };
    const brainRecords = brain.count ?? 0;
    return { status: "live", crmRecords, brainRecords, behind: Math.max(0, crmRecords - brainRecords) };
  } catch (error) {
    return { status: "unavailable", message: error instanceof Error ? error.message : "Brain coverage unavailable." };
  }
}

export async function brainSummary(
  client?: TypedSupabaseClient,
  orgId?: string,
): Promise<
  | Live<{ total: number; byKind: Record<string, number>; byTier: Record<string, number> }>
  | Unavailable
> {
  const all = await listNodes({}, client, orgId);
  if (all.status !== "live") return all;
  const byKind: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  for (const node of all.nodes) {
    byKind[node.kind] = (byKind[node.kind] ?? 0) + 1;
    byTier[node.trustTier] = (byTier[node.trustTier] ?? 0) + 1;
  }
  return { status: "live", total: all.nodes.length, byKind, byTier };
}
