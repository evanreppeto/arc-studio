"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import type { CustomFieldEntry } from "@/lib/custom-fields/values";

import { saveRecordCustomFields } from "../actions";

/**
 * The tenant's own fields on a record, rendered beside the built-in Details.
 *
 * Unfilled fields are shown, not hidden: a tenant defined this schema, so a
 * record that silently omitted the empty ones would make their own field set
 * look like it changes from record to record.
 */
export function CustomFieldsSection({
  entries,
  objectKey,
  recordId,
}: {
  entries: CustomFieldEntry[];
  objectKey: string;
  recordId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Where the fields for this record type are defined. Scoped to this object so
  // the editor opens on the right row of a six-object list.
  const manageHref = `/settings?s=records&t=Fields&o=${encodeURIComponent(objectKey)}`;

  // No fields defined yet. This used to render nothing at all, which hid the one
  // screen that could fix it from the exact moment someone wants it — "this
  // record should track X" is how a custom field gets asked for.
  if (entries.length === 0) {
    return (
      <div className="sec">
        <h3 className="sh">Custom fields</h3>
        <p className="cf-empty">
          None defined for this record type yet.{" "}
          <Link href={manageHref}>Add one</Link>
        </p>
      </div>
    );
  }

  const startEdit = () => {
    const seed: Record<string, unknown> = {};
    for (const e of entries) seed[e.definition.key] = e.value ?? (e.definition.fieldType === "multi_select" ? [] : "");
    setDraft(seed);
    setError(null);
    setEditing(true);
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveRecordCustomFields({ objectKey, recordId, values: draft });
      if (result.ok) {
        setEditing(false);
        return;
      }
      // Surface the field-level reason rather than a generic failure — the
      // domain layer already produced a message naming the field.
      setError(result.error);
    });
  };

  return (
    <div className="sec">
      <h3 className="sh">
        Custom fields
        {!editing && (
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
            {/* Edit changes this record's values; Manage changes which fields
                exist for every record of this type. Different blast radius, so
                they read differently — one button, one quiet link. */}
            <Link className="cf-manage" href={manageHref}>
              Manage fields
            </Link>
            <button type="button" className="btn sm" onClick={startEdit}>
              Edit
            </button>
          </span>
        )}
      </h3>

      {error && (
        <div style={{ fontSize: 12, color: "var(--red-text)", marginBottom: 10 }} role="status">
          {error}
        </div>
      )}

      {!editing ? (
        <div className="fields">
          {entries.map((e) => (
            <div className="fld" key={e.definition.id}>
              <div className="fl">{e.definition.label}</div>
              <div className="fv">{e.display || "—"}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {entries.map((e) => (
            <CustomFieldInput
              key={e.definition.id}
              entry={e}
              value={draft[e.definition.key]}
              onChange={(v) => setDraft((d) => ({ ...d, [e.definition.key]: v }))}
            />
          ))}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn sm" disabled={pending} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" className="btn sm gold" disabled={pending} onClick={save}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CustomFieldInput({
  entry,
  value,
  onChange,
}: {
  entry: CustomFieldEntry;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { definition } = entry;
  const label = (
    <div className="fl">
      {definition.label}
      {definition.required && <span style={{ color: "var(--red-text)" }}> *</span>}
    </div>
  );

  const help = definition.helpText ? (
    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>{definition.helpText}</div>
  ) : null;

  const common = { className: "inp", value: String(value ?? "") };

  let control: React.ReactNode;
  switch (definition.fieldType) {
    case "boolean":
      control = (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={value === true} onChange={(ev) => onChange(ev.target.checked)} />
          Yes
        </label>
      );
      break;

    case "select":
      control = (
        <select className="sel" value={String(value ?? "")} onChange={(ev) => onChange(ev.target.value)}>
          <option value="">—</option>
          {definition.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;

    case "multi_select": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      control = (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {definition.options.map((o) => (
            <label key={o.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={(ev) =>
                  onChange(
                    ev.target.checked
                      ? [...selected, o.value]
                      : selected.filter((v) => v !== o.value),
                  )
                }
              />
              {o.label}
            </label>
          ))}
        </div>
      );
      break;
    }

    case "date":
      control = <input {...common} type="date" onChange={(ev) => onChange(ev.target.value)} />;
      break;

    case "number":
    case "currency":
      // `inputMode` rather than type="number": the domain layer already strips
      // "$" and thousands separators, and a number input would silently discard
      // them before we ever saw the value.
      control = <input {...common} inputMode="decimal" onChange={(ev) => onChange(ev.target.value)} />;
      break;

    case "url":
      control = <input {...common} type="url" placeholder="https://" onChange={(ev) => onChange(ev.target.value)} />;
      break;

    default:
      control = <input {...common} onChange={(ev) => onChange(ev.target.value)} />;
  }

  return (
    <div>
      {label}
      {control}
      {help}
    </div>
  );
}
