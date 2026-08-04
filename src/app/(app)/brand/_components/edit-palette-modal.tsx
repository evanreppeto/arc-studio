"use client";

import { useState } from "react";

import type { BrandColorSlot } from "@/domain";
import type { BrandPaletteSlotView } from "@/lib/brand-kit/profile-view";

import { Modal } from "../../_components/modal";

/** What each slot is FOR, in the operator's terms rather than the column name.
 *  Someone setting "Ink" needs to know it's the text colour, not a brand accent. */
const SLOT_HINT: Record<BrandColorSlot, string> = {
  primary: "Your main brand colour — headlines, buttons, the thing people recognise",
  secondary: "A supporting colour that sits comfortably next to the primary",
  accent: "Used sparingly for emphasis — a badge, a highlight, a call to action",
  dark: "Your darkest tone, used for text and deep backgrounds",
  light: "Your lightest tone, used for page and card backgrounds",
};

type Draft = { label: string; hex: string };

/** "#ABC123" → true. Empty is allowed and means "this slot is unset". */
function isUsableHex(hex: string): boolean {
  const trimmed = hex.trim();
  if (trimmed.length === 0) return true;
  return /^#?[0-9a-fA-F]{6}$/.test(trimmed);
}

function withHash(hex: string): string {
  const trimmed = hex.trim();
  if (trimmed.length === 0) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

export function EditPaletteModal({
  open,
  slots,
  onClose,
  onSubmit,
}: {
  open: boolean;
  slots: BrandPaletteSlotView[];
  onClose: () => void;
  onSubmit: (
    colors: Partial<Record<BrandColorSlot, Draft>>,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [draft, setDraft] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(slots.map((s) => [s.slot, { label: s.label, hex: s.hex }])),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(slot: BrandColorSlot, patch: Partial<Draft>) {
    setDraft((prev) => ({ ...prev, [slot]: { ...prev[slot], ...patch } }));
  }

  // Catch a bad hex before the round trip, so the field the operator is looking
  // at is the one that reports the problem.
  const invalid = slots.filter((s) => !isUsableHex(draft[s.slot]?.hex ?? ""));
  const canSubmit = invalid.length === 0 && !pending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    const colors = Object.fromEntries(
      slots.map((s) => [s.slot, { label: draft[s.slot].label.trim(), hex: withHash(draft[s.slot].hex) }]),
    ) as Partial<Record<BrandColorSlot, Draft>>;
    const result = await onSubmit(colors);
    if (result.ok) {
      onClose();
    } else {
      setError(result.error ?? "Could not save your palette.");
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit brand palette"
      description="These colours go on every ad, email and landing page Arc makes. Leave a colour blank to remove it."
      width={560}
      footer={
        <>
          <button type="button" className="mbtn" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" form="edit-palette-form" className="mbtn gold" disabled={!canSubmit}>
            {pending ? "Saving…" : "Save palette"}
          </button>
        </>
      }
    >
      <form id="edit-palette-form" className="mform palform" onSubmit={submit}>
        {slots.map((s) => {
          const value = draft[s.slot] ?? { label: "", hex: "" };
          const bad = !isUsableHex(value.hex);
          const swatch = isUsableHex(value.hex) && value.hex.trim() ? withHash(value.hex) : null;
          return (
            <div className="palrow" key={s.slot}>
              <div className="palrow-h">
                <span className="palrole">{s.role}</span>
                <span className="palhint">{SLOT_HINT[s.slot]}</span>
              </div>
              <div className="palctl">
                {/* The native picker and the hex field edit the same value, so
                    someone with a hex from their brand guide can paste it, and
                    someone without one can just pick. */}
                <input
                  type="color"
                  className="palswatch"
                  aria-label={`${s.role} colour picker`}
                  value={swatch ?? "#000000"}
                  onChange={(e) => set(s.slot, { hex: e.target.value })}
                />
                <input
                  className={`palhex${bad ? " bad" : ""}`}
                  value={value.hex}
                  spellCheck={false}
                  placeholder="#000000"
                  aria-label={`${s.role} hex value`}
                  aria-invalid={bad || undefined}
                  onChange={(e) => set(s.slot, { hex: e.target.value })}
                />
                <input
                  className="pallabel"
                  value={value.label}
                  placeholder="Name it (optional)"
                  aria-label={`${s.role} colour name`}
                  onChange={(e) => set(s.slot, { label: e.target.value })}
                />
              </div>
              {bad && <div className="palbad">Use a 6-digit hex, like #1B2A4A.</div>}
            </div>
          );
        })}
        {error && <div className="mError">{error}</div>}
      </form>
    </Modal>
  );
}
