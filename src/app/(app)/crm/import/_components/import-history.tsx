"use client";

import { useState } from "react";

import { type ImportRunSummary } from "@/lib/import-runs/read-model";

import { reverseImportRunAction } from "../actions";

const SOURCE_LABELS: Record<string, string> = {
  csv: "CSV",
  hubspot: "HubSpot",
  mailchimp: "Mailchimp",
  salesforce: "Salesforce",
  pipedrive: "Pipedrive",
  jobber: "Jobber",
  google_contacts: "Google Contacts",
};

function when(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Past imports, and undo (BSR-643).
 *
 * Import is meant to be an any-time capability, not a one-shot onboarding step —
 * people get a new list, clean up their old CRM, or realise they mapped a column
 * wrong. That only works if a run is visible and reversible, which is what this
 * section is for.
 */
export function ImportHistory({ runs }: { runs: ImportRunSummary[] }) {
  const [pending, setPending] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (runs.length === 0) {
    return (
      <p className="imp-hint">
        No imports yet. Once you run one it appears here with what it changed — and can be undone.
      </p>
    );
  }

  async function undo(id: string) {
    setPending(id);
    setResult(null);
    const res = await reverseImportRunAction({ importRunId: id });
    setPending(null);
    setResult({ id, text: res.ok ? res.message : res.error, ok: res.ok });
  }

  return (
    <ul className="imp-runs">
      {runs.map((run) => (
        <li key={run.id} className="imp-run" data-reversed={Boolean(run.reversedAt)}>
          <div className="imp-run-main">
            <div>
              <b>{SOURCE_LABELS[run.source] ?? run.source}</b>
              <span className="imp-run-when">
                {when(run.startedAt)}
                {run.operator ? ` · ${run.operator}` : ""}
              </span>
            </div>
            <div className="imp-run-counts">
              <span>{run.imported} new</span>
              <span>{run.updated} updated</span>
              {run.skipped > 0 && <span className="imp-run-skip">{run.skipped} skipped</span>}
              {run.reversedAt && <span className="imp-run-tag">undone</span>}
            </div>
          </div>

          <div className="imp-run-side">
            {run.errors.length > 0 && (
              <button
                type="button"
                className="imp-linkbtn"
                onClick={() => setExpanded(expanded === run.id ? null : run.id)}
              >
                {run.errors.length} row{run.errors.length === 1 ? "" : "s"} not imported
              </button>
            )}
            {run.reversible ? (
              <button type="button" className="btn sm" disabled={pending !== null} onClick={() => void undo(run.id)}>
                {pending === run.id ? "Undoing…" : "Undo"}
              </button>
            ) : (
              // Say why, rather than showing a greyed-out button that reads as a
              // bug. An honest limit is easier to accept than a mystery.
              <span className="imp-hint imp-run-blocked">{run.blockedReason}</span>
            )}
          </div>

          {expanded === run.id && (
            <ul className="imp-errs">
              {run.errors.slice(0, 30).map((e, i) => (
                <li key={`${e.externalId}-${i}`}>
                  <code>{e.externalId}</code> {e.message}
                </li>
              ))}
              {run.errors.length > 30 && <li>…and {run.errors.length - 30} more.</li>}
            </ul>
          )}

          {result?.id === run.id && (
            <p className={result.ok ? "imp-note" : "imp-err"} role="status">{result.text}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
