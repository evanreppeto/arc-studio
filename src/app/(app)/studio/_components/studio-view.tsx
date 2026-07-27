"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useMemo, useRef, useState, useTransition } from "react";

import { decideArcDraftAction, requestArcDraftRevisionAction, sendArcMessageAction } from "../../arc/actions";
import { uploadLibraryAsset } from "../../library/actions";
import { generateStudioAsset } from "../actions";

const HOUSE = '<svg viewBox="0 0 600 300" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4654"/><stop offset="1" stop-color="#27303a"/></linearGradient></defs><rect width="600" height="300" fill="url(#sky)"/><path d="M0 210 L150 120 L300 200 L450 110 L600 190 V300 H0 Z" fill="#2b343d"/><path d="M120 230 L300 130 L480 230 Z" fill="#4a5663"/><path d="M120 230 L300 130 L300 250 L120 250 Z" fill="#3d4854"/><rect x="180" y="230" width="240" height="70" fill="#323b45"/><rect x="210" y="248" width="34" height="34" fill="#566270"/><rect x="356" y="248" width="34" height="34" fill="#566270"/></svg>';
const SC: Record<string, string> = {
  roof: HOUSE,
  ai: '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="ga" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a3052"/><stop offset="1" stop-color="#1c2230"/></linearGradient></defs><rect width="100" height="100" fill="url(#ga)"/><circle cx="50" cy="42" r="20" fill="#5a4d7a"/><path d="M18 92c0-16 14-24 32-24s32 8 32 24" fill="#473c66"/></svg>',
  ai2: '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="gd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4452"/><stop offset="1" stop-color="#222a32"/></linearGradient></defs><rect width="100" height="100" fill="url(#gd)"/><path d="M0 62 L30 46 L55 58 L80 42 L100 52 V100 H0 Z" fill="#2c3640"/><circle cx="76" cy="24" r="11" fill="rgba(200,162,74,.34)"/></svg>',
  video: '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><rect width="100" height="100" fill="#222a30"/><path d="M0 70 L40 50 L70 64 L100 44 V100 H0 Z" fill="#2e3a42"/><circle cx="50" cy="46" r="12" fill="rgba(255,255,255,.14)"/><path d="M46 40l9 6-9 6z" fill="#fff"/></svg>',
  comp: '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="gc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c333b"/><stop offset="1" stop-color="#191e24"/></linearGradient></defs><rect width="100" height="100" fill="url(#gc)"/><rect x="20" y="40" width="60" height="20" rx="3" fill="rgba(200,162,74,.18)" stroke="rgba(200,162,74,.5)"/></svg>',
  beforeafter: '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><rect width="50" height="100" fill="#34302a"/><rect x="50" width="50" height="100" fill="#2a3b34"/><path d="M8 72 L25 56 L42 72 Z" fill="#4a443a"/><path d="M58 72 L75 56 L92 72 Z" fill="#3e5a4c"/><rect x="48" width="4" height="100" fill="rgba(200,162,74,.5)"/></svg>',
};
type Prov = "real" | "ai" | "comp" | "upload" | "stock";
export type Item = { s: string; l: string; p: Prov; url?: string };
const PVLABEL: Record<Prov, string> = { real: "Real media", ai: "AI-generated", comp: "Composite", upload: "Imported", stock: "Stock" };
const SRC: Record<string, { title: string; items: Item[] }> = {
  library: { title: "Approved media", items: [{ s: SC.roof, l: "Roof — exterior", p: "real" }, { s: SC.beforeafter, l: "Before / after", p: "real" }, { s: SC.roof, l: "Crew on site", p: "real" }, { s: SC.comp, l: "Logo lockup", p: "comp" }] },
  ai: { title: "Generated this session", items: [{ s: SC.ai, l: "AI hero", p: "ai" }, { s: SC.ai2, l: "AI · seasonal", p: "ai" }, { s: SC.video, l: "AI video still", p: "ai" }] },
  uploads: { title: "Imported", items: [{ s: SC.ai2, l: "midjourney_03.png", p: "upload" }, { s: SC.comp, l: "canva_export.png", p: "upload" }] },
  stock: { title: "Stock", items: [{ s: SC.roof, l: "Stock · house", p: "stock" }, { s: SC.beforeafter, l: "Stock · street", p: "stock" }] },
};
function provShort(p: Prov) { return p === "real" ? "Real" : p === "ai" ? "AI" : p === "upload" ? "Imported" : p === "comp" ? "Composite" : "Stock"; }

export type ProvenanceNote = { tone: "ok" | "warn"; title: string; detail: string };

/**
 * The one media guardrail Studio can honestly compute, as a pure function so every
 * branch is testable. It reports ONLY what the selected item actually carries:
 * its provenance tag (`p`) and whether it resolves to a stored asset (`url` —
 * built-in preview art has none).
 *
 * Deliberately narrow. The panel this replaced also claimed a logo-legibility check,
 * a privacy/face scan and a claim check, all rendered as unconditional green
 * checkmarks; none of those detectors exist, so they were removed rather than left
 * asserting a compliance pass that never ran. Do not add a line here that isn't
 * derived from the item.
 */
export function describeProvenance(item: Item | undefined): ProvenanceNote {
  if (!item) {
    return { tone: "warn", title: "No background selected", detail: "Pick an image from the sources panel to see where it came from." };
  }
  const label = PVLABEL[item.p];
  // No stored asset wins over the tag: preview art can't be approved media whatever
  // it's labelled, and it can't be generated from or sent either.
  if (!item.url) {
    return {
      tone: "warn",
      title: "Sample art — not a stored asset",
      detail: `“${item.l}” is built-in preview art, not something in your Library. It can't be generated from or sent.`,
    };
  }
  if (item.p === "real" || item.p === "comp") {
    return { tone: "ok", title: `Approved Library media · ${label}`, detail: `“${item.l}” came from your approved Library.` };
  }
  return {
    tone: "warn",
    title: `${label} — not approved Library media`,
    detail: `“${item.l}” is tagged ${label.toLowerCase()}. Confirm you have the rights to use it before this goes anywhere.`,
  };
}

const Raw = ({ html }: { html: string }) => <span style={{ position: "absolute", inset: 0 }} dangerouslySetInnerHTML={{ __html: html }} />;

// Real library assets carry a `url` (image/video from media_assets); mock/demo
// items carry an inline SVG in `s`. Render whichever is present.
const ItemMedia = ({ item }: { item: Item }) =>
  item.url ? (
    // eslint-disable-next-line @next/next/no-img-element -- user media URL; next/image would need per-host remotePatterns
    <img src={item.url} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
  ) : (
    <Raw html={item.s} />
  );

const TOOLS = {
  compose: [
    { t: "overlay", target: "design", label: "Brand overlay", d: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 15l4-3 3 2 4-3 5 4"/>' },
    { t: "text", target: "design", label: "Text", d: '<path d="M5 7h14M5 7V5h14v2M12 7v12M9 19h6"/>' },
    { t: "recolor", target: "design", label: "Recolor", d: '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="9" r="1.3"/><circle cx="15" cy="9" r="1.3"/><circle cx="9" cy="15" r="1.3"/>' },
  ],
  generate: [
    { t: "genimg", target: "arc", label: "Image", ai: true, d: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10z"/>' },
    { t: "genvid", target: "arc", label: "Video", ai: true, d: '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="M17 9l4-2v10l-4-2"/>' },
    { t: "vary", target: "arc", label: "Variations", ai: true, d: '<rect x="4" y="4" width="11" height="11" rx="2"/><path d="M9 20h9a2 2 0 002-2V9"/>' },
  ],
  edit: [
    { t: "reframe", target: "arc", label: "Reframe", ai: true, d: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M9 6v12"/>' },
    { t: "expand", target: "arc", label: "Expand", ai: true, d: '<path d="M8 3H5a2 2 0 00-2 2v3M16 3h3a2 2 0 012 2v3M8 21H5a2 2 0 01-2-2v-3M16 21h3a2 2 0 002-2v-3"/>' },
    { t: "cutout", target: "arc", label: "Cut-out", ai: true, d: '<path d="M5 5l14 14M9 5a4 4 0 014 4M5 9a4 4 0 004 4"/><rect x="3" y="3" width="18" height="18" rx="3" stroke-dasharray="3 3"/>' },
    { t: "upscale", target: "arc", label: "Upscale", ai: true, d: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>' },
    { t: "animate", target: "arc", label: "Animate", ai: true, d: '<circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4z"/>' },
  ],
  check: [
    { t: "virality", target: "design", label: "Virality", d: '<path d="M3 17l5-5 4 3 5-7 4 4"/><circle cx="8" cy="12" r="1"/>' },
    { t: "guardrails", target: "design", label: "Guardrails", d: '<path d="M12 3l8 4v6c0 4-3.5 7-8 8-4.5-1-8-4-8-8V7z"/><path d="M9 12l2 2 4-4"/>' },
  ],
} as const;

const FORMATS = [
  { ar: "1 / 1", dim: "1080 × 1080", label: "Square", r: "1:1" },
  { ar: "4 / 5", dim: "1080 × 1350", label: "Portrait", r: "4:5" },
  { ar: "9 / 16", dim: "1080 × 1920", label: "Story", r: "9:16" },
  { ar: "16 / 9", dim: "1920 × 1080", label: "Landscape", r: "16:9" },
];
/**
 * Template tiles. `id` MUST match a CREATIVE_TEMPLATE_IDS value in
 * src/domain/creative-templates.ts — it is sent to generateStudioAsset as the
 * template hint. Previously these tiles were an inline array with labels only and
 * the index was never sent, so the server fell back to selecting a template
 * pseudo-randomly from the background URL: you picked "Minimal" and got whatever
 * the seed hashed to.
 */
export const TEMPLATES = [
  { id: "bold", n: "Bold", bg: "linear-gradient(135deg,#2a2118,#16161a)", c: "#ecd596", fs: 13, fst: "normal" as const, ff: "var(--serif)" },
  { id: "editorial", n: "Editorial", bg: "linear-gradient(135deg,#22222a,#16161a)", c: "#f1ede2", fs: 13, fst: "italic" as const, ff: "var(--serif)" },
  { id: "minimal", n: "Minimal", bg: "#1b1b20", c: "#b9b9c0", fs: 12, fst: "normal" as const, ff: "inherit" },
];

/** Fallback accents when the workspace has no brand palette yet. */
const FALLBACK_SWATCHES = ["#c8a24a", "#7fb89a", "#5b8fd6", "#cc6666", "#f1ede2"];
const SESSION: { id: string; tag: string; item: Item }[] = [
  { id: "v0", tag: "Current", item: { s: SC.roof, l: "Roof — exterior", p: "real" } },
  { id: "v1", tag: "v2", item: { s: SC.ai, l: "Variation 2", p: "ai" } },
  { id: "v2", tag: "v3", item: { s: SC.ai2, l: "Variation 3", p: "ai" } },
  { id: "v3", tag: "9:16", item: { s: SC.beforeafter, l: "Before/After 9:16", p: "comp" } },
  { id: "v4", tag: "9:16", item: { s: SC.video, l: "Crew 9:16", p: "real" } },
];

type CampaignRef = { id: string; name: string; href: string };
type StudioDraft = { campaignId: string; assetId: string; url: string; source: string; format: string; title: string; status: string };

/**
 * Starting copy for the canvas text layers. The sample set is restoration
 * flavoured because the backend-less preview needs a composed-looking creative
 * to be worth looking at — but it is one tenant's marketing copy, and a real
 * workspace that has never drafted anything must not open on it. Live starts
 * empty and the canvas shows placeholders instead.
 */
const SAMPLE_COPY = {
  kicker: "Storm season",
  headline: "Your roof, ready before the next storm.",
  sub: "Free assessment · same-week scheduling",
  cta: "Get my free quote",
};
const EMPTY_COPY = { kicker: "", headline: "", sub: "", cta: "" };

export function StudioView({ brandName, libraryItems, live = false, campaigns = [], mediaEnabled = false, brandPalette = [] }: { brandName: string; libraryItems?: Item[]; live?: boolean; campaigns?: CampaignRef[]; mediaEnabled?: boolean; brandPalette?: string[] }) {
  const startingCopy = live ? EMPTY_COPY : SAMPLE_COPY;
  // The "Approved media" source shows the workspace's real media_assets. Live, it
  // shows ONLY those — never the built-in samples, which would present stock art as
  // the workspace's approved media and let an operator compose over it believing it
  // was theirs. Offline (backend-less preview) the samples keep the tool usable.
  const [uploaded, setUploaded] = useState<Item[]>([]);
  const sources = useMemo<Record<string, { title: string; items: Item[] }>>(
    () => ({
      ...SRC,
      library: live ? { title: "Approved media", items: libraryItems ?? [] } : SRC.library,
      // Imported art: real uploads live-first (empty until you add some); demo samples offline.
      uploads: uploaded.length || live ? { title: "Imported", items: [...uploaded, ...(live ? [] : SRC.uploads.items)] } : SRC.uploads,
    }),
    [libraryItems, uploaded, live],
  );
  const [srcTab, setSrcTab] = useState("library");
  // May be undefined: a live workspace with no approved media (media_assets empty)
  // and nothing uploaded has no background to start on, and the comment above
  // forbids falling back to sample art here. `items[0]` is undefined in that case,
  // so bg is nullable and the canvas below renders an empty state rather than
  // dereferencing undefined — which crashed the whole page on prod (React #418 /
  // "cannot read properties of undefined (reading 'url')").
  const [bg, setBg] = useState<Item | undefined>(sources.library.items[0]);
  const [selTile, setSelTile] = useState(-1);
  const [selSession, setSelSession] = useState("v0");
  const [fmt, setFmt] = useState(0);
  const [mode, setMode] = useState<"image" | "video">("image");
  // The accent swatches are the workspace's OWN brand palette when it has one — the
  // note under them claimed "Pulled from your Brand kit palette" while the list was a
  // hardcoded constant. Falls back to defaults (and says so) for a workspace with no
  // palette set. The first swatch is the initial accent so the canvas opens on-brand.
  const swatches = useMemo(
    () => (brandPalette.length > 0 ? brandPalette : FALLBACK_SWATCHES),
    [brandPalette],
  );
  const [accent, setAccent] = useState(swatches[0] ?? "#c8a24a");
  const [kicker, setKicker] = useState(startingCopy.kicker);
  const [headline, setHeadline] = useState(startingCopy.headline);
  const [sub, setSub] = useState(startingCopy.sub);
  const [cta, setCta] = useState(startingCopy.cta);
  const [safe, setSafe] = useState(false);
  // Per-layer visibility for the canvas. The Layers panel eye toggles drive this;
  // a hidden layer isn't rendered on the canvas, and a hidden text layer is left
  // out of the composited generate so the output matches the preview.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const shown = (layer: string) => !hidden.has(layer);
  const toggleLayer = (layer: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  const [tab, setTab] = useState<"design" | "arc">("design");
  const [tool, setTool] = useState("overlay");
  const [tmpl, setTmpl] = useState(0);
  const [cmode, setCmode] = useState("Draft");
  const [msg, setMsg] = useState("");
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);

  // The composer hands the operator's creative request to Arc: it starts a real
  // Arc conversation (outbound-locked like every Arc turn), seeded with the
  // current Studio context (mode/format/headline), then drops them into the live
  // thread where Arc's reply + drafts stream in. Offline it stays an inert note.
  const askArc = () => {
    const text = msg.trim();
    if (!text || sending || !live) return;
    setSendErr(null);
    const context = `\n\n(From Studio · ${cmode} · ${mode} · ${FORMATS[fmt].r}${headline ? ` · headline: "${headline}"` : ""})`;
    startSend(async () => {
      const result = await sendArcMessageAction({ conversationId: null, body: text + context });
      if (result.ok) {
        setMsg("");
        router.push(`/arc?c=${result.conversationId}`);
        router.refresh();
      } else {
        setSendErr(result.error);
      }
    });
  };

  // Import art: reuse the wired Library upload (real media_assets rows, provenance-
  // tagged, held for review before Arc may reuse). New assets appear under Imported.
  const onUploadFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length || !live) return;
    setSrcTab("uploads");
    setUploading(true);
    setUploadNote(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`);
    let done = 0;
    let failed = 0;
    files.forEach((file) => {
      const fd = new FormData();
      fd.append("file", file);
      uploadLibraryAsset(fd)
        .then((res) => {
          if (res.ok && res.asset) setUploaded((prev) => [{ s: "", l: res.asset!.nm, p: "upload", url: res.asset!.img }, ...prev]);
          else failed++;
        })
        .catch(() => { failed++; })
        .finally(() => {
          done++;
          if (done === files.length) {
            setUploading(false);
            setUploadNote(failed
              ? `${files.length - failed} imported · ${failed} failed`
              : `${files.length} imported — held for review before Arc may reuse.`);
          }
        });
    });
  };

  // Download the selected source asset's real file (approved / generated / imported
  // media). Composed-overlay export is a separate feature; this pulls the underlying file.
  const downloadCurrent = async () => {
    if (!bg?.url) return;
    try {
      const res = await fetch(bg.url);
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = bg?.l || "creative";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      window.open(bg.url, "_blank", "noopener");
    }
  };

  const [campaignId, setCampaignId] = useState<string>(campaigns[0]?.id ?? "");
  // The campaign actually selected in the picker — the Arc pane header used to name a
  // hardcoded campaign ("Storm-Season Reactivation") that no workspace owns.
  const selectedCampaignLabel = campaigns.find((c) => c.id === campaignId)?.name ?? null;
  const [drafts, setDrafts] = useState<StudioDraft[]>([]);
  const [gen, startGen] = useTransition();
  const [genErr, setGenErr] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState<string | null>(null);

  // Why generation is unavailable (honest gating), or null when it's ready.
  const genGate = !mediaEnabled
    ? "Media generation is off — set ARC_MEDIA_ENABLED + GEMINI_API_KEY"
    : !live
      ? "Connect a backend to generate"
      : !campaignId
        ? "Pick a campaign above first"
        : !bg?.url
          ? "Select an approved photo as the background"
          : null;

  // The one media guardrail this app can honestly compute: the provenance tag of the
  // background you actually picked (Item.p), plus whether it resolves to a real stored
  // asset (Item.url — sample/demo art has none). Everything shown in the panel is
  // derived from this; nothing is asserted. `comp` (a composite of approved media)
  // counts as approved-source, AI/stock/imported explicitly do not.
  const provenance = useMemo(() => describeProvenance(bg), [bg]);

  // Compose the current canvas (selected background + Brand Kit + copy) into one
  // approval-gated draft per format. The action lands pending_approval + dispatch_
  // locked — never outbound.
  const runGenerate = (formats: string[]) => {
    if (genGate || gen) return;
    // genGate already blocks when there's no background, but narrow explicitly so
    // backgroundUrl below is a definite string rather than possibly-undefined.
    if (!bg?.url) return;
    setGenErr(null);
    startGen(async () => {
      for (const f of formats) {
        const res = await generateStudioAsset({
          engine: "compose",
          format: f,
          title: headline || "Studio creative",
          backgroundUrl: bg.url,
          // Hidden text layers are omitted so the composite matches the preview.
          // (Background/Logo are composited server-side from the media + brand kit.)
          headline: shown("Headline") ? headline : "",
          kicker: shown("Kicker") ? kicker : "",
          ctaLabel: shown("CTA button") ? cta : "",
          // Send what the operator actually picked, so the render matches the canvas
          // they just approved by eye. Both were previously dropped: the server chose
          // a template from a hash of the background URL and always used the brand
          // kit's accent, whatever the swatches showed.
          template: TEMPLATES[tmpl]?.id,
          accent,
          campaignId,
        });
        if (res.ok && res.assetId && res.media) {
          const media = res.media;
          setDrafts((prev) => [
            { campaignId: res.campaignId ?? campaignId, assetId: res.assetId!, url: media.url, source: media.source, format: media.format, title: headline || "Studio creative", status: "pending_approval" },
            ...prev,
          ]);
        } else if (!res.ok) {
          setGenErr(res.error);
          break;
        }
      }
    });
  };

  // Approve / decline reuse the wired campaign approval action; revise reuses the
  // wired revision request. Outbound stays locked through all of them.
  const decideDraft = async (d: StudioDraft, decision: "approved" | "declined") => {
    if (draftBusy) return;
    setDraftBusy(d.assetId);
    const res = await decideArcDraftAction({ campaignId: d.campaignId, assetId: d.assetId, decision });
    setDraftBusy(null);
    if (res.ok) setDrafts((prev) => prev.map((x) => (x.assetId === d.assetId ? { ...x, status: decision } : x)));
    else setGenErr(res.error);
  };

  const reviseDraft = async (d: StudioDraft) => {
    if (draftBusy) return;
    const instruction = typeof window !== "undefined" ? window.prompt("What should Arc change about this draft?")?.trim() : "";
    if (!instruction) return;
    setDraftBusy(d.assetId);
    const res = await requestArcDraftRevisionAction({ campaignId: d.campaignId, assetId: d.assetId, instruction });
    setDraftBusy(null);
    if (res.ok) setDrafts((prev) => prev.map((x) => (x.assetId === d.assetId ? { ...x, status: "revision_requested" } : x)));
    else setGenErr(res.error);
  };

  const pickTool = (t: (typeof TOOLS)[keyof typeof TOOLS][number]) => {
    setTool(t.t);
    setTab(t.target === "arc" ? "arc" : "design");
  };
  const logoInitial = (brandName || "S").trim().charAt(0).toUpperCase();

  const Tile = ({ item, i }: { item: Item; i: number }) => (
    <div className={`mtile${selTile === i ? " on" : ""}`} onClick={() => { setSelTile(i); setBg(item); }}>
      <div className="mt"><ItemMedia item={item} /><span className={`pv ${item.p}`}>{PVLABEL[item.p]}</span></div>
      <div className="ml">{item.l}</div>
    </div>
  );

  return (
    <div className="arc-studio">
      <div className="studiobar">
        <div className="cxt" title="The campaign a generated draft attaches to">
          <span className="ci"><svg viewBox="0 0 24 24"><path d="M4 5h16v6H4z" /><path d="M4 15h10v4H4z" /></svg></span>
          <div style={{ minWidth: 0 }}>
            <div className="cl">Campaign</div>
            {campaigns.length ? (
              <select className="cn" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={{ maxWidth: 220, background: "transparent", border: 0, color: "inherit", font: "inherit", cursor: "pointer" }}>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <div className="cn">No campaigns yet</div>
            )}
            <div className="cmeta">{campaigns.length ? "attaches on generate · approval-gated" : "create one in Campaigns first"}</div>
          </div>
        </div>
        <span className="proj"><span className="dot" />Untitled creative · autosaved</span>
        <div className="right">
          <button className="iconbtn" title="Undo" data-soon="Undo is coming soon"><svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 010 10h-3" /></svg></button>
          <button className="iconbtn" title="Redo" data-soon="Redo is coming soon"><svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 000 10h3" /></svg></button>
          <span className="cdivr" />
          <a className="gbtn" href="/library"><svg viewBox="0 0 24 24"><path d="M4 7h6l2 2h8v10H4z" /></svg>Save to Library</a>
          <Link className="gbtn gold" href="/campaigns"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>Add to campaign</Link>
        </div>
      </div>

      <div className="studio">
        {/* SOURCES */}
        <aside className="sources">
          <div className="seyl">Sources</div>
          <div className="stabs">
            {["library", "ai", "uploads", "stock"].map((s) => (
              <span key={s} className={`stab${srcTab === s ? " on" : ""}`} onClick={() => { setSrcTab(s); setSelTile(-1); }}>
                {s === "ai" ? "AI" : s.charAt(0).toUpperCase() + s.slice(1)}
              </span>
            ))}
          </div>
          <input ref={fileRef} type="file" multiple accept="image/*,video/*" onChange={onUploadFiles} style={{ display: "none" }} />
          <div className="drop" onClick={() => { if (live) fileRef.current?.click(); }} style={live ? { cursor: "pointer" } : undefined} {...(!live ? { "data-soon": "Connect a backend to import art" } : {})}><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 20h14" /></svg><div className="dt">{uploading ? "Uploading…" : "Upload or import art"}</div><div className="dd">{uploadNote ?? "Bring in art from Canva, Midjourney, DALL·E — anything"}</div></div>
          <div className="srchead"><span className="st">{sources[srcTab].title}</span><span className="sc">{sources[srcTab].items.length} items</span></div>
          <div className="mgrid2">{sources[srcTab].items.map((it, i) => <Tile key={i} item={it} i={i} />)}</div>
          {srcTab === "library" && sources.library.items.length === 0 ? (
            <div className="srcempty">No approved media yet. Upload real photos in the <a href="/library">Library</a> and mark them available to Arc.</div>
          ) : null}
          {srcTab === "ai" && (
            <div className="enginenote"><b>AI generation runs on Higgsfield.</b> Image, video, reframe, upscale, cut-out &amp; motion all come from the connected engine.<span className="ed"><i />Connector off — enable in Settings → Connectors</span></div>
          )}
          <div className="legend">
            <span className="lg pv real">Real media</span><span className="lg pv comp">Composite</span><span className="lg pv ai">AI-generated</span><span className="lg pv upload">Imported</span><span className="lg pv stock">Stock</span>
          </div>
        </aside>

        {/* STAGE */}
        <section className="stage">
          <div className="toolbar">
            {(["compose", "generate", "edit", "check"] as const).map((grp, gi) => (
              <div key={grp} style={{ display: "contents" }}>
                {gi > 0 && <div className="tdiv" />}
                <div className="tgrp">
                  <span className="tglabel">{grp.charAt(0).toUpperCase() + grp.slice(1)}</span>
                  {TOOLS[grp].map((t) => (
                    <div key={t.t} className={`tool${"ai" in t && t.ai ? " ai" : ""}${tool === t.t ? " on" : ""}`} onClick={() => pickTool(t)}>
                      {"ai" in t && t.ai && <span className="tdot" />}
                      <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: t.d }} /><span className="tlbl">{t.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="formats">
            <div className="modeseg">
              <span className={mode === "image" ? "on" : ""} onClick={() => setMode("image")}><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 15l5-4 4 3 3-2 5 4" /></svg>Image</span>
              <span className={mode === "video" ? "on" : ""} onClick={() => setMode("video")}><svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></svg>Video</span>
            </div>
            <span className="fmdiv" />
            <span className="fl">Format</span>
            {FORMATS.map((f, i) => (
              <span key={f.r} className={`fchip${fmt === i ? " on" : ""}`} onClick={() => setFmt(i)}>{f.label} <span className="fr">{f.r}</span></span>
            ))}
            <span className="fspacer" />
            <span className={`szbtn${safe ? " on" : ""}`} onClick={() => setSafe((s) => !s)}><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 8h16M4 16h16" /></svg>Safe zones</span>
            <span className="zoom">Fit · 100%</span>
          </div>

          <div className="stagewrap">
            <div className="artboard">
              <div className={`canvas${safe ? " szon" : ""}${mode === "video" ? " video" : ""}`} style={{ aspectRatio: FORMATS[fmt].ar }}>
                <div className="cbg">
                  {!bg ? (
                    <div className="cbg-empty">No approved media yet — pick a source, upload, or generate to set a background.</div>
                  ) : shown("Background") ? (
                    <ItemMedia item={bg} />
                  ) : null}
                </div>
                <div className="cveil" />
                <div className="cplay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></div>
                {shown("Logo") && <div className="clogo"><span className="lm" style={{ background: accent }}>{logoInitial}</span> {brandName}</div>}
                {bg && <div className="cprov">{PVLABEL[bg.p]}</div>}
                {/* Empty text layers render as muted placeholders rather than
                    collapsed nothing, so a workspace starting from scratch still
                    sees where the copy lands. The CTA is a filled pill — an empty
                    one is just a coloured smudge, so it sits out entirely. */}
                <div className="ctext">
                  {shown("Kicker") && (kicker
                    ? <div className="ckick" style={{ color: accent === "#f1ede2" ? "#f1ede2" : accent }}>{kicker}</div>
                    : <div className="ckick cplace">Kicker</div>)}
                  {shown("Headline") && (headline
                    ? <div className="chead">{headline}</div>
                    : <div className="chead cplace">Your headline goes here.</div>)}
                  <div className={`csub${sub ? "" : " cplace"}`}>{sub || "Supporting line"}</div>
                  {shown("CTA button") && cta && <div className="ccta" style={{ background: accent, color: accent === "#f1ede2" ? "#201808" : "#1a1505" }}>{cta}</div>}
                </div>
                <div className="safez"><div className="szb szt"><span className="szl">caption / UI safe area</span></div><div className="szb szbo" /></div>
              </div>
              <div className="cspec">
                <span>Rendered by <b>Arc</b></span><span className="dotsep" />
                <span><b>{FORMATS[fmt].dim}</b> px</span><span className="dotsep" />
                <span>{brandName} brand kit</span><span className="dotsep" />
                <span className="draftpill">Draft · not approved</span>
              </div>
            </div>
          </div>

          {mode === "video" && (
            <div className="vidtl show">
              <span className="pp"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>
              <span className="tk"><span className="pl" /><span className="ph" /></span>
              <span className="tm">0:05 / 0:15</span>
              <span className="sl" style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)" }}>9:16 · MP4</span>
            </div>
          )}

          <div className="strip">
            {/* Version thumbs and the awaiting-drafts count are sample art. Live
                they'd claim this workspace has variations and drafts pending
                approval that do not exist, so live shows the empty truth. */}
            <span className="sl">This session</span>
            {live ? (
              <span className="sl" style={{ textTransform: "none", letterSpacing: 0 }}>No variations yet</span>
            ) : (
              <>
                {SESSION.slice(0, 3).map((v) => (
                  <span key={v.id} className={`vthumb${selSession === v.id ? " on" : ""}`} onClick={() => { setSelSession(v.id); setBg(v.item); }}><Raw html={v.item.s} /><span className="vtag">{v.tag}</span></span>
                ))}
                <span className="vsdiv" />
                <span className="sl">Drafts · 3 awaiting</span>
                {SESSION.slice(3).map((v) => (
                  <span key={v.id} className={`vthumb${selSession === v.id ? " on" : ""}`} onClick={() => { setSelSession(v.id); setBg(v.item); }}><Raw html={v.item.s} /><span className="vtag">{v.tag}</span></span>
                ))}
              </>
            )}
            <button className="vgen" onClick={() => { setTab("arc"); setMsg((m) => m || "Make a few on-brand variations of this creative."); }}><svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10z" /></svg>Ask Arc for variations</button>
          </div>
        </section>

        {/* INSPECTOR */}
        <aside className="insp">
          <div className="itabs">
            <div className={`itab${tab === "design" ? " on" : ""}`} onClick={() => setTab("design")}><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" /><path d="M4 9h16M9 9v11" /></svg>Design</div>
            <div className={`itab${tab === "arc" ? " on" : ""}`} onClick={() => setTab("arc")}><svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 01-11.5 7.2L4 21l1.8-5.5A8 8 0 1121 12z" /></svg>Arc<span className="ibadge">copilot</span></div>
          </div>

          {tab === "design" ? (
            <div className="ipane">
              <div className="dwrap">
                <div className="brief">
                  <div className="bh"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 5h16v6H4z" /><path d="M4 15h10v4H4z" /></svg>Campaign context</div>
                  <div className="bn">{campaigns.find((c) => c.id === campaignId)?.name ?? "No campaign selected"}</div>
                  <div className="bmeta">generated drafts attach here → pending approval</div>
                  {/* The angle and proof chips are sample brief copy — there is no
                      wired source for a campaign's angle here yet. Showing them
                      live would put another tenant's positioning on this canvas
                      and read as this workspace's own brief. */}
                  {live ? (
                    <div className="brow">Attach this creative to a campaign to work from its angle and proof points.</div>
                  ) : (
                    <>
                      <div className="brow"><b>Angle:</b> Act before the next storm — protect the home you&rsquo;ve already invested in.</div>
                      <div className="bchips"><span className="bchip per">Homeowners · storm-exposed</span><span className="bchip">Proof: before/after</span><span className="bchip">Proof: 4.9★ reviews</span><span className="bchip">Same-week scheduling</span></div>
                    </>
                  )}
                </div>

                <div className="psec">
                  <h3 className="ph2">Layers</h3>
                  <div className="layer sel" style={shown("Background") ? undefined : { opacity: 0.5 }}><span className="li"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 15l4-3 3 2 4-3 5 4" /></svg></span><div style={{ minWidth: 0 }}><div className="lt">Background</div><div className="ld">{bg ? `${bg.l} · ${provShort(bg.p)}` : "No media selected"}</div></div><span className="eye" role="button" tabIndex={0} title={shown("Background") ? "Hide layer" : "Show layer"} aria-label={`${shown("Background") ? "Hide" : "Show"} Background layer`} onClick={() => toggleLayer("Background")} style={{ cursor: "pointer" }}>{shown("Background") ? "◉" : "◎"}</span></div>
                  {[["Kicker", kicker], ["Headline", headline], ["CTA button", cta], ["Logo", brandName]].map(([lt, ld]) => (
                    <div className="layer" key={lt} style={shown(lt) ? undefined : { opacity: 0.5 }}><span className="li"><svg viewBox="0 0 24 24"><path d="M5 8h14M5 12h9" /></svg></span><div style={{ minWidth: 0 }}><div className="lt">{lt}</div><div className="ld">{ld || "Empty"}</div></div><span className="eye" role="button" tabIndex={0} title={shown(lt) ? "Hide layer" : "Show layer"} aria-label={`${shown(lt) ? "Hide" : "Show"} ${lt} layer`} onClick={() => toggleLayer(lt)} style={{ cursor: "pointer" }}>{shown(lt) ? "◉" : "◎"}</span></div>
                  ))}
                </div>

                <div className="psec">
                  <h3 className="ph2">Edit copy</h3>
                  <div className="fieldl"><span>Kicker</span><span>eyebrow</span></div><input className="input" placeholder="Short eyebrow" value={kicker} onChange={(e) => setKicker(e.target.value)} />
                  <div className="field"><div className="fieldl"><span>Headline</span></div><input className="input" placeholder="The one line that has to land" value={headline} onChange={(e) => setHeadline(e.target.value)} /></div>
                  <div className="field"><div className="fieldl"><span>Subhead</span></div><input className="input" placeholder="Supporting detail or offer" value={sub} onChange={(e) => setSub(e.target.value)} /></div>
                  <div className="field"><div className="fieldl"><span>CTA</span></div><input className="input" placeholder="Button text" value={cta} onChange={(e) => setCta(e.target.value)} /></div>
                </div>

                <div className="psec">
                  <h3 className="ph2">Brand color</h3>
                  <div className="swatches">{swatches.map((c) => <span key={c} className={`sw${accent === c ? " on" : ""}`} style={{ background: c }} onClick={() => setAccent(c)} />)}</div>
                  <div className="swnote">{brandPalette.length > 0 ? "From your Brand kit palette — the renderer uses this accent for the CTA." : "Default accents — set a palette in Brand and these become your own. The renderer uses this accent for the CTA."}</div>
                </div>

                <div className="psec">
                  <h3 className="ph2">Template</h3>
                  <div className="tmpl">
                    {TEMPLATES.map((tm, i) => (
                      <div key={tm.id} className={`tmplc${tmpl === i ? " on" : ""}`} onClick={() => setTmpl(i)}><div className="tmi" style={{ background: tm.bg }}><span style={{ fontFamily: tm.ff, color: tm.c, fontSize: tm.fs, fontStyle: tm.fst, fontWeight: 600 }}>Aa</span></div><div className="tmn">{tm.n}</div></div>
                    ))}
                  </div>
                </div>

                {mode === "video" && (
                  <div className="psec">
                    <h3 className="ph2">Audio <span className="tagv">Higgsfield · video</span></h3>
                    {[["Voiceover", "Generate or dub a narration track", "Add →"], ["Music bed", "On-brand background track", "Add →"], ["Captions", "Auto-burned subtitles", "On"]].map(([an, ad, ax]) => (
                      <div className="audrow" key={an} data-soon={`${an} is coming soon`}><span className="ai"><svg viewBox="0 0 24 24"><path d="M12 3v18M8 7v10M16 7v10M4 10v4M20 10v4" /></svg></span><div><div className="an">{an}</div><div className="ad">{ad}</div></div><span className="ax">{ax}</span></div>
                    ))}
                  </div>
                )}

                {/* Media provenance — the ONE guardrail this app can actually compute.
                    It reads the provenance tag of the background you picked (Item.p) plus
                    whether it resolves to a real stored asset (Item.url), so every line
                    here is derived from state, never asserted.

                    The panel used to also claim "Brand logo present & legible", "Privacy
                    scan clear" and a claim-check on hardcoded copy — all rendered
                    unconditionally with green checkmarks. No logo detection, face
                    detection or claim checker exists, so those were removed rather than
                    left as a compliance gate that never ran. */}
                <div className="psec">
                  <h3 className="ph2">Media provenance</h3>
                  <div className="grow">
                    <span className={`gic ${provenance.tone}`}>
                      {provenance.tone === "ok"
                        ? <svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10" /></svg>
                        : <svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9l-8 14A2 2 0 004 21h16a2 2 0 001.7-3l-8-14a2 2 0 00-3.4 0z" /></svg>}
                    </span>
                    <div><div className="gt">{provenance.title}</div><div className="gd">{provenance.detail}</div></div>
                  </div>
                  <div className="grow">
                    <span className="gic warn"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9l-8 14A2 2 0 004 21h16a2 2 0 001.7-3l-8-14a2 2 0 00-3.4 0z" /></svg></span>
                    <div><div className="gt">Review before you send</div><div className="gd">Arc doesn&rsquo;t scan creatives for faces, logo legibility, or unsupported claims — check those yourself. Nothing goes out until you approve it.</div></div>
                  </div>
                </div>

                <div className="psec">
                  <h3 className="ph2">Output spec</h3>
                  <div className="imgproxy">
                    <span className="pxchip">{FORMATS[fmt].label}</span>
                    <span className="pxchip">{FORMATS[fmt].r}</span>
                    <span className="pxchip">{FORMATS[fmt].dim}</span>
                  </div>
                  <div className="scapt">
                    Performance scoring isn&rsquo;t available — Arc has no virality model wired up. These are the
                    dimensions this creative will render at.
                  </div>
                </div>

                <div className="psec">
                  <h3 className="ph2">Generate</h3>
                  {genErr ? <div role="alert" style={{ margin: "0 2px 8px", fontSize: 11, color: "#cc6666", lineHeight: 1.4 }}>{genErr}</div> : null}
                  <div className="exrow gold" onClick={() => runGenerate([FORMATS[fmt].r])} style={!genGate && !gen ? { cursor: "pointer" } : { opacity: 0.55 }} {...(genGate ? { "data-soon": genGate } : {})}><svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10z" /></svg>{gen ? "Generating…" : `Generate creative · ${FORMATS[fmt].r}`}</div>
                  <div className="exrow" onClick={() => runGenerate(FORMATS.map((f) => f.r))} style={!genGate && !gen ? { cursor: "pointer" } : { opacity: 0.55 }} {...(genGate ? { "data-soon": genGate } : {})}><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="5" /><circle cx="12" cy="12" r="3.6" /></svg>Resize for all platforms <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 9, color: "var(--muted)" }}>1:1 4:5 9:16 16:9</span></div>
                </div>

                {drafts.length > 0 && (
                  <div className="psec">
                    <h3 className="ph2">Drafts · {drafts.length}</h3>
                    {drafts.map((d) => (
                      <div className="grow" key={d.assetId} style={{ alignItems: "center", gap: 9 }}>
                        <span style={{ width: 42, height: 42, borderRadius: 6, overflow: "hidden", flexShrink: 0, background: "var(--line)" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- generated media URL */}
                          <img src={d.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="gt">{d.title} · {d.format}</div>
                          <div className="gd">{d.status === "pending_approval" ? "Draft · awaiting your approval" : d.status === "approved" ? "Approved · outbound still locked" : d.status === "declined" ? "Declined" : "Revision requested — Arc will re-draft"}</div>
                        </div>
                        {d.status === "pending_approval" ? (
                          <div className="actl" style={{ flexShrink: 0 }}>
                            <button className="abtn ap" disabled={draftBusy === d.assetId} onClick={() => decideDraft(d, "approved")}><svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10" /></svg>Approve</button>
                            <button className="abtn" disabled={draftBusy === d.assetId} onClick={() => reviseDraft(d)}>Revise</button>
                            <button className="abtn" disabled={draftBusy === d.assetId} onClick={() => decideDraft(d, "declined")}>Decline</button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                    <div className="clock" style={{ marginTop: 7 }}><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>Approving unlocks the next step — nothing sends without an explicit send.</div>
                  </div>
                )}

                <div className="psec">
                  <h3 className="ph2">Export</h3>
                  <a className="exrow" href="/library"><svg viewBox="0 0 24 24"><path d="M4 7h6l2 2h8v10H4z" /></svg>Save to Library</a>
                  <Link className="exrow gold" href={campaignId ? `/campaigns/${campaignId}` : "/campaigns"}><svg viewBox="0 0 24 24"><path d="M4 5h16v6H4z" /><path d="M4 15h10v4H4z" /></svg>Open campaign</Link>
                  <div className="exrow" onClick={downloadCurrent} style={bg?.url ? { cursor: "pointer" } : undefined} {...(!bg?.url ? { "data-soon": "Select an approved photo or video to download its file" } : {})}><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 20h14" /></svg>{bg?.url ? "Download asset" : "Download (PNG / MP4)"}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="ipane">
              <div className="arc">
                {/* This pane is a LAUNCHER, not a transcript: askArc() starts a real Arc
                    conversation and routes to /arc, so no reply is ever rendered here.
                    It used to show a hardcoded conversation — a fake operator message, a
                    fake "Thought for 4s" trace asserting Arc had read the workspace's
                    Library and brand kit (with the real brand name interpolated), and
                    three fake draft cards with no-op Approve/Revise/Decline buttons.
                    None of it came from Arc. Replaced with an honest description of what
                    the composer below actually does. */}
                <div className="archead">
                  <span className="am">A</span>
                  <div>
                    <div className="at">Arc · Creative copilot</div>
                    <div className="ad"><i />{selectedCampaignLabel ? `Working in ${selectedCampaignLabel}` : "No campaign selected"}</div>
                  </div>
                </div>
                <div className="arcscroll">
                  <div className="arcempty">
                    <div className="arcempty-t">Ask Arc about this creative</div>
                    <p className="arcempty-d">
                      Your message starts a new Arc conversation seeded with what&rsquo;s on the canvas — the
                      format, the headline, and the campaign you picked — and opens it in Arc, where the reply
                      and any drafts appear.
                    </p>
                    <p className="arcempty-d">
                      Arc drafts only; nothing it produces goes outbound until you approve it. Drafts you
                      generate here show up under <b>Drafts</b> on the Design tab.
                    </p>
                  </div>
                </div>
                <div className="composer">
                  <div className="modes">{["Ask", "Act", "Draft"].map((m) => <span key={m} className={`mode${cmode === m ? " on" : ""}`} onClick={() => setCmode(m)}>{m}</span>)}</div>
                  <div className="cbox">
                    <textarea
                      rows={1}
                      value={msg}
                      onChange={(e) => setMsg(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askArc(); } }}
                      placeholder={live ? "Ask Arc to edit, generate, or repackage this creative…" : "Connect a backend to chat with Arc"}
                      disabled={!live || sending}
                    />
                    <button
                      className="csend"
                      onClick={askArc}
                      disabled={!live || sending || !msg.trim()}
                      title={live ? "Send to Arc" : "Arc chat needs a connected backend"}
                      {...(!live ? { "data-soon": "Connect a backend to chat with Arc" } : {})}
                    >
                      <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                    </button>
                  </div>
                  {sendErr ? <div role="alert" style={{ margin: "6px 2px 0", fontSize: 11, color: "#cc6666", lineHeight: 1.4 }}>{sendErr}</div> : null}
                  <div className="clock"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>Drafts only — nothing sends until you approve.</div>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
