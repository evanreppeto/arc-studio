import { type SupabaseClient } from "@supabase/supabase-js";

import { parseCompetitorIntelPayload } from "@/domain";
import { workspaceScopeFields } from "@/lib/tenancy/write-scope";
import { type AgentTaskTenantFields } from "../agent-tasks/scope";
import { getSupabaseAdminClient } from "../supabase/server";

export type CompetitorIntelResult = { competitorCampaignId: string; status: "needs_review"; runId: string };

export async function persistCompetitorIntel(
  input: unknown = {},
  client: SupabaseClient = getSupabaseAdminClient(),
  tenant?: AgentTaskTenantFields,
): Promise<CompetitorIntelResult> {
  const req = parseCompetitorIntelPayload(input);
  const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  // agents.org_id is NOT NULL with no default, so there is no tenant-less way to
  // reach the agent row. Say so here rather than let it surface as an opaque
  // constraint violation from Postgres. The only caller (the arc-guarded
  // competitor-intel route) always supplies a tenant.
  if (!tenant) {
    throw new Error("persistCompetitorIntel requires a tenant: agents and competitor_campaigns are org-scoped.");
  }
  const agentId = await upsertArcAgent(client, tenant);

  const competitorCampaignId = await insertOne(client, "competitor_campaigns", {
    ...(tenant ? { org_id: tenant.org_id } : {}),
    source: req.source,
    competitor_name: req.competitorName,
    competitor_url: req.competitorUrl ?? null,
    persona: req.persona ?? null,
    status: "needs_review",
    captured_at: req.capturedAt ?? new Date().toISOString(),
    summary: req.summary,
    channel_mix: req.channelMix,
    est_spend: req.estSpend ?? null,
    top_keywords: req.topKeywords,
    ad_creatives: req.adCreatives,
    raw_payload: req.rawPayload,
    created_by_agent_id: agentId,
    run_id: runId,
  });

  return { competitorCampaignId, status: "needs_review", runId };
}

// agents gained workspace_id in BSR-712, so this now carries the full tenant.
// The conflict target must stay (org_id, key) to match the per-org unique;
// targeting "key" alone would resolve against another tenant's agent row and
// overwrite it.
async function upsertArcAgent(client: SupabaseClient, tenant: AgentTaskTenantFields): Promise<string> {
  const { data, error } = await client
    .from("agents")
    .upsert(
      { ...workspaceScopeFields(tenant), key: "arc", name: "Arc Orchestrator", status: "ready" },
      { onConflict: "org_id,key" },
    )
    .select("id")
    .single<{ id: string }>();
  if (error) {
    throw new Error(`agents upsert failed: ${error.message}`);
  }
  return data.id;
}

async function insertOne(client: SupabaseClient, table: string, values: Record<string, unknown>) {
  const { data, error } = await client.from(table).insert(values).select("id").single<{ id: string }>();
  if (error) {
    throw new Error(`${table} insert failed: ${error.message}`);
  }
  return data.id;
}
