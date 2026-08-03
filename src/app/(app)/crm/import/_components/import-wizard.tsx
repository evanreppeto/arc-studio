"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { type CsvColumnOverrides, type CsvField } from "@/domain";

import { commitCsvImportAction, previewCsvImportAction } from "../actions";
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
export function ImportWizard({ ready }: { ready: boolean }) {
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [overrides, setOverrides] = useState<CsvColumnOverrides>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
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
    setDone(null);
    setError(null);
  }, []);

  async function runPreview(nextOverrides = overrides) {
    setPending("preview");
    setError(null);
    setDone(null);
    const res = await previewCsvImportAction({ csvText, columnOverrides: nextOverrides });
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
    const res = await commitCsvImportAction({ csvText, columnOverrides: overrides });
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

  return (
    <>
      <section className="imp-step" data-done={hasData}>
        <div className="imp-step-h">
          <span className="imp-step-n">1</span>
          <h2>Choose your file</h2>
          {fileName && <span className="imp-sub">{fileName}</span>}
        </div>
        <div className="imp-step-b">
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

              {preview.unmappedColumns.length > 0 && (
                <p className="imp-note">
                  Not importing: {preview.unmappedColumns.join(", ")}. These are dropped for now — map any you
                  need above.
                </p>
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
