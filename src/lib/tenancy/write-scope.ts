/**
 * The two tenant shapes this codebase carries: snake_case
 * (`AgentTaskTenantFields`, used by the app's own write paths) and camelCase
 * (`ArcTenantScope`, used by the `/api/v1` Arc routes). Accepting both here is
 * deliberate — the alternative is a conversion at every call site, which is one
 * more place to get it wrong, and the shapes are equivalent.
 */
export type WriteTenant =
  | { org_id: string; workspace_id: string }
  | { orgId: string; workspaceId: string };

function normalize(tenant?: WriteTenant): { org_id: string; workspace_id: string } | null {
  if (!tenant) return null;
  const orgId = "org_id" in tenant ? tenant.org_id : tenant.orgId;
  const workspaceId = "workspace_id" in tenant ? tenant.workspace_id : tenant.workspaceId;
  if (!orgId || !workspaceId) return null;
  return { org_id: orgId, workspace_id: workspaceId };
}

/**
 * The tenant columns an insert stamps (BSR-710).
 *
 * This replaces six identical private `orgTenantFields()` copies — in
 * `campaigns/{launch,decisions,attach-media}.ts`, `dispatch/persistence.ts` and
 * `arc-api/{drafts,approvals}.ts` — every one of which took a full
 * `{org_id, workspace_id}` tenant and returned `org_id` ONLY.
 *
 * That duplication is the single biggest risk in the Group A migration
 * (`docs/GROUP-A-MIGRATION.md`): each copy writes to tables that are gaining a
 * `NOT NULL workspace_id`, and a copy nobody remembered to update writes a NULL
 * that only fails once the column is locked. One helper, so the next wave changes
 * one file rather than finding six.
 *
 * Two functions rather than a flag, because the distinction is real and permanent:
 * some tables are org-owned and must NEVER carry a workspace (see the Category 1
 * list in the boundary audit), and passing one a workspace would be a bug, not a
 * no-op.
 */

/**
 * For **org-owned** tables — the customer record layer. Deliberately drops the
 * workspace: `contacts`, `companies`, `leads` and friends are shared across a
 * company's workspaces by design, and adding a column they do not have would
 * break the insert.
 */
export function orgScopeFields(tenant?: WriteTenant): Record<string, string> {
  const t = normalize(tenant);
  // Falls back to the org id alone when only that is resolvable, matching the
  // behaviour of the copies this replaces.
  if (t) return { org_id: t.org_id };
  const orgId = tenant && ("org_id" in tenant ? tenant.org_id : tenant.orgId);
  return orgId ? { org_id: orgId } : {};
}

/**
 * For **workspace-owned** tables — everything generated.
 *
 * Throws rather than writing a partial tenant. During Phase A the column is still
 * nullable, so a silent `{}` would look harmless and then fail for a customer the
 * day Phase B lands. Failing here names the caller that is missing a scope, while
 * there is still a nullable column absorbing the mistake.
 */
export function workspaceScopeFields(tenant?: WriteTenant): { org_id: string; workspace_id: string } {
  const t = normalize(tenant);
  if (!t) throw new Error("This record is workspace-owned and needs a resolved org and workspace.");
  return t;
}
