"use client";

import { useState } from "react";

import { Modal } from "../../_components/modal";

/**
 * Add a record of a tenant-defined type.
 *
 * Separate from AddRecordModal, which is keyed to the six: it looks up a config
 * per object for persona, status and parent pickers, and on a custom object
 * that lookup is undefined — the board crashed on the first click before this
 * existed. None of those pickers apply anyway. A custom object has a name, an
 * optional line under it, and whatever custom fields its owner defined.
 */
export function AddCustomRecordModal({
  open,
  onClose,
  singular,
  stageOptions = [],
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  /** The tenant's own word — "Equipment item", not "record". */
  singular: string;
  /** This type's stages, in the tenant's words. Empty when it has no pipeline. */
  stageOptions?: { key: string; label: string }[];
  onSubmit: (value: { name: string; detail: string; status?: string }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  // First stage by default: a record has to enter the pipeline somewhere, and
  // making the operator choose on every add is friction for the common case.
  const [status, setStatus] = useState(stageOptions[0]?.key ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const title = name.trim();
    if (!title) {
      setError(`Give the ${singular.toLowerCase()} a name.`);
      return;
    }
    setSaving(true);
    setError(null);
    const res = await onSubmit({ name: title, detail: detail.trim(), status: status || undefined });
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Could not save that.");
      return;
    }
    setName("");
    setDetail("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={`Add ${singular.toLowerCase()}`} width={460}>
      <div className="arc-fieldkit" style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="cxm-label">Name</span>
          <input
            className="inp"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`What is this ${singular.toLowerCase()} called?`}
            maxLength={200}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="cxm-label">Detail</span>
          <input
            className="inp"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Optional — the line under the name"
            maxLength={200}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </label>

        {stageOptions.length > 0 && (
          <label style={{ display: "grid", gap: 6 }}>
            <span className="cxm-label">Status</span>
            <select className="sel" value={status} onChange={(e) => setStatus(e.target.value)}>
              {stageOptions.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </label>
        )}

        {/* Custom fields are filled in on the record itself rather than here:
            an object with a dozen of them would make this a form nobody
            finishes, and the record page already renders every one. */}
        <p className="cxm-hint" style={{ margin: 0 }}>
          Anything else you track goes on the record once it exists.
        </p>

        {error && (
          <div role="alert" style={{ fontSize: 12, color: "var(--red-text)" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn sm gold" onClick={submit} disabled={saving || !name.trim()}>
            {saving ? "Adding…" : `Add ${singular.toLowerCase()}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
