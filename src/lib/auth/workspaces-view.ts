// ---------------------------------------------------------------------------
// Settings → Workspaces view, and the rail's workspace menu. The real
// workspaces the signed-in user belongs to (listWorkspacesForUser) with the
// active one flagged; a demo list in the offline preview. Each row carries its
// resolved display identity (name / subtitle / short label / accent / logo) so
// the menu can render one workspace differently from the next, plus `canManage`
// so the edit affordances only appear to owners and admins.
//
// Read-only assembly — switching goes through the switchWorkspace server action
// and editing through updateWorkspaceIdentityAction.
// ---------------------------------------------------------------------------

import { resolveWorkspaceIdentity, type WorkspaceAccentKey } from "@/domain";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";
import { reportDegraded } from "@/lib/observability/report-degraded";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { getCurrentWorkspaceContext } from "./workspace";
import { listWorkspacesForUser } from "./workspace-admin";
import { roleLabel } from "./workspace-roles";

export type SettingsWorkspace = {
  id: string;
  name: string;
  meta: string;
  active: boolean;
  /** Resolved for display — never null, fallbacks already applied. */
  subtitle: string;
  shortLabel: string;
  /**
   * What is actually STORED on the row (null = inheriting the fallback). The
   * editor needs these: seeding its inputs from the resolved values would
   * silently promote an inherited subtitle into a stored one on the next save.
   */
  storedSubtitle: string | null;
  storedShortLabel: string | null;
  /** Hex tint, or null to inherit the org-wide appearance accent. */
  accentColor: string | null;
  /** The stored key, so the editor can show which swatch is selected. */
  accentKey: WorkspaceAccentKey | null;
  logoUrl: string | null;
  /** The organization name behind this workspace — the subtitle's fallback. */
  orgName: string;
  /** Owner/admin of this workspace: may rename it and edit its identity. */
  canManage: boolean;
};

export type SettingsWorkspacesView = {
  isDemo: boolean;
  workspaces: SettingsWorkspace[];
  /**
   * Why the read failed, or null (BSR-578). Non-null means the list is unknown.
   *
   * This one is read by the app shell as well as by Settings, so an empty list
   * silently replaces the workspace switcher on EVERY page — it reads as "this
   * account has one workspace" rather than "we could not list them".
   */
  failed: string | null;
};

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function demoWorkspace(
  partial: Pick<SettingsWorkspace, "id" | "name" | "meta" | "active"> & Partial<SettingsWorkspace>,
): SettingsWorkspace {
  const orgName = partial.orgName ?? partial.name;
  const resolved = resolveWorkspaceIdentity(
    {
      name: partial.name,
      subtitle: partial.subtitle ?? null,
      shortLabel: partial.shortLabel ?? null,
      accentKey: partial.accentKey ?? null,
      logoUrl: partial.logoUrl ?? null,
    },
    orgName,
  );
  return {
    ...partial,
    orgName,
    subtitle: resolved.subtitle,
    shortLabel: resolved.shortLabel,
    storedSubtitle: partial.subtitle ?? null,
    storedShortLabel: partial.shortLabel ?? null,
    accentColor: resolved.accentColor,
    accentKey: resolved.accentKey,
    logoUrl: resolved.logoUrl,
    canManage: partial.canManage ?? true,
  };
}

function demoWorkspaces(): SettingsWorkspacesView {
  return {
    isDemo: true,
    failed: null,
    workspaces: [
      // The active row carries a logo and the others don't, so the offline
      // preview exercises BOTH branches of the menu's mark — an uploaded logo
      // and the initials fallback.
      demoWorkspace({
        id: "demo-bsr",
        name: "Big Shoulders Restoration",
        meta: "Owner · Restoration & home services",
        active: true,
        logoUrl: "/brand/demo/meridian-logo.png",
      }),
      demoWorkspace({ id: "demo-summit", name: "Summit Restoration", meta: "Admin · Home services", active: false, accentKey: "emerald" }),
      demoWorkspace({ id: "demo-personal", name: "Personal", meta: "Owner · Sandbox", active: false, accentKey: "steel", subtitle: "Sandbox" }),
    ],
  };
}

export async function getSettingsWorkspacesView(): Promise<SettingsWorkspacesView> {
  if (isSupabaseAdminConfigured()) {
    try {
      const [mine, ctx] = await Promise.all([
        listWorkspacesForUser(),
        getCurrentWorkspaceContext().catch(() => null),
      ]);
      if (mine.length) {
        return {
          isDemo: false,
          failed: null,
          workspaces: mine.map((w) => {
            const orgName = w.orgName?.trim() || w.workspaceName;
            const resolved = resolveWorkspaceIdentity(
              {
                // The menu leads with the WORKSPACE name — the same string the
                // rail's bold line shows. It used to lead with the org name,
                // which was indistinguishable back when renaming wrote both rows
                // at once; now that the two can differ, a menu row that
                // disagreed with the rail above it would just be confusing.
                name: w.workspaceName,
                subtitle: w.subtitle,
                shortLabel: w.shortLabel,
                accentKey: w.accentKey,
                logoUrl: w.logoUrl,
              },
              orgName,
            );
            return {
              id: w.workspaceId,
              name: resolved.name,
              meta: `${roleLabel(w.role)} · ${titleCase(w.workspaceType)}`,
              active: w.workspaceId === ctx?.workspaceId,
              subtitle: resolved.subtitle,
              shortLabel: resolved.shortLabel,
              storedSubtitle: w.subtitle,
              storedShortLabel: w.shortLabel,
              accentColor: resolved.accentColor,
              accentKey: resolved.accentKey,
              logoUrl: resolved.logoUrl,
              orgName,
              canManage: w.role === "owner" || w.role === "admin",
            } satisfies SettingsWorkspace;
          }),
        };
      }
    } catch (error) {
      // Was an empty catch: no report, no message, no log (BSR-578).
      reportDegraded(error, { scope: "auth.getSettingsWorkspacesView", surface: "primary" });
      return {
        isDemo: false,
        workspaces: [],
        failed: error instanceof Error ? error.message : "Could not list your workspaces.",
      };
    }
  }

  if (isDemoDataEnabled()) return demoWorkspaces();
  // Genuinely nothing to list, which is a true statement and stays one.
  return { isDemo: false, workspaces: [], failed: null };
}
