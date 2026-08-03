"use client";

import { useState } from "react";

import { DEFAULT_PERSONAS } from "@/lib/personas/default-personas";

import { Modal } from "../../_components/modal";
import { type NewCampaignInput } from "../actions";

function personaLabel(key: string): string {
  return key
    .replace(/^persona_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export type PersonaOption = { key: string; label: string };

export function NewCampaignModal({
  open,
  personaOptions,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** The org's own personas. Falls back to neutral starter personas. */
  personaOptions?: PersonaOption[];
  onClose: () => void;
  /** Returns the outcome so the modal can surface an error and stay open on failure. */
  onSubmit: (value: NewCampaignInput) => Promise<{ ok: boolean; error?: string }>;
}) {
  const personaChoices =
    personaOptions?.length
      ? personaOptions
      : DEFAULT_PERSONAS.map((persona) => ({ key: persona.slug, label: persona.name || personaLabel(persona.slug) }));
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [theme, setTheme] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The board remounts this via `key` on each open, so fields start fresh.
  const canSubmit = name.trim().length > 0 && persona.length > 0 && theme.trim().length > 0 && !pending;

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
            <select value={persona} onChange={(e) => setPersona(e.target.value)} required>
              <option value="" disabled>
                Choose a persona…
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

        {error && <div className="mError">{error}</div>}
      </form>
    </Modal>
  );
}
