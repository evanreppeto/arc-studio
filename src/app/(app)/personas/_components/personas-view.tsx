"use client";

import { useMemo, useState } from "react";

import { archivePersona, createPersona, editPersona, type EditPersonaInput, type NewPersonaInput } from "../actions";
import { EditPersonaModal } from "./edit-persona-modal";
import { NewPersonaModal } from "./new-persona-modal";
import { KpiStrip } from "../../_components/kpi-strip";

export type PersonaVM = {
  slug: string;
  name: string;
  initials: string;
  segment: "acquisition" | "engagement" | "retention";
  segmentLabel: string;
  segColor: string;
  stage: string;
  stageColor: string;
  stageBg: string;
  score: number;
  scoreColor: string;
  audienceShare: number;
  scoreTrend: number[];
  live: boolean;
  quote: string;
  profile: string;
  angle: string;
  cta: string;
  nextAction: string;
  channel: string;
  bestTiming: string;
  audience: string;
  proofPoints: string[];
  sampleSubject: string;
  samplePreview: string;
  radar: { engagement: number; fit: number; intent: number };
  drivers: { engagement: string; fit: string; intent: string };
  perf: { leads: number; jobs: number; revenue: string };
  /** True when the CRM perf query FAILED — the zeros below are not real. */
  perfUnavailable?: boolean;
};

const SEGMENTS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "acquisition", label: "Acquisition" },
  { key: "engagement", label: "Engagement" },
  { key: "retention", label: "Retention" },
];


const SEG_DOT: Record<string, string> = {
  acquisition: "#88b6d8",
  engagement: "#c8a24a",
  retention: "#7fb89a",
};

// Optimistic persona for a just-created record, shown until a real write
// revalidates the roster. Mirrors the page.tsx toVM defaults for a new persona.
function buildOptimisticPersona(slug: string, v: NewPersonaInput): PersonaVM {
  const initials =
    (v.name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "•";
  const segColor = SEG_DOT[v.segment] ?? "#c8a24a";
  return {
    slug,
    name: v.name,
    initials,
    segment: v.segment as PersonaVM["segment"],
    segmentLabel: v.segment.charAt(0).toUpperCase() + v.segment.slice(1),
    segColor,
    stage: "New",
    stageColor: "#9cc1e0",
    stageBg: "rgba(136,182,216,.13)",
    score: 60,
    scoreColor: "#c8a24a",
    audienceShare: 0,
    scoreTrend: [60, 60],
    live: false,
    quote: "",
    profile: "",
    angle: v.angle ?? "",
    cta: "",
    nextAction: "",
    channel: "Email",
    bestTiming: "",
    audience: v.audience ?? "",
    proofPoints: [],
    sampleSubject: "",
    samplePreview: "",
    radar: { engagement: 60, fit: 60, intent: 60 },
    drivers: { engagement: "", fit: "", intent: "" },
    perf: { leads: 0, jobs: 0, revenue: "$0" },
    perfUnavailable: false,
  };
}

export function PersonasView({ personas, initialSlug }: { personas: PersonaVM[]; initialSlug?: string }) {
  const [view, setView] = useState<"roster" | "compare">("roster");
  const [segment, setSegment] = useState("all");
  const [q, setQ] = useState("");
  // `?inspect=` (Arc's @-mentions link here) selects a persona; otherwise the
  // roster opens on the first one.
  const [slug, setSlug] = useState(initialSlug ?? personas[0]?.slug ?? "");
  // Personas created this session, shown until a real write revalidates.
  const [localPersonas, setLocalPersonas] = useState<PersonaVM[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PersonaVM | null>(null);
  const [archivedSlugs, setArchivedSlugs] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, Partial<PersonaVM>>>({});
  const [error, setError] = useState<string | null>(null);

  // Apply optimistic edits and hide optimistically-archived personas until the
  // revalidated server render catches up.
  const allPersonas = useMemo(
    () =>
      [...localPersonas, ...personas]
        .filter((p) => !archivedSlugs.has(p.slug))
        .map((p) => (edits[p.slug] ? { ...p, ...edits[p.slug] } : p)),
    [localPersonas, personas, archivedSlugs, edits],
  );

  const handleCreate = async (value: NewPersonaInput): Promise<{ ok: boolean; error?: string }> => {
    setError(null);
    const tempSlug = `local-${crypto.randomUUID()}`;
    setLocalPersonas((prev) => [buildOptimisticPersona(tempSlug, value), ...prev]);
    setSlug(tempSlug);

    const res = await createPersona(value);
    if (!res.ok) {
      setLocalPersonas((prev) => prev.filter((p) => p.slug !== tempSlug));
      setError(res.error);
      return { ok: false, error: res.error };
    }
    if (res.persisted) {
      // The real row arrives via the revalidated render; drop the optimistic twin.
      setLocalPersonas((prev) => prev.filter((p) => p.slug !== tempSlug));
      if (res.slug) setSlug(res.slug);
    }
    return { ok: true };
  };

  const openEdit = (p: PersonaVM) => {
    setEditTarget(p);
    setEditOpen(true);
  };

  const handleEdit = async (value: EditPersonaInput): Promise<{ ok: boolean; error?: string }> => {
    setError(null);
    const patch: Partial<PersonaVM> = {
      name: value.name,
      segment: value.segment as PersonaVM["segment"],
      segmentLabel: value.segment.charAt(0).toUpperCase() + value.segment.slice(1),
      stage: value.stage ?? "New",
      angle: value.angle ?? "",
      audience: value.audience ?? "",
      cta: value.cta ?? "",
      channel: value.channel ?? "",
    };
    setEdits((prev) => ({ ...prev, [value.slug]: patch }));
    const res = await editPersona(value);
    if (!res.ok) {
      setEdits((prev) => {
        const next = { ...prev };
        delete next[value.slug];
        return next;
      });
      setError(res.error);
      return { ok: false, error: res.error };
    }
    return { ok: true };
  };

  const handleArchive = async (slug: string) => {
    setError(null);
    setArchivedSlugs((prev) => new Set(prev).add(slug));
    const res = await archivePersona(slug);
    if (!res.ok) {
      setArchivedSlugs((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        return next;
      });
      setError(res.error);
    }
  };

  // Header stats are counted from real data only. "Avg lead score" and "Need
  // attention (below target score)" used to live here, both computed off
  // persona.score — which is written as the constant 60 at seed/create and never
  // updated by anything, so the average was always 60 and "below target" was
  // always either every persona or none. Replaced with counts of what the operator
  // actually filled in, plus real attributed leads.
  const headStats = useMemo(() => {
    const segs = new Set(allPersonas.map((p) => p.segment));
    const withAngle = allPersonas.filter((p) => (p.angle ?? "").trim().length > 0).length;
    const leads = allPersonas.reduce((sum, p) => sum + (p.perf?.leads ?? 0), 0);
    return { segmentCount: segs.size, withAngle, leads };
  }, [allPersonas]);

  const segCounts = useMemo(() => {
    const c: Record<string, number> = { all: allPersonas.length };
    for (const p of allPersonas) c[p.segment] = (c[p.segment] ?? 0) + 1;
    return c;
  }, [allPersonas]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allPersonas.filter((p) => {
      if (segment !== "all" && p.segment !== segment) return false;
      if (needle && !`${p.name} ${p.audience} ${p.angle}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [allPersonas, segment, q]);

  // Resolve the detail from the FILTERED set, not the whole roster: if the active
  // filter/segment hides the selected persona, the detail follows the visible list
  // (top match) instead of showing a persona that isn't in the roster. Null when
  // nothing matches, which drives the empty state below.
  const selected = filtered.find((p) => p.slug === slug) ?? filtered[0] ?? null;
  const activeSegmentLabel = SEGMENTS.find((s) => s.key === segment)?.label ?? "";

  const grouped = useMemo(() => {
    const order = ["acquisition", "engagement", "retention"];
    return order
      .map((seg) => ({ seg, label: SEGMENTS.find((s) => s.key === seg)?.label ?? seg, items: filtered.filter((p) => p.segment === seg) }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  if (allPersonas.length === 0) {
    return (
      <div className="arc-personas">
        <div className="empty">
          <p>No personas yet. Personas are the playbooks that power your CRM, targeting, and campaigns — define your own for how your business sees its audience.</p>
          <button type="button" className="gbtn" onClick={() => setNewOpen(true)} style={{ marginTop: 14 }}>
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            Create your first persona
          </button>
        </div>
        <NewPersonaModal
          key={newOpen ? "open" : "closed"}
          open={newOpen}
          onClose={() => setNewOpen(false)}
          onSubmit={handleCreate}
        />
      </div>
    );
  }

  return (
    <div className="arc-personas">
      <div className="phead">
        <div className="ph1row">
          <div>
            <h2 className="pt">Personas</h2>
            <div className="psub">Who you sell to — and how Arc talks to each type</div>
          </div>
          <div style={{ display: "flex", gap: 9 }}>
            <button type="button" className="gbtn" onClick={() => setNewOpen(true)}>
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
              New persona
            </button>
          </div>
        </div>
        <KpiStrip
          className="pstats"
          items={[
            { label: "Personas", value: String(allPersonas.length), sublabel: "you defined these" },
            { label: "Segments", value: String(headStats.segmentCount), sublabel: "winning · keeping · growing" },
            { label: "With an angle", value: String(headStats.withAngle), sublabel: "ready for Arc to use" },
            { label: "Attributed leads", value: headStats.leads.toLocaleString(), sublabel: "last 30 days" },
          ]}
        />
        {/* The "N personas scoring below target — Arc can draft refreshed proof points"
            banner was removed with the score itself. It fired off persona.score, a
            constant 60 nothing ever updates, so it appeared for every workspace on
            every persona forever — and its "Draft updates" button was a no-op. */}
      </div>

      <div className="segbar">
        <div className="vtog">
          <button type="button" className={view === "roster" ? "on" : ""} onClick={() => setView("roster")}>
            <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            Roster
          </button>
          <button type="button" className={view === "compare" ? "on" : ""} onClick={() => setView("compare")}>
            <svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M8 16v-6M13 16V8M18 16v-4" /></svg>
            Compare
          </button>
        </div>
        <span className="barsep" />
        {SEGMENTS.map((s) => (
          <button key={s.key} type="button" className={`segpill${segment === s.key ? " on" : ""}`} onClick={() => setSegment(s.key)}>
            {s.label} <span className="sc">{segCounts[s.key] ?? 0}</span>
          </button>
        ))}
        <span className="segspacer" />
        <span className="ssearch">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter personas…" aria-label="Filter personas" />
        </span>
      </div>

      <div className={`pbody${view === "compare" ? " cmp" : ""}`}>
        {filtered.length === 0 ? (
          <div className="empty pfilter-empty">
            <p>
              No personas match
              {q.trim() ? <> &ldquo;{q.trim()}&rdquo;</> : null}
              {segment !== "all" ? ` in ${activeSegmentLabel}` : ""}.
            </p>
            <button type="button" className="gbtn ghost" onClick={() => { setQ(""); setSegment("all"); }} style={{ marginTop: 12 }}>
              Clear filters
            </button>
          </div>
        ) : view === "roster" ? (
          <>
            <aside className="roster">
              {grouped.map((g) => (
                <div key={g.seg}>
                  <div className="seglabel">{g.label}</div>
                  {g.items.map((p) => (
                    <button key={p.slug} type="button" className={`prow${p.slug === selected?.slug ? " on" : ""}`} onClick={() => setSlug(p.slug)}>
                      <span className="pav" style={{ background: `${p.segColor}22`, color: p.segColor, border: `1px solid ${p.segColor}55` }}>{p.initials}</span>
                      <span className="pmid">
                        <span className="pn">{p.name}</span>
                        <span className="pmeta">
                          <span className="stagep" style={{ color: p.stageColor, background: p.stageBg }}>{p.stage}</span>
                          <span className="pshare">{p.segmentLabel}</span>
                        </span>
                      </span>
                      {/* The score badge + bar and the "% aud." share were dropped: both
                          read persona.score / persona.audience_share, which are written
                          once as constants and never recomputed, so on a real workspace
                          every row showed the same number. */}
                    </button>
                  ))}
                </div>
              ))}
            </aside>

            <section className="detail">
              {selected && (
                <PersonaDetail
                  p={selected}
                  onEdit={() => openEdit(selected)}
                  onArchive={() => handleArchive(selected.slug)}
                />
              )}
            </section>
          </>
        ) : (
          <section className="compare">
            <div className="cmpinner">
              <div className="cmphead">
                <div>
                  <h2>Persona comparison</h2>
                  <div className="csb">{filtered.length} personas · lead score, audience share, and stage side by side</div>
                </div>
              </div>
              <div className="cmptable">
                <table className="ctbl">
                  <thead>
                    <tr>
                      <th>Persona</th>
                      <th>Stage</th>
                      <th>Angle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => (
                      <tr key={p.slug}>
                        <td>
                          <div className="cpn">
                            <span className="cav" style={{ background: `${p.segColor}22`, color: p.segColor, border: `1px solid ${p.segColor}55` }}>{p.initials}</span>
                            <div>
                              <div className="cnm">{p.name}</div>
                              <div className="cseg">{p.segmentLabel}</div>
                            </div>
                          </div>
                        </td>
                        <td><span className="stagep" style={{ color: p.stageColor, background: p.stageBg }}>{p.stage}</span></td>
                        {/* Audience share + lead score columns dropped — both were
                            never-updated constants (see the header stats comment). The
                            angle is real: it's what the operator wrote. */}
                        <td style={{ color: p.angle ? "var(--text-2)" : "var(--muted)" }}>{p.angle || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </div>

      {error && (
        <div className="crm-error" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError(null)}>
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      )}

      <NewPersonaModal
        key={newOpen ? "open" : "closed"}
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onSubmit={handleCreate}
      />

      <EditPersonaModal
        key={editTarget ? `edit-${editTarget.slug}` : "edit-closed"}
        open={editOpen}
        persona={editTarget}
        onClose={() => setEditOpen(false)}
        onSubmit={handleEdit}
      />
    </div>
  );
}


function PersonaDetail({ p, onEdit, onArchive }: { p: PersonaVM; onEdit: () => void; onArchive: () => void }) {
  return (
    <>
      <div className="dhead">
        <span className="dav" style={{ background: `${p.segColor}22`, color: p.segColor, border: `1px solid ${p.segColor}55` }}>{p.initials}</span>
        <div className="dh-main">
          <h2 className="dname">{p.name}</h2>
          <div className="dmeta">
            <span className="chip seg">{p.segmentLabel}</span>
            <span className="chip org" style={{ color: p.stageColor }}>{p.stage}</span>
          </div>
          {(p.profile || p.quote) && (
            <p className="dprofile">
              {p.profile}
              {p.quote && <> <span className="q">&ldquo;{p.quote}&rdquo;</span></>}
            </p>
          )}
          <div className="dactions" style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className="miniabtn" onClick={onEdit}>Edit persona</button>
            <button type="button" className="miniabtn ghost" onClick={onArchive}>Archive</button>
          </div>
        </div>
        {/* The "Lead score N/100" tile and its "90-day" sparkline were removed.
            persona.score is written as a constant (60) at seed and at create and is
            never recomputed, and score_trend is literally [60, 60] — so the number was
            the same for every persona in every workspace and the sparkline was a flat
            line labelled as 90 days of history. Real per-persona performance
            (leads / jobs / revenue) is in the Performance card below. */}
      </div>

      <div className="sec dduo">
        {/* The Signals radar was tagged "wired · snapshots" but plotted
            persona.signals — written as {engagement:60, fit:60, intent:60} and never
            updated — so every persona rendered an identical triangle. Its driver lines
            ("Room to lift opens & replies", "Partial ICP match", "Few recent buying
            signals") were a fallback keyed off that same constant, so every workspace
            got the same three invented diagnoses. Nothing computes these yet. */}
        <div className="radarcard">
          <h3 className="sh" style={{ alignSelf: "flex-start", marginBottom: 4 }}>Signals</h3>
          <p style={{ margin: "4px 2px 0", fontSize: "12px", lineHeight: 1.6, color: "var(--muted)" }}>
            Engagement, fit and intent scoring isn&rsquo;t computed yet — Arc doesn&rsquo;t score personas from
            your CRM activity today. Real attributed performance is in the Performance card.
          </p>
        </div>
        <div className="perfcard">
          <h3 className="sh">Performance {p.perfUnavailable ? <span className="tg est">not available yet</span> : null}</h3>
          {/* A failed CRM read is not a persona with no conversions. */}
          {p.perfUnavailable && (
            <p style={{ margin: "0 2px 10px", fontSize: "11.5px", lineHeight: 1.55, color: "var(--warn-text)" }}>
              Couldn&rsquo;t read leads / outcomes from your CRM — these figures aren&rsquo;t your data.
            </p>
          )}
          <KpiStrip
            className="perfgrid"
            items={[
              { label: "Leads (30d)", value: String(p.perf.leads), sublabel: "attributed to this persona" },
              { label: "Booked jobs", value: String(p.perf.jobs), sublabel: "scheduled" },
              { label: "Won revenue", value: p.perf.revenue, sublabel: "from closed outcomes" },
              {
                label: "Conversion",
                value: p.perf.leads > 0 ? `${Math.round((p.perf.jobs / p.perf.leads) * 100)}%` : "",
                sublabel: "lead to job",
                emptyHint: "Fills in once this persona has leads",
              },
            ]}
          />
        </div>
      </div>

      <div className="sec">
        <div className="sh">Playbook</div>
        <div className="pbk">
          {p.angle && (
            <div className="pbi full">
              <div className="pl">Message angle</div>
              <div className="pv angle">{p.angle}</div>
            </div>
          )}
          {p.cta && (
            <div className="pbi">
              <div className="pl">Recommended CTA</div>
              <div className="pv"><span className="ctaval">→ {p.cta}</span></div>
            </div>
          )}
          {p.nextAction && (
            <div className="pbi">
              <div className="pl">Next best action</div>
              <div className="pv">{p.nextAction}</div>
            </div>
          )}
          {p.channel && (
            <div className="pbi">
              <div className="pl">Preferred channel</div>
              <div className="pv">{p.channel}</div>
            </div>
          )}
          {p.bestTiming && (
            <div className="pbi">
              <div className="pl">Best timing</div>
              <div className="pv">{p.bestTiming}</div>
            </div>
          )}
          {p.audience && (
            <div className="pbi full">
              <div className="pl">Who they are</div>
              <div className="pv">{p.audience}</div>
            </div>
          )}
          {p.proofPoints.length > 0 && (
            <div className="pbi full">
              <div className="pl">Proof points</div>
              <div className="ppchips">
                {p.proofPoints.map((pt) => (
                  <span className="ppchip" key={pt}>{pt}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {(p.sampleSubject || p.samplePreview) && (
        <div className="sec">
          <div className="sh">Sample message · what Arc would send</div>
          <div className="msg">
            <div className="mh">
              <span className="mfrom">A</span>
              <div>
                <div className="msub">{p.sampleSubject || "Draft subject"}</div>
                <div className="mfl">Arc draft · nothing sends until you approve</div>
              </div>
            </div>
            {p.samplePreview && <div className="mpv">{p.samplePreview}</div>}
          </div>
        </div>
      )}
    </>
  );
}
