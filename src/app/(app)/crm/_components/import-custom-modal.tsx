"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Modal } from "../../_components/modal";
import { importCustomObjectRecords, planCustomObjectImport } from "../actions";
import type { CustomImportPlan } from "@/lib/custom-objects/import";

/**
 * CSV import for a tenant-defined record type.
 *
 * Not the wizard at /crm/import: that one imports a fixed company -> contact ->
 * property -> lead bundle, a shape with nothing to say about "Equipment". A
 * custom object is a name plus whatever its owner defined, so the mapping is
 * one question — which column is the name — and every other column becomes a
 * field.
 *
 * Always previews before writing. Importing provisions FIELDS as well as
 * records, which changes the tenant's schema and is tedious to undo by hand, so
 * the operator sees what will be created before any of it is.
 */
export function ImportCustomModal({
  open,
  onClose,
  objectKey,
  objectLabel,
  singular,
}: {
  open: boolean;
  onClose: () => void;
  objectKey: string;
  objectLabel: string;
  singular: string;
}) {
  const router = useRouter();
  const [csvText, setCsvText] = useState("");
  const [plan, setPlan] = useState<CustomImportPlan | null>(null);
  const [titleHeader, setTitleHeader] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ created: number; skipped: number; fieldsCreated: string[] } | null>(null);

  const reset = () => {
    setCsvText("");
    setPlan(null);
    setTitleHeader(undefined);
    setError(null);
    setDone(null);
  };

  const preview = async (text: string, header?: string) => {
    setError(null);
    setBusy(true);
    const res = await planCustomObjectImport({ objectKey, csvText: text, titleHeader: header });
    setBusy(false);
    if (!res.ok) {
      setPlan(null);
      setError(res.error);
      return;
    }
    setPlan(res.plan);
    setTitleHeader(res.plan.titleHeader);
  };

  const onFile = async (file: File) => {
    const text = await file.text();
    setCsvText(text);
  };

  /**
   * Preview as the text changes, not on blur.
   *
   * On blur, someone who pastes and goes straight for Import meets a disabled
   * button with nothing explaining why — the plan is what enables it, and the
   * plan had not been asked for. Debounced because each keystroke would
   * otherwise be a round trip.
   */
  useEffect(() => {
    // Only SCHEDULES. Clearing a stale plan happens in the change handler,
    // where it belongs: setting state synchronously in an effect body can
    // cascade renders, and eslint's react-hooks rule fails the build for it.
    if (!csvText.trim()) return;
    const timer = setTimeout(() => { void preview(csvText, titleHeader); }, 350);
    return () => clearTimeout(timer);
    // `titleHeader` is deliberately absent: choosing a name column re-previews
    // through its own handler, and listing it here would re-run on the state
    // that preview itself sets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvText]);

  const run = async () => {
    setBusy(true);
    setError(null);
    const res = await importCustomObjectRecords({ objectKey, csvText, titleHeader });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone({ created: res.created, skipped: res.skipped, fieldsCreated: res.fieldsCreated });
    router.refresh();
  };

  const headers = plan ? [plan.titleHeader, ...plan.fields.map((f) => f.header)] : [];

  return (
    <Modal
      open={open}
      onClose={() => { onClose(); reset(); }}
      title={`Import ${objectLabel.toLowerCase()}`}
      description={`One column becomes the ${singular.toLowerCase()}'s name. Every other column becomes a field on it.`}
      width={560}
    >
      <div className="arc-fieldkit" style={{ display: "grid", gap: 12 }}>
        {done ? (
          <>
            <p style={{ fontSize: 13, margin: 0 }}>
              Added <strong>{done.created}</strong> {done.created === 1 ? singular.toLowerCase() : objectLabel.toLowerCase()}.
              {done.skipped > 0 && ` ${done.skipped} row${done.skipped === 1 ? "" : "s"} had no name and ${done.skipped === 1 ? "was" : "were"} skipped.`}
            </p>
            {done.fieldsCreated.length > 0 && (
              <p className="cxm-hint" style={{ margin: 0 }}>
                New fields: {done.fieldsCreated.join(", ")}. Edit them in the Columns menu.
              </p>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btn sm gold" onClick={() => { onClose(); reset(); }}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="cxm-label">CSV file</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onFile(file);
                }}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span className="cxm-label">…or paste it</span>
              <textarea
                className="inp"
                rows={4}
                value={csvText}
                onChange={(e) => {
                  const next = e.target.value;
                  setCsvText(next);
                  // Emptying the box should drop the plan it produced, or the
                  // Import button stays enabled over text that is gone.
                  if (!next.trim()) { setPlan(null); setError(null); }
                }}
                placeholder={"Name,Serial number,Condition\nExtractor #3,X-1183,In service"}
              />
            </label>

            {plan && (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  <span className="cxm-label">Which column is the name?</span>
                  <select
                    className="sel"
                    value={titleHeader}
                    onChange={(e) => { setTitleHeader(e.target.value); void preview(csvText, e.target.value); }}
                  >
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>

                {/* What will be created, before it is. Provisioning fields
                    changes the tenant's schema; discovering that afterwards is
                    the part that is tedious to undo. */}
                <p className="cxm-hint" style={{ margin: 0 }}>
                  {plan.rowCount} row{plan.rowCount === 1 ? "" : "s"}
                  {plan.unnamedRows > 0 && `, ${plan.unnamedRows} with no name (skipped)`}
                  {plan.fields.length > 0 && ` · ${plan.fields.length} column${plan.fields.length === 1 ? "" : "s"} become fields: ${plan.fields.map((f) => f.label).join(", ")}`}
                </p>

                {plan.sample.length > 0 && (
                  <div style={{ display: "grid", gap: 4 }}>
                    {plan.sample.map((row, i) => (
                      <div key={i} style={{ fontSize: 12, color: "var(--text-2)" }}>
                        <strong>{row.title || "(no name — skipped)"}</strong>
                        {Object.entries(row.values).filter(([, v]) => v).length > 0 && (
                          <span className="cxm-hint">
                            {" "}
                            · {Object.entries(row.values).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {error && (
              <div role="alert" style={{ fontSize: 12, color: "var(--red-text)" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn sm" onClick={() => { onClose(); reset(); }} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn sm gold" onClick={run} disabled={busy || !plan}>
                {busy ? "Working…" : plan ? `Import ${plan.rowCount - plan.unnamedRows}` : "Import"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
