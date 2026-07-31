/**
 * Pre-flight before arming ARC_BILLING_ENFORCEMENT (BSR-621).
 *
 *   pnpm health:billing
 *
 * Answers one question against live data: if enforcement were armed right now,
 * which workspaces would be blocked?
 *
 * Why this exists: `org_plans` was empty on prod, so every org fell through to
 * the free tier's $2/month cap — and both orgs were already past it. Arming the
 * flag would have blocked the workspace that pays the bills, instantly and with
 * no warning. BSR-505's launch checklist literally instructs an operator to
 * "confirm quota enforcement on", which walks straight into it.
 *
 * Exits non-zero when arming would block someone, so it can gate a runbook step
 * rather than relying on a human having read the right paragraph.
 */
import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

const root = process.cwd();

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(path.join(root, ".env"));
loadEnvFile(path.join(root, ".env.local"));

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_MARKETING_SUPABASE_URL ||
  process.env.MARKETING_SUPABASE_URL;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.MARKETING_SUPABASE_SERVICE_ROLE_KEY;

const LABEL = "[health:billing]";

// Kept in sync with src/domain/plans.ts. Duplicated rather than imported because
// this is a plain .mjs operator script with no TS build step — the test
// `billing-enforcement-preflight.test.ts` pins the real values so a drift here
// is visible in review.
const FREE_CAP_CENTS = 200;

const money = (c) => `$${(c / 100).toFixed(2)}`;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(`${LABEL} Missing Supabase env (URL + service role key).`);
  process.exitCode = 1;
} else {
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: orgs, error: orgError } = await admin
      .from("organizations")
      .select("id,slug,status");
    if (orgError) throw new Error(`organizations read failed: ${orgError.message}`);

    const active = (orgs ?? []).filter((o) => o.status === "active");
    if (!active.length) {
      console.log(`${LABEL} No active organizations — nothing to check.`);
      process.exit(0);
    }

    const { data: plans, error: planError } = await admin
      .from("org_plans")
      .select("org_id,plan_tier,monthly_cap_cents");
    if (planError) throw new Error(`org_plans read failed: ${planError.message}`);
    const planByOrg = new Map((plans ?? []).map((p) => [p.org_id, p]));

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const snapshots = [];
    for (const org of active) {
      const { data: usage, error: usageError } = await admin
        .from("ai_usage_events")
        .select("cost_estimate_cents")
        .eq("org_id", org.id)
        .gte("created_at", monthStart.toISOString());
      if (usageError) throw new Error(`ai_usage_events read failed: ${usageError.message}`);

      const usedCents = (usage ?? []).reduce((sum, r) => sum + (r.cost_estimate_cents ?? 0), 0);
      const plan = planByOrg.get(org.id);
      const capCents =
        plan?.monthly_cap_cents && plan.monthly_cap_cents > 0 ? plan.monthly_cap_cents : FREE_CAP_CENTS;

      snapshots.push({ orgSlug: org.slug, hasPlanRow: Boolean(plan), capCents, usedCents });
    }

    const blocked = snapshots.filter((s) => s.usedCents >= s.capCents);
    const missing = snapshots.filter((s) => !s.hasPlanRow).map((s) => s.orgSlug);

    for (const s of snapshots) {
      const state = s.usedCents >= s.capCents ? "WOULD BLOCK" : "ok";
      const rowNote = s.hasPlanRow ? "" : " (no org_plans row → free tier by default)";
      console.log(
        `${LABEL} ${state} ${s.orgSlug}: ${money(s.usedCents)} of ${money(s.capCents)}${rowNote}`,
      );
    }

    if (missing.length) {
      console.log(
        `${LABEL} ${missing.length} active org(s) have no org_plans row: ${missing.join(", ")}`,
      );
    }

    if (blocked.length) {
      throw new Error(
        `arming ARC_BILLING_ENFORCEMENT would immediately block ${blocked.length} active workspace(s). ` +
          `Assign a plan tier or a monthly_cap_cents override first.`,
      );
    }

    console.log(`${LABEL} Safe to arm: no active workspace is at or over its cap.`);
  } catch (error) {
    console.error(`${LABEL} ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
