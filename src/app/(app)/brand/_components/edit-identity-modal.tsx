"use client";

import { useState } from "react";

import { Modal } from "../../_components/modal";
import { type BrandIdentityInput } from "../actions";

export function EditIdentityModal({
  open,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial: BrandIdentityInput;
  onClose: () => void;
  onSubmit: (value: BrandIdentityInput) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [tagline, setTagline] = useState(initial.tagline);
  const [websiteUrl, setWebsiteUrl] = useState(initial.websiteUrl);
  const [voiceGuidance, setVoiceGuidance] = useState(initial.voiceGuidance);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = displayName.trim().length > 0 && !pending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    const result = await onSubmit({
      displayName: displayName.trim(),
      tagline: tagline.trim(),
      websiteUrl: websiteUrl.trim(),
      voiceGuidance: voiceGuidance.trim(),
    });
    if (result.ok) {
      onClose();
    } else {
      setError(result.error ?? "Could not save brand changes.");
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit brand identity"
      description="How Arc refers to your brand and how it writes. Saved to your Brand profile — internal only, nothing goes outbound."
      width={520}
      footer={
        <>
          <button type="button" className="mbtn" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" form="edit-identity-form" className="mbtn gold" disabled={!canSubmit}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <form id="edit-identity-form" className="mform" onSubmit={submit}>
        <label className="mfield">
          <span className="mlabel">Brand name</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your company name" required />
        </label>
        <label className="mfield">
          <span className="mlabel">
            Tagline <span className="mopt">optional</span>
          </span>
          <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="What you do, in one line" />
        </label>
        <label className="mfield">
          <span className="mlabel">
            Website <span className="mopt">optional</span>
          </span>
          <input type="url" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://yourbrand.com" />
        </label>
        <label className="mfield">
          <span className="mlabel">
            Voice &amp; tone <span className="mopt">how Arc should write</span>
          </span>
          <textarea
            value={voiceGuidance}
            onChange={(e) => setVoiceGuidance(e.target.value)}
            rows={4}
            placeholder="Speak neighbor-to-neighbor. Lead with help and proof, never pressure. Short, active sentences."
          />
        </label>
        {error && <div className="mError">{error}</div>}
      </form>
    </Modal>
  );
}
