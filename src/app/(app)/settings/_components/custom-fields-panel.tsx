"use client";

import { useState, useTransition } from "react";

import { Field } from "./field";

import { ScopedNotice } from "./scoped-notice";

import {
  CHOICE_FIELD_TYPES,
  CUSTOM_FIELD_OBJECT_KEYS,
  CUSTOM_FIELD_TYPES,
  type CustomFieldDefinition,
  type CustomFieldType,
} from "@/domain";

import {
  archiveCustomField,
  createCustomField,
  restoreCustomField,
  updateCustomField,
} from "../custom-fields-actions";

/** Operator-facing names for the eight storage types. */
const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  select: "Choice",
  multi_select: "Multiple choice",
  boolean: "Yes / no",
  url: "Link",
  currency: "Currency",
};

export type CustomFieldsPanelProps = {
  definitions: CustomFieldDefinition[];
  /**
   * The tenant's own word for each CRM object. A law firm manages fields on
   * "Matters", not on "Properties" — this screen must not be the one place the
   * product reverts to our internal vocabulary.
   */
  objectLabels: Record<string, string>;
  /** CRM object a deep link arrived pointing at — narrows this editor to it. */
  focusObject?: string | null;
  /**
   * The tenant's OWN record types, key -> plural label, listed after the six.
   *
   * Without these this panel showed the six only — so the CRM's field editor
   * linked here to manage a custom type's removed fields and landed on a page
   * that could not show them. Archived fields on a tenant-defined type were
   * unreachable, which is the one thing this screen exists to prevent.
   */
  customObjectLabels?: Record<string, string>;
};

export function CustomFieldsPanel({
  definitions,
  objectLabels,
  focusObject,
  customObjectLabels = {},
}: CustomFieldsPanelProps) {
  const [openObject, setOpenObject] = useState<string | null>(null);
  /** The field whose edit form is open, by id. One at a time. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    startTransition(async () => {
      const result = await fn();
      setFeedback({ ok: result.ok, text: result.ok ? result.message ?? "Saved." : result.error ?? "Something went wrong." });
    });
  };

  // A deep link naming a record type narrows the list to it. "Show all" is a
  // one-way local override, so navigating elsewhere in Settings (which clears
  // focusObject) widens it again on its own.
  const labels: Record<string, string> = { ...objectLabels, ...customObjectLabels };
  const allKeys: string[] = [...CUSTOM_FIELD_OBJECT_KEYS, ...Object.keys(customObjectLabels)];
  const scoped = !showAll && focusObject && allKeys.includes(focusObject) ? focusObject : null;
  const shownKeys = scoped ? [scoped] : allKeys;

  return (
    <div className="panel">
      <div className="panel-h">
        <h3>Fields by record type</h3>
        <span className="tg">{definitions.filter((d) => d.active).length} active</span>
      </div>
      <div className="panel-b">
        <p className="cxm-hint" style={{ marginBottom: 14 }}>
          Archiving a field hides it everywhere but keeps every saved value, so it can always be
          brought back.
        </p>

        {scoped && <ScopedNotice label={labels[scoped]} onShowAll={() => setShowAll(true)} />}

        {feedback && (
          <div className="cxm-statusline" role="status" style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: feedback.ok ? "var(--ok-text)" : "var(--red-text)" }}>
              {feedback.text}
            </span>
          </div>
        )}

        {shownKeys.map((objectKey) => {
          const forObject = definitions.filter((d) => d.objectKey === objectKey);
          const active = forObject.filter((d) => d.active);
          const archived = forObject.filter((d) => !d.active);

          return (
            <div key={objectKey} className="srow" style={{ display: "block" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div className="sl">
                  <div className="slt">{labels[objectKey]}</div>
                  <div className="sld">
                    {active.length === 0
                      ? "No custom fields yet"
                      : `${active.length} field${active.length === 1 ? "" : "s"}`}
                    {archived.length > 0 && ` · ${archived.length} archived`}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn sm"
                  disabled={pending}
                  onClick={() => setOpenObject(openObject === objectKey ? null : objectKey)}
                >
                  {openObject === objectKey ? "Close" : "Add field"}
                </button>
              </div>

              {(active.length > 0 || archived.length > 0) && (
                <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                  {[...active, ...archived].map((d) => (
                    <div key={d.id}>
                      <FieldRow
                        definition={d}
                        pending={pending}
                        editing={editingId === d.id}
                        onEdit={() => setEditingId(editingId === d.id ? null : d.id)}
                        onArchive={() => run(() => archiveCustomField({ fieldId: d.id, objectKey }))}
                        onRestore={() => run(() => restoreCustomField({ fieldId: d.id, objectKey }))}
                      />
                      {editingId === d.id && (
                        <FieldForm
                          // Remount per field, so opening a second one does not
                          // inherit the first one's half-typed values.
                          key={`edit-${d.id}`}
                          objectLabel={labels[objectKey]}
                          pending={pending}
                          initial={d}
                          onCancel={() => setEditingId(null)}
                          onSubmit={(input) =>
                            run(async () => {
                              const result = await updateCustomField({
                                fieldId: d.id,
                                objectKey,
                                label: input.label,
                                required: input.required,
                                options: input.options,
                                helpText: input.helpText,
                              });
                              if (result.ok) setEditingId(null);
                              return result;
                            })
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {openObject === objectKey && (
                <FieldForm
                  objectLabel={labels[objectKey]}
                  pending={pending}
                  onCancel={() => setOpenObject(null)}
                  onSubmit={(input) =>
                    run(async () => {
                      const result = await createCustomField({ ...input, objectKey });
                      if (result.ok) setOpenObject(null);
                      return result;
                    })
                  }
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FieldRow({
  definition,
  pending,
  editing,
  onEdit,
  onArchive,
  onRestore,
}: {
  definition: CustomFieldDefinition;
  pending: boolean;
  editing: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "7px 10px",
        borderRadius: 6,
        background: "var(--surface-2, rgba(255,255,255,0.02))",
        opacity: definition.active ? 1 : 0.55,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>{definition.label}</span>
          <span className="tg">{TYPE_LABELS[definition.fieldType]}</span>
          {definition.required && <span className="tg">Required</span>}
          {!definition.active && <span className="tg">Archived</span>}
        </div>
        {/* The choices, when it has any. The stored column name used to lead this
            line — an engineer's answer in the customer's settings screen, and
            the same leak as the stage keys next door (BSR-655). The type and
            required badges above already say what kind of field this is. */}
        {definition.options.length > 0 && (
          <div className="cxm-hint">{definition.options.map((o) => o.label).join(", ")}</div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {definition.active && (
          <button type="button" className="btn sm" disabled={pending} onClick={onEdit}>
            {editing ? "Close" : "Edit"}
          </button>
        )}
        {definition.active ? (
          <button type="button" className="btn sm" disabled={pending} onClick={onArchive}>
            Archive
          </button>
        ) : (
          <button type="button" className="btn sm" disabled={pending} onClick={onRestore}>
            Restore
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Add a field, or edit one that exists.
 *
 * One form for both, because they ask for the same things — and because the
 * edit half is what was missing entirely: `updateCustomField` and
 * `updateFieldDefinition` were both fully built, validated and org-scoped, and
 * had no caller anywhere in the app. A workspace could add "Referal source",
 * see the typo, and never fix it; the only recourse was to archive the field
 * and make a new one, which is not a rename — every value already saved stays
 * behind on the archived field.
 */
export function FieldForm({
  objectLabel,
  pending,
  initial,
  onCancel,
  onSubmit,
}: {
  objectLabel: string;
  pending: boolean;
  /** Present when editing. Absent when adding. */
  initial?: CustomFieldDefinition;
  onCancel: () => void;
  onSubmit: (input: {
    label: string;
    fieldType: string;
    required: boolean;
    options: string[];
    helpText: string;
  }) => void;
}) {
  const editing = !!initial;
  const [label, setLabel] = useState(initial?.label ?? "");
  const [fieldType, setFieldType] = useState<CustomFieldType>(initial?.fieldType ?? "text");
  const [required, setRequired] = useState(initial?.required ?? false);
  const [optionsText, setOptionsText] = useState((initial?.options ?? []).map((o) => o.label).join("\n"));
  const [helpText, setHelpText] = useState(initial?.helpText ?? "");

  const needsOptions = CHOICE_FIELD_TYPES.has(fieldType);
  const options = optionsText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const canSubmit = label.trim().length > 0 && (!needsOptions || options.length > 0) && !pending;

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
      <Field label={`Field name`}>
        <input
          className="inp"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={`What should this be called on ${objectLabel}?`}
          maxLength={80}
        />
      </Field>

      {/* Type is settled at creation. Changing it reinterprets every value
          already stored, so the action deliberately never sends it and the lib
          layer refuses it outright once the field has data — showing an
          editable control that silently does nothing would be worse than
          showing none. */}
      <Field label="Type" hint={editing ? "Set when the field was created." : undefined}>
        {editing ? (
          <div className="cxm-hint" style={{ paddingTop: 4 }}>{TYPE_LABELS[fieldType]}</div>
        ) : (
          <select
            className="sel"
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
          >
            {CUSTOM_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        )}
      </Field>

      {needsOptions && (
        <Field label="Choices" hint="One per line.">
          <textarea
            className="inp"
            rows={4}
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            placeholder={"Discovery\nNegotiation\nClosed"}
          />
        </Field>
      )}

      <Field label="Help text" hint="Optional. Shown under the field when filling it in.">
        <input className="inp" value={helpText} onChange={(e) => setHelpText(e.target.value)} maxLength={200} />
      </Field>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        Required
      </label>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn sm" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button
          type="button"
          className="btn sm gold"
          disabled={!canSubmit}
          onClick={() =>
            onSubmit({ label: label.trim(), fieldType, required, options, helpText: helpText.trim() })
          }
        >
          {pending ? (editing ? "Saving…" : "Adding…") : editing ? "Save changes" : "Add field"}
        </button>
      </div>
    </div>
  );
}

