import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

/**
 * Friendly labels for the workspace audit actions we record.
 *
 * `workspace.renamed` is no longer emitted — updateWorkspaceIdentity replaced the
 * coupled rename — but historical rows still carry it, so it keeps its label.
 */
export const WORKSPACE_AUDIT_LABELS: Record<string, string> = {
  "workspace.created": "Workspace created",
  "workspace.renamed": "Workspace renamed",
  "workspace.identity_updated": "Workspace identity updated",
  "member.role_changed": "Role changed",
  "member.removed": "Member removed",
  "invite.created": "Invite created",
  "invite.revoked": "Invite revoked",
};

/** Human label for an audit action, falling back to a humanized key. */
export function auditActionLabel(action: string): string {
  return WORKSPACE_AUDIT_LABELS[action] ?? action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

type RecordAuditInput = {
  orgId: string;
  workspaceId: string;
  actorUserId: string | null;
  action: string;
  summary?: string;
  subjectTable?: string;
  subjectId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

/**
 * Append an entry to `audit_events`. Best-effort: logging must never block or
 * fail the primary action, so any error here is swallowed.
 */
export async function recordWorkspaceAudit(input: RecordAuditInput): Promise<void> {
  if (!isSupabaseAdminConfigured()) return;
  try {
    await getSupabaseAdminClient()
      .from("audit_events")
      .insert({
        org_id: input.orgId,
        workspace_id: input.workspaceId,
        actor_user_id: input.actorUserId,
        actor_kind: "user",
        action: input.action,
        subject_table: input.subjectTable ?? null,
        subject_id: input.subjectId ?? null,
        summary: input.summary ?? null,
        metadata: input.metadata ?? {},
      });
  } catch {
    // Intentionally ignored — audit logging is best-effort.
  }
}
