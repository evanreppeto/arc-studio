"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { CAMPAIGN_NOUN, countOf, WORK_STATE_LABEL } from "@/domain";

import { createCampaign, type NewCampaignInput } from "../actions";
import { NewCampaignModal } from "./new-campaign-modal";
import { needsOperatorApproval, type CampaignTone } from "./tone";

export type { CampaignTone } from "./tone";

export type CampaignRow = {
  id: string;
  name: string;
  brief: string;
  tone: CampaignTone;
  statusLabel: string;
  next: string;
  nextTone: "" | "go" | "warn";
  /** Assets on this campaign with no decision recorded yet. */
  pendingCount: number;
  audience: string;
  dot: string;
  channels: string;
  updatedRel: string;
  updatedAbs: string;
  href: string;
};

const CampIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
    <path d="M4 5h16v6H4z" />
    <path d="M4 15h10v4H4z" />
  </svg>
);

// Tab labels and the status pills in the rows below them are the same words now
// (BSR-656) — the "Needs approval" tab used to sit above rows reading "In review".
const TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs", label: WORK_STATE_LABEL.needs_you },
  { key: "live", label: WORK_STATE_LABEL.sending },
  { key: "approved", label: WORK_STATE_LABEL.approved },
  { key: "draft", label: WORK_STATE_LABEL.draft },
  { key: "archived", label: WORK_STATE_LABEL.archived },
];

function inTab(tone: CampaignTone, tab: string): boolean {
  if (tab === "all") return true;
  if (tab === "needs") return needsOperatorApproval(tone);
  return tone === tab;
}

type SortKey = "recent" | "name" | "status";
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recently updated" },
  { key: "name", label: "Name (A–Z)" },
  { key: "status", label: "Status" },
];
// Status order surfaces what needs you first, then live work, then the rest.
const TONE_RANK: Record<CampaignTone, number> = { review: 0, revise: 1, live: 2, approved: 3, draft: 4, archived: 5 };

// --- Optimistic row for a just-created campaign (mirrors page.tsx derivations) ---
function personaLabelOf(persona: string): string {
  const s = (persona || "").replace(/^persona[\s_-]+/i, "").replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}
function personaDotOf(persona: string): string {
  const p = (persona || "").toLowerCase();
  if (/storm|hail|weather|damage/.test(p)) return "#7fb89a";
  if (/property|manager|realtor|hoa|commercial/.test(p)) return "#c8a24a";
  if (/insurance|adjuster/.test(p)) return "#88b6d8";
  if (/past|repeat|existing|customer|reactivation/.test(p)) return "#9678c8";
  return "#c8a24a";
}
function buildOptimisticCampaign(id: string, v: NewCampaignInput): CampaignRow {
  const audience = personaLabelOf(v.persona);
  return {
    id,
    name: v.name,
    brief: v.campaignTheme || "New campaign",
    tone: "draft",
    statusLabel: WORK_STATE_LABEL.draft,
    // A campaign created seconds ago has no assets yet, so nothing is
    // undecided — Arc drafts them after this row appears.
    pendingCount: 0,
    next: "Arc is still building it",
    nextTone: "",
    audience,
    dot: personaDotOf(v.persona || audience),
    channels: "",
    updatedRel: "now",
    updatedAbs: "",
    href: `/campaigns/${id}`,
  };
}

export function CampaignsBoard({
  rows,
  arcNote,
  personaOptions,
  loadError = null,
}: {
  rows: CampaignRow[];
  arcNote: string;
  /** The org's own personas for the New-campaign picker. */
  personaOptions?: { key: string; label: string }[];
  /**
   * Why the list is empty, when it is empty because the read FAILED rather than
   * because the workspace has no campaigns. Those two must never render the same
   * — an empty board that is actually a broken query is how a prod failure hid
   * behind a green guardrail (BSR-542).
   */
  loadError?: string | null;
}) {
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [sortOpen, setSortOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  // Draft rows created this session, shown until a real write revalidates.
  const [localRows, setLocalRows] = useState<CampaignRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const allRows = useMemo(() => [...localRows, ...rows], [localRows, rows]);

  const counts = useMemo(() => {
    const by = (fn: (t: CampaignTone) => boolean) => allRows.filter((r) => fn(r.tone)).length;
    return {
      all: allRows.length,
      needs: by(needsOperatorApproval),
      live: by((t) => t === "live"),
      approved: by((t) => t === "approved"),
      draft: by((t) => t === "draft"),
      archived: by((t) => t === "archived"),
    } as Record<string, number>;
  }, [allRows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = allRows.filter((r) => {
      if (!inTab(r.tone, tab)) return false;
      if (needle && !`${r.name} ${r.brief} ${r.audience}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    // "recent" keeps the server's updated-desc order (fresh local drafts already
    // lead); the others sort a copy so the source order stays intact.
    if (sort === "name") return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "status") return [...filtered].sort((a, b) => (TONE_RANK[a.tone] ?? 9) - (TONE_RANK[b.tone] ?? 9));
    return filtered;
  }, [allRows, tab, q, sort]);

  // Create a campaign: when it persists, jump into the new draft's detail page;
  // offline it drops in an optimistic draft row and stays on the board. Failures
  // surface an error and keep the modal open.
  const handleCreate = async (value: NewCampaignInput): Promise<{ ok: boolean; error?: string }> => {
    setError(null);
    const res = await createCampaign(value);
    if (!res.ok) {
      setError(res.error);
      return { ok: false, error: res.error };
    }
    if (res.persisted && res.href) {
      router.push(res.href);
      return { ok: true };
    }
    const tempId = `local-${crypto.randomUUID()}`;
    setLocalRows((prev) => [buildOptimisticCampaign(tempId, value), ...prev]);
    return { ok: true };
  };

  return (
    <div className="arc-grid arc-campaigns">
      <div className="chrow">
        <div>
          <h2 className="ct">Campaigns</h2>
          <div className="csub">
            {countOf(allRows.length, CAMPAIGN_NOUN)} drafted by Arc · nothing sends until you approve it
          </div>
        </div>
        <div className="sp">
          <span className="gbtn" data-soon="Campaign templates are coming soon">
            <svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z" /><path d="M4 9h16M9 5v14" /></svg>
            Templates
          </span>
          <button type="button" className="gbtn gold" onClick={() => setNewOpen(true)}>
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            New campaign
          </button>
        </div>
      </div>

      {error && (
        <div className="crm-error" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError(null)}>
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      )}

      <div className="subtabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`subtab${tab === t.key ? " on" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label} <span className="cnt">{counts[t.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="gtoolbar">
        <span className="tsearch">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter campaigns…"
            aria-label="Filter campaigns"
          />
        </span>
        <span className="gspacer" />
        <div className="sortwrap">
          <button
            type="button"
            className="fbtn"
            aria-haspopup="listbox"
            aria-expanded={sortOpen}
            onClick={() => setSortOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
            {SORT_OPTIONS.find((o) => o.key === sort)?.label} <span className="cv">▾</span>
          </button>
          {sortOpen && (
            <>
              <div className="sortscrim" onClick={() => setSortOpen(false)} />
              <div className="sortmenu" role="listbox" aria-label="Sort campaigns">
                {SORT_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    role="option"
                    aria-selected={sort === o.key}
                    className={`sortopt${sort === o.key ? " on" : ""}`}
                    onClick={() => { setSort(o.key); setSortOpen(false); }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="tablewrap">
        <table className="dt">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Status</th>
              <th>Next action</th>
              <th>Audience</th>
              <th>Channels</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr className="emptyrow">
                {/* "Couldn't load" and "nothing here yet" are different facts and
                    must read differently. Saying "No campaigns" over a failed
                    query tells an operator the workspace is empty when it isn't. */}
                <td colSpan={6}>
                  {loadError ? (
                    <>
                      <strong>Couldn’t load campaigns.</strong> This is a failure, not an empty workspace — campaigns may exist.
                      <div style={{ marginTop: 6, opacity: 0.75, fontFamily: "var(--mono, monospace)", fontSize: "0.85em" }}>{loadError}</div>
                    </>
                  ) : allRows.length === 0 ? (
                    // A workspace with zero campaigns is a different fact from a
                    // filter hiding them. "No campaigns match this view" tells a
                    // brand-new owner to go hunting for a filter that isn't set,
                    // when what they actually need is to know where campaigns
                    // come from.
                    <>
                      <strong>No campaigns yet.</strong> Arc drafts these from opportunities it finds in your records
                      — nothing is sent until you approve it.
                      <div style={{ marginTop: 8 }}>
                        <Link className="cbtn" href="/opportunities">
                          See what Arc has found&nbsp;→
                        </Link>
                      </div>
                    </>
                  ) : (
                    "No campaigns match this view."
                  )}
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr
                  key={r.id}
                  className={r.id.startsWith("local-") ? "freshrow" : undefined}
                >
                  <td>
                    {r.id.startsWith("local-") ? <div className="pcell">
                      <span className="pav">{CampIcon}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="pnm">{r.name}</div>
                        <div className="psub">{r.brief}</div>
                      </div>
                    </div> : <Link className="pcell campaign-link" href={r.href} aria-label={`Open ${r.name}`}>
                      <span className="pav">{CampIcon}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="pnm">{r.name}</div>
                        <div className="psub">{r.brief}</div>
                      </div>
                    </Link>}
                  </td>
                  <td>
                    <span className={`pill ${r.tone}`}>
                      <span className="pd" />
                      {r.statusLabel}
                    </span>
                  </td>
                  <td>
                    <span className={`nx${r.nextTone ? ` ${r.nextTone}` : ""}`}>{r.next}</span>
                  </td>
                  <td>
                    {r.audience ? (
                      <span className="chip persona">
                        <span className="pgd" style={{ background: r.dot }} />
                        {r.audience}
                      </span>
                    ) : (
                      <span className="nx">—</span>
                    )}
                  </td>
                  <td>{r.channels ? <span className="chan">{r.channels}</span> : <span className="nx">—</span>}</td>
                  <td>
                    <span className="last">
                      <b>{r.updatedRel}</b>
                      {r.updatedAbs && <span>{r.updatedAbs}</span>}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="gfoot">
        <span className="arcnote">
          <i />
          {arcNote}
        </span>
        <div className="pager">
          <span className="pgnum">
            {visible.length === 0 ? "0 of 0" : `1–${visible.length} of ${visible.length}`}
          </span>
        </div>
      </div>

      <NewCampaignModal
        key={newOpen ? "open" : "closed"}
        open={newOpen}
        personaOptions={personaOptions}
        onClose={() => setNewOpen(false)}
        onSubmit={handleCreate}
      />
    </div>
  );
}
