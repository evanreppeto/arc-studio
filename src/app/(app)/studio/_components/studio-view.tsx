"use client";

import Link from "next/link";
import { type ChangeEvent, type CSSProperties, useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  DEFAULT_MEDIA_CONFIG,
  MEDIA_AUTO,
  generationModelsFor,
  type CreativeLayoutOverride,
  type EngineAvailability,
  type MediaCategory,
  type MediaConfig,
} from "@/domain";

import { resolveArcComposerMode } from "@/lib/arc-chat/composer-mode";
import { hasRepliedToLastMessage } from "@/lib/arc-chat/thread-state";

import { extractCanvasCopy, FIELD_LABEL_TEXT, type CopySuggestion } from "./arc-copy";
import { wantsBrandingInScene } from "./logo-hint";

import { decideArcDraftAction, getArcConversationTailAction, requestArcDraftRevisionAction, sendArcMessageAction, type ArcThreadMessage } from "../../arc/actions";
import { uploadLibraryAsset } from "../../library/actions";
import { generateStudioAsset, pollStudioEdit, pollStudioVideo, startStudioVideo } from "../actions";
import { StudioCanvas, type CanvasBrand, type CanvasLayer } from "./studio-canvas";
import { AppImage } from "../../_components/app-image";

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
/** `id` is the media_assets uuid when the item came from the workspace's real
 *  library. Optional because the demo fixtures and session uploads have none —
 *  which is exactly why a deep link falls back rather than showing nothing. */
export type Item = { s: string; l: string; p: Prov; url?: string; id?: string };
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
    <AppImage src={item.url} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
  ) : (
    <Raw html={item.s} />
  );

/**
 * The stage toolbar — the controls that act on the CANVAS.
 *
 * - `focus` — scrolls the Design pane to the section that control belongs to
 *   (and opens it if it's collapsed).
 * - `soon` — no implementation exists, so it says so through the app's
 *   `data-soon` toast rather than looking like a button that does nothing.
 *
 * The eight AI tools that used to live here have moved into the Arc pane (see
 * ARC_ACTIONS). They never acted on the canvas — every one of them typed a
 * sentence into Arc's composer — and keeping them here is what made this row
 * 1455px wide inside a 636px stage: more than half the toolbar, including the
 * whole Edit group, sat off the right edge behind a horizontal scroll with no
 * scrollbar to suggest it was there. They now sit one click away in the pane
 * that actually answers them, and this row fits.
 */
const TOOLS = {
  compose: [
    { t: "overlay", target: "design", label: "Brand overlay", focus: "sec-parts", d: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 15l4-3 3 2 4-3 5 4"/>' },
    { t: "text", target: "design", label: "Text", focus: "sec-copy", d: '<path d="M5 7h14M5 7V5h14v2M12 7v12M9 19h6"/>' },
    { t: "recolor", target: "design", label: "Recolor", focus: "sec-look", d: '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="9" r="1.3"/><circle cx="15" cy="9" r="1.3"/><circle cx="9" cy="15" r="1.3"/>' },
  ],
  check: [
    { t: "guardrails", target: "design", label: "Guardrails", focus: "sec-prov", d: '<path d="M12 3l8 4v6c0 4-3.5 7-8 8-4.5-1-8-4-8-8V7z"/><path d="M9 12l2 2 4-4"/>' },
    { t: "virality", target: "design", label: "Virality", soon: "Arc can't score creative for reach yet.", d: '<path d="M3 17l5-5 4 3 5-7 4 4"/><circle cx="8" cy="12" r="1"/>' },
  ],
} as const;

type StudioTool = (typeof TOOLS)[keyof typeof TOOLS][number];

/**
 * What you can ask Arc to make, in the Arc pane rather than the stage toolbar.
 *
 * Each one only FILLS the composer — nothing is sent until you press send, so
 * the request stays yours to edit. `image`-only entries are hidden in video
 * mode, where they'd offer to upscale or cut out a clip that doesn't exist yet.
 */
const ARC_ACTIONS = [
  { id: "vary", label: "Variations", ask: "Make a few on-brand variations of this creative.", d: '<rect x="4" y="4" width="11" height="11" rx="2"/><path d="M9 20h9a2 2 0 002-2V9"/>' },
  { id: "genimg", label: "New image", ask: "Generate a new image for this creative.", d: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10z"/>' },
  { id: "genvid", label: "Make a video", ask: "Turn this creative into a short video.", d: '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="M17 9l4-2v10l-4-2"/>' },
  { id: "reframe", label: "Resize", ask: "Resize this creative for the other formats — 1:1, 4:5, 9:16 and 16:9.", d: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M9 6v12"/>' },
  { id: "headlines", label: "Headlines", ask: "Write three headline options for this ad. Put each on its own line starting with 'Headline:'.", d: '<path d="M5 7h14M5 7V5h14v2M12 7v12M9 19h6"/>' },
  { id: "shorter", label: "Punch it up", ask: "Rewrite this creative shorter and punchier. Give the result as lines starting with 'Headline:', 'Subhead:' and 'CTA:'.", d: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>' },
  { id: "expand", label: "Expand", imageOnly: true, ask: "Expand this image to fill more of the frame without cropping the subject.", d: '<path d="M8 3H5a2 2 0 00-2 2v3M16 3h3a2 2 0 012 2v3M8 21H5a2 2 0 01-2-2v-3M16 21h3a2 2 0 002-2v-3"/>' },
  { id: "cutout", label: "Cut-out", imageOnly: true, ask: "Cut the subject out of this photo onto a clean background.", d: '<path d="M5 5l14 14M9 5a4 4 0 014 4M5 9a4 4 0 004 4"/><rect x="3" y="3" width="18" height="18" rx="3" stroke-dasharray="3 3"/>' },
  { id: "upscale", label: "Upscale", imageOnly: true, ask: "Upscale this image to a higher resolution.", d: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>' },
  { id: "animate", label: "Animate", imageOnly: true, ask: "Add gentle motion to this image — a short looping clip.", d: '<circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4z"/>' },
  { id: "photo", label: "Better photo", ask: "Which of my approved photos would work better here?", d: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15l5-4 4 3 3-2 5 4"/>' },
] as const;

/**
 * A collapsible inspector section. Defined at module scope on purpose: a
 * component declared inside StudioView is a new type every render, so React
 * would remount the copy inputs and drop focus on every keystroke.
 */
function Section({ id, title, tag, open = true, children }: { id: string; title: string; tag?: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="psec" id={id} open={open}>
      <summary className="ph2">
        <span className="phchev" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg></span>
        {title}
        {tag ? <span className="tagv">{tag}</span> : null}
      </summary>
      <div className="psecb">{children}</div>
    </details>
  );
}

/**
 * Layer names as a person would say them. The keys stay as they are — they are
 * the contract `studio-canvas` and the exporter share — but "Kicker" and "CTA
 * button" are craft words a roofer has no reason to know, and the Edit-copy
 * panel taught a SECOND one ("eyebrow") for the same element.
 */
const LAYER_LABEL: Record<string, string> = {
  Background: "Photo",
  Logo: "Logo",
  Kicker: "Small line on top",
  Headline: "Headline",
  Subhead: "Supporting line",
  "CTA button": "Button",
};

const FORMATS = [
  { ar: "1 / 1", dim: "1080 × 1080", label: "Square", r: "1:1", use: "Feed post" },
  { ar: "4 / 5", dim: "1080 × 1350", label: "Portrait", r: "4:5", use: "Tall feed post" },
  { ar: "9 / 16", dim: "1080 × 1920", label: "Story", r: "9:16", use: "Story / Reel" },
  { ar: "16 / 9", dim: "1920 × 1080", label: "Landscape", r: "16:9", use: "Wide / web banner" },
];

/**
 * The canvas's inline style: the CSS aspect ratio, plus that ratio as a bare
 * number in `--ar-num`.
 *
 * CSS needs the number because `aspect-ratio` alone cannot make a box fit a
 * height — a `max-height` clamps the used height and leaves the width where it
 * was, squashing the ratio rather than scaling the box. The `.canvas` rule caps
 * width at `100cqh × var(--ar-num)` instead, so the height constraint reaches
 * the width and the artboard scales down whole. Derived from `ar` rather than
 * stored beside it, so the two can't drift apart.
 */
export function arStyle(ar: string): CSSProperties {
  const [w, h] = ar.split("/").map((part) => Number(part.trim()));
  const ratio = Number.isFinite(w) && Number.isFinite(h) && h > 0 ? w / h : 1;
  return { aspectRatio: ar, "--ar-num": ratio } as CSSProperties;
}
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

/**
 * Split the "(From Studio · …)" preamble off a message for display.
 *
 * askArc appends the canvas state to the body it SENDS so Arc knows the format,
 * mode and headline. That preamble is machine context, not something the operator
 * typed — rendering it inside the bubble put "(From Studio · Draft · image · 1:1)"
 * in their own words, and made the message visibly change the moment the canonical
 * thread replaced the optimistic copy (which never had it).
 */
export function splitStudioContext(body: string): { body: string; context: string | null } {
  const match = body.match(/\n*\((From Studio · [^)]*)\)\s*$/);
  if (!match || match.index === undefined) return { body, context: null };
  return { body: body.slice(0, match.index).trim(), context: match[1] };
}

type CampaignRef = { id: string; name: string; href: string };
/** `at` is what lets Studio's own renders and Arc's interleave in one list in
 *  the order they actually happened, rather than one block after the other. */
type StudioDraft = { campaignId: string; assetId: string; url: string; source: string; format: string; title: string; status: string; kind?: "image" | "video"; at: number; /** Who made it — the Generate button, or Arc in the copilot thread. `source`
 *  can't answer this: a Studio composite and an Arc render are both AI-tagged. */ origin: "studio" | "arc" };

/** Veo renders asynchronously; poll about every 10s for up to ~6 minutes. */
const VIDEO_POLL_MS = 10_000;
const VIDEO_MAX_POLLS = 36;
// An edit on a job-based engine is minutes-scale like video, but usually much
// shorter — a tighter interval keeps the canvas responsive without hammering.
const EDIT_POLL_MS = 5_000;
const EDIT_MAX_POLLS = 48;

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

/**
 * Stable identity for "no engine reachable". An object literal in the parameter
 * default allocates a fresh value every render, which is enough for the React
 * Compiler to give up on the component ("existing memoization could not be
 * preserved") — the whole file then falls back to uncompiled. A module constant
 * costs nothing and keeps the optimisation.
 */
const NO_MEDIA_ENGINES: EngineAvailability = { gemini: false, higgsfield: false };

export function StudioView({ brandName, libraryItems, live = false, campaigns = [], mediaEnabled = false, mediaOffReason = null, brandPalette = [], brandTokens = null, mediaConfig = DEFAULT_MEDIA_CONFIG, mediaEngines = NO_MEDIA_ENGINES, initialAssetId = null }: { brandName: string; libraryItems?: Item[]; live?: boolean; campaigns?: CampaignRef[]; mediaEnabled?: boolean; /** Why generation is off, from `resolveMediaGeneration` — already names Settings → Connections. */ mediaOffReason?: string | null; brandPalette?: string[]; brandTokens?: CanvasBrand | null; /** The workspace default the server would resolve anyway — the picker opens on it. */ mediaConfig?: MediaConfig; /** Which engines this workspace can reach; the picker offers only these. */ mediaEngines?: EngineAvailability; /** ?asset=<media_assets uuid> — Library deep-links here so "Edit in Studio" opens on the asset the operator clicked rather than on whatever happens to be first. */ initialAssetId?: string | null }) {
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
  // Open on the deep-linked asset when there is one and it resolves. An id that
  // matches nothing (stale link, asset deleted, different workspace) falls back
  // to the default rather than opening on an empty canvas.
  const deepLinkedIndex = initialAssetId
    ? sources.library.items.findIndex((it) => it.id === initialAssetId)
    : -1;
  const [bg, setBg] = useState<Item | undefined>(
    deepLinkedIndex >= 0 ? sources.library.items[deepLinkedIndex] : sources.library.items[0],
  );
  // Highlight the deep-linked tile too, or Studio opens on an asset with
  // nothing in the sources panel showing which one it is.
  const [selTile, setSelTile] = useState(deepLinkedIndex);
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
  // Canvas editing (BSR-680): which layer is selected, and the operator's nudge.
  // Constrained on purpose — the copy block moves and the headline scales; the
  // template keeps everything else, which is what keeps creative on brand.
  const [selectedLayer, setSelectedLayer] = useState<CanvasLayer | null>(null);
  const [layoutOverride, setLayoutOverride] = useState<CreativeLayoutOverride>({});
  // Includes the logo, or "Reset layout" would put the copy back and leave the
  // mark stranded on the van panel with no way to say "never mind".
  const nudged = Boolean(
    layoutOverride.copyDx ||
      layoutOverride.copyDy ||
      (layoutOverride.headlineScale ?? 1) !== 1 ||
      layoutOverride.logoDx ||
      layoutOverride.logoDy ||
      (layoutOverride.logoScale ?? 1) !== 1 ||
      layoutOverride.logoRotate,
  );

  // Escape drops the selection — but only when focus is not inside a field, or
  // it would fight the modals and the in-place text editor, which use Escape to
  // cancel their own edit.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      setSelectedLayer(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
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
  const [msg, setMsg] = useState("");
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  // The conversation Studio is holding. It used to be thrown at the router the
  // moment it existed, which is why this panel never showed a reply (BSR-681).
  const [convId, setConvId] = useState<string | null>(null);
  const [thread, setThread] = useState<ArcThreadMessage[]>([]);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [streamBody, setStreamBody] = useState<string | null>(null);
  const [reconcileTick, setReconcileTick] = useState(0);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  /** The quick-ask row, open by default and remembered for the session. It is
   *  the whole reason the stage toolbar could shed its AI half, so it must be
   *  reachable at any point in the conversation — not only from an empty pane. */
  const [asksOpen, setAsksOpen] = useState(true);

  /**
   * Grow the composer with the message instead of scrolling a one-line slot.
   * `rows={1}` plus a CSS max-height meant anything past ~12 words scrolled
   * inside a 20px window while three-quarters of the pane sat empty above it.
   * Height is reset to `auto` first, or it can only ever ratchet upward.
   */
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [msg, tab]);

  /**
   * What the transcript actually shows. The runner writes the reply row BEFORE it
   * has a body, so mapping the raw thread rendered an empty bordered bubble above
   * "Arc is thinking…" — the same pending reply drawn twice, once as a blank pill.
   */
  const visibleThread = useMemo(
    () =>
      thread.filter((m) => {
        if (m.role === "operator") return true;
        if (!m.body.trim()) return false;
        // While waiting, the live bubble below already represents the in-flight
        // reply; showing the pending row too would duplicate it mid-stream.
        return !(awaitingReply && m.status === "pending");
      }),
    [thread, awaitingReply],
  );

  const replied = useMemo(() => hasRepliedToLastMessage(thread), [thread]);

  /**
   * The operator asked for branding painted INTO a generated scene, which
   * generation strips by design. A footnote to Arc's answer — never a pre-emption
   * of it.
   *
   * `replied` is load-bearing. This used to render the moment the operator hit
   * send, from their message alone, and it sits below the pending bubble — so the
   * app lectured them about what Arc can't do while Arc was still thinking, before
   * it had a chance to do the part it can. Reported exactly that way.
   *
   * The trigger is narrow now too (see wantsBrandingInScene): the old word list
   * matched "text", "words" and "caption", so editing the canvas copy summoned a
   * warning about logos in generated images.
   */
  const logoHint = useMemo(() => {
    if (!replied) return false;
    const lastOperator = [...thread].reverse().find((m) => m.role === "operator");
    return Boolean(lastOperator && wantsBrandingInScene(splitStudioContext(lastOperator.body).body));
  }, [thread, replied]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);

  // The composer hands the operator's creative request to Arc: it starts a real
  // Arc conversation (outbound-locked like every Arc turn), seeded with the
  // current Studio context (format/headline/background), then drops them into the
  // live thread where Arc's reply + drafts stream in. Offline it stays an inert note.
  //
  // The capability is READ OFF THE REQUEST, not off a control. Studio used to make
  // the operator pick Ask / Act / Draft before typing — three words that only ever
  // went into the preamble string below. `sendArcMessageAction` was never passed a
  // mode at all, so every message ran as `act` whichever button was lit; the
  // control was decoration on a decision Arc had already made. It now runs through
  // the same `resolveArcComposerMode` the main chat composer uses, and the
  // resolved mode is actually sent.
  const askArc = () => {
    const text = msg.trim();
    if (!text || sending || !live) return;
    setSendErr(null);
    const context = `\n\n(From Studio · ${mode} · ${FORMATS[fmt].r}${headline ? ` · headline: "${headline}"` : ""}${bg ? ` · photo: "${bg.l}"` : ""})`;
    // Optimistic: the operator's own words appear immediately, so the panel
    // never looks like it swallowed the message while the round trip runs.
    const localId = `local-${Date.now()}`;
    setThread((prev) => [...prev, { id: localId, role: "operator", body: text, status: "sent", createdAt: new Date().toISOString(), media: [], suggestions: [] }]);
    setMsg("");
    startSend(async () => {
      const result = await sendArcMessageAction({
        conversationId: convId,
        body: text + context,
        // Inferred from what they wrote — the preamble is machine context and
        // must not steer the capability, so the raw request is what's read.
        mode: resolveArcComposerMode({ request: text }),
      });
      if (result.ok) {
        setConvId(result.conversationId);
        setAwaitingReply(true);
      } else {
        // Take the optimistic bubble back rather than leaving a message that
        // was never sent sitting in the thread.
        setThread((prev) => prev.filter((m) => m.id !== localId));
        setMsg(text);
        setSendErr(result.error);
      }
    });
  };
  // Arc answers HERE. Same mechanism the chat page uses — cumulative snapshots
  // over SSE — but rendered in this panel instead of navigating away from the
  // canvas (BSR-681).
  //
  // `done` does NOT end the wait. The stream reports "done" whenever nothing is
  // in flight, and the pending reply row is written by the runner AFTER the send
  // action returns — so subscribing immediately can catch that gap and be told
  // the reply is finished before it has started. Only the reconcile below, which
  // looks for an actual completed reply, decides we are no longer waiting.
  useEffect(() => {
    if (!live || !awaitingReply || !convId) return;
    const source = new EventSource(`/api/arc/stream/${encodeURIComponent(convId)}`);
    source.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data) as { messageId?: string; body?: string };
        if (frame.messageId) setStreamBody(frame.body ?? "");
      } catch {
        /* ignore a malformed frame */
      }
    };
    source.addEventListener("done", () => setReconcileTick((n) => n + 1));
    source.onerror = () => setReconcileTick((n) => n + 1);
    return () => source.close();
  }, [live, awaitingReply, convId]);

  // The canonical thread. Runs on a slow cadence while waiting (and immediately
  // whenever the stream says something changed), and is what actually ends the
  // wait — when a completed Arc reply newer than the message we sent exists.
  useEffect(() => {
    if (!convId) return;
    let cancelled = false;

    const pull = async () => {
      const result = await getArcConversationTailAction({ conversationId: convId });
      if (cancelled || !result.ok) return;
      setThread(result.messages);
      // Decided by POSITION, not by clock — see hasRepliedToLastMessage.
      if (hasRepliedToLastMessage(result.messages)) {
        setAwaitingReply(false);
        setStreamBody(null);
      }
    };

    void pull();
    if (!awaitingReply) return () => { cancelled = true; };

    // Bounded: a reply that never lands stops the poll rather than leaving a
    // timer running for the life of the tab.
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      if (Date.now() - startedAt > 120_000) {
        window.clearInterval(interval);
        setAwaitingReply(false);
        return;
      }
      void pull();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [convId, awaitingReply, reconcileTick]);

  // Keep the newest message in view. Without this the reply streams in below the
  // fold and the panel looks like nothing happened.
  useEffect(() => {
    if (tab !== "arc") return;
    threadEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [visibleThread.length, streamBody, awaitingReply, tab]);

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
  /** Review decisions made this session, by asset id. Kept apart from the draft
   *  records because half of them are derived from the Arc thread and re-read
   *  every few seconds — a status patched into a derived row doesn't survive. */
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const statusOf = (d: StudioDraft) => decisions[d.assetId] ?? d.status;
  /**
   * A rendered draft shown on the artboard in place of the live composite.
   *
   * The canvas only ever painted the SOURCE photo plus editable text — what the
   * renderer actually produced appeared nowhere but a 42px thumbnail in a list,
   * so you generated a creative and the picture in front of you didn't change.
   * `bg` deliberately stays the source: swapping it for the composite would make
   * the next generate bake the copy in a second time.
   */
  const [preview, setPreview] = useState<StudioDraft | null>(null);
  const previewFormat = useMemo(
    () => (preview ? FORMATS.find((f) => f.r === preview.format) ?? FORMATS[fmt] : null),
    [preview, fmt],
  );
  const [gen, startGen] = useTransition();
  const [genErr, setGenErr] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState<string | null>(null);
  /** A revision that saved but that Arc never picked up. Warn, not error: the
   *  request is recorded and nothing was lost — it just isn't running, and
   *  nothing re-surfaces it on its own. */
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [videoPrompt, setVideoPrompt] = useState("");
  /**
   * The model this render uses, per output category.
   *
   * Opens on the workspace default so the picker states what would happen
   * anyway rather than implying Auto when a default is pinned, and the server
   * re-resolves whatever is sent — this control chooses, it does not decide.
   */
  const [modelPick, setModelPick] = useState<Record<MediaCategory, string>>(() =>
    // "Let Arc choose" is the workspace's stance, so the picker opens on Auto
    // there. A pick made HERE still beats it — a deliberate per-render choice
    // outranks a standing preference (see resolveGenerationTarget).
    mediaConfig.autoPick ? { image: MEDIA_AUTO, video: MEDIA_AUTO, audio: MEDIA_AUTO } : { ...mediaConfig.defaults },
  );
  const modelCategory: MediaCategory = mode === "video" ? "video" : "image";
  const modelOptions = generationModelsFor(modelCategory, mediaEngines);
  const activeModel = modelPick[modelCategory];
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoNote, setVideoNote] = useState<string | null>(null);
  const [editNote, setEditNote] = useState<string | null>(null);
  // The video poll loop outlives a fast unmount; this stops it writing state
  // into a component that is gone.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Why generation is unavailable (honest gating), or null when it's ready.
  // A workspace with no campaigns cannot "pick" one, and telling it to is how a
  // gate sends someone to an empty list to look for something that isn't there.
  const hasCampaigns = campaigns.length > 0;
  const campaignGateText = hasCampaigns
    ? "Pick a campaign above first"
    : "Create a campaign first — anything you generate attaches to one";

  // The off-reason comes from `resolveMediaGeneration`, which already names the
  // connector and where to switch it on. The fallback is only for a caller that
  // passes none — it must still not name an env var (BSR-731).
  const genGate = !mediaEnabled
    ? mediaOffReason ?? "Image and video generation isn't switched on for this workspace yet."
    : !live
      ? "Connect a workspace to generate"
      : !campaignId
        ? campaignGateText
        : !bg?.url
          ? "Select an approved photo as the background"
          : null;

  // The one media guardrail this app can honestly compute: the provenance tag of the
  // background you actually picked (Item.p), plus whether it resolves to a real stored
  // asset (Item.url — sample/demo art has none). Everything shown in the panel is
  // derived from this; nothing is asserted. `comp` (a composite of approved media)
  // counts as approved-source, AI/stock/imported explicitly do not.
  const provenance = useMemo(() => describeProvenance(bg), [bg]);

  /** Editing needs a real stored picture to act ON, which is a different
   *  requirement from generating one — say which is missing. */
  const editGate = !mediaEnabled
    ? mediaOffReason ?? "Image generation isn't switched on for this workspace yet."
    : !live
      ? "Connect a workspace to edit images"
      : !campaignId
        ? campaignGateText
        : !bg?.url
          ? "Pick a photo to change first"
          : null;

  // Compose the current canvas (selected background + Brand Kit + copy) into one
  // approval-gated draft per format. The action lands pending_approval + dispatch_
  // locked — never outbound.
  /**
   * Change the picture that's on the canvas, instead of generating a new one.
   *
   * The distinction is the whole feature: "put our logo on the van door" and
   * "warm the light" are edits to a photo already chosen, and regenerating from
   * a prompt throws it away and rolls the dice again. Studio could only generate,
   * which is why that request used to be answered with a rule.
   *
   * Lands as an approval-gated draft exactly like every other output.
   */
  const runEdit = () => {
    if (!live || gen || !bg?.url || !campaignId) return;
    const instruction = typeof window !== "undefined"
      ? window.prompt("What should change about this image?\n\ne.g. put our logo on the van door, warm the morning light")?.trim()
      : "";
    if (!instruction) return;
    setGenErr(null);
    startGen(async () => {
      const res = await generateStudioAsset({
        engine: "edit",
        sourceImageUrl: bg.url!,
        instruction,
        format: FORMATS[fmt].r,
        title: instruction.slice(0, 60),
        campaignId,
        model: modelPick.image,
      });
      if (!res.ok) {
        setGenErr(res.error);
        return;
      }
      const title = instruction.slice(0, 60);
      const land = (campaign: string, assetId: string, media: { url: string; source: StudioDraft["source"]; format: string }) => {
        const draft: StudioDraft = { campaignId: campaign, assetId, url: media.url, source: media.source, format: media.format, title, status: "pending_approval", at: Date.now(), origin: "studio" };
        setDrafts((prev) => [draft, ...prev]);
        setPreview(draft);
      };

      // A job-based engine renders for longer than one request can wait, so the
      // action hands back an operation name and we finish it here — the same
      // shape the video button has always used.
      if (res.status === "running") {
        setEditNote("Editing — this can take a minute.");
        for (let i = 0; i < EDIT_MAX_POLLS; i++) {
          await new Promise((r) => setTimeout(r, EDIT_POLL_MS));
          if (!aliveRef.current) return;
          const poll = await pollStudioEdit({
            operationName: res.operationName,
            ticket: res.ticket,
            // Round-tripped so the poll asks the engine that started it; the
            // server checks it against the signed ticket, so the client cannot
            // redirect it at the other provider.
            engine: res.engine,
            instruction,
            format: FORMATS[fmt].r,
            title,
            campaignId,
          });
          if (!aliveRef.current) return;
          if (!poll.ok) {
            setEditNote(null);
            setGenErr(poll.error);
            return;
          }
          if (poll.status === "done") {
            setEditNote(null);
            land(poll.campaignId, poll.assetId, poll.media);
            return;
          }
        }
        setEditNote(null);
        // The edit is real and paid for; it finishes on the engine's side and
        // lands in the Library. Saying "failed" would be a false statement
        // about the operator's credits.
        setGenErr("Still rendering after a few minutes — it was submitted and will appear in your Library when it finishes.");
        return;
      }

      if (res.assetId && res.media) land(res.campaignId ?? campaignId, res.assetId, res.media);
    });
  };

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
          subhead: shown("Subhead") ? sub : "",
          ctaLabel: shown("CTA button") ? cta : "",
          // Send what the operator actually picked, so the render matches the canvas
          // they just approved by eye. Both were previously dropped: the server chose
          // a template from a hash of the background URL and always used the brand
          // kit's accent, whatever the swatches showed.
          template: TEMPLATES[tmpl]?.id,
          // What the operator moved on the canvas has to reach the render, or
          // the drag was theatre (BSR-680).
          layoutOverride,
          accent,
          campaignId,
        });
        if (res.ok && res.status !== "running" && res.assetId && res.media) {
          const media = res.media;
          const draft: StudioDraft = { campaignId: res.campaignId ?? campaignId, assetId: res.assetId, url: media.url, source: media.source, format: media.format, title: headline || "Studio creative", status: "pending_approval", at: Date.now(), origin: "studio" };
          setDrafts((prev) => [draft, ...prev]);
          // Put the render on the artboard. Only for the format that's actually
          // selected — a "resize for all platforms" run would otherwise leave the
          // canvas showing 16:9 while the format bar still reads 1:1.
          if (f === FORMATS[fmt].r) setPreview(draft);
        } else if (!res.ok) {
          setGenErr(res.error);
          break;
        }
      }
    });
  };

  // Video is its own engine: it needs a described SCENE, not a background photo
  // to composite over, so it has its own prompt and its own gate. The render is
  // async (start → poll), which is why this can't reuse runGenerate's transition.
  // Veo takes landscape or portrait only; mirror the server's videoAspectFor so
  // the button never promises a ratio the render won't produce.
  const videoAspect = FORMATS[fmt].r === "9:16" ? "9:16" : "16:9";
  const videoGate = !mediaEnabled
    ? mediaOffReason ?? "Image and video generation isn't switched on for this workspace yet."
    : !live
      ? "Connect a workspace to generate"
      : !campaignId
        ? campaignGateText
        : !videoPrompt.trim()
          ? "Describe the video you want first"
          : null;

  const runVideo = async () => {
    if (videoGate || videoBusy) return;
    const prompt = videoPrompt.trim();
    const title = headline.trim() || "Studio video";
    setGenErr(null);
    setVideoBusy(true);
    setVideoNote("Starting the render…");
    try {
      // Animate the photo on the canvas when there is one. Without it Veo
      // invents a scene from the words and the picture the operator picked is
      // silently ignored — which is what "Animate" has always done.
      const started = await startStudioVideo({ prompt, format: FORMATS[fmt].r, campaignId, sourceImageUrl: bg?.url, model: modelPick.video });
      if (!started.ok) {
        setGenErr(started.error);
        return;
      }
      setVideoNote("Rendering — this usually takes 1–3 minutes.");
      for (let i = 0; i < VIDEO_MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, VIDEO_POLL_MS));
        if (!aliveRef.current) return;
        const poll = await pollStudioVideo({
          operationName: started.operationName,
          ticket: started.ticket,
          // Round-tripped so the poll asks the engine that started the job. The
          // server verifies it against the signed ticket, so this is a hint the
          // client cannot lie with.
          engine: started.engine,
          model: started.model,
          prompt,
          format: started.aspectRatio,
          title,
          campaignId,
        });
        if (!aliveRef.current) return;
        if (!poll.ok) {
          setGenErr(poll.error);
          return;
        }
        if (poll.status === "done") {
          const draft: StudioDraft = { campaignId: poll.campaignId, assetId: poll.assetId, url: poll.media.url, source: poll.media.source, format: poll.media.format, title, status: "pending_approval", kind: "video", at: Date.now(), origin: "studio" };
          setDrafts((prev) => [draft, ...prev]);
          setPreview(draft);
          return;
        }
      }
      // Don't claim failure for work that is probably still running — the draft
      // lands on the campaign whenever it finishes.
      setGenErr("Still rendering after 6 minutes. It should appear on the campaign shortly.");
    } finally {
      if (aliveRef.current) {
        setVideoBusy(false);
        setVideoNote(null);
      }
    }
  };

  // Approve / decline reuse the wired campaign approval action; revise reuses the
  // wired revision request. Outbound stays locked through all of them.
  //
  // The decision is recorded in its own map rather than patched into `drafts`,
  // because half the list is derived from the Arc thread and cannot be patched:
  // approving one of Arc's renders would have flipped to "approved" and then
  // silently reverted on the next 3s tail pull.
  const decideDraft = async (d: StudioDraft, decision: "approved" | "declined") => {
    if (draftBusy) return;
    setDraftBusy(d.assetId);
    const res = await decideArcDraftAction({ campaignId: d.campaignId, assetId: d.assetId, decision });
    setDraftBusy(null);
    if (res.ok) setDecisions((prev) => ({ ...prev, [d.assetId]: decision }));
    else setGenErr(res.error);
  };

  const reviseDraft = async (d: StudioDraft) => {
    if (draftBusy) return;
    const instruction = typeof window !== "undefined" ? window.prompt("What should Arc change about this draft?")?.trim() : "";
    if (!instruction) return;
    setDraftBusy(d.assetId);
    const res = await requestArcDraftRevisionAction({ campaignId: d.campaignId, assetId: d.assetId, instruction });
    setDraftBusy(null);
    if (!res.ok) return setGenErr(res.error);
    setDecisions((prev) => ({ ...prev, [d.assetId]: "revision_requested" }));
    // The status flip above says "revision requested", which is true — but it
    // says nothing about whether Arc took the job. On a dropped wake the request
    // is recorded and never runs, and nothing re-surfaces it, so silence here
    // reads as "under way" when it isn't (BSR-695). Retry lives on the campaign
    // (retryCampaignRevision re-wakes the existing task); asking again from here
    // would queue a second one.
    setDraftNotice(
      res.persisted && res.dispatched === false
        ? "Saved, but Arc hasn't picked it up — open the campaign to send it again."
        : null,
    );
  };

  /**
   * Arc's own renders, lifted out of the transcript and into the same Drafts list
   * the Generate button fills.
   *
   * This is the promise the pane's empty state has been making and not keeping:
   * "anything Arc renders shows up under Drafts on the Design tab, and on the
   * artboard, for your approval." It didn't. `ArcThreadMessage` carried body and
   * role only, so a reply that had just generated a creative arrived here as a
   * paragraph describing a picture the operator could not see — in a tool whose
   * entire job is looking at the picture.
   *
   * DERIVED, not synced into `drafts`: the tail is re-pulled every 3s while
   * waiting, so an effect that merged into state would be a setState inside an
   * effect on a 3s timer. Only media carrying an approval is listed — the rows
   * offer Approve / Revise / Decline and those need a real campaign + asset to
   * act on. Media without one still renders inline in the thread and still opens
   * on the artboard; it just isn't offered as something you can approve.
   */
  const arcDrafts = useMemo<StudioDraft[]>(() => {
    const out: StudioDraft[] = [];
    for (const message of thread) {
      if (message.role === "operator") continue;
      for (const media of message.media) {
        if (!media.campaignId || !media.assetId) continue;
        out.push({
          campaignId: media.campaignId,
          assetId: media.assetId,
          url: media.url,
          source: "ai_generated",
          format: media.format ?? "—",
          title: media.caption ?? "Arc draft",
          status: "pending_approval",
          kind: media.kind,
          at: Date.parse(message.createdAt) || 0,
          origin: "arc",
        });
      }
    }
    return out;
  }, [thread]);

  /**
   * Everything awaiting review this session, newest first, whether Studio's
   * Generate button made it or Arc did. Deduped by assetId — Arc's reply and a
   * local generate can name the same asset — with the local copy winning, since
   * it is the one whose decisions this component has been tracking.
   */
  const allDrafts = useMemo(() => {
    const byId = new Map<string, StudioDraft>();
    for (const d of arcDrafts) byId.set(d.assetId, d);
    for (const d of drafts) byId.set(d.assetId, d);
    return [...byId.values()].sort((a, b) => b.at - a.at);
  }, [arcDrafts, drafts]);

  /** Put a piece of Arc's creative on the artboard. Media with no approval has
   *  no asset id to key on, so it gets one derived from its url — enough to
   *  drive the selected-thumbnail highlight without pretending to be a draft. */
  const previewArcMedia = (media: ArcThreadMessage["media"][number]) => {
    setPreview({
      campaignId: media.campaignId ?? "",
      assetId: media.assetId ?? `arc:${media.url}`,
      url: media.url,
      source: "ai_generated",
      format: media.format ?? "—",
      title: media.caption ?? "Arc draft",
      status: media.assetId ? "pending_approval" : "unlinked",
      kind: media.kind,
      // Not a list entry — nothing sorts the artboard — so it carries no
      // timestamp rather than a made-up one.
      at: 0,
      origin: "arc",
    });
  };

  /**
   * Reuse one of Arc's renders as the canvas background, so the next Generate
   * composites your copy and logo over it.
   *
   * Offered ONLY for a generated scene (`ai_generated`). A `composite` already
   * has the brand lockup and the headline burned into its pixels — making it the
   * background would composite them a second time, text over text. That is the
   * same trap the preview state avoids by never swapping `bg` for a render, and
   * `source` is the field that tells the two apart.
   */
  const applyArcMediaAsBackground = (media: ArcThreadMessage["media"][number]) => {
    if (media.kind !== "image" || media.source !== "ai_generated") return;
    setBg({ s: "", l: media.caption ?? "Arc image", p: "ai", url: media.url });
    // Drop the tile selection: the background no longer matches anything in the
    // sources panel, and a stale ring would point at the wrong photo.
    setSelTile(-1);
    setPreview(null);
    setTab("design");
  };

  /** Put one of Arc's suggested lines into the canvas field it belongs to. One
   *  field per click, never a batch — the operator sees each change land. */
  const applyCopy = (suggestion: CopySuggestion) => {
    if (suggestion.field === "kicker") setKicker(suggestion.value);
    else if (suggestion.field === "headline") setHeadline(suggestion.value);
    else if (suggestion.field === "subhead") setSub(suggestion.value);
    else setCta(suggestion.value);
  };

  /** Fill the composer without sending, and make sure the pane is showing.
   *  Never overwrites: a half-typed message is the operator's, not ours. */
  const seedAsk = (ask: string) => {
    setTab("arc");
    setMsg((m) => (m.trim() ? m : ask));
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  /** Start over. Without this the pane was welded to the first conversation it
   *  opened for the life of the tab — you could scroll the old thread, and that
   *  was all. */
  const resetThread = () => {
    setConvId(null);
    setThread([]);
    setAwaitingReply(false);
    setStreamBody(null);
    setSendErr(null);
  };

  const pickTool = (t: StudioTool) => {
    // `data-soon` already toasted; don't also move the operator somewhere that
    // has nothing to show them.
    if ("soon" in t && t.soon) return;
    setTool(t.t);
    setTab("design");
    if (!("focus" in t) || !t.focus) return;
    const target = t.focus;
    // After the tab has painted — the section doesn't exist to scroll to until then.
    requestAnimationFrame(() => {
      const el = document.getElementById(target);
      if (!el) return;
      if (el instanceof HTMLDetailsElement) el.open = true;
      el.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  };
  const logoInitial = (brandName || "S").trim().charAt(0).toUpperCase();
  // What the canvas paints with. The accent is the swatch the operator picked
  // (the same value sent to the renderer); everything else comes from the Brand
  // Kit so the preview's colours are the export's colours. Without a kit we fall
  // back to the renderer's own neutral tokens rather than inventing a palette.
  const canvasBrand: CanvasBrand = {
    primary: brandTokens?.primary ?? "#16161a",
    secondary: brandTokens?.secondary ?? "#2a2a32",
    accent,
    dark: brandTokens?.dark ?? "#0f1115",
    light: brandTokens?.light ?? "#f1ede2",
    displayName: brandTokens?.displayName ?? brandName,
    shortMark: brandTokens?.shortMark ?? logoInitial,
  };

  const Tile = ({ item, i }: { item: Item; i: number }) => (
    <div className={`mtile${selTile === i ? " on" : ""}`} onClick={() => { setSelTile(i); setBg(item); }}>
      <div className="mt"><ItemMedia item={item} /><span className={`pv ${item.p}`}>{PVLABEL[item.p]}</span></div>
      <div className="ml">{item.l}</div>
    </div>
  );

  return (
    <div className="arc-studio">
      <h1 className="sr-only">Studio</h1>
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
            <div className="cmeta">{campaigns.length ? "Anything you make here gets attached for approval" : "Create a campaign first, then anything you make here attaches to it"}</div>
          </div>
        </div>
        <span className="proj"><span className="dot" />Untitled creative · autosaved</span>
        <div className="right">
          <button type="button" className="iconbtn" aria-label="Undo" title="Undo — not available yet" disabled><svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 010 10h-3" /></svg></button>
          <button type="button" className="iconbtn" aria-label="Redo" title="Redo — not available yet" disabled><svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 000 10h3" /></svg></button>
          <span className="cdivr" />
          <a className="gbtn" href="/library"><svg viewBox="0 0 24 24"><path d="M4 7h6l2 2h8v10H4z" /></svg>Save to Library</a>
          {/* Sent to /campaigns even with a campaign picked two controls to the
              left, which dropped you on a list to find the one you'd already chosen.
              THREE states, not two: a workspace with no campaigns at all was told
              to "Pick a campaign" — the primary action on the screen inviting a
              choice from an empty list, directly under a banner explaining that
              none exist yet. */}
          <Link className="gbtn gold" href={campaignId ? `/campaigns/${campaignId}` : "/campaigns"}>
            <svg viewBox="0 0 24 24"><path d="M4 5h16v6H4z" /><path d="M4 15h10v4H4z" /></svg>
            {campaignId ? "Open campaign" : hasCampaigns ? "Pick a campaign" : "Create a campaign"}
          </Link>
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
          <div className="drop" onClick={() => { if (live) fileRef.current?.click(); }} style={live ? { cursor: "pointer" } : undefined} {...(!live ? { "data-soon": "Connect a workspace to import art" } : {})}><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 20h14" /></svg><div className="dt">{uploading ? "Uploading…" : "Upload or import art"}</div><div className="dd">{uploadNote ?? "Bring in art from Canva, Midjourney, DALL·E — anything"}</div></div>
          <div className="srchead"><span className="st">{sources[srcTab].title}</span><span className="sc">{sources[srcTab].items.length} items</span></div>
          <div className="mgrid2">{sources[srcTab].items.map((it, i) => <Tile key={i} item={it} i={i} />)}</div>
          {srcTab === "library" && sources.library.items.length === 0 ? (
            <div className="srcempty">No approved media yet. Upload real photos in the <a href="/library">Library</a> and mark them available to Arc.</div>
          ) : null}
          {srcTab === "ai" && (
            // The "Connector off" chip here used to be hardcoded, so it went on
            // saying off after Higgsfield was connected AND after the app could
            // execute it. Status that is painted rather than read is worse than
            // no status: it argues with the picker two panels over.
            <div className="enginenote">
              <b>AI generation runs on {mediaEngines.higgsfield ? "Higgsfield and the built-in engine" : "the built-in engine"}.</b>{" "}
              Pick the model for a render with the Model control beside the generate buttons.
              {!mediaEngines.higgsfield && !mediaEngines.gemini ? (
                <span className="ed"><i />No engine connected — enable one in Settings → Connections</span>
              ) : null}
            </div>
          )}
          <div className="legend">
            <span className="lg pv real">Real media</span><span className="lg pv comp">Composite</span><span className="lg pv ai">AI-generated</span><span className="lg pv upload">Imported</span><span className="lg pv stock">Stock</span>
          </div>
        </aside>

        {/* STAGE */}
        <section className="stage">
          {/* Each group is one atomic box on a single scrolling row — see the
              .toolbar rule for why this can't wrap. The standalone 1px rules
              that used to sit between the groups are gone: the labels already
              carry the grouping, and a wrapped row stranded them. */}
          <div className="toolbar">
            {/* No uppercase group captions: with five self-describing controls
                left they cost ~105px of the row to label two obvious clusters,
                and the row's job now is to fit. The 16px inter-group gap against
                the 2px intra-group gap still reads as grouping. */}
            {(["compose", "check"] as const).map((grp) => (
              <div className="tgrp" key={grp}>
                <div className="tgrpt">
                  {TOOLS[grp].map((t) => (
                    <button
                      type="button"
                      key={t.t}
                      className={`tool${tool === t.t ? " on" : ""}`}
                      aria-pressed={tool === t.t}
                      title={t.label}
                      onClick={() => pickTool(t)}
                      {...("soon" in t && t.soon ? { "data-soon": t.soon } : {})}
                    >
                      <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: t.d }} /><span className="tlbl">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {/* The one entry point to everything AI, in place of the eight pills
                that used to sit here — five of them past the right edge. */}
            <button type="button" className="toolarc" onClick={() => { setTab("arc"); requestAnimationFrame(() => composerRef.current?.focus()); }} title="Open the Arc copilot — generate, resize, upscale, animate">
              <span className="tdot" />
              <svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 01-11.5 7.2L4 21l1.8-5.5A8 8 0 1121 12z" /></svg>
              <span className="tlbl">Ask Arc</span>
            </button>
          </div>

          <div className="formats">
            <div className="modeseg">
              <span className={mode === "image" ? "on" : ""} onClick={() => setMode("image")}><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 15l5-4 4 3 3-2 5 4" /></svg>Image</span>
              <span className={mode === "video" ? "on" : ""} onClick={() => setMode("video")}><svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></svg>Video</span>
            </div>
            <span className="fmdiv" />
            <span className="fl">Format</span>
            {FORMATS.map((f, i) => (
              <span key={f.r} className={`fchip${fmt === i ? " on" : ""}`} title={`${f.use} · ${f.dim} px`} onClick={() => setFmt(i)}>{f.label} <span className="fr">{f.r}</span></span>
            ))}
            {/* Only offered once something has been moved — an always-present
                "Reset layout" on an untouched canvas is noise. */}
            {nudged && (
              <span
                className="szbtn"
                role="button"
                tabIndex={0}
                onClick={() => setLayoutOverride({})}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLayoutOverride({}); } }}
                title="Put the copy back where the template puts it"
              >
                <svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" /></svg>
                Reset layout
              </span>
            )}
            <span className="fspacer" />
            {/* "Zoom 100%" sat here: a static string, no zoom control anywhere,
                permanently reading 100% whatever the artboard was doing. */}
            <span className={`szbtn${safe ? " on" : ""}`} onClick={() => setSafe((s) => !s)}><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 8h16M4 16h16" /></svg>Keep text clear of edges</span>
          </div>

          {/* A stage-wide mode banner, not a caption on the artboard: keeping it
              out of .artboard means the artboard is the same two-box column in
              both modes, so the fit maths below has one case, not two. */}
          {preview ? (
            <div className="prevbar">
              <span className="pvi"><svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10" /></svg></span>
              <div className="pvt">
                <b>This is the finished render</b>
                <span>{preview.title} · {preview.format} · draft, not approved</span>
              </div>
              <button type="button" className="pvback" onClick={() => setPreview(null)}>
                <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg>Back to editing
              </button>
            </div>
          ) : null}

          <div className="stagewrap">
            <div className="artboard">
              {/* .canvasfit is a size container: it takes exactly the height left
                  over after .cspec, and the canvas caps its own width at that
                  height × the format's ratio. That's what stops a 1:1 artboard
                  running 421px tall inside a 313px stage and scrolling. */}
              <div className="canvasfit">
                {preview ? (
                  /* The finished render, at size. Editing is paused while it's up —
                     the copy fields still drive the composite underneath, and
                     "Back to editing" returns to it untouched. */
                  <div className="canvas prev" style={arStyle(previewFormat?.ar ?? FORMATS[fmt].ar)}>
                    {preview.kind === "video" ? (
                      <video src={preview.url} controls playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />
                    ) : (
                      <AppImage src={preview.url} alt={preview.title} loading="eager" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    )}
                  </div>
                ) : (
                  <div className={`canvas${safe ? " szon" : ""}${mode === "video" ? " video" : ""}`} style={arStyle(FORMATS[fmt].ar)}>
                    {/* Laid out from CREATIVE_LAYOUTS — the same numbers the exporter
                        uses — so switching template changes what you see, and what
                        you see is the shape that ships (BSR-679). */}
                    <StudioCanvas
                      template={(TEMPLATES[tmpl]?.id ?? "bold") as "bold" | "editorial" | "minimal"}
                      brand={canvasBrand}
                      copy={{ kicker, headline, subhead: sub, cta }}
                      shown={shown}
                      override={layoutOverride}
                      onOverrideChange={setLayoutOverride}
                      selected={selectedLayer}
                      onSelect={setSelectedLayer}
                      onCopyChange={(field, value) => {
                        if (field === "kicker") setKicker(value);
                        else if (field === "headline") setHeadline(value);
                        else if (field === "subhead") setSub(value);
                        else setCta(value);
                      }}
                      background={
                        !bg ? (
                          <div className="cbg-empty">No approved media yet — pick a source, upload, or generate to set a background.</div>
                        ) : shown("Background") ? (
                          <ItemMedia item={bg} />
                        ) : null
                      }
                    />
                    <div className="cveil" />
                    <div className="cplay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></div>
                    {bg && <div className="cprov">{PVLABEL[bg.p]}</div>}
                    <div className="safez"><div className="szb szt"><span className="szl">caption / UI safe area</span></div><div className="szb szbo" /></div>
                  </div>
                )}
              </div>
              {preview ? (
                <div className="cspec">
                  <span>Rendered by <b>Arc</b></span><span className="dotsep" />
                  <span><b>{previewFormat?.dim ?? preview.format}</b></span><span className="dotsep" />
                  <span className="draftpill">Draft · not approved</span>
                </div>
              ) : (
                <div className="cspec">
                  <span>Rendered by <b>Arc</b></span><span className="dotsep" />
                  <span><b>{FORMATS[fmt].dim}</b> px</span><span className="dotsep" />
                  <span title="Colours and type come from your Brand page, not from Arc">{brandName}&rsquo;s own colours</span><span className="dotsep" />
                  <span className="draftpill">Draft · not approved</span>
                </div>
              )}
            </div>
          </div>

          {mode === "video" && !preview && (
            <div className="vidtl show">
              <span className="pp"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>
              <span className="tk"><span className="pl" /><span className="ph" /></span>
              <span className="tm">0:05 / 0:15</span>
              <span className="sl" style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)" }}>9:16 · MP4</span>
            </div>
          )}

          <div className="strip">
            {/* Offline, the version thumbs are sample art. Live they are the
                drafts this session actually rendered — clicking one puts it on
                the artboard. An empty strip means nothing has been made yet,
                which is the truth, not a placeholder. */}
            <span className="sl">This session</span>
            {live ? (
              allDrafts.length === 0 ? (
                <span className="sl" style={{ textTransform: "none", letterSpacing: 0 }}>Nothing rendered yet</span>
              ) : (
                allDrafts.slice(0, 8).map((d) => (
                  <span
                    key={d.assetId}
                    className={`vthumb${preview?.assetId === d.assetId ? " on" : ""}`}
                    role="button"
                    tabIndex={0}
                    title={`${d.title} · ${d.format}`}
                    onClick={() => setPreview(d)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPreview(d); } }}
                  >
                    {d.kind === "video" ? (
                      <video src={d.url} muted playsInline preload="metadata" />
                    ) : (
                      <AppImage src={d.url} alt="" />
                    )}
                    <span className="vtag">{d.format}</span>
                  </span>
                ))
              )
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
            <button className="vgen" onClick={() => seedAsk("Make a few on-brand variations of this creative.")}><svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10z" /></svg>Variations</button>
          </div>
        </section>

        {/* INSPECTOR */}
        <aside className="insp">
          <div className="itabs" role="tablist" aria-label="Inspector">
            <button type="button" role="tab" aria-selected={tab === "design"} className={`itab${tab === "design" ? " on" : ""}`} onClick={() => setTab("design")}><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" /><path d="M4 9h16M9 9v11" /></svg>Design{allDrafts.length > 0 ? <span className="ibadge">{allDrafts.length}</span> : null}</button>
            <button type="button" role="tab" aria-selected={tab === "arc"} className={`itab${tab === "arc" ? " on" : ""}`} onClick={() => setTab("arc")}><svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 01-11.5 7.2L4 21l1.8-5.5A8 8 0 1121 12z" /></svg>Arc</button>
          </div>

          {tab === "design" ? (
            <div className="ipane">
              <div className="iscroll">
              <div className="dwrap">
                <div className="brief">
                  <div className="bh"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 5h16v6H4z" /><path d="M4 15h10v4H4z" /></svg>Campaign context</div>
                  <div className="bn">{campaigns.find((c) => c.id === campaignId)?.name ?? "No campaign selected"}</div>
                  {/* The angle and proof chips are sample brief copy — there is no
                      wired source for a campaign's angle here yet. Showing them
                      live would put another tenant's positioning on this canvas
                      and read as this workspace's own brief. */}
                  {live ? (
                    // Says what is true. This line read "Attach this creative to a
                    // campaign to work from its angle and proof points" DIRECTLY
                    // UNDER the name of the campaign it was already attached to —
                    // instructing the operator to do the thing they had done, on
                    // every live workspace, always.
                    <div className="brow">
                      {campaignId
                        ? "Anything you generate here lands on this campaign for approval."
                        : "Pick a campaign above so what you make here has somewhere to land."}
                    </div>
                  ) : (
                    <>
                      <div className="brow"><b>Angle:</b> Act before the next storm — protect the home you&rsquo;ve already invested in.</div>
                      <div className="bchips"><span className="bchip per">Homeowners · storm-exposed</span><span className="bchip">Proof: before/after</span><span className="bchip">Proof: 4.9★ reviews</span><span className="bchip">Same-week scheduling</span></div>
                    </>
                  )}
                </div>

                {/* Right under the brief, not buried at the bottom of the pane:
                    this is what you just made and the only place to act on it. */}
                {allDrafts.length > 0 && (
                  <Section id="sec-drafts" title={`Drafts · ${allDrafts.length}`}>
                    {allDrafts.map((d) => {
                      // Read through the decisions map — half these rows are derived
                      // from the Arc thread, so their own `status` is whatever the
                      // last tail pull said, not what you just clicked.
                      const status = statusOf(d);
                      return (
                      <div className="draftrow" key={d.assetId}>
                        <button
                          type="button"
                          className={`draftthumb${preview?.assetId === d.assetId ? " on" : ""}`}
                          title="Show this on the artboard"
                          onClick={() => setPreview(d)}
                        >
                          {d.kind === "video" ? (
                            // A video draft has to be watchable to be reviewable —
                            // an <img> pointed at an MP4 renders a broken thumbnail.
                            <video src={d.url} muted playsInline preload="metadata" />
                          ) : (
                            <AppImage src={d.url} alt="" />
                          )}
                        </button>
                        <div className="draftmeta">
                          <div className="gt">{d.title}</div>
                          <div className="gd">{d.origin === "arc" ? "From Arc · " : ""}{d.format} · {status === "pending_approval" ? "awaiting your approval" : status === "approved" ? "approved — outbound still locked" : status === "declined" ? "declined" : "revision requested — Arc will re-draft"}</div>
                          {status === "pending_approval" ? (
                            <div className="actl">
                              <button className="abtn ap" disabled={draftBusy === d.assetId} onClick={() => decideDraft(d, "approved")}><svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10" /></svg>Approve</button>
                              <button className="abtn" disabled={draftBusy === d.assetId} onClick={() => reviseDraft(d)}>Revise</button>
                              <button className="abtn" disabled={draftBusy === d.assetId} onClick={() => decideDraft(d, "declined")}>Decline</button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      );
                    })}
                    <div className="clock" style={{ marginTop: 9 }}><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>Approving unlocks the next step — nothing sends without an explicit send.</div>
                  </Section>
                )}

                <Section id="sec-parts" title="Parts of this ad">
                  <div className={`layer${selectedLayer === "Background" ? " sel" : ""}`} role="button" tabIndex={0} onClick={() => setSelectedLayer("Background")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedLayer("Background"); } }} style={shown("Background") ? { cursor: "pointer" } : { opacity: 0.5, cursor: "pointer" }}><span className="li"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 15l4-3 3 2 4-3 5 4" /></svg></span><div style={{ minWidth: 0 }}><div className="lt">{LAYER_LABEL.Background}</div><div className="ld">{bg ? `${bg.l} · ${provShort(bg.p)}` : "No media selected"}</div></div><span className="eye" role="button" tabIndex={0} title={shown("Background") ? "Hide layer" : "Show layer"} aria-label={`${shown("Background") ? "Hide" : "Show"} Background layer`} onClick={() => toggleLayer("Background")} style={{ cursor: "pointer" }}>{shown("Background") ? "◉" : "◎"}</span></div>
                  {[["Kicker", kicker], ["Headline", headline], ["Subhead", sub], ["CTA button", cta], ["Logo", brandName]].map(([lt, ld]) => (
                    <div className={`layer${selectedLayer === lt ? " sel" : ""}`} key={lt} role="button" tabIndex={0} onClick={() => setSelectedLayer(lt as CanvasLayer)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedLayer(lt as CanvasLayer); } }} style={shown(lt) ? { cursor: "pointer" } : { opacity: 0.5, cursor: "pointer" }}><span className="li"><svg viewBox="0 0 24 24"><path d="M5 8h14M5 12h9" /></svg></span><div style={{ minWidth: 0 }}><div className="lt">{LAYER_LABEL[lt as string] ?? lt}</div><div className="ld">{ld || "Empty"}</div></div><span className="eye" role="button" tabIndex={0} title={shown(lt) ? "Hide layer" : "Show layer"} aria-label={`${shown(lt) ? "Hide" : "Show"} ${lt} layer`} onClick={() => toggleLayer(lt)} style={{ cursor: "pointer" }}>{shown(lt) ? "◉" : "◎"}</span></div>
                  ))}
                </Section>

                <Section id="sec-copy" title="Edit copy">
                  <div className="fieldl"><span>{LAYER_LABEL.Kicker}</span></div><input className="input" placeholder="e.g. Storm season" value={kicker} onChange={(e) => setKicker(e.target.value)} />
                  <div className="field"><div className="fieldl"><span>Headline</span></div><input className="input" placeholder="The one line that has to land" value={headline} onChange={(e) => setHeadline(e.target.value)} /></div>
                  <div className="field"><div className="fieldl"><span>{LAYER_LABEL.Subhead}</span></div><input className="input" placeholder="Supporting detail or offer" value={sub} onChange={(e) => setSub(e.target.value)} /></div>
                  <div className="field"><div className="fieldl"><span>Button</span></div><input className="input" placeholder="e.g. Get my free quote" value={cta} onChange={(e) => setCta(e.target.value)} /></div>
                </Section>

                {/* Colour and template were two sections apart with a header each,
                    for four controls total. They are one decision — how it looks. */}
                <Section id="sec-look" title="Look">
                  <div className="fieldl"><span>Accent colour</span></div>
                  {/* Buttons, not tinted spans. These had no role, no tab stop and
                      NO ACCESSIBLE NAME — a colour with nothing to read is invisible
                      to anyone not using a mouse and a working pair of eyes. */}
                  <div className="swatches" role="group" aria-label="Accent colour">
                    {swatches.map((c, i) => (
                      <button
                        type="button"
                        key={c}
                        className={`sw${accent === c ? " on" : ""}`}
                        style={{ background: c }}
                        aria-pressed={accent === c}
                        aria-label={`Accent ${i + 1} of ${swatches.length}, ${c}`}
                        title={c}
                        onClick={() => setAccent(c)}
                      />
                    ))}
                  </div>
                  <div className="swnote">{brandPalette.length > 0 ? "From your Brand kit palette — the renderer uses this accent for the CTA." : "Default accents — set a palette in Brand and these become your own. The renderer uses this accent for the CTA."}</div>
                  <div className="fieldl" style={{ marginTop: 14 }}><span>Template</span></div>
                  <div className="tmpl">
                    {TEMPLATES.map((tm, i) => (
                      <button type="button" key={tm.id} className={`tmplc${tmpl === i ? " on" : ""}`} aria-pressed={tmpl === i} onClick={() => setTmpl(i)}><div className="tmi" style={{ background: tm.bg }}><span style={{ fontFamily: tm.ff, color: tm.c, fontSize: tm.fs, fontStyle: tm.fst, fontWeight: 600 }}>Aa</span></div><div className="tmn">{tm.n}</div></button>
                    ))}
                  </div>
                </Section>

                {/* Media provenance — the ONE guardrail this app can actually compute.
                    It reads the provenance tag of the background you picked (Item.p) plus
                    whether it resolves to a real stored asset (Item.url), so every line
                    here is derived from state, never asserted.

                    The panel used to also claim "Brand logo present & legible", "Privacy
                    scan clear" and a claim-check on hardcoded copy — all rendered
                    unconditionally with green checkmarks. No logo detection, face
                    detection or claim checker exists, so those were removed rather than
                    left as a compliance gate that never ran. */}
                <Section id="sec-prov" title="Media provenance">
                  <div className="grow">
                    <span className={`gic ${provenance.tone}`}>
                      {provenance.tone === "ok"
                        ? <svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10" /></svg>
                        : <svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9l-8 14A2 2 0 004 21h16a2 2 0 001.7-3l-8-14a2 2 0 00-3.4 0z" /></svg>}
                    </span>
                    <div><div className="gt">{provenance.title}</div><div className="gd">{provenance.detail}</div></div>
                  </div>
                  {/* Always true, never derived — so it reads as a footnote, not as
                      a second finding competing with the one above it. */}
                  <div className="gnote">Arc doesn&rsquo;t scan creatives for faces, logo legibility, or unsupported claims — check those yourself.</div>
                </Section>

                {/* "Output spec" lived here: three chips repeating the format
                    already chosen in the format bar and printed again under the
                    canvas. Three statements of 1:1 / 1080 × 1080 on one screen. */}

                <Section id="sec-export" title="Export" open={false}>
                  <a className="exrow" href="/library"><svg viewBox="0 0 24 24"><path d="M4 7h6l2 2h8v10H4z" /></svg>Save to Library</a>
                  <Link className="exrow" href={campaignId ? `/campaigns/${campaignId}` : "/campaigns"}><svg viewBox="0 0 24 24"><path d="M4 5h16v6H4z" /><path d="M4 15h10v4H4z" /></svg>Open campaign</Link>
                  <button type="button" className="exrow" onClick={downloadCurrent} disabled={!bg?.url} title={!bg?.url ? "Select an approved photo or video to download its file" : undefined} {...(!bg?.url ? { "data-soon": "Select an approved photo or video to download its file" } : {})}><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 20h14" /></svg>{bg?.url ? "Download asset" : "Download (PNG / MP4)"}</button>
                </Section>
              </div>
              </div>

              {/* Pinned. Generating is the reason this pane exists, and it used
                  to sit below eight scrolling sections. */}
              <div className="ifoot">
                {genErr ? <div role="alert" className="ifooterr">{genErr}</div> : null}
                {draftNotice ? <div role="status" className="ifootwarn">{draftNotice}</div> : null}
                {/* Which model renders this — at the point of rendering, not
                    buried in Settings. Only engines this workspace can reach are
                    offered, so the list can't fail on use. Auto keeps whatever
                    the workspace default resolves to. */}
                {modelOptions.length > 0 ? (
                  <div className="field">
                    <div className="fieldl"><span>Model</span></div>
                    <select
                      className="input"
                      aria-label={`Model for this ${modelCategory}`}
                      value={activeModel}
                      disabled={gen || videoBusy}
                      onChange={(e) => setModelPick((prev) => ({ ...prev, [modelCategory]: e.target.value }))}
                    >
                      <option value={MEDIA_AUTO}>Auto — Arc picks per task</option>
                      {modelOptions.map((m) => (
                        <option key={m.key} value={m.key}>{`${m.label} · ${m.provider}`}</option>
                      ))}
                    </select>
                  </div>
                ) : null}
                {mode === "video" ? (
                  <>
                    {/* Video doesn't composite over the selected photo — Veo renders
                        the scene you describe. Keep that distinction visible so the
                        canvas background isn't mistaken for the video's input. */}
                    <div className="field">
                      <div className="fieldl"><span>Describe the shot</span></div>
                      <textarea
                        className="input"
                        rows={2}
                        style={{ resize: "vertical", lineHeight: 1.45 }}
                        placeholder="e.g. A clean service van pulls into a suburban driveway on a bright morning, slow steady camera"
                        value={videoPrompt}
                        onChange={(e) => setVideoPrompt(e.target.value)}
                        disabled={videoBusy}
                      />
                    </div>
                    {/* role + tabIndex + Enter/Space, not a bare onClick div: the
                        surrounding .exrow controls are the keyboard-unreachable
                        debt BSR-664 ratchets down, and a new control must not add
                        to it. */}
                    <div
                      className="exrow gold"
                      role="button"
                      tabIndex={videoGate || videoBusy ? -1 : 0}
                      aria-disabled={Boolean(videoGate) || videoBusy}
                      onClick={runVideo}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); runVideo(); } }}
                      style={!videoGate && !videoBusy ? { cursor: "pointer" } : { opacity: 0.55 }}
                      {...(videoGate ? { "data-soon": videoGate } : {})}
                    >
                      <svg viewBox="0 0 24 24"><rect x="3" y="5" width="14" height="14" rx="2" /><path d="M17 9l4-2v10l-4-2" /></svg>
                      {videoBusy ? "Rendering video…" : `Generate video · ${videoAspect}`}
                    </div>
                    <div className="scapt">
                      {videoNote
                        ? videoNote
                        : bg?.url
                          ? `Veo animates the photo you picked, guided by your description. Landscape and portrait only, so this renders at ${videoAspect}. Lands as a draft for your approval.`
                          : `Veo renders a short clip from your description. Pick a photo first and it will animate that instead. Landscape and portrait only, so this renders at ${videoAspect}. Lands as a draft for your approval.`}
                    </div>
                  </>
                ) : (
                  <>
                    {/* Real buttons. These were <div onClick> — the PRIMARY action on
                        the screen was not in the tab order and announced as nothing.
                        `aria-busy` while generating, and the gate reason is the
                        accessible description rather than only a hover toast. */}
                    {/* Editing the chosen photo, above generating a new creative
                        from it — it acts on what is already on the canvas. */}
                    <button
                      type="button"
                      className="exrow"
                      onClick={runEdit}
                      disabled={Boolean(editGate) || gen}
                      aria-busy={Boolean(editNote)}
                      title={editGate ?? undefined}
                      {...(editGate ? { "data-soon": editGate } : {})}
                    >
                      <svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
                      {editNote ? "Editing…" : "Change this image…"}
                    </button>
                    {/* An edit used to return within one request. On a job-based
                        engine it renders for a minute or more, so the wait needs
                        saying — a button that looks idle for 60s reads as broken
                        and gets pressed again, paying twice. */}
                    {editNote ? <div className="scapt" role="status">{editNote}</div> : null}
                    <button
                      type="button"
                      className="exrow gold"
                      onClick={() => runGenerate([FORMATS[fmt].r])}
                      disabled={Boolean(genGate) || gen}
                      aria-busy={gen}
                      title={genGate ?? undefined}
                      {...(genGate ? { "data-soon": genGate } : {})}
                    >
                      <svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10z" /></svg>
                      {gen ? "Generating…" : `Generate creative · ${FORMATS[fmt].r}`}
                    </button>
                    <button
                      type="button"
                      className="exrow"
                      onClick={() => runGenerate(FORMATS.map((f) => f.r))}
                      disabled={Boolean(genGate) || gen}
                      title={genGate ?? undefined}
                      {...(genGate ? { "data-soon": genGate } : {})}
                    >
                      <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="5" /><circle cx="12" cy="12" r="3.6" /></svg>Resize for all platforms <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 9, color: "var(--muted)" }}>1:1 4:5 9:16 16:9</span>
                    </button>
                    {genGate ? <div className="scapt">{genGate}</div> : null}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="ipane">
              <div className="arc">
                {/* The copilot: a real Arc conversation, seeded with what's on the
                    canvas, answered in this pane. It used to be a launcher that
                    threw you at /arc; before that, a hardcoded fake transcript. */}
                <div className="archead">
                  {/* Arc's own mark, not a serif "A" in a box — the monogram read as a
                      stray letter next to the name it was already spelling out. */}
                  <span className="am"><AppImage src="/brand/arc-mark.png" alt="" /></span>
                  <div style={{ minWidth: 0 }}>
                    <div className="at">Arc</div>
                    <div className="ad"><i /><span>{selectedCampaignLabel ? `Working in ${selectedCampaignLabel}` : "No campaign selected"}</span></div>
                  </div>
                  {/* Without this the pane was welded to its first conversation for
                      the life of the tab. */}
                  {convId ? (
                    <button type="button" className="arcnew" onClick={resetThread} title="Start a new conversation about this creative">
                      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>New
                    </button>
                  ) : null}
                </div>
                {/* askArc() appends "(From Studio · image · 1:1 · …)" to every
                    message. Showing the same values here means the operator can see
                    what Arc is being told, rather than finding it in the transcript
                    after the fact. The mode chip that sat here is gone with the
                    Ask/Act/Draft control — it named a choice nobody makes now. */}
                <div className="arcctxbar" title="Sent with every message so Arc knows what you're looking at">
                  <span className="acx">{mode === "video" ? "Video" : "Image"}</span>
                  <span className="acx">{FORMATS[fmt].r}</span>
                  {bg ? <span className="acx acxb" title={bg.l}>{bg.l}</span> : null}
                  <span className="acxn">Arc sees the canvas</span>
                </div>
                <div className="arcscroll">
                  {thread.length === 0 && !awaitingReply ? (
                    <div className="arcempty">
                      <div className="arcempty-t">Ask Arc about this creative</div>
                      <p className="arcempty-d">
                        Say what you want in your own words — a question, or a job to do.
                        Arc works out which it is; you don&rsquo;t pick a mode. The reply lands
                        here and you keep the artboard.
                      </p>
                      <p className="arcempty-f">
                        Anything Arc renders appears in this thread, on the artboard, and under
                        <b> Drafts</b> on the Design tab for your approval. Nothing sends.
                      </p>
                    </div>
                  ) : (
                    <div className="arcthread">
                      {visibleThread.map((m) => {
                        const { body, context } = splitStudioContext(m.body);
                        // Copy Arc proposed that this canvas can actually take.
                        // Label-driven and fails closed — prose yields nothing
                        // rather than a guess at which sentence is the headline.
                        const copy = m.role === "operator" ? [] : extractCanvasCopy(body);
                        return (
                          <div key={m.id} className={`arcwrap ${m.role === "operator" ? "me" : "arc"}`}>
                            <div className={`arcmsg ${m.role === "operator" ? "me" : "arc"}`}>
                              {body}
                              {/* The Studio context is appended to what we SEND so Arc
                                  knows the canvas state — but it is machine preamble,
                                  not something the operator typed. Showing it inside
                                  the bubble also made the message visibly change once
                                  the canonical thread replaced the optimistic copy. */}
                              {context ? <span className="arcctx">{context}</span> : null}
                            </div>
                            {/* Arc's words, into the canvas field they belong to.
                                Without this Arc could make a new asset but not
                                touch the creative in front of you: the answer to
                                "rewrite this punchier" was words to retype. */}
                            {copy.length > 0 ? (
                              <div className="arcapply">
                                <div className="arcapply-l">Put on the canvas</div>
                                {copy.map((s, i) => (
                                  <button
                                    type="button"
                                    key={`${s.field}-${i}`}
                                    className="arcapplyb"
                                    onClick={() => applyCopy(s)}
                                    title={`Replace the ${FIELD_LABEL_TEXT[s.field].toLowerCase()} with this`}
                                  >
                                    <span className="arcapplyf">{FIELD_LABEL_TEXT[s.field]}</span>
                                    <span className="arcapplyv">{s.value}</span>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            {/* The render itself. A creative tool's copilot that
                                answers a "make me an image" with prose about an
                                image it made is not answering. */}
                            {m.media.length > 0 ? (
                              <div className="arcmedia">
                                {m.media.map((md) => (
                                  <button
                                    type="button"
                                    key={md.url}
                                    // `loose` — Arc showed a render it never attached to a
                                    // campaign, so there is no asset to approve. Said with a
                                    // dashed edge and a word, not left to be discovered by
                                    // looking for an Approve button that isn't in the list.
                                    className={`arcshot${preview?.url === md.url ? " on" : ""}${md.assetId ? "" : " loose"}`}
                                    onClick={() => previewArcMedia(md)}
                                    title={
                                      md.assetId
                                        ? `${md.caption ?? "Arc draft"} — show on the artboard, approve under Drafts`
                                        : `${md.caption ?? "Arc render"} — show on the artboard. Not attached to a campaign, so there's nothing to approve.`
                                    }
                                  >
                                    {md.kind === "video" ? (
                                      <video src={md.url} muted playsInline preload="metadata" />
                                    ) : (
                                      <AppImage src={md.url} alt={md.caption ?? "Arc draft"} />
                                    )}
                                    <span className={`arcshotm${md.assetId ? "" : " loose"}`}>
                                      {md.assetId ? md.format ?? "draft" : "unattached"}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            {/* Only a generated SCENE can become the background.
                                A composite already carries the logo and copy in
                                its pixels, and compositing over it would lay
                                yours on top of Arc's. */}
                            {m.media.some((md) => md.kind === "image" && md.source === "ai_generated") ? (
                              <div className="arcusebg">
                                {m.media
                                  .filter((md) => md.kind === "image" && md.source === "ai_generated")
                                  .map((md) => (
                                    <button
                                      type="button"
                                      key={`bg-${md.url}`}
                                      className="arcusebgb"
                                      onClick={() => applyArcMediaAsBackground(md)}
                                      title="Put this behind your copy on the canvas, then Generate to composite"
                                    >
                                      <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 15l5-4 4 3 3-2 5 4" /></svg>
                                      Use as background
                                    </button>
                                  ))}
                              </div>
                            ) : null}
                            {/* Arc's own follow-ups, when it offers them. They fill
                                the composer; they never send on their own. */}
                            {m.suggestions.length > 0 ? (
                              <div className="arcsugg">
                                {m.suggestions.slice(0, 3).map((s) => (
                                  <button type="button" key={s} className="arcsuggb" onClick={() => seedAsk(s)}>{s}</button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                      {/* `&& !replied` is deliberate belt-and-braces: the reconcile
                          clears awaitingReply, but if it ever fails to, this stops
                          the finished answer being drawn twice. */}
                      {awaitingReply && !replied && (
                        <div className="arcmsg arc">
                          {streamBody ? streamBody : <span className="arcdots">Arc is thinking…</span>}
                        </div>
                      )}
                      {/* Folded. Five lines in a gold box was the loudest thing in
                          the pane — louder than the answer it annotates — and it
                          stayed up for the rest of the conversation. The headline
                          is the whole point; the reasoning is there if wanted. */}
                      {logoHint ? (
                        <details className="arcnote" role="note">
                          <summary className="arcnote-h">
                            <span className="arcnote-c" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg></span>
                            Your logo goes on top of the picture, not into it
                          </summary>
                          <span className="arcnote-b">
                            Arc strips text and branding out of every generated image on purpose, then
                            composites your real Brand kit logo as a corner lockup. It can&rsquo;t paint the
                            logo onto an object in the scene — a door, a van panel, a sign — because that
                            would mean inventing branded property you don&rsquo;t have. For a branded vehicle
                            in shot, upload a real photo of it to the <b>Library</b> and use that as the
                            background.
                          </span>
                        </details>
                      ) : null}
                      {convId && (
                        <a className="arcopen" href={`/arc?c=${convId}`}>
                          Open the full conversation in Arc →
                        </a>
                      )}
                      <div ref={threadEndRef} />
                    </div>
                  )}
                </div>
                <div className="composer">
                  {/* The asks that used to be pills on the stage toolbar, where more
                      than half of them were off the right edge behind a scroll. They
                      belong beside the composer they type into, and they stay
                      reachable mid-conversation instead of only on an empty pane.
                      Collapsible, because a creative tool's chat is mostly reading. */}
                  <div className="arcasks">
                    <button
                      type="button"
                      className="arcaskt"
                      aria-expanded={asksOpen}
                      onClick={() => setAsksOpen((o) => !o)}
                    >
                      <span className={`arcaskc${asksOpen ? " on" : ""}`} aria-hidden="true">
                        <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
                      </span>
                      Ask Arc to…
                    </button>
                    {asksOpen ? (
                      <div className="arcaskr">
                        {ARC_ACTIONS.filter((a) => !("imageOnly" in a && a.imageOnly) || mode === "image").map((a) => (
                          <button
                            type="button"
                            key={a.id}
                            className="arcask"
                            onClick={() => seedAsk(a.ask)}
                            disabled={!live}
                            title={a.ask}
                            {...(!live ? { "data-soon": "Connect a workspace to chat with Arc" } : {})}
                          >
                            <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: a.d }} />
                            {a.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="cbox">
                    <textarea
                      ref={composerRef}
                      rows={1}
                      value={msg}
                      onChange={(e) => setMsg(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askArc(); } }}
                      placeholder={live ? "Ask a question, or tell Arc what to make…" : "Connect a workspace to chat with Arc"}
                      disabled={!live || sending}
                    />
                    <button
                      className="csend"
                      aria-label={awaitingReply ? "Arc is still replying" : "Send to Arc"}
                      onClick={askArc}
                      // Blocked while a reply is in flight too: a second turn sent
                      // into the same conversation mid-run interleaves with the
                      // first, and the pane can only show one pending reply.
                      disabled={!live || sending || awaitingReply || !msg.trim()}
                      title={!live ? "Arc chat needs a connected workspace" : awaitingReply ? "Wait for Arc to finish this reply" : "Send to Arc — Enter"}
                      {...(!live ? { "data-soon": "Connect a workspace to chat with Arc" } : {})}
                    >
                      <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                    </button>
                  </div>
                  {sendErr ? <div role="alert" className="ifooterr" style={{ marginTop: 7, marginBottom: 0 }}>{sendErr}</div> : null}
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
