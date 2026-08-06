"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  AtSign,
  Bookmark,
  Binoculars,
  Blocks,
  Check,
  Copy,
  CornerDownLeft,
  ChevronRight,
  ChevronDown,
  CircleAlert,
  ClipboardCheck,
  CloudLightning,
  Download,
  FileText,
  Gauge,
  GitFork,
  Hammer,
  LayoutTemplate,
  Link2,
  LoaderCircle,
  Megaphone,
  MailCheck,
  MapPinned,
  MessagesSquare,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  PencilLine,
  Plus,
  Radar,
  Repeat2,
  Search,
  Share2,
  ShieldCheck,
  Image as ImageIcon,
  Sparkles,
  Info,
  Slash,
  Target,
  Telescope,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import {
  ARC_RUN_STALE_MS,
  DEFAULT_MEDIA_CONFIG,
  MEDIA_AUTO,
  findGenerationModel,
  generationModelsFor,
  type ArcActionCard,
  type ArcAssetStatus,
  type ArcDraftFinding,
  type ArcMention,
  type ArcMode,
  type ArcRoute,
  type EngineAvailability,
  type MediaCategory,
  type MediaConfig,
  type SharePermission,
  type ShareVisibility,
} from "@/domain";
import { contextUsage } from "@/lib/arc-chat/context-usage";
import { applyArcStreamFrame, type ArcStreamOverlay } from "@/lib/arc-chat/live-stream";
import {
  ARC_SKILL_BUILDER,
  ARC_SKILL_INSTALLER,
  ARC_SKILL_LIBRARY,
  ARC_SKILLS,
  type ArcSkillDefinition,
} from "@/lib/arc-skills/catalog";
import type { WorkspaceArcSkill } from "@/lib/arc-skills/custom";
import {
  describeSkillRequirements,
  unmetSkillConnectors,
  type SkillConnectorStatus,
  type SkillRequirement,
} from "@/lib/arc-skills/requirements";
import {
  readWorkPanelPreference,
  writeWorkPanelPreference,
} from "@/lib/arc-chat/work-panel-preference";
import type { ArcAssetBody } from "@/lib/campaigns/read-model";
import type { ConnectionView } from "@/lib/connections/read-model";
import type { ConnectorView } from "@/lib/connectors/read-model";
import type {
  ArcAttachment,
  ArcMessage,
  ArcStep,
} from "@/lib/arc-chat/persistence";
import type { MentionGroup } from "@/lib/arc-chat/mention-search";
import type { ArcThreadGroupVM } from "@/lib/arc-chat/read-model";
import type { SavedKind } from "@/lib/arc-chat/saved";
import {
  resolveArcComposerMode,
  type ArcComposerModePreference,
} from "@/lib/arc-chat/composer-mode";
import { inferMediaCategory, resolveArcModelRoute, type ArcModelPreference } from "@/lib/arc-chat/model-routing";
import { buildArcRunContract } from "@/lib/arc-chat/run-contract";
import { buildArcRunProfile } from "@/lib/arc-chat/run-profile";
import {
  getArcConversationHeader,
  getArcConversationScrollTarget,
  hasArcReplyInFlight,
  shouldEditLastOnArrowUp,
  shouldShowDemoLauncher,
  shouldUseDemoSeedWorkspace,
} from "@/lib/arc-chat/view-state";

import {
  assignArcConversationCampaignAction,
  cancelArcRunAction,
  editAndResendArcMessageAction,
  getArcAssetBodiesAction,
  getArcAssetChecksAction,
  getArcAssetStatusesAction,
  regenerateArcReplyAction,
  installArcGithubSkillAction,
  generateExemplarSkillAction,
  removeGeneratedSkillAction,
  listSavedArcItemsAction,
  previewArcGithubSkillAction,
  removeArcGithubSkillAction,
  removeSavedArcItemAction,
  sendArcMessageAction,
  setArcSkillInstalledAction,
  uploadArcAttachmentAction,
  type SavedArcItemVM,
} from "../actions";
// Reused rather than reimplemented: the same `requireOperator()` gate and
// org-scoped upsert Settings has always used to switch a connector.
import { toggleConnectorEnabled } from "../../settings/connectors-actions";
import { OverlayPortal } from "../../_components/overlay-portal";
import { describeBlockedSend, isMidComposition } from "../composer-guard";
import type { GeneratedSkillRecord } from "@/lib/exemplar-skills/persistence";
import {
  getChatSharingStateAction,
  setChatSharingAction,
  shareChatWithMemberAction,
  unshareChatMemberAction,
  type ChatSharingState,
} from "../sharing-actions";
import type {
  ArcWaiting,
  ComposerMenu,
  DemoTurn,
  PaneBox,
} from "./arc-view.types";
import { DEMO_ASSET_BODIES, DEMO_ASSET_CHECKS, DEMO_CAMPAIGNS, DEMO_PACKAGE_CARDS, DEMO_THREADS, DEMO_WAITING, DEMO_WORKSPACE_CARDS } from "./arc-demo-data";
import { ArcWorkPanel, ChipThumb, QuestionPrompt, WORK_PANEL_DOCK_MIN_PANE } from "./arc-messages";
import { DeliverableReview } from "./arc-deliverable";
import { ArcLauncher, DemoConversation, LiveConversation, type OptimisticArcTurn } from "./arc-conversation";
import { useBottomPin } from "./use-bottom-pin";


const MODEL_OPTIONS: Array<{ id: ArcModelPreference; label: string; description: string }> = [
  { id: "auto", label: "Arc Auto", description: "Chooses Spark or Forge for every prompt" },
  { id: "fast", label: "Arc Spark", description: "Fast answers and everyday requests" },
  { id: "standard", label: "Arc Forge", description: "Deeper reasoning for complex work" },
];

const CAPABILITY_OPTIONS: Array<{ id: ArcComposerModePreference; label: string; description: string }> = [
  { id: "auto", label: "Automatic", description: "Choose capability from the request" },
  { id: "ask", label: "Read only", description: "Analyze without workspace changes" },
  { id: "act", label: "Work", description: "Use tools; outbound stays locked" },
];

const ARC_CONTEXT_SCOPES = ["workspace", "brand", "crm", "campaigns"];

/**
 * Which campaign this conversation belongs to, under its title.
 *
 * The control lived in the Arc drawer's thread rows, and went away with them
 * when the rail became the conversation sidebar. It belongs here rather than
 * back in a list: a campaign is an attribute of the chat you are *in*, you
 * decide it while working in that chat, and the rail has no campaign list to
 * offer (the shell would have to fetch one on every route to show it).
 *
 * Optimistic, because the alternative is a chip that stays wrong until a server
 * round-trip and a refresh land. A refusal puts the old value straight back and
 * says why — silence here would read as "it saved", which is exactly the failure
 * the operator cannot see.
 */
function ConversationCampaign({
  campaignId,
  campaigns,
  disabled,
  disabledHint,
  notice,
  onAssign,
}: {
  campaignId: string | null;
  campaigns: ArcMention[];
  disabled: boolean;
  disabledHint?: string;
  /** What happened to the last assignment, reported at the control that did it.
   *  These used to land in `composerNotice` at the bottom of the screen beside
   *  the send button — the same distance-from-the-cause problem the per-message
   *  notices were built to fix. */
  notice?: string | null;
  onAssign: (campaignId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Owned here, so it never reaches whatever else is listening for Escape.
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = campaigns.find((campaign) => campaign.id === campaignId);
  // A conversation can carry a campaign the mention list doesn't offer (the
  // campaign was archived, or the list is capped). Say it is in one rather than
  // rendering "Add to campaign" over a link that exists.
  const label = current?.label ?? (campaignId ? "In a campaign" : "Add to campaign");

  const choose = (next: string | null) => {
    setOpen(false);
    if (next !== campaignId) onAssign(next);
  };

  return (
    <div className="arc-conversation-campaign" ref={ref}>
      <button
        type="button"
        data-empty={campaignId ? undefined : "true"}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={disabled ? disabledHint : campaignId ? `Campaign: ${label}` : "Add this conversation to a campaign"}
        onClick={() => setOpen((value) => !value)}
      >
        <Megaphone size={11} aria-hidden />
        <span>{label}</span>
        <ChevronDown size={11} aria-hidden />
      </button>
      {notice && !open ? <span className="arc-campaign-notice" role="status">{notice}</span> : null}
      <AnimatePresence>
        {open ? (
          <motion.div
            className="arc-campaign-menu"
            role="menu"
            aria-label="Assign this conversation to a campaign"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.14 }}
          >
            {campaigns.map((campaign) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={campaign.id === campaignId}
                key={campaign.id}
                onClick={() => choose(campaign.id)}
              >
                <Megaphone size={12} aria-hidden />
                <span>{campaign.label}</span>
                {campaign.id === campaignId ? <Check size={12} aria-hidden /> : null}
              </button>
            ))}
            {campaigns.length === 0 ? (
              <p className="arc-campaign-menu-empty">No campaigns yet. Create one and it will show up here.</p>
            ) : null}
            {campaignId ? (
              <>
                <div className="arc-campaign-menu-sep" />
                <button type="button" role="menuitem" className="is-clear" onClick={() => choose(null)}>
                  <X size={12} aria-hidden />
                  <span>Remove from campaign</span>
                </button>
              </>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const COMMAND_SKILLS = [...ARC_SKILLS, ...ARC_SKILL_LIBRARY, ARC_SKILL_BUILDER];

const COMMAND_OPTIONS: Array<{ id: string; mode: ArcMode }> = COMMAND_SKILLS.flatMap((skill) =>
  skill.commands.map((command) => ({ id: command.replace(/^\//, ""), mode: skill.mode })),
);

function inferComposerMode(
  request: string,
  command: string | null,
  preference: ArcComposerModePreference = "auto",
): ArcMode {
  const commandMode = COMMAND_OPTIONS.find((option) => option.id === command)?.mode;
  return resolveArcComposerMode({ request, commandMode, preference });
}

function ArcCapabilityIcon({ mode, size }: { mode: ArcMode | ArcComposerModePreference; size: number }) {
  if (mode === "auto") return <Sparkles size={size} />;
  if (mode === "ask") return <ShieldCheck size={size} />;
  return <PencilLine size={size} />;
}

function ArcModelIcon({ model, size }: { model: ArcModelPreference; size: number }) {
  if (model === "auto") {
    return (
      <svg className="arc-auto-mark" width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path className="arc-auto-mark-arch" d="M3.6 16 8.75 4.45a1.37 1.37 0 0 1 2.5 0L16.4 16" />
        <path className="arc-auto-mark-bridge" d="M6.1 11h2.25m3.3 0h2.25" />
        <circle cx="10" cy="11" r="1.15" />
      </svg>
    );
  }
  if (model === "fast") return <Gauge size={size} />;
  return <Hammer size={size} />;
}

type DrawerConnectorStatus = ConnectorView["status"] | ConnectionView["status"];

type DrawerConnectorItem = {
  key: string;
  label: string;
  description: string;
  status: DrawerConnectorStatus;
  statusLabel: string;
  kind: ConnectorView["kind"] | "channel";
  kindLabel: string;
  accessLabel: string;
  mark: string;
  color: string;
  /**
   * Whether this row can be switched from here. True only when the credential
   * question is already settled — `connected` or `disabled`. A connector that
   * still needs a key, or that isn't built, has nothing to toggle; those keep
   * their deep link into Settings, where credential entry genuinely belongs.
   */
  toggleable: boolean;
  enabled: boolean;
};

/** Grouping order for the connector list — how an operator thinks about them:
 *  what watches, what sends, what Arc can call, what comes in. */
const CONNECTOR_KIND_ORDER: ReadonlyArray<ConnectorView["kind"]> = [
  "signal_source",
  "channel",
  "mcp_tool",
  "import_source",
];

const CONNECTOR_GROUP_LABEL: Record<ConnectorView["kind"], string> = {
  signal_source: "Signal sources",
  channel: "Channels",
  mcp_tool: "Tools",
  import_source: "Imports",
};

const CONNECTOR_PRESENTATION: Record<string, { mark: string; color: string }> = {
  resend: { mark: "Re", color: "#9aa0ac" },
  "gemini-research": { mark: "Gem", color: "#88b6d8" },
  higgsfield: { mark: "Hf", color: "#c8a24a" },
  "weather-signals": { mark: "Wx", color: "#7fb89a" },
  "rss-signals": { mark: "Fd", color: "#8a9bd8" },
  "reviews-signals": { mark: "Rv", color: "#e0a94a" },
  "competitor-ads": { mark: "Ad", color: "#c47f7f" },
  "webhook-dispatch": { mark: "Wh", color: "#9aa0ac" },
  "permit-data": { mark: "Pd", color: "#b58b66" },
  "hubspot-import": { mark: "Hs", color: "#ff7a59" },
  "lead-enrichment": { mark: "En", color: "#5b8def" },
};

const CONNECTOR_KIND_LABEL: Record<ConnectorView["kind"], string> = {
  mcp_tool: "Tool",
  signal_source: "Signal source",
  channel: "Channel",
  import_source: "Import",
};

/**
 * Status in the operator's words.
 *
 * "Paused" was wrong for `disabled`: that status is simply `!enabled`, so a
 * connector nobody has ever switched on read as one that had been running and
 * got suspended. On a fresh workspace that was every row.
 */
function connectorStatusLabel(status: DrawerConnectorStatus): string {
  if (status === "connected") return "Connected";
  if (status === "disabled") return "Off";
  if (status === "error") return "Needs attention";
  if (status === "unavailable") return "Not available yet";
  return "Not set up";
}

/** The Arc pane's box in viewport coordinates. */

/**
 * Track an element's viewport rect while `active`.
 *
 * The drawer portals to the shell so its scrim can cover the whole window
 * (#955) — but once portaled it has no pane to be `position: absolute` inside,
 * and the pane's offsets are not constant: the rail is 236px and the top bar
 * 55px, but the demo-data banner and the billing notice bar move the pane down
 * only when they are showing. Hardcoding those offsets is how this drifts.
 * Measuring is the only version that stays right.
 *
 * `useLayoutEffect` so the first measurement lands before paint — the drawer
 * must not appear at the CSS fallback position for a frame and then jump.
 * ResizeObserver catches a banner appearing or the window resizing; both change
 * the pane's own size, which is what it fires on.
 */
function usePaneBox(ref: React.RefObject<HTMLElement | null>, active: boolean): PaneBox | null {
  const [box, setBox] = useState<PaneBox | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!active || !node) {
      // Don't hold a stale box across closes — the pane may move while the
      // drawer is shut, and a stale box would place the next open wrongly.
      setBox(null);
      return;
    }
    const measure = () => {
      const r = node.getBoundingClientRect();
      setBox((prev) =>
        prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
          ? prev // same box → same object, so this never re-renders the drawer
          : { top: r.top, left: r.left, width: r.width, height: r.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);

    // The pane sits inside `.page-enter`, whose entrance animation carries a
    // translateY that decays to 0 over 420ms — and getBoundingClientRect
    // includes ancestor transforms. Opening the drawer during that window would
    // measure the pane 9px low and stay there, because a transform changes no
    // box and so fires no ResizeObserver. Re-measure when that animation ends.
    // Cheap and exact: animation events bubble, and the name is unique.
    const onPageEnterEnd = (event: AnimationEvent) => {
      if (event.animationName === "pageEnter") measure();
    };
    document.addEventListener("animationend", onPageEnterEnd, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("animationend", onPageEnterEnd, true);
    };
  }, [ref, active]);

  return box;
}

function ThreadDrawer({
  live,
  onUseSkill,
  onUseSaved,
  installedSkills,
  installedSkillKeys,
  installingSkillKey,
  onSetSkillInstalled,
  workspaceSkills,
  onWorkspaceSkillsChange,
  generatedSkills,
  onGeneratedSkillsChange,
  workspaceName,
  connectorsConfigured,
  connectors,
  emailConnection,
  liveSendEnabled,
  onClose,
  onDismiss,
  paneBox,
}: {
  live: boolean;
  onUseSkill: (skill: ArcSkillDefinition) => void;
  /** Put a saved item's text into the composer for the current turn. */
  onUseSaved: (text: string) => void;
  installedSkills: ArcSkillDefinition[];
  installedSkillKeys: string[];
  installingSkillKey: string | null;
  onSetSkillInstalled: (skill: ArcSkillDefinition, installed: boolean) => void;
  workspaceSkills: WorkspaceArcSkill[];
  onWorkspaceSkillsChange: (skills: WorkspaceArcSkill[]) => void;
  generatedSkills: GeneratedSkillRecord[];
  onGeneratedSkillsChange: (skills: GeneratedSkillRecord[]) => void;
  workspaceName: string;
  connectorsConfigured: boolean;
  connectors: ConnectorView[];
  emailConnection: ConnectionView | null;
  liveSendEnabled: boolean;
  /** Programmatic close — following a link, opening review. Leaves focus alone,
   *  because something else is about to take it. */
  onClose: () => void;
  /** The operator dismissed the drawer (Escape, the ✕, the scrim). Focus goes
   *  back to the control that opened it. */
  onDismiss: () => void;
  /** Where to sit, in viewport coordinates — see usePaneBox. The drawer is
   *  portaled to the shell (so its scrim can cover the whole window) but is
   *  still meant to look like it lives inside the Arc pane, and a portaled
   *  element has no pane to be `absolute` inside any more. Null before the
   *  first measurement; the CSS fallback covers that frame. */
  paneBox: PaneBox | null;
}) {
  const router = useRouter();
  const drawerRef = useRef<HTMLElement | null>(null);
  // No "conversations": the rail is the conversation sidebar now, and this
  // drawer holding a second copy of the same list is what that replaced.
  const [view, setView] = useState<"skills" | "connectors" | "saved">("skills");
  // Saved items are loaded lazily the first time the Saved tab opens.
  const [savedItems, setSavedItems] = useState<SavedArcItemVM[] | null>(null);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  /** Which item just went to the clipboard, so the button can confirm it. */
  const [copiedSavedId, setCopiedSavedId] = useState<string | null>(null);
  /** Saved was the one list in the drawer you could not search or narrow — it
   *  grows without bound and had no way through it but scrolling. */
  const [savedSearch, setSavedSearch] = useState("");
  const [savedKind, setSavedKind] = useState<SavedKindFilter>("all");
  const [skillsMode, setSkillsMode] = useState<"installed" | "library">("installed");
  const [skillSearch, setSkillSearch] = useState("");
  /** Search over the skills you already have — distinct from `skillSearch`,
   *  which searches the not-yet-installed library. */
  const [installedSearch, setInstalledSearch] = useState("");
  /** Authoring and installing are the rare case: collapsed by default. */
  const [manageOpen, setManageOpen] = useState(false);
  /** Connector the operator arrived at from an unmet skill requirement. */
  const [focusedConnector, setFocusedConnector] = useState<string | null>(null);
  const [connectorSearch, setConnectorSearch] = useState("");
  /** The catalog is 16 rows deep and almost every question asked of it is
   *  "what is on?" or "what still needs me?". Same chip row as Conversations. */
  const [connectorFilter, setConnectorFilter] = useState<ConnectorFilter>("all");
  const [plannedOpen, setPlannedOpen] = useState(false);
  /** Key currently being switched, so only that row shows a spinner. */
  const [togglingConnector, setTogglingConnector] = useState<string | null>(null);
  const [connectorError, setConnectorError] = useState<string | null>(null);
  /** Bring that connector into view — the list is 16 rows and it may be far down.
   *  A callback ref rather than an effect: it fires exactly when the row mounts,
   *  which is the render after `showConnector` switched to the Connectors tab.
   *
   *  Deliberately not `behavior: "smooth"`. An animation started from a commit
   *  callback races the list's own layout and reliably stalled part-way, leaving
   *  the row the operator asked for still off-screen. This is a jump they
   *  explicitly requested, so it should just be there. */
  const focusConnectorRef = useCallback((node: HTMLDivElement | null) => {
    node?.scrollIntoView({ block: "center", behavior: "auto" });
  }, []);
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [githubPreview, setGithubPreview] = useState<WorkspaceArcSkill | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<{ tone: "ok" | "info"; text: string } | null>(null);
  const [githubStatus, setGithubStatus] = useState<string | null>(null);
  const [githubBusy, setGithubBusy] = useState(false);

  const openSaved = () => {
    setView("saved");
    if (savedItems === null && !savedLoading) {
      setSavedLoading(true);
      setSavedError(null);
      listSavedArcItemsAction().then((res) => {
        setSavedLoading(false);
        if (res.ok) setSavedItems(res.items);
        else setSavedError(res.error);
      });
    }
  };
  /** Copy the reusable artefact: the text for a draft or angle, the URL for media. */
  const copySaved = async (item: SavedArcItemVM) => {
    const text = item.kind === "media" ? item.mediaUrl : item.body;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSavedId(item.id);
      window.setTimeout(() => setCopiedSavedId((current) => (current === item.id ? null : current)), 1600);
    } catch {
      // Clipboard permission can be refused; say so rather than showing a
      // "Copied" tick for something that never reached the clipboard.
      setSavedError("Couldn't copy — your browser blocked clipboard access.");
    }
  };

  const removeSaved = (id: string) => {
    const prev = savedItems;
    setSavedItems((cur) => (cur ? cur.filter((s) => s.id !== id) : cur));
    removeSavedArcItemAction(id).then((res) => {
      if (!res.ok) { setSavedItems(prev); setSavedError(res.error); }
    });
  };


  const connectorItems: DrawerConnectorItem[] = [
    ...(emailConnection ? [{
      key: "resend",
      label: "Resend",
      description: "Approved campaign and transactional email delivery.",
      status: emailConnection.status === "connected" && !liveSendEnabled ? "disabled" as const : emailConnection.status,
      statusLabel: emailConnection.status === "connected" && !liveSendEnabled ? "Not armed" : connectorStatusLabel(emailConnection.status),
      kind: "channel" as const,
      kindLabel: "Channel",
      accessLabel: "gated write",
      // Email arming is an env-level decision, not a per-workspace switch.
      toggleable: false,
      enabled: emailConnection.status === "connected" && liveSendEnabled,
      ...CONNECTOR_PRESENTATION.resend!,
    }] : []),
    ...connectors.map((connector) => ({
      key: connector.key,
      label: connector.label,
      // The Settings-page `description` clamps mid-word at this width; the
      // registry's one-line capability summary is written to fit.
      description: (connector.capabilitySummary || connector.description).replace(/^PLANNED —\s*/i, ""),
      status: connector.status,
      statusLabel: connectorStatusLabel(connector.status),
      kind: connector.kind,
      kindLabel: CONNECTOR_KIND_LABEL[connector.kind],
      accessLabel: connector.access === "read_only" ? "read-only" : "gated write",
      toggleable: connector.status === "connected" || connector.status === "disabled",
      enabled: connector.enabled,
      ...(CONNECTOR_PRESENTATION[connector.key] ?? { mark: connector.label.slice(0, 2), color: "#9aa0ac" }),
    })),
  ].sort((a, b) => {
    const rank: Record<DrawerConnectorStatus, number> = { connected: 0, error: 1, disabled: 2, not_configured: 3, unavailable: 4 };
    return rank[a.status] - rank[b.status] || a.label.localeCompare(b.label);
  });
  const connectedCount = connectorItems.filter((connector) => connector.status === "connected").length;
  const offCount = connectorItems.filter((connector) => connector.status === "disabled").length;
  const setupCount = connectorItems.filter((connector) => connector.status === "not_configured" || connector.status === "error").length;
  const matchesConnectorQuery = (connector: DrawerConnectorItem) => {
    const needle = connectorSearch.trim().toLocaleLowerCase();
    return !needle || `${connector.label} ${connector.description} ${connector.kindLabel}`.toLocaleLowerCase().includes(needle);
  };
  const matchesConnectorFilter = (connector: DrawerConnectorItem) =>
    connectorFilter === "all"
    || (connectorFilter === "on" && connector.status === "connected")
    || (connectorFilter === "off" && connector.status === "disabled")
    || (connectorFilter === "setup" && (connector.status === "not_configured" || connector.status === "error"));
  /* "Not available yet" connectors aren't actionable and were sitting at the
     same visual weight as the real ones. They get their own disclosure so the
     list you can actually do something about stays short. The status filter
     deliberately doesn't reach them: none of its four buckets describes
     "we haven't built this", so they stay behind their disclosure either way. */
  const visibleConnectors = connectorItems.filter((connector) => connector.status !== "unavailable" && matchesConnectorQuery(connector) && matchesConnectorFilter(connector));
  const plannedConnectors = connectorItems.filter((connector) => connector.status === "unavailable" && matchesConnectorQuery(connector));
  const connectorGroups = CONNECTOR_KIND_ORDER
    .map((kind) => ({ kind, label: CONNECTOR_GROUP_LABEL[kind], items: visibleConnectors.filter((connector) => connector.kind === kind) }))
    .filter((group) => group.items.length > 0);
  const visibleLibrarySkills = ARC_SKILL_LIBRARY.filter((skill) => {
    const needle = skillSearch.trim().toLocaleLowerCase();
    return !needle || `${skill.name} ${skill.description} ${skill.commands.join(" ")} ${skill.publisher ?? ""}`.toLocaleLowerCase().includes(needle);
  });

  /* A skill's data sources, resolved against this workspace's live connector
     status, so an unmet one is named before the turn runs instead of the run
     quietly coming back thinner. `connectors` is already the drawer's own
     source of truth for the Connectors tab. */
  const skillConnectors: SkillConnectorStatus[] = connectors.map((connector) => ({
    key: connector.key,
    label: connector.label,
    status: connector.status,
  }));
  const requirementsFor = (skill: ArcSkillDefinition) => unmetSkillConnectors(skill, skillConnectors);
  /** Send the operator to the connector that is missing, without leaving the chat. */
  const showConnector = (key: string) => {
    setView("connectors");
    setFocusedConnector(key);
    setConnectorSearch("");
  };

  /**
   * Switch a connector on or off from here. Reuses the Settings action, so the
   * `requireOperator()` gate, org scoping and upsert behaviour are the same ones
   * Settings has always used — this surface adds a control, not a second path
   * into the data.
   *
   * Turning a connector on never sends anything: signal sources only propose,
   * and channels still dispatch solely from the approved path.
   */
  const toggleConnector = async (connector: DrawerConnectorItem) => {
    if (!connector.toggleable || togglingConnector) return;
    setTogglingConnector(connector.key);
    setConnectorError(null);
    const result = await toggleConnectorEnabled({ connectorKey: connector.key, enabled: !connector.enabled });
    if (!result.ok) setConnectorError(result.error);
    // `persisted: false` means the action ran but there was no workspace to write
    // to. Say so — a switch that flips back with no explanation is the silent
    // failure this whole surface exists to remove.
    else if (!result.persisted) setConnectorError(`${connector.label} could not be saved — this workspace has no connected database yet.`);
    else if (live) router.refresh();
    setTogglingConnector(null);
  };

  /* Every skill this workspace has, in one list, whatever it came from. Before
     this they were three separate lists with three different affordances —
     "Your voice", "From GitHub" (over in the library sub-view) and "Installed" —
     and only the first two could be removed where they were shown. */
  const installedEntries: Array<{ skill: ArcSkillDefinition; detail: string; generated: GeneratedSkillRecord | null }> = [
    ...generatedSkills.map((record) => ({
      skill: toDrawerSkill(record, workspaceName),
      // Keep saying how well grounded the ranking is: "a human approved these"
      // and "these converted" look identical once rendered.
      detail: `${VOICE_TIER_LABEL[record.evidenceTier]} · ${record.exemplarCount} example${record.exemplarCount === 1 ? "" : "s"}`,
      generated: record,
    })),
    ...installedSkills.map((skill) => ({ skill, detail: skill.description, generated: null })),
  ].filter((entry) => {
    const needle = installedSearch.trim().toLocaleLowerCase();
    return !needle || `${entry.skill.name} ${entry.skill.description} ${entry.skill.commands.join(" ")}`.toLocaleLowerCase().includes(needle);
  });

  /** Built-ins ship with Arc and can't be removed; everything else can, from
   *  the row it appears on. */
  const removeInstalledSkill = (skill: ArcSkillDefinition, generated: GeneratedSkillRecord | null) => {
    if (generated) return void removeVoiceSkill(generated);
    if (skill.source === "github") return void removeGithubSkill(skill as WorkspaceArcSkill);
    if (skill.source === "library") return onSetSkillInstalled(skill, false);
  };

  /**
   * The dialog contract for the drawer. It has always *behaved* as a modal —
   * the scrim takes pointer events and covers the conversation — while
   * declaring none of it: no role, no Escape, and Tab walked straight out into
   * the chat the scrim was blocking from the mouse.
   *
   * Escape dismisses the innermost open thing and only closes the drawer when
   * nothing is open. Surfaces with their own popup state (the thread menu, the
   * rename field) consume Escape themselves and stop it before it reaches here;
   * this handles the disclosures and sub-views, which are plain drawer state.
   */
  const dismissInnermost = (): boolean => {
    if (view === "skills" && skillsMode === "library" && githubOpen) { setGithubOpen(false); return true; }
    if (view === "skills" && skillsMode === "library") { setSkillsMode("installed"); return true; }
    if (view === "skills" && manageOpen) { setManageOpen(false); return true; }
    if (view === "connectors" && plannedOpen) { setPlannedOpen(false); return true; }
    return false;
  };

  /*
   * Bound on `document`, not on the aside, and deliberately so. Dismissing an
   * inner surface usually unmounts whatever had focus — closing the GitHub
   * disclosure removes the button you pressed Escape on — which drops focus to
   * <body>. A handler on the aside then never fires again, so Escape appears to
   * stop working after the first press. A document listener is focus-independent.
   *
   * Registered in the CAPTURE phase, which is what lets `dismissInnermost` run
   * before React has flushed anything: by the time a bubble-phase document
   * listener sees the key, an inner surface that closed itself is already gone.
   *
   * A `targetOwnedByNestedSurface` guard used to sit here, letting a thread's
   * row menu or inline rename field eat Escape before the drawer saw it. Both
   * lived in this drawer's conversation list; that list is the rail's job now,
   * and the guard's two selectors matched nothing rendered anywhere. The rail's
   * own menu and rename field handle their own Escape, and neither is inside
   * this modal, so there is nothing left here to defer to.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const drawer = drawerRef.current;
      if (!drawer) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (!dismissInnermost()) onDismiss();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((node) => node.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      const inside = active ? drawer.contains(active) : false;
      // Focus outside the drawer (it fell to <body>, or Tab reached the chat
      // behind the scrim) is pulled back to the appropriate edge.
      if (!inside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  });

  const handleRovingListKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'))
      .filter((item) => item.offsetParent !== null && !item.closest('[role="menu"]'));
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1 + items.length) % items.length : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  const reviewGithubSkill = async () => {
    setGithubBusy(true);
    setGithubStatus(null);
    setGithubPreview(null);
    const result = await previewArcGithubSkillAction({ url: githubUrl });
    if (result.ok) setGithubPreview(result.skill);
    else setGithubStatus(result.error);
    setGithubBusy(false);
  };

  /** Learn this workspace's voice from copy it already approved. Read-only. */
  const learnVoice = async () => {
    setVoiceBusy(true);
    setVoiceStatus(null);
    const result = await generateExemplarSkillAction({});
    // A refusal ("not enough proven copy yet") is the expected first answer for
    // most workspaces — show it as guidance, not as a failure.
    if (!result.ok) setVoiceStatus({ tone: "info", text: result.error });
    else {
      onGeneratedSkillsChange(result.skills);
      setVoiceStatus(
        result.generated
          ? { tone: "ok", text: `Learned from ${result.generated.exemplarCount} approved assets. Use ${result.generated.command} in chat.` }
          : { tone: "ok", text: "Voice skill updated." },
      );
    }
    setVoiceBusy(false);
  };

  const removeVoiceSkill = async (record: GeneratedSkillRecord) => {
    setVoiceBusy(true);
    const result = await removeGeneratedSkillAction({ skillKey: record.key });
    if (!result.ok) setVoiceStatus({ tone: "info", text: result.error });
    else {
      onGeneratedSkillsChange(result.skills);
      setVoiceStatus(null);
    }
    setVoiceBusy(false);
  };

  const installGithubSkill = async () => {
    // `repositoryUrl` is optional on WorkspaceArcSkill because generated skills
    // have none; a GitHub preview always carries one.
    if (!githubPreview?.repositoryUrl) return;
    setGithubBusy(true);
    const result = await installArcGithubSkillAction({ url: githubPreview.repositoryUrl });
    if (!result.ok) setGithubStatus(result.error);
    else {
      const next = result.persisted ? result.skills : [...workspaceSkills.filter((skill) => skill.key !== githubPreview.key), ...result.skills];
      onWorkspaceSkillsChange(next);
      setGithubStatus(`${githubPreview.name} installed${result.persisted ? " for this workspace" : " for this preview"}. Use ${githubPreview.commands[0]} in chat.`);
      setGithubPreview(null);
      setGithubUrl("");
    }
    setGithubBusy(false);
  };

  const removeGithubSkill = async (skill: WorkspaceArcSkill) => {
    setGithubBusy(true);
    const result = await removeArcGithubSkillAction({ skillKey: skill.key });
    if (!result.ok) setGithubStatus(result.error);
    else {
      onWorkspaceSkillsChange(result.persisted ? result.skills : workspaceSkills.filter((candidate) => candidate.key !== skill.key));
      setGithubStatus(`${skill.name} removed.`);
    }
    setGithubBusy(false);
  };

  /* Saved: narrow by kind, then by text. Counts come off the unfiltered list so
     a chip never reads "0" only because the other chip is on. */
  const savedCounts = {
    all: savedItems?.length ?? 0,
    draft: savedItems?.filter((item) => item.kind === "draft").length ?? 0,
    angle: savedItems?.filter((item) => item.kind === "angle").length ?? 0,
    media: savedItems?.filter((item) => item.kind === "media").length ?? 0,
  };
  const visibleSaved = (savedItems ?? []).filter((item) => {
    if (savedKind !== "all" && item.kind !== savedKind) return false;
    const needle = savedSearch.trim().toLocaleLowerCase();
    return !needle || `${item.title} ${item.preview ?? ""} ${item.note ?? ""}`.toLocaleLowerCase().includes(needle);
  });
  const savedNarrowed = savedKind !== "all" || savedSearch.trim().length > 0;

  return (
    <motion.aside ref={drawerRef} className="arc-history" style={paneBox ? { top: paneBox.top, left: paneBox.left, height: paneBox.height, width: Math.min(386, paneBox.width - 28) } : undefined} initial={{ x: -24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -24, opacity: 0 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }} role="dialog" aria-modal="true" aria-label="Arc workspace">
      {/* Everything in this drawer — the chats, the installed skills, the
          connector switches, the saved items — belongs to one workspace, and
          the panel never said which. It matters most in the account that has
          two of them open in two tabs. */}
      <div className="arc-history-topline">
        <span className="arc-history-eyebrow">Arc workspace{workspaceName ? <b>{workspaceName}</b> : null}</span>
        <button type="button" className="arc-icon-button" onClick={onDismiss} aria-label="Close Arc workspace" autoFocus><X size={17} /></button>
      </div>
      <nav className="arc-drawer-nav" aria-label="Arc workspace sections">
        <button type="button" className={view === "skills" ? "is-active" : ""} aria-current={view === "skills" ? "page" : undefined} onClick={() => { setView("skills"); setSkillsMode("installed"); }}><Blocks size={14} /><span>Skills</span></button>
        <button type="button" className={view === "connectors" ? "is-active" : ""} aria-current={view === "connectors" ? "page" : undefined} onClick={() => setView("connectors")}><Link2 size={14} /><span>Connectors</span></button>
        <button type="button" className={view === "saved" ? "is-active" : ""} aria-current={view === "saved" ? "page" : undefined} onClick={openSaved}><Bookmark size={14} /><span>Saved</span></button>
      </nav>

      {view === "skills" && skillsMode === "installed" ? <section className="arc-drawer-view arc-drawer-skills" aria-label="Skills">
        <p className="arc-drawer-purpose">Reusable workflows you can call with <code>/</code> in any conversation.</p>
        <label className="arc-drawer-search"><Search size={14} /><input type="search" aria-label="Search your skills" placeholder="Search your skills" value={installedSearch} onChange={(event) => setInstalledSearch(event.target.value)} /></label>
        {voiceStatus ? <p className="arc-voice-status" data-tone={voiceStatus.tone}>{voiceStatus.tone === "ok" ? <Check size={13} /> : <Info size={13} />}{voiceStatus.text}</p> : null}
        <div className="arc-drawer-section-head"><span>Your skills</span><small>{installedSearch.trim() ? `${installedEntries.length} of ${installedSkills.length + generatedSkills.length}` : `${installedSkills.length + generatedSkills.length} installed`}</small></div>
        <div className="arc-skills-list" onKeyDown={handleRovingListKeyDown}>
          {installedEntries.map(({ skill, detail, generated }) => {
            const removable = Boolean(generated) || skill.source === "github" || skill.source === "library";
            const unmet = requirementsFor(skill);
            return (
              <div className="arc-skill-item" key={skill.key} data-unmet={unmet.length > 0 ? "true" : undefined}>
                <button type="button" className="arc-skill-row" onClick={() => onUseSkill(skill)}>
                  <span className="arc-skill-icon"><SkillIcon skill={skill} /></span>
                  <span>
                    <span className="arc-skill-row-title">
                      <b>{skill.name}</b>
                      {/* Only where it says something. The badge exists so a skill
                          Arc ships and an untrusted public GitHub import don't
                          look alike — and it was drawn on every row, including
                          the eight built-ins, where it read "BUILT-IN" eight
                          times and told you nothing. Absence now means built-in;
                          a badge means you added this, which is the case worth
                          the eye. */}
                      {isBuiltInSkill(skill) ? null : <span className="arc-skill-source" data-source={skill.source}>{SKILL_SOURCE_LABEL[skill.source]}</span>}
                    </span>
                    <small>{detail}</small>
                    {/* Every command the skill answers to. Showing only the first
                        hid the aliases that make it findable from the composer. */}
                    <span className="arc-skill-commands">{skill.commands.map((command) => <em key={command}>{command}</em>)}</span>
                  </span>
                </button>
                {removable ? <button type="button" className="arc-skill-remove" aria-label={`Remove ${skill.name}`} disabled={voiceBusy || githubBusy || installingSkillKey === skill.key} onClick={() => removeInstalledSkill(skill, generated)}><X size={13} /></button> : <span />}
                {/* A source this skill reads is unusable. Say so here rather than
                    letting the run come back thin with no explanation. */}
                {unmet.length > 0 ? <SkillRequirementNote requirements={unmet} onShowConnector={showConnector} /> : null}
              </div>
            );
          })}
          {installedEntries.length === 0 ? <DrawerEmpty icon={<Search size={18} />} title="No skills match" hint="Try another workflow name or command." /> : null}
        </div>
        <div className="arc-skill-manage">
          <button type="button" className="arc-skill-manage-toggle" aria-expanded={manageOpen} onClick={() => setManageOpen((open) => !open)}>
            <Blocks size={13} /><span>Add or create a skill</span><ChevronDown size={14} className="arc-skill-manage-chevron" />
          </button>
          {manageOpen ? <div className="arc-skill-actions" onKeyDown={handleRovingListKeyDown}>
            <button type="button" className="arc-skill-browse" onClick={() => setSkillsMode("library")}><span><Download size={15} /></span><span><b>Browse Arc Library</b><small>Curated workflows reviewed by Arc</small></span><ArrowRight size={14} /></button>
            <button type="button" className="arc-skill-browse" onClick={() => { setSkillsMode("library"); setGithubOpen(true); }}><span><GitFork size={15} /></span><span><b>Add from GitHub</b><small>Review a public SKILL.md before installing</small></span><ArrowRight size={14} /></button>
            <button type="button" className="arc-skill-create" onClick={() => onUseSkill(ARC_SKILL_BUILDER)}><span><Plus size={15} /></span><span><b>Create a skill</b><small>Guided builder · /create-skill</small></span><ArrowRight size={14} /></button>
            <button type="button" className="arc-skill-browse" disabled={voiceBusy} onClick={() => void learnVoice()}><span>{voiceBusy ? <LoaderCircle size={15} className="is-spinning" /> : <Sparkles size={15} />}</span><span><b>Learn your voice</b><small>{voiceBusy ? "Reading approved campaign copy…" : "Build a skill from copy you already approved"}</small></span><ArrowRight size={14} /></button>
          </div> : null}
        </div>
        <p className="arc-drawer-footnote"><ShieldCheck size={13} /> Skills can prepare work, but outbound actions still require review.</p>
      </section> : null}

      {view === "skills" && skillsMode === "library" ? <section className="arc-drawer-view arc-drawer-skills arc-skill-library" aria-label="Skill library">
        <div className="arc-drawer-back"><button type="button" onClick={() => setSkillsMode("installed")}><ArrowLeft size={13} /> Your skills</button></div>
        <p className="arc-drawer-purpose">Install reviewed workflows from Arc or a public GitHub repository.</p>
        <button type="button" className="arc-github-toggle" aria-expanded={githubOpen} onClick={() => setGithubOpen((open) => !open)}><GitFork size={15} /><span><b>Import from GitHub</b><small>Repository or SKILL.md URL</small></span><ChevronDown size={13} /></button>
        {githubOpen ? <div className="arc-github-import">
          <label><span>GitHub URL</span><div><GitFork size={14} /><input type="url" value={githubUrl} placeholder="https://github.com/org/repo/blob/main/SKILL.md" onChange={(event) => { setGithubUrl(event.target.value); setGithubPreview(null); setGithubStatus(null); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void reviewGithubSkill(); } }} /></div></label>
          <button type="button" disabled={githubBusy || !githubUrl.trim()} onClick={() => void reviewGithubSkill()}>{githubBusy ? <LoaderCircle size={13} className="is-spinning" /> : <ShieldCheck size={13} />}Review skill</button>
          {githubPreview ? <div className="arc-github-preview"><span className="arc-skill-icon"><SkillIcon skill={githubPreview} /></span><div><b>{githubPreview.name}</b><small>{githubPreview.description}</small><em>{githubPreview.commands[0]}</em><p>{githubPreview.publisher} · runs read-only</p></div><button type="button" disabled={githubBusy} onClick={() => void installGithubSkill()}><Download size={13} />Install</button></div> : null}
          {githubStatus ? <p className="arc-github-status">{githubStatus}</p> : null}
        </div> : null}
        {/* GitHub imports used to get their own list here, with the only remove
            button in the product. They now sit in the main Installed list with
            every other skill, badged and removable there. */}
        <label className="arc-drawer-search"><Search size={14} /><input type="search" aria-label="Search online skills" placeholder="Search skills" value={skillSearch} onChange={(event) => setSkillSearch(event.target.value)} /></label>
        <div className="arc-drawer-section-head"><span>Discover</span><small>{visibleLibrarySkills.length} skills</small></div>
        <div className="arc-skills-list arc-library-list" onKeyDown={handleRovingListKeyDown}>
          {visibleLibrarySkills.map((skill) => {
            const installed = installedSkillKeys.includes(skill.key);
            const saving = installingSkillKey === skill.key;
            const unmet = requirementsFor(skill);
            return <article className="arc-library-skill" data-installed={installed ? "true" : "false"} key={skill.key}>
              <span className="arc-skill-icon"><SkillIcon skill={skill} /></span>
              <div><span><b>{skill.name}</b></span><small>{skill.description}</small><span className="arc-skill-commands">{skill.commands.map((command) => <em key={command}>{command}</em>)}</span><p>{skill.publisher} · Reviewed by Arc</p></div>
              {/* What this skill reads, before it is installed — so the gap is a
                  decision at install time, not a disappointment at run time. */}
              {unmet.length > 0 ? <SkillRequirementNote requirements={unmet} onShowConnector={showConnector} /> : null}
              <button type="button" disabled={saving} onClick={() => onSetSkillInstalled(skill, !installed)}>{saving ? <LoaderCircle size={13} className="is-spinning" /> : installed ? <Check size={13} /> : <Download size={13} />}{saving ? "Saving" : installed ? "Installed" : "Install"}</button>
            </article>;
          })}
          {visibleLibrarySkills.length === 0 ? <DrawerEmpty icon={<Search size={18} />} title="No skills found" hint="Try a different workflow or command." /> : null}
        </div>
        <p className="arc-drawer-footnote"><ShieldCheck size={13} /> GitHub skills are treated as untrusted text and cannot expand Arc&apos;s read-only tool boundary.</p>
      </section> : null}

      {view === "connectors" ? <section className="arc-drawer-view arc-drawer-connectors" aria-label="Connectors">
        <p className="arc-drawer-purpose">What Arc is allowed to read in this workspace, and what it still needs.</p>
        {!connectorsConfigured ? <div className="arc-connector-notice"><ShieldCheck size={14} /><span><b>Catalog preview</b><small>Connect a workspace to store credentials and live status.</small></span></div> : null}
        <label className="arc-drawer-search"><Search size={14} /><input type="search" aria-label="Search connectors" placeholder="Search connectors" value={connectorSearch} onChange={(event) => setConnectorSearch(event.target.value)} /></label>
        <div className="arc-drawer-filters" role="group" aria-label="Filter connectors by status">
          {([
            ["all", "All", connectorItems.filter((connector) => connector.status !== "unavailable").length],
            ["on", "On", connectedCount],
            ["off", "Off", offCount],
            ["setup", "Needs setup", setupCount],
          ] as const).map(([id, label, count]) => <button type="button" key={id} className={connectorFilter === id ? "is-active" : ""} aria-pressed={connectorFilter === id} onClick={() => setConnectorFilter(id)}><span>{label}</span>{count > 0 ? <small>{count}</small> : null}</button>)}
        </div>
        {connectorError ? <p className="arc-connector-error" role="alert">{connectorError}</p> : null}
        <div className="arc-connector-list">
          {connectorGroups.map((group) => (
            <Fragment key={group.kind}>
              <div className="arc-drawer-section-head"><span>{group.label}</span><small>{group.items.filter((item) => item.status === "connected").length} of {group.items.length} on</small></div>
              {group.items.map((connector) => (
                <div className="arc-connector-row" data-status={connector.status} data-focused={focusedConnector === connector.key ? "true" : undefined} ref={focusedConnector === connector.key ? focusConnectorRef : undefined} key={connector.key}>
                  <span className="arc-connector-logo" style={{ "--connector-color": connector.color } as React.CSSProperties}>{connector.mark}</span>
                  {/* Three stacked lines became two. The kind was already the
                      group heading this row sits under, and the status pill said
                      "Connected"/"Off" beside a switch that says the same thing
                      louder — so the pill is now only drawn for the states no
                      switch can express (not set up, error, not armed). */}
                  <span className="arc-connector-copy">
                    <span><b>{connector.label}</b><small>{connector.accessLabel}</small>{connector.toggleable ? null : <em>{connector.statusLabel}</em>}</span>
                    <p>{connector.description}</p>
                  </span>
                  {/* Switchable here; credential entry still belongs in Settings. */}
                  {connector.toggleable ? (
                    <button
                      type="button"
                      className="arc-connector-toggle"
                      role="switch"
                      aria-checked={connector.enabled}
                      aria-label={`${connector.enabled ? "Turn off" : "Turn on"} ${connector.label}`}
                      disabled={togglingConnector !== null || !connectorsConfigured}
                      title={connectorsConfigured ? undefined : "Connect a workspace to switch connectors on."}
                      onClick={() => void toggleConnector(connector)}
                    >
                      {togglingConnector === connector.key ? <LoaderCircle size={12} className="is-spinning" /> : <i />}
                    </button>
                  ) : (
                    <Link href={`/settings?s=connections&c=${encodeURIComponent(connector.key)}`} className="arc-connector-setup" aria-label={`Set up ${connector.label} in Settings`}><ChevronRight size={14} /></Link>
                  )}
                </div>
              ))}
            </Fragment>
          ))}
          {connectorGroups.length === 0 ? <DrawerEmpty icon={<Link2 size={18} />} title="No connectors found" hint={connectorSearch.trim() || connectorFilter !== "all" ? "Try a different name, kind or status." : "Open Settings to refresh the workspace catalog."} /> : null}
          {/* Not built yet — nothing to act on, so out of the main list. */}
          {plannedConnectors.length > 0 ? (
            <div className="arc-planned">
              <button type="button" className="arc-planned-toggle" aria-expanded={plannedOpen} onClick={() => setPlannedOpen((open) => !open)}>
                <span>Not available yet · {plannedConnectors.length}</span>
                <ChevronDown size={14} className="arc-planned-chevron" />
              </button>
              {plannedOpen ? plannedConnectors.map((connector) => (
                <div className="arc-planned-item" key={connector.key}>
                  <b>{connector.label}</b>
                  <small>{connector.kindLabel}</small>
                </div>
              )) : null}
            </div>
          ) : null}
        </div>
        <div className="arc-drawer-section-head is-footer"><span>{connectorItems.length} workspace connectors</span><Link href="/settings?s=connections">Manage all <ArrowRight size={12} /></Link></div>
        <p className="arc-drawer-footnote"><ShieldCheck size={13} /> Switching a connector on lets Arc read it — signal sources only propose, and nothing sends without your approval.</p>
      </section> : null}

      {view === "saved" ? <section className="arc-drawer-view arc-drawer-saved" aria-label="Saved">
        <p className="arc-drawer-purpose">Responses, drafts and media you kept, ready to send back into any conversation.</p>
        {/* The search and chips only make sense once there is a list to narrow;
            while it loads, or when it is empty, they would be dead controls. */}
        {savedItems && savedItems.length > 0 ? <>
          <label className="arc-drawer-search"><Search size={14} /><input type="search" aria-label="Search saved items" placeholder="Search saved items" value={savedSearch} onChange={(event) => setSavedSearch(event.target.value)} /></label>
          <div className="arc-drawer-filters" role="group" aria-label="Filter saved items by kind">
            {([
              ["all", "All", savedCounts.all],
              ["draft", "Drafts", savedCounts.draft],
              ["angle", "Angles", savedCounts.angle],
              ["media", "Media", savedCounts.media],
            ] as const).filter(([id, , count]) => id === "all" || count > 0)
              .map(([id, label, count]) => <button type="button" key={id} className={savedKind === id ? "is-active" : ""} aria-pressed={savedKind === id} onClick={() => setSavedKind(id)}><span>{label}</span>{count > 0 ? <small>{count}</small> : null}</button>)}
          </div>
        </> : null}
        {savedError ? <p className="arc-saved-error" role="alert">{savedError}</p> : null}
        {savedLoading ? (
          <div className="arc-drawer-loading"><LoaderCircle size={14} className="is-spinning" /> Loading your saved items…</div>
        ) : savedItems && savedItems.length > 0 ? (<>
          <div className="arc-drawer-section-head"><span>{savedKind === "all" ? "Everything saved" : savedKind === "draft" ? "Drafts" : savedKind === "angle" ? "Angles" : "Media"}</span><small>{savedNarrowed ? `${visibleSaved.length} of ${savedCounts.all}` : `${savedCounts.all} item${savedCounts.all === 1 ? "" : "s"}`}</small></div>
          {/* No roving arrow keys here, unlike the other lists: a saved card
              carries up to four controls, so Down would step within a card
              rather than between them. Tab is the honest traversal. */}
          <div className="arc-saved-list">
            {visibleSaved.map((item) => (
              <div className="arc-saved-item" key={item.id}>
                <div className="arc-saved-main">
                  <span className="arc-saved-head">
                    <b className="arc-saved-title">{item.title}</b>
                    <span className={`arc-saved-kind is-${item.kind}`}>{item.kind === "draft" ? "Draft" : item.kind === "media" ? "Media" : "Angle"}</span>
                  </span>
                  {item.preview ? <p className="arc-saved-preview">{item.preview}</p> : null}
                  {/* The reuse the copy has always promised. Text goes into the
                      composer; media has no body to insert, so its reusable
                      artefact is the link. */}
                  <div className="arc-saved-actions">
                    {item.body ? (
                      <button type="button" className="arc-saved-use" onClick={() => onUseSaved(item.body!)}>
                        <CornerDownLeft size={12} /> Use in chat
                      </button>
                    ) : null}
                    <button type="button" className="arc-saved-copy" onClick={() => void copySaved(item)}>
                      {copiedSavedId === item.id ? <><Check size={12} /> Copied</> : <><Copy size={12} /> {item.kind === "media" ? "Copy link" : "Copy"}</>}
                    </button>
                    {item.conversationHref ? <Link href={item.conversationHref} className="arc-saved-open" onClick={onClose}>Source chat <ArrowRight size={12} /></Link> : null}
                  </div>
                </div>
                <button type="button" className="arc-saved-remove" onClick={() => removeSaved(item.id)} aria-label={`Remove saved item: ${item.title}`} title="Remove"><Trash2 size={14} /></button>
              </div>
            ))}
            {visibleSaved.length === 0 ? <DrawerEmpty icon={<Search size={18} />} title="Nothing matches" hint="Try another title, or a different kind." /> : null}
          </div>
        </>) : (
          <DrawerEmpty icon={<Bookmark size={18} />} title="Nothing saved yet" hint="Bookmark any Arc response to keep it here and reuse it in a later conversation." />
        )}
        <p className="arc-drawer-footnote"><ShieldCheck size={13} /> Reusing a saved item only fills the composer — the turn still runs, and outbound still waits on you.</p>
      </section> : null}
    </motion.aside>
  );
}

/** Status buckets for the connector list. Deliberately about what the operator
 *  can do next, not a mirror of `ConnectorStatus`: `not_configured` and `error`
 *  are one bucket because the next step for both is opening Settings. */
type ConnectorFilter = "all" | "on" | "off" | "setup";
type SavedKindFilter = "all" | SavedKind;

/**
 * Every "nothing here" in the drawer, in one shape. There were four — one per
 * tab — at three different heights, two icon sizes and two copy structures, so
 * an empty Skills tab and an empty Connectors tab looked like different
 * products. This is also why the tabs never lined up vertically when empty.
 */
function DrawerEmpty({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="arc-drawer-empty">
      <span className="arc-drawer-empty-mark">{icon}</span>
      <b>{title}</b>
      <span>{hint}</span>
    </div>
  );
}

/**
 * How much a generated skill's ranking is actually grounded. Surfaced next to
 * every voice skill so "a human approved these" is never mistaken for
 * "these converted" — the two look identical once rendered.
 */
/**
 * "This skill reads something you haven't switched on." Shown on the installed
 * row, the library card and beside the composer chip — the three places a skill
 * gets chosen — because the failure it replaces was silent at all three.
 *
 * It is a notice, never a gate: the copy always ends with what Arc will still do.
 */
function SkillRequirementNote({
  requirements,
  onShowConnector,
  compact = false,
}: {
  requirements: SkillRequirement[];
  onShowConnector?: (key: string) => void;
  compact?: boolean;
}) {
  if (requirements.length === 0) return null;
  const first = requirements[0]!;
  return (
    <p className="arc-skill-requirement" data-compact={compact ? "true" : undefined}>
      <CircleAlert size={12} />
      <span>{describeSkillRequirements(requirements)}</span>
      {onShowConnector ? (
        <button type="button" onClick={() => onShowConnector(first.key)}>
          {requirements.length === 1 ? "Open connector" : "Open connectors"}
        </button>
      ) : null}
    </p>
  );
}

/**
 * Where a skill came from, said out loud. This used to be a 4.5% background
 * tint keyed off `data-source`, which made a skill Arc ships and an untrusted
 * public GitHub import look the same — and they are not the same, which is why
 * the GitHub footnote exists.
 */
const SKILL_SOURCE_LABEL: Record<ArcSkillDefinition["source"], string> = {
  "built-in": "Built-in",
  system: "Built-in",
  library: "Library",
  github: "GitHub",
  generated: "Learned",
};

/** Ships with Arc — the default, and so the one that needs no badge. */
const isBuiltInSkill = (skill: ArcSkillDefinition) => skill.source === "built-in" || skill.source === "system";

const VOICE_TIER_LABEL: Record<GeneratedSkillRecord["evidenceTier"], string> = {
  outcome: "Backed by booked work",
  engagement: "Backed by opens & clicks",
  approval: "Backed by your approvals",
};

/** Adapt a stored voice skill to the shape the drawer's skill handlers take. */
function toDrawerSkill(record: GeneratedSkillRecord, workspaceName: string): ArcSkillDefinition {
  return {
    key: record.key,
    id: "approval-gated-drafting",
    name: record.name,
    description: record.description,
    prompt: record.description,
    commands: [record.command],
    mode: "draft",
    source: "generated",
    publisher: workspaceName || "This workspace",
  };
}

function SkillIcon({ skill, size = 17 }: { skill: ArcSkillDefinition; size?: number }) {
  if (skill.source === "generated") return <Sparkles size={size} />;
  if (skill.key === "skill-authoring") return <Blocks size={size} />;
  if (skill.key === "skill-installation") return <GitFork size={size} />;
  if (skill.source === "github") return <GitFork size={size} />;
  if (skill.key === "competitor-watch") return <Binoculars size={size} />;
  if (skill.key === "local-search-audit") return <MapPinned size={size} />;
  if (skill.key === "review-response-planner") return <MessagesSquare size={size} />;
  if (skill.key === "proposal-follow-up") return <MailCheck size={size} />;
  if (skill.key === "content-repurposer") return <Repeat2 size={size} />;
  if (skill.key === "storm-signal-monitor") return <CloudLightning size={size} />;
  if (skill.key === "opportunity-discovery") return <Radar size={size} />;
  if (skill.key === "audience-builder") return <Users size={size} />;
  if (skill.key === "persona-intelligence") return <Target size={size} />;
  if (skill.key === "campaign-builder") return <FileText size={size} />;
  if (skill.key === "asset-studio") return <LayoutTemplate size={size} />;
  if (skill.key === "performance-analysis") return <Gauge size={size} />;
  if (skill.key === "approval-review") return <ClipboardCheck size={size} />;
  return <Telescope size={size} />;
}

function ShareDialog({ conversationId, onClose }: { conversationId: string | null; onClose: () => void }) {
  const [state, setState] = useState<ChatSharingState | null>(null);
  const [visibility, setVisibility] = useState<ShareVisibility>("private");
  const [permission, setPermission] = useState<SharePermission>("view");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const reload = useCallback(() => {
    if (!conversationId) return;
    getChatSharingStateAction(conversationId).then((next) => {
      setState(next);
      setVisibility(next.visibility);
      setPermission(next.workspacePermission);
    });
  }, [conversationId]);
  useEffect(() => { reload(); }, [reload]);

  const save = () => conversationId && start(async () => {
    const result = await setChatSharingAction({ conversationId, visibility, workspacePermission: permission });
    setNotice(result.ok ? "Sharing updated" : result.error);
  });
  const add = (userId: string, nextPermission: SharePermission) => conversationId && start(async () => {
    await shareChatWithMemberAction({ conversationId, userId, permission: nextPermission });
    reload();
  });
  const remove = (userId: string) => conversationId && start(async () => {
    await unshareChatMemberAction({ conversationId, userId });
    reload();
  });

  return (
    <OverlayPortal>
      <motion.div className="arc-modal-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} role="presentation">
        <motion.div className="arc-share-dialog" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.99 }} role="dialog" aria-modal="true" aria-labelledby="arc-share-title" onClick={(event) => event.stopPropagation()}>
          <div className="arc-share-head"><div><h2 id="arc-share-title">Share conversation</h2><p>Private by default. Choose who can view or collaborate.</p></div><button type="button" className="arc-icon-button" onClick={onClose} aria-label="Close share dialog"><X size={17} /></button></div>
          {!conversationId ? <p className="arc-share-empty">Start a real conversation before sharing it.</p> : null}
          <fieldset disabled={busy || !conversationId}><legend>Who can access</legend><div className="arc-segment"><button type="button" className={visibility === "private" ? "is-active" : ""} onClick={() => setVisibility("private")}>Private</button><button type="button" className={visibility === "workspace" ? "is-active" : ""} onClick={() => setVisibility("workspace")}>Workspace</button></div></fieldset>
          {visibility === "workspace" ? <fieldset disabled={busy || !conversationId}><legend>Workspace permission</legend><div className="arc-segment"><button type="button" className={permission === "view" ? "is-active" : ""} onClick={() => setPermission("view")}>Can view</button><button type="button" className={permission === "collaborate" ? "is-active" : ""} onClick={() => setPermission("collaborate")}>Can collaborate</button></div></fieldset> : null}
          <button type="button" className="arc-primary-button" onClick={save} disabled={busy || !conversationId}>{busy ? "Saving…" : "Save access"}</button>
          <div className="arc-share-people"><h3>People with access</h3>{state?.shared.length ? state.shared.map((member) => <div key={member.userId}><span><Users size={15} /><b>{member.email ?? member.userId}</b><small>{member.permission}</small></span><button type="button" onClick={() => remove(member.userId)}>Remove</button></div>) : <p>No one has been added yet.</p>}{state?.addable.slice(0, 3).map((member) => <div key={member.userId}><span><Users size={15} /><b>{member.email ?? member.userId}</b></span><button type="button" onClick={() => add(member.userId, "view")}>Add</button></div>)}</div>
          {notice ? <p className="arc-share-notice">{notice}</p> : null}
        </motion.div>
      </motion.div>
    </OverlayPortal>
  );
}

/**
 * Stable identity for "no engine reachable". An object literal in the parameter
 * default allocates a fresh value every render, which is enough for the React
 * Compiler to give up on the component ("existing memoization could not be
 * preserved") — the whole file then falls back to uncompiled. A module constant
 * costs nothing and keeps the optimisation.
 */
const NO_MEDIA_ENGINES: EngineAvailability = { gemini: false, higgsfield: false };

export function ArcView({
  brandName,
  operatorName,
  live = false,
  historyLoadError = null,
  threadGroups = [],
  messages = [],
  activeConversationId = null,
  mentionGroups = [],
  waiting = null,
  initialDraft,
  initialDemoConversationId,
  connectorsConfigured = false,
  connectors = [],
  emailConnection = null,
  liveSendEnabled = false,
  installedSkillKeys: initialInstalledSkillKeys = [],
  workspaceSkills: initialWorkspaceSkills = [],
  generatedSkills: initialGeneratedSkills = [],
  workspaceName = "",
  mediaConfig = DEFAULT_MEDIA_CONFIG,
  mediaEngines = NO_MEDIA_ENGINES,
}: {
  brandName: string;
  operatorName?: string;
  live?: boolean;
  historyLoadError?: string | null;
  threadGroups?: ArcThreadGroupVM[];
  messages?: ArcMessage[];
  activeConversationId?: string | null;
  mentionGroups?: MentionGroup[];
  waiting?: ArcWaiting | null;
  initialDraft?: string;
  initialDemoConversationId?: string;
  connectorsConfigured?: boolean;
  connectors?: ConnectorView[];
  emailConnection?: ConnectionView | null;
  liveSendEnabled?: boolean;
  installedSkillKeys?: string[];
  workspaceSkills?: WorkspaceArcSkill[];
  generatedSkills?: GeneratedSkillRecord[];
  workspaceName?: string;
  /** The workspace's generation default — the media picker opens on it. */
  mediaConfig?: MediaConfig;
  /** Which engines this workspace can reach; the picker offers only these. */
  mediaEngines?: EngineAvailability;
}) {
  const router = useRouter();
  const greetName = operatorName?.trim() || brandName?.trim() || "there";
  const [isSending, startSend] = useTransition();
  const [isSavingSkill, startSavingSkill] = useTransition();
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [mode, setMode] = useState<ArcMode>(() => inferComposerMode(initialDraft ?? "", null));
  const [modePreference, setModePreference] = useState<ArcComposerModePreference>("auto");
  const [modelPreference, setModelPreference] = useState<ArcModelPreference>("auto");
  const [route, setRoute] = useState<ArcRoute>("fast");
  /**
   * Which model generates media on THIS turn, per output category.
   *
   * Separate from the reasoning pill beside it on purpose: `claude-opus` and
   * `veo3_1` are not substitutable options on one list — one is Arc's brain, the
   * other a tool the brain calls. Opens on the workspace default (Auto when the
   * workspace says "let Arc choose"), and a pick here beats that default.
   */
  const [mediaPick, setMediaPick] = useState<Record<MediaCategory, string>>(() =>
    mediaConfig.autoPick ? { image: MEDIA_AUTO, video: MEDIA_AUTO, audio: MEDIA_AUTO } : { ...mediaConfig.defaults },
  );
  const [composerMenu, setComposerMenu] = useState<ComposerMenu>(null);
  const [selectedMentions, setSelectedMentions] = useState<ArcMention[]>([]);
  const [attachments, setAttachments] = useState<ArcAttachment[]>([]);
  const [command, setCommand] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [contextInfoOpen, setContextInfoOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  /**
   * Dismissing the drawer hands focus back to the control that opened it —
   * otherwise a keyboard user who presses Escape is left with focus on a
   * detached node and has to Tab in from the top of the document.
   */
  const dismissHistory = useCallback(() => {
    setHistoryOpen(false);
    historyButtonRef.current?.focus();
  }, []);
  const [startingNewConversation, setStartingNewConversation] = useState(false);
  const [optimisticTurn, setOptimisticTurn] = useState<(OptimisticArcTurn & { baselineMessageCount: number }) | null>(null);
  const [installedSkillKeys, setInstalledSkillKeys] = useState(initialInstalledSkillKeys);
  const [workspaceSkills, setWorkspaceSkills] = useState(initialWorkspaceSkills);
  const [generatedSkills, setGeneratedSkills] = useState(initialGeneratedSkills);
  const [installingSkillKey, setInstallingSkillKey] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // Starts closed and is corrected after mount rather than read during render:
  // sessionStorage does not exist on the server, so seeding state from it would
  // hydrate a different tree than was sent (BSR-567).
  const [workPanelOpen, setWorkPanelOpen] = useState(false);
  /** The message we last auto-opened for, so closing the panel stays closed. */
  const autoOpenedForRef = useRef<string | null>(null);
  // The operator's own choice, restored once per mount. Only an explicit toggle
  // writes it — see work-panel-preference.ts for why the asset auto-open does not.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restored after hydration so server and client markup stay identical
    if (readWorkPanelPreference() === true) setWorkPanelOpen(true);
  }, []);
  // The assets open in the review workspace (null = closed), plus a per-asset
  // decision map so approvals persist while the panel is open and reflect back on
  // the inline package summary.
  const [reviewCards, setReviewCards] = useState<ArcActionCard[] | null>(null);
  const [assetStatuses, setAssetStatuses] = useState<Record<string, ArcAssetStatus>>({});
  // The readable copy behind each card, so the conversation renders the draft
  // instead of a receipt pointing at one. Keyed by asset id, same as statuses.
  // The offline preview seeds from fixtures; live seeds from the asset rows.
  const [assetBodies, setAssetBodies] = useState<Record<string, ArcAssetBody>>(live ? {} : DEMO_ASSET_BODIES);
  // Live guardrail findings per asset. A MISSING key means "not loaded yet" and
  // an empty array means "loaded, none recorded" — the card renders very
  // different things for those two, so the distinction is load-bearing.
  const [assetChecks, setAssetChecks] = useState<Record<string, ArcDraftFinding[]>>(live ? {} : DEMO_ASSET_CHECKS);
  const resolvedDemoConversationId =
    initialDemoConversationId &&
    (initialDemoConversationId === "new" ||
      DEMO_THREADS.some((group) => group.items.some((thread) => thread.id === initialDemoConversationId)))
      ? initialDemoConversationId
      : "storm";
  // Not state any more: switching demo threads is a navigation, and page.tsx
  // keys ArcView on `?c=`, so this is re-derived on the remount rather than
  // set in place.
  const selectedDemoId = resolvedDemoConversationId;
  const [dismissedQuestionId, setDismissedQuestionId] = useState<string | null>(null);
  const [demoTurns, setDemoTurns] = useState<DemoTurn[]>([]);
  const [demoPending, setDemoPending] = useState(false);
  const [stoppingTaskId, setStoppingTaskId] = useState<string | null>(null);
  // ↑ in an empty composer opens your last message for editing (the convention
  // in every chat app). A {id, n} token rather than a bare id so pressing ↑,
  // cancelling, and pressing ↑ again re-opens the same message.
  const [editSignal, setEditSignal] = useState<{ id: string; n: number } | null>(null);
  // A failure that belongs to one message — a regenerate or edit-and-resend that
  // didn't take — reported at that message instead of in the composer chip row,
  // which is where every error used to land regardless of where it happened.
  const [messageNotice, setMessageNotice] = useState<{ id: string; text: string } | null>(null);
  const demoTimer = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const composerMenuRef = useRef<HTMLDivElement | null>(null);
  const composerMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const chatRootRef = useRef<HTMLDivElement | null>(null);
  // The review overlay and the workspace panel cover the pane instead of docking
  // into it, so they need the same measured box the thread drawer does.
  const panelPaneBox = usePaneBox(chatRootRef, workPanelOpen || Boolean(reviewCards?.length));
  // Measured only while the drawer is open — see usePaneBox. `.arc-chat` is the
  // element the drawer used to be `position: absolute` inside, so its rect is
  // exactly the box the drawer should keep occupying now that it is portaled.
  const drawerPaneBox = usePaneBox(chatRootRef, historyOpen);
  // Bottom-follow tracking. `guard()` covers the deliberate scroll-to-top calls
  // (opening a thread at its start, a new chat) that move scrollTop up exactly
  // like a reader would, so the tracker doesn't read them as "the reader left
  // the bottom". The live reasoning window uses this same hook.
  const { pinned, pinnedRef, guard, repin } = useBottomPin(scrollRef);
  const showJump = !pinned;
  // Live reply pushed over SSE (body/reasoning/steps as they land), overlaid onto
  // the pending message for instant streaming without a full server refetch.
  const [streamOverlay, setStreamOverlay] = useState<ArcStreamOverlay | null>(null);
  const visibleConversationId = startingNewConversation ? null : activeConversationId;
  const visibleMessages = startingNewConversation ? [] : messages;
  // A run the server has judged dead is deliberately not "awaiting" — that is
  // what unlocks the composer, tears down the SSE subscription, and stops the
  // spinner on a turn the runner abandoned.
  const awaitingReply = live && (Boolean(optimisticTurn) || hasArcReplyInFlight(visibleMessages));
  // The newest reply that actually built something. A stable id (not the message
  // array) so the auto-open effect below fires on a new asset-bearing run rather
  // than on every render.
  const assetMessageId = live
    ? visibleMessages.findLast((message) => message.role === "arc" && message.actions.some((card) => card.approval || card.kind === "draft"))?.id ?? null
    : null;
  const isStreaming = awaitingReply || demoPending;
  const turnCount = live ? visibleMessages.length + (optimisticTurn ? 2 : 0) : demoTurns.length;

  useEffect(() => {
    if (!startingNewConversation || activeConversationId !== null || messages.length > 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the server has caught up with the optimistic blank-chat shell
    setStartingNewConversation(false);
  }, [activeConversationId, messages.length, startingNewConversation]);

  useEffect(() => {
    if (!optimisticTurn || messages.length <= optimisticTurn.baselineMessageCount) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical server messages have replaced the local pending shell
    setOptimisticTurn(null);
  }, [messages.length, optimisticTurn]);

  // Default to "instant": the scroll container sets `scroll-behavior: smooth`, so
  // an animated follow would restart a new tween every tick toward a moving
  // bottom and never arrive. Only the explicit jump pill animates.
  const scrollToEnd = useCallback((behavior: ScrollBehavior = "instant") => {
    // Defer a frame so we measure after new content (a fresh turn, a streamed
    // line, a card) has laid out — otherwise we under-scroll and appear stuck.
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior });
    });
  }, []);

  /**
   * Land at the bottom of a conversation that is still laying out.
   *
   * One rAF isn't enough when opening a thread: markdown, code blocks, tables,
   * and images all resolve their height after that first frame, so a single
   * scroll lands short and the newest turn sits below the fold. Keep pinning to
   * the bottom while the content is still growing, then stop.
   */
  const scrollToEndSettled = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    let lastHeight = -1;
    let stableFrames = 0;
    const startedAt = performance.now();
    const settle = () => {
      const node = scrollRef.current;
      if (!node || !pinnedRef.current) return;
      node.scrollTo({ top: node.scrollHeight, behavior: "instant" });
      stableFrames = node.scrollHeight === lastHeight ? stableFrames + 1 : 0;
      lastHeight = node.scrollHeight;
      // Two consecutive frames at the same height means layout has settled.
      if (stableFrames < 2 && performance.now() - startedAt < 1500) requestAnimationFrame(settle);
    };
    requestAnimationFrame(settle);
  }, [pinnedRef]);

  // Deliberate jump to the start of the feed (thread openers, new chat). Guarded
  // so the pin tracker doesn't read the upward jump as the reader scrolling away.
  const scrollToStart = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      guard();
      el.scrollTo({ top: 0, behavior: "instant" });
    });
  }, [guard]);

  // Subscribe to the live reply over SSE while one is in flight — pushes the
  // growing body/reasoning/steps as they land (no interval polling), then a `done`
  // event triggers a single refetch of the canonical message. The overlay is
  // cleared on teardown, so a completed reply always renders from server state.
  useEffect(() => {
    if (!live || !awaitingReply || !visibleConversationId) return;
    const source = new EventSource(`/api/arc/stream/${encodeURIComponent(visibleConversationId)}`);
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { messageId: string; body?: string; reasoning?: string | null; steps?: ArcStep[] };
        if (!data.messageId) return;
        setStreamOverlay((current) => applyArcStreamFrame(current, data));
      } catch {
        /* ignore a malformed frame */
      }
    };
    source.addEventListener("done", () => {
      source.close();
      router.refresh(); // pull the final message (body + actions / recall / suggestions)
    });
    // On a transient drop EventSource reconnects on its own; the backstop below
    // covers a hard failure so the bubble can never hang.
    return () => {
      source.close();
      setStreamOverlay(null);
    };
  }, [live, awaitingReply, visibleConversationId, router]);

  // Backstop: reconcile with the server while awaiting, so a blocked or
  // proxy-buffered SSE stream still resolves. Defense in depth, not the primary
  // path — the SSE stream above carries the live updates.
  //
  // This used to give up flat at 120s, which left an operator sitting on a dead
  // run watching a spinner that could never resolve: the server doesn't judge a
  // run stalled until ARC_RUN_STALE_MS (180s), so the client stopped looking a
  // full minute *before* the answer existed. It now keeps checking — slowly,
  // once the useful fast window is over — until past the stale cutoff, at which
  // point the stall verdict arrives, `awaitingReply` flips false, and this tears
  // itself down. The ceiling is derived from the cutoff so the two can't drift.
  useEffect(() => {
    if (!awaitingReply) return;
    const startedAt = Date.now();
    const ceiling = ARC_RUN_STALE_MS + 60_000;
    let timer = 0;
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      if (elapsed > ceiling) return;
      router.refresh();
      // Fast while a reply is plausibly seconds away; slow once we're only
      // waiting to be told it isn't coming.
      timer = window.setTimeout(tick, elapsed < 120_000 ? 6_000 : 15_000);
    };
    timer = window.setTimeout(tick, 6_000);
    return () => window.clearTimeout(timer);
  }, [awaitingReply, router]);

  // The workspace exists to hold campaign assets, so that is the only thing that
  // opens it on its own. Sending a message doesn't (a conversational turn has
  // nothing to put in it), and neither does a reply that is only prose.
  //
  // Keyed to the message, so an operator who closes it is not overruled — the
  // panel reopens only when a *different* run produces assets.
  useEffect(() => {
    if (!assetMessageId || autoOpenedForRef.current === assetMessageId) return;
    autoOpenedForRef.current = assetMessageId;
    setWorkPanelOpen(true);
  }, [assetMessageId]);

  /**
   * Follow the answer only once it actually reaches the bottom of the viewport.
   *
   * Previously this pinned to the bottom on every tick, which held the reply
   * against the composer and dragged it upward for the whole response — the
   * reader had to track a moving line rather than read a still one. Now the turn
   * starts with the question at the top (below) and the answer grows downward
   * into the space beneath it; following only kicks in when the message has
   * genuinely outgrown the screen, which is the point at which staying put would
   * mean losing the newest text.
   *
   * Still gated on `pinnedRef`, so a reader who scrolled up is never yanked back.
   */
  useEffect(() => {
    if (!isStreaming) return;
    const interval = window.setInterval(() => {
      if (!pinnedRef.current) return;
      const container = scrollRef.current;
      const active = container?.querySelector(".arc-assistant-message.is-active");
      if (!container || !active) {
        scrollToEnd();
        return;
      }
      // Only chase it once the growing reply has reached the bottom edge.
      if (active.getBoundingClientRect().bottom > container.getBoundingClientRect().bottom) scrollToEnd();
    }, 120);
    return () => window.clearInterval(interval);
  }, [isStreaming, scrollToEnd, pinnedRef]);

  /**
   * Keep the tail spacer at exactly the height needed for the newest question to
   * reach the top of the view, and no more.
   *
   * Measured rather than fixed: a `62vh` block was enough to anchor the turn but
   * had to be removed when the run ended, and removing it moved the view half a
   * screen. Sizing it to the shortfall means it is already near zero by the time
   * the reply is long, so nothing changes when the run settles, and a finished
   * conversation carries no dead space.
   */
  useLayoutEffect(() => {
    const container = scrollRef.current;
    const spacer = spacerRef.current;
    if (!container || !spacer) return;
    const resize = () => {
      const asked = [...container.querySelectorAll(".arc-operator-message")].at(-1);
      if (!asked) {
        spacer.style.height = "0px";
        return;
      }
      const containerTop = container.getBoundingClientRect().top;
      const askedTop = asked.getBoundingClientRect().top - containerTop;
      // How much of the view the newest turn already fills, measured from the
      // question down to the end of the content (excluding this spacer).
      const filled = container.scrollHeight - spacer.offsetHeight - (askedTop + container.scrollTop);
      spacer.style.height = `${Math.max(0, Math.round(container.clientHeight - filled - 24))}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const column = container.querySelector(".arc-conversation-column");
    if (column) observer.observe(column);
    return () => observer.disconnect();
  }, [turnCount, isStreaming]);

  /**
   * A new turn puts the question at the top of the view, so the answer has room
   * to arrive underneath it and can be read without moving.
   *
   * The feed reserves space below the in-flight reply (`.arc-turn-spacer`) so
   * this scroll has somewhere to go even before Arc has written anything —
   * without it the container isn't tall enough to put the question at the top,
   * and the view wouldn't move at all.
   */
  useEffect(() => {
    if (turnCount === 0) return;
    repin();
    requestAnimationFrame(() => {
      const container = scrollRef.current;
      const asked = container ? [...container.querySelectorAll(".arc-operator-message")].at(-1) : null;
      if (!container || !asked) {
        scrollToEnd();
        return;
      }
      const offset = asked.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTo({ top: container.scrollTop + offset - 16, behavior: "instant" });
    });
  }, [turnCount, scrollToEnd, repin]);

  // Opening or switching conversations should resume at the latest turn. This
  // is separate from turnCount because the seeded demo thread has no local turns.
  useEffect(() => {
    repin();
    if (getArcConversationScrollTarget({ live, activeConversationId: visibleConversationId, selectedDemoId }) === "start") {
      scrollToStart();
      return;
    }
    // Opening a thread lands on the newest turn, and keeps landing there while
    // the reply's markdown finishes laying out.
    scrollToEndSettled();
  }, [visibleConversationId, live, selectedDemoId, scrollToEndSettled, scrollToStart, repin]);

  useEffect(() => () => {
    if (demoTimer.current != null) window.clearTimeout(demoTimer.current);
  }, []);

  useEffect(() => {
    if (!composerMenu || !composerMenuTriggerRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      composerMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [composerMenu]);

  useEffect(() => {
    if (!composerMenu && !reviewCards && !contextInfoOpen) return;

    const dismissOpenSurface = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      if (composerMenu && !target.closest(".arc-composer-menu") && !target.closest('[aria-controls="arc-composer-menu"]')) {
        setComposerMenu(null);
      }

      if (contextInfoOpen && !target.closest(".arc-context-control")) {
        setContextInfoOpen(false);
      }

      if (reviewCards && !target.closest(".arc-artifact-workspace") && !target.closest('[data-arc-review-trigger="true"]')) {
        setReviewCards(null);
      }
    };

    document.addEventListener("pointerdown", dismissOpenSurface);
    return () => document.removeEventListener("pointerdown", dismissOpenSurface);
  }, [composerMenu, contextInfoOpen, reviewCards]);

  const activeThread = threadGroups.flatMap((group) => group.items).find((thread) => thread.id === visibleConversationId);
  const selectedDemoThread = DEMO_THREADS.flatMap((group) => group.items).find((thread) => thread.id === selectedDemoId);
  const header = getArcConversationHeader({
    live,
    activeTitle: activeThread?.title,
    selectedDemoId,
    selectedDemoTitle: selectedDemoThread?.title,
  });
  /* The campaigns this workspace can offer. Already fetched for the composer's
     @-mentions, so the header costs no extra read. The backend-less preview has
     no mentionables at all, and an empty picker there would hide the control
     rather than show it. */
  const workspaceCampaigns = mentionGroups.find((group) => group.type === "campaign")?.items ?? [];
  const campaignOptions = workspaceCampaigns.length > 0 ? workspaceCampaigns : live ? [] : DEMO_CAMPAIGNS;
  /* Assigned optimistically. `null` here means "no local change yet", which is
     distinct from a local change TO no campaign — hence the wrapper object.
     Reset comes free: page.tsx keys ArcView on `?c=`, so switching conversations
     remounts rather than carrying one chat's pending assignment onto another. */
  const [campaignOverride, setCampaignOverride] = useState<{ id: string | null } | null>(null);
  const [campaignNotice, setCampaignNotice] = useState<string | null>(null);
  const conversationCampaignId = campaignOverride
    ? campaignOverride.id
    : (live ? activeThread?.campaignId : selectedDemoThread?.campaignId) ?? null;

  const assignCampaign = (nextCampaignId: string | null) => {
    const previous = conversationCampaignId;
    setCampaignOverride({ id: nextCampaignId });
    setCampaignNotice(null);
    if (!live || !visibleConversationId) {
      // The preview has no backend to write to. It still moves, so the control
      // can be seen working, and says plainly that nothing was saved.
      setCampaignNotice("Preview — not saved");
      return;
    }
    startSend(async () => {
      const result = await assignArcConversationCampaignAction({
        conversationId: visibleConversationId,
        campaignId: nextCampaignId,
      });
      if (!result.ok) {
        setCampaignOverride({ id: previous });
        setCampaignNotice(result.error);
        return;
      }
      router.refresh();
    });
  };
  const latestQuestion = live ? [...visibleMessages].reverse().find((message) => message.role === "arc")?.questions?.[0] ?? null : null;
  const visibleQuestion = latestQuestion && latestQuestion.id !== dismissedQuestionId ? latestQuestion : null;
  // No special case for the empty conversation: contextUsage([]) is already
  // 0% (asserted in context-usage.test.ts). The branch that used to be here
  // substituted a hardcoded 18%, so a conversation with nothing in it claimed
  // a fifth of the window was spent.
  const contextState = contextUsage(visibleMessages.map((message) => message.body ?? ""));
  // The context meter is a persistent affordance again: it always shows so the
  // operator can see (and click into) how full the window is at any point, not
  // only once usage crosses a threshold. Its ring still colors by level, so a
  // calm low-usage state reads differently from a warning.
  const showContextMeter = true;
  const mentionItems = mentionGroups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label }))).slice(0, 12);
  const skillQuery = draft.match(/^\s*\/([^\s]*)$/)?.[1]?.toLowerCase() ?? "";
  const unresolvedSkillToken = /^\s*\/[^\s]*$/.test(draft);
  const unresolvedMentionToken = /@\s*$/.test(draft);
  const installedSkills = [
    ...ARC_SKILLS,
    ...ARC_SKILL_LIBRARY.filter((skill) => installedSkillKeys.includes(skill.key)),
    ...workspaceSkills,
  ];
  const selectedSkill = command
    ? [ARC_SKILL_BUILDER, ARC_SKILL_INSTALLER, ...installedSkills].find((skill) => skill.commands.some((candidate) => candidate.replace(/^\//, "") === command)) ?? null
    : null;
  const visibleSkills = [ARC_SKILL_BUILDER, ARC_SKILL_INSTALLER, ...installedSkills].filter((skill) => {
    if (!skillQuery) return true;
    return skill.name.toLowerCase().includes(skillQuery)
      || skill.commands.some((candidate) => candidate.toLowerCase().includes(skillQuery));
  });
  /* The same check the drawer runs, at the last moment it still matters: the
     skill is chipped and the operator is about to type into it. Without this,
     picking a skill from the `/` menu — which never passes through the drawer —
     reaches the runner with no warning at all. */
  const selectedSkillRequirements = selectedSkill
    ? unmetSkillConnectors(
        selectedSkill,
        connectors.map((connector) => ({ key: connector.key, label: connector.label, status: connector.status })),
      )
    : [];
  const currentModel = MODEL_OPTIONS.find((option) => option.id === modelPreference) ?? MODEL_OPTIONS[0];
  const resolvedModelName = route === "fast" ? "Spark" : "Forge";
  const capabilityLabel = mode === "ask" ? "Read only" : "Work";
  const capabilityDetail = mode === "ask" ? "No changes" : "No outbound";
  const showDemoLauncher = shouldShowDemoLauncher({ selectedDemoId, turnCount: demoTurns.length, pending: demoPending });
  const contextScopes = ARC_CONTEXT_SCOPES;

  const updateDraft = (value: string) => {
    setDraft(value);
    setMode(inferComposerMode(value, command, modePreference));
    if (modelPreference === "auto") {
      setRoute(resolveArcModelRoute({ preference: modelPreference, request: value, command }));
    }
  };

  const closeComposerMenu = (restoreFocus = false) => {
    setComposerMenu(null);
    if (restoreFocus) window.requestAnimationFrame(() => composerMenuTriggerRef.current?.focus());
  };

  const toggleComposerMenu = (menu: Exclude<ComposerMenu, null>, trigger: HTMLButtonElement) => {
    composerMenuTriggerRef.current = trigger;
    setContextInfoOpen(false);
    setComposerMenu((current) => current === menu ? null : menu);
    setComposerNotice(null);
  };

  const handleComposerMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')).filter((item) => !item.disabled);
    if (event.key === "Escape") {
      event.preventDefault();
      closeComposerMenu(true);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      const activeItem = document.activeElement as HTMLButtonElement | null;
      if (activeItem && items.includes(activeItem)) {
        event.preventDefault();
        activeItem.click();
      }
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (currentIndex + 1 + items.length) % items.length : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  const chooseMention = (mention: ArcMention) => {
    setSelectedMentions((current) => current.some((item) => item.type === mention.type && item.id === mention.id) ? current : [...current, mention]);
    setDraft((current) => current.replace(/@\s*$/, ""));
    closeComposerMenu(true);
  };

  const chooseSkill = (skill: ArcSkillDefinition) => {
    const nextCommand = skill.commands[0]!.replace(/^\//, "");
    setCommand(nextCommand);
    setModePreference("auto");
    setMode(resolveArcComposerMode({ request: draft, commandMode: skill.mode }));
    if (modelPreference === "auto") {
      setRoute(resolveArcModelRoute({ preference: modelPreference, request: draft, command: nextCommand }));
    }
    setDraft((current) => current.replace(/^\s*\/[^\s]*\s*/, ""));
    closeComposerMenu();
    window.requestAnimationFrame(() => composerInputRef.current?.focus());
  };

  const chooseModel = (preference: ArcModelPreference) => {
    setModelPreference(preference);
    setRoute(resolveArcModelRoute({ preference, request: draft, command }));
    closeComposerMenu(true);
  };

  // The pick is per-category, and a chat turn has no image/video switch — the
  // request is the only signal at send time, exactly as the route already is.
  const mediaModelCategory: MediaCategory = inferMediaCategory(draft);
  const mediaModelOptions = generationModelsFor(mediaModelCategory, mediaEngines);
  const activeMediaModel = findGenerationModel(mediaPick[mediaModelCategory]);

  const chooseMediaModel = (category: MediaCategory, key: string) => {
    setMediaPick((prev) => ({ ...prev, [category]: key }));
    closeComposerMenu(true);
  };

  const chooseModePreference = (preference: ArcComposerModePreference) => {
    setModePreference(preference);
    setMode(inferComposerMode(draft, command, preference));
    closeComposerMenu(true);
  };

  const handleAttachmentFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setComposerMenu(null);
    setComposerNotice(null);

    if (!live) {
      setAttachments((current) => [
        ...current,
        ...files.map((file, index) => ({
          url: `demo://attachment/${Date.now()}-${index}`,
          objectPath: `demo/${file.name}`,
          contentType: file.type || "application/octet-stream",
          name: file.name,
        })),
      ]);
      return;
    }

    setUploading(true);
    // `finally`, because `uploading` gates submitDraft. Without it a rejected
    // upload — a network blip, an action that throws — leaves the flag true for
    // the life of the page, and from then on every send returns silently at the
    // guard below: no message, no error, no request. That is not hypothetical;
    // it is a day of "I sent it and nothing happened".
    try {
      const results = await Promise.all(files.map(async (file) => {
        const formData = new FormData();
        formData.append("file", file);
        return uploadArcAttachmentAction(formData);
      }));
      const uploaded = results.flatMap((result) => result.ok ? [result.attachment] : []);
      const firstError = results.find((result) => !result.ok);
      if (uploaded.length > 0) setAttachments((current) => [...current, ...uploaded]);
      setComposerNotice(firstError && !firstError.ok ? firstError.error : `${uploaded.length} file${uploaded.length === 1 ? "" : "s"} attached`);
    } catch (error) {
      setComposerNotice(error instanceof Error ? `Attachment failed: ${error.message}` : "That attachment could not be uploaded.");
    } finally {
      setUploading(false);
    }
  };

  const submitDraft = () => {
    const body = draft.trim();
    // Silent: the composer is already showing why (empty box, open skill picker,
    // open mention picker). See composer-guard.ts for the rule.
    if (isMidComposition(body)) return;
    // Never silent: these are flags the operator cannot see. A send that does
    // nothing and says nothing is indistinguishable from a broken app — which is
    // precisely how a stuck `uploading` went unnoticed for a day.
    const blocked = describeBlockedSend({ isSending, demoPending, uploading });
    if (blocked) {
      setComposerNotice(blocked);
      return;
    }
    if (command === "add-skill") {
      setComposerMenu(null);
      setComposerNotice(null);
      startSavingSkill(async () => {
        const preview = await previewArcGithubSkillAction({ url: body });
        if (!preview.ok) {
          setComposerNotice(preview.error);
          return;
        }
        if (!preview.skill.repositoryUrl) {
          setComposerNotice("That skill is missing its GitHub source.");
          return;
        }
        const result = await installArcGithubSkillAction({ url: preview.skill.repositoryUrl });
        if (!result.ok) {
          setComposerNotice(result.error);
          return;
        }
        setWorkspaceSkills(result.persisted ? result.skills : [...workspaceSkills.filter((skill) => skill.key !== preview.skill.key), ...result.skills]);
        setDraft("");
        setCommand(null);
        setComposerNotice(`${preview.skill.name} installed${result.persisted ? " for this workspace" : " for this preview"}. Use ${preview.skill.commands[0]} anytime.`);
      });
      return;
    }
    const resolvedMode = inferComposerMode(body, command, modePreference);
    const resolvedRoute = resolveArcModelRoute({ preference: modelPreference, request: body, command });
    setMode(resolvedMode);
    setRoute(resolvedRoute);
    setComposerMenu(null);
    setContextInfoOpen(false);
    setComposerNotice(null);
    // Sending a message no longer forces the workspace open. It used to, on any
    // window wider than 1000px, whether or not the run would put anything in it
    // — so "hi" opened a drawer reading "Activity will collect here during the
    // next run", and closing it was overridden by the next message. The panel
    // opens when it is earned: the Workspace button, or approval-gated assets.
    if (!live) {
      const demoContract = buildArcRunContract({ mode: resolvedMode, route: resolvedRoute, contextScopes });
      const demoProfile = buildArcRunProfile({ request: body, mode: resolvedMode, command, sources: demoContract.readScopes });
      const operatorTurn: DemoTurn = { id: `operator-${Date.now()}`, role: "operator", body, mode: resolvedMode, command };
      setDemoTurns((current) => [...current, operatorTurn]);
      setDraft("");
      setSelectedMentions([]);
      setAttachments([]);
      setCommand(null);
      setMode(resolveArcComposerMode({ request: "", preference: modePreference }));
      setDemoPending(true);
      demoTimer.current = window.setTimeout(() => {
        setDemoPending(false);
        setDemoTurns((current) => [...current, {
          id: `arc-${Date.now()}`,
          role: "arc",
          body: demoProfile.completedSummary,
          mode: resolvedMode,
          command,
        }]);
      }, 6000);
      return;
    }
    const pendingTurn = {
      body,
      mode: resolvedMode,
      route: resolvedRoute,
      contextScopes: [...contextScopes],
      baselineMessageCount: messages.length,
    } satisfies OptimisticArcTurn & { baselineMessageCount: number };
    const pendingMentions = selectedMentions;
    const pendingAttachments = attachments;
    const pendingCommand = command;
    setOptimisticTurn(pendingTurn);
    setDraft("");
    setSelectedMentions([]);
    setAttachments([]);
    setCommand(null);
    setMode(resolveArcComposerMode({ request: "", preference: modePreference }));
    repin();
    startSend(async () => {
      const result = await sendArcMessageAction({
        conversationId: visibleConversationId,
        body,
        mentions: pendingMentions,
        attachments: pendingAttachments,
        mode: resolvedMode,
        route: resolvedRoute,
        mediaModel: mediaPick[mediaModelCategory],
        command: pendingCommand,
        contextScopes,
      });
      if (!result.ok) {
        setOptimisticTurn(null);
        setDraft(body);
        setSelectedMentions(pendingMentions);
        setAttachments(pendingAttachments);
        setCommand(pendingCommand);
        setComposerNotice(result.error);
        return;
      }
      router.push(`/arc?c=${result.conversationId}`);
      router.refresh();
    });
  };

  // Switching threads and starting a new one are plain navigations now: the
  // rail links to `/arc?c=<id>` and `/arc?new=1`, and page.tsx keys ArcView on
  // that param, so the whole view remounts with the right conversation. These
  // used to be in-place state resets because the drawer switched threads
  // without leaving the page; it no longer holds a thread list.
  const openReview = (cards: ArcActionCard[]) => {
    setComposerMenu(null);
    setContextInfoOpen(false);
    setWorkPanelOpen(true);
    setReviewCards(cards.filter((card) => card.approval));
  };

  /**
   * The ONLY operator-facing toggle — the Workspace button, the panel's own
   * close, and the scrim all land here, so it is also the only thing that
   * records a preference. The asset auto-open calls setWorkPanelOpen directly
   * and stays unrecorded on purpose.
   */
  const setWorkPanelVisibility = (open: boolean) => {
    setWorkPanelOpen(open);
    writeWorkPanelPreference(open);
    if (!open) setReviewCards(null);
  };

  const recordAssetStatus = (assetId: string, status: ArcAssetStatus) => {
    setAssetStatuses((current) => ({ ...current, [assetId]: status }));
  };

  const stopDemoRun = () => {
    if (demoTimer.current != null) window.clearTimeout(demoTimer.current);
    demoTimer.current = null;
    setDemoPending(false);
    setDemoTurns((current) => {
      const latestOperator = [...current].reverse().find((turn) => turn.role === "operator");
      return [...current, {
        id: `arc-stopped-${Date.now()}`,
        role: "arc",
        outcome: "canceled",
        body: "Stopped. No remaining work was applied, and nothing was sent.",
        mode: latestOperator?.mode,
        command: latestOperator?.command,
      }];
    });
    setComposerNotice("Run stopped. Its receipt is preserved in this conversation.");
  };

  const stopLiveRun = async (taskId: string, conversationId: string) => {
    if (stoppingTaskId) return;
    setStoppingTaskId(taskId);
    setComposerNotice(null);
    const result = await cancelArcRunAction({ taskId, conversationId });
    setStoppingTaskId(null);
    setComposerNotice(result.ok ? "Run stopped. Its receipt remains in the conversation." : result.error);
    router.refresh();
  };

  // Both of these used to report into `composerNotice` — so a regenerate that
  // failed on the third message announced itself at the bottom of the screen,
  // next to the send button, and overwrote whatever the last error was. They
  // report at the message they belong to now.
  const handleEditResend = (messageId: string, newBody: string) => {
    setComposerNotice(null);
    setMessageNotice(null);
    startSend(async () => {
      const result = await editAndResendArcMessageAction({ messageId, body: newBody });
      if (!result.ok) return setMessageNotice({ id: messageId, text: result.error });
      router.refresh();
    });
  };

  const handleRegenerate = (replyMessageId: string) => {
    setComposerNotice(null);
    setMessageNotice(null);
    startSend(async () => {
      const result = await regenerateArcReplyAction(replyMessageId);
      if (!result.ok) return setMessageNotice({ id: replyMessageId, text: result.error });
      router.refresh();
    });
  };

  // Demo-only: simulate edit-and-resend by re-running the edited turn locally.
  const demoEditResend = (body: string) => {
    if (demoPending) return;
    const resolvedMode = inferComposerMode(body, command, modePreference);
    const resolvedRoute = resolveArcModelRoute({ preference: modelPreference, request: body, command });
    setRoute(resolvedRoute);
    const profile = buildArcRunProfile({ request: body, mode: resolvedMode, command, sources: buildArcRunContract({ mode: resolvedMode, route: resolvedRoute, contextScopes }).readScopes });
    setDemoTurns((current) => [...current, { id: `operator-edit-${Date.now()}`, role: "operator", body, mode: resolvedMode, command }]);
    setDemoPending(true);
    demoTimer.current = window.setTimeout(() => {
      setDemoPending(false);
      setDemoTurns((current) => [...current, { id: `arc-edit-${Date.now()}`, role: "arc", body: profile.completedSummary, mode: resolvedMode, command }]);
    }, 4500);
  };

  // Overlay the SSE-streamed body/reasoning/steps onto the in-flight message, so
  // it types out live. Applied ONLY while that message is still pending — once the
  // server marks it complete, the canonical message (with its structured extras)
  // wins and the overlay is ignored.
  const renderedMessages = streamOverlay
    ? visibleMessages.map((message) =>
        message.id === streamOverlay.id && (message.status === "pending" || (message.role === "arc" && !message.body.trim()))
          ? {
              ...message,
              body: streamOverlay.body || message.body,
              reasoning: streamOverlay.reasoning ?? message.reasoning,
              steps: streamOverlay.steps.length ? streamOverlay.steps : message.steps,
            }
          : message,
      )
    : visibleMessages;
  const latestArcMessage = [...renderedMessages].reverse().find((message) => message.role === "arc");
  const latestDemoRequest = [...demoTurns].reverse().find((turn) => turn.role === "operator")?.body;
  const latestDemoArcTurn = [...demoTurns].reverse().find((turn) => turn.role === "arc");
  const demoSeed = shouldUseDemoSeedWorkspace({ live, selectedDemoId, turnCount: demoTurns.length });
  const workCards = live ? latestArcMessage?.actions ?? [] : demoSeed ? DEMO_WORKSPACE_CARDS : [];
  const reviewableWorkCards = (live || selectedDemoId === "new" ? workCards : DEMO_PACKAGE_CARDS).filter((card) => card.approval);
  // Stable key for EVERY asset this conversation references — not just the latest
  // turn's. Receipt cards render per message throughout the thread and all read
  // the same status map, so seeding only `workCards` (the newest arc message) left
  // every earlier receipt on its draft-time snapshot: a decided, archived asset
  // still showing "Needs review" three messages up.
  const conversationAssetKey = [
    ...new Set(
      renderedMessages
        .flatMap((message) => message.actions ?? [])
        .map((card) => card.approval?.assetId ?? "")
        .filter(Boolean),
    ),
  ]
    .sort()
    .join(",");
  // Seed the decision map from the LIVE asset records.
  //
  // It used to start empty and was only ever written by the chat's own review
  // panel, so `statuses[id] ?? card.status` fell through to the status Arc froze
  // at draft time. Decide on the campaign page and the conversation never heard:
  // it kept showing "Needs review" for assets approved and sent hours earlier,
  // and the `n need review` chip counted work that no longer existed.
  //
  // A local decision still wins — it is newer than anything this fetch returned.
  useEffect(() => {
    if (!live || !conversationAssetKey) return;
    let cancelled = false;
    getArcAssetStatusesAction(conversationAssetKey.split(","))
      .then((fromDb) => {
        if (cancelled || !fromDb || Object.keys(fromDb).length === 0) return;
        setAssetStatuses((current) => ({ ...fromDb, ...current }));
      })
      .catch(() => {
        // Best-effort: a failed lookup leaves the card snapshot in place rather
        // than blanking a status the operator is looking at.
      });
    return () => { cancelled = true; };
  }, [live, conversationAssetKey]);

  /**
   * The copy itself, for the same set of assets.
   *
   * Separate from the status fetch on purpose: a status is four bytes and a body
   * is a page of prose, so a failure to load the copy must not cost the chat its
   * live decision state. Each falls back independently — no bodies means every
   * card renders its stored preview, which is what it did before this existed.
   */
  useEffect(() => {
    if (!live || !conversationAssetKey) return;
    let cancelled = false;
    getArcAssetBodiesAction(conversationAssetKey.split(","))
      .then((fromDb) => {
        if (cancelled || !fromDb || Object.keys(fromDb).length === 0) return;
        setAssetBodies((current) => ({ ...current, ...fromDb }));
      })
      .catch(() => {
        // Best-effort, as above: the card keeps its preview.
      });
    return () => { cancelled = true; };
  }, [live, conversationAssetKey]);

  /**
   * The findings recorded against those same assets.
   *
   * The card's own `flags` are frozen at draft time and on prod are usually
   * empty while the asset holds OPEN findings — 15 of them across 13 assets,
   * two of which are blockers. Reading live is the only way the chat can report
   * a finding raised after Arc drafted, or stop reporting one since resolved.
   */
  useEffect(() => {
    if (!live || !conversationAssetKey) return;
    let cancelled = false;
    getArcAssetChecksAction(conversationAssetKey.split(","))
      .then((fromDb) => {
        if (cancelled || !fromDb) return;
        setAssetChecks((current) => ({ ...current, ...fromDb }));
      })
      .catch(() => {
        // Best-effort: the card falls back to "unknown" and stays silent about
        // checks rather than claiming there were none.
      });
    return () => { cancelled = true; };
  }, [live, conversationAssetKey]);

  const needsReviewCards = reviewableWorkCards.filter((card) => {
    const status = assetStatuses[card.approval?.assetId ?? ""] ?? card.status ?? "draft";
    return status !== "approved" && status !== "rejected" && status !== "revision";
  });
  const panelVisible = workPanelOpen || Boolean(reviewCards?.length);
  /**
   * Whether the workspace takes room from the conversation instead of covering
   * it. Measured from the pane, not the window — the rail eats ~240px, so a
   * viewport test would dock at widths where the chat has no room left.
   *
   * Decided here rather than by `@container arcpane` because the panel and its
   * scrim are portaled out of `.arc-chat`, where that container query would
   * silently never match. Only the work panel docks: the deliverable review is
   * a full-pane read by design.
   */
  const workPanelDocked = workPanelOpen
    && !reviewCards?.length
    && (panelPaneBox?.width ?? 0) >= WORK_PANEL_DOCK_MIN_PANE;

  const recoverRun = (prompt: string) => {
    updateDraft(prompt);
    setWorkPanelVisibility(false);
  };

  const applyDrawerSkill = (skill: ArcSkillDefinition) => {
    const nextCommand = skill.commands[0]!.replace(/^\//, "");
    setCommand(nextCommand);
    setModePreference("auto");
    setMode(resolveArcComposerMode({ request: "", commandMode: skill.mode }));
    setDraft("");
    if (modelPreference === "auto") {
      setRoute(resolveArcModelRoute({ preference: modelPreference, request: "", command: nextCommand }));
    }
    setHistoryOpen(false);
    window.requestAnimationFrame(() => composerInputRef.current?.focus());
  };

  /**
   * Put a saved item back to work in the current turn.
   *
   * Appends rather than replaces: the Saved tab is usually opened *while*
   * writing something, and silently discarding a half-typed message to paste an
   * angle over it would be its own small betrayal.
   */
  const useSavedItem = (text: string) => {
    const addition = text.trim();
    if (!addition) return;
    const current = draft.trim();
    updateDraft(current ? `${current}\n\n${addition}` : addition);
    setHistoryOpen(false);
    window.requestAnimationFrame(() => {
      const input = composerInputRef.current;
      if (!input) return;
      input.focus();
      // Caret at the end, so the next keystroke continues the message rather
      // than landing in the middle of what was just inserted.
      input.setSelectionRange(input.value.length, input.value.length);
    });
  };

  const setLibrarySkillInstalled = (skill: ArcSkillDefinition, installed: boolean) => {
    if (isSavingSkill) return;
    const previous = installedSkillKeys;
    const optimistic = installed
      ? [...new Set([...previous, skill.key])]
      : previous.filter((key) => key !== skill.key);
    setInstalledSkillKeys(optimistic);
    setInstallingSkillKey(skill.key);
    startSavingSkill(async () => {
      const result = await setArcSkillInstalledAction({ skillKey: skill.key, installed });
      if (!result.ok) {
        setInstalledSkillKeys(previous);
        setComposerNotice(result.error);
      } else {
        if (result.persisted) setInstalledSkillKeys(result.installedSkillKeys);
        setComposerNotice(`${skill.name} ${installed ? "installed" : "removed"}${result.persisted ? " for this workspace" : " for this preview"}.`);
      }
      setInstallingSkillKey(null);
    });
  };

  return (
    <div className="arc-chat" ref={chatRootRef} data-workspace-open={panelVisible ? "true" : "false"} data-workspace-docked={workPanelDocked ? "true" : "false"} data-new-conversation={live && !visibleConversationId && visibleMessages.length === 0 && !optimisticTurn ? "true" : "false"}>
      {/* The chat surface has no visible title; this names the document so the
          route still has exactly one h1 like every other. */}
      <h1 className="sr-only">Arc</h1>
      <header className="arc-conversation-header">
        {/* Named for what it opens. It said "Conversations" back when the drawer
            held a second copy of the chat list; that list is the rail's now, and
            a control that promises conversations and delivers skills and
            connectors is worse than one that says so. */}
        <button type="button" ref={historyButtonRef} className="arc-history-button" onClick={() => setHistoryOpen(true)} aria-expanded={historyOpen} aria-haspopup="dialog" aria-label="Open skills, connectors, and saved items"><Blocks size={17} /><span>Skills</span></button>
        <div className="arc-conversation-title">
          <h2>{header.title}</h2>
          {/* The campaign sits with the title because it describes the chat, not
              beside Share and Workspace, which act on it. */}
          <div className="arc-conversation-meta">
            <ConversationCampaign
              campaignId={conversationCampaignId}
              campaigns={campaignOptions}
              disabled={live && !visibleConversationId}
              disabledHint="Send a message first — a campaign attaches to a saved conversation"
              notice={campaignNotice}
              onAssign={assignCampaign}
            />
            <p>{header.subtitle}</p>
          </div>
        </div>
        <div className="arc-conversation-actions">
          {needsReviewCards.length > 0 ? <button type="button" className="arc-header-attention" aria-label={`${needsReviewCards.length} items need you`} onClick={() => openReview(needsReviewCards)}><ClipboardCheck size={15} /><span>{needsReviewCards.length} need you</span></button> : null}
          <button type="button" onClick={() => setShareOpen(true)} disabled={!visibleConversationId} title={!visibleConversationId ? "Start a real conversation before sharing" : "Share conversation"}><Share2 size={15} /> Share</button>
          <button type="button" className="arc-header-work" aria-expanded={panelVisible} aria-label={panelVisible ? "Close conversation workspace" : "Open conversation workspace"} onClick={() => setWorkPanelVisibility(!panelVisible)}>{panelVisible ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}<span>Workspace</span></button>
        </div>
      </header>

      {/* A <div>, not <main>: the shell now provides the page's single main
          landmark, and nesting one inside another is invalid. */}
      <div className="arc-conversation-scroll" ref={scrollRef}>
        <div className="arc-conversation-column">
          {live && historyLoadError ? <div className="arc-history-load-error" role="status"><CircleAlert size={15} /><span><b>History is temporarily unavailable.</b>{historyLoadError}</span></div> : null}
          {live ? <LiveConversation messages={renderedMessages} optimisticTurn={optimisticTurn} operatorName={greetName} waiting={waiting} assetStatuses={assetStatuses} assetBodies={assetBodies} assetChecks={assetChecks} onSuggestion={updateDraft} onReview={openReview} onEdit={handleEditResend} onRegenerate={handleRegenerate} onCancelRun={stopLiveRun} stoppingTaskId={stoppingTaskId} onAssetStatus={recordAssetStatus} editSignal={editSignal} messageNotice={messageNotice} onDismissMessageNotice={() => setMessageNotice(null)} /> : showDemoLauncher ? <ArcLauncher greetName={greetName} waiting={DEMO_WAITING} onPick={updateDraft} /> : <DemoConversation turns={demoTurns} pending={demoPending} includeSeed={selectedDemoId !== "new"} packageStatuses={assetStatuses} assetBodies={assetBodies} assetChecks={assetChecks} pendingContract={buildArcRunContract({ mode, route, contextScopes, agentTaskId: "DEMO-RUNNING" })} onReview={openReview} onEditResend={demoEditResend} onStop={stopDemoRun} onAssetStatus={recordAssetStatus} />}
          {/* Room for the reply to arrive into, so the question can sit at the
              top of the view while the answer grows downward beneath it.
              Always mounted, and sized to exactly the shortfall — it shrinks as
              the reply grows and is zero once the turn fills the screen. An
              earlier version mounted it only while streaming, which meant
              unmounting it at completion moved the view 512px: the very jump
              this whole area exists to remove. */}
          <div ref={spacerRef} className="arc-turn-spacer" aria-hidden="true" />
          <div ref={endRef} />
        </div>
      </div>

      <footer className="arc-composer-dock">
        <div className="arc-composer-column">
          <AnimatePresence>
            {showJump ? (
              <motion.button
                type="button"
                className="arc-jump"
                onClick={() => { repin(); scrollToEnd("smooth"); }}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.16 }}
                aria-label="Jump to latest message"
              >
                <ChevronDown size={15} /> Latest
              </motion.button>
            ) : null}
          </AnimatePresence>
          {visibleQuestion ? <QuestionPrompt question={visibleQuestion} onChoose={(value) => { updateDraft(value); setDismissedQuestionId(visibleQuestion.id); }} onDismiss={() => setDismissedQuestionId(visibleQuestion.id)} /> : null}
          <div className="arc-composer" data-busy={isSending || demoPending ? "true" : "false"}>
            <input ref={fileInputRef} type="file" hidden multiple accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv" onChange={handleAttachmentFiles} />

            <AnimatePresence>
              {composerMenu ? (
                <motion.div ref={composerMenuRef} id="arc-composer-menu" className="arc-composer-menu" data-menu={composerMenu} role="menu" aria-label={composerMenu === "commands" ? "Skills menu" : composerMenu === "mode" ? "Capability menu" : `${composerMenu} menu`} onKeyDown={handleComposerMenuKeyDown} initial={{ opacity: 0, y: 7, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 5, scale: 0.99 }} transition={{ duration: 0.16 }}>
                  {composerMenu === "tools" ? (
                    <>
                      <div className="arc-composer-menu-head"><b>Add to this message</b><button type="button" onClick={() => closeComposerMenu(true)} aria-label="Close message tools"><X size={14} /></button></div>
                      <button type="button" role="menuitem" onClick={() => { closeComposerMenu(); fileInputRef.current?.click(); }}><Paperclip size={16} /><span><b>Upload a file</b><small>Images, PDFs, text, Markdown, or CSV</small></span></button>
                      <button type="button" role="menuitem" onClick={() => setComposerMenu("mentions")}><AtSign size={16} /><span><b>Add workspace context</b><small>Campaigns, contacts, properties, and more</small></span></button>
                      <button type="button" role="menuitem" onClick={() => setComposerMenu("commands")}><Blocks size={16} /><span><b>Use a skill</b><small>Start a focused Arc workflow</small></span></button>
                    </>
                  ) : null}

                  {composerMenu === "model" ? (
                    <>
                      <div className="arc-model-menu-label">Model</div>
                      <div className="arc-model-options">
                        {MODEL_OPTIONS.map((option) => <button type="button" className="arc-model-option" data-model={option.id} role="menuitemradio" aria-checked={modelPreference === option.id} key={option.id} onClick={() => chooseModel(option.id)}><i className="arc-model-symbol" aria-hidden="true"><ArcModelIcon model={option.id} size={16} /></i><span><b>{option.label}</b><small>{option.description}</small></span><i className="arc-model-check" aria-hidden="true">{modelPreference === option.id ? <Check size={14} /> : null}</i></button>)}
                      </div>
                    </>
                  ) : null}

                  {composerMenu === "media" ? (
                    <>
                      <div className="arc-model-menu-label">Media model<span>{mediaModelCategory === "video" ? "Video" : "Image"}</span></div>
                      <div className="arc-model-options">
                        <button type="button" className="arc-model-option" role="menuitemradio" aria-checked={!activeMediaModel} onClick={() => chooseMediaModel(mediaModelCategory, MEDIA_AUTO)}><i className="arc-model-symbol" aria-hidden="true"><Sparkles size={16} /></i><span><b>Auto</b><small>Arc picks the model that suits the task</small></span><i className="arc-model-check" aria-hidden="true">{!activeMediaModel ? <Check size={14} /> : null}</i></button>
                        {mediaModelOptions.map((option) => <button type="button" className="arc-model-option" role="menuitemradio" aria-checked={activeMediaModel?.key === option.key} key={option.key} onClick={() => chooseMediaModel(mediaModelCategory, option.key)}><i className="arc-model-symbol" aria-hidden="true"><ImageIcon size={16} /></i><span><b>{option.label}</b><small>{option.provider}</small></span><i className="arc-model-check" aria-hidden="true">{activeMediaModel?.key === option.key ? <Check size={14} /> : null}</i></button>)}
                      </div>
                    </>
                  ) : null}

                  {composerMenu === "mode" ? (
                    <>
                      <div className="arc-model-menu-label">Capability{modePreference === "auto" ? <span>Automatic → {capabilityLabel}</span> : <span>Manual</span>}</div>
                      <div className="arc-model-options">
                        {CAPABILITY_OPTIONS.map((option) => <button type="button" className="arc-model-option" role="menuitemradio" aria-checked={modePreference === option.id} key={option.id} onClick={() => chooseModePreference(option.id)}><i className="arc-model-symbol" aria-hidden="true"><ArcCapabilityIcon mode={option.id} size={16} /></i><span><b>{option.label}</b><small>{option.description}</small></span><i className="arc-model-check" aria-hidden="true">{modePreference === option.id ? <Check size={14} /> : null}</i></button>)}
                      </div>
                    </>
                  ) : null}

                  {composerMenu === "mentions" ? (
                    <>
                      <div className="arc-composer-menu-head"><b>Context</b><small>Pin a workspace item to this turn</small></div>
                      {mentionItems.length > 0 ? mentionItems.map((mention) => <button type="button" role="menuitem" key={`${mention.type}-${mention.id}`} onClick={() => chooseMention(mention)}><AtSign size={16} /><span><b>{mention.label}</b><small>{mention.group}</small></span></button>) : <div className="arc-composer-menu-empty">No workspace items are available yet.</div>}
                    </>
                  ) : null}

                  {composerMenu === "commands" ? (
                    <>
                      <div className="arc-composer-menu-head"><b>Skills</b><small>{visibleSkills.length} available</small></div>
                      {visibleSkills.map((skill) => <button type="button" className="arc-composer-skill-option" data-source={skill.source} role="menuitem" key={skill.key} onClick={() => chooseSkill(skill)}><span className="arc-composer-skill-icon"><SkillIcon skill={skill} size={15} /></span><span><b>{skill.name}</b><small>{skill.description}</small><em>{skill.commands[0]}</em></span><ArrowRight size={13} /></button>)}
                      {visibleSkills.length === 0 ? <div className="arc-composer-menu-empty">No skills match /{skillQuery}</div> : null}
                    </>
                  ) : null}
                </motion.div>
              ) : null}
            </AnimatePresence>

            {selectedMentions.length > 0 || attachments.length > 0 || command || composerNotice ? (
              <div className="arc-composer-chips">
                {command ? <span className="arc-composer-chip is-skill">{selectedSkill ? <SkillIcon skill={selectedSkill} size={12} /> : <Slash size={12} />}<b>{selectedSkill?.name ?? command}</b><button type="button" onClick={() => { setCommand(null); setMode(inferComposerMode(draft, null, modePreference)); }} aria-label={`Remove ${selectedSkill?.name ?? command} skill`}><X size={11} /></button></span> : null}
                {selectedMentions.map((mention) => <span className="arc-composer-chip" key={`${mention.type}-${mention.id}`}><AtSign size={12} />{mention.label}<button type="button" onClick={() => setSelectedMentions((current) => current.filter((item) => !(item.type === mention.type && item.id === mention.id)))} aria-label={`Remove ${mention.label}`}><X size={11} /></button></span>)}
                {attachments.map((attachment) => <span className={`arc-composer-chip${attachment.contentType.startsWith("image/") ? " has-thumb" : ""}`} key={attachment.objectPath}>{attachment.contentType.startsWith("image/") ? <ChipThumb url={attachment.url} /> : <Paperclip size={12} />}{attachment.name}<button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.objectPath !== attachment.objectPath))} aria-label={`Remove ${attachment.name}`}><X size={11} /></button></span>)}
                {composerNotice ? <span className="arc-composer-notice">{composerNotice}</span> : null}
              </div>
            ) : null}

            {/* Named before the turn is sent, never blocking it. */}
            {selectedSkillRequirements.length > 0 ? (
              <SkillRequirementNote requirements={selectedSkillRequirements} compact />
            ) : null}

            <textarea ref={composerInputRef} aria-label="Message Arc" placeholder={selectedSkill?.key === "skill-authoring" ? "Describe the workflow you want Arc to learn…" : selectedSkill?.key === "skill-installation" ? "Paste a public GitHub repository or SKILL.md URL…" : selectedSkill ? `Add details for ${selectedSkill.name}…` : command ? "Add details for this skill…" : "Message Arc…"} value={draft} rows={2} disabled={isSending || demoPending || isSavingSkill} onChange={(event) => { const value = event.target.value; updateDraft(value); if (value.endsWith("@")) { composerMenuTriggerRef.current = null; setComposerMenu("mentions"); } else if (/^\s*\/[^\s]*$/.test(value)) { composerMenuTriggerRef.current = null; setComposerMenu("commands"); } }} onKeyDown={(event) => {
              if (event.key === "Escape") { closeComposerMenu(); return; }
              if (composerMenu && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                event.preventDefault();
                const items = Array.from(composerMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]') ?? []).filter((item) => !item.disabled);
                items[event.key === "ArrowDown" ? 0 : items.length - 1]?.focus();
                return;
              }
              // ↑ on an empty composer edits your last message — see
              // shouldEditLastOnArrowUp for why the empty gate is load-bearing.
              if (event.key === "ArrowUp") {
                const last = [...visibleMessages].reverse().find((message) => message.role === "operator");
                if (shouldEditLastOnArrowUp({
                  draft,
                  live,
                  busy: isSending || demoPending || awaitingReply,
                  menuOpen: Boolean(composerMenu),
                  hasOperatorMessage: Boolean(last),
                })) {
                  event.preventDefault();
                  setMessageNotice(null);
                  setEditSignal((current) => ({ id: last!.id, n: (current?.n ?? 0) + 1 }));
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey) {
                if (composerMenu === "commands" && unresolvedSkillToken && visibleSkills.length > 0) {
                  event.preventDefault();
                  chooseSkill(visibleSkills[0]!);
                  return;
                }
                event.preventDefault();
                submitDraft();
              }
            }} />
            <div className="arc-composer-toolbar">
              <div className="arc-composer-tools">
                <button type="button" className="arc-composer-add" aria-label="Add attachment, mention, or command" aria-haspopup="menu" aria-controls={composerMenu === "tools" ? "arc-composer-menu" : undefined} aria-expanded={composerMenu === "tools"} onClick={(event) => toggleComposerMenu("tools", event.currentTarget)}><Plus size={18} /></button>
                <button type="button" className="arc-composer-pill arc-mode-button" data-mode={mode === "ask" ? "ask" : "act"} aria-label={`Capability: ${capabilityLabel}. ${capabilityDetail}.`} aria-haspopup="menu" aria-controls={composerMenu === "mode" ? "arc-composer-menu" : undefined} aria-expanded={composerMenu === "mode"} disabled={Boolean(command)} title={command ? "This skill chooses the required capability" : "Choose whether Arc can change the workspace"} onClick={(event) => toggleComposerMenu("mode", event.currentTarget)}><ArcCapabilityIcon mode={mode} size={14} /><span>{capabilityLabel}</span><ChevronDown size={12} /></button>
                <button type="button" className="arc-composer-pill arc-model-button" data-auto={modelPreference === "auto" ? "true" : "false"} title={modelPreference === "auto" ? `Arc Auto is routing this request to ${resolvedModelName}` : `Model: ${currentModel.label}`} aria-label={`Model: ${currentModel.label}${modelPreference === "auto" ? `. Currently routes to Arc ${resolvedModelName}.` : ""}`} aria-haspopup="menu" aria-controls={composerMenu === "model" ? "arc-composer-menu" : undefined} aria-expanded={composerMenu === "model"} onClick={(event) => toggleComposerMenu("model", event.currentTarget)}><ArcModelIcon model={modelPreference} size={14} /><span>{currentModel.label}{modelPreference === "auto" ? <small> · {resolvedModelName}</small> : null}</span><ChevronDown size={12} /></button>
                {/* Media model — a SEPARATE control from the reasoning pill above.
                    One list holding both would imply Arc's brain and the image
                    engine it calls are interchangeable choices. Hidden entirely
                    when no engine is reachable, rather than offering models that
                    would fail on use. */}
                {mediaModelOptions.length > 0 ? (
                  <button type="button" className="arc-composer-pill arc-media-button" data-auto={activeMediaModel ? "false" : "true"} title={activeMediaModel ? `Media model: ${activeMediaModel.label} (${activeMediaModel.provider})` : "Media model: Auto — Arc picks per task"} aria-label={activeMediaModel ? `Media model: ${activeMediaModel.label}` : "Media model: Auto"} aria-haspopup="menu" aria-controls={composerMenu === "media" ? "arc-composer-menu" : undefined} aria-expanded={composerMenu === "media"} onClick={(event) => toggleComposerMenu("media", event.currentTarget)}><ImageIcon size={14} /><span>{activeMediaModel ? activeMediaModel.label : "Auto media"}</span><ChevronDown size={12} /></button>
                ) : null}
                {showContextMeter ? <div className="arc-context-control">
                  <button type="button" className="arc-context-meter" data-level={contextState.level} style={{ "--arc-ctx-pct": String(contextState.pct) } as React.CSSProperties} aria-label={`Context window: ${contextState.pct}% used. Full workspace memory is always on.`} aria-expanded={contextInfoOpen} aria-controls="arc-context-info" onClick={() => { setComposerMenu(null); setContextInfoOpen((current) => !current); }} onKeyDown={(event) => { if (event.key === "Escape") setContextInfoOpen(false); }}>
                    <span className="arc-context-ring" aria-hidden="true" />
                  </button>
                  <AnimatePresence>
                    {contextInfoOpen ? (
                      <motion.div id="arc-context-info" className="arc-context-popover" role="status" initial={{ opacity: 0, y: 5, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.99 }} transition={{ duration: 0.14 }}>
                        <b>Context</b>
                        <span>{contextState.pct}% used</span>
                        <p>Arc remembers your full workspace automatically.</p>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div> : null}
              </div>
              <div className="arc-composer-send"><button type="button" className="arc-send-button" onClick={submitDraft} disabled={!draft.trim() || unresolvedSkillToken || unresolvedMentionToken || isSending || demoPending || uploading || isSavingSkill} aria-label="Send message">{isSending || demoPending || uploading || isSavingSkill ? <LoaderCircle size={18} className="is-spinning" /> : <ArrowUp size={18} />}</button></div>
            </div>
          </div>
        </div>
      </footer>

      {/* Both panels now cover the content pane rather than docking beside it, so
          they still swap in one presence scope — mode="wait" keeps the outgoing
          one from cross-fading its text under the incoming one. */}
      <AnimatePresence mode="wait">
        {reviewCards && reviewCards.length > 0
          ? <DeliverableReview key="asset-review" cards={reviewCards} statuses={assetStatuses} bodies={assetBodies} checks={assetChecks} paneBox={panelPaneBox} returnLabel={workPanelOpen ? "Workspace" : undefined} onStatus={recordAssetStatus} onClose={() => setReviewCards(null)} />
          : workPanelOpen
            ? <ArcWorkPanel key="work-panel" message={latestArcMessage} messages={live ? renderedMessages : undefined} cards={workCards} statuses={assetStatuses} demoSeed={demoSeed} demoPending={demoPending} demoRequest={latestDemoRequest} demoOutcome={latestDemoArcTurn ? latestDemoArcTurn.outcome ?? "complete" : undefined} paneBox={panelPaneBox} docked={workPanelDocked} onReview={openReview} onRecover={recoverRun} onClose={() => setWorkPanelVisibility(false)} />
            : null}
      </AnimatePresence>
      <AnimatePresence>
        {/* Scrim AND drawer portal together, never one without the other. The
            drawer claims `aria-modal` and traps Tab across the whole document,
            so its scrim has to block the pointer across the whole shell to
            match — and a portaled scrim left behind a pane-scoped drawer would
            paint over the drawer it belongs to, since .page-enter's transform
            makes the page a single stacking context. See overlay-portal.tsx. */}
        {historyOpen ? <Fragment key="arc-workspace"><OverlayPortal><motion.button type="button" className="arc-drawer-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={dismissHistory} aria-label="Close Arc workspace" /><ThreadDrawer live={live} onUseSkill={applyDrawerSkill} onUseSaved={useSavedItem} installedSkills={installedSkills} installedSkillKeys={installedSkillKeys} installingSkillKey={installingSkillKey} onSetSkillInstalled={setLibrarySkillInstalled} workspaceSkills={workspaceSkills} onWorkspaceSkillsChange={setWorkspaceSkills} generatedSkills={generatedSkills} onGeneratedSkillsChange={setGeneratedSkills} workspaceName={workspaceName} connectorsConfigured={connectorsConfigured} connectors={connectors} emailConnection={emailConnection} liveSendEnabled={liveSendEnabled} onClose={() => setHistoryOpen(false)} onDismiss={dismissHistory} paneBox={drawerPaneBox} /></OverlayPortal></Fragment> : null}
        {shareOpen ? <ShareDialog key="share-dialog" conversationId={visibleConversationId} onClose={() => setShareOpen(false)} /> : null}
      </AnimatePresence>
    </div>
  );
}
