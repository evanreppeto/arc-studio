// Mints workspace-scoped API tokens for a NAMED workspace and prints each
// plaintext ONCE (only the sha256 is stored, so there is no way to read one back).
//
// WHY THIS EXISTS: the app's ingest surfaces authenticate with shared env secrets
// (LEADS_INGEST_API_TOKEN, CAMPAIGN_RESULTS_API_TOKEN, MEDIA_INGEST_API_TOKEN).
// checkWorkspaceBearer() matches those first and returns `tokenSource: "env"`,
// which carries no identity — so the route falls back to getCurrentOrgId(), which
// answers only while the database holds exactly one organization. The moment a
// second workspace exists that fallback refuses (correctly: a session-less caller
// that cannot name its tenant must not be guessed at), and every one of those
// endpoints starts returning 409. A DB-issued token removes the question: it
// self-scopes straight off the row.
//
// issue-arc-runner-token.mjs already covers the runner's arc:full token. This
// covers the narrow ingest scopes, and can mint arc:full too.
//
// Run from the repo with the target project's env loaded:
//   node --env-file=.env.production.local scripts/issue-workspace-tokens.mjs \
//     --org <org-slug> --workspace <workspace-key-or-uuid> --all
//
// Scopes: --all, or one or more of
//   --scope leads:ingest --scope campaign-results:ingest
//   --scope media:ingest --scope arc:full
//
// Token shape + hashing mirror src/lib/agent/tokens.ts (generateToken/hashToken).

import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_MARKETING_SUPABASE_URL ||
  process.env.MARKETING_SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.MARKETING_SUPABASE_SERVICE_ROLE_KEY;

const die = (message) => {
  console.error(message);
  process.exit(1);
};

if (!url || !serviceKey) die("Missing Supabase URL / service-role key in env.");

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

/** Which env var each scope's token belongs in, so the output is actionable. */
const SCOPES = {
  "leads:ingest": { env: "LEADS_INGEST_API_TOKEN", label: "Lead ingest" },
  "campaign-results:ingest": { env: "CAMPAIGN_RESULTS_API_TOKEN", label: "Campaign results ingest" },
  "media:ingest": { env: "MEDIA_INGEST_API_TOKEN", label: "Media ingest" },
  "arc:full": { env: "ARC_AGENT_API_TOKEN", label: "Arc runner" },
};

function parseArgs(argv) {
  const out = { org: null, workspace: null, scopes: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--all") out.scopes.push(...Object.keys(SCOPES));
    else if (arg === "--org") out.org = argv[++i];
    else if (arg === "--workspace") out.workspace = argv[++i];
    else if (arg === "--scope") out.scopes.push(argv[++i]);
    else die(`Unknown argument: ${arg}`);
  }
  out.scopes = [...new Set(out.scopes)];
  return out;
}

const args = parseArgs(process.argv.slice(2));

// The target is NAMED, never inferred. Picking a winner among real tenants is the
// exact bug the org-scoping work removed from the request path (#479/#480), and a
// credential minted against the wrong workspace is worse than a refusal: it works.
if (!args.org) die("Name the organization: --org <slug>  (list: select slug from organizations)");
if (!args.workspace) die("Name the workspace: --workspace <key-or-uuid>");
if (args.scopes.length === 0) die(`Name at least one scope: --all, or --scope <${Object.keys(SCOPES).join("|")}>`);

for (const scope of args.scopes) {
  if (!SCOPES[scope]) die(`Unknown scope "${scope}". Known: ${Object.keys(SCOPES).join(", ")}`);
}

const { data: org, error: orgError } = await db
  .from("organizations")
  .select("id,slug,name")
  .eq("slug", args.org)
  .maybeSingle();
if (orgError) die(`organizations lookup failed: ${orgError.message}`);
if (!org) die(`No organization with slug "${args.org}".`);

const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args.workspace);
const workspaceQuery = db
  .from("workspaces")
  .select("id,key,name")
  .eq("org_id", org.id)
  .eq("status", "active")
  .eq(isUuid ? "id" : "key", args.workspace);
const { data: workspace, error: workspaceError } = await workspaceQuery.maybeSingle();
if (workspaceError) die(`workspaces lookup failed: ${workspaceError.message}`);
if (!workspace) die(`No active workspace "${args.workspace}" in org "${org.slug}".`);

// Surface live tokens rather than silently minting duplicates — each is an
// independent credential that keeps working until it is revoked.
const { data: existing } = await db
  .from("agent_api_tokens")
  .select("prefix,label,scopes,created_at")
  .eq("org_id", org.id)
  .eq("workspace_id", workspace.id)
  .is("revoked_at", null);
if (existing?.length) {
  console.warn(`NOTE: ${existing.length} live token(s) already exist for this workspace:`);
  for (const t of existing) {
    console.warn(`  ${t.prefix}… ${t.label ?? "(no label)"} [${(t.scopes ?? ["legacy/unrestricted"]).join(", ")}] — ${t.created_at}`);
  }
  console.warn("Minting alongside them. Revoke what you replace (set revoked_at).\n");
}

console.log("");
console.log(`Org:        ${org.name} (${org.slug})`);
console.log(`Workspace:  ${workspace.name} (key: ${workspace.key})`);
console.log(`Workspace id: ${workspace.id}`);
console.log("");

const issued = [];
for (const scope of args.scopes) {
  const { env, label } = SCOPES[scope];
  const plaintext = `sk_live_${randomBytes(24).toString("base64url")}`;
  // scopes is set EXPLICITLY. NULL means "legacy token, unrestricted" — the same
  // shape of implicit answer this line of work has been removing.
  const { error } = await db.from("agent_api_tokens").insert({
    org_id: org.id,
    workspace_id: workspace.id,
    token_hash: createHash("sha256").update(plaintext).digest("hex"),
    prefix: plaintext.slice(0, 12),
    label: `${label} (${workspace.name})`,
    scopes: [scope],
  });
  if (error) die(`Failed to insert ${scope} token: ${error.message}`);
  issued.push({ scope, env, plaintext });
}

console.log("Shown once — only the sha256 is stored. Set each on Vercel (Production):");
console.log("");
for (const { scope, env, plaintext } of issued) {
  console.log(`# scope: ${scope}`);
  console.log(`${env}=${plaintext}`);
  console.log("");
}
console.log("Then redeploy so the running deployment picks the new values up, and");
console.log("revoke the old shared env secrets you replaced.");
console.log("");
