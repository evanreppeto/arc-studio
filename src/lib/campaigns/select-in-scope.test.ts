import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every `selectIn` read of a workspace-owned table must pass a workspace.
 *
 * `src/lib/db/workspace-readers.test.ts` is the ratchet for this rule, and it
 * cannot see these: it scans for a literal `.from("table")` followed by
 * `.eq("org_id", …)`, and `selectIn` hides both behind a helper. So the campaign
 * read-model — which does nearly all of its reading through that helper — was
 * invisible to the audit that exists to catch exactly this, and two org-only
 * reads sat in it unlisted rather than baselined: the `media_assets` and
 * `approval_items` lookups behind `resolveMediaReviews`, and the
 * `approval_decisions` read beside them.
 *
 * Why it matters: the service role bypasses RLS, so for a server-side read the
 * app-layer filter IS the tenant boundary. `.eq("org_id", …)` alone returns
 * every workspace in the organisation. Not a live leak while each org holds one
 * workspace — a leak the day that stops being true, which is what makes it worth
 * pinning now rather than discovering then.
 *
 * The check is positional because `selectIn`'s signature is
 * `(client, table, columns, column, values, orderBy?, orgId?, workspaceId?)`:
 * a call that reaches `orgId` and stops has seven arguments, and the eighth is
 * the one that matters.
 */
const ROOT = resolve(import.meta.dirname, "../../..");

/** Mirrors `WORKSPACE_SCOPED_TABLES` in read-model.ts — read from the source so
 *  the two cannot drift, rather than being retyped here. */
function workspaceScopedTables(): string[] {
  const source = readFileSync(resolve(ROOT, "src/lib/campaigns/read-model.ts"), "utf8");
  const block = source.slice(source.indexOf("const WORKSPACE_SCOPED_TABLES"));
  const body = block.slice(0, block.indexOf("]);"));
  return [...body.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

/**
 * Split a call's argument list on top-level commas only, so a nested call or an
 * object literal does not read as an extra argument.
 *
 * String-aware, and that is not a detail: `selectIn`'s third argument is a
 * column list, and every real call passes something like `"id,storage_path"`.
 * A depth-only splitter counts the comma INSIDE that string, reports one
 * argument too many, and so believes a 7-argument call has 8 — which is exactly
 * the number this file checks for. The first version of this helper did that,
 * and the guard passed happily with the bug reintroduced.
 */
function splitArgs(argText: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < argText.length; i += 1) {
    const char = argText[i];
    if (quote) {
      current += char;
      // A backslash escapes the next character, including the closing quote.
      if (char === "\\") {
        current += argText[i + 1] ?? "";
        i += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    if ("([{".includes(char)) depth += 1;
    if (")]}".includes(char)) depth -= 1;
    current += char;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

type Call = { file: string; line: number; table: string; args: number };

function selectInCalls(): Call[] {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src", "apps"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(".test."));

  const calls: Call[] = [];
  for (const file of files) {
    const source = readFileSync(resolve(ROOT, file), "utf8");
    if (!source.includes("selectIn")) continue;
    const pattern = /\bselectIn\s*(?:<[^>]*>)?\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      // Walk to the matching close paren so multi-line calls are read whole.
      let depth = 1;
      let i = match.index + match[0].length;
      for (; i < source.length && depth > 0; i += 1) {
        if (source[i] === "(") depth += 1;
        else if (source[i] === ")") depth -= 1;
      }
      const argText = source.slice(match.index + match[0].length, i - 1);
      const args = splitArgs(argText);
      const table = (args[1] ?? "").replace(/["']/g, "").trim();
      calls.push({ file, line: source.slice(0, match.index).split("\n").length, table, args: args.length });
    }
  }
  return calls;
}

// The scanner is the thing being trusted here, so it gets its own assertions.
// Without these the guard reports "no violations" whether or not it can count,
// which is the failure mode it exists to prevent in other people's code.
describe("the argument splitter this guard relies on", () => {
  it("does not split on a comma inside a string — the bug that made this guard inert", () => {
    expect(splitArgs('client, "media_assets", "id,storage_path", "id", ids, undefined, orgId')).toHaveLength(7);
    expect(splitArgs('client, "t", "a,b,c", "col", vals, "created_at", orgId, workspaceId')).toHaveLength(8);
  });

  it("does not split inside nested calls or literals", () => {
    expect(splitArgs('client, "t", C, "col", xs.map((x) => x.id), "created_at", orgId')).toHaveLength(7);
    expect(splitArgs('client, "t", C, "col", [...a.keys()], undefined, orgId, ws')).toHaveLength(8);
  });
});

describe("selectIn reads carry the workspace", () => {
  const tables = workspaceScopedTables();
  const calls = selectInCalls();

  it("finds the calls at all — a scan that matches nothing would pass on air", () => {
    expect(tables.length).toBeGreaterThan(5);
    expect(tables).toContain("media_assets");
    expect(calls.length).toBeGreaterThanOrEqual(15);
    // And it must actually be parsing tables out, not collecting empty strings.
    expect(calls.filter((c) => tables.includes(c.table)).length).toBeGreaterThanOrEqual(10);
  });

  it("passes a workspace argument for every workspace-owned table", () => {
    const unscoped = calls
      .filter((call) => tables.includes(call.table))
      .filter((call) => call.args < 8)
      .map((call) => `${call.file}:${call.line} reads ${call.table} without a workspace argument`);
    expect(unscoped).toEqual([]);
  });
});
