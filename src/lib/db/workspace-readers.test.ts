import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { TENANCY_CONTRACT, entryFor } from "../../../supabase/tenancy-contract.mjs";

/**
 * Every READ of a workspace-owned table must filter the workspace (BSR-729).
 *
 * WHY THIS EXISTS. The write side of the boundary is finished — 113 tables, all
 * `workspace_id NOT NULL` with workspace-member RLS. That does NOT make a read
 * workspace-safe, and the reason is easy to forget: **the service role bypasses
 * RLS entirely**. For every server-side read, the app-layer filter IS the
 * boundary; the policies do nothing there. A locked column with
 * `.eq("org_id", orgId)` and no workspace filter still returns the whole org.
 *
 * Not a live leak today — no product path puts a second workspace in an existing
 * org, so both filters select the same rows. It becomes one the day
 * multi-workspace-per-org ships, which makes this a hard prerequisite for that
 * feature rather than tidying.
 *
 * THIS IS A RATCHET, NOT A PASS/FAIL. There are 107 such sites across 59
 * file/table pairs, in modules whose functions take an `orgId` and nothing else —
 * closing them all means threading a workspace through ~30 call chains for no
 * observable change today, which is a worse trade than doing it deliberately.
 *
 * So the baseline below records what exists, and the tests enforce two things:
 *
 *   1. no NEW org-only read can land (the value that compounds), and
 *   2. every baseline entry must STILL be a violation — so fixing one forces
 *      deleting its line, and the list can only shrink.
 *
 * That second assertion is what stops this from becoming the permanent excuse
 * that `KNOWN_GAPS` nearly became on the write side.
 *
 * KNOWN LIMITATION, stated rather than discovered later: entries are keyed
 * `file:table`, not per line, so a file with three org-only reads of one table is
 * one entry and fixing two of the three will not flag it. Same trade the writer
 * audit makes — per-line keys churn on every edit above them.
 */

const ROOT = resolve(import.meta.dirname, "../../..");

type Entry = { category: string };
const contract = TENANCY_CONTRACT as Record<string, string | Entry>;

function workspaceTables(): string[] {
  return Object.keys(contract).filter((table) => (entryFor(table) as Entry).category === "workspace");
}

/**
 * Reads that filter `org_id` and never mention `workspace_id`, keyed `file:table`.
 * Each value records how many sites that pair had when the baseline was taken —
 * informational, since the key is what the ratchet tracks.
 *
 * DELETE a line when its file stops violating. Do not add one.
 */
const BASELINE: Record<string, string> = {
  "src/app/(app)/crm/actions.ts:campaigns": "1 site",
  "src/app/(app)/library/actions.ts:campaigns": "1 site",
  "src/app/(app)/library/actions.ts:media_folders": "1 site",
  "src/app/(app)/settings/actions.ts:business_profiles": "1 site",
  "src/lib/activation/read-model.ts:business_profiles": "1 site",
  "src/lib/activity/read-model.ts:agent_tasks": "1 site",
  "src/lib/approvals/read-model.ts:approval_decisions": "1 site",
  "src/lib/approvals/read-model.ts:approval_items": "1 site",
  "src/lib/arc-chat/run-inspector.ts:ai_usage_events": "1 site",
  "src/lib/arc-chat/run-inspector.ts:arc_conversations": "1 site",
  "src/lib/audience/campaign-audience.ts:campaigns": "1 site",
  "src/lib/auth/display-name.ts:workspace_memberships": "1 site",
  "src/lib/billing/entitlements.ts:ai_usage_events": "1 site",
  "src/lib/brain-ingestion/sync.ts:knowledge_nodes": "4 sites",
  "src/lib/brand-kit/logos.ts:brand_logos": "1 site",
  "src/lib/brand-kit/persistence.ts:business_profiles": "1 site",
  "src/lib/brand-knowledge/brain-sync.ts:knowledge_nodes": "1 site",
  "src/lib/campaigns/attach-media.ts:media_assets": "1 site",
  "src/lib/campaigns/external-send.ts:campaign_assets": "1 site",
  "src/lib/campaigns/revision-recovery.ts:agent_tasks": "2 sites",
  "src/lib/campaigns/revisions.ts:approval_items": "1 site",
  "src/lib/campaigns/revisions.ts:campaign_assets": "1 site",
  "src/lib/dispatch/email-identity.ts:business_profiles": "1 site",
  "src/lib/dispatch/execute-resend.ts:campaign_assets": "1 site",
  "src/lib/dispatch/execute-resend.ts:campaign_dispatches": "1 site",
  "src/lib/dispatch/resend-webhook.ts:campaign_dispatches": "1 site",
  "src/lib/exemplar-skills/read-model.ts:campaign_assets": "1 site",
  "src/lib/gallery/results-persistence.ts:campaign_results": "2 sites",
  "src/lib/import-runs/reverse.ts:import_run_records": "1 site",
  "src/lib/import-runs/reverse.ts:import_runs": "1 site",
  "src/lib/knowledge-graph/audience.ts:knowledge_nodes": "2 sites",
  "src/lib/knowledge-graph/graph.ts:knowledge_edges": "1 site",
  "src/lib/knowledge-graph/graph.ts:knowledge_nodes": "1 site",
  "src/lib/knowledge-graph/persistence.ts:knowledge_edges": "2 sites",
  "src/lib/knowledge-graph/persistence.ts:knowledge_nodes": "13 sites",
  "src/lib/knowledge-graph/read-model.ts:knowledge_edges": "2 sites",
  "src/lib/knowledge-graph/read-model.ts:knowledge_nodes": "5 sites",
  "src/lib/media-library/approval.ts:approval_items": "3 sites",
  "src/lib/media-library/approval.ts:media_assets": "1 site",
  "src/lib/media-library/arc-handoff.ts:media_assets": "4 sites",
  "src/lib/media-library/arc-handoff.ts:media_folders": "2 sites",
  "src/lib/media-library/persistence.ts:media_assets": "7 sites",
  "src/lib/media-library/persistence.ts:media_folders": "4 sites",
  "src/lib/media-library/read-model.ts:media_assets": "1 site",
  "src/lib/media-library/read-model.ts:media_folders": "1 site",
  "src/lib/opportunities/auto-draft.ts:opportunities": "1 site",
  "src/lib/opportunities/detector.ts:campaigns": "1 site",
  "src/lib/opportunities/detector.ts:competitor_campaigns": "1 site",
  "src/lib/opportunities/draft-package.ts:agent_tasks": "2 sites",
  "src/lib/opportunities/persistence.ts:opportunities": "2 sites",
  "src/lib/opportunities/read-model.ts:opportunities": "5 sites",
  "src/lib/opportunities/scan-status.ts:agent_tasks": "1 site",
  "src/lib/performance/opportunity-conversion.ts:approval_items": "1 site",
  "src/lib/performance/opportunity-conversion.ts:campaigns": "1 site",
  "src/lib/performance/opportunity-conversion.ts:opportunities": "1 site",
  "src/lib/persona-intelligence/read-model.ts:persona_knowledge_entries": "1 site",
  "src/lib/persona-intelligence/read-model.ts:persona_snapshots": "1 site",
  "src/lib/support/read-model.ts:support_requests": "1 site",
};

type ReadSite = { file: string; table: string; line: number };

/** Blank comments length-preservingly — see workspace-writers.test.ts for why. */
function blankComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

function scanOrgOnlyReads(tables: string[]): ReadSite[] {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src", "apps"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !f.includes(".test.") && !f.endsWith("database.types.ts"));

  const sites: ReadSite[] = [];
  for (const file of files) {
    const source = blankComments(readFileSync(resolve(ROOT, file), "utf8"));
    for (const table of tables) {
      const pattern = new RegExp(`\\.from\\(\\s*"${table}"`, "g");
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source))) {
        const rest = source.slice(match.index, match.index + 900);
        const end = rest.indexOf(";", 20);
        const window = end === -1 ? rest : rest.slice(0, end);
        // Writes are the other audit's job.
        if (/\.\s*(?:insert|upsert)\s*\(/.test(window)) continue;
        if (!/eq\(\s*"org_id"/.test(window)) continue;
        if (/workspace_id/.test(window)) continue;
        sites.push({ file, table, line: source.slice(0, match.index).split("\n").length });
      }
    }
  }
  return sites;
}

describe("every read of a workspace-owned table filters the workspace", () => {
  const tables = workspaceTables();
  const sites = scanOrgOnlyReads(tables);

  it("finds read sites at all — a scan that matches nothing would pass on air", () => {
    expect(tables.length).toBeGreaterThan(40);
    // Close to the real count (107) rather than a token floor: a slack bound is
    // exactly what hid a 22-site detection regression in the writer audit.
    expect(sites.length).toBeGreaterThanOrEqual(80);
  });

  it("has no org-only read outside the recorded baseline", () => {
    const unlisted = sites
      .filter((s) => !BASELINE[`${s.file}:${s.table}`])
      .map((s) => `${s.file}:${s.line} reads ${s.table} filtered by org_id alone`);
    expect(unlisted).toEqual([]);
  });

  it("keeps the baseline honest — a fixed entry must be deleted (the ratchet)", () => {
    const stillViolating = new Set(sites.map((s) => `${s.file}:${s.table}`));
    const stale = Object.keys(BASELINE).filter((key) => !stillViolating.has(key));
    expect(stale).toEqual([]);
  });
});
