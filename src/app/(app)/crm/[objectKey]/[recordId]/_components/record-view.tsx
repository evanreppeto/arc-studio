"use client";

import Link from "next/link";
import { KpiStrip } from "../../../../_components/kpi-strip";
import { useState, useTransition } from "react";

import { humanizePersonaLabel } from "@/domain";
import { type CrmRecordData, type CrmRecordGraphNode, type CrmRecordRelationship } from "@/lib/crm/read-model";
import { type NoteEntry, type TaskEntry, type TimelineEntry } from "@/lib/interactions/read-model";

import { addRecordNote, addRecordTask, completeRecordTask, reopenRecordTask, setRecordNotePinned, updateCrmRecord } from "../actions";
import { EditRecordModal } from "./edit-record-modal";
import type { CustomFieldEntry } from "@/lib/custom-fields/values";

import { CustomFieldsSection } from "./custom-fields-section";

export type RecordActivity = {
  timeline: TimelineEntry[];
  notes: NoteEntry[];
  tasks: TaskEntry[];
};

const svg = (d: string, cls?: string) => <svg viewBox="0 0 24 24" className={cls} dangerouslySetInnerHTML={{ __html: d }} />;

const ARC_IC = '<path d="M4 7h16M4 12h10M4 17h7"/>';
const CHECK_IC = '<path d="M5 12l4 4L19 6"/>';
const NOTE_IC = '<path d="M5 5h14v11l-4 4H5z"/>';

// Timeline dot colour keys off the activity kind (record.css: .tdot.note/.task/.email/.ai/.status).
function dotClass(kind: TimelineEntry["activityType"]): string {
  if (kind === "note_added" || kind === "file_added") return "note";
  if (kind === "task_created" || kind === "task_completed") return "task";
  if (kind === "email_logged" || kind === "call_logged" || kind === "sms_logged" || kind === "meeting_logged") return "email";
  if (kind === "ai_recommendation") return "ai";
  return "status";
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${fmtDate(iso)} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
function taskMeta(t: TaskEntry): string {
  const parts: string[] = [];
  if (t.status === "completed") parts.push("Completed");
  else if (t.urgency === "overdue") parts.push("Overdue");
  else if (t.dueAt) parts.push(`Due ${fmtDate(t.dueAt)}`);
  if (t.assigneeLabel) parts.push(t.assigneeLabel);
  return parts.join(" · ");
}

// Icons + colors per related-record kind, so the connection rows and the graph
// read as a real typed graph rather than generic links.
const KIND_ICON: Record<string, string> = {
  company: '<path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6"/>',
  contact: '<circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/>',
  property: '<path d="M3 21h18M5 21V7l7-4 7 4v14M10 21v-5h4v5"/>',
  lead: '<path d="M12 3l2.5 5 5.5.8-4 4 1 5.5L12 21l-5-2.7 1-5.5-4-4 5.5-.8z"/>',
  job: '<path d="M9 11l3 3 8-8M4 12v7a1 1 0 001 1h14"/>',
  outcome: '<path d="M5 12l4 4L19 6"/>',
  self: '<circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/>',
};
const KIND_COLOR: Record<string, string> = {
  self: "#c8a24a",
  company: "#7fb89a",
  contact: "#c8a24a",
  property: "#88b6d8",
  lead: "#88b6d8",
  job: "#8fa2ba",
  outcome: "#7fb89a",
};

function humanizePersona(persona: string): string {
  const label = humanizePersonaLabel(persona);
  return /^unassigned/i.test(label) ? "" : label;
}

// Read-model persona values arrive as "Persona Plumbing Partner"; the chip and
// at-a-glance already humanize, so do the same for the metric/field surfaces.
function cleanValue(label: string, value: string): string {
  return label === "Persona" ? humanizePersona(value) || value : value;
}

function formatMaybeDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function kindFromLabel(label: string): keyof typeof KIND_ICON {
  const l = label.toLowerCase();
  if (/company|account|partner/.test(l)) return "company";
  if (/contact|person/.test(l)) return "contact";
  if (/asset|property|address/.test(l)) return "property";
  if (/lead|inquiry|request/.test(l)) return "lead";
  if (/project|job/.test(l)) return "job";
  if (/outcome|revenue|won|deal/.test(l)) return "outcome";
  return "contact";
}

function initials(label: string): string {
  return (label || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

function ConnRow({ rel }: { rel: CrmRecordRelationship }) {
  const kind = kindFromLabel(rel.label);
  return (
    <Link className="connrow" href={rel.href}>
      <span className="ci">{svg(KIND_ICON[kind])}</span>
      <div style={{ minWidth: 0 }}>
        <div className="cn">{rel.value}</div>
        <div className="cd">{rel.label}</div>
      </div>
      <span className="go">→</span>
    </Link>
  );
}

// Radial layout: self in the centre, related records evenly around it. Works for
// any number of relationships instead of the mockup's fixed 7 positions.
function layoutGraph(nodes: CrmRecordGraphNode[]) {
  const W = 360;
  const H = 188;
  const cx = W / 2;
  const cy = H / 2;
  const others = nodes.slice(1);
  const radius = Math.min(cx, cy) - 34;
  return nodes.map((n, i) => {
    if (i === 0) return { node: n, x: cx, y: cy, r: 23, center: true };
    const angle = (2 * Math.PI * (i - 1)) / Math.max(others.length, 1) - Math.PI / 2;
    return { node: n, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), r: 15, center: false };
  });
}

function RelationshipGraph({ nodes }: { nodes: CrmRecordGraphNode[] }) {
  if (nodes.length < 2) {
    return <p className="empty-note">No connected records yet. Arc links companies, contacts, leads, jobs, and outcomes as they relate.</p>;
  }
  const laid = layoutGraph(nodes);
  const center = laid[0];
  return (
    <div className="relgraph">
      <svg viewBox="0 0 360 188" fill="none">
        {laid.slice(1).map((p, i) => (
          <line key={`l${i}`} x1={center.x} y1={center.y} x2={p.x} y2={p.y} stroke="rgba(232,224,205,.16)" strokeWidth={1} />
        ))}
        {laid.map((p, i) => {
          const color = KIND_COLOR[p.node.kind] ?? "var(--muted)";
          const body = (
            <g style={{ cursor: p.node.href ? "pointer" : "default" }}>
              <circle cx={p.x} cy={p.y} r={p.r} fill={p.center ? "rgba(200,162,74,.18)" : "var(--inset)"} stroke={color} strokeWidth={p.center ? 2 : 1.4} />
              <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontFamily="var(--mono)" fontSize={p.center ? 12 : 9} fill={p.center ? "#ecd596" : "var(--text-2)"} fontWeight={600}>
                {initials(p.node.label)}
              </text>
              <text x={p.x} y={p.y + p.r + 11} textAnchor="middle" fontFamily="var(--font-sans, sans-serif)" fontSize={8} fill="var(--muted)">
                {p.node.kind === "self" ? "This record" : p.node.kind.charAt(0).toUpperCase() + p.node.kind.slice(1)}
              </text>
            </g>
          );
          return p.node.href ? (
            <a key={`n${i}`} href={p.node.href}>
              {body}
            </a>
          ) : (
            <g key={`n${i}`}>{body}</g>
          );
        })}
      </svg>
    </div>
  );
}

const TABS = [
  ["overview", "Overview", '<path d="M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z"/>'],
  ["activity", "Activity", '<path d="M3 12h4l2 6 4-14 2 8h6"/>'],
  ["intel", "Intelligence", '<path d="M12 4a4 4 0 00-4 4 3 3 0 00-1 6 3 3 0 003 3 3 3 0 006 0 3 3 0 003-3 3 3 0 00-1-6 4 4 0 00-4-4z"/>'],
  ["related", "Related", '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7.5 8l3 8M16.5 8l-3 8"/>'],
] as const;

export function RecordView({
  record,
  activity,
  personaOptions,
  stageOptions,
  crmLabel = "Relationships",
  customFields = [],
}: {
  record: CrmRecordData;
  activity: RecordActivity;
  /** This workspace's own fields for this object, with this record's values. */
  customFields?: CustomFieldEntry[];
  /** The org's own personas for the edit picker. */
  personaOptions?: { key: string; label: string }[];
  /** The org's own pipeline stages, in its own words. Absent for non-pipeline objects. */
  stageOptions?: { key: string; label: string }[];
  /**
   * What this workspace calls its CRM — "Matters" for a law firm, "Accounts"
   * for an agency. The nav rail has always used the tenant's own word; this
   * back-link said "CRM" regardless, so the two disagreed on every record page.
   * "CRM" is also developer jargon, which DESIGN.md bans in primary UI.
   */
  crmLabel?: string;
}) {
  const [tab, setTab] = useState<string>("overview");
  const [actView, setActView] = useState<"timeline" | "tasks" | "notes">("timeline");
  const persona = humanizePersona(record.persona);
  const relCount = record.relationships.length;

  // Editable header fields (persona / status) held locally so an edit reflects
  // instantly; a real write also revalidates the server render.
  const [editOpen, setEditOpen] = useState(false);
  const [dispPersona, setDispPersona] = useState(persona);
  const [dispStatus, setDispStatus] = useState(record.lifecycleStatus);

  const handleEdit = async (value: { persona?: string; status?: string }): Promise<{ ok: boolean; error?: string }> => {
    const res = await updateCrmRecord(record.key, record.id, value);
    if (res.ok) {
      if (value.persona) setDispPersona(value.persona.replace(/^persona_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
      if (value.status) setDispStatus(value.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
    }
    return res;
  };

  // Activity is locally owned so operator adds appear instantly; the server
  // action persists (prod) or reports unpersisted (offline/demo). On failure we
  // revert the optimistic item and surface the error.
  const [timeline, setTimeline] = useState<TimelineEntry[]>(activity.timeline);
  const [notes, setNotes] = useState<NoteEntry[]>(activity.notes);
  const [tasks, setTasks] = useState<TaskEntry[]>(activity.tasks);
  const [noteText, setNoteText] = useState("");
  const [taskText, setTaskText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const tempId = () => `local-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

  function submitNote() {
    const body = noteText.trim();
    if (!body || pending) return;
    setErr(null);
    const now = new Date().toISOString();
    const optimistic: NoteEntry = { id: tempId(), body, isPinned: false, isInternal: true, actorKind: "human", actorLabel: "You", createdAt: now };
    const companion: TimelineEntry = { id: tempId(), activityType: "note_added", tone: "blue", summary: "Note added", detail: body.slice(0, 280), actorKind: "human", actorLabel: "You", occurredAt: now };
    setNotes((n) => [optimistic, ...n]);
    setTimeline((t) => [companion, ...t]);
    setNoteText("");
    startTransition(async () => {
      const res = await addRecordNote(record.key, record.id, body);
      if (!res.ok) {
        setNotes((n) => n.filter((x) => x.id !== optimistic.id));
        setTimeline((t) => t.filter((x) => x.id !== companion.id));
        setErr(res.error);
      } else if (res.id) {
        // Reconcile the temp id with the persisted one so later edits hit the real row.
        setNotes((n) => n.map((x) => (x.id === optimistic.id ? { ...x, id: res.id! } : x)));
      }
    });
  }

  function submitTask() {
    const title = taskText.trim();
    if (!title || pending) return;
    setErr(null);
    const now = new Date().toISOString();
    const optimistic: TaskEntry = { id: tempId(), title, description: null, dueAt: null, priority: "normal", status: "open", urgency: "none", assigneeLabel: "You", actorKind: "human", actorLabel: "You", createdAt: now };
    const companion: TimelineEntry = { id: tempId(), activityType: "task_created", tone: "amber", summary: `Task created: ${title}`, detail: null, actorKind: "human", actorLabel: "You", occurredAt: now };
    setTasks((t) => [optimistic, ...t]);
    setTimeline((t) => [companion, ...t]);
    setTaskText("");
    startTransition(async () => {
      const res = await addRecordTask(record.key, record.id, title);
      if (!res.ok) {
        setTasks((t) => t.filter((x) => x.id !== optimistic.id));
        setTimeline((t) => t.filter((x) => x.id !== companion.id));
        setErr(res.error);
      } else if (res.id) {
        // Reconcile the temp id with the persisted one so "complete" hits the real row.
        setTasks((t) => t.map((x) => (x.id === optimistic.id ? { ...x, id: res.id! } : x)));
      }
    });
  }

  function complete(task: TaskEntry) {
    if (task.status === "completed" || pending) return;
    setErr(null);
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, status: "completed", urgency: "none" } : t)));
    startTransition(async () => {
      const res = await completeRecordTask(record.key, record.id, task.id);
      if (!res.ok) {
        setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, status: task.status, urgency: task.urgency } : t)));
        setErr(res.error);
      }
    });
  }

  // Undo a completed task. Urgency is recomputed by the server on revalidate; the
  // optimistic flip just reopens it so the checkbox reads as a real toggle.
  function reopen(task: TaskEntry) {
    if (task.status !== "completed" || pending) return;
    setErr(null);
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, status: "open" } : t)));
    startTransition(async () => {
      const res = await reopenRecordTask(record.key, record.id, task.id);
      if (!res.ok) {
        setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, status: task.status } : t)));
        setErr(res.error);
      }
    });
  }

  function togglePin(note: NoteEntry) {
    if (pending) return;
    setErr(null);
    const next = !note.isPinned;
    // Optimistic: flip pinned now; pinned notes float to the top of the list.
    setNotes((ns) => {
      const updated = ns.map((n) => (n.id === note.id ? { ...n, isPinned: next } : n));
      return [...updated].sort((a, b) => Number(b.isPinned) - Number(a.isPinned));
    });
    startTransition(async () => {
      const res = await setRecordNotePinned(record.key, record.id, note.id, next);
      if (!res.ok) {
        setNotes((ns) => ns.map((n) => (n.id === note.id ? { ...n, isPinned: note.isPinned } : n)));
        setErr(res.error);
      }
    });
  }

  const tabCount: Record<string, number> = { activity: timeline.length, related: relCount };

  // Group related records by kind for the Related tab.
  const groups = record.relationships.reduce<Record<string, CrmRecordRelationship[]>>((acc, rel) => {
    const kind = kindFromLabel(rel.label);
    (acc[kind] ??= []).push(rel);
    return acc;
  }, {});

  return (
    <div className="arc-record">
      <div className="recband">
        <Link className="back" href="/crm">
          {svg('<path d="M15 5l-7 7 7 7"/>')}
          Back to {crmLabel}
        </Link>
        <div className="idrow">
          <span className="bigav">{initials(record.name)}</span>
          <div className="idmain">
            <h2 className="rname">{record.name}</h2>
            {record.detail && <div className="rrole">{record.detail}</div>}
            <div className="idchips">
              {dispPersona && (
                <span className="chip persona">
                  <span className="pgd" />
                  {dispPersona}
                </span>
              )}
              {dispStatus && (
                <span className="pill active">
                  <span className="pd" />
                  {dispStatus}
                </span>
              )}
              <span className="chip ghost">
                {svg('<circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/>', "gi")}
                {record.origin === "agent" ? "Created by Arc" : `Owner · ${record.owner || "Unassigned"}`}
              </span>
            </div>
          </div>
          <div className="idactions">
            <button type="button" className="gbtn" onClick={() => setEditOpen(true)}>
              {svg('<path d="M4 20h4L18 10l-4-4L4 16z"/><path d="M13 5l4 4"/>')}
              Edit
            </button>
            <a className="gbtn gold" href="/arc">
              {svg(ARC_IC)}
              Draft outreach
            </a>
          </div>
        </div>
        {record.headerMetrics.length > 0 && (
          <div className="mstrip">
            {record.headerMetrics.map((m) => (
              <div className="mcell" key={m.label}>
                <div className="ml">{m.label}</div>
                <div className="mv">
                  {cleanValue(m.label, m.value)}
                  {m.hint && <span className="md">{m.hint}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rectabs">
        {TABS.map((t) => (
          <div key={t[0]} className={`rectab${tab === t[0] ? " on" : ""}`} onClick={() => setTab(t[0])}>
            {svg(t[2])}
            {t[1]}
            {tabCount[t[0]] > 0 && <span className="cnt">{tabCount[t[0]]}</span>}
          </div>
        ))}
      </div>

      <div className="recbody">
        <div className="recscroll">
          {tab === "overview" && (
            <div>
              <div className="sec">
                <h3 className="sh">Details</h3>
                <div className="fields">
                  {record.fields.map((f) => (
                    <div className="fld" key={f.label}>
                      <div className="fl">{f.label}</div>
                      <div className="fv">{cleanValue(f.label, f.value)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <CustomFieldsSection
                entries={customFields}
                objectKey={record.key}
                recordId={record.id}
              />

              {(record.nextBestAction || record.cta || record.messageAngle) && (
                <div className="sec">
                  <div className="nba">
                    <div className="nl">
                      Next best action <span className="est">Arc estimate</span>
                    </div>
                    {record.nextBestAction && (
                      <div className="nrow">
                        <b>Recommendation:</b> {record.nextBestAction}
                      </div>
                    )}
                    {record.cta && (
                      <div className="nrow">
                        <b>Recommended CTA:</b> {record.cta}
                      </div>
                    )}
                    {record.messageAngle && (
                      <div className="nrow">
                        <b>Message angle:</b> {record.messageAngle}
                      </div>
                    )}
                    {record.proofPoints.length > 0 && (
                      <div className="nrow">
                        <b>Proof points:</b> {record.proofPoints.join(" · ")}
                      </div>
                    )}
                    <div className="nbtns">
                      <a className="gbtn gold" href="/arc">
                        {svg(ARC_IC)}
                        Draft outreach with Arc
                      </a>
                    </div>
                  </div>
                </div>
              )}

              <div className="sec">
                <h3 className="sh">Connected records</h3>
                {relCount === 0 ? (
                  <p className="empty-note">No connected records yet.</p>
                ) : (
                  record.relationships.map((rel) => <ConnRow key={rel.href} rel={rel} />)
                )}
              </div>
            </div>
          )}

          {tab === "activity" && (
            <div>
              <div className="tabsmini">
                {(["timeline", "tasks", "notes"] as const).map((m) => (
                  <span key={m} className={`tabmini${actView === m ? " on" : ""}`} onClick={() => setActView(m)}>
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </span>
                ))}
              </div>

              {err && (
                <p className="empty-note" style={{ color: "var(--red-text)" }}>
                  {err}
                </p>
              )}

              {actView === "timeline" &&
                (timeline.length === 0 ? (
                  <p className="empty-note">No activity logged yet. Notes, tasks, emails, and Arc&apos;s actions on this record appear here.</p>
                ) : (
                  <div>
                    {timeline.map((e) => (
                      <div className="tev" key={e.id}>
                        <span className={`tdot ${dotClass(e.activityType)}`} />
                        <div>
                          <div className="tt">
                            {e.summary} <span className="by">· {e.actorLabel}</span>
                          </div>
                          {e.detail && <div className="td">{e.detail}</div>}
                          <div className="tts">{fmtDateTime(e.occurredAt)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}

              {actView === "tasks" && (
                <div>
                  {tasks.length === 0 ? (
                    <p className="empty-note">No follow-up tasks yet.</p>
                  ) : (
                    tasks.map((t) => (
                      <div className={`trow${t.status === "completed" ? " done" : ""}`} key={t.id}>
                        <span
                          className={`tcheck${t.status === "completed" ? " done" : ""}`}
                          role="button"
                          title={t.status === "completed" ? "Reopen task" : "Mark complete"}
                          aria-label={t.status === "completed" ? "Reopen task" : "Mark complete"}
                          onClick={() => (t.status === "completed" ? reopen(t) : complete(t))}
                        >
                          {svg(CHECK_IC)}
                        </span>
                        <div style={{ flex: 1 }}>
                          <div className="tx">{t.title}</div>
                          <div className="tm">
                            {(t.priority === "high" || t.priority === "urgent") && (
                              <span className="prio high">{t.priority === "urgent" ? "Urgent" : "High"}</span>
                            )}
                            {taskMeta(t)}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  <form className="quickadd" onSubmit={(e) => { e.preventDefault(); submitTask(); }}>
                    <input value={taskText} onChange={(e) => setTaskText(e.target.value)} placeholder="Add a follow-up task…" disabled={pending} />
                    <button type="submit" className="qb" disabled={pending || !taskText.trim()} aria-label="Add task">
                      {svg('<path d="M12 5v14M5 12h14"/>')}
                    </button>
                  </form>
                </div>
              )}

              {actView === "notes" && (
                <div>
                  {notes.length === 0 ? (
                    <p className="empty-note">No notes yet.</p>
                  ) : (
                    notes.map((n) => (
                      <div className={`trow${n.isPinned ? " is-pinned" : ""}`} key={n.id}>
                        <span className="tcheck" style={{ border: "none", background: n.isPinned ? "var(--accent-soft)" : "var(--inset)" }}>
                          <svg viewBox="0 0 24 24" style={{ opacity: 1, stroke: n.isPinned ? "var(--accent)" : "var(--muted)" }} dangerouslySetInnerHTML={{ __html: NOTE_IC }} />
                        </span>
                        <div style={{ flex: 1 }}>
                          <div className="tx">
                            {n.isPinned && <b>Pinned · </b>}
                            {n.body}
                          </div>
                          <div className="tm">
                            {n.actorLabel} · {fmtDate(n.createdAt)}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="npin"
                          aria-pressed={n.isPinned}
                          title={n.isPinned ? "Unpin note" : "Pin note"}
                          onClick={() => togglePin(n)}
                          disabled={pending}
                        >
                          {svg('<path d="M9 3h6l-1 6 3 3v2h-4v6l-1 1-1-1v-6H6v-2l3-3z"/>')}
                        </button>
                      </div>
                    ))
                  )}
                  <form className="quickadd" onSubmit={(e) => { e.preventDefault(); submitNote(); }}>
                    <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Write a note…" disabled={pending} />
                    <button type="submit" className="qb" disabled={pending || !noteText.trim()} aria-label="Add note">
                      {svg('<path d="M12 5v14M5 12h14"/>')}
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}

          {tab === "intel" && (
            <div>
              <div className="sec">
                <h3 className="sh">
                  Persona intelligence <span className="est">Arc estimate</span>
                </h3>
                <div className="card">
                  <div className="pdetail">
                    <div className="pline">
                      <span className="pk">Primary persona</span>
                      <span className="pv">
                        <b>{persona || "Unassigned"}</b>
                        {record.attentionReason ? ` — ${record.attentionReason}` : ""}
                      </span>
                    </div>
                    {record.confidence && (
                      <div className="pline">
                        <span className="pk">Confidence</span>
                        <span className="pv">
                          <b>{record.confidence}</b> <span className="tinytag est">Arc estimate</span>
                        </span>
                      </div>
                    )}
                    {record.journeyStage && (
                      <div className="pline">
                        <span className="pk">Journey stage</span>
                        <span className="pv">
                          <b>{record.journeyStage}</b>
                        </span>
                      </div>
                    )}
                    {record.urgency && (
                      <div className="pline">
                        <span className="pk">Urgency</span>
                        <span className="pv">
                          <b>{record.urgency}</b>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {record.scoreBars.length > 0 && (
                <div className="sec">
                  <h3 className="sh">Scores</h3>
                  <div className="scards">
                    {record.scoreBars.map((s) => (
                      <div className="scard" key={s.label}>
                        <div className="sl">{s.label}</div>
                        <div className="srow">
                          <span className="sv">{s.value ?? "—"}</span>
                        </div>
                        {s.value != null && (
                          <div className="conftrack" style={{ marginTop: 8 }}>
                            <i style={{ width: `${Math.min(100, Math.round((s.value / (s.max ?? 100)) * 100))}%` }} />
                          </div>
                        )}
                        {s.caption && <div className="sd">{s.caption}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {record.engagement.length > 0 && (
                <div className="sec">
                  <h3 className="sh">Engagement</h3>
                  {/* The shared strip, not an eighth hand-rolled one. This was
                      `repeat(3, 1fr)` — the equal dashboard row DESIGN.md bans —
                      and with four metrics it left an orphan on a second row.
                      KpiStrip sizes asymmetrically off its own count. */}
                  <KpiStrip items={record.engagement.map((e) => ({ label: e.label, value: e.value }))} />
                </div>
              )}

              <div className="sec">
                <h3 className="sh">Relationship graph</h3>
                <RelationshipGraph nodes={record.graph} />
              </div>

              {record.dataQuality.length > 0 && (
                <div className="sec">
                  <h3 className="sh">Data quality</h3>
                  <div className="card">
                    <div className="qmiss">
                      {record.dataQuality.map((q) => (
                        <span className={`qm${q.present ? " ok" : ""}`} key={q.label} style={q.present ? { color: "var(--ok-text)" } : undefined}>
                          {q.present ? "✓" : "○"} {q.label}
                        </span>
                      ))}
                    </div>
                    {record.missingFields.length > 0 && (
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>
                        Missing fields Arc could enrich: {record.missingFields.join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "related" && (
            <div>
              <div className="sec">
                <h3 className="sh">Connected records</h3>
                {relCount === 0 ? (
                  <p className="empty-note">No connected records yet. Arc links companies, contacts, leads, jobs, and outcomes as they relate.</p>
                ) : (
                  Object.entries(groups).map(([kind, rels]) => (
                    <div className="conngrp" key={kind}>
                      <div className="cgl">
                        {kind.charAt(0).toUpperCase() + kind.slice(1)} <span className="cgc">{rels.length}</span>
                      </div>
                      {rels.map((rel) => (
                        <ConnRow key={rel.href} rel={rel} />
                      ))}
                    </div>
                  ))
                )}
              </div>
              <div className="sec">
                <h3 className="sh">Relationship graph</h3>
                <RelationshipGraph nodes={record.graph} />
              </div>
            </div>
          )}
        </div>

        <aside className="snap">
          <div className="snsec">
            <h3 className="snh">At a glance</h3>
            <div className="glance">
              {persona && (
                <div className="gl">
                  <span className="gk">Persona</span>
                  <span className="gv">{persona}</span>
                </div>
              )}
              {record.confidence && (
                <div className="gl">
                  <span className="gk">Confidence</span>
                  <span className="gv">
                    {record.confidence}
                    <span className="est">est</span>
                  </span>
                </div>
              )}
              {record.journeyStage && (
                <div className="gl">
                  <span className="gk">Stage</span>
                  <span className="gv">{record.journeyStage}</span>
                </div>
              )}
              {record.urgency && (
                <div className="gl">
                  <span className="gk">Urgency</span>
                  <span className="gv">{record.urgency}</span>
                </div>
              )}
              <div className="gl">
                <span className="gk">Owner</span>
                <span className="gv">{record.owner || "Unassigned"}</span>
              </div>
              <div className="gl">
                <span className="gk">Updated</span>
                <span className="gv">{formatMaybeDate(record.updated)}</span>
              </div>
              <div className="gl">
                <span className="gk">Source</span>
                <span className="gv">{record.origin === "agent" ? "Arc" : "Operator"}</span>
              </div>
            </div>
          </div>

          {record.evidence.length > 0 && (
            <div className="snsec">
              <h3 className="snh">Evidence</h3>
              {record.evidence.map((e, i) =>
                e.href ? (
                  <a className="arcrun" key={i} href={e.href} target="_blank" rel="noreferrer">
                    <span className="ad">
                      <b>{e.label}</b> {e.detail ?? ""}
                    </span>
                  </a>
                ) : (
                  <div className="arcrun" key={i}>
                    <span className="ad">
                      <b>{e.label}</b> {e.detail ?? ""}
                    </span>
                  </div>
                ),
              )}
            </div>
          )}
        </aside>
      </div>

      <EditRecordModal
        key={editOpen ? "open" : "closed"}
        open={editOpen}
        objectKey={record.key}
        currentPersona={dispPersona}
        currentStatus={dispStatus}
        personaOptions={personaOptions}
        stageOptions={stageOptions}
        onClose={() => setEditOpen(false)}
        onSubmit={handleEdit}
      />
    </div>
  );
}
