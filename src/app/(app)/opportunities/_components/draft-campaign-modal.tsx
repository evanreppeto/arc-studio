"use client";

import { useState } from "react";

import { DEFAULT_PERSONAS } from "@/lib/personas/default-personas";

import { Modal } from "../../_components/modal";
import { type OpportunityVM } from "./opportunity-inbox";

function personaLabel(key: string): string {
  return key
    .replace(/^persona_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Which flow the confirm modal drives:
 * - `operator` — "Create campaign": an operator-owned draft shell.
 * - `arc` — "Ask Arc to draft": also runs Arc to draft the full package.
 */
export type DraftMode = "operator" | "arc";

const MODE_COPY: Record<
  DraftMode,
  { title: string; description: string; submit: string; submitting: string }
> = {
  operator: {
    title: "Draft campaign from opportunity",
    description:
      "Arc starts a draft from this opportunity's evidence. It stays locked — nothing sends until you approve it.",
    submit: "Create draft",
    submitting: "Creating draft…",
  },
  arc: {
    title: "Ask Arc to draft a package",
    description:
      "Arc will draft the whole thing — email, SMS, paid, and landing copy — from this opportunity's evidence. Every asset lands as a locked draft; nothing sends until you approve it.",
    submit: "Ask Arc to draft",
    submitting: "Arc is drafting…",
  },
};

/**
 * Confirm/preview before converting an opportunity into a campaign draft. Shows
 * the read-only evidence Arc carries over (message angle, signals, subject
 * record) and lets the operator confirm/adjust the seeded name, persona, and
 * focus. Submit creates an approval-gated draft — nothing sends.
 */
export type PersonaOption = { key: string; label: string };

export function DraftCampaignModal({
  open,
  onClose,
  opp,
  mode = "operator",
  personaOptions,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  opp: OpportunityVM;
  mode?: DraftMode;
  /** The org's own personas. Falls back to neutral starter personas. */
  personaOptions?: PersonaOption[];
  /** Returns the outcome so the modal can surface an error and stay open on failure. */
  onSubmit: (
    value: { name: string; persona: string; campaignTheme: string },
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const copy = MODE_COPY[mode];
  const personaChoices =
    personaOptions?.length
      ? personaOptions
      : DEFAULT_PERSONAS.map((persona) => ({ key: persona.slug, label: persona.name || personaLabel(persona.slug) }));
  const [name, setName] = useState(opp.seed.name);
  const [persona, setPersona] = useState(opp.seed.persona);
  const [campaignTheme, setCampaignTheme] = useState(opp.seed.campaignTheme);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && persona.length > 0 && campaignTheme.trim().length > 0 && !pending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    const result = await onSubmit({ name: name.trim(), persona, campaignTheme: campaignTheme.trim() });
    if (result.ok) {
      onClose();
    } else {
      setError(result.error ?? "Could not create the campaign draft.");
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={copy.title}
      description={copy.description}
      width={620}
      footer={
        <>
          <button type="button" className="mbtn" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" form="draft-from-opp-form" className="mbtn gold" disabled={!canSubmit}>
            {pending ? copy.submitting : copy.submit}
          </button>
        </>
      }
    >
      <form id="draft-from-opp-form" className="mform" onSubmit={submit}>
        <div className="opp-seed-preview">
          <div className="mlabel">Message angle Arc will carry over</div>
          <p className="opp-seed-angle">{opp.recommendedAction}</p>

          {opp.evidence.length > 0 && (
            <>
              <div className="mlabel">Evidence</div>
              <ul className="opp-seed-evidence">
                {opp.evidence.map((e, i) => (
                  <li key={i}>
                    <span className="es">{e.label}:</span> {e.value}
                  </li>
                ))}
              </ul>
            </>
          )}

          {opp.recordHref && opp.recordLabel && (
            <div className="opp-seed-record">
              Linked to this draft:{" "}
              <a href={opp.recordHref}>{opp.recordLabel.replace(/^Open the /, "").replace(/ record$/, "")} record</a>
            </div>
          )}
        </div>

        <label className="mfield">
          <span className="mlabel">Campaign name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" required />
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
              value={campaignTheme}
              onChange={(e) => setCampaignTheme(e.target.value)}
              placeholder="Win-back, launch, referral growth…"
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
