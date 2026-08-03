import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Plain .mjs contract data, deliberately dependency-free so the CI script that runs
// without node_modules imports the same file this test does — one source of truth,
// not two that drift.
import { TENANCY_CONTRACT, CATEGORIES, entryFor } from "../../../supabase/tenancy-contract.mjs";

/**
 * The static half of BSR-638. `pnpm db:check-tenancy` holds the live schema to the
 * contract and needs Postgres; these run in the normal suite with no database, and
 * cover the two things that don't need one: the contract being internally coherent,
 * and nothing having quietly wired a table nobody has classified.
 */

const ROOT = resolve(import.meta.dirname, "../../..");

type Entry = { category: string; parent?: string; pending?: string };
const contract = TENANCY_CONTRACT as Record<string, string | Entry>;
const normalized = (table: string): Entry => entryFor(table) as Entry;

describe("tenancy contract is internally coherent", () => {
  it("gives every table a real category", () => {
    const bad = Object.keys(contract)
      .map((table) => ({ table, category: normalized(table).category }))
      .filter(({ category }) => !(CATEGORIES as string[]).includes(category));
    expect(bad).toEqual([]);
  });

  it("names a parent for every inheriting table, and the parent is itself tenant-scoped", () => {
    // "Inherits tenancy through its parent" is only meaningful if the parent has
    // tenancy to inherit. A chain ending in an unclassified table isolates nothing.
    const problems: string[] = [];
    for (const table of Object.keys(contract)) {
      const entry = normalized(table);
      if (entry.category !== "inherits") continue;
      if (!entry.parent) {
        problems.push(`${table}: no parent named`);
        continue;
      }
      const parent = contract[entry.parent] ? normalized(entry.parent) : null;
      if (!parent) problems.push(`${table}: parent ${entry.parent} is not in the contract`);
      else if (parent.category !== "org" && parent.category !== "workspace") {
        problems.push(`${table}: parent ${entry.parent} is "${parent.category}", which has no tenancy to inherit`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("only marks a table pending if it is one that needs columns", () => {
    // `pending` relaxes the column assertion. On a category that has no column
    // requirement it does nothing but hide intent.
    const misplaced = Object.keys(contract)
      .map((table) => ({ table, ...normalized(table) }))
      .filter((e) => e.pending && e.category !== "org" && e.category !== "workspace")
      .map((e) => `${e.table} (${e.category})`);
    expect(misplaced).toEqual([]);
  });
});

describe("every table the generated types know about is classified", () => {
  // database.types.ts is generated from the real schema, so it is a second net
  // under the live check in `pnpm db:check-tenancy` — and unlike that one, it runs
  // without Docker on every PR.
  it("has no unclassified table in database.types.ts", () => {
    const source = readFileSync(resolve(ROOT, "src/lib/supabase/database.types.ts"), "utf8");
    const lines = source.split("\n");
    const start = lines.findIndex((line) => line.trim() === "Tables: {");
    expect(start).toBeGreaterThan(-1);

    const tables: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      if (/^ {4}\}/.test(lines[i])) break;
      const match = /^ {6}(\w+): \{$/.exec(lines[i]);
      if (match) tables.push(match[1]);
    }

    // Guard against the parse silently matching nothing and the test passing on air.
    expect(tables.length).toBeGreaterThan(50);
    expect(tables.filter((table) => !contract[table])).toEqual([]);
  });
});

describe("unclassified tables are not wired", () => {
  // The rule from docs/backend-workspace-data-boundary-audit.md: a Category 5 table
  // cannot be wired until it has been classified. This is what enforces it. The
  // import scaffold (external_systems, external_object_mappings) is the live case —
  // BSR-640 revives it, and this test is what makes that revival decide a category
  // first rather than inheriting "unscoped" by default.
  it("finds no reference to an unclassified table in src/ or apps/", () => {
    const unclassified = Object.keys(contract).filter((table) => normalized(table).category === "unclassified");
    expect(unclassified.length).toBeGreaterThan(0);

    // git ls-files rather than a directory walk: it respects .gitignore, and a
    // byte-level read rather than grep because grep silently skips any file
    // containing a NUL byte.
    //
    // --others --exclude-standard matters more than it looks: without it only
    // TRACKED files are listed, so brand-new code — the exact case this test is
    // meant to catch — is invisible until it is staged. Verified by deleting the
    // flag and watching a deliberately wired table pass.
    const files = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "src", "apps"],
      { cwd: ROOT, encoding: "utf8" },
    )
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean)
      .filter((f) => /\.(ts|tsx|mts|mjs|js|jsx|sql)$/.test(f))
      // The generated types name every table by definition; that is not "wired".
      .filter((f) => !f.endsWith("database.types.ts"))
      // This test names them all, and so does the contract it imports.
      .filter((f) => !f.endsWith("tenancy-contract.test.ts"));

    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(resolve(ROOT, file), "latin1");
      for (const table of unclassified) {
        // Quoted forms only. A bare word would flag prose and unrelated
        // identifiers — "audits" and "events" are ordinary English.
        if (text.includes(`"${table}"`) || text.includes(`'${table}'`) || text.includes(`\`${table}\``)) {
          hits.push(`${file} references "${table}"`);
        }
      }
    }

    expect(hits).toEqual([]);
  });
});
