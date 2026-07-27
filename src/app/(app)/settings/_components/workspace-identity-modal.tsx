"use client";

import { useRef, useState, useTransition } from "react";

import {
  resolveWorkspaceIdentity,
  workspaceInitials,
  WORKSPACE_ACCENT_KEYS,
  WORKSPACE_ACCENT_SWATCHES,
  WORKSPACE_SHORT_LABEL_MAX,
  WORKSPACE_SUBTITLE_MAX,
  type WorkspaceAccentKey,
} from "@/domain";
import type { SettingsWorkspace } from "@/lib/auth/workspaces-view";

import { Modal } from "../../_components/modal";
import { removeWorkspaceRowLogoAction, saveWorkspaceRowLogoAction } from "../branding-actions";

export type WorkspaceIdentityValue = {
  workspaceId: string;
  name: string;
  organizationName: string;
  subtitle: string | null;
  shortLabel: string | null;
  accentKey: string | null;
};

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";

/**
 * Edit one workspace's display identity, with a live preview of the rail block
 * it controls.
 *
 * The preview is the point. Three of these five fields only ever appear in the
 * sidebar, and two of them (subtitle, short label) are empty-means-inherit — a
 * plain form would leave you guessing what "blank" resolves to. The preview
 * runs the same `resolveWorkspaceIdentity` the server does, so what it shows is
 * what the rail will render.
 *
 * The logo uploads immediately (it needs a server round-trip to become a URL);
 * the text fields and color save on submit.
 */
export function WorkspaceIdentityModal({
  open,
  workspace,
  onClose,
  onSubmit,
}: {
  open: boolean;
  workspace: SettingsWorkspace | null;
  onClose: () => void;
  onSubmit: (value: WorkspaceIdentityValue) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [name, setName] = useState(workspace?.name ?? "");
  const [organizationName, setOrganizationName] = useState(workspace?.orgName ?? "");
  // Stored, NOT resolved: seeding these boxes with the resolved fallback would
  // silently promote an inherited subtitle into a stored one on the next save.
  // Blank means "inherit", and the placeholder shows what that resolves to.
  const [subtitle, setSubtitle] = useState(workspace?.storedSubtitle ?? "");
  const [shortLabel, setShortLabel] = useState(workspace?.storedShortLabel ?? "");
  const [accentKey, setAccentKey] = useState<WorkspaceAccentKey | null>(workspace?.accentKey ?? null);
  const [logoUrl, setLogoUrl] = useState<string | null>(workspace?.logoUrl ?? null);
  const [pending, setPending] = useState(false);
  const [uploading, startUpload] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!workspace) return null;

  const workspaceId = workspace.id;
  const canSubmit = name.trim().length > 0 && !pending && !uploading;

  // Same resolver the server uses — the preview cannot drift from the rail.
  const preview = resolveWorkspaceIdentity(
    { name, subtitle: subtitle || null, shortLabel: shortLabel || null, accentKey, logoUrl },
    organizationName,
  );

  function onPickLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = ""; // let the same file be re-picked after a remove
    if (!chosen) return;
    setError(null);
    const formData = new FormData();
    formData.append("file", chosen);
    startUpload(async () => {
      const result = await saveWorkspaceRowLogoAction(workspaceId, formData);
      if (result.ok) setLogoUrl(result.url);
      else setError(result.error);
    });
  }

  function onRemoveLogo() {
    setError(null);
    startUpload(async () => {
      const result = await removeWorkspaceRowLogoAction(workspaceId);
      if (result.ok) setLogoUrl(null);
      else setError(result.error);
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    const result = await onSubmit({
      workspaceId,
      name: name.trim(),
      organizationName: organizationName.trim(),
      subtitle: subtitle.trim() || null,
      shortLabel: shortLabel.trim() || null,
      accentKey,
    });
    if (result.ok) {
      onClose();
    } else {
      setError(result.error ?? "Could not save the workspace.");
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Customize workspace"
      description="How this workspace appears in the sidebar. Nothing here goes outbound."
      footer={
        <>
          <button type="button" className="mbtn" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" form="workspace-identity-form" className="mbtn gold" disabled={!canSubmit}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <div
        className="wsid-preview"
        style={preview.accentColor ? ({ "--ws-accent": preview.accentColor } as React.CSSProperties) : undefined}
        aria-label="Sidebar preview"
      >
        <div className="wsid-preview-h">Sidebar preview</div>
        <div className="wsid-preview-ws">
          <span className="wsid-preview-mk">
            {preview.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo; next/image would need per-host remotePatterns
              <img src={preview.logoUrl} alt="" />
            ) : (
              workspaceInitials(preview.name || organizationName)
            )}
          </span>
          <span className="wsid-preview-t">
            <span className="wsid-preview-nm">{preview.name || "Workspace"}</span>
            <span className="wsid-preview-pl">{preview.subtitle || "—"}</span>
          </span>
        </div>
        <div className="wsid-preview-tag">
          <i />
          {preview.shortLabel}
        </div>
      </div>

      <form id="workspace-identity-form" className="mform" onSubmit={submit}>
        <div className="mrow">
          <label className="mfield">
            <span className="mlabel">Workspace name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            <span className="mopt">The bold line in the sidebar.</span>
          </label>
          <label className="mfield">
            <span className="mlabel">Organization</span>
            <input value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} maxLength={80} />
            <span className="mopt">Your brand name. Arc uses it as its outbound from-name.</span>
          </label>
        </div>

        <label className="mfield">
          <span className="mlabel">
            Subtitle <span className="mopt">optional</span>
          </span>
          <input
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            maxLength={WORKSPACE_SUBTITLE_MAX}
            placeholder={organizationName || "Defaults to the organization name"}
          />
          <span className="mopt">The small line under the name. Leave blank to show the organization.</span>
        </label>

        <label className="mfield">
          <span className="mlabel">
            Status label <span className="mopt">optional</span>
          </span>
          <input
            value={shortLabel}
            onChange={(e) => setShortLabel(e.target.value)}
            maxLength={WORKSPACE_SHORT_LABEL_MAX}
            placeholder={preview.shortLabel}
          />
          <span className="mopt">The small tag below the workspace block.</span>
        </label>

        <div className="mfield">
          <span className="mlabel">Color</span>
          <div className="wsid-swatches">
            <button
              type="button"
              className={`wsid-sw wsid-sw-auto${accentKey === null ? " on" : ""}`}
              onClick={() => setAccentKey(null)}
              aria-pressed={accentKey === null}
              title="Match the app accent"
            >
              Auto
            </button>
            {WORKSPACE_ACCENT_KEYS.map((key) => (
              <button
                type="button"
                key={key}
                className={`wsid-sw${accentKey === key ? " on" : ""}`}
                style={{ background: WORKSPACE_ACCENT_SWATCHES[key] }}
                onClick={() => setAccentKey(key)}
                aria-pressed={accentKey === key}
                aria-label={key}
                title={key[0].toUpperCase() + key.slice(1)}
              />
            ))}
          </div>
          <span className="mopt">Tints this workspace’s monogram and dot, so it stands out in the switcher.</span>
        </div>

        <div className="mfield">
          <span className="mlabel">
            Logo <span className="mopt">optional</span>
          </span>
          <div className="wsid-logo">
            <button type="button" className="btn sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? "Uploading…" : logoUrl ? "Replace" : "Upload"}
            </button>
            {logoUrl && (
              <button type="button" className="btn sm" disabled={uploading} onClick={onRemoveLogo}>
                Remove
              </button>
            )}
            <span className="mopt">Saves immediately. Square PNG or SVG works best.</span>
          </div>
          <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={onPickLogo} />
        </div>

        {error && <div className="mError">{error}</div>}
      </form>
    </Modal>
  );
}
