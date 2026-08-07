"use client";

import { useState, useTransition } from "react";

import { deriveObjectKey, type CustomObject } from "@/domain";

import { Field } from "./field";
import {
  archiveObjectType,
  createObjectType,
  renameObjectType,
  restoreObjectType,
} from "../custom-objects-actions";

/**
 * Create, rename and archive the workspace's own record types.
 *
 * The six built-ins are not listed here — they are tables, they cannot be
 * removed, and their NAMES are edited one tab over under Names. Mixing the two
 * would suggest you can delete Contacts.
 */
export function ObjectTypesPanel({ objects }: { objects: CustomObject[] }) {
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
      }
    });
  };

  const active = objects.filter((o) => o.active);
  const archived = objects.filter((o) => !o.active);

  return (
    <div className="panel">
      <div className="panel-h">
        <h3>Your record types</h3>
        <span className="tg">{active.length} active</span>
      </div>
      <div className="panel-b">
        <p className="cxm-hint" style={{ marginBottom: 14 }}>
          Track something the six built-in types don&rsquo;t cover — equipment, subcontractors,
          permits. Each one becomes a tab in your CRM with its own records and its own fields.
        </p>

        {feedback && (
          <div className="cxm-statusline" role="status" style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: feedback.ok ? "var(--ok-text)" : "var(--red-text)" }}>
              {feedback.text}
            </span>
          </div>
        )}

        {active.length === 0 && archived.length === 0 && !adding && (
          <p className="cxm-hint">No record types of your own yet.</p>
        )}

        <div style={{ display: "grid", gap: 6 }}>
          {[...active, ...archived].map((o) => (
            <div key={o.id}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: "var(--inset)",
                  opacity: o.active ? 1 : 0.55,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span>{o.labelPlural}</span>
                    <span className="tg">one: {o.labelSingular}</span>
                    {!o.active && <span className="tg">Archived</span>}
                  </div>
                  {/* The stored key is deliberately NOT printed here. It is
                      the URL, which is tempting to show — but this panel is
                      where "Needs review / needs_review" leaked twice before,
                      and the reader is an owner-operator, not an engineer. The
                      description is what actually helps them. */}
                  {o.description && <div className="cxm-hint">{o.description}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {o.active && (
                    <button
                      type="button"
                      className="btn sm"
                      disabled={pending}
                      onClick={() => { setAdding(false); setEditingId(editingId === o.id ? null : o.id); }}
                    >
                      {editingId === o.id ? "Close" : "Rename"}
                    </button>
                  )}
                  {o.active ? (
                    <button type="button" className="btn sm" disabled={pending} onClick={() => run(() => archiveObjectType({ objectId: o.id }))}>
                      Archive
                    </button>
                  ) : (
                    <button type="button" className="btn sm" disabled={pending} onClick={() => run(() => restoreObjectType({ objectId: o.id }))}>
                      Restore
                    </button>
                  )}
                </div>
              </div>
              {editingId === o.id && (
                <ObjectTypeForm
                  key={`edit-${o.id}`}
                  pending={pending}
                  initial={o}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(v) =>
                    run(() =>
                      renameObjectType({
                        objectId: o.id,
                        labelPlural: v.labelPlural,
                        labelSingular: v.labelSingular,
                        description: v.description,
                      }),
                    )
                  }
                />
              )}
            </div>
          ))}
        </div>

        {adding ? (
          <ObjectTypeForm pending={pending} onCancel={() => setAdding(false)} onSubmit={(v) => run(() => createObjectType(v))} />
        ) : (
          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn sm gold" disabled={pending} onClick={() => { setEditingId(null); setAdding(true); }}>
              Add record type
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Exported so the CRM's own record-type modal renders THIS form rather than a
 * second one over the same schema. Two forms drift; this codebase has already
 * paid for that with `FieldForm`.
 */
export function ObjectTypeForm({
  pending,
  initial,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  initial?: CustomObject;
  onCancel: () => void;
  onSubmit: (v: { labelPlural: string; labelSingular: string; description?: string }) => void;
}) {
  const editing = !!initial;
  const [labelPlural, setLabelPlural] = useState(initial?.labelPlural ?? "");
  const [labelSingular, setLabelSingular] = useState(initial?.labelSingular ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");

  // Both words are required and neither is derived: stripping an "s" gives
  // "Add Equipmen", and irregular nouns are the normal case for what tenants
  // track. Same rule the built-in object names follow.
  const canSubmit = labelPlural.trim().length > 0 && labelSingular.trim().length > 0 && !pending;
  const key = editing ? initial!.key : deriveObjectKey(labelPlural);

  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        borderRadius: 8,
        border: "1px solid var(--line, rgba(255,255,255,0.08))",
        display: "grid",
        gap: 10,
      }}
    >
      <Field label="Name" hint="Plural — what the tab says.">
        <input className="inp" value={labelPlural} onChange={(e) => setLabelPlural(e.target.value)} placeholder="Equipment" maxLength={60} />
      </Field>
      <Field label="One of them" hint="Singular — what buttons say, e.g. “Add equipment item”.">
        <input className="inp" value={labelSingular} onChange={(e) => setLabelSingular(e.target.value)} placeholder="Equipment item" maxLength={60} />
      </Field>
      <Field label="Description" hint="Optional. What belongs in here.">
        <input className="inp" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
      </Field>

      {/* The durable fact, without the identifier that carries it: renaming is
          safe. Printing the key itself would say the same thing in a language
          this reader does not speak. */}
      {key && (
        <p className="cxm-hint" style={{ margin: 0 }}>
          {editing
            ? "Renaming changes what it's called everywhere. Links to it keep working."
            : "You can rename this later without breaking anything that links to it."}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn sm" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button
          type="button"
          className="btn sm gold"
          disabled={!canSubmit}
          onClick={() =>
            onSubmit({
              labelPlural: labelPlural.trim(),
              labelSingular: labelSingular.trim(),
              description: description.trim() || undefined,
            })
          }
        >
          {pending ? (editing ? "Saving…" : "Adding…") : editing ? "Save changes" : "Add record type"}
        </button>
      </div>
    </div>
  );
}
