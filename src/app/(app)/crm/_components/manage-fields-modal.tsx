"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { CustomFieldDefinition } from "@/domain";

import { Modal } from "../../_components/modal";
import { FieldForm } from "../../settings/_components/custom-fields-panel";
import { archiveCustomField, createCustomField, updateCustomField } from "../../settings/custom-fields-actions";

/**
 * Add, rename and remove this object's fields without leaving the table.
 *
 * Fields were manageable only from Settings, and only reachable from a record
 * page — so shaping the table you are looking at meant leaving it, finding the
 * right screen, and coming back. The Columns menu next door decides which
 * fields SHOW; this decides which exist. They belong within one click of each
 * other, which is why this opens from that menu.
 *
 * The form is the settings screen's own component, not a copy. Two forms over
 * one schema drift — this codebase has already paid for that once, which is why
 * `field.tsx` was extracted when the same input markup existed twice.
 */
export function ManageFieldsModal({
  open,
  onClose,
  objectKey,
  objectLabel,
  definitions,
}: {
  open: boolean;
  onClose: () => void;
  /** Per-org: one of the six, or a key the tenant defined for itself. */
  objectKey: string;
  /** The tenant's own word for this object — "Matters", not "Properties". */
  objectLabel: string;
  /** Active definitions for this object, as the server rendered them. */
  definitions: CustomFieldDefinition[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    startTransition(async () => {
      const result = await fn();
      setFeedback({ ok: result.ok, text: result.ok ? result.message ?? "Saved." : result.error ?? "Something went wrong." });
      if (result.ok) {
        setAdding(false);
        setEditingId(null);
        // The actions revalidate /crm, but this component is holding the old
        // definitions as props — without a refresh the modal keeps showing the
        // name that was just corrected.
        router.refresh();
      }
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Fields on ${objectLabel}`}
      description="What you track beyond the built-in columns. Fields appear on the record, in the add and edit forms, and in what Arc reads when it drafts."
      width={560}
    >
      {/* Carries the field editor's own primitives (.btn/.inp/.sel/.cxm-*).
          Without it the shared form falls through to the app's gold button and
          Remove renders as the loudest thing in the dialog. */}
      <div className="arc-fieldkit">
      {feedback && (
        <div role="status" style={{ marginBottom: 12, fontSize: 12, color: feedback.ok ? "var(--ok-text)" : "var(--red-text)" }}>
          {feedback.text}
        </div>
      )}

      {definitions.length === 0 && !adding && (
        <p className="cxm-hint" style={{ marginBottom: 12 }}>
          No custom fields on {objectLabel} yet.
        </p>
      )}

      <div style={{ display: "grid", gap: 6 }}>
        {definitions.map((d) => (
          <div key={d.id}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 6,
                background: "var(--inset)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13 }}>{d.label}</div>
                {d.options.length > 0 && (
                  <div className="cxm-hint">{d.options.map((o) => o.label).join(", ")}</div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className="btn sm"
                  disabled={pending}
                  onClick={() => { setAdding(false); setEditingId(editingId === d.id ? null : d.id); }}
                >
                  {editingId === d.id ? "Close" : "Edit"}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={pending}
                  onClick={() => run(() => archiveCustomField({ fieldId: d.id, objectKey }))}
                >
                  Remove
                </button>
              </div>
            </div>
            {editingId === d.id && (
              <FieldForm
                key={`edit-${d.id}`}
                objectLabel={objectLabel}
                pending={pending}
                initial={d}
                onCancel={() => setEditingId(null)}
                onSubmit={(input) =>
                  run(() =>
                    updateCustomField({
                      fieldId: d.id,
                      objectKey,
                      label: input.label,
                      required: input.required,
                      options: input.options,
                      helpText: input.helpText,
                    }),
                  )
                }
              />
            )}
          </div>
        ))}
      </div>

      {adding ? (
        <FieldForm
          objectLabel={objectLabel}
          pending={pending}
          onCancel={() => setAdding(false)}
          onSubmit={(input) => run(() => createCustomField({ ...input, objectKey }))}
        />
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12 }}>
          <button type="button" className="btn sm gold" disabled={pending} onClick={() => { setEditingId(null); setAdding(true); }}>
            Add field
          </button>
          {/* Removing keeps every saved value, so it is reversible — but only
              from Settings, which is the one place that lists what is archived. */}
          <Link className="cxm-hint" href={`/settings?s=records&t=Fields&o=${encodeURIComponent(objectKey)}`}>
            Removed fields keep their data · manage in Settings
          </Link>
        </div>
      )}
      </div>
    </Modal>
  );
}
