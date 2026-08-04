"use client";

import { useMemo, useState, useTransition } from "react";

import { OBJECT_LABEL_MAX_LENGTH } from "@/domain";
import type { CrmObjectLanguage, ProductLanguageObjectKey } from "@/lib/product-language";

import { saveObjectLabelSettings } from "../actions";

const OBJECT_KEYS: ProductLanguageObjectKey[] = [
  "companies",
  "contacts",
  "properties",
  "leads",
  "jobs",
  "outcomes",
];

/**
 * What each object holds, so an operator renaming it knows which one it is.
 * Deliberately describes the RECORD, not the table — "properties" means nothing
 * to a law firm, which is the whole reason this panel exists.
 */
const OBJECT_HINTS: Record<ProductLanguageObjectKey, string> = {
  companies: "Organizations you work with.",
  contacts: "Individual people.",
  properties: "Places or accounts the work attaches to.",
  leads: "Inbound interest, before it becomes work.",
  jobs: "The work itself, once it is under way.",
  outcomes: "How the work finished.",
};

type Draft = { plural: string; singular: string };

export type ObjectLabelsPanelProps = {
  /** The industry defaults, already resolved — shown as placeholders. */
  industryLabels: Record<ProductLanguageObjectKey, CrmObjectLanguage>;
  /** The industry's own section name, e.g. "Relationships". */
  industrySection: string;
  /** What the workspace has already saved. */
  savedSection: string;
  savedObjects: Partial<Record<ProductLanguageObjectKey, Draft>>;
};

export function ObjectLabelsPanel({
  industryLabels,
  industrySection,
  savedSection,
  savedObjects,
}: ObjectLabelsPanelProps) {
  const [section, setSection] = useState(savedSection);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      OBJECT_KEYS.map((key) => [key, { plural: savedObjects[key]?.plural ?? "", singular: savedObjects[key]?.singular ?? "" }]),
    ),
  );
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (key: string, field: keyof Draft, value: string) =>
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));

  // Both forms or neither. Flagged inline rather than rejected on save, because
  // the save silently drops the partial — the operator would otherwise type a
  // name, see "Saved.", and find the old word still on screen.
  const incomplete = useMemo(
    () => OBJECT_KEYS.filter((key) => {
      const d = drafts[key];
      return Boolean(d.plural.trim()) !== Boolean(d.singular.trim());
    }),
    [drafts],
  );

  const renamedCount = OBJECT_KEYS.filter((k) => drafts[k].plural.trim() && drafts[k].singular.trim()).length;

  function save() {
    setFeedback(null);
    startTransition(async () => {
      const result = await saveObjectLabelSettings({ section, objects: drafts });
      if (!result.ok) {
        setFeedback({ ok: false, text: result.error ?? "Could not save object names." });
        return;
      }
      setFeedback({
        ok: true,
        text: result.persisted ? "Saved." : "Not saved — this workspace has no database configured.",
      });
    });
  }

  return (
    <div className="panel">
      <div className="panel-h">
        <h3>Object names</h3>
        <span className="tg">
          {renamedCount === 0 ? "Using industry names" : `${renamedCount} renamed`}
        </span>
      </div>
      <div className="panel-b">
        <p className="cxm-hint" style={{ marginBottom: 14 }}>
          Your industry sets these names by default. Rename any that are close but wrong — a law
          firm calling places &ldquo;Matters&rdquo;. Records are stored by type, not by name, so a
          rename carries every existing record with it. Leave a pair blank to go back to the
          industry name.
        </p>

        {feedback && (
          <div className="cxm-statusline" role="status" style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: feedback.ok ? "var(--ok-text)" : "var(--red-text)" }}>
              {feedback.text}
            </span>
          </div>
        )}

        <div className="srow" style={{ display: "block" }}>
          <div className="sl" style={{ marginBottom: 8 }}>
            <div className="slt">Section name</div>
            <div className="sld">What this whole area is called in the sidebar.</div>
          </div>
          <input
            className="inp"
            value={section}
            maxLength={OBJECT_LABEL_MAX_LENGTH}
            placeholder={industrySection}
            onChange={(e) => setSection(e.target.value)}
            aria-label="Section name"
          />
        </div>

        {OBJECT_KEYS.map((key) => {
          const industry = industryLabels[key];
          const isIncomplete = incomplete.includes(key);
          return (
            <div key={key} className="srow" style={{ display: "block" }}>
              <div className="sl" style={{ marginBottom: 8 }}>
                <div className="slt">{industry.label}</div>
                <div className="sld">{OBJECT_HINTS[key]}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div className="cxm-label">Plural</div>
                  <input
                    className="inp"
                    value={drafts[key].plural}
                    maxLength={OBJECT_LABEL_MAX_LENGTH}
                    placeholder={industry.label}
                    onChange={(e) => set(key, "plural", e.target.value)}
                    aria-label={`Plural name for ${industry.label}`}
                  />
                </div>
                <div>
                  <div className="cxm-label">Singular</div>
                  <input
                    className="inp"
                    value={drafts[key].singular}
                    maxLength={OBJECT_LABEL_MAX_LENGTH}
                    placeholder={industry.singular}
                    onChange={(e) => set(key, "singular", e.target.value)}
                    aria-label={`Singular name for ${industry.label}`}
                  />
                </div>
              </div>
              {isIncomplete && (
                <div className="cxm-hint" style={{ marginTop: 6, color: "var(--red-text)" }}>
                  Needs both forms — one on its own would leave the button and the tab using
                  different words. This row will keep its current name until both are filled in.
                </div>
              )}
            </div>
          );
        })}

        <div style={{ marginTop: 14 }}>
          <button type="button" className="gbtn gold" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save object names"}
          </button>
        </div>
      </div>
    </div>
  );
}
