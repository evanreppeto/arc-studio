// Stage 1 of the mockup-exact rebuild: provision a clean test workspace + users
// UNDER the existing BSR default org. Mirrors createWorkspaceForUser +
// createWorkspaceDefaults (src/lib/auth/workspace-onboarding.ts) but reuses the
// BSR org (id below) instead of creating a fresh one, so default_organization_id()
// stays consistent and the workspace is BSR-themed to match the mockup.
//
//   node scripts/seed-test-workspace.mjs
//
// Idempotent: upserts where possible; skips auth users that already exist.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadLocalEnv() {
  const envText = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}
loadLocalEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const ORG_ID = "63b72a45-a6fc-4bf8-a6af-544910fdd844"; // BSR default org (= default_organization_id())

const USERS = [
  { email: "owner@bsr.test", password: "BsrOwner1234!", full_name: "Riley Chen", role: "owner" },
  { email: "teammate@bsr.test", password: "BsrTeam1234!", full_name: "Sam Okafor", role: "member" },
];

async function ensureAuthUser({ email, password, full_name }) {
  // create; if it already exists, look it up by listing (small user base after wipe)
  const created = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (!created.error) return created.data.user;
  const { data: list, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!existing) throw new Error(`createUser failed and user not found: ${created.error.message}`);
  return existing;
}

async function main() {
  const now = new Date().toISOString();

  // The org row itself. The baseline migration is a schema-only dump and no
  // migration inserts tenant rows any more (20260716140000 removed the last
  // hardcoded BSR reference), so on a freshly reset database this org does not
  // exist and every seed below fails its org_id foreign key. Create it here —
  // seeds own their data, migrations own the schema.
  const { error: orgErr } = await sb.from("organizations").upsert(
    { id: ORG_ID, name: "Big Shoulders Restoration", slug: "big-shoulders-restoration", status: "active" },
    { onConflict: "id" },
  );
  if (orgErr) throw new Error(`organization: ${orgErr.message}`);

  const users = [];
  for (const u of USERS) {
    const user = await ensureAuthUser(u);
    users.push({ ...u, id: user.id });
    console.log(`auth user ready: ${u.email} (${u.role}) -> ${user.id}`);
  }

  // profiles
  const { error: profErr } = await sb.from("profiles").upsert(
    users.map((u) => ({ id: u.id, email: u.email, full_name: u.full_name })),
    { onConflict: "id" },
  );
  if (profErr) throw new Error(`profiles: ${profErr.message}`);

  // workspace (default) under BSR org
  const { data: ws, error: wsErr } = await sb
    .from("workspaces")
    .upsert(
      {
        org_id: ORG_ID,
        key: "default",
        slug: "big-shoulders-restoration",
        name: "Big Shoulders Restoration",
        workspace_type: "company",
        created_by: users[0].id,
        status: "active",
        settings: { createdFromOnboarding: true },
        metadata: {},
      },
      { onConflict: "org_id,key" },
    )
    .select("id,org_id,name")
    .single();
  if (wsErr) throw new Error(`workspace: ${wsErr.message}`);
  console.log(`workspace: ${ws.name} -> ${ws.id}`);

  // memberships (org + workspace) for each user
  const orgRows = users.map((u) => ({
    org_id: ORG_ID, user_id: u.id, invited_email: u.email, role: u.role, status: "active", joined_at: now,
  }));
  const wsRows = users.map((u) => ({
    org_id: ORG_ID, workspace_id: ws.id, user_id: u.id, invited_email: u.email, role: u.role, status: "active", joined_at: now,
  }));
  const userIds = users.map((u) => u.id);
  await sb.from("organization_memberships").delete().eq("org_id", ORG_ID).in("user_id", userIds);
  await sb.from("workspace_memberships").delete().eq("workspace_id", ws.id).in("user_id", userIds);
  const { error: omErr } = await sb.from("organization_memberships").insert(orgRows);
  if (omErr) throw new Error(`organization_memberships: ${omErr.message}`);
  const { error: wmErr } = await sb.from("workspace_memberships").insert(wsRows);
  if (wmErr) throw new Error(`workspace_memberships: ${wmErr.message}`);

  // workspace defaults
  await sb.from("arc_instances").upsert(
    { org_id: ORG_ID, workspace_id: ws.id, key: "arc", display_name: "Arc", status: "active", memory_policy: "approval_required" },
    { onConflict: "workspace_id,key" },
  );
  await sb.from("business_profiles").upsert(
    { org_id: ORG_ID, display_name: "Big Shoulders Restoration", legal_name: "Big Shoulders Restoration LLC", short_mark: "BS", status: "draft" },
    { onConflict: "org_id" },
  );
  const { count: folderCount } = await sb.from("media_folders").select("id", { count: "exact", head: true }).eq("org_id", ORG_ID);
  if ((folderCount ?? 0) === 0) {
    await sb.from("media_folders").insert(
      ["Approved BSR media", "AI-generated", "Composites", "Documents"].map((name, i) => ({ org_id: ORG_ID, name, sort_order: i })),
    );
  }
  await sb.from("audit_events").insert({
    org_id: ORG_ID, workspace_id: ws.id, actor_user_id: users[0].id, actor_kind: "user",
    action: "workspace.created", subject_table: "workspaces", subject_id: ws.id,
    summary: "Test workspace provisioned for the mockup-exact rebuild.", metadata: { source: "seed-test-workspace" },
  });

  console.log("\n✅ Stage 1 complete. Login credentials:");
  for (const u of USERS) console.log(`   ${u.role.padEnd(6)}  ${u.email}  /  ${u.password}`);
  console.log(`   org=${ORG_ID}  workspace=${ws.id}`);
}

main().catch((e) => {
  console.error("SEED FAILED:", e);
  process.exit(1);
});
