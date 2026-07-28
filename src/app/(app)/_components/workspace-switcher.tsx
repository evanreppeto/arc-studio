"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { workspaceInitials } from "@/domain";
import type { SettingsWorkspace } from "@/lib/auth/workspaces-view";

import { switchWorkspace, updateWorkspaceIdentityAction } from "../settings/actions";
import {
  WorkspaceIdentityModal,
  type WorkspaceIdentityValue,
} from "../settings/_components/workspace-identity-modal";

export type WorkspaceOption = SettingsWorkspace;

/** Per-workspace accent, or nothing — falling through to the org-wide --accent. */
function accentStyle(color: string | null): React.CSSProperties | undefined {
  return color ? ({ "--ws-accent": color } as React.CSSProperties) : undefined;
}

/**
 * The workspace brand block at the top of the rail — a switcher and, for owners
 * and admins, the way in to editing what it shows.
 *
 * Click to open a menu of the workspaces the signed-in user belongs to; picking
 * a different one calls the switchWorkspace server action (repoints the
 * active-workspace cookie) then refreshes so the whole app re-tailors. Each row
 * wears its own logo and accent, which is what makes a list of five workspaces
 * readable at a glance instead of five identical gold monograms.
 *
 * "Customize workspace" opens the identity editor on the ACTIVE workspace —
 * editing the others lives in Settings → Workspaces, where there's room for a
 * list. Mirrors AccountMenu's open/close + outside-click/escape behavior. Falls
 * back to the old static block when there's nothing to switch to
 * (offline/misconfigured).
 */
export function WorkspaceSwitcher({
  workspaceName,
  orgName,
  subtitle,
  logoUrl = null,
  accentColor = null,
  workspaces,
}: {
  workspaceName: string;
  orgName: string;
  /** Already resolved — the org name when the workspace hasn't set its own. */
  subtitle: string;
  logoUrl?: string | null;
  accentColor?: string | null;
  workspaces: WorkspaceOption[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, startSwitch] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const showSubtitle = subtitle.trim().toLocaleLowerCase() !== workspaceName.trim().toLocaleLowerCase();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const brand = (
    <>
      <span className={`mk${logoUrl ? " has-image" : ""}`}>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo; next/image would need per-host remotePatterns
          <img src={logoUrl} alt={orgName} />
        ) : (
          workspaceInitials(workspaceName || orgName)
        )}
      </span>
      <div className="ws-copy">
        <div className="nm">{workspaceName}</div>
        {showSubtitle && <div className="pl">{subtitle}</div>}
      </div>
    </>
  );

  // Nothing to switch to → keep the plain (non-interactive) block.
  if (workspaces.length === 0) return <div className="ws" style={accentStyle(accentColor)}>{brand}</div>;

  const active = workspaces.find((w) => w.active) ?? null;
  const canEdit = active?.canManage ?? false;

  function select(option: WorkspaceOption) {
    if (option.active) {
      setOpen(false);
      return;
    }
    startSwitch(async () => {
      const result = await switchWorkspace({ workspaceId: option.id });
      setOpen(false);
      if (result.ok) router.refresh();
    });
  }

  async function saveIdentity(value: WorkspaceIdentityValue): Promise<{ ok: boolean; error?: string }> {
    const result = await updateWorkspaceIdentityAction(value);
    if (!result.ok) return { ok: false, error: result.error };
    // The rail is server-rendered, so a refresh is what makes the edit visible.
    router.refresh();
    return { ok: true };
  }

  return (
    <div className="wswrap" ref={rootRef} data-open={open ? "true" : undefined} style={accentStyle(accentColor)}>
      <button
        type="button"
        className="ws wsbtn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {brand}
        <span className="wschev" aria-hidden>
          <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
        </span>
      </button>
      {open && (
        <div className="wsmenu" role="menu">
          <div className="wsmenu-h">Switch workspace</div>
          {workspaces.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`ws-item${option.active ? " on" : ""}`}
              role="menuitem"
              disabled={pending}
              style={accentStyle(option.accentColor)}
              onClick={() => select(option)}
            >
              <span className={`ws-item-mk${option.logoUrl ? " has-image" : ""}`}>
                {option.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo; next/image would need per-host remotePatterns
                  <img src={option.logoUrl} alt="" />
                ) : (
                  workspaceInitials(option.name)
                )}
              </span>
              <span className="ws-item-t">
                <span className="nm">{option.name}</span>
                <span className="mt">{option.meta}</span>
              </span>
              {option.active && (
                <svg className="ws-check" viewBox="0 0 24 24" aria-hidden><path d="M20 6L9 17l-5-5" /></svg>
              )}
            </button>
          ))}
          <div className="wsmenu-sep" />
          {canEdit && (
            <button
              type="button"
              className="ws-item ws-link"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setEditing(true);
              }}
            >
              <span className="ws-item-mk ws-item-mk-ghost" aria-hidden>
                <svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              </span>
              <span className="ws-item-t"><span className="nm">Customize workspace</span></span>
            </button>
          )}
          <Link href="/settings?s=workspaces" className="ws-item ws-link" role="menuitem" onClick={() => setOpen(false)}>
            <span className="ws-item-mk ws-item-mk-ghost" aria-hidden>
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></svg>
            </span>
            <span className="ws-item-t"><span className="nm">Workspace settings</span></span>
          </Link>
        </div>
      )}
      <WorkspaceIdentityModal
        key={editing ? "open" : "closed"}
        open={editing}
        workspace={active}
        onClose={() => setEditing(false)}
        onSubmit={saveIdentity}
      />
    </div>
  );
}
