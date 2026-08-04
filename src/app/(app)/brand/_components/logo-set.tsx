"use client";

import { useRef, useState, useTransition } from "react";

import { BRAND_LOGO_LABELS, BRAND_LOGO_ROLES, type BrandLogo, type BrandLogoRole } from "@/domain";

import { removeBrandLogoVariantAction, saveBrandLogoVariants, type BrandLogoSetResult } from "../actions";

// Mirrors uploadBrandingImage's accepted types — the action re-checks server-side.
const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";

/**
 * The logo set. One tile per role, each independently uploadable and removable,
 * plus one picker that takes several files at once and assigns them to the roles
 * still empty — the realistic case being someone opening their brand folder and
 * dragging in the four files they already have.
 */
export function LogoSet({ logos, onChange }: { logos: BrandLogo[]; onChange: (next: BrandLogo[]) => void }) {
  const [busyRole, setBusyRole] = useState<BrandLogoRole | "batch" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const batchInput = useRef<HTMLInputElement>(null);
  const roleInputs = useRef<Partial<Record<BrandLogoRole, HTMLInputElement | null>>>({});
  const [dragRole, setDragRole] = useState<BrandLogoRole | null>(null);

  const byRole = new Map(logos.map((l) => [l.role, l]));
  const emptyRoles = BRAND_LOGO_ROLES.filter((r) => !byRole.has(r));

  function run(key: BrandLogoRole | "batch", action: () => Promise<BrandLogoSetResult>) {
    setBusyRole(key);
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) onChange(result.logos);
        else setError(result.error);
      } catch {
        setError("Something went wrong. Try again.");
      } finally {
        setBusyRole(null);
      }
    });
  }

  function uploadOne(role: BrandLogoRole, file: File) {
    const fd = new FormData();
    fd.append("files", file);
    fd.append("roles", role);
    run(role, () => saveBrandLogoVariants(fd));
  }

  /**
   * A multi-file pick fills the empty roles in order. Deliberately does NOT
   * overwrite roles that already have an image: a batch drop is a coarse
   * gesture, and silently replacing a mark the operator chose earlier is not
   * something they can undo from this screen.
   */
  function uploadBatch(files: FileList) {
    const chosen = Array.from(files);
    const targets = emptyRoles.slice(0, chosen.length);
    if (targets.length === 0) {
      setError("Every role already has a logo. Replace one individually instead.");
      return;
    }
    const fd = new FormData();
    targets.forEach((role, i) => {
      fd.append("files", chosen[i]);
      fd.append("roles", role);
    });
    const unplaced = chosen.length - targets.length;
    run("batch", async () => {
      const result = await saveBrandLogoVariants(fd);
      // Say so rather than letting the count quietly disagree with what they picked.
      if (result.ok && unplaced > 0) {
        setError(`${targets.length} added. ${unplaced} file${unplaced === 1 ? "" : "s"} had no empty role left — assign ${unplaced === 1 ? "it" : "them"} individually.`);
      }
      return result;
    });
  }

  function onDrop(role: BrandLogoRole, event: React.DragEvent) {
    event.preventDefault();
    setDragRole(null);
    const dropped = Array.from(event.dataTransfer.files ?? []);
    const image = dropped.find((f) => LOGO_ACCEPT.includes(f.type));
    if (!image) {
      setError("That file type isn't supported. Use a PNG, JPG, WebP, GIF or SVG.");
      return;
    }
    uploadOne(role, image);
  }

  return (
    <div className="logoset">
      <div className="logoset-h">
        <div>
          <div className="logoset-t">Your logos</div>
          <div className="logoset-s">
            Arc picks the right one for each piece of creative — the light or dark version depending on
            what it&rsquo;s placed on. Add the ones you have; nothing here is required.
          </div>
        </div>
        <input
          ref={batchInput}
          type="file"
          accept={LOGO_ACCEPT}
          multiple
          hidden
          onChange={(e) => { if (e.target.files?.length) uploadBatch(e.target.files); e.target.value = ""; }}
        />
        <button
          type="button"
          className="gbtn gold sm"
          disabled={busyRole !== null || emptyRoles.length === 0}
          title={emptyRoles.length === 0 ? "Every role has a logo — replace one individually" : "Add several at once"}
          onClick={() => batchInput.current?.click()}
        >
          <svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
          {busyRole === "batch" ? "Uploading…" : "Add several"}
        </button>
      </div>

      {error && <div className="logoset-err" role="status">{error}</div>}

      <div className="logogrid">
        {BRAND_LOGO_ROLES.map((role) => {
          const logo = byRole.get(role);
          const meta = BRAND_LOGO_LABELS[role];
          const busy = busyRole === role;
          return (
            <div
              key={role}
              className={`logotile${logo ? " filled" : ""}${dragRole === role ? " over" : ""}${role === "on_dark" ? " ondark" : ""}`}
            >
              <input
                ref={(el) => { roleInputs.current[role] = el; }}
                type="file"
                accept={LOGO_ACCEPT}
                hidden
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadOne(role, f); }}
              />
              <button
                type="button"
                className="logodrop"
                disabled={busy}
                aria-label={logo ? `Replace the ${meta.label}` : `Add a ${meta.label}`}
                onClick={() => roleInputs.current[role]?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragRole(role); }}
                onDragLeave={() => setDragRole(null)}
                onDrop={(e) => onDrop(role, e)}
              >
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded URL on any host
                  <img src={logo.url} alt={`${meta.label} preview`} />
                ) : (
                  <span className="logoempty">
                    <svg viewBox="0 0 24 24"><path d="M12 16V6M8 10l4-4 4 4" /><path d="M5 16v3a1 1 0 001 1h12a1 1 0 001-1v-3" /></svg>
                    {busy ? "Uploading…" : "Drop or browse"}
                  </span>
                )}
              </button>
              <div className="logometa">
                <div className="logorole">{meta.label}</div>
                <div className="logohint">{meta.hint}</div>
                {logo && (
                  <button
                    type="button"
                    className="logorm"
                    disabled={busy}
                    onClick={() => run(role, () => removeBrandLogoVariantAction(role))}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
