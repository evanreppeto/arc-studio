"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";

import {
  CUSTOM_FIELD_TYPES,
  IMPORT_PRESETS,
  type CsvColumnOverrides,
  type CsvField,
  type CustomFieldType,
  type ImportEntityKind,
  type ImportPresetKey,
} from "@/domain";
import { type AcceptedCustomField } from "@/lib/import-runs/custom-fields";

import { commitCsvImportAction, importEntityAction, previewCsvImportAction } from "../actions";
import { MAPPABLE_FIELDS, type ImportPreview } from "./types";

/**
 * Upload → map → preview → commit (BSR-642).
 *
 * The three steps stay visible rather than replacing one another: the operator is
 * about to write to their own customer list, and hiding what comes next is exactly
 * the anxiety this surface exists to remove.
 *
 * The preview and the commit call the SAME engine path, differing only by
 * `dryRun`. A preview built on a second parser would eventually disagree with the
 * import, which is worse than no preview.
 */
/** What a file is being imported AS. "contacts" is the original engine. */
type ImportKind = "contacts" | ImportEntityKind;

const KINDS: Array<{ kind: ImportKind; label: string; hint: string }> = [
  { kind: "contacts", label: "Contacts", hint: "People — becomes a lead with a contact and company attached" },
  { kind: "companies", label: "Companies", hint: "Accounts and organizations" },
  { kind: "deals", label: "Deals", hint: "Jobs and opportunities, attached to a company by its id" },
  { kind: "notes", label: "Notes", hint: "Attached to a contact or company by its id" },
];

export function ImportWizard({ ready }: { ready: boolean }) {
  const [kind, setKind] = useState<ImportKind>("contacts");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [overrides, setOverrides] = useState<CsvColumnOverrides>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  /** Unmapped columns the operator has chosen to keep, by header. */
  const [keepFields, setKeepFields] = useState<Record<string, CustomFieldType | null>>({});
  /** Which product's export this is. Null = generic aliases only (BSR-646). */
  const [preset, setPreset] = useState<ImportPresetKey>("generic");
  const [pending, setPending] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const hasData = csvText.trim().length > 0;

  const loadFile = useCallback(async (file: File) => {
    const text = await file.text();
    setCsvText(text);
    setFileName(file.name);
    setPreview(null);
    setOverrides({});
    setKeepFields({});
    setDone(null);
    setError(null);
  }, []);

  async function runPreview(nextOverrides = overrides, nextPreset: ImportPresetKey = preset) {
    setPending("preview");
    setError(null);
    setDone(null);
    const res =
      kind === "contacts"
        ? await previewCsvImportAction({ csvText, columnOverrides: nextOverrides, preset: nextPreset })
        : ((await importEntityAction({ kind, csvText, columnOverrides: nextOverrides, dryRun: true })) as
            | { ok: true; preview: ImportPreview }
            | { ok: false; error: string });
    setPending(null);
    if (!res.ok) {
      setError(res.error);
      setPreview(null);
      return;
    }
    setPreview(res.preview);
  }

  async function commit() {
    setPending("commit");
    setError(null);
    const res =
      kind === "contacts"
        ? await commitCsvImportAction({ csvText, columnOverrides: overrides, customFields: acceptedFields(), preset })
        : ((await importEntityAction({ kind, csvText, columnOverrides: overrides })) as
            | { ok: true; message: string }
            | { ok: false; error: string });
    setPending(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(res.message);
    setPreview(null);
    setCsvText("");
    setFileName(null);
    setOverrides({});
  }

  function changeMapping(header: string, value: string) {
    const next: CsvColumnOverrides = { ...overrides, [header]: value === "" ? null : (value as CsvField) };
    setOverrides(next);
    // Re-resolve immediately. A mapping change that does not move the numbers is
    // the clearest possible signal that the correction did not do what the
    // operator expected.
    void runPreview(next);
  }

  /** Which field a header is currently mapped to, override or detection. */
  const fieldFor = useMemo(() => {
    return (header: string): string => {
      if (header in overrides) return overrides[header] ?? "";
      const hit = Object.entries(preview?.mappedColumns ?? {}).find(([, h]) => h === header);
      return hit ? hit[0] : "";
    };
  }, [overrides, preview]);

  const dateMapped = Boolean(preview && preview.mappedColumns.lastContactedAt);

  /** The kept columns, in the shape the action provisions from. */
  function acceptedFields(): AcceptedCustomField[] {
    if (!preview) return [];
    return preview.suggestedFields
      .filter((f) => keepFields[f.label] !== undefined && keepFields[f.label] !== null)
      .map((f) => ({
        header: preview.unmappedColumns.find((h) => h === f.label) ?? f.label,
        key: f.key,
        label: f.label,
        fieldType: keepFields[f.label] as CustomFieldType,
        options: f.options,
      }));
  }

  return (
    <>
      <section className="imp-step" data-done={hasData}>
        <div className="imp-step-h">
          <span className="imp-step-n">1</span>
          <h2>Choose your file</h2>
          {fileName && <span className="imp-sub">{fileName}</span>}
        </div>
        <div className="imp-step-b">
          {/* Order matters and the copy says so: a deal cannot attach to a company
              that has not been imported yet, and the engine reports rather than
              guesses when a reference does not resolve. */}
          <div className="imp-kinds" role="group" aria-label="What is in this file">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                className="imp-kind"
                data-on={kind === k.kind}
                title={k.hint}
                onClick={() => { setKind(k.kind); setPreview(null); setOverrides({}); setKeepFields({}); setDone(null); setError(null); }}
              >
                {k.label}
              </button>
            ))}
          </div>
          <p className="imp-kind-hint">{KINDS.find((k) => k.kind === kind)?.hint}</p>

          <label
            className="imp-drop"
            data-over={dragOver}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void loadFile(file);
            }}
          >
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,text/csv,text/plain"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void loadFile(file);
              }}
            />
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
            <b>Drop a CSV here, or click to choose one</b>
            <span>Exported from HubSpot, Salesforce, Jobber, a spreadsheet — anything with a header row</span>
          </label>

          <p className="imp-or">or paste it</p>
          <textarea
            className="imp-paste"
            rows={4}
            spellCheck={false}
            value={csvText}
            placeholder={"name,email,company,last contacted\nJordan Vega,jordan@acme.com,Acme Restoration,2026-01-15"}
            onChange={(e) => { setCsvText(e.target.value); setFileName(null); setPreview(null); setDone(null); }}
          />

          <div className="imp-actions">
            <button
              type="button"
              className="btn sm gold"
              disabled={!ready || !hasData || pending !== null}
              onClick={() => void runPreview()}
            >
              {pending === "preview" ? "Reading…" : "Read the file"}
            </button>
            {!ready && (
              <span className="imp-hint">
                Set a default persona in{" "}
                <Link href="/settings?s=connections&c=csv-import">Settings → Connections</Link> first.
              </span>
            )}
          </div>
          {error && <p className="imp-err">{error}</p>}
          {done && <p className="imp-note">{done} <Link href="/crm">View your records</Link>.</p>}
        </div>
      </section>

      <section className="imp-step" data-idle={!preview} data-done={Boolean(preview)}>
        <div className="imp-step-h">
          <span className="imp-step-n">2</span>
          <h2>Check the columns</h2>
          {preview && <span className="imp-sub">{preview.headers.length} columns found</span>}
        </div>
        <div className="imp-step-b">
          {!preview ? (
            <p className="imp-hint">Read a file above and its columns will appear here to confirm.</p>
          ) : (
            <>
              {/* Detection SUGGESTS; applying is the operator's click. Silently
                  applying a guessed preset is how a file gets mis-mapped with
                  nobody able to see why. */}
              {preview.detectedPreset && preset === "generic" && (
                <div className="imp-detected">
                  This looks like a{" "}
                  <b>{IMPORT_PRESETS.find((p) => p.key === preview.detectedPreset)?.label}</b> export.
                  <button
                    type="button"
                    className="imp-linkbtn"
                    onClick={() => {
                      const next = preview.detectedPreset as ImportPresetKey;
                      setPreset(next);
                      void runPreview(overrides, next);
                    }}
                  >
                    Use its column names
                  </button>
                </div>
              )}

              <div className="imp-source">
                <label htmlFor="imp-source-select">Came from</label>
                <select
                  id="imp-source-select"
                  value={preset}
                  onChange={(e) => {
                    const next = e.target.value as ImportPresetKey;
                    setPreset(next);
                    void runPreview(overrides, next);
                  }}
                >
                  <option value="generic">Something else / a spreadsheet</option>
                  {IMPORT_PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              </div>

              <div className="imp-scroll">
                <table className="imp-map">
                  <thead>
                    <tr>
                      <th>Column in your file</th>
                      <th>Imports as</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.headers.map((header) => {
                      const value = fieldFor(header);
                      return (
                        <tr key={header}>
                          <td className="imp-col">{header}</td>
                          <td>
                            <select
                              value={value}
                              data-dropped={value === ""}
                              onChange={(e) => changeMapping(header, e.target.value)}
                              aria-label={`Import the ${header} column as`}
                            >
                              <option value="">Don&apos;t import</option>
                              {MAPPABLE_FIELDS.map((f) => (
                                <option key={f.field} value={f.field}>{f.label}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* The single most valuable column in a CRM export. Without it every
                  imported lead is "received today", cold-lead detection cannot fire
                  for 30 days, and a freshly-imported workspace stares at an empty
                  Opportunities screen. Worth interrupting for. */}
              {!dateMapped && (
                <div className="imp-warn">
                  No <b>last contacted</b> column is mapped. Every lead will import as brand new, so nothing
                  will look overdue for 30 days. If your export has a last-activity or last-contacted date,
                  map it above.
                </div>
              )}

              {preview.suggestedFields.length > 0 && (
                <div className="imp-extra">
                  <div className="imp-extra-h">
                    Columns we don&apos;t have a home for
                    <span>Keep one and it becomes a field on your records. Otherwise it isn&apos;t imported.</span>
                  </div>
                  <table className="imp-map">
                    <tbody>
                      {preview.suggestedFields.map((f) => {
                        const chosen = keepFields[f.label] ?? null;
                        return (
                          <tr key={f.key}>
                            <td className="imp-col">
                              {f.label}
                              {f.samples.length > 0 && <span className="imp-samples">{f.samples.join(" · ")}</span>}
                              {/* The guess, visible without opening the dropdown.
                                  A suggestion nobody can see is not a suggestion —
                                  but it stays a suggestion: nothing is kept unless
                                  the operator chooses to keep it. */}
                              <span className="imp-samples">looks like {f.fieldType.replace("_", " ")}</span>
                            </td>
                            <td>
                              <select
                                value={chosen ?? ""}
                                data-dropped={chosen === null}
                                aria-label={`Keep the ${f.label} column as`}
                                onChange={(e) =>
                                  setKeepFields((k) => ({
                                    ...k,
                                    [f.label]: e.target.value ? (e.target.value as CustomFieldType) : null,
                                  }))
                                }
                              >
                                <option value="">Don&apos;t import</option>
                                {CUSTOM_FIELD_TYPES.map((t) => (
                                  <option key={t} value={t}>
                                    Keep as {t.replace("_", " ")}
                                    {t === f.fieldType ? " (suggested)" : ""}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="imp-step" data-idle={!preview}>
        <div className="imp-step-h">
          <span className="imp-step-n">3</span>
          <h2>Review, then import</h2>
          {preview && <span className="imp-sub">nothing has been written yet</span>}
        </div>
        <div className="imp-step-b">
          {!preview ? (
            <p className="imp-hint">A summary of exactly what will change appears here before anything is written.</p>
          ) : (
            <>
              <div className="imp-counts">
                <div className="imp-count" data-tone="create">
                  <b>{preview.willCreate.toLocaleString()}</b>
                  <span>new records</span>
                </div>
                <div className="imp-count">
                  <b>{preview.willUpdate.toLocaleString()}</b>
                  <span>updated, not duplicated</span>
                </div>
                <div className="imp-count" data-tone="skip">
                  <b>{preview.willSkip.toLocaleString()}</b>
                  <span>skipped</span>
                </div>
                <div className="imp-count">
                  <b>{preview.totalRows.toLocaleString()}</b>
                  <span>rows in the file</span>
                </div>
              </div>

              {preview.sample.length > 0 && (
                <div className="imp-scroll">
                  <table className="imp-sample">
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Company</th>
                        <th>Last contacted</th>
                        <th>Why skipped</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.map((row) => (
                        <tr key={row.externalId}>
                          <td><span className="imp-tag" data-a={row.action}>{row.action}</span></td>
                          <td>{row.name ?? "—"}</td>
                          <td>{row.email ?? "—"}</td>
                          <td>{row.company ?? "—"}</td>
                          <td>{row.lastContactedAt ? row.lastContactedAt.slice(0, 10) : "—"}</td>
                          <td>{row.reason ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="imp-note">
                Showing the first {preview.sample.length} of {preview.totalRows.toLocaleString()} rows. Importing
                again later updates these records rather than duplicating them.
              </p>

              <div className="imp-actions">
                <button type="button" className="btn sm gold" disabled={pending !== null} onClick={() => void commit()}>
                  {pending === "commit"
                    ? "Importing…"
                    : `Import ${(preview.willCreate + preview.willUpdate).toLocaleString()} records`}
                </button>
                <span className="imp-hint">Nothing leaves your workspace — importing never contacts anyone.</span>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
