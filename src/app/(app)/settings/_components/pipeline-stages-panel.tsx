"use client";

import { useState, useTransition, type ReactNode } from "react";

import {
  isPipelineObjectKey,
  orderedStages,
  PIPELINE_OBJECT_KEYS,
  type PipelineObjectKey,
  type PipelineStage,
} from "@/domain";

import { ScopedNotice } from "./scoped-notice";

import {
  archivePipelineStage,
  createPipelineStage,
  movePipelineStage,
  restorePipelineStage,
  updatePipelineStage,
} from "../pipeline-stages-actions";

/**
 * What a stage MEANS, as four mutually exclusive choices instead of four raw
 * booleans.
 *
 * The flags are what reporting reads, but "is terminal / is won / is lost" as
 * separate checkboxes invites the two combinations the validator has to refuse
 * (won and lost at once; an outcome that isn't terminal). Presenting them as one
 * question makes those unreachable rather than merely rejected.
 */
type StageKind = "open" | "won" | "lost" | "closed";

const KIND_LABELS: Record<StageKind, string> = {
  open: "Still in progress",
  won: "Closing — counts as won",
  lost: "Closing — counts as lost",
  closed: "Closing — neither won nor lost",
};

/** Compact form for the collapsed row, where the full sentence would be noise. */
const KIND_CHIPS: Record<StageKind, string | null> = {
  open: null,
  won: "Counts as won",
  lost: "Counts as lost",
  closed: "Closed",
};

const KIND_HINTS: Record<StageKind, string> = {
  open: "The record is still moving through the pipeline.",
  won: "Revenue and conversion reporting counts these.",
  lost: "Counted as a loss, not as revenue.",
  closed: "Out of the pipeline without an outcome, like archiving. Left out of conversion rate entirely.",
};

function kindOf(stage: PipelineStage): StageKind {
  if (stage.isWon) return "won";
  if (stage.isLost) return "lost";
  if (stage.isTerminal) return "closed";
  return "open";
}

function flagsFor(kind: StageKind): Pick<PipelineStage, "isTerminal" | "isWon" | "isLost"> {
  return {
    isTerminal: kind !== "open",
    isWon: kind === "won",
    isLost: kind === "lost",
  };
}

export type PipelineStagesPanelProps = {
  stagesByObject: Record<PipelineObjectKey, PipelineStage[]>;
  /** How many records sit in each stage, keyed by stage key, per object. */
  occupancyByObject: Record<PipelineObjectKey, Record<string, number>>;
  /**
   * The tenant's own word for each pipeline. A firm manages stages on "Matters",
   * not on "Jobs" — this screen must not be the one place the product reverts to
   * our internal vocabulary.
   */
  objectLabels: Record<PipelineObjectKey, string>;
  /** CRM object a deep link arrived pointing at — narrows this editor to it. */
  focusObject?: string | null;
};

export function PipelineStagesPanel({
  stagesByObject,
  occupancyByObject,
  objectLabels,
  focusObject,
}: PipelineStagesPanelProps) {
  const [openObject, setOpenObject] = useState<PipelineObjectKey | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    startTransition(async () => {
      const result = await fn();
      setFeedback({
        ok: result.ok,
        text: result.ok ? result.message ?? "Saved." : result.error ?? "Something went wrong.",
      });
    });
  };

  // A deep link naming a pipeline narrows the list to it. "Show all" is a one-way
  // local override, so navigating elsewhere in Settings (which clears
  // focusObject) widens it again on its own.
  const scoped = !showAll && focusObject && isPipelineObjectKey(focusObject) ? focusObject : null;
  const shownKeys = scoped ? [scoped] : PIPELINE_OBJECT_KEYS;

  return (
    <div className="panel">
      <div className="panel-h">
        <h3>Pipeline stages</h3>
        <span className="tg">{PIPELINE_OBJECT_KEYS.length} pipelines</span>
      </div>
      <div className="panel-b">
        <p className="cxm-hint" style={{ marginBottom: 14 }}>
          Rename these to match how your team actually works. Records store the stage, not its
          name, so renaming one carries every record with it and leaves your reporting intact.
        </p>

        {scoped && <ScopedNotice label={objectLabels[scoped]} onShowAll={() => setShowAll(true)} />}

        {feedback && (
          <div className="cxm-statusline" role="status" style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: feedback.ok ? "var(--ok-text)" : "var(--red-text)" }}>
              {feedback.text}
            </span>
          </div>
        )}

        {shownKeys.map((objectKey) => {
          const all = stagesByObject[objectKey] ?? [];
          const active = orderedStages(all);
          const archived = all.filter((s) => !s.active);
          const occupancy = occupancyByObject[objectKey] ?? {};

          return (
            <div key={objectKey} className="srow" style={{ display: "block" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div className="sl">
                  <div className="slt">{objectLabels[objectKey]}</div>
                  <div className="sld">
                    {active.length} stage{active.length === 1 ? "" : "s"}
                    {archived.length > 0 && ` · ${archived.length} archived`}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn sm"
                  disabled={pending}
                  onClick={() => setOpenObject(openObject === objectKey ? null : objectKey)}
                >
                  {openObject === objectKey ? "Close" : "Add stage"}
                </button>
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                {active.map((stage, index) => (
                  <StageRow
                    key={stage.key}
                    stage={stage}
                    objectKey={objectKey}
                    occupants={occupancy[stage.key] ?? 0}
                    moveTargets={active.filter((s) => s.key !== stage.key).map((s) => ({ key: s.key, label: s.label }))}
                    isFirst={index === 0}
                    isLast={index === active.length - 1}
                    pending={pending}
                    run={run}
                  />
                ))}
                {archived.map((stage) => (
                  <ArchivedStageRow
                    key={stage.key}
                    stage={stage}
                    occupants={occupancy[stage.key] ?? 0}
                    pending={pending}
                    onRestore={() => run(() => restorePipelineStage({ objectKey, key: stage.key }))}
                  />
                ))}
              </div>

              {openObject === objectKey && (
                <AddStageForm
                  objectLabel={objectLabels[objectKey]}
                  pending={pending}
                  onCancel={() => setOpenObject(null)}
                  onSubmit={(input) =>
                    run(async () => {
                      const result = await createPipelineStage({ ...input, objectKey });
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

type RunFn = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => void;

function StageRow({
  stage,
  objectKey,
  occupants,
  moveTargets,
  isFirst,
  isLast,
  pending,
  run,
}: {
  stage: PipelineStage;
  objectKey: PipelineObjectKey;
  occupants: number;
  moveTargets: { key: string; label: string }[];
  isFirst: boolean;
  isLast: boolean;
  pending: boolean;
  run: RunFn;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [moveTo, setMoveTo] = useState("");

  const kind = kindOf(stage);
  const chip = KIND_CHIPS[kind];

  // Draft state, so nothing is written until Save. Editing the meaning live
  // would fire a server round-trip per keystroke of intent and, worse, could
  // leave a half-changed pipeline if the second edit is the one that's refused.
  const [draftLabel, setDraftLabel] = useState(stage.label);
  const [draftKind, setDraftKind] = useState<StageKind>(kind);
  const [draftQualified, setDraftQualified] = useState(stage.isQualified);

  const openEditor = () => {
    setDraftLabel(stage.label);
    setDraftKind(kind);
    setDraftQualified(stage.isQualified);
    setEditing(true);
  };

  const dirty =
    draftLabel.trim() !== stage.label || draftKind !== kind || draftQualified !== stage.isQualified;

  return (
    <div
      style={{
        padding: "7px 10px",
        borderRadius: 6,
        background: "var(--surface-2, rgba(255,255,255,0.02))",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>{stage.label}</span>
            {chip && <span className="tg">{chip}</span>}
            {stage.isQualified && <span className="tg">Qualified</span>}
          </div>
          {/* How many records are sitting here — the one thing on this line that
              informs a decision (whether this stage is safe to archive, whether
              anyone actually uses it). This used to lead with the stored key
              (`needs_review`), which answers an engineer's question in the
              customer's settings screen and tells the owner nothing (BSR-655). */}
          <div className="cxm-hint">
            {occupants === 0 ? "No records" : `${occupants} record${occupants === 1 ? "" : "s"}`}
          </div>
        </div>

        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button
            type="button"
            className="btn sm"
            disabled={pending || isFirst}
            aria-label={`Move ${stage.label} up`}
            onClick={() => run(() => movePipelineStage({ objectKey, key: stage.key, direction: "up" }))}
          >
            ↑
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={pending || isLast}
            aria-label={`Move ${stage.label} down`}
            onClick={() => run(() => movePipelineStage({ objectKey, key: stage.key, direction: "down" }))}
          >
            ↓
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={pending}
            onClick={() => (editing ? setEditing(false) : openEditor())}
          >
            {editing ? "Close" : "Edit"}
          </button>
          <button type="button" className="btn sm" disabled={pending} onClick={() => setConfirmingArchive(true)}>
            Archive
          </button>
        </div>
      </div>

      {editing && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 6,
            border: "1px solid var(--line, rgba(255,255,255,0.08))",
            display: "grid",
            gap: 10,
          }}
        >
          <Field label="Stage name">
            <input
              className="inp"
              value={draftLabel}
              maxLength={80}
              onChange={(e) => setDraftLabel(e.target.value)}
              aria-label={`Rename ${stage.label}`}
            />
          </Field>

          <Field label="What it means" hint={KIND_HINTS[draftKind]}>
            <select
              className="sel"
              value={draftKind}
              onChange={(e) => setDraftKind(e.target.value as StageKind)}
              aria-label="What this stage means"
            >
              {(Object.keys(KIND_LABELS) as StageKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={draftQualified}
              onChange={(e) => setDraftQualified(e.target.checked)}
            />
            Past initial triage
          </label>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn sm" disabled={pending} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn sm gold"
              disabled={pending || !dirty || !draftLabel.trim()}
              onClick={() =>
                run(async () => {
                  const result = await updatePipelineStage({
                    objectKey,
                    key: stage.key,
                    label: draftLabel.trim(),
                    ...flagsFor(draftKind),
                    isQualified: draftQualified,
                  });
                  if (result.ok) setEditing(false);
                  return result;
                })
              }
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {confirmingArchive && (
        <ArchiveConfirm
          stage={stage}
          occupants={occupants}
          targets={moveTargets}
          moveTo={moveTo}
          setMoveTo={setMoveTo}
          pending={pending}
          onCancel={() => {
            setConfirmingArchive(false);
            setMoveTo("");
          }}
          onConfirm={() =>
            run(async () => {
              const result = await archivePipelineStage({
                objectKey,
                key: stage.key,
                moveToKey: occupants > 0 ? moveTo : undefined,
              });
              if (result.ok) {
                setConfirmingArchive(false);
                setMoveTo("");
              }
              return result;
            })
          }
        />
      )}
    </div>
  );
}

/**
 * The archive gate.
 *
 * An occupied stage cannot be archived without saying where its records go —
 * the picker has no "leave them" option on purpose. A record whose status maps
 * to no stage renders blank and disappears from every filter, and it does that
 * quietly, which is precisely the class of failure this feature is meant to
 * stop introducing.
 */
function ArchiveConfirm({
  stage,
  occupants,
  targets,
  moveTo,
  setMoveTo,
  pending,
  onCancel,
  onConfirm,
}: {
  stage: PipelineStage;
  occupants: number;
  targets: { key: string; label: string }[];
  moveTo: string;
  setMoveTo: (value: string) => void;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const needsTarget = occupants > 0;
  const canConfirm = !pending && (!needsTarget || Boolean(moveTo));

  return (
    <div
      style={{
        marginTop: 10,
        padding: 10,
        borderRadius: 6,
        border: "1px solid var(--line, rgba(255,255,255,0.08))",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 13 }}>
        {needsTarget
          ? `${occupants} record${occupants === 1 ? "" : "s"} still sit in "${stage.label}".`
          : `Archive "${stage.label}"? Nothing is in it, and you can restore it later.`}
      </div>
      {needsTarget && (
        <>
          <div className="cxm-hint">
            They need somewhere to go — a record left in an archived stage shows no status and
            drops out of your filters.
          </div>
          <select className="sel" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            <option value="">Move them to…</option>
            {targets.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn sm" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button type="button" className="btn sm gold" disabled={!canConfirm} onClick={onConfirm}>
          {pending ? "Archiving…" : needsTarget ? "Move and archive" : "Archive"}
        </button>
      </div>
    </div>
  );
}

function ArchivedStageRow({
  stage,
  occupants,
  pending,
  onRestore,
}: {
  stage: PipelineStage;
  occupants: number;
  pending: boolean;
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
        opacity: 0.55,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <span>{stage.label}</span>
          <span className="tg">Archived</span>
        </div>
        {/* An archived stage should hold nothing. If it does, say so plainly —
            those records are the ones rendering blank right now. Nothing to say
            when it is empty, so the line goes away rather than standing there
            printing the stored key at someone. */}
        {occupants > 0 && (
          <div className="cxm-hint">
            {occupants} record{occupants === 1 ? "" : "s"} still here
          </div>
        )}
      </div>
      <button type="button" className="btn sm" disabled={pending} onClick={onRestore}>
        Restore
      </button>
    </div>
  );
}

function AddStageForm({
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
    isTerminal: boolean;
    isWon: boolean;
    isLost: boolean;
    isQualified: boolean;
  }) => void;
}) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<StageKind>("open");
  const [qualified, setQualified] = useState(false);

  const canSubmit = label.trim().length > 0 && !pending;

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
      <Field label="Stage name">
        <input
          className="inp"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={`What's the next step for ${objectLabel}?`}
          maxLength={80}
        />
      </Field>

      <Field label="What it means" hint={KIND_HINTS[kind]}>
        <select className="sel" value={kind} onChange={(e) => setKind(e.target.value as StageKind)}>
          {(Object.keys(KIND_LABELS) as StageKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </Field>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={qualified} onChange={(e) => setQualified(e.target.checked)} />
        Past initial triage
      </label>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn sm" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button
          type="button"
          className="btn sm gold"
          disabled={!canSubmit}
          onClick={() => onSubmit({ label: label.trim(), ...flagsFor(kind), isQualified: qualified })}
        >
          {pending ? "Adding…" : "Add stage"}
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
