"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import { humanizePersonaLabel as humanizePersona, type AudienceResolution } from "@/domain";
import { type AttachableMediaItem } from "@/lib/campaigns/attach-media";
import {
  type CampaignMediaAsset,
  type CampaignWorkspaceAsset,
  type CampaignWorkspaceAssetCategory,
  type LiveCampaignWorkspace,
} from "@/lib/campaigns/read-model";
import { diffLines } from "@/lib/campaigns/revision-diff";
import { LOCKED_CLAIMS, MEASUREMENT_PLAN } from "@/lib/performance/measurement-copy";
import { buildPerformanceLearning, type CampaignPerformancePanel, type PerformanceTrendPoint } from "@/lib/performance/campaign-panel";

import { ShareDialog } from "../../../_components/share-dialog";
import { ExternalSendModal } from "./external-send-modal";
import { attachCampaignMediaAction, decideCampaignAsset, editCampaignDraftAction, launchCampaignAction, reopenCampaignAsset, requestCampaignRevision } from "../actions";
import {
  getCampaignSharingStateAction,
  setCampaignSharingAction,
  shareCampaignWithMemberAction,
  unshareCampaignMemberAction,
} from "../../sharing-actions";

const svg = (d: string, cls?: string) => <svg viewBox="0 0 24 24" className={cls} dangerouslySetInnerHTML={{ __html: d }} />;

const CATEGORY_LABEL: Record<CampaignWorkspaceAssetCategory, string> = {
  physical: "Direct & physical",
  virtual: "Email & messaging",
  ads: "Paid & social",
  media: "Creative & media",
  other: "Other deliverables",
};
const CATEGORY_ORDER: CampaignWorkspaceAssetCategory[] = ["virtual", "ads", "physical", "media", "other"];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Tone = "ok" | "amber" | "red" | "gray" | "blue";

function statusMeta(status: string): { tone: Tone; label: string } {
  const s = (status || "").toLowerCase();
  if (/approved/.test(s)) return { tone: "ok", label: "Approved" };
  if (/declined|rejected/.test(s)) return { tone: "red", label: "Declined" };
  if (/archived/.test(s)) return { tone: "gray", label: "Archived" };
  // A compliance block is not a routine pending item and must not read as one —
  // it has to be distinguishable at a glance from the amber "Needs review" crowd.
  if (/compliance|blocked/.test(s)) return { tone: "red", label: "Blocked" };
  if (/revision/.test(s)) return { tone: "amber", label: "Revision requested" };
  if (/live|sent|deployed/.test(s)) return { tone: "blue", label: "Live" };
  if (/pending|review/.test(s)) return { tone: "amber", label: "Needs review" };
  return { tone: "gray", label: status ? status.replace(/[_-]+/g, " ") : "Draft" };
}

// A deliverable still accepts a decision until it's approved, archived, or live.
function isActionable(status: string): boolean {
  return !/approved|archived|live|sent|deployed/i.test(status || "");
}

/**
 * Whether to tell the operator this copy's claims are unchecked.
 *
 * The chat path critiques a draft AFTER the reply lands, so for about a minute a
 * card offers Approve with no critique on it — and a card with no critique looks
 * exactly like a card that passed one. That silence is the whole problem: it
 * reads as reassurance. Only worth saying while a decision is still open, and
 * only for copy that actually makes claims (an image has none).
 */
function awaitingClaimsReview(asset: CampaignWorkspaceAsset): boolean {
  return !asset.claimsReviewed && Boolean(asset.body.trim()) && isActionable(asset.status);
}

function lifecycleTone(lifecycle: string): Tone {
  if (lifecycle === "Live") return "blue";
  if (lifecycle === "Ready") return "ok";
  if (lifecycle === "In review") return "amber";
  return "gray";
}

function MediaTile({ media }: { media: CampaignMediaAsset }) {
  const bg = media.thumbnailUrl || (media.type === "image" ? media.url : null);
  // First lineage row ("Made in Higgsfield · soul-x") captions the tile; the
  // full lineage + prompt ride the native tooltip — a 4:3 tile has no room for
  // a paragraph, but the reviewer hovering an AI tile should get the whole story.
  const lineageLine = media.lineage[0]?.[1] ?? null;
  const tooltip = [...media.lineage.map(([, text]) => text), media.prompt ? `Prompt: ${media.prompt}` : null]
    .filter(Boolean)
    .join("\n");
  return (
    <div className="mediatile" title={tooltip || undefined} style={bg ? { backgroundImage: `url(${bg})` } : undefined}>
      <div className="mtscrim" />
      <span className={`mtbadge ${media.origin === "generated" ? "ai" : "real"}`}>
        {media.origin === "generated" ? "AI" : media.type}
      </span>
      <span className="mttitle">
        {media.title}
        {lineageLine ? <em className="mtlineage">{lineageLine}</em> : null}
      </span>
    </div>
  );
}

// Arc's revision, as the line-level diff of the draft it started from against
// the copy standing now. Collapsed by default: the reviewer's default question
// is "is this approvable", and only sometimes "what moved".
function RevisionDiff({ revision }: { revision: { draft: string; current: string } }) {
  const lines = useMemo(() => diffLines(revision.draft, revision.current), [revision.draft, revision.current]);
  const changed = lines.filter((line) => line.kind !== "same").length;

  // Arc recorded a revision but the copy is byte-identical — claiming "0 lines
  // changed" would read as a bug, so keep the plain note.
  if (changed === 0) {
    return (
      <div className="revnote">
        <b>Revised by Arc.</b> Latest reflects your last request.
      </div>
    );
  }

  return (
    <details className="revnote revdiff">
      <summary>
        <b>Revised by Arc.</b> {changed} line{changed === 1 ? "" : "s"} changed — see what changed
      </summary>
      <div className="revdiff-body">
        {lines.map((line, index) => (
          <div className={`revdiff-line is-${line.kind}`} key={index}>
            <span className="revdiff-gutter" aria-hidden="true">
              {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : ""}
            </span>
            {line.kind !== "same" ? <span className="sr-only">{line.kind === "added" ? "Added:" : "Removed:"}</span> : null}
            <span className="revdiff-text">{line.text.trim() ? line.text : " "}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

const NUM = new Intl.NumberFormat("en-US");
const USD0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Compact revenue-over-time area chart. Static (no animation) per the restrained
// motion posture; scales to its container via a non-uniform viewBox.
function TrendChart({ points }: { points: PerformanceTrendPoint[] }) {
  const W = 680;
  const H = 132;
  const PAD = 8;
  const max = Math.max(1, ...points.map((p) => p.revenue));
  const total = points.reduce((s, p) => s + p.revenue, 0);
  const stepX = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
  const x = (i: number) => PAD + i * stepX;
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.revenue).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${(H - PAD).toFixed(1)} L${x(0).toFixed(1)} ${(H - PAD).toFixed(1)} Z`;

  return (
    <div className="ptrend">
      <div className="ptcap">
        <span>Marketing-attributed revenue</span>
        <b>{USD0.format(total)}</b>
      </div>
      <svg className="ptsvg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="ptfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#ptfill)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="ptaxis">
        <span>{points[0]?.week}</span>
        <span>{points[points.length - 1]?.week}</span>
      </div>
    </div>
  );
}

function PerformancePanel({ panel, lifecycle, campaignName }: { panel: CampaignPerformancePanel; lifecycle: string; campaignName?: string }) {
  const learning = buildPerformanceLearning(panel, campaignName);
  if (panel.status === "measuring") {
    return (
      <div>
        <div className="csec">
          <h3 className="csh">
            Performance <span className="est">Measurement plan</span>
          </h3>
          <p className="empty-note" style={{ marginBottom: 4 }}>{panel.message}</p>
          <div className="mplan">
            {MEASUREMENT_PLAN.map((m) => (
              <div className="mprow" key={m.area}>
                <div className="mpk">
                  <span className="mparea">{m.area}</span>
                  <span className="pill amber"><span className="pd" />{m.currentSignal}</span>
                </div>
                <div className="mpq">{m.question}</div>
                <div className="mpn">{m.nextStep}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="csec">
          <h3 className="csh">What stays locked until data is attached</h3>
          <div className="lockgrid">
            {LOCKED_CLAIMS.map((c) => (
              <div className="lockcard" key={c.title}>
                <div className="lockt">
                  {svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>')}
                  {c.title}
                </div>
                <div className="lockd">{c.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const funnelMax = Math.max(1, ...panel.funnel.map((f) => f.count));

  return (
    <div>
      <div className="csec">
        <h3 className="csh">
          Performance
          <span className={`est ${panel.source === "demo" ? "" : "live"}`}>
            {panel.source === "demo" ? "Illustrative" : "Attributed"} · {panel.windowLabel}
          </span>
        </h3>
        <div className="perfkpis">
          {panel.kpis.map((k) => (
            <div className="pkpi" key={k.key}>
              <div className="pkl">{k.label}</div>
              <div className="pkv">{k.value}</div>
              <div className="pkh">
                {k.delta && <span className={`pkd ${k.deltaTone ?? "neutral"}`}>{k.delta}</span>}
                {k.hint}
              </div>
            </div>
          ))}
        </div>
        <p className="perfnote">{panel.note}</p>
      </div>

      {learning && (
        <div className="csec perflearn">
          <h3 className="csh">
            {svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/>')}
            What Arc learned <span className="est">Next move</span>
          </h3>
          <ul className="perflearn-wins">
            {learning.wins.map((win, index) => <li key={index}>{win}</li>)}
          </ul>
          <div className="perflearn-move">
            <div className="perflearn-rec">{learning.recommendation}</div>
            <Link className="perflearn-cta" href={`/arc?new=1&prompt=${encodeURIComponent(learning.arcPrompt)}`}>
              Ask Arc to draft it
              {svg('<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>')}
            </Link>
          </div>
          <p className="perflearn-lock">Outbound stays locked — Arc drafts the next iteration for your approval.</p>
        </div>
      )}

      {panel.trend.length > 1 && (
        <div className="csec">
          <h3 className="csh">Revenue over time <span className="cgc">{panel.windowLabel}</span></h3>
          <TrendChart points={panel.trend} />
        </div>
      )}

      {panel.funnel.length > 0 && (
        <div className="csec">
          <h3 className="csh">Funnel</h3>
          <div className="pfunnel">
            {panel.funnel.map((f) => (
              <div className="pfrow" key={f.label}>
                <span className="pfl">{f.label}</span>
                <div className="pfbar"><i style={{ width: `${Math.round((f.count / funnelMax) * 100)}%` }} /></div>
                <span className="pfc">{NUM.format(f.count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {panel.channels.length > 0 && (
        <div className="csec">
          <h3 className="csh">By channel</h3>
          <div className="pchan">
            <div className="pchead">
              <span>Channel</span><span>Leads</span><span>Booked</span><span>Revenue</span><span>Spend</span>
            </div>
            {panel.channels.map((c) => (
              <div className="pcrow" key={c.channel}>
                <span className="pcname">{c.channel}<i className="pcshare" style={{ width: `${c.share}%` }} /></span>
                <span>{NUM.format(c.leads)}</span>
                <span>{NUM.format(c.booked)}</span>
                <span>{c.revenue}</span>
                <span className="pcspend">{c.spend}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {panel.assets.length > 0 && (
        <div className="csec">
          <h3 className="csh">Asset performance <span className="est">Provenance-tagged</span></h3>
          <div className="passets">
            <div className="pahead">
              <span>Asset</span><span>Source</span><span>Status</span><span>Impr.</span><span>Clicks</span><span>Leads</span><span>CTR</span>
            </div>
            {panel.assets.map((a) => {
              const meta = statusMeta(a.status);
              return (
                <div className="parow" key={a.id}>
                  <span className="paname">
                    <b>{a.title}</b>
                    <i>{a.channel} · {a.format}</i>
                  </span>
                  <span><span className={`prov ${provTone(a.source)}`}>{a.source}</span></span>
                  <span><span className={`pill ${meta.tone}`}><span className="pd" />{meta.label}</span></span>
                  <span className="panum">{NUM.format(a.impressions)}</span>
                  <span className="panum">{NUM.format(a.clicks)}</span>
                  <span className="panum">{NUM.format(a.leads)}</span>
                  <span className="panum">{a.ctr}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {lifecycle !== "Live" && (
        <p className="empty-note">
          This campaign isn&apos;t live yet — figures reflect attribution to date. No sending, spending, or publishing runs without explicit approval.
        </p>
      )}
    </div>
  );
}

// Provenance badge tone — mirrors the asset-review posture (real BSR media vs AI vs composite).
function provTone(source: string): string {
  const s = source.toLowerCase();
  if (s.includes("real")) return "real";
  if (s.includes("ai")) return "ai";
  if (s.includes("composite")) return "composite";
  return "stock";
}

export function CampaignDetailView({ detail, performance, audience, attachableMedia = [] }: { detail: LiveCampaignWorkspace; performance: CampaignPerformancePanel; audience?: AudienceResolution | null; attachableMedia?: AttachableMediaItem[] }) {
  const { campaign, launchState, executiveOverview, reasoning, sources, approvalHistory, media } = detail;
  const [assets, setAssets] = useState<CampaignWorkspaceAsset[]>(detail.assets);
  const [tab, setTab] = useState("deliverables");
  const [reviseFor, setReviseFor] = useState<string | null>(null);
  const [reviseText, setReviseText] = useState("");
  // Inline copy editing: which asset is open, and its working title/body.
  const [editFor, setEditFor] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  // Media attach: which asset's picker is open.
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmLaunch, setConfirmLaunch] = useState(false);
  const [launchErr, setLaunchErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const persona = humanizePersona(campaign.persona);
  const renderableMediaList = media.filter((m) => m.origin !== "referenced");

  // Re-group the (locally owned) assets so optimistic status changes reflect live.
  const grouped = CATEGORY_ORDER.map((cat) => ({ cat, items: assets.filter((a) => a.category === cat) })).filter((g) => g.items.length > 0);
  // BYO send channel: which approved deliverable is open in the export modal.
  const [externalSendFor, setExternalSendFor] = useState<CampaignWorkspaceAsset | null>(null);

  function setAssetStatus(assetId: string, status: string) {
    setAssets((as) => as.map((a) => (a.id === assetId ? { ...a, status, approval: a.approval ? { ...a.approval, status } : a.approval } : a)));
  }

  function decide(asset: CampaignWorkspaceAsset, decision: "approved" | "declined" | "archived") {
    if (pending) return;
    setErr(null);
    const prev = asset.status;
    setAssetStatus(asset.id, decision);
    startTransition(async () => {
      const res = await decideCampaignAsset(campaign.id, asset.id, decision);
      if (!res.ok) {
        setAssetStatus(asset.id, prev);
        setErr(res.error);
      }
    });
  }

  function submitRevision(asset: CampaignWorkspaceAsset) {
    const instruction = reviseText.trim();
    if (!instruction || pending) return;
    setErr(null);
    const prev = asset.status;
    setAssetStatus(asset.id, "revision_requested");
    setReviseFor(null);
    setReviseText("");
    startTransition(async () => {
      const res = await requestCampaignRevision(campaign.id, asset.id, instruction);
      if (!res.ok) {
        setAssetStatus(asset.id, prev);
        setErr(res.error);
      }
    });
  }

  function openEdit(asset: CampaignWorkspaceAsset) {
    setErr(null);
    setReviseFor(null);
    setEditFor(asset.id);
    setEditTitle(asset.title);
    setEditBody(asset.preview ?? "");
  }

  function saveEdit(asset: CampaignWorkspaceAsset) {
    const body = editBody.trim();
    const title = editTitle.trim();
    if (pending || (!body && !title)) return;
    setErr(null);
    const prev = { title: asset.title, preview: asset.preview };
    // Optimistically reflect the edit; the read path coalesces edited_body so a
    // refresh keeps it. Editing never changes the decision — it stays actionable.
    setAssets((as) => as.map((a) => (a.id === asset.id ? { ...a, title: title || a.title, preview: body || a.preview } : a)));
    setEditFor(null);
    startTransition(async () => {
      const res = await editCampaignDraftAction({ campaignId: campaign.id, assetId: asset.id, title, body });
      if (!res.ok) {
        setAssets((as) => as.map((a) => (a.id === asset.id ? { ...a, title: prev.title, preview: prev.preview } : a)));
        setErr(res.error);
      }
    });
  }

  function reopen(asset: CampaignWorkspaceAsset) {
    if (pending) return;
    setErr(null);
    const prev = asset.status;
    // Optimistically flip back to review so the decision controls reappear; the
    // action re-locks dispatch server-side. Revert on failure.
    setAssetStatus(asset.id, "pending_approval");
    startTransition(async () => {
      const res = await reopenCampaignAsset(campaign.id, asset.id);
      if (!res.ok) {
        setAssetStatus(asset.id, prev);
        setErr(res.error);
      }
    });
  }

  function attachMedia(asset: CampaignWorkspaceAsset, item: AttachableMediaItem) {
    if (pending) return;
    setErr(null);
    setPickerFor(null);
    // Optimistic tile (origin "attached" renders like real, non-AI media). The
    // read path reflects the real attachment on the next refresh.
    const tile: CampaignMediaAsset = {
      id: `attach-${item.id}`,
      type: item.kind === "video" ? "video" : "image",
      origin: "attached",
      lineage: [],
      prompt: null,
      title: item.fileName,
      url: item.url,
      thumbnailUrl: item.url,
      mimeType: null,
      description: null,
      source: "library",
      virality: null,
    };
    if (asset.media.some((m) => m.id === tile.id)) return; // already attached this session
    setAssets((as) => as.map((a) => (a.id === asset.id ? { ...a, media: [...a.media, tile] } : a)));
    startTransition(async () => {
      const res = await attachCampaignMediaAction({ campaignId: campaign.id, assetId: asset.id, libraryAssetId: item.id });
      if (!res.ok) {
        setAssets((as) => as.map((a) => (a.id === asset.id ? { ...a, media: a.media.filter((m) => m.id !== tile.id) } : a)));
        setErr(res.error);
      }
    });
  }

  function doLaunch() {
    if (pending) return;
    setErr(null);
    setLaunchErr(null);
    startTransition(async () => {
      const res = await launchCampaignAction(campaign.id);
      if (!res.ok) {
        setLaunchErr(res.error);
        return;
      }
      // launchCampaignAction revalidates this path; the server re-renders with
      // launch_locked cleared, so the launch control unmounts on its own.
      setConfirmLaunch(false);
    });
  }

  const TABS: Array<[string, string]> = [
    ["deliverables", `Deliverables`],
    ["overview", "Overview"],
    ["performance", "Performance"],
    ["sources", "Sources"],
    ["history", "History"],
  ];

  return (
    <div className="arc-campaign">
      <div className="cband">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link className="back" href="/campaigns">
            {svg('<path d="M15 5l-7 7 7 7"/>')}
            Back to Campaigns
          </Link>
          <button className="cbtn" style={{ marginLeft: "auto" }} onClick={() => setShareOpen(true)} aria-label="Share this campaign">
            {svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>')}
            Share
          </button>
        </div>
        <div className="crow">
          <div className="cmain">
            <h1 className="cname">{campaign.name}</h1>
            <div className="csub">{campaign.objective || campaign.audienceSummary}</div>
            <div className="cchips">
              {persona && (
                <span className="chip persona">
                  <span className="pgd" />
                  {persona}
                </span>
              )}
              <span className={`pill ${lifecycleTone(launchState.lifecycle)}`}>
                <span className="pd" />
                {launchState.lifecycle}
              </span>
              {campaign.owner && (
                <span className="chip ghost">
                  {svg('<circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/>', "gi")}
                  {campaign.owner}
                </span>
              )}
              {campaign.launchLocked && (
                <span className="chip ghost">
                  {svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>', "gi")}
                  Outbound locked
                </span>
              )}
            </div>
          </div>
          <div className="cstate">
            <div className="csrow">
              <span className="csv">{launchState.approvedCount}</span>
              <span className="csk">of {launchState.requiredCount} approved</span>
            </div>
            <div className="cstrack">
              <i style={{ width: `${launchState.requiredCount ? Math.round((launchState.approvedCount / launchState.requiredCount) * 100) : 0}%` }} />
            </div>
            <div className="csmeta">
              {launchState.pendingCount} pending · {launchState.deployedCount} live
            </div>
          </div>
        </div>
      </div>

      <div className="ctabs">
        {TABS.map(([key, label]) => (
          <div key={key} className={`ctab${tab === key ? " on" : ""}`} onClick={() => setTab(key)}>
            {label}
            {key === "deliverables" && <span className="cnt">{assets.length}</span>}
          </div>
        ))}
      </div>

      <div className="cbody">
        <div className="cscroll">
          {err && (
            <p className="cerr">{err}</p>
          )}

          {tab === "deliverables" &&
            (grouped.length === 0 ? (
              <p className="empty-note">No deliverables yet. Arc drafts approval-gated pieces here as it builds the package.</p>
            ) : (
              grouped.map(({ cat, items }) => (
                <div className="csec" key={cat}>
                  <h3 className="csh">
                    {CATEGORY_LABEL[cat]} <span className="cgc">{items.length}</span>
                  </h3>
                  {items.map((asset) => {
                    const meta = statusMeta(asset.status);
                    const actionable = isActionable(asset.status);
                    const assetMedia = asset.media.filter((m) => m.origin !== "referenced");
                    return (
                      <div className="deliver" key={asset.id}>
                        <div className="dhead">
                          <div className="dtitle">{asset.title}</div>
                          <span className={`pill ${meta.tone}`}>
                            <span className="pd" />
                            {meta.label}
                          </span>
                        </div>
                        <div className="dmeta">
                          {asset.channel && <span>{asset.channel}</span>}
                          {asset.toolSource && <span>· {asset.toolSource}</span>}
                          <span>· updated {fmtDate(asset.updatedAt)}</span>
                        </div>
                        {asset.preview && <div className="dbody">{asset.preview}</div>}
                        {assetMedia.length > 0 && (
                          <div className="mediagrid">
                            {assetMedia.map((m) => (
                              <MediaTile key={m.id} media={m} />
                            ))}
                          </div>
                        )}
                        {actionable && attachableMedia.length > 0 && (
                          pickerFor === asset.id ? (
                            <div className="mediapicker">
                              <div className="mphead">
                                <b>Attach approved media</b>
                                <button type="button" className="mpclose" onClick={() => setPickerFor(null)} aria-label="Close media picker">
                                  {svg('<path d="M6 6l12 12M18 6L6 18"/>')}
                                </button>
                              </div>
                              <div className="mpgrid">
                                {attachableMedia.map((item) => (
                                  <button
                                    type="button"
                                    key={item.id}
                                    className="mpitem"
                                    onClick={() => attachMedia(asset, item)}
                                    disabled={pending}
                                    title={item.fileName}
                                  >
                                    <span className="mpthumb" style={{ backgroundImage: `url(${item.url})` }} />
                                    <span className="mpname">{item.fileName}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <button type="button" className="addmedia" onClick={() => setPickerFor(asset.id)} disabled={pending}>
                              {svg('<path d="M12 5v14M5 12h14"/>')}
                              Add media
                            </button>
                          )
                        )}
                        {asset.revision && <RevisionDiff revision={asset.revision} />}
                        {asset.blockedPhrases.length > 0 && (
                          <div className="dblocked">
                            <b>Blocked language</b> — this copy contains{" "}
                            {asset.blockedPhrases.map((p) => `“${p}”`).join(", ")}, which your Brand Kit bans.
                            Rewrite it before approving.
                          </div>
                        )}
                        {asset.complianceNotes && <div className="dcompliance">Guardrail: {asset.complianceNotes}</div>}
                        {awaitingClaimsReview(asset) && (
                          <div className="dunrev">
                            <b>Not yet reviewed</b> — nothing has checked these claims against your evidence.
                            On a fresh draft the review usually lands within a minute; until then, an empty
                            review is not a clean one.
                          </div>
                        )}
                        {asset.recommendation && (
                          <div className="drec">
                            <div className="drh">
                              {asset.recommendation.agent} recommends
                              <span className="drv">{asset.recommendation.verdict}</span>
                            </div>
                            {asset.recommendation.rationale && <p className="drb">{asset.recommendation.rationale}</p>}
                            {asset.findings.length > 0 && (
                              <ul className="dfind">
                                {asset.findings.map((f, i) => (
                                  <li key={i} className={f.severity === "blocker" ? "dfb" : undefined}>
                                    {f.claim && <q>{f.claim}</q>} {f.message}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {asset.recommendation.riskFlags.length > 0 && (
                              <div className="flags">
                                {asset.recommendation.riskFlags.map((f) => (
                                  <span className="flag" key={f}>
                                    {f}
                                  </span>
                                ))}
                              </div>
                            )}
                            {asset.recommendation.suggestedEdits && (
                              <p className="drb">
                                <b>Suggested edits:</b> {asset.recommendation.suggestedEdits}
                              </p>
                            )}
                            <p className="drn">Advisory only — you decide.</p>
                          </div>
                        )}

                        {editFor === asset.id ? (
                          <div className="revbox editbox">
                            <input
                              className="editrow-title"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              placeholder="Title"
                              disabled={pending}
                              aria-label="Deliverable title"
                            />
                            <textarea
                              value={editBody}
                              onChange={(e) => setEditBody(e.target.value)}
                              placeholder="Edit the copy…"
                              rows={5}
                              disabled={pending}
                              aria-label="Deliverable copy"
                            />
                            <div className="revactions">
                              <span className="editnote">Edits stay approval-gated — outbound is untouched.</span>
                              <button className="cbtn ghost" onClick={() => setEditFor(null)} disabled={pending}>
                                Cancel
                              </button>
                              <button className="cbtn gold" onClick={() => saveEdit(asset)} disabled={pending || (!editBody.trim() && !editTitle.trim())}>
                                {svg('<path d="M5 12l4 4L19 6"/>')}
                                Save edit
                              </button>
                            </div>
                          </div>
                        ) : reviseFor === asset.id ? (
                          <div className="revbox">
                            <textarea
                              value={reviseText}
                              onChange={(e) => setReviseText(e.target.value)}
                              placeholder="Tell Arc what to change…"
                              rows={2}
                              disabled={pending}
                            />
                            <div className="revactions">
                              <button className="cbtn ghost" onClick={() => { setReviseFor(null); setReviseText(""); }} disabled={pending}>
                                Cancel
                              </button>
                              <button className="cbtn gold" onClick={() => submitRevision(asset)} disabled={pending || !reviseText.trim()}>
                                Send to Arc
                              </button>
                            </div>
                          </div>
                        ) : actionable ? (
                          <div className="dctrls">
                            <button className="cbtn gold" onClick={() => decide(asset, "approved")} disabled={pending}>
                              {svg('<path d="M5 12l4 4L19 6"/>')}
                              Approve
                            </button>
                            <button className="cbtn ghost" onClick={() => openEdit(asset)} disabled={pending}>
                              {svg('<path d="M4 20h4L18.5 9.5a2.1 2.1 0 00-3-3L5 17v3z"/>')}
                              Edit
                            </button>
                            <button className="cbtn ghost" onClick={() => setReviseFor(asset.id)} disabled={pending}>
                              {svg('<path d="M4 7h16M4 12h10M4 17h7"/>')}
                              Request revision
                            </button>
                            <button className="cbtn danger" onClick={() => decide(asset, "declined")} disabled={pending}>
                              Decline
                            </button>
                          </div>
                        ) : (
                          <div className="ddecided">
                            <span>
                              {meta.label}
                              {asset.dispatchLocked && " · outbound stays locked until launch"}
                            </span>
                            {/^approved/i.test(asset.status) && /email|mail/i.test(asset.channel) && (
                              <button type="button" className="cbtn ghost" onClick={() => setExternalSendFor(asset)} disabled={pending} title="Export the approved email for your own send tool — links stay campaign-tagged">
                                {svg('<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>')}
                                Send it yourself
                              </button>
                            )}
                            {/^(approved|archived)/i.test(asset.status) && (
                              <button type="button" className="cbtn ghost dreopen" onClick={() => reopen(asset)} disabled={pending} title="Send this deliverable back to review">
                                {svg('<path d="M4 4v6h6M20 20v-6h-6"/><path d="M20 10a8 8 0 00-14-3M4 14a8 8 0 0014 3"/>')}
                                Reopen
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            ))}

          {tab === "overview" && (
            <div>
              <div className="csec">
                <h3 className="csh">The brief</h3>
                <div className="brief">
                  {([
                    ["What", executiveOverview.what],
                    ["Why now", executiveOverview.why],
                    ["Who", campaign.audienceSummary],
                    ["Offer", campaign.offerSummary],
                    ["Where", executiveOverview.where],
                    ["Timeframe", executiveOverview.timeframe],
                    ["Success tracking", executiveOverview.successTracking],
                  ] as Array<[string, string]>)
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div className="briefrow" key={k}>
                        <div className="bk">{k}</div>
                        <div className="bv">{v}</div>
                      </div>
                    ))}
                </div>
              </div>

              <div className="csec">
                <h3 className="csh">Why Arc built this <span className="est">Arc reasoning</span></h3>
                <div className="card">
                  {reasoning.whyBuilt && <p className="rbody">{reasoning.whyBuilt}</p>}
                  {reasoning.recommendedAction && (
                    <p className="rbody">
                      <b>Recommended:</b> {reasoning.recommendedAction}
                    </p>
                  )}
                  {reasoning.guardrailFlags.length > 0 && (
                    <div className="flags">
                      {reasoning.guardrailFlags.map((f) => (
                        <span className="flag" key={f}>
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                  {reasoning.toolsUsed.length > 0 && <div className="tools">Tools · {reasoning.toolsUsed.join(", ")}</div>}
                </div>
              </div>
            </div>
          )}

          {tab === "performance" && <PerformancePanel panel={performance} lifecycle={launchState.lifecycle} campaignName={detail.campaign.name} />}

          {tab === "sources" && (
            <div className="csec">
              <h3 className="csh">Source-backed evidence</h3>
              {sources.length === 0 ? (
                <p className="empty-note">No sources attached yet.</p>
              ) : (
                sources.map((s) =>
                  s.recordHref ? (
                    <Link className="srcrow" key={s.id} href={s.recordHref}>
                      <span className="srck">{s.kind}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="srct">{s.label}</div>
                        <div className="srcd">{s.detail}</div>
                      </div>
                      <span className="go">→</span>
                    </Link>
                  ) : (
                    <a className="srcrow" key={s.id} href={s.url ?? undefined} target={s.url ? "_blank" : undefined} rel="noreferrer">
                      <span className="srck">{s.kind}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="srct">{s.label}</div>
                        <div className="srcd">{s.detail}</div>
                      </div>
                      {s.url && <span className="go">↗</span>}
                    </a>
                  ),
                )
              )}
            </div>
          )}

          {tab === "history" && (
            <div className="csec">
              <h3 className="csh">Approval history</h3>
              {approvalHistory.length === 0 ? (
                <p className="empty-note">No decisions recorded yet. Approvals, declines, and revision requests land here.</p>
              ) : (
                approvalHistory.map((h) => (
                  <div className="hist" key={h.id}>
                    <span className={`tdot ${h.tone === "green" ? "task" : h.tone === "red" ? "" : "status"}`} style={h.tone === "red" ? { background: "var(--red)" } : undefined} />
                    <div>
                      <div className="ht">
                        {h.action} <span className="by">· {h.decidedBy}</span>
                      </div>
                      <div className="hd">{h.itemTitle}</div>
                      {h.notes && <div className="hd">“{h.notes}”</div>}
                      <div className="hts">{fmtDate(h.at)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <aside className="csnap">
          <div className="snsec">
            <h3 className="snh">Launch readiness</h3>
            <div className="lstate">
              <div className={`lpill ${lifecycleTone(launchState.lifecycle)}`}>{launchState.lifecycle}</div>
              <div className="lrow">
                <span>Approved</span>
                <b>{launchState.approvedCount}</b>
              </div>
              <div className="lrow">
                <span>Pending</span>
                <b>{launchState.pendingCount}</b>
              </div>
              <div className="lrow">
                <span>Required</span>
                <b>{launchState.requiredCount}</b>
              </div>
              <div className="lnote">
                {launchState.ready
                  ? "Every gating piece is approved. Launch is a separate, explicit step."
                  : "Approve the remaining deliverables to make this campaign launch-ready."}
              </div>
            </div>

            {campaign.launchLocked && (
              <div className="lctrl">
                {launchErr && <div className="cerr" style={{ margin: 0 }}>{launchErr}</div>}
                {confirmLaunch ? (
                  <>
                    <button className="cbtn gold" onClick={doLaunch} disabled={pending}>
                      {svg('<path d="M5 12l4 4L19 6"/>')}
                      {pending ? "Launching…" : "Confirm launch"}
                    </button>
                    <button className="cbtn ghost" onClick={() => setConfirmLaunch(false)} disabled={pending}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="cbtn gold"
                    onClick={() => { setErr(null); setLaunchErr(null); setConfirmLaunch(true); }}
                    disabled={!launchState.ready || pending}
                    title={launchState.ready ? undefined : "Approve every gating deliverable first"}
                  >
                    {svg('<path d="M3 12l18-8-8 18-2-7z"/>')}
                    Launch campaign
                  </button>
                )}
                {audience ? (
                  <div className={`lc-audience${audience.eligibleCount === 0 ? " empty" : ""}`}>
                    <svg viewBox="0 0 24 24" aria-hidden dangerouslySetInnerHTML={{ __html: '<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>' }} />
                    <span>Email audience — {audience.summary}</span>
                  </div>
                ) : null}
                <div className="lchint">
                  Launching unlocks approved deliverables for dispatch and opens the Outbox. Nothing sends automatically — you confirm each send there.
                </div>
              </div>
            )}
          </div>

          {renderableMediaList.length > 0 && (
            <div className="snsec">
              <h3 className="snh">Creative</h3>
              <div className="mediagrid">
                {renderableMediaList.slice(0, 4).map((m) => (
                  <MediaTile key={m.id} media={m} />
                ))}
              </div>
            </div>
          )}

          <div className="snsec">
            <h3 className="snh">Package</h3>
            <div className="glance">
              <div className="gl">
                <span className="gk">Deliverables</span>
                <span className="gv">{detail.metrics.assets}</span>
              </div>
              <div className="gl">
                <span className="gk">Creative</span>
                <span className="gv">{detail.metrics.media}</span>
              </div>
              <div className="gl">
                <span className="gk">Sources</span>
                <span className="gv">{detail.metrics.sources}</span>
              </div>
              <div className="gl">
                <span className="gk">Theme</span>
                <span className="gv">{campaign.restorationFocus || "—"}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {externalSendFor ? (
        <ExternalSendModal
          campaignId={campaign.id}
          assetId={externalSendFor.id}
          assetTitle={externalSendFor.title}
          open
          onClose={() => setExternalSendFor(null)}
        />
      ) : null}

      {shareOpen ? (
        <ShareDialog
          subjectId={campaign.id}
          subjectNoun="campaign"
          onClose={() => setShareOpen(false)}
          load={getCampaignSharingStateAction}
          onSetVisibility={(id, visibility, permission) => setCampaignSharingAction({ campaignId: id, visibility, workspacePermission: permission })}
          onAdd={(id, userId, permission) => shareCampaignWithMemberAction({ campaignId: id, userId, permission }).then(() => {})}
          onRemove={(id, userId) => unshareCampaignMemberAction({ campaignId: id, userId }).then(() => {})}
        />
      ) : null}
    </div>
  );
}
