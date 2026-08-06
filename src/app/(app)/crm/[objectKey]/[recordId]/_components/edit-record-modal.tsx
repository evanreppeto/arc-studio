"use client";

import { useState } from "react";

import { OFFICIAL_PERSONA_MAPPINGS, humanizePersonaLabel } from "@/domain";

import { Modal } from "../../../../_components/modal";

// Per-object status options.
//
// Companies and contacts are not pipelines — their statuses are app machinery
// and stay fixed. Leads, jobs and outcomes ARE pipelines: these three lists are
// now only the fallback for when the org's own stages could not be read, and
// they match DEFAULT_PIPELINE_STAGES, which is what every stage read falls back
// to. Offering a stale hardcoded list to a tenant who has renamed their stages
// would write a status that maps to nothing.
// "archived" is deliberately absent. Archiving is its own action now (the
// Archive button on this record, or the bulk action on the list) writing its own
// column, so offering it here too would be a second mechanism that sets a
// DIFFERENT thing: a record whose status read "Archived" while archived_at
// stayed null would sit in every list looking deleted.
const STATUS_OPTIONS: Record<string, string[]> = {
  companies: ["active", "inactive"],
  contacts: ["active", "inactive", "do_not_contact"],
  leads: ["new", "validated", "needs_review", "qualified", "converted", "lost"],
  jobs: ["pending", "scheduled", "in_progress", "completed", "canceled"],
  outcomes: ["pending", "won", "lost", "paid", "written_off"],
};

function titleize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function personaLabel(key: string): string {
  return humanizePersonaLabel(key);
}

export type EditRecordValue = { persona?: string; status?: string };
export type PersonaOption = { key: string; label: string };

export function EditRecordModal({
  open,
  objectKey,
  currentPersona,
  currentStatus,
  personaOptions,
  stageOptions,
  onClose,
  onSubmit,
}: {
  open: boolean;
  objectKey: string;
  currentPersona: string;
  currentStatus: string;
  /** The org's own personas. Falls back to the BSR demo set when not provided. */
  personaOptions?: PersonaOption[];
  /** The org's own pipeline stages, in its own words. Absent for non-pipeline objects. */
  stageOptions?: { key: string; label: string }[];
  onClose: () => void;
  onSubmit: (value: EditRecordValue) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [persona, setPersona] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusOptions = stageOptions?.length
    ? stageOptions
    : (STATUS_OPTIONS[objectKey] ?? []).map((key) => ({ key, label: titleize(key) }));
  const personaChoices =
    personaOptions?.length ? personaOptions : OFFICIAL_PERSONA_MAPPINGS.map((key) => ({ key, label: personaLabel(key) }));
  const canSubmit = (persona || status) && !pending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    const result = await onSubmit({ persona: persona || undefined, status: status || undefined });
    if (result.ok) {
      onClose();
    } else {
      setError(result.error ?? "Could not save changes.");
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit record"
      description="Reassign this record's persona or change its status. Internal only — nothing goes outbound."
      width={460}
      footer={
        <>
          <button type="button" className="mbtn" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" form="edit-record-form" className="mbtn gold" disabled={!canSubmit}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <form id="edit-record-form" className="mform" onSubmit={submit}>
        <label className="mfield">
          <span className="mlabel">
            Persona {currentPersona && <span className="mopt">now: {currentPersona}</span>}
          </span>
          <select value={persona} onChange={(e) => setPersona(e.target.value)}>
            <option value="">Keep current</option>
            {personaChoices.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        {statusOptions.length > 0 && (
          <label className="mfield">
            <span className="mlabel">
              Status {currentStatus && <span className="mopt">now: {currentStatus}</span>}
            </span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Keep current</option>
              {statusOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <div className="mError">{error}</div>}
      </form>
    </Modal>
  );
}
