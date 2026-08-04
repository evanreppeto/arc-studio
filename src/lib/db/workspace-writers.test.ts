import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Plain .mjs contract data — the same file the DB-side check reads, so writers and
// schema can never be enforced against two different lists.
import { TENANCY_CONTRACT, entryFor } from "../../../supabase/tenancy-contract.mjs";

/**
 * Every insert into a workspace-owned table must stamp the workspace (BSR-720).
 *
 * WHY THIS EXISTS. BSR-710 updated the writers its ticket named and stopped there.
 * An audit run by hand afterwards found **15 more insert sites** still writing
 * `org_id` alone — one of which had already broken Arc's campaign runs in
 * production, because `campaigns.workspace_id` was `NOT NULL` by then and the
 * orchestrator inserted through an org-only helper. Nothing failed: a mocked
 * insert cannot see a not-null constraint, so the entire suite stayed green
 * while `POST /api/v1/arc/runs` could not create a campaign.
 *
 * The audit caught it. This test is that audit, so the next wave does not depend
 * on someone remembering to run it.
 *
 * IT KEYS ON `hasColumn`, NOT ON `pending`. The moment a column lands, its
 * writers must stamp it — waiting for the Phase B lock is precisely the mistake
 * that produced the outage above.
 */

const ROOT = resolve(import.meta.dirname, "../../..");

type Entry = { category: string; pending?: string; hasColumn?: boolean };
const contract = TENANCY_CONTRACT as Record<string, string | Entry>;

/** Tables whose `workspace_id` column exists — enforced, pending or not. */
function enforcedTables(): string[] {
  return Object.keys(contract).filter((table) => {
    const e = entryFor(table) as Entry;
    return e.category === "workspace" && (!e.pending || e.hasColumn === true);
  });
}

/**
 * A payload counts as stamped if it uses one of the shared helpers, names the
 * column outright, or spreads a variable that carries a tenant. That last form is
 * real and common — `...taskTenant`, `...input.tenant` — and treating it as a
 * violation would train people to ignore this test, which is worse than not
 * having it.
 */
const STAMPED = [
  /workspaceScopeFields/,
  /workspaceIdFields/,
  /withWorkspace/,
  /workspace_id/,
  /\.\.\.\s*[\w.]*[Tt]enant\b/,
  /\.\.\.\s*[\w.]*[Ss]cope\b/,
];

/**
 * Insert sites whose payload is a prebuilt VARIABLE rather than an object literal
 * — `.insert(payload)`, not `.insert({ ... })`. No static check can see inside
 * one, so each needs a human to have looked once and said so here.
 *
 * Modelled separately from "unstamped" on purpose: conflating "I cannot tell" with
 * "it is wrong" produces noise, and a noisy check gets ignored.
 */
const OPAQUE_PAYLOADS: Record<string, string> = {
  // membership is assembled directly above with org_id + workspace_id, both NOT
  // NULL on this table — provisioning demonstrably works, so it stamps them.
  "src/lib/auth/user-provisioning.ts:workspace_memberships": "membership built above with both columns",
  "src/lib/auth/workspace-onboarding.ts:workspace_memberships": "workspaceMembership built above with both columns",
  // payload carries workspace_id — proved by the legacy retry a few lines down,
  // which reads `workspace_id: payload.workspace_id` off it.
  "src/lib/agent/tokens.ts:agent_api_tokens": "payload/legacyPayload both carry workspace_id",
};

/**
 * Sites that genuinely do NOT stamp yet, each tied to the wave that fixes it.
 *
 * These are recorded rather than ignored, and the test asserts each one is STILL
 * a violation — so when a wave fixes it, this test fails until the line is
 * deleted. A stale exception list is how a check quietly stops meaning anything.
 */
const KNOWN_GAPS: Record<string, string> = {
  // arc_messages.workspace_id is nullable (Group B). Wave 4 / BSR-716 backfills
  // it, tightens it, and updates these three writes.
  "src/lib/arc-chat/persistence.ts:arc_messages": "BSR-716 (Wave 4, Group B)",
};

/**
 * KNOWN LIMITATION, stated rather than discovered later: both exception lists are
 * keyed `file:table`, not per line. A file with three unstamped writes to one
 * table is a single entry, so fixing two of the three will not flag the entry as
 * stale — only fixing all of them will. Verified deliberately.
 *
 * Left as-is because per-line keys churn on every edit above them, which is how an
 * exception list becomes noise. The coarse key still holds the property that
 * matters: an entry cannot survive once the file is fully fixed.
 */

type Site = { file: string; table: string; line: number; stamped: boolean; opaque: boolean };

/**
 * Is the `"table"` string literal at `index` part of an INSERT?
 *
 * WHY THIS IS NOT A REGEX ANY MORE. The original pattern hardcoded two helper
 * names (`insertOne`, `insertNoReturn`) and required `.from("t")` to close
 * immediately. This repo has **six** insert helpers — `insertOne` (three separate
 * definitions), `insertNoReturn`, `insertGetId`, `insertAndReturnId` (two), and
 * `insertManyAndReturnIds` — and at least one call site written
 * `.from("media_folders" as string).insert(rows)`, where a cast alone defeated the
 * match. Measured against the real tree, the old pattern saw 2 of 5 write forms.
 *
 * It had not caused a miss yet, only because the tables using the unseen helpers
 * were not enforced yet — they are Wave 3's (BSR-714). A guard that would have
 * gone quietly blind on the next wave is the same failure it exists to prevent,
 * so it is fixed before that wave rather than after it.
 *
 * Two shapes count, decided structurally instead of by pattern:
 *   1. helper form  — `<name containing insert/upsert>(client, "table", …)`
 *   2. builder form — `.from("table"…)` followed by `.insert(` / `.upsert(`
 */
function isWriteSite(source: string, index: number, table: string): boolean {
  const before = source.slice(Math.max(0, index - 160), index);

  // 1. Any helper whose name contains insert/upsert, taking (client, "table", …).
  //    The leading `[\w$]*` must be able to match EMPTY: `insertOne` starts with
  //    the word, and requiring a character before it silently dropped 22 sites —
  //    every `insertOne(client, "campaigns", …)` in the tree. Caught by comparing
  //    site counts against the previous implementation rather than by the suite,
  //    which stayed green because `sites.length > 50` was slack enough to hide it.
  if (/\b[\w$]*(?:[Ii]nsert|[Uu]psert)[\w$]*\s*\(\s*[\w.]+\s*,\s*$/.test(before)) return true;

  // 2. `.from("table")`, tolerating a cast, then an insert/upsert in the same
  //    statement. Bounded to the statement so a later unrelated write cannot
  //    claim this read.
  if (!/\.\s*from\(\s*$/.test(before)) return false;
  const rest = source.slice(index + table.length + 2, index + 1200);
  const end = rest.indexOf(";");
  return /\.\s*(?:insert|upsert)\s*\(/.test(end === -1 ? rest : rest.slice(0, end));
}

function scanInsertSites(tables: string[]): Site[] {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src", "apps"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !f.includes(".test.") && !f.endsWith("database.types.ts"));

  const sites: Site[] = [];
  for (const file of files) {
    const source = readFileSync(resolve(ROOT, file), "utf8");
    for (const table of tables) {
      // Every mention of the table name is a candidate; `isWriteSite` decides.
      // This used to be a single regex naming `insertOne|insertNoReturn` and
      // requiring `.from("t")` to close immediately — see WHY below.
      const pattern = new RegExp(`"${table}"`, "g");
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source))) {
        if (!isWriteSite(source, match.index, table)) continue;
        // Bound the window to the insert STATEMENT, not a fixed character count.
        // A flat 700 chars bled into the next statement and picked up an unrelated
        // `.select("...workspace_id...")`, marking an unstamped write as stamped —
        // caught by the staleness check below, which is exactly its job.
        const rest = source.slice(match.index, match.index + 900);
        const end = rest.indexOf(";", 20);
        const window = end === -1 ? rest : rest.slice(0, end);
        // Does the call take an object literal, or a prebuilt variable?
        const arg = window.slice(window.indexOf("(", window.indexOf(table) + table.length));
        const opaque = /^\(\s*[A-Za-z_$][\w$.]*\s*\)/.test(arg.replace(/^[^(]*/, "")) || /\.\s*(?:insert|upsert)\(\s*[A-Za-z_$][\w$.]*\s*\)/.test(window);

        sites.push({
          file,
          table,
          line: source.slice(0, match.index).split("\n").length,
          stamped: STAMPED.some((re) => re.test(window)),
          opaque,
        });
      }
    }
  }
  return sites;
}

describe("every write to a workspace-owned table stamps the workspace", () => {
  const tables = enforcedTables();
  const sites = scanInsertSites(tables);

  it("finds the insert sites at all — a scan that matches nothing would pass on air", () => {
    expect(tables.length).toBeGreaterThan(20);
    // Deliberately close to the real count (91 across 36 enforced tables), not a
    // token floor. This bound used to be `> 50`, which was slack enough to hide a
    // detection regression that dropped 22 real sites — every
    // `insertOne(client, "campaigns", …)` in the tree — while the suite stayed
    // green. A coverage assertion that cannot fail is not a coverage assertion.
    //
    // Raise it when a wave adds tables; if it ever drops, the scanner broke, not
    // the codebase.
    expect(sites.length).toBeGreaterThanOrEqual(85);
  });

  it("has no unstamped insert site outside the recorded gaps", () => {
    const violations = sites
      .filter((s) => !s.stamped)
      .filter((s) => !OPAQUE_PAYLOADS[`${s.file}:${s.table}`])
      .filter((s) => !KNOWN_GAPS[`${s.file}:${s.table}`])
      .map((s) => `${s.file}:${s.line} writes ${s.table} without a workspace`);

    expect(violations).toEqual([]);
  });

  it("keeps the recorded gaps honest — a fixed one must be deleted from the list", () => {
    // Without this, the exception list rots into a permanent excuse and the check
    // silently narrows every time someone fixes something.
    const stillUnstamped = new Set(
      sites.filter((s) => !s.stamped).map((s) => `${s.file}:${s.table}`),
    );
    const stale = Object.keys(KNOWN_GAPS).filter((key) => !stillUnstamped.has(key));
    expect(stale).toEqual([]);
  });

  it("requires every opaque payload to be explicitly vouched for", () => {
    // A `.insert(variable)` that nobody has listed is not a pass — it is an
    // unknown, and unknowns are what this test exists to surface.
    const unvouched = sites
      .filter((s) => s.opaque && !s.stamped)
      .filter((s) => !OPAQUE_PAYLOADS[`${s.file}:${s.table}`])
      .map((s) => `${s.file}:${s.line} inserts into ${s.table} from a prebuilt payload — check it and add it to OPAQUE_PAYLOADS`);
    expect(unvouched).toEqual([]);
  });

  it("keeps the opaque-payload allowlist honest too", () => {
    const stillUnstamped = new Set(
      sites.filter((s) => !s.stamped).map((s) => `${s.file}:${s.table}`),
    );
    const stale = Object.keys(OPAQUE_PAYLOADS).filter((key) => !stillUnstamped.has(key));
    expect(stale).toEqual([]);
  });
});
