"use client";

import { useState } from "react";

import { Modal } from "../../_components/modal";

/**
 * Edit a folder's name and description.
 *
 * The description is not decoration: the seeded folders all carry one ("Real
 * before/after photos that show real results"), the rail shows it on hover, and
 * it is the only place a workspace can say what belongs in a folder. Until now
 * nothing could change it — the column was written once at seed time and never
 * again, so a renamed folder kept a description describing something else.
 *
 * Separate from the inline rename rather than replacing it: renaming is a
 * one-word edit that belongs in the row, and writing a sentence is not.
 */
export function FolderDetailsModal({
  open,
  folderName,
  description,
  onClose,
  onSubmit,
}: {
  open: boolean;
  folderName: string;
  description: string | null;
  onClose: () => void;
  onSubmit: (value: { name: string; description: string }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [name, setName] = useState(folderName);
  const [note, setNote] = useState(description ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && !pending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    const result = await onSubmit({ name: name.trim(), description: note.trim() });
    if (result.ok) {
      onClose();
    } else {
      setError(result.error ?? "Could not update the folder.");
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Folder details"
      description="Names and notes are internal organization — nothing here goes outbound."
      width={460}
      footer={
        <>
          <button type="button" className="mbtn" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" form="folder-details-form" className="mbtn gold" disabled={!canSubmit}>
            {pending ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <form id="folder-details-form" className="mform" onSubmit={submit}>
        <label className="mfield">
          <span className="mlabel">Folder name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="mfield">
          <span className="mlabel">Description</span>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What belongs in here — e.g. before/after photos that show real results."
          />
          <span className="mhint">Shown when you hover the folder in the rail. Leave blank to clear it.</span>
        </label>
        {error && <div className="mError">{error}</div>}
      </form>
    </Modal>
  );
}
