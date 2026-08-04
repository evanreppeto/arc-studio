"use client";

import { useState } from "react";

import { BRAND_FONTS, type BrandFont } from "@/domain";

import { Modal } from "../../_components/modal";

type Role = "heading" | "body";

const ROLE_COPY: Record<Role, { title: string; hint: string; sample: string }> = {
  heading: {
    title: "Headlines",
    hint: "Carries the ad. Chosen for impact at large sizes.",
    sample: "Your headline, set in this face",
  },
  body: {
    title: "Body copy",
    hint: "Everything else — paragraphs, captions, buttons. Chosen for legibility.",
    sample: "The quick brown fox jumps over the lazy dog. 0123456789",
  },
};

function FontChoice({
  font,
  selected,
  role,
  onPick,
}: {
  font: BrandFont;
  selected: boolean;
  role: Role;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className={`fontopt${selected ? " on" : ""}`}
      aria-pressed={selected}
      onClick={onPick}
    >
      <span className="fontopt-h">
        <span className="fontopt-name">{font.label}</span>
        <span className="fontopt-cat">{font.category}</span>
      </span>
      {/* The sample renders IN the font, which is the only part of this control
          that actually tells the operator anything. */}
      <span
        className="fontopt-sample"
        style={{ fontFamily: font.stack, fontWeight: role === "heading" ? 700 : 400 }}
      >
        {ROLE_COPY[role].sample}
      </span>
      <span className="fontopt-hint">{font.hint}</span>
    </button>
  );
}

export function EditTypographyModal({
  open,
  initialHeading,
  initialBody,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initialHeading: string;
  initialBody: string;
  onClose: () => void;
  onSubmit: (value: { headingFont: string; bodyFont: string }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [heading, setHeading] = useState(initialHeading);
  const [body, setBody] = useState(initialBody);
  const [role, setRole] = useState<Role>("heading");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = role === "heading" ? heading : body;
  const pick = role === "heading" ? setHeading : setBody;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await onSubmit({ headingFont: heading, bodyFont: body });
    if (result.ok) {
      onClose();
    } else {
      setError(result.error ?? "Could not save your typography.");
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose your typefaces"
      description="Used on every ad, email and landing page Arc makes. Every font here is one Arc can actually render — nothing falls back to something else."
      width={560}
      footer={
        <>
          <button type="button" className="mbtn" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" form="edit-typography-form" className="mbtn gold" disabled={pending}>
            {pending ? "Saving…" : "Save typefaces"}
          </button>
        </>
      }
    >
      <form id="edit-typography-form" className="mform typform" onSubmit={submit}>
        <div className="typtabs" role="tablist" aria-label="Which text to set">
          {(["heading", "body"] as Role[]).map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={role === r}
              className={`typtab${role === r ? " on" : ""}`}
              onClick={() => setRole(r)}
            >
              <span className="typtab-t">{ROLE_COPY[r].title}</span>
              <span className="typtab-v">{r === "heading" ? heading : body}</span>
            </button>
          ))}
        </div>
        <p className="typhint">{ROLE_COPY[role].hint}</p>
        <div className="fontlist">
          {BRAND_FONTS.map((font) => (
            <FontChoice
              key={font.id}
              font={font}
              role={role}
              selected={current === font.id}
              onPick={() => pick(font.id)}
            />
          ))}
        </div>
        {error && <div className="mError">{error}</div>}
      </form>
    </Modal>
  );
}
