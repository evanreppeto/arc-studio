"use client";

import { useState } from "react";

import { OFFICIAL_PERSONA_MAPPINGS, humanizePersonaLabel } from "@/domain";

import { Modal } from "../../_components/modal";
import { type CrmObjectKey } from "@/lib/crm/read-model";
import type { CustomFieldDefinition } from "@/domain";

export type LinkOption = { type: string; id: string; label: string };
export type PersonaOption = { key: string; label: string };

export type AddRecordValue = {
  name: string;
  persona?: string;
  status?: string;
  detail?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  /** Parent record link (leads → company/contact/property; outcomes → job/lead). */
  parentType?: string;
  parentId?: string;
  /** Tenant-defined custom fields, keyed by field key (BSR-493). */
  customFields?: Record<string, unknown>;
};

type FieldConfig = {
  nameLabel: string;
  namePlaceholder: string;
  multiline?: boolean;
  detail?: { label: string; placeholder: string; type?: string };
  /** Renders required City / State / ZIP fields (properties). */
  address?: boolean;
  /** Persona is a required DB column for this object (leads). */
  personaRequired?: boolean;
  /** A parent-record link is required (a DB check constraint enforces it). */
  link?: { label: string; empty: string };
  status: { label: string; options: string[] };
};

const FORM: Record<CrmObjectKey, FieldConfig> = {
  companies: {
    nameLabel: "Company name",
    namePlaceholder: "Acme Restoration Co.",
    detail: { label: "Website", placeholder: "https://example.com", type: "url" },
    status: { label: "Status", options: ["active", "inactive"] },
  },
  contacts: {
    nameLabel: "Full name",
    namePlaceholder: "Jane Doe",
    detail: { label: "Email", placeholder: "jane@company.com", type: "email" },
    status: { label: "Status", options: ["active", "inactive", "do_not_contact"] },
  },
  properties: {
    nameLabel: "Street address",
    namePlaceholder: "123 N Main St",
    address: true,
    status: { label: "Status", options: ["active", "inactive"] },
  },
  leads: {
    nameLabel: "Lead summary",
    namePlaceholder: "Burst supply line flooded a finished basement overnight…",
    multiline: true,
    detail: { label: "Source", placeholder: "web_form, partner_referral…" },
    personaRequired: true,
    link: { label: "Linked record", empty: "Add a company, contact, or property first" },
    status: { label: "Status", options: ["new", "needs_review", "qualified"] },
  },
  jobs: {
    nameLabel: "Job number or title",
    namePlaceholder: "BSR-2042 — Water mitigation",
    status: { label: "Status", options: ["scheduled", "in_progress", "completed"] },
  },
  outcomes: {
    nameLabel: "Outcome title",
    namePlaceholder: "Evanston fire rebuild",
    link: { label: "Linked record", empty: "Add a job or lead first" },
    status: { label: "Status", options: ["won", "lost"] },
  },
};

function titleize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function personaLabel(key: string): string {
  return humanizePersonaLabel(key);
}

export function AddRecordModal({
  open,
  objectKey,
  singular,
  linkOptions = [],
  personaOptions,
  customFieldDefs = [],
  onClose,
  onSubmit,
}: {
  open: boolean;
  objectKey: CrmObjectKey;
  singular: string;
  /** Parent records a lead/outcome can link to (built by the board from loaded rows). */
  linkOptions?: LinkOption[];
  /** The org's own personas. Falls back to the BSR demo set when not provided. */
  personaOptions?: PersonaOption[];
  /**
   * This object's custom field definitions. Collected at creation so a field the
   * tenant marked required is satisfied up front rather than leaving a record
   * that violates its own schema until someone opens it.
   */
  customFieldDefs?: CustomFieldDefinition[];
  onClose: () => void;
  /** Returns the outcome so the modal can surface an error and stay open on failure. */
  onSubmit: (value: AddRecordValue) => Promise<{ ok: boolean; error?: string }>;
}) {
  const cfg = FORM[objectKey];
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const setCustom = (key: string, value: unknown) => setCustomValues((v) => ({ ...v, [key]: value }));
  const personaChoices =
    personaOptions?.length ? personaOptions : OFFICIAL_PERSONA_MAPPINGS.map((key) => ({ key, label: personaLabel(key) }));
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [city, setCity] = useState("");
  const [stateVal, setStateVal] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [persona, setPersona] = useState("");
  const [link, setLink] = useState(""); // "type::id"
  const [status, setStatus] = useState(cfg.status.options[0]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The board remounts this component (via `key`) on each open and object
  // change, so the fields above initialize fresh — no reset effect needed.
  // Required fields mirror the DB's NOT-NULL columns and check constraints:
  // address parts for properties, a persona for leads, a parent link for
  // leads/outcomes.
  const addressOk = !cfg.address || (city.trim() && stateVal.trim() && postalCode.trim());
  const personaOk = !cfg.personaRequired || !!persona;
  const linkOk = !cfg.link || !!link;
  const canSubmit = name.trim().length > 0 && !!addressOk && personaOk && linkOk && !pending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    const [parentType, parentId] = link ? link.split("::") : [];
    const result = await onSubmit({
      name: name.trim(),
      persona: persona || undefined,
      status,
      detail: detail.trim() || undefined,
      city: city.trim() || undefined,
      state: stateVal.trim() || undefined,
      postalCode: postalCode.trim() || undefined,
      parentType: parentType || undefined,
      parentId: parentId || undefined,
      customFields: customFieldDefs.length > 0 ? customValues : undefined,
    });
    if (result.ok) {
      onClose();
    } else {
      setError(result.error ?? "Could not add the record.");
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add ${singular}`}
      description="Internal CRM record. Nothing is sent, published, or contacted — Arc only uses it to organize work."
      footer={
        <>
          <button type="button" className="mbtn" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" form="add-record-form" className="mbtn gold" disabled={!canSubmit}>
            {pending ? "Adding…" : `Add ${singular}`}
          </button>
        </>
      }
    >
      <form id="add-record-form" className="mform" onSubmit={submit}>
        <label className="mfield">
          <span className="mlabel">{cfg.nameLabel}</span>
          {cfg.multiline ? (
            <textarea
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={cfg.namePlaceholder}
              rows={3}
              required
            />
          ) : (
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={cfg.namePlaceholder} required />
          )}
        </label>

        {cfg.detail && (
          <label className="mfield">
            <span className="mlabel">
              {cfg.detail.label} <span className="mopt">optional</span>
            </span>
            <input
              type={cfg.detail.type ?? "text"}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder={cfg.detail.placeholder}
            />
          </label>
        )}

        {cfg.link && (
          <label className="mfield">
            <span className="mlabel">{cfg.link.label}</span>
            <select value={link} onChange={(e) => setLink(e.target.value)} required disabled={linkOptions.length === 0}>
              <option value="" disabled>
                {linkOptions.length === 0 ? cfg.link.empty : "Choose a record…"}
              </option>
              {linkOptions.map((o) => (
                <option key={`${o.type}::${o.id}`} value={`${o.type}::${o.id}`}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {cfg.address && (
          <div className="mrow">
            <label className="mfield">
              <span className="mlabel">City</span>
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Chicago" required />
            </label>
            <label className="mfield" style={{ maxWidth: 90 }}>
              <span className="mlabel">State</span>
              <input value={stateVal} onChange={(e) => setStateVal(e.target.value)} placeholder="IL" maxLength={2} required />
            </label>
            <label className="mfield" style={{ maxWidth: 120 }}>
              <span className="mlabel">ZIP</span>
              <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="60614" required />
            </label>
          </div>
        )}

        <div className="mrow">
          <label className="mfield">
            <span className="mlabel">
              Persona {cfg.personaRequired ? null : <span className="mopt">optional</span>}
            </span>
            <select value={persona} onChange={(e) => setPersona(e.target.value)} required={cfg.personaRequired}>
              <option value="">{cfg.personaRequired ? "Choose a persona…" : "No persona yet"}</option>
              {personaChoices.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mfield">
            <span className="mlabel">{cfg.status.label}</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {cfg.status.options.map((opt) => (
                <option key={opt} value={opt}>
                  {titleize(opt)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {customFieldDefs.map((d) => (
          <label className="mfield" key={d.id}>
            <span className="mlabel">
              {d.label} {!d.required && <span className="mopt">optional</span>}
            </span>
            {d.fieldType === "boolean" ? (
              <select
                value={customValues[d.key] === true ? "true" : customValues[d.key] === false ? "false" : ""}
                onChange={(e) =>
                  setCustom(d.key, e.target.value === "" ? null : e.target.value === "true")
                }
              >
                <option value="">—</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : d.fieldType === "select" ? (
              <select value={String(customValues[d.key] ?? "")} onChange={(e) => setCustom(d.key, e.target.value)}>
                <option value="">—</option>
                {d.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : d.fieldType === "multi_select" ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {d.options.map((o) => {
                  const sel = Array.isArray(customValues[d.key]) ? (customValues[d.key] as string[]) : [];
                  return (
                    <label key={o.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={sel.includes(o.value)}
                        onChange={(e) =>
                          setCustom(d.key, e.target.checked ? [...sel, o.value] : sel.filter((v) => v !== o.value))
                        }
                      />
                      {o.label}
                    </label>
                  );
                })}
              </div>
            ) : (
              <input
                // Not type="number" for number/currency: the domain layer strips
                // "$" and thousands separators, which a number input would drop.
                type={d.fieldType === "date" ? "date" : d.fieldType === "url" ? "url" : "text"}
                inputMode={d.fieldType === "number" || d.fieldType === "currency" ? "decimal" : undefined}
                value={String(customValues[d.key] ?? "")}
                onChange={(e) => setCustom(d.key, e.target.value)}
                placeholder={d.helpText ?? undefined}
              />
            )}
          </label>
        ))}

        {error && <div className="mError">{error}</div>}
      </form>
    </Modal>
  );
}
