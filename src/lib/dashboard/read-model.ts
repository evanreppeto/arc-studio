import { type SupabaseClient } from "@supabase/supabase-js";
import { reportDegraded } from "@/lib/observability/report-degraded";

import { isDemoDataEnabled } from "../demo/demo-mode";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "../supabase/server";

const ACTIVE_APPROVAL_STATUSES = ["needs_compliance", "pending_approval", "pending_owner_approval", "revision_requested"];
const OPEN_AGENT_TASK_STATUSES = ["queued", "running", "needs_approval", "blocked"];
const DRAFT_CAMPAIGN_STATUSES = ["draft", "briefing", "generating", "pending_approval"];

export type DashboardCounts =
  | {
      status: "live";
      approvalsWaiting: number;
      leadsFound: number;
      leadsAwaitingReview: number;
      campaignsDrafted: number;
      agentTasksOpen: number;
      agentTasksCompleted: number;
    }
  | {
      status: "unavailable";
      message: string;
    };

export async function getDashboardCounts(client?: SupabaseClient): Promise<DashboardCounts> {
  if (!client && !isSupabaseAdminConfigured()) {
    if (isDemoDataEnabled()) {
      return {
        status: "live",
        approvalsWaiting: 3,
        leadsFound: 48,
        leadsAwaitingReview: 12,
        campaignsDrafted: 5,
        agentTasksOpen: 6,
        agentTasksCompleted: 23,
      };
    }
    return {
      status: "unavailable",
      message: "Supabase env vars are not configured.",
    };
  }

  try {
    const supabase = client ?? getSupabaseAdminClient();
    const [approvalsWaiting, leadsFound, leadsAwaitingReview, campaignsDrafted, agentTasksOpen, agentTasksCompleted] =
      await Promise.all([
        countRows(supabase, "approval_items", { column: "status", values: ACTIVE_APPROVAL_STATUSES }),
        countRows(supabase, "leads"),
        countRows(supabase, "leads", { column: "status", values: ["needs_review", "new", "validated"] }),
        countRows(supabase, "campaigns", { column: "status", values: DRAFT_CAMPAIGN_STATUSES }),
        countRows(supabase, "agent_tasks", { column: "status", values: OPEN_AGENT_TASK_STATUSES }),
        countRows(supabase, "agent_tasks", { column: "status", values: ["completed"] }),
      ]);

    return {
      status: "live",
      approvalsWaiting,
      leadsFound,
      leadsAwaitingReview,
      campaignsDrafted,
      agentTasksOpen,
      agentTasksCompleted,
    };
  } catch (error) {
    // Degrade, but not silently — this read IS the screen, so an empty
    // state here is indistinguishable from an outage (BSR-544).
    reportDegraded(error, { scope: "dashboard.getDashboardCounts", surface: "primary" });
    return {
      status: "unavailable",
      message: error instanceof Error ? error.message : "Dashboard counts are unavailable.",
    };
  }
}

async function countRows(
  client: SupabaseClient,
  table: string,
  filter?: {
    column: string;
    values: string[];
  },
) {
  let query = client.from(table).select("*", { count: "exact", head: true });

  if (filter) {
    query = query.in(filter.column, filter.values);
  }

  const { count, error } = await query;

  if (error) {
    throw new Error(`${table} count failed: ${error.message}`);
  }

  return count ?? 0;
}
