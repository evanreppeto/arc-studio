"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { CustomFieldEntry } from "@/lib/custom-fields/values";

import { archiveCustomObjectRecords } from "../../../actions";
import { CustomFieldsSection } from "./custom-fields-section";

/**
 * A record of a tenant-defined object type.
 *
 * Its own view rather than RecordView, which is built around the six: persona,
 * lifecycle status, lead score, relationship graph, at-a-glance panel. A custom
 * object has none of those — its shape IS its custom fields — so reusing that
 * component would render a page of empty panels with headings the object does
 * not have.
 */
function initials(label: string): string {
  return (
    (label || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?"
  );
}

export function CustomRecordView({
  objectKey,
  objectLabel,
  singularLabel,
  crmLabel,
  record,
  customFields,
}: {
  objectKey: string;
  objectLabel: string;
  singularLabel: string;
  /** The workspace's own word for its CRM, for the back link. */
  crmLabel: string;
  record: { id: string; title: string; subtitle: string | null; updatedAt: string; archivedAt: string | null };
  customFields: CustomFieldEntry[];
}) {
  const router = useRouter();
  const [archiving, setArchiving] = useState(false);

  const archive = async () => {
    if (!window.confirm(`Archive ${record.title}?\n\nIt leaves your lists and counts. Nothing is deleted — you can restore it from Archived.`)) {
      return;
    }
    setArchiving(true);
    const res = await archiveCustomObjectRecords(objectKey, [record.id]);
    if (!res.ok) {
      setArchiving(false);
      window.alert(res.error);
      return;
    }
    router.push("/crm");
  };

  return (
    // Same chrome as a built-in record — .arc-record owns the height chain and
    // the scroll region, so borrowing the classes rather than inventing new
    // ones is what keeps this page scrollable at all.
    <div className="arc-record arc-grid">
      <div className="recband">
        <Link className="back" href="/crm">
          <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
          Back to {crmLabel}
        </Link>
        <div className="idrow">
          <span className="bigav">{initials(record.title)}</span>
          <div className="idmain">
            <h2 className="rname">{record.title}</h2>
            <div className="rrole">
              {record.subtitle ? `${record.subtitle} · ` : ""}
              {singularLabel} in {objectLabel}
            </div>
            {record.archivedAt && (
              // Reached by URL after archiving, this page would otherwise look
              // completely ordinary while being in no list at all.
              <div className="idchips">
                <span className="chip">Archived — not in your lists</span>
              </div>
            )}
          </div>
          <div className="idactions">
            <button type="button" className="gbtn gbtn-danger" disabled={archiving} onClick={archive}>
              {archiving ? "Archiving…" : "Archive"}
            </button>
          </div>
        </div>
      </div>

      <div className="recbody">
        <div className="recscroll">
          {/* Everything this object tracks IS a custom field, so this section is
              not a supplement the way it is on the six — it is the record. */}
          <CustomFieldsSection objectKey={objectKey} recordId={record.id} entries={customFields} />
        </div>
      </div>
    </div>
  );
}
