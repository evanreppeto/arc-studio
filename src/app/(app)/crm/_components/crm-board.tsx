"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { OFFICIAL_PERSONA_MAPPINGS, humanizePersonaLabel, statusTone } from "@/domain";
import { type CrmObjectKey } from "@/lib/crm/read-model";

import { bulkAddContactsToCampaign, bulkAddTask, bulkAssignPersona, createCrmRecord, searchCrmRecords } from "../actions";
import { AddRecordModal, type AddRecordValue, type LinkOption } from "./add-record-modal";
import { KpiStrip, type KpiCell } from "../../_components/kpi-strip";
import type { CustomFieldDefinition } from "@/domain";

type FilterOption = { value: string; label: string; count: number };

/** "Status" → "statuses", "Persona" → "personas". Sibilant endings take -es. */
function pluralize(label: string): string {
  const lower = label.toLowerCase();
  return /(s|x|z|ch|sh)$/.test(lower) ? `${lower}es` : `${lower}s`;
}

// A working dropdown filter for the CRM toolbar. Previously the Persona/Status/
// Owner buttons were dead <span>s; this makes each a real menu that filters the
// table. Open/Escape/click-outside behavior mirrors account-menu.tsx.
function FilterMenu({
  icon,
  label,
  options,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = value ? options.find((o) => o.value === value) : null;

  return (
    <span className="fbtn-wrap" ref={ref}>
      <button type="button" className={`fbtn${value ? " active" : ""}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {icon}
        {active ? active.label : label}
        <span className="cv">▾</span>
      </button>
      {open && (
        <div className="fmenu" role="menu">
          <button type="button" className={`fmenu-item${value ? "" : " on"}`} role="menuitemradio" aria-checked={!value} onClick={() => { onChange(""); setOpen(false); }}>
            <span>All {pluralize(label)}</span>
          </button>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`fmenu-item${o.value === value ? " on" : ""}`}
              role="menuitemradio"
              aria-checked={o.value === value}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <span>{o.label}</span>
              <span className="fmenu-c">{o.count}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

type SortKey = "recent" | "name" | "score";
const SORT_LABELS: Record<SortKey, string> = { recent: "Recent", name: "Name", score: "Score" };

function SortMenu({ value, onChange }: { value: SortKey; onChange: (v: SortKey) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span className="fbtn-wrap" ref={ref}>
      <button type="button" className={`iconf${value !== "recent" ? " active" : ""}`} title={`Sort: ${SORT_LABELS[value]}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <svg viewBox="0 0 24 24"><path d="M7 4v16M7 20l-3-3M7 4l3 3M17 20V4M17 4l3 3M17 20l-3-3" /></svg>
      </button>
      {open && (
        <div className="fmenu fmenu-right" role="menu">
          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
            <button key={k} type="button" className={`fmenu-item${k === value ? " on" : ""}`} role="menuitemradio" aria-checked={k === value} onClick={() => { onChange(k); setOpen(false); }}>
              <span>{SORT_LABELS[k]}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export type CrmRowVM = {
  id: string;
  /** This tenant's own custom fields, keyed by field key -> display string. */
  customFields?: Record<string, string>;
  name: string;
  detail: string;
  initials: string;
  isCompany: boolean;
  statusLabel: string;
  statusTone: string;
  persona: string;
  dot: string;
  score: number | null;
  scoreColor: string;
  owner: string;
  updatedRel: string;
  updatedTime: string;
  href: string;
  company: string;
  value: string;
  tier: string;
  routing: string;
  tasks: string;
};

/** RFC-4180 cell: quote when it contains a comma, quote, or newline; double inner quotes. */
function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The current view (already filtered + sorted) as CSV text. Exports what the
 *  operator sees — a generic, object-agnostic column set. */
function rowsToCsv(rows: CrmRowVM[]): string {
  const header = ["Name", "Company", "Persona", "Status", "Owner", "Last activity", "Score", "Tasks"];
  const body = rows.map((r) =>
    [r.name, r.company, r.persona, r.statusLabel, r.owner, r.updatedRel, r.score ?? "", r.tasks].map(csvCell).join(","),
  );
  return [header.join(","), ...body].join("\n");
}

// Per-object columns, verbatim from build-crm.html's COLS config.
type Col = { k: string; t?: string };
const COLS: Record<string, Col[]> = {
  contacts: [{ k: "sel" }, { k: "primary", t: "Contact" }, { k: "company", t: "Company" }, { k: "persona", t: "Persona" }, { k: "status", t: "Status" }, { k: "last", t: "Last activity" }, { k: "tasks", t: "Tasks" }, { k: "act" }],
  companies: [{ k: "sel" }, { k: "primary", t: "Company" }, { k: "persona", t: "Persona" }, { k: "status", t: "Status" }, { k: "tier", t: "Tier" }, { k: "last", t: "Last activity" }, { k: "act" }],
  properties: [{ k: "sel" }, { k: "primary", t: "Property" }, { k: "persona", t: "Persona" }, { k: "score", t: "Score" }, { k: "status", t: "Status" }, { k: "last", t: "Last activity" }, { k: "act" }],
  leads: [{ k: "sel" }, { k: "primary", t: "Lead" }, { k: "persona", t: "Persona" }, { k: "score", t: "Lead score" }, { k: "status", t: "Status" }, { k: "routing", t: "Routing" }, { k: "last", t: "Received" }, { k: "act" }],
  jobs: [{ k: "sel" }, { k: "primary", t: "Job" }, { k: "status", t: "Status" }, { k: "value", t: "Est. value" }, { k: "last", t: "Scheduled" }, { k: "act" }],
  outcomes: [{ k: "sel" }, { k: "primary", t: "Outcome" }, { k: "status", t: "Status" }, { k: "value", t: "Revenue" }, { k: "last", t: "Closed" }, { k: "act" }],
};

function nx(v: string) {
  return v ? v : "—";
}

function cellClass(k: string) {
  return k === "sel" ? "cselect" : k === "act" ? "cact" : k === "score" ? "cnum" : k === "company" ? "ccompany" : "";
}

const CHECK = (
  <svg viewBox="0 0 24 24">
    <path d="M5 12l4 4 10-10" />
  </svg>
);

function cellContent(k: string, r: CrmRowVM) {
  // Custom-field columns are keyed "cf:<field key>" so they can't collide with
  // the built-in column keys below.
  if (k.startsWith("cf:")) return nx(r.customFields?.[k.slice(3)] ?? "");
  switch (k) {
    case "primary":
      return (
        <div className="pcell">
          <span className={`pav${r.isCompany ? " co" : ""}`}>{r.initials}</span>
          <div style={{ minWidth: 0 }}>
            <div className="pnm">{r.name}</div>
            {r.detail && <div className="psub">{r.detail}</div>}
          </div>
        </div>
      );
    case "company":
      return <span className="nx">{nx(r.company)}</span>;
    case "persona":
      return r.persona ? (
        <span className="chip persona" style={{ color: r.dot, background: `${r.dot}1e`, borderColor: `${r.dot}59` }}>
          <span className="pgd" style={{ background: r.dot }} />
          {r.persona}
        </span>
      ) : (
        <span className="nx">—</span>
      );
    case "status":
      return (
        <span className={`pill ${r.statusTone}`}>
          <span className="pd" />
          {r.statusLabel}
        </span>
      );
    case "score":
      return r.score === null ? (
        <span className="nx">—</span>
      ) : (
        <span className="scorecell">
          <b>{r.score}</b>
          <span className="sbar"><i style={{ width: `${r.score}%`, background: r.scoreColor }} /></span>
        </span>
      );
    case "last":
      return (
        <span className="last">
          <b>{r.updatedRel}</b>
          {r.updatedTime && <span>{r.updatedTime}</span>}
        </span>
      );
    case "tasks":
      return r.tasks ? <span className="chip">{r.tasks}</span> : <span className="nx">—</span>;
    case "tier":
      return <span className="nx">{nx(r.tier)}</span>;
    case "routing":
      return <span className="nx">{nx(r.routing)}</span>;
    case "value":
      return <span className="nx">{nx(r.value)}</span>;
    case "act":
      return <span className="rowact" aria-hidden>›</span>;
    default:
      return null;
  }
}

export type CrmObjectVM = {
  key: string;
  label: string;
  noun: string;
  nameHeader: string;
  addLabel: string;
  filterPlaceholder: string;
  count: number;
};

// The read-model already builds the real record route (/crm/{objectKey}/{id});
// use it so a row opens the live record graph rather than the old name-only mock.
const recordHref = (r: CrmRowVM) => r.href;

// --- Optimistic row construction (mirrors the server page.tsx row derivations) ---
// A just-created record is shown immediately as a client-only row until a real
// DB write revalidates the server render. These are compact copies of the
// personaDot / statusTone / initials helpers so a fresh row looks like a real one.
function initialsOf(name: string): string {
  return (name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "•";
}
function personaLabelOf(key: string): string {
  const label = humanizePersonaLabel(key);
  return /^unassigned/i.test(label) ? "" : label;
}
/** Optimistically add `delta` to a "N open" tasks label (or seed it from 0). */
function bumpTasksLabel(current: string, delta: number): string {
  if (!delta) return current;
  const parsed = parseInt(current, 10);
  const total = (Number.isFinite(parsed) ? parsed : 0) + delta;
  return total > 0 ? `${total} open` : "";
}

function personaDotOf(persona: string): string {
  const p = (persona || "").toLowerCase();
  if (/emergency|urgent|storm|hail|flood|fire|burst|water\s*damage/.test(p)) return "#cc6a6a";
  if (/insurance|adjuster|agent/.test(p)) return "#88b6d8";
  if (/plumb|partner|contractor|referral|vendor|trade|sub/.test(p)) return "#7fb89a";
  if (/preventative|preventive|maintenance|monitor|inspection/.test(p)) return "#6fae9e";
  if (/rebuild|restoration|reconstruct|remodel|renov/.test(p)) return "#d8a24a";
  if (/hoa|board|association|landlord|tenant/.test(p)) return "#9678c8";
  if (/past|repeat|existing|customer|reactivat/.test(p)) return "#b58fd0";
  return "#c8a24a";
}
function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Archiving is this CRM's delete (there is no hard delete): an archived record
 *  drops out of the default list and the counts, and is reachable only by asking
 *  for it explicitly via Status → Archived. Matches the `archived` status titleCased. */
const ARCHIVED_LABEL = "Archived";
function buildOptimisticRow(
  objectKey: CrmObjectKey,
  id: string,
  v: AddRecordValue,
  stages: { key: string; label: string }[] = [],
): CrmRowVM {
  const detail = objectKey === "properties" ? [v.city, v.state].filter(Boolean).join(", ") : v.detail || "";
  // Label the row with the tenant's own word, the same one the server will send
  // back on refresh — otherwise a just-added record briefly reads "Conflicts
  // Check" (titleCased key) and then changes to "Conflicts check" under the eye.
  const stageLabel = stages.find((s) => s.key === v.status)?.label;
  const label = stageLabel ?? (v.status ? titleCase(v.status) : "");
  return {
    id,
    name: v.name,
    detail,
    initials: initialsOf(v.name),
    isCompany: objectKey === "companies",
    statusLabel: label || "—",
    statusTone: statusTone(label),
    persona: personaLabelOf(v.persona || ""),
    dot: personaDotOf(v.persona || ""),
    score: null,
    scoreColor: "var(--muted)",
    owner: "You",
    updatedRel: "now",
    updatedTime: "",
    href: `/crm/${objectKey}/${id}`,
    company: "",
    value: "",
    tier: "",
    routing: "",
    tasks: "",
  };
}

export function CrmBoard({
  loadError = null,
  objects,
  rowsByKey,
  defaultKey,
  kpis,
  personaOptions,
  campaigns = [],
  customColumnsByKey = {},
  customFieldDefsByKey = {},
  stageOptions = {},
}: {
  /** Why the read FAILED, vs returning nothing. Null when it succeeded. */
  loadError?: string | null;
  objects: CrmObjectVM[];
  rowsByKey: Record<string, CrmRowVM[]>;
  defaultKey: string;
  kpis?: KpiCell[];
  /** The org's own personas for the Add-record picker. */
  personaOptions?: { key: string; label: string }[];
  /** The org's campaigns, for the bulk "Add to campaign" picker (contacts only). */
  campaigns?: { id: string; name: string; href: string }[];
  /** The org's own pipeline stages per object, in its own words. */
  stageOptions?: Record<string, { key: string; label: string }[]>;
  /**
   * Custom-field columns per object, already ordered and capped by the server.
   * Only a couple are shown: the table has a fixed set of built-in columns, and
   * a tenant with fifteen custom fields would otherwise render an unusable
   * horizontal scroll. Every field is still searchable and shown in full on the
   * record itself.
   */
  customColumnsByKey?: Record<string, { key: string; label: string }[]>;
  /** Full definitions per object, for the Add-record form. */
  customFieldDefsByKey?: Record<string, CustomFieldDefinition[]>;
}) {
  const [activeKey, setActiveKey] = useState(defaultKey);
  const [q, setQ] = useState("");
  /**
   * Rows the SERVER matched, for the case the browser cannot answer (BSR-633).
   *
   * The board holds a 1,000-row recency window. Past that, a record is not in
   * the browser at all, so filtering locally returns nothing while the counter —
   * a real COUNT — says it exists. When the window is incomplete the term goes
   * to the server instead. Null means "the local set is authoritative".
   */
  const [serverRows, setServerRows] = useState<CrmRowVM[] | null>(null);
  const [serverCapped, setServerCapped] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [personaMenuOpen, setPersonaMenuOpen] = useState(false);
  // Optimistic persona overlay by row id — a bulk assign flips the chips at once,
  // reverting if the write fails.
  const [personaEdits, setPersonaEdits] = useState<Record<string, { persona: string; dot: string }>>({});
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  const [bulkTaskText, setBulkTaskText] = useState("");
  // Optimistic open-task-count bumps by row id — a bulk add-task increments the
  // Tasks column for the selected rows immediately, reverting on failure.
  const [taskBumps, setTaskBumps] = useState<Record<string, number>>({});
  const [campaignMenuOpen, setCampaignMenuOpen] = useState(false);
  // Add-to-campaign has no on-row display, so a success confirmation is the feedback.
  const [notice, setNotice] = useState<string | null>(null);
  // Client-only rows for records created this session, keyed by object. They sit
  // on top of the server rows until a real DB write revalidates the page.
  const [localByKey, setLocalByKey] = useState<Record<string, CrmRowVM[]>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [personaF, setPersonaF] = useState("");
  const [statusF, setStatusF] = useState("");
  const [ownerF, setOwnerF] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("recent");

  const active = objects.find((o) => o.key === activeKey) ?? objects[0];
  const localRows = localByKey[active.key] ?? [];
  const totalRows = localRows.length + (rowsByKey[active.key] ?? []).length;
  // Splice the tenant's custom columns in just before the trailing actions cell.
  const cols = (() => {
    const base = COLS[active.key] ?? COLS.contacts;
    const custom = customColumnsByKey[active.key] ?? [];
    if (custom.length === 0) return base;
    const actIdx = base.findIndex((c) => c.k === "act");
    const extra: Col[] = custom.map((c) => ({ k: `cf:${c.key}`, t: c.label }));
    if (actIdx < 0) return [...base, ...extra];
    return [...base.slice(0, actIdx), ...extra, ...base.slice(actIdx)];
  })();
  // o.count is the server's row count for the object; archived rows are soft-deleted
  // so they're netted out of the headline count and tab badges the same way they're
  // hidden from the list. Subtracting (rather than recomputing) keeps the count intact
  // if a route ever loads rows for only some objects.
  const countFor = (o: CrmObjectVM) =>
    o.count -
    (rowsByKey[o.key] ?? []).filter((r) => r.statusLabel === ARCHIVED_LABEL).length +
    (localByKey[o.key]?.length ?? 0);

  // True when the browser holds every record of the active object, so a local
  // filter can answer honestly. False once the 1,000-row window is exceeded.
  const loadedComplete = (rowsByKey[active.key] ?? []).length >= active.count;

  useEffect(() => {
    const term = q.trim();
    if (loadedComplete || term.length < 2) {
      // Drop back to the local set. Guarded so this is a no-op on the common
      // render where there was never a server result to clear.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- returning to the local set the moment the term or object stops needing a server search
      if (serverRows !== null) setServerRows(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a stale error must not outlive the query that caused it
      if (searchError !== null) setSearchError(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- an in-flight flag must not survive a cancelled search
      if (searching) setSearching(false);
      return;
    }
    // Debounced: the window being incomplete means every keystroke would
    // otherwise be a round trip.
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the search IS starting; the spinner must reflect that before the await
    setSearching(true);
    const timer = setTimeout(async () => {
      const res = await searchCrmRecords(active.key, term);
      if (cancelled) return;
      setSearching(false);
      if (!res.ok) {
        // A failed search is NOT "no matches" — saying so is the difference
        // between an outage and an empty result.
        setSearchError(res.error);
        setServerRows(null);
        return;
      }
      setSearchError(null);
      setServerRows(res.rows);
      setServerCapped(res.capped);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, active.key, active.count, loadedComplete, rowsByKey, serverRows, searchError, searching]);

  const allActiveRows = useMemo(
    () =>
      [...(localByKey[active.key] ?? []), ...(rowsByKey[active.key] ?? [])].map((r) => {
        let row = r;
        if (personaEdits[r.id]) row = { ...row, persona: personaEdits[r.id].persona, dot: personaEdits[r.id].dot };
        if (taskBumps[r.id]) row = { ...row, tasks: bumpTasksLabel(row.tasks, taskBumps[r.id]) };
        return row;
      }),
    [localByKey, rowsByKey, active.key, personaEdits, taskBumps],
  );

  // The workspace's personas for the bulk picker; falls back to the official set
  // offline/demo, exactly like the Add-record modal.
  const personaChoices = personaOptions?.length
    ? personaOptions
    : OFFICIAL_PERSONA_MAPPINGS.map((key) => ({ key, label: personaLabelOf(key) }));

  const assignPersona = (opt: { key: string; label: string }) => {
    const ids = [...selected];
    setPersonaMenuOpen(false);
    if (ids.length === 0) return;
    setError(null);
    const dot = personaDotOf(opt.label);
    const prev = personaEdits;
    setPersonaEdits((e) => {
      const next = { ...e };
      for (const id of ids) next[id] = { persona: opt.label, dot };
      return next;
    });
    setSelected(new Set());
    bulkAssignPersona(active.key, ids, opt.key)
      .then((res) => {
        if (!res.ok) {
          setPersonaEdits(prev);
          setError(res.error);
        }
      })
      .catch(() => {
        setPersonaEdits(prev);
        setError("Could not assign persona.");
      });
  };

  const submitBulkTask = () => {
    const ids = [...selected];
    const body = bulkTaskText.trim();
    if (!body || ids.length === 0) return;
    setTaskMenuOpen(false);
    setBulkTaskText("");
    setError(null);
    const prev = taskBumps;
    setTaskBumps((b) => {
      const next = { ...b };
      for (const id of ids) if (!id.startsWith("local-")) next[id] = (next[id] ?? 0) + 1;
      return next;
    });
    setSelected(new Set());
    bulkAddTask(active.key, ids, body)
      .then((res) => {
        if (!res.ok) {
          setTaskBumps(prev);
          setError(res.error);
        }
      })
      .catch(() => {
        setTaskBumps(prev);
        setError("Could not add the task.");
      });
  };

  const addToCampaign = (campaign: { id: string; name: string }) => {
    const ids = [...selected];
    setCampaignMenuOpen(false);
    if (ids.length === 0) return;
    setError(null);
    setNotice(null);
    bulkAddContactsToCampaign(campaign.id, ids)
      .then((res) => {
        if (res.ok) setNotice(`Added ${ids.length} ${ids.length === 1 ? "contact" : "contacts"} to “${campaign.name}”.`);
        else setError(res.error);
      })
      .catch(() => setError("Could not add to the campaign."));
    setSelected(new Set());
  };

  // Parent records a lead/outcome can link to, from the loaded rows. Leads link
  // to a company/contact/property; outcomes link to a job/lead.
  const linkOptions = useMemo<LinkOption[]>(() => {
    const from = (key: string, type: string, typeLabel: string): LinkOption[] =>
      (rowsByKey[key] ?? []).filter((r) => !r.id.startsWith("local-")).map((r) => ({ type, id: r.id, label: `${typeLabel} · ${r.name}` }));
    if (active.key === "leads") return [...from("companies", "company", "Company"), ...from("contacts", "contact", "Contact"), ...from("properties", "property", "Property")];
    if (active.key === "outcomes") return [...from("jobs", "job", "Job"), ...from("leads", "lead", "Lead")];
    return [];
  }, [rowsByKey, active.key]);

  // Distinct filter options (with counts) drawn from the current object's rows.
  const options = useMemo(() => {
    const build = (pick: (r: CrmRowVM) => string): FilterOption[] => {
      const counts = new Map<string, number>();
      for (const r of allActiveRows) {
        const v = pick(r).trim();
        if (v && v !== "—") counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([value, count]) => ({ value, label: value, count }));
    };
    return { persona: build((r) => r.persona), status: build((r) => r.statusLabel), owner: build((r) => r.owner) };
  }, [allActiveRows]);

  const anyFilter = !!(personaF || statusF || ownerF);
  const clearFilters = () => { setPersonaF(""); setStatusF(""); setOwnerF(""); };

  const filteredAll = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // When the server answered, IT is the match set — the local rows are only a
    // window and re-filtering them would drop the very records it went to find.
    // The other facets still apply, and the text term is already satisfied.
    const source = serverRows ?? allActiveRows;
    let filtered = source.filter((r) => {
      // Soft-deleted records stay out of the default list; Status → Archived opts in.
      if (r.statusLabel === ARCHIVED_LABEL && statusF !== ARCHIVED_LABEL) return false;
      // Custom field values are searchable too — a tenant that tracks a matter
      // number expects to find the record by typing it.
      const customHay = r.customFields ? Object.values(r.customFields).join(" ") : "";
      if (!serverRows && needle && !`${r.name} ${r.detail} ${r.persona} ${r.owner} ${customHay}`.toLowerCase().includes(needle)) return false;
      if (personaF && r.persona !== personaF) return false;
      if (statusF && r.statusLabel !== statusF) return false;
      if (ownerF && r.owner !== ownerF) return false;
      return true;
    });
    if (sortBy === "name") filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === "score") filtered = [...filtered].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    return filtered;
  }, [allActiveRows, serverRows, q, personaF, statusF, ownerF, sortBy]);
  // Display caps at 100 rows for perf; Export writes the WHOLE filtered set (never
  // a silent 100-row slice).
  const visible = useMemo(() => filteredAll.slice(0, 100), [filteredAll]);

  const exportCsv = () => {
    if (filteredAll.length === 0) return;
    const blob = new Blob([rowsToCsv(filteredAll)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${active.key}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Add a record: show it instantly, then persist. Offline/demo returns
  // persisted:false and the optimistic row stays (session-only). A real write
  // revalidates the server render, so we drop the optimistic twin to avoid a
  // duplicate. A failure reverts the row and surfaces the error.
  const handleCreate = async (value: AddRecordValue): Promise<{ ok: boolean; error?: string }> => {
    const objectKey = active.key as CrmObjectKey;
    const tempId = `local-${crypto.randomUUID()}`;
    setError(null);
    setLocalByKey((prev) => ({ ...prev, [objectKey]: [buildOptimisticRow(objectKey, tempId, value, stageOptions[objectKey] ?? []), ...(prev[objectKey] ?? [])] }));

    const res = await createCrmRecord({ objectKey, ...value });

    if (!res.ok) {
      setLocalByKey((prev) => ({ ...prev, [objectKey]: (prev[objectKey] ?? []).filter((r) => r.id !== tempId) }));
      setError(res.error);
      return { ok: false, error: res.error };
    }
    if (res.persisted) {
      setLocalByKey((prev) => ({ ...prev, [objectKey]: (prev[objectKey] ?? []).filter((r) => r.id !== tempId) }));
    }
    return { ok: true };
  };

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected((prev) => {
      if (visible.every((r) => prev.has(r.id))) return new Set();
      return new Set(visible.map((r) => r.id));
    });
  const switchObject = (key: string) => {
    setActiveKey(key);
    setQ("");
    setSelected(new Set());
    setPersonaF("");
    setStatusF("");
    setOwnerF("");
    setSortBy("recent");
  };

  return (
    <div className="arc-grid arc-crm">
      {/* A failed read is NOT an empty result. Rendering them the same is how a
          live outage hid behind a normal-looking page (BSR-542). */}
      {loadError && (
        <div className="crm-error" role="alert" style={{ marginBottom: 16 }}>
          <span>
            <b>Couldn&rsquo;t load your CRM counts.</b> The tiles below may read zero because a query failed, not because you have no records.
            <div style={{ marginTop: 6, opacity: 0.75, fontFamily: "var(--mono, monospace)", fontSize: "0.85em" }}>{loadError}</div>
          </span>
        </div>
      )}
      <div className="chrow">
        <div>
          <h2 className="ct">{active.label}</h2>
          <div className="csub">
            {countFor(active).toLocaleString()} {active.noun} · org-scoped · synced with Arc
          </div>
        </div>
        <div className="sp">
          <Link className="gbtn" href="/crm/import" title="Import contacts from a CSV">
            <svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
            Import
          </Link>
          <button type="button" className="gbtn" onClick={exportCsv} disabled={filteredAll.length === 0} title={`Download ${filteredAll.length} ${active.noun} as CSV`}>
            <svg viewBox="0 0 24 24"><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3M8 9l4 4 4-4M12 13V3" /></svg>
            Export
          </button>
          <button type="button" className="gbtn gold" onClick={() => setAddOpen(true)}>
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            {active.addLabel}
          </button>
        </div>
      </div>

      {kpis && kpis.length > 0 ? <KpiStrip items={kpis} /> : null}

      {error && (
        <div className="crm-error" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError(null)}>
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      )}
      {notice && (
        <div className="crm-notice" role="status">
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      )}

      <div className="subtabs">
        {objects.map((o) => (
          <button
            key={o.key}
            type="button"
            className={`subtab${o.key === activeKey ? " on" : ""}`}
            onClick={() => switchObject(o.key)}
          >
            {o.label} <span className="cnt">{countFor(o).toLocaleString()}</span>
          </button>
        ))}
      </div>

      <div className="gtoolbar">
        <span className="tsearch">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={active.filterPlaceholder}
            aria-label={`Filter ${active.noun}`}
          />
        </span>
        <FilterMenu
          icon={<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3" /><path d="M4 20c0-3 2-5 5-5s5 2 5 5" /></svg>}
          label="Persona"
          options={options.persona}
          value={personaF}
          onChange={setPersonaF}
        />
        <FilterMenu
          icon={<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9 12l2 2 4-4" /></svg>}
          label="Status"
          options={options.status}
          value={statusF}
          onChange={setStatusF}
        />
        <FilterMenu
          icon={<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2" /><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" /></svg>}
          label="Owner"
          options={options.owner}
          value={ownerF}
          onChange={setOwnerF}
        />
        {anyFilter && (
          <button type="button" className="fbtn dashed" onClick={clearFilters}>
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
            Clear
          </button>
        )}
        <span className="gspacer" />
        <SortMenu value={sortBy} onChange={setSortBy} />
        <span className="iconf" title="Columns" data-soon="Column settings are coming soon">
          <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></svg>
        </span>
        <span className="iconf" title="Density" data-soon="Density settings are coming soon">
          <svg viewBox="0 0 24 24"><path d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
        </span>
      </div>

      <div className={`selbar${selected.size ? " show" : ""}${personaMenuOpen || taskMenuOpen || campaignMenuOpen ? " menuopen" : ""}`}>
        <span className="sc">{selected.size} selected</span>
        {active.key === "contacts" ? (
          <div className="sa-wrap">
            <button type="button" className="sa" onClick={() => setCampaignMenuOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={campaignMenuOpen}>
              <svg viewBox="0 0 24 24"><path d="M4 5h16v6H4z" /><path d="M4 15h10v4H4z" /></svg>Add to campaign
            </button>
            {campaignMenuOpen && (
              <>
                <button type="button" className="sa-backdrop" aria-hidden onClick={() => setCampaignMenuOpen(false)} tabIndex={-1} />
                <div className="sa-menu" role="listbox" aria-label="Add the selected contacts to a campaign">
                  {campaigns.length === 0 ? (
                    <div className="sa-empty">No campaigns yet — create one on the Campaigns page.</div>
                  ) : (
                    campaigns.map((c) => (
                      <button type="button" key={c.id} role="option" aria-selected={false} className="sa-opt" onClick={() => addToCampaign(c)}>{c.name}</button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <span className="sa" data-soon="Add contacts to a campaign from the People tab"><svg viewBox="0 0 24 24"><path d="M4 5h16v6H4z" /><path d="M4 15h10v4H4z" /></svg>Add to campaign</span>
        )}
        <div className="sa-wrap">
          <button type="button" className="sa" onClick={() => setPersonaMenuOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={personaMenuOpen}>
            <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3" /><path d="M4 20c0-3 2-5 5-5s5 2 5 5" /></svg>Assign persona
          </button>
          {personaMenuOpen && (
            <>
              <button type="button" className="sa-backdrop" aria-hidden onClick={() => setPersonaMenuOpen(false)} tabIndex={-1} />
              <div className="sa-menu" role="listbox" aria-label="Assign a persona to the selected records">
                {personaChoices.map((o) => (
                  <button type="button" key={o.key} role="option" aria-selected={false} className="sa-opt" onClick={() => assignPersona(o)}>{o.label}</button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="sa-wrap">
          <button type="button" className="sa" onClick={() => setTaskMenuOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={taskMenuOpen}>
            <svg viewBox="0 0 24 24"><path d="M9 11l3 3 8-8M4 12v7a1 1 0 001 1h14" /></svg>Add task
          </button>
          {taskMenuOpen && (
            <>
              <button type="button" className="sa-backdrop" aria-hidden onClick={() => setTaskMenuOpen(false)} tabIndex={-1} />
              <div className="sa-menu sa-taskmenu" role="dialog" aria-label="Add a task to the selected records">
                <input
                  className="sa-taskinput"
                  value={bulkTaskText}
                  onChange={(e) => setBulkTaskText(e.target.value)}
                  placeholder="Add a follow-up task…"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitBulkTask();
                    else if (e.key === "Escape") setTaskMenuOpen(false);
                  }}
                />
                <button type="button" className="sa-taskbtn" onClick={submitBulkTask} disabled={!bulkTaskText.trim()}>
                  Add to {selected.size}
                </button>
              </div>
            </>
          )}
        </div>
        <span className="sa" data-soon="Arc enrichment is coming soon"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-6.2-8.6" /><path d="M21 4v5h-5" /></svg>Ask Arc to enrich</span>
        <span className="clr" onClick={() => setSelected(new Set())}>Clear</span>
      </div>

      <div className="tablewrap">
        <table className="dt">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.k} className={cellClass(c.k)}>
                  {c.k === "sel" ? (
                    <span
                      className={`ck${allVisibleSelected ? " on" : ""}`}
                      role="checkbox"
                      aria-checked={allVisibleSelected}
                      aria-label="Select all"
                      onClick={toggleAll}
                    >
                      {CHECK}
                    </span>
                  ) : (
                    c.k === "primary" ? active.nameHeader : c.t ?? ""
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr className="emptyrow">
                <td colSpan={cols.length}>
                  {totalRows === 0 ? (
                    // A brand-new workspace has no records at all, and every
                    // other screen stays empty until it does — so say where they
                    // come from and offer the action, rather than only stating
                    // the absence.
                    <>
                      <strong>No {active.noun} yet.</strong> Arc works from these — it scans them for opportunities
                      worth acting on.
                      <div style={{ marginTop: 8 }}>
                        <button type="button" className="gbtn gold" onClick={() => setAddOpen(true)}>
                          Add {active.noun.replace(/s$/, "")}
                        </button>
                      </div>
                    </>
                  ) : (
                    "No matches for this filter."
                  )}
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr
                  key={r.id}
                  className={r.id.startsWith("local-") ? "freshrow" : undefined}
                  onClick={() => {
                    // Optimistic (unsaved) rows have no live record page yet.
                    if (!r.id.startsWith("local-")) window.location.href = recordHref(r);
                  }}
                >
                  {cols.map((c) => (
                    <td key={c.k} className={cellClass(c.k)}>
                      {c.k === "sel" ? (
                        <span
                          className={`ck${selected.has(r.id) ? " on" : ""}`}
                          role="checkbox"
                          aria-checked={selected.has(r.id)}
                          aria-label={`Select ${r.name}`}
                          onClick={(e) => { e.stopPropagation(); toggleRow(r.id); }}
                        >
                          {CHECK}
                        </span>
                      ) : (
                        cellContent(c.k, r)
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="gfoot">
        <span className="arcnote">
          <i />
          Arc keeps {active.noun} enriched and lead scores current
        </span>
        <div className="pager">
          <span className="rpp">
            Rows{" "}
            <select defaultValue="25">
              <option>25</option>
              <option>50</option>
              <option>100</option>
            </select>
          </span>
          <span className="pgnum">
            {visible.length === 0 ? "0" : `1–${visible.length}`} of{" "}
            {(serverRows ? filteredAll.length : countFor(active)).toLocaleString()}
            {searching ? " · searching…" : ""}
            {serverCapped && serverRows ? ` · first ${serverRows.length}, narrow to see more` : ""}
          </span>
          <button className="pgbtn" type="button" aria-label="Previous page">
            <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <button className="pgbtn" type="button" aria-label="Next page">
            <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </div>
      </div>

      <AddRecordModal
        key={`${active.key}:${addOpen ? "open" : "closed"}`}
        open={addOpen}
        objectKey={active.key as CrmObjectKey}
        singular={active.addLabel.replace(/^Add\s+/i, "")}
        linkOptions={linkOptions}
        personaOptions={personaOptions}
        stageOptions={stageOptions[active.key]}
        customFieldDefs={customFieldDefsByKey[active.key] ?? []}
        onClose={() => setAddOpen(false)}
        onSubmit={handleCreate}
      />
    </div>
  );
}
