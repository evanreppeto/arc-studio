import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";

export type AgentTaskTenantFields = {
  org_id: string;
  workspace_id: string;
};

/**
 * Explicit tenant, for callers that cannot rely on an ambient request — chiefly
 * the unauthenticated crons. A session-less caller cannot resolve a tenant once a
 * second active org exists, because the resolver refuses an ambiguous answer
 * (correctly). See src/lib/opportunities/fan-out.ts (BSR-626).
 */
export type AgentTaskScope = { orgId: string; workspaceId: string };

export function agentTaskTenantFieldsFor(scope: AgentTaskScope): AgentTaskTenantFields {
  return { org_id: scope.orgId, workspace_id: scope.workspaceId };
}

export async function getCurrentAgentTaskTenantFields(
  scope?: AgentTaskScope,
): Promise<AgentTaskTenantFields> {
  if (scope) return agentTaskTenantFieldsFor(scope);
  const context = await getCurrentWorkspaceContext();
  if (!context.workspaceId) {
    throw new Error("No active workspace is available for this agent task.");
  }

  return {
    org_id: context.orgId,
    workspace_id: context.workspaceId,
  };
}
