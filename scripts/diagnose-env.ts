/**
 * What is switched off in this environment, and what that costs (BSR-480).
 *
 *   pnpm diagnose:env                 # reads .env.local, then the real env
 *   pnpm diagnose:env --file .env.prod
 *   pnpm diagnose:env --required-only # only what is actually broken
 *   pnpm diagnose:env --json
 *
 * Reads the SAME catalogue the operator health console renders
 * (src/domain/env-capabilities.ts), so a terminal and the page cannot drift.
 * The console is platform-admin gated and needs a session; this needs neither,
 * which is what makes it usable while bringing a new environment up — the exact
 * moment nobody can sign in yet.
 *
 * Presence only. No value is ever read or printed, so this is safe to run
 * against a production env file and paste the output into a ticket.
 */
import { readFileSync } from "node:fs";

import {
  ENV_CAPABILITIES,
  isEnvVarSet,
  reportCapabilities,
  type CapabilityReport,
} from "../src/domain/env-capabilities";

type Args = { file: string | null; json: boolean; requiredOnly: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { file: null, json: false, requiredOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--file") args.file = argv[i + 1] ?? null;
    else if (argv[i] === "--json") args.json = true;
    else if (argv[i] === "--required-only") args.requiredOnly = true;
  }
  return args;
}

/**
 * Parse a dotenv file well enough to answer "is it set".
 *
 * Deliberately simple. A quoted empty value must read as UNSET, because
 * `vercel env pull` writes sensitive variables as blank — treating that as set
 * is how a missing secret reads as configured, which is this ticket's whole
 * failure shape.
 */
function readEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return env;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

const ICON: Record<CapabilityReport["state"], string> = {
  ready: "OK  ",
  partial: "PART",
  inert: "OFF ",
};

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const fromFile = readEnvFile(args.file ?? ".env.local");
  // The real environment wins: a var exported in the shell is what the app will
  // actually see, whatever the file says.
  const env: Record<string, string | undefined> = { ...fromFile, ...process.env };

  const reports = reportCapabilities(env);

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ capabilities: reports }, null, 2)}\n`);
    process.exitCode = reports.some((r) => r.state !== "ready") ? 1 : 0;
    return;
  }

  const source = args.file ?? ".env.local";
  console.log(`\nCapability readiness  (${source} + process env)\n`);

  for (const report of reports) {
    const spec = ENV_CAPABILITIES.find((c) => c.key === report.key);
    if (args.requiredOnly && report.state === "ready") continue;

    console.log(`${ICON[report.state]} ${report.label} — ${report.detail}`);

    for (const varSpec of spec?.vars ?? []) {
      const set = isEnvVarSet(env, varSpec);
      if (set && args.requiredOnly) continue;
      if (set) {
        console.log(`       set    ${varSpec.name}`);
        continue;
      }
      if (args.requiredOnly && varSpec.requirement !== "required") continue;
      const tag = varSpec.requirement === "required" ? "MISSING" : varSpec.requirement.toUpperCase();
      console.log(`       ${tag.padEnd(6)} ${varSpec.name}`);
      console.log(`              ${varSpec.ifUnset}`);
    }
    console.log("");
  }

  const broken = reports.filter((r) => r.state !== "ready");
  if (broken.length === 0) {
    console.log("Every capability has its required variables.\n");
  } else {
    console.log(`${broken.length} of ${reports.length} capabilities are not fully configured:`);
    for (const r of broken) console.log(`  - ${r.label}: ${r.detail}`);
    console.log("\nSee docs/runbooks/go-live-checklist.md for the order to set these in.\n");
  }

  // Non-zero on anything not ready, so CI or a deploy gate can use this
  // directly. Note that "not ready" includes deliberately-off capabilities —
  // use --required-only in a gate where optional features are genuinely optional.
  process.exitCode = broken.length > 0 ? 1 : 0;
}

main();
