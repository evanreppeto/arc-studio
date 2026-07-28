// `pnpm db:check-drift` — is PROD running code ahead of its schema? (BSR-545)
//
// Migrations are applied to prod by hand (DEPLOY.md). Nothing enforced it, and
// on 2026-07-28 PR #680 merged code selecting `campaigns.considered_audiences`
// while its migration was never applied — every campaigns read on prod threw and
// `/campaigns` was broken for every tenant. CI was green throughout, because CI
// never touches prod's schema.
//
// This is the DRIFT half. BSR-474 (`pnpm db:verify-chain`) is the other half —
// it proves the chain applies to an EMPTY database. Both can be true and false
// independently: a chain that replays perfectly still says nothing about whether
// the database prod actually has matches the code that shipped.
//
// Uses the Supabase CLI, which is built for exactly this comparison, rather than
// reading the ledger directly: `schema_migrations` lives in the
// `supabase_migrations` schema, which PostgREST does not serve, so supabase-js
// cannot see it.
//
// Needs SUPABASE_DB_URL (the prod Postgres connection string, percent-encoded).
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DB_URL = process.env.SUPABASE_DB_URL?.trim();

if (!DB_URL) {
  console.error(
    "\x1b[31mSUPABASE_DB_URL is not set.\x1b[0m\n" +
      "This check compares supabase/migrations/ against the database's applied ledger.\n" +
      "Without it the check cannot run — and a drift detector that silently no-ops is\n" +
      "worse than none, so this is a hard failure rather than a skip.\n",
  );
  process.exit(1);
}

const hasBin = spawnSync("which", ["supabase"], { encoding: "utf8" }).status === 0;
const [cmd, pre] = hasBin ? ["supabase", []] : ["npx", ["--yes", "supabase@2"]];

// Text output first: whatever else happens, the log shows the real comparison.
console.log("supabase migration list:\n");
spawnSync(cmd, [...pre, "migration", "list", "--db-url", DB_URL], { cwd: ROOT, stdio: "inherit" });

const res = spawnSync(cmd, [...pre, "migration", "list", "--db-url", DB_URL, "--output-format", "json"], {
  cwd: ROOT,
  encoding: "utf8",
});
if (res.status !== 0) {
  console.error(`\n\x1b[31m\`supabase migration list\` failed (exit ${res.status}).\x1b[0m`);
  console.error(res.stderr?.trim() || "(no stderr)");
  process.exit(1);
}

// The local side is authoritative from disk — we do not depend on the CLI's
// notion of "local", only on its report of what the REMOTE has applied.
const localVersions = readdirSync(resolve(ROOT, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.slice(0, 14))
  .sort();

let rows;
try {
  rows = JSON.parse(res.stdout);
} catch {
  console.error("\n\x1b[31mCould not parse `supabase migration list --output-format json`.\x1b[0m");
  console.error("Refusing to report 'no drift' from output this script did not understand.");
  process.exit(1);
}

// Observed shape (CLI v2): { migrations: [{ local, remote, time }] }. Accept a
// bare array too, since that has been the shape in other versions — but never
// infer "applied" from absence: an unrecognised shape must fail, not pass.
const list = Array.isArray(rows) ? rows : Array.isArray(rows?.migrations) ? rows.migrations : [];
const remoteVersions = new Set(
  list
    .map((r) => r?.remote ?? r?.remote_version ?? r?.REMOTE ?? null)
    .filter((v) => typeof v === "string" && v.trim())
    .map((v) => v.trim()),
);

if (remoteVersions.size === 0 && localVersions.length > 0) {
  console.error("\n\x1b[31mThe remote ledger came back empty.\x1b[0m");
  console.error("That is either a real, total drift or an output shape this script misread —");
  console.error("both warrant a human, so this fails rather than guessing.");
  process.exit(1);
}

const missing = localVersions.filter((v) => !remoteVersions.has(v));

if (missing.length === 0) {
  console.log(`\n\x1b[32mNo drift — all ${localVersions.length} migrations are applied to the target database.\x1b[0m\n`);
  process.exit(0);
}

const files = readdirSync(resolve(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql"));
console.error(`\n\x1b[31mDRIFT: ${missing.length} migration(s) in the repo are NOT applied to the target database:\x1b[0m`);
for (const v of missing) console.error(`  - ${files.find((f) => f.startsWith(v)) ?? v}`);
console.error(
  "\nProd is running code that may expect schema it does not have. Apply these\n" +
    "before trusting the deploy — this is the shape that broke /campaigns on 2026-07-28.\n",
);
process.exit(1);
