import { type TrustTier } from "@/domain";
import { reportDegraded } from "@/lib/observability/report-degraded";
import { getCurrentOrgId } from "@/lib/auth/org";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { type TypedSupabaseClient, getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { demoBrainEdges, demoBrainNodes } from "./demo";
import { type BrainEdge, type BrainNode, mapEdge, mapNode } from "./read-model";

/**
 * The demo brain, shaped as a live graph result. Edges are pruned to visible
 * (non-archived) nodes so no dangling links reach the renderer.
 */
function demoGraph(filters: { kinds?: string[]; trustTiers?: TrustTier[] }): GraphResult {
  const tiers = filters.trustTiers && filters.trustTiers.length ? new Set(filters.trustTiers) : new Set(VISIBLE_TIERS);
  const kinds = filters.kinds && filters.kinds.length ? new Set(filters.kinds) : null;
  const nodes = demoBrainNodes().filter(
    (n) => tiers.has(n.trustTier) && (!kinds || kinds.has(n.kind)),
  );
  const ids = new Set(nodes.map((n) => n.id));
  const edges = demoBrainEdges().filter((e) => ids.has(e.fromNodeId) && ids.has(e.toNodeId));
  return { status: "live", nodes, edges, truncated: false };
}

export type BrainGraph = { nodes: BrainNode[]; edges: BrainEdge[]; truncated: boolean };
type GraphResult = ({ status: "live" } & BrainGraph) | { status: "unavailable"; message: string };

const NODE_CAP = 2000;
const EDGE_CAP = 5000;
const NODE_COLUMNS =
  "id,kind,label,body,summary,persona,trust_tier,confidence,ref_table,ref_id,source,tags,created_by,created_at";
const EDGE_COLUMNS = "id,from_node_id,to_node_id,relation,weight,trust_tier";
const VISIBLE_TIERS: TrustTier[] = ["observed", "proposed", "trusted"];

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

export async function getBrainGraph(
  filters: { kinds?: string[]; trustTiers?: TrustTier[] } = {},
  client?: TypedSupabaseClient,
  orgId?: string,
): Promise<GraphResult> {
  if (!(client && orgId)) {
    if (!isSupabaseAdminConfigured()) {
      return isDemoDataEnabled()
        ? demoGraph(filters)
        : { status: "unavailable", message: "Brain is unavailable." };
    }
  }
  try {
    const supabase = client ?? getSupabaseAdminClient();
    const resolvedOrg = orgId ?? (await getCurrentOrgId());
    const tiers = filters.trustTiers && filters.trustTiers.length ? filters.trustTiers : VISIBLE_TIERS;

    let nodeQuery = supabase
      .from("knowledge_nodes")
      .select(NODE_COLUMNS)
      .eq("org_id", resolvedOrg)
      .in("trust_tier", tiers)
      .order("updated_at", { ascending: false })
      .limit(NODE_CAP + 1);
    if (filters.kinds && filters.kinds.length) nodeQuery = nodeQuery.in("kind", filters.kinds);

    const nodesRes = await nodeQuery;
    if (nodesRes.error) return { status: "unavailable", message: nodesRes.error.message };

    const nodeRows = (nodesRes.data ?? []) as NodeRow[];
    const truncatedNodes = nodeRows.length > NODE_CAP;
    const nodes = (truncatedNodes ? nodeRows.slice(0, NODE_CAP) : nodeRows).map(mapNode);
    const nodeIds = new Set(nodes.map((n) => n.id));

    const edgesRes = await supabase
      .from("knowledge_edges")
      .select(EDGE_COLUMNS)
      .eq("org_id", resolvedOrg)
      .limit(EDGE_CAP + 1);
    if (edgesRes.error) return { status: "unavailable", message: edgesRes.error.message };

    const edgeRows = (edgesRes.data ?? []) as EdgeRow[];
    const truncatedEdges = edgeRows.length > EDGE_CAP;
    const edges = (truncatedEdges ? edgeRows.slice(0, EDGE_CAP) : edgeRows)
      .map(mapEdge)
      .filter((e) => nodeIds.has(e.fromNodeId) && nodeIds.has(e.toNodeId));

    // Empty brain + no filters applied: only show the demo graph when the demo
    // flag is enabled; otherwise fall through to the real empty live result.
    const noFilters = !(filters.kinds && filters.kinds.length) && !(filters.trustTiers && filters.trustTiers.length);
    if (nodes.length === 0 && noFilters) {
      if (isDemoDataEnabled()) return demoGraph(filters);
    }

    return { status: "live", nodes, edges, truncated: truncatedNodes || truncatedEdges };
  } catch (error) {
    // Degrade, but not silently — this read IS the screen, so an empty
    // state here is indistinguishable from an outage (BSR-544).
    reportDegraded(error, { scope: "knowledge-graph.getBrainGraph", surface: "primary" });
    return { status: "unavailable", message: error instanceof Error ? error.message : "Brain graph is unavailable." };
  }
}
