"use client";

import { useCallback, useEffect, useState, useTransition, type CSSProperties } from "react";

import type { SharePermission, ShareVisibility } from "@/domain";

import { OverlayPortal } from "./overlay-portal";

export type ShareMemberVM = { userId: string; email: string | null; permission: SharePermission | null };
export type SharingStateVM = {
  visibility: ShareVisibility;
  workspacePermission: SharePermission;
  shared: ShareMemberVM[];
  addable: ShareMemberVM[];
};

/**
 * Generic Share dialog for any per-person/workspace resource (chats, campaigns).
 * The parent supplies the resource id + noun and callbacks that wrap the resource's
 * server actions, so this component stays resource-agnostic. Renders with defaults
 * when subjectId is null (offline/no selection) and the callbacks no-op.
 *
 * Rendered through OverlayPortal so its `position: fixed` scrim actually covers
 * the shell — see overlay-portal.tsx. It claims `aria-modal="true"`, so the nav
 * rail and top bar must not stay clickable behind it.
 */
export function ShareDialog({
  subjectId,
  subjectNoun,
  onClose,
  load,
  onSetVisibility,
  onAdd,
  onRemove,
}: {
  subjectId: string | null;
  subjectNoun: string;
  onClose: () => void;
  load: (id: string) => Promise<SharingStateVM>;
  onSetVisibility: (id: string, visibility: ShareVisibility, permission: SharePermission) => Promise<{ ok: boolean; error?: string }>;
  onAdd: (id: string, userId: string, permission: SharePermission) => Promise<void>;
  onRemove: (id: string, userId: string) => Promise<void>;
}) {
  const [state, setState] = useState<SharingStateVM | null>(null);
  const [visibility, setVisibility] = useState<ShareVisibility>("private");
  const [permission, setPermission] = useState<SharePermission>("view");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, start] = useTransition();

  // Async-only (no synchronous setState) so it's safe to run from an effect —
  // the render already null-guards `state`, so the no-subject case needs no reset.
  const reload = useCallback(() => {
    if (!subjectId) return;
    load(subjectId).then((s) => {
      setState(s);
      setVisibility(s.visibility);
      setPermission(s.workspacePermission);
    });
  }, [subjectId, load]);
  useEffect(() => { reload(); }, [reload]);

  const saveVisibility = () =>
    subjectId &&
    start(async () => {
      const r = await onSetVisibility(subjectId, visibility, permission);
      setNotice(r.ok ? "Sharing updated" : r.error ?? "Couldn't update sharing.");
    });
  const add = (userId: string, perm: SharePermission) =>
    subjectId &&
    start(async () => {
      await onAdd(subjectId, userId, perm);
      reload();
    });
  const remove = (userId: string) =>
    subjectId &&
    start(async () => {
      await onRemove(subjectId, userId);
      reload();
    });

  const overlay: CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 };
  const card: CSSProperties = { width: "min(460px, 92vw)", maxHeight: "82vh", overflow: "auto", background: "var(--panel, #1a1c22)", border: "1px solid var(--line, rgba(255,255,255,.12))", borderRadius: 14, padding: 18, boxShadow: "0 20px 60px rgba(0,0,0,.5)" };
  const seg = (active: boolean): CSSProperties => ({ padding: "5px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13, border: `1px solid ${active ? "var(--gold, #c8a24a)" : "var(--line, rgba(255,255,255,.14))"}`, background: active ? "var(--gold, #c8a24a)22" : "transparent", color: active ? "var(--gold, #c8a24a)" : "inherit" });
  const label: CSSProperties = { marginBottom: 8, fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em", opacity: 0.6 };

  return (
    <OverlayPortal>
      <div style={overlay} onClick={onClose} role="dialog" aria-label={`Share ${subjectNoun}`} aria-modal="true">
        <div className="sharecard" style={card} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 16, textTransform: "capitalize" }}>Share {subjectNoun}</h3>
            <button className="btn sm" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close">Done</button>
          </div>

          {!subjectId ? <p style={{ opacity: 0.7, fontSize: 13 }}>Open a {subjectNoun} to share it.</p> : null}

          <div style={label}>Who can access</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button style={seg(visibility === "private")} onClick={() => setVisibility("private")}>Private (just you)</button>
            <button style={seg(visibility === "workspace")} onClick={() => setVisibility("workspace")}>Everyone in workspace</button>
          </div>
          {visibility === "workspace" ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 13, opacity: 0.7 }}>They can</span>
              <button style={seg(permission === "view")} onClick={() => setPermission("view")}>View</button>
              <button style={seg(permission === "collaborate")} onClick={() => setPermission("collaborate")}>Collaborate</button>
            </div>
          ) : null}
          <button className="btn gold" onClick={saveVisibility} disabled={busy || !subjectId} style={{ marginBottom: 16 }}>
            {busy ? "Saving…" : "Save access"}
          </button>

          <div style={label}>Shared with specific people</div>
          {state && state.shared.length > 0 ? (
            state.shared.map((m) => (
              <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 13 }}>
                <span>{m.email ?? m.userId}</span>
                <span style={{ opacity: 0.6 }}>· {m.permission}</span>
                <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => remove(m.userId)} disabled={busy}>Remove</button>
              </div>
            ))
          ) : (
            <p style={{ opacity: 0.55, fontSize: 13, margin: "2px 0 8px" }}>Not shared with anyone specific yet.</p>
          )}

          {state && state.addable.length > 0 ? (
            <>
              <div style={{ marginTop: 10, marginBottom: 6, fontSize: 12, opacity: 0.6 }}>Add a member</div>
              {state.addable.map((m) => (
                <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13 }}>
                  <span>{m.email ?? m.userId}</span>
                  <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => add(m.userId, "view")} disabled={busy}>+ View</button>
                  <button className="btn sm" onClick={() => add(m.userId, "collaborate")} disabled={busy}>+ Collaborate</button>
                </div>
              ))}
            </>
          ) : null}

          {notice ? <p style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>{notice}</p> : null}
        </div>
      </div>
    </OverlayPortal>
  );
}
