// `pnpm db:verify-chain` — prove supabase/migrations/ applies cleanly to an
// EMPTY database, and that the result is the schema we expect (BSR-474).
//
// Why this exists: the chain once could not apply to a fresh database at all
// (duplicate version prefixes — see supabase/migrations-legacy/, which still
// contains four duplicate pairs). The rebaseline fixed it, but "no duplicates
// by inspection" is not proof, and every future environment depends on this:
// a new staging app, a self-hosted eval DB, disaster recovery, and any
// per-tenant database story.
//
// What it does:
//   1. Guard duplicate version prefixes (cheap, no Docker).
//   2. Bring up the local Supabase Postgres (idempotent).
//   3. `supabase db reset` — drops the database and replays every migration
//      from empty. This is the actual assertion.
//   4. Check the result is a real schema, not an empty one that threw no error.
//
// Runs the same way locally and in CI (.github/workflows/migrations.yml).
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");

// Services irrelevant to schema. Excluding them keeps CI to the Postgres
// container instead of the whole platform.
const EXCLUDE = [
  "studio",
  "imgproxy",
  "inbucket",
  "mailpit",
  "edge-runtime",
  "logflare",
  "vector",
  "realtime",
  "storage-api",
  "supavisor",
  "postgres-meta",
].join(",");

let failures = 0;

function pass(msg) {
  console.log(`  [32m✓[0m ${msg}`);
}

function fail(msg) {
  failures += 1;
  console.log(`  [31m✗[0m ${msg}`);
}

function step(msg) {
  console.log(`\n[1m${msg}[0m`);
}

// Prefer a real `supabase` binary (CI installs one via supabase/setup-cli, and
// many machines have it) and fall back to npx, mirroring scripts/sandbox/lib.mjs.
const HAS_SUPABASE_BIN = spawnSync("which", ["supabase"], { encoding: "utf8" }).status === 0;

function supabase(args, opts = {}) {
  const [cmd, argv] = HAS_SUPABASE_BIN
    ? ["supabase", args]
    : ["npx", ["--yes", "supabase@2", ...args]];
  return spawnSync(cmd, argv, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: opts.inherit ? "inherit" : "pipe",
    ...opts,
  });
}

// The db container name is derived from project_id in supabase/config.toml.
function containerName() {
  const toml = readFileSync(resolve(ROOT, "supabase/config.toml"), "utf8");
  const match = toml.match(/^\s*project_id\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error("Could not read project_id from supabase/config.toml");
  return `supabase_db_${match[1]}`;
}

// Query through the container rather than a local psql: Docker is already a
// hard requirement for the local stack, psql is not installed everywhere.
function sql(query) {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName(), "psql", "-U", "postgres", "-d", "postgres", "-tAc", query],
    { encoding: "utf8" },
  ).trim();
}

// ---------------------------------------------------------------------------

step("1. Migration filenames");

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

const malformed = files.filter((f) => !/^\d{14}_.+\.sql$/.test(f) && f !== "00000000000000_baseline.sql");
if (malformed.length) {
  fail(`Files not matching <14-digit timestamp>_name.sql: ${malformed.join(", ")}`);
} else {
  pass(`All ${files.length} filenames conform to the timestamp convention.`);
}

// The original blocker. Supabase keys the ledger on the version prefix, so two
// files sharing one prefix means the second is silently never applied to a
// fresh database.
const seen = new Map();
for (const f of files) {
  const version = f.slice(0, 14);
  seen.set(version, [...(seen.get(version) ?? []), f]);
}
const duplicates = [...seen.entries()].filter(([, group]) => group.length > 1);
if (duplicates.length) {
  for (const [version, group] of duplicates) {
    fail(`Duplicate version prefix ${version}: ${group.join(", ")}`);
  }
  fail("A duplicate prefix means the later migration is silently skipped on a fresh database.");
} else {
  pass("No duplicate version prefixes.");
}

if (failures) {
  console.log("\nFilename problems block the chain — not starting Postgres.\n");
  process.exit(1);
}

// ---------------------------------------------------------------------------

step("2. Local Postgres");

const status = supabase(["status"]);
if (status.status === 0) {
  pass("Stack already running.");
} else {
  console.log("  Starting (first run pulls images — this can take a few minutes)…");
  const started = supabase(["start", "-x", EXCLUDE], { inherit: true });
  if (started.status !== 0) {
    console.log("\n`supabase start` failed. Is Docker running?\n");
    process.exit(1);
  }
  pass("Stack started.");
}

// ---------------------------------------------------------------------------

step("3. Replay the whole chain onto an empty database");

const reset = supabase(["db", "reset"], { inherit: true });
if (reset.status !== 0) {
  console.log(`\n[31m"supabase db reset" failed (exit ${reset.status}).[0m`);
  console.log("The chain does NOT apply cleanly to an empty database.\n");
  process.exit(1);
}
pass("`supabase db reset` completed.");

// ---------------------------------------------------------------------------

step("4. The result is a real schema");

// The crispest completeness check: every file landed in the ledger. Catches a
// migration that is skipped without erroring.
const applied = Number(sql("select count(*) from supabase_migrations.schema_migrations"));
if (applied === files.length) {
  pass(`Ledger records all ${files.length} migrations.`);
} else {
  fail(`Ledger has ${applied} migrations but supabase/migrations/ has ${files.length}.`);
}

const tables = Number(
  sql("select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"),
);
if (tables > 0) pass(`${tables} tables in public.`);
else fail("public schema has no tables — the reset produced an empty database.");

// Contract invariants from CLAUDE.md / docs. These are load-bearing: the
// ingest API and the per-org persona taxonomy both depend on them.
const checks = [
  ["personas table exists (per-org taxonomy is the authority)", "select to_regclass('public.personas') is not null"],
  [
    "persona_mapping enum is gone (replaced by the personas table)",
    "select not exists(select 1 from pg_type where typname='persona_mapping' and typnamespace='public'::regnamespace)",
  ],
  [
    "leads_persona_not_unassigned_check constraint exists",
    "select exists(select 1 from pg_constraint where conname='leads_persona_not_unassigned_check')",
  ],
];
for (const [label, query] of checks) {
  if (sql(query) === "t") pass(label);
  else fail(label);
}

// Reported, not gated. Making this a hard gate is BSR-521's scope (CI
// regression tests for tenant isolation), not this ticket's.
const rlsOff = sql(
  "select coalesce(string_agg(tablename, ', ' order by tablename), '') from pg_tables where schemaname='public' and not rowsecurity",
);
if (rlsOff === "") {
  console.log(`  [2m·[0m all ${tables} public tables have RLS enabled`);
} else {
  console.log(`  [33m![0m public tables WITHOUT RLS: ${rlsOff}`);
}

// ---------------------------------------------------------------------------

if (failures) {
  console.log(`\n[31m${failures} check(s) failed.[0m\n`);
  process.exit(1);
}
console.log("\n[32mThe migration chain applies cleanly to an empty database.[0m\n");
