"use client";

import { useState, useTransition, type ReactNode } from "react";

import {
  CHOICE_FIELD_TYPES,
  CUSTOM_FIELD_OBJECT_KEYS,
  CUSTOM_FIELD_TYPES,
  type CustomFieldDefinition,
  type CustomFieldObjectKey,
  type CustomFieldType,
} from "@/domain";

import {
  archiveCustomField,
  createCustomField,
  restoreCustomField,
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
  objectLabels: Record<CustomFieldObjectKey, string>;
};

export function CustomFieldsPanel({ definitions, objectLabels }: CustomFieldsPanelProps) {
  const [openObject, setOpenObject] = useState<CustomFieldObjectKey | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    startTransition(async () => {
      const result = await fn();
      setFeedback({ ok: result.ok, text: result.ok ? result.message ?? "Saved." : result.error ?? "Something went wrong." });
    });
  };

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

        {feedback && (
          <div className="cxm-statusline" role="status" style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: feedback.ok ? "var(--ok-text)" : "var(--red-text)" }}>
              {feedback.text}
            </span>
          </div>
        )}

        {CUSTOM_FIELD_OBJECT_KEYS.map((objectKey) => {
          const forObject = definitions.filter((d) => d.objectKey === objectKey);
          const active = forObject.filter((d) => d.active);
          const archived = forObject.filter((d) => !d.active);

          return (
            <div key={objectKey} className="srow" style={{ display: "block" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div className="sl">
                  <div className="slt">{objectLabels[objectKey]}</div>
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
                    <FieldRow
                      key={d.id}
                      definition={d}
                      pending={pending}
                      onArchive={() => run(() => archiveCustomField({ fieldId: d.id, objectKey }))}
                      onRestore={() => run(() => restoreCustomField({ fieldId: d.id, objectKey }))}
                    />
                  ))}
                </div>
              )}

              {openObject === objectKey && (
                <AddFieldForm
                  objectLabel={objectLabels[objectKey]}
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
  onArchive,
  onRestore,
}: {
  definition: CustomFieldDefinition;
  pending: boolean;
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
        <div className="cxm-hint">
          {definition.key}
          {definition.options.length > 0 && ` · ${definition.options.map((o) => o.label).join(", ")}`}
        </div>
      </div>
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
  );
}

function AddFieldForm({
  objectLabel,
  pending,
  onCancel,
  onSubmit,
}: {
  objectLabel: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    label: string;
    fieldType: string;
    required: boolean;
    options: string[];
    helpText: string;
  }) => void;
}) {
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>("text");
  const [required, setRequired] = useState(false);
  const [optionsText, setOptionsText] = useState("");
  const [helpText, setHelpText] = useState("");

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

      <Field label="Type">
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
          {pending ? "Adding…" : "Add field"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="cxm-label">{label}</div>
      {children}
      {hint && (
        <div className="cxm-hint" style={{ marginTop: 4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}
