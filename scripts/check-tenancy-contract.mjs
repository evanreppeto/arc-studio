// `pnpm db:check-tenancy` — hold the database to the tenant-scoping contract (BSR-638).
//
// The gap this closes: rls-cross-tenant.sql's assertion 5 checks that every table
// CARRYING org_id has RLS enabled. A brand-new table with no tenancy column at all
// sails straight past it — there is nothing for the assertion to notice. That is
// exactly how a table lands unscoped, and how docs/backend-workspace-data-boundary-audit.md
// spent four weeks describing a boundary the schema did not implement.
//
// So the primary assertion here is not about columns. It is:
//
//     every public table must appear in supabase/tenancy-contract.mjs
//
// A new table fails the build until someone decides what it belongs to. The column
// and nullability assertions follow from that classification.
//
// Runs after verify-migration-chain.mjs in the Migrations workflow, against the
// database that already has the chain applied. Dependency-free on purpose, like
// its neighbours: it runs in a CI job that installs nothing.
import { spawnSync } from "node:child_process";

import { CATEGORIES, REQUIRED_COLUMNS, TENANCY_CONTRACT, entryFor } from "../supabase/tenancy-contract.mjs";

const LABEL = "[db:check-tenancy]";
const GREEN = "[32m";
const RED = "[31m";
const YELLOW = "[33m";
const DIM = "[2m";
const OFF = "[0m";

const failures = [];

function die(message) {
  console.error(`${RED}✗${OFF} ${LABEL} ${message}`);
  process.exit(1);
}

function findDbContainer() {
  const out = spawnSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" });
  if (out.status !== 0) die("docker is not available — this check needs the local Supabase Postgres.");
  return out.stdout.split("\n").map((n) => n.trim()).filter(Boolean).find((n) => n.startsWith("supabase_db_")) ?? null;
}

let container = findDbContainer();
if (!container) {
  console.log(`${LABEL} no Supabase Postgres running — starting one.`);
  const exclude = [
    "studio", "imgproxy", "inbucket", "mailpit", "edge-runtime", "logflare",
    "vector", "realtime", "storage-api", "supavisor", "postgres-meta",
  ].join(",");
  if (spawnSync("supabase", ["start", "-x", exclude], { stdio: "inherit" }).status !== 0) {
    die("could not start the local Supabase stack.");
  }
  if (spawnSync("supabase", ["db", "reset", "--no-seed"], { stdio: "inherit" }).status !== 0) {
    die("could not apply the migration chain.");
  }
  container = findDbContainer();
  if (!container) die("Supabase started but no supabase_db_* container was found.");
}

function query(sql) {
  const out = spawnSync(
    "docker",
    ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-F", "|", "--no-psqlrc", "-c", sql],
    { encoding: "utf8" },
  );
  if (out.status !== 0) die(`psql failed: ${(out.stderr ?? "").trim()}`);
  return (out.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("|"));
}

// Columns and nullability for every public base table, plus RLS state. One query;
// psql round-trips are the slow part of this script.
const rows = query(`
  select c.relname,
         coalesce(max(case when a.attname = 'org_id' then case when a.attnotnull then 'notnull' else 'nullable' end end), 'absent'),
         coalesce(max(case when a.attname = 'workspace_id' then case when a.attnotnull then 'notnull' else 'nullable' end end), 'absent'),
         case when c.relrowsecurity then 'on' else 'off' end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r'
  group by c.relname, c.relrowsecurity
  order by c.relname
`);

if (rows.length < 20) {
  die(`only ${rows.length} public tables — the migration chain does not look applied. Run \`supabase db reset\` first.`);
}

const live = new Map(rows.map(([name, org, ws, rls]) => [name, { org, ws, rls }]));
console.log(`${DIM}${LABEL} ${live.size} public tables present${OFF}`);

// ── Assertion 1: every live table is classified ──────────────────────────────
// The one that actually stops the rot. Everything else is downstream of it.
const unclassified = [...live.keys()].filter((t) => !entryFor(t));
if (unclassified.length) {
  failures.push(
    `${unclassified.length} table(s) are missing from supabase/tenancy-contract.mjs: ${unclassified.join(", ")}.\n` +
    `    Decide what each one belongs to before it ships. The rule: if two workspaces in the same\n` +
    `    company could legitimately disagree about a row, it is workspace-owned; if disagreeing would\n` +
    `    just mean one of them is wrong, it is org-owned. See docs/backend-workspace-data-boundary-audit.md.`,
  );
}

// ── Assertion 2: declared categories are real ────────────────────────────────
for (const [table, raw] of Object.entries(TENANCY_CONTRACT)) {
  const entry = typeof raw === "string" ? { category: raw } : raw;
  if (!CATEGORIES.includes(entry.category)) {
    failures.push(`${table}: unknown category "${entry.category}" (expected one of ${CATEGORIES.join(", ")}).`);
  }
  if (entry.category === "inherits" && !entry.parent) {
    failures.push(`${table}: category "inherits" must name its parent table.`);
  }
}

// ── Assertion 3: columns match the category ──────────────────────────────────
// `pending` relaxes this and only this — the table is classified, its migration
// just hasn't landed. Counted and printed below so it can't quietly become
// permanent.
const pending = [];
for (const [table, state] of live) {
  const entry = entryFor(table);
  if (!entry) continue;
  const rule = REQUIRED_COLUMNS[entry.category];
  if (!rule) continue;

  if (entry.pending) {
    pending.push({ table, reason: entry.pending });
    continue;
  }

  for (const column of rule.required) {
    const actual = column === "org_id" ? state.org : state.ws;
    if (actual === "absent") {
      failures.push(`${table}: category "${entry.category}" requires ${column}, which is missing.`);
    } else if (actual === "nullable") {
      failures.push(
        `${table}: ${column} is nullable. A nullable scoping column lets a row belong to nobody — ` +
        `campaigns proved the app then quietly stops filtering on it (BSR-639).`,
      );
    }
  }

  for (const column of rule.forbidden) {
    const actual = column === "org_id" ? state.org : state.ws;
    if (actual !== "absent") {
      failures.push(
        `${table}: category "org" must NOT have ${column} — the customer record layer is shared across ` +
        `a company's workspaces. Reclassify it as "workspace" if that is wrong.`,
      );
    }
  }
}

// ── Assertion 4: inherited tables really do hang off their parent ────────────
// "Inherits tenancy through a FK" is only true if the FK exists and is NOT NULL.
// Otherwise it is just an unscoped table with a comforting label.
const inherited = Object.entries(TENANCY_CONTRACT)
  .map(([table, raw]) => [table, typeof raw === "string" ? { category: raw } : raw])
  .filter(([table, entry]) => entry.category === "inherits" && live.has(table));

if (inherited.length) {
  const fkRows = query(`
    select tc.table_name, ccu.table_name as parent, a.attnotnull
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
    join pg_attribute a on a.attrelid = ('public.' || tc.table_name)::regclass
                       and a.attname = kcu.column_name
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
  `);
  for (const [table, entry] of inherited) {
    const match = fkRows.find(([child, parent]) => child === table && parent === entry.parent);
    if (!match) {
      failures.push(`${table}: declared as inheriting from ${entry.parent}, but no foreign key to it exists.`);
    } else if (match[2] !== "t") {
      failures.push(
        `${table}: its ${entry.parent} foreign key is nullable, so a row can exist outside any tenant. ` +
        `Make it NOT NULL or give the table its own scoping column.`,
      );
    }
  }
}

// ── Assertion 5: tenant tables have RLS on ───────────────────────────────────
// Complements assertion 5 of rls-cross-tenant.sql, which can only see tables that
// already carry org_id. This one is driven by the contract, so a classified table
// with no columns yet is still covered.
for (const [table, state] of live) {
  const entry = entryFor(table);
  if (!entry || entry.category === "platform" || entry.category === "unclassified") continue;
  if (state.rls !== "on") {
    failures.push(`${table}: classified "${entry.category}" but RLS is DISABLED. Any session can read it.`);
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const stale = Object.keys(TENANCY_CONTRACT).filter((t) => !live.has(t));
if (stale.length) {
  // Not a failure: prod carries tables the chain does not build (the drift the
  // Migration drift workflow tracks). Reported so it stays visible.
  console.log(`${DIM}${LABEL} ${stale.length} contract entries absent from this database: ${stale.join(", ")}${OFF}`);
}

if (pending.length) {
  console.log(`${YELLOW}!${OFF} ${LABEL} ${pending.length} table(s) classified but not yet migrated:`);
  const byReason = new Map();
  for (const { table, reason } of pending) {
    if (!byReason.has(reason)) byReason.set(reason, []);
    byReason.get(reason).push(table);
  }
  for (const [reason, tables] of byReason) {
    console.log(`  ${DIM}${reason}${OFF}`);
    console.log(`    ${tables.join(", ")}`);
  }
}

if (failures.length) {
  console.error(`${RED}✗${OFF} ${LABEL} the schema does not match the tenancy contract:`);
  for (const failure of failures) console.error(`  ${RED}✗${OFF} ${failure}`);
  die(`${failures.length} contract violation(s). Do not merge this.`);
}

const enforced = live.size - pending.length;
console.log(`${GREEN}✓${OFF} ${LABEL} tenancy contract holds (${enforced} tables enforced, ${pending.length} pending migration).`);
