"use client";

import { useState } from "react";

import Link from "next/link";

import { Modal } from "../../_components/modal";
import { type NewCampaignInput } from "../actions";

export type PersonaOption = { key: string; label: string };

export function NewCampaignModal({
  open,
  personaOptions,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /**
   * The org's own personas — the ONLY ones `createCampaign` will accept, since
   * it validates against `getOrgPersonaKeys` for this workspace.
   *
   * Empty means empty. This used to fall back to `DEFAULT_PERSONAS`, which
   * undid the careful distinction the page had already drawn: the page passes
   * `[]` for a live workspace whose persona read came back empty, and the
   * fallback filled that with keys from another taxonomy. Every one of them
   * failed `isAllowedPersona`, so the operator picked a persona and got back
   * "Choose a persona for this campaign." — a list where every choice was
   * wrong, under a message saying they had not chosen.
   */
  personaOptions?: PersonaOption[];
  onClose: () => void;
  /** Returns the outcome so the modal can surface an error and stay open on failure. */
  onSubmit: (value: NewCampaignInput) => Promise<{ ok: boolean; error?: string }>;
}) {
  const personaChoices = personaOptions ?? [];
  const noPersonas = personaChoices.length === 0;
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [theme, setTheme] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The board remounts this via `key` on each open, so fields start fresh.
  const canSubmit = !noPersonas && name.trim().length > 0 && persona.length > 0 && theme.trim().length > 0 && !pending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    const result = await onSubmit({ name: name.trim(), persona, campaignTheme: theme.trim() });
    if (result.ok) {
      onClose();
    } else {
      setError(result.error ?? "Could not create the campaign.");
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New campaign"
      description="Creates a draft campaign. Arc builds out the assets — the email, the copy, the creative — and nothing sends until you approve it."
      footer={
        <>
          <button type="button" className="mbtn" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" form="new-campaign-form" className="mbtn gold" disabled={!canSubmit}>
            {pending ? "Creating…" : "Create draft"}
          </button>
        </>
      }
    >
      <form id="new-campaign-form" className="mform" onSubmit={submit}>
        <label className="mfield">
          <span className="mlabel">Campaign name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Spring customer reactivation"
            required
          />
        </label>

        <div className="mrow">
          <label className="mfield">
            <span className="mlabel">Audience persona</span>
            <select value={persona} onChange={(e) => setPersona(e.target.value)} required disabled={noPersonas}>
              <option value="" disabled>
                {noPersonas ? "No personas in this workspace" : "Choose a persona…"}
              </option>
              {personaChoices.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mfield">
            <span className="mlabel">Campaign theme</span>
            <input
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="Win-back, product launch, referral growth…"
              maxLength={120}
              required
            />
          </label>
        </div>

        {/* A campaign needs a persona this workspace actually has, so with none
            there is nothing to pick and Create stays disabled. Naming the next
            step beats a dropdown that silently refuses every choice. */}
        {noPersonas && (
          <div className="mError">
            This workspace has no personas yet, and a campaign needs one to aim at.{" "}
            <Link href="/personas">Add a persona</Link>, then come back — if you do have some, the list
            couldn&apos;t be read just now, so reload before adding more.
          </div>
        )}

        {error && <div className="mError">{error}</div>}
      </form>
    </Modal>
  );
}
