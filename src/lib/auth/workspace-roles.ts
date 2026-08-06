/**
 * Workspace role catalog — the human-readable meaning of each membership role.
 * Pure metadata (no I/O) so it can power the settings "Roles & permissions"
 * guide, the invite role picker, and member-management guards consistently.
 *
 * Roles mirror the `workspace_memberships.role` check constraint in
 * `20260618120000_product_tenancy_foundation.sql`.
 */

export type WorkspaceRoleKey = "owner" | "admin" | "marketer" | "reviewer" | "member" | "viewer";

export type WorkspaceRoleInfo = {
  role: WorkspaceRoleKey;
  label: string;
  summary: string;
  capabilities: string[];
  /** Higher = more privileged. Used to compare/guard role changes. */
  rank: number;
};

export const WORKSPACE_ROLES: WorkspaceRoleInfo[] = [
  {
    role: "owner",
    label: "Owner",
    rank: 5,
    summary: "Full control of the workspace and everyone in it.",
    // "Transfer or delete the workspace" was listed here and is not built: there
    // is no transfer path (`ASSIGNABLE_WORKSPACE_ROLES` excludes owner, so the
    // role cannot be handed over) and no delete path (tearing down an org means
    // an ordered teardown across 16 RESTRICT foreign keys). Listing it made the
    // Roles tab the only place in the product that claimed those controls
    // existed, and sent people looking for a button that isn't there. Describe
    // what an owner can actually do until they are built.
    capabilities: ["Everything an admin can do", "Manage billing and the plan", "Rename the workspace and the organization"],
  },
  {
    role: "admin",
    label: "Admin",
    rank: 4,
    summary: "Runs the workspace day to day.",
    capabilities: ["Invite, remove, and re-role members", "Manage connections and settings", "Approve outbound work"],
  },
  {
    role: "marketer",
    label: "Marketer",
    rank: 3,
    summary: "Builds the campaigns and creative.",
    capabilities: ["Create campaigns, assets, and drafts", "Request approvals", "Cannot manage members or settings"],
  },
  {
    role: "reviewer",
    label: "Reviewer",
    rank: 2,
    summary: "Approves the work that goes out.",
    capabilities: ["Approve, decline, or request revisions", "Read campaigns and assets", "Cannot manage members"],
  },
  {
    role: "member",
    label: "Member",
    rank: 1,
    summary: "General team access to everyday work.",
    capabilities: ["View and work on campaigns and CRM", "Create drafts", "Cannot manage members or settings"],
  },
  {
    role: "viewer",
    label: "Viewer",
    rank: 0,
    summary: "Read-only access.",
    capabilities: ["View dashboards and records", "Cannot make changes"],
  },
];

/** Roles an owner/admin may assign — owner is intentionally excluded (granted only at onboarding). */
export const ASSIGNABLE_WORKSPACE_ROLES: WorkspaceRoleKey[] = ["admin", "marketer", "reviewer", "member", "viewer"];

const roleByKey = new Map(WORKSPACE_ROLES.map((info) => [info.role, info]));

export function roleInfo(role: string): WorkspaceRoleInfo | null {
  return roleByKey.get(role as WorkspaceRoleKey) ?? null;
}

export function roleLabel(role: string): string {
  return roleInfo(role)?.label ?? role.charAt(0).toUpperCase() + role.slice(1);
}

export function isWorkspaceAdminRole(role: string): boolean {
  return role === "owner" || role === "admin";
}

export function isAssignableRole(role: string): role is WorkspaceRoleKey {
  return (ASSIGNABLE_WORKSPACE_ROLES as string[]).includes(role);
}
