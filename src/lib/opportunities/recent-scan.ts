import { type SupabaseClient } from "@supabase/supabase-js";

import { getCurrentAgentTaskTenantFields, type AgentTaskScope } from "@/lib/agent-tasks/scope";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

/**
 * True if an `arc_opportunity_scan` agent task was created in the last `withinHours`
 * for the current (default) tenant. Used to skip a scheduled scan when one already
 * ran recently (covers double-fires + a recent manual scan). Fail-open (returns
 * false) when unconfigured or on read error — the upsert dedup still bounds flooding.
 */
export async function hasRecentOpportunityScan(
  withinHours: number,
  client?: SupabaseClient,
  /** Explicit tenant; omit to resolve from the ambient request. */
  scope?: AgentTaskScope,
): Promise<boolean> {
  if (!isSupabaseAdminConfigured()) return false;
  const db = client ?? getSupabaseAdminClient();
  try {
    const tenant = await getCurrentAgentTaskTenantFields(scope);
    const since = new Date(Date.now() - withinHours * 60 * 60 * 1000).toISOString();
    const { data, error } = await db
      .from("agent_tasks")
      .select("id")
      .eq("org_id", tenant.org_id)
      .eq("workspace_id", tenant.workspace_id)
      .eq("task_type", "arc_opportunity_scan")
      .gte("created_at", since)
      .limit(1);
    if (error) return false;
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}
