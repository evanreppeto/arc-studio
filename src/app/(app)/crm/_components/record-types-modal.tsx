"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { CustomObject } from "@/domain";

import { Modal } from "../../_components/modal";
import { ObjectTypeForm } from "../../settings/_components/object-types-panel";
import {
  archiveObjectType,
  createObjectType,
  renameObjectType,
  restoreObjectType,
} from "../../settings/custom-objects-actions";

/**
 * Add, rename and remove the workspace's own record types without leaving the
 * CRM.
 *
 * These were manageable only from Settings — so adding the thing your business
 * actually tracks meant leaving the screen that shows what you track, finding
 * the right settings tab, and coming back. The tabs are here; the control that
 * creates a tab belongs here too. Same argument that moved the field editor
 * into the Columns menu next door.
 *
 * The form is the settings screen's own component, not a copy.
 *
 * The six built-ins are deliberately absent: they are tables, they cannot be
 * removed, and listing them beside a Remove button would say otherwise.
 */
export function RecordTypesModal({
  open,
  onClose,
  objects,
}: {
  open: boolean;
  onClose: () => void;
  /** The tenant's own types, active and archived, as the server rendered them. */
  objects: CustomObject[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    startTransition(async () => {
      const result = await fn();
      setFeedback({
        ok: result.ok,
        text: result.ok ? result.message ?? "Saved." : result.error ?? "Something went wrong.",
      });
      if (result.ok) {
        setAdding(false);
        setEditingId(null);
        // The actions revalidate /crm, but this component holds the old list as
        // props — without a refresh the new type never appears as a tab, which
        // reads as the save having failed.
        router.refresh();
      }
    });
  };

  const active = objects.filter((o) => o.active);
  const archived = objects.filter((o) => !o.active);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Your record types"
      description="Track something the built-in tabs don't cover — equipment, subcontractors, permits. Each one becomes a tab here with its own records and its own fields."
      width={560}
    >
      {/* Carries the field editor's primitives (.btn/.inp/.cxm-*). Without it
          the shared form falls through to the app's gold button and Archive
          renders as the loudest thing in the dialog — the bug settings.css
          already caused once on this route, which never loads that sheet. */}
      <div className="arc-fieldkit">
        {feedback && (
          <div
            role="status"
            style={{
              marginBottom: 12,
              fontSize: 12,
              color: feedback.ok ? "var(--ok-text)" : "var(--red-text)",
            }}
          >
            {feedback.text}
          </div>
        )}

        {active.length === 0 && archived.length === 0 && !adding && (
          <p className="cxm-hint" style={{ marginBottom: 12 }}>
            You haven&rsquo;t added any record types of your own yet.
          </p>
        )}

        <div style={{ display: "grid", gap: 6 }}>
          {[...active, ...archived].map((o) => (
            <div key={o.id}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: "var(--inset)",
                  opacity: o.active ? 1 : 0.55,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span>{o.labelPlural}</span>
                    <span className="tg">one: {o.labelSingular}</span>
                    {!o.active && <span className="tg">Archived</span>}
                  </div>
                  {o.description && <div className="cxm-hint">{o.description}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {o.active && (
                    <button
                      type="button"
                      className="btn sm"
                      disabled={pending}
                      onClick={() => {
                        setAdding(false);
                        setEditingId(editingId === o.id ? null : o.id);
                      }}
                    >
                      {editingId === o.id ? "Close" : "Rename"}
                    </button>
                  )}
                  {o.active ? (
                    <button
                      type="button"
                      className="btn sm"
                      disabled={pending}
                      onClick={() => run(() => archiveObjectType({ objectId: o.id }))}
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn sm"
                      disabled={pending}
                      onClick={() => run(() => restoreObjectType({ objectId: o.id }))}
                    >
                      Restore
                    </button>
                  )}
                </div>
              </div>
              {editingId === o.id && (
                <ObjectTypeForm
                  key={`edit-${o.id}`}
                  pending={pending}
                  initial={o}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(v) =>
                    run(() =>
                      renameObjectType({
                        objectId: o.id,
                        labelPlural: v.labelPlural,
                        labelSingular: v.labelSingular,
                        description: v.description,
                      }),
                    )
                  }
                />
              )}
            </div>
          ))}
        </div>

        {adding ? (
          <ObjectTypeForm
            pending={pending}
            onCancel={() => setAdding(false)}
            onSubmit={(v) => run(() => createObjectType(v))}
          />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginTop: 12,
            }}
          >
            <button
              type="button"
              className="btn sm gold"
              disabled={pending}
              onClick={() => {
                setEditingId(null);
                setAdding(true);
              }}
            >
              Add record type
            </button>
            {/* Removing keeps every record — it archives the type rather than
                dropping it, which is why this can be offered inline. */}
            <Link className="cxm-hint" href="/settings?s=records&t=Types">
              Removing keeps its records &middot; manage in Settings
            </Link>
          </div>
        )}
      </div>
    </Modal>
  );
}
