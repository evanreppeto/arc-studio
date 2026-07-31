// `pnpm db:check-rls` — prove cross-tenant denial on real Postgres (BSR-521).
//
// Mocked tests cannot see RLS at all. That is not a gap in coverage, it is a
// blind spot: every unit test in this repo would pass with row-level security
// switched off entirely. This runs the REAL policies from supabase/migrations
// against a database they have actually been applied to, as the `authenticated`
// role, with a real JWT claim.
//
// Designed to run as a second step in the Migrations workflow, immediately after
// verify-migration-chain.mjs has already reset the database — so the chain is
// known-applied and this costs one psql invocation rather than a second stack.
// Run standalone locally and it will bring the stack up itself.
//
// Deliberately dependency-free, like verify-migration-chain.mjs: this must not
// be breakable by an unrelated lockfile change, and it runs in a CI job that
// installs nothing.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SQL_FILE = resolve(ROOT, "supabase/tests/rls-cross-tenant.sql");
const LABEL = "[db:check-rls]";

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const OFF = "[0m";

function die(message) {
  console.error(`${RED}✗${OFF} ${LABEL} ${message}`);
  process.exit(1);
}

if (!existsSync(SQL_FILE)) die(`missing ${SQL_FILE}`);

/** The db container name, discovered rather than assumed (it is project-scoped). */
function findDbContainer() {
  const out = spawnSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" });
  if (out.status !== 0) die("docker is not available — this check needs the local Supabase Postgres.");
  const names = out.stdout.split("\n").map((n) => n.trim()).filter(Boolean);
  return names.find((n) => n.startsWith("supabase_db_")) ?? null;
}

let container = findDbContainer();

if (!container) {
  console.log(`${LABEL} no Supabase Postgres running — starting one.`);
  // Same exclusion list as verify-migration-chain.mjs: schema work needs the
  // database, not the whole platform.
  const exclude = [
    "studio", "imgproxy", "inbucket", "mailpit", "edge-runtime", "logflare",
    "vector", "realtime", "storage-api", "supavisor", "postgres-meta",
  ].join(",");
  const start = spawnSync("supabase", ["start", "-x", exclude], { stdio: "inherit" });
  if (start.status !== 0) die("could not start the local Supabase stack.");
  const reset = spawnSync("supabase", ["db", "reset", "--no-seed"], { stdio: "inherit" });
  if (reset.status !== 0) die("could not apply the migration chain.");
  container = findDbContainer();
  if (!container) die("Supabase started but no supabase_db_* container was found.");
}

// Sanity: refuse to report success against an empty database. A chain that never
// ran would otherwise make every assertion below pass on nothing — the exact
// shape of failure this suite exists to catch elsewhere.
const tableCount = spawnSync(
  "docker",
  ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-tAc",
   "select count(*) from information_schema.tables where table_schema='public'"],
  { encoding: "utf8" },
);
const tables = Number((tableCount.stdout ?? "0").trim());
if (!Number.isFinite(tables) || tables < 20) {
  die(`only ${tables} public tables — the migration chain does not look applied. Run \`supabase db reset\` first.`);
}
console.log(`${DIM}${LABEL} ${tables} public tables present${OFF}`);

const sql = readFileSync(SQL_FILE, "utf8");

// ON_ERROR_STOP makes a raised exception a non-zero exit rather than a warning
// scrolling past in a green build.
const run = spawnSync(
  "docker",
  ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres",
   "-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-f", "-"],
  { input: sql, encoding: "utf8" },
);

const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
for (const line of output.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  if (trimmed.startsWith("NOTICE:")) {
    console.log(`  ${GREEN}✓${OFF} ${trimmed.replace(/^NOTICE:\s*/, "")}`);
  } else if (/ERROR|FATAL/.test(trimmed)) {
    console.log(`  ${RED}✗${OFF} ${trimmed}`);
  }
}

if (run.status !== 0) {
  die("cross-tenant isolation FAILED — see the error above. Do not merge this.");
}

// Guard against a silent pass: the SQL raises a notice per assertion, so no
// notices means the file did not actually execute.
const assertions = (output.match(/NOTICE:\s*ok:/g) ?? []).length;
if (assertions < 5) {
  die(`only ${assertions} assertions reported — expected at least 5. The SQL did not run as intended.`);
}

console.log(`${GREEN}✓${OFF} ${LABEL} cross-tenant isolation holds (${assertions} assertions).`);
