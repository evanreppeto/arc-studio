/**
 * Fold the restatements already sitting in the Brain into the node that first
 * said it (BSR-531 backfill).
 *
 * Semantic dedup ships on the WRITE path, so it only ever saw facts learned
 * after it landed. Everything stored before that is untouched — on prod the
 * live org measured 29 of 51 nodes carrying a near-twin at >= 0.93, which is
 * more than half the Brain restating itself. Recall is a bounded window, so
 * those duplicates crowd out distinct facts and degrade the answer.
 *
 * This applies the SAME decision function the write path uses
 * (src/domain/brain-dedup.ts) to what is already stored, so the backfill and
 * the live path can never drift on threshold or veto rules.
 *
 *   pnpm backfill:brain-dedup                      # dry run, every org
 *   pnpm backfill:brain-dedup --org <uuid>         # dry run, one org
 *   pnpm backfill:brain-dedup --org <uuid> --apply # write
 *
 * ── Safety ───────────────────────────────────────────────────────────────────
 * - Dry run unless --apply. The dry run prints every merge it would make.
 * - NOTHING IS DELETED. A folded node is archived (trust_tier='archived'), which
 *   is the same state archiveNode() produces: excluded from recall, never merged
 *   into. Its wording is also copied onto the survivor's props.brainMerges, so
 *   the fact is recoverable from either side.
 * - Record-backed nodes (ref_id set) are skipped, exactly as decideBrainDedup
 *   vetoes them: two CRM mirrors can read alike and still be different records.
 * - Edges are re-pointed onto the survivor before the loser is archived, so a
 *   fold never orphans a relation.
 * - Idempotent: archived nodes are not loaded as candidates, so a second run is
 *   a no-op.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { appendMergeRecord, DEDUP_SIMILARITY_THRESHOLD } from "../src/domain/brain-dedup";
import { planBrainFolds, type BackfillNode } from "../src/domain/brain-dedup-backfill";

type Args = { org: string | null; apply: boolean; threshold: number };

function parseArgs(argv: string[]): Args {
  const args: Args = { org: null, apply: false, threshold: DEDUP_SIMILARITY_THRESHOLD };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--org") args.org = argv[i + 1] ?? null;
    else if (argv[i] === "--apply") args.apply = true;
    else if (argv[i] === "--threshold") args.threshold = Number(argv[i + 1]);
  }
  if (!Number.isFinite(args.threshold) || args.threshold <= 0 || args.threshold > 1) {
    throw new Error(`--threshold must be between 0 and 1, got ${args.threshold}`);
  }
  return args;
}

/** Mirrors backfill-embeddings.mjs: .env.local first, system env wins. */
function loadLocalEnv(): void {
  let envText: string;
  try {
    envText = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

function getSupabase(): SupabaseClient {
  loadLocalEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env.local or the environment.");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Tiers the write path treats as live memory; archived/rejected are excluded. */
const LIVE_TIERS = ["trusted", "observed", "proposed"];

type NodeRow = {
  id: string;
  org_id: string;
  kind: string;
  key: string | null;
  label: string;
  summary: string | null;
  trust_tier: string;
  ref_id: string | null;
  props: Record<string, unknown> | null;
  created_at: string;
  embedding: unknown;
};

/** pgvector arrives over PostgREST as a JSON-ish string; tolerate both shapes. */
function parseEmbedding(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw.every((n) => typeof n === "number") ? (raw as number[]) : null;
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((n) => typeof n === "number") ? (parsed as number[]) : null;
  } catch {
    return null;
  }
}

type Fold = { loser: NodeRow; winner: NodeRow; similarity: number };

/** Map stored rows onto the pure planner's shape, then resolve ids back to rows. */
function planFolds(nodes: NodeRow[], threshold: number): { folds: Fold[]; survivorCount: number } {
  const byId = new Map(nodes.map((row) => [row.id, row]));
  const planNodes: BackfillNode[] = nodes.map((row) => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    summary: row.summary,
    trustTier: row.trust_tier,
    refId: row.ref_id,
    createdAt: row.created_at,
    embedding: parseEmbedding(row.embedding),
  }));

  const plan = planBrainFolds(planNodes, { threshold });
  const folds: Fold[] = [];
  for (const fold of plan.folds) {
    const loser = byId.get(fold.loserId);
    const winner = byId.get(fold.winnerId);
    if (loser && winner) folds.push({ loser, winner, similarity: fold.similarity });
  }
  return { folds, survivorCount: plan.survivorIds.length };
}

/** Apply one fold: retain the wording, re-point edges, archive the loser. */
async function applyFold(client: SupabaseClient, fold: Fold): Promise<void> {
  const props = fold.winner.props ?? {};
  const merges = appendMergeRecord((props as { brainMerges?: unknown }).brainMerges, {
    label: fold.loser.label,
    summary: fold.loser.summary,
    key: fold.loser.key,
    similarity: fold.similarity,
    at: new Date().toISOString(),
    source: "backfill:brain-dedup",
  });

  const updateWinner = await client
    .from("knowledge_nodes")
    // updated_at is the fact's latest confirmation, which is what decay ranks on.
    .update({ props: { ...props, brainMerges: merges }, updated_at: new Date().toISOString() })
    .eq("id", fold.winner.id)
    .eq("org_id", fold.winner.org_id);
  if (updateWinner.error) throw new Error(`winner update failed (${fold.winner.id}): ${updateWinner.error.message}`);

  // Re-point relations before the node leaves live memory, so a fold never
  // orphans an edge. Done first: an archived node with live edges is worse
  // than a node archived a moment late.
  for (const column of ["from_node_id", "to_node_id"] as const) {
    const moved = await client
      .from("knowledge_edges")
      .update({ [column]: fold.winner.id })
      .eq(column, fold.loser.id)
      .eq("org_id", fold.loser.org_id);
    if (moved.error) throw new Error(`edge re-point failed (${column}, ${fold.loser.id}): ${moved.error.message}`);
  }

  const archive = await client
    .from("knowledge_nodes")
    .update({ trust_tier: "archived" })
    .eq("id", fold.loser.id)
    .eq("org_id", fold.loser.org_id);
  if (archive.error) throw new Error(`archive failed (${fold.loser.id}): ${archive.error.message}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = getSupabase();

  let query = client
    .from("knowledge_nodes")
    .select("id,org_id,kind,key,label,summary,trust_tier,ref_id,props,created_at,embedding")
    .in("trust_tier", LIVE_TIERS)
    // Record mirrors are deduped by reference, not wording. Excluded here so the
    // scan never even considers them (decideBrainDedup vetoes them anyway).
    .is("ref_id", null)
    .not("embedding", "is", null);
  if (args.org) query = query.eq("org_id", args.org);

  const { data, error } = await query.returns<NodeRow[]>();
  if (error) throw new Error(`node load failed: ${error.message}`);
  const rows = data ?? [];

  const byOrg = new Map<string, NodeRow[]>();
  for (const row of rows) byOrg.set(row.org_id, [...(byOrg.get(row.org_id) ?? []), row]);

  console.log(`\nBrain dedup backfill — ${args.apply ? "APPLY" : "DRY RUN"} · threshold ${args.threshold}`);
  console.log(`${rows.length} eligible node(s) across ${byOrg.size} org(s).\n`);

  let totalFolds = 0;
  let totalFailed = 0;

  for (const [orgId, orgRows] of byOrg) {
    const { folds, survivorCount } = planFolds(orgRows, args.threshold);
    console.log(`org ${orgId}: ${orgRows.length} nodes → ${survivorCount} after folding (${folds.length} restatement(s))`);

    for (const fold of folds) {
      console.log(`  fold "${fold.loser.label}" → "${fold.winner.label}"  (${fold.similarity.toFixed(3)})`);
      if (!args.apply) continue;
      try {
        await applyFold(client, fold);
        totalFolds += 1;
      } catch (err) {
        totalFailed += 1;
        // Keep going: one bad fold must not strand the rest, and every fold is
        // independent. The failure is reported, never swallowed.
        console.error(`    FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (folds.length) console.log("");
  }

  if (!args.apply) {
    console.log("Dry run — nothing written. Re-run with --apply to fold.\n");
    return;
  }
  console.log(`Folded ${totalFolds} node(s)${totalFailed ? `, ${totalFailed} failed` : ""}.\n`);
  if (totalFailed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
