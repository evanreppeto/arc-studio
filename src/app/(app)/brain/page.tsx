import { reasonIfUnavailable, unavailable } from "@/lib/observability/unavailable";
import { countNodesByTier, listGraphEdges, listNodes, type BrainNode } from "@/lib/knowledge-graph/read-model";

import { KIND_COLOR, KIND_LABEL, normalizeConfidence, titleize, toFact } from "./_data/fact-vm";
import { BrainView, type BrainData } from "./_components/brain-view";
import type { GraphEdge, GraphNode } from "./_components/knowledge-graph";

export const metadata = { title: "Brain — Arc Studio" };

// "Refresh memory" (rebuildBrainMemoryAction) resyncs CRM/campaigns/media and
// backfills embeddings — network-heavy work. Give the server action headroom
// over the default so a real refresh completes instead of hitting the timeout.
export const maxDuration = 60;

function learnedByLabel(by: string | null): string {
  if (by === "arc") return "Arc";
  if (by === "operator") return "You";
  return "System";
}

function toGraphNode(n: BrainNode): GraphNode {
  return {
    id: n.id,
    kind: n.kind,
    kindLabel: KIND_LABEL[n.kind] ?? titleize(n.kind),
    kindColor: KIND_COLOR[n.kind] ?? "#8d92a0",
    label: n.label,
    summary: n.summary ?? n.body ?? "",
    tier: n.trustTier,
    confidence: normalizeConfidence(n.confidence),
    source: n.source ?? n.refTable ?? "",
    learnedBy: learnedByLabel(n.createdBy),
  };
}

export default async function BrainPage({ searchParams }: { searchParams: Promise<{ node?: string }> }) {
  const sp = await searchParams;
  const focusNodeId = typeof sp.node === "string" && sp.node.trim() ? sp.node.trim() : null;
  const [result, edgeResult, countResult, reviewResult] = await Promise.all([
    listNodes({}).catch(unavailable("brain.nodes")),
    listGraphEdges().catch(unavailable("brain.edges")),
    // The tiles need real totals, not the size of the browsable page.
    countNodesByTier().catch(unavailable("brain.tiers")),
    // Ask for the proposed nodes directly: filtering the capped list hid the ones
    // outside its recency window, so a node awaiting review could go unlisted
    // while the tile beside it read 0.
    listNodes({ trustTier: "proposed" }).catch(unavailable("brain.proposed")),
  ]);
  const nodes: BrainNode[] = result.status === "live" ? result.nodes : [];
  const facts = nodes.map(toFact);

  const graphNodes: GraphNode[] = nodes.map(toGraphNode);
  const nodeIds = new Set(graphNodes.map((n) => n.id));
  const graphEdges: GraphEdge[] =
    edgeResult.status === "live"
      ? edgeResult.edges
          .filter((e) => nodeIds.has(e.fromNodeId) && nodeIds.has(e.toNodeId))
          .map((e) => ({ from: e.fromNodeId, to: e.toNodeId, rel: e.relation }))
      : [];

  // Exact, whole-brain counts — `facts` is a capped page, not the brain.
  const counts =
    countResult.status === "live"
      ? countResult.counts
      : { total: facts.length, trusted: 0, observed: 0, proposed: 0 };

  const review = reviewResult.status === "live" ? reviewResult.nodes.map(toFact) : [];
  const learned = [...nodes]
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    .slice(0, 20)
    .map(toFact);

  const stats = [
    { label: "Knowledge nodes", value: counts.total, sub: "in Arc's memory", color: "" },
    { label: "Trusted", value: counts.trusted, sub: "approved for outbound", color: "var(--ok-text)" },
    { label: "Observed", value: counts.observed, sub: "watching, not yet trusted", color: "" },
    { label: "Awaiting review", value: counts.proposed, sub: "human approval required", color: counts.proposed > 0 ? "var(--warn-text)" : "" },
  ];

  // Reads the true count for the same reason the tile does: this note IS the trust
  // gate's visibility, and it was suppressed whenever the proposed facts happened
  // to sit outside the capped list.
  const coverageNote =
    counts.proposed > 0
      ? `${counts.proposed} proposed fact${counts.proposed === 1 ? "" : "s"} stay out of all outbound copy until you approve them — Arc's trust gate.`
      : "";

  // Reads that FAILED, as distinct from returning nothing. Without this, a
  // broken query renders as a Brain with no facts — indistinguishable from a
  // workspace Arc has not learned anything about yet (BSR-546).
  const loadErrors = ([
    ["Facts", reasonIfUnavailable(result)],
    ["Graph edges", reasonIfUnavailable(edgeResult)],
    ["Tier counts", reasonIfUnavailable(countResult)],
    ["Proposed facts", reasonIfUnavailable(reviewResult)],
  ] as Array<[string, string | null]>)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([label, reason]) => `${label}: ${reason}`);

  const data: BrainData = { stats, coverageNote, facts, totalFacts: counts.total, review, learned, graphNodes, graphEdges };
  return <BrainView data={data} focusNodeId={focusNodeId} loadErrors={loadErrors} />;
}
