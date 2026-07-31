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
  Archive,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  AtSign,
  Bookmark,
  Binoculars,
  Blocks,
  Check,
  ChevronRight,
  ChevronDown,
  Circle,
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
  MailCheck,
  MapPinned,
  Megaphone,
  MessageSquareText,
  MessagesSquare,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  PencilLine,
  Pin,
  Plus,
  Radar,
  Repeat2,
  RotateCcw,
  Search,
  Share2,
  ShieldCheck,
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
  type ArcActionCard,
  type ArcAssetStatus,
  type ArcMention,
  type ArcMode,
  type ArcRoute,
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
  readWorkPanelPreference,
  workPanelOpenOnConversationChange,
  writeWorkPanelPreference,
} from "@/lib/arc-chat/work-panel-preference";
import type { ConnectionView } from "@/lib/connections/read-model";
import type { ConnectorView } from "@/lib/connectors/read-model";
import type {
  ArcAttachment,
  ArcMessage,
  ArcStep,
} from "@/lib/arc-chat/persistence";
import type { MentionGroup } from "@/lib/arc-chat/mention-search";
import type { ArcThreadGroupVM } from "@/lib/arc-chat/read-model";
import { filterThreadGroups, type ArcThreadFilter } from "@/lib/arc-chat/thread-filter";
import {
  resolveArcComposerMode,
  type ArcComposerModePreference,
} from "@/lib/arc-chat/composer-mode";
import { resolveArcModelRoute, type ArcModelPreference } from "@/lib/arc-chat/model-routing";
import { buildArcRunContract } from "@/lib/arc-chat/run-contract";
import { buildArcRunProfile } from "@/lib/arc-chat/run-profile";
import {
  getArcConversationHeader,
  getArcConversationScrollTarget,
  shouldShowDemoLauncher,
  shouldUseDemoSeedWorkspace,
} from "@/lib/arc-chat/view-state";

import {
  archiveArcConversationAction,
  assignArcConversationCampaignAction,
  cancelArcRunAction,
  deleteArcConversationAction,
  editAndResendArcMessageAction,
  getArcAssetStatusesAction,
  pinArcConversationAction,
  regenerateArcReplyAction,
  renameArcConversationAction,
  installArcGithubSkillAction,
  generateExemplarSkillAction,
  removeGeneratedSkillAction,
  listArchivedArcConversationsAction,
  listSavedArcItemsAction,
  previewArcGithubSkillAction,
  removeArcGithubSkillAction,
  removeSavedArcItemAction,
  sendArcMessageAction,
  setArcSkillInstalledAction,
  unarchiveArcConversationAction,
  uploadArcAttachmentAction,
  type ArchivedArcConversationVM,
  type SavedArcItemVM,
} from "../actions";
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
  ThreadItem,
} from "./arc-view.types";
import { DEMO_PACKAGE_CARDS, DEMO_THREADS, DEMO_WAITING } from "./arc-demo-data";
import { ArcWorkPanel, AssetReviewPanel, ChipThumb, QuestionPrompt } from "./arc-messages";
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

function ThreadRow({ thread, active, live, campaignName, showCampaignLabel, campaigns, onOpen, onRename, onPin, onAssignCampaign, onArchive, onDelete }: {
  thread: ThreadItem;
  active: boolean;
  live: boolean;
  campaignName: string | null;
  showCampaignLabel: boolean;
  campaigns: ArcMention[];
  onOpen: () => void;
  onRename: (title: string) => void;
  onPin: (pinned: boolean) => void;
  onAssignCampaign: (campaignId: string | null) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(thread.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [campaignPicker, setCampaignPicker] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest(`[data-thread="${thread.id}"]`)) {
        setMenuOpen(false);
        setConfirmDelete(false);
        setCampaignPicker(false);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [menuOpen, thread.id]);

  const commitRename = () => {
    const next = name.trim();
    setRenaming(false);
    if (next && next !== thread.title) onRename(next);
    else setName(thread.title);
  };

  const openThreadMenu = () => {
    setConfirmDelete(false);
    setCampaignPicker(false);
    setMenuOpen(true);
  };

  const handleThreadContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest(".arc-history-menu")) return;
    event.preventDefault();
    event.stopPropagation();
    openThreadMenu();
  };

  const handleThreadMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (campaignPicker) setCampaignPicker(false);
      else setMenuOpen(false);
      return;
    }
    if (event.key === "Enter" && document.activeElement instanceof HTMLButtonElement) {
      event.preventDefault();
      document.activeElement.click();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"], button[role="menuitemradio"]')).filter((item) => !item.disabled);
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1 + items.length) % items.length : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  if (renaming) {
    return (
      <div className="arc-history-item is-renaming" data-thread={thread.id}>
        <input
          autoFocus
          value={name}
          aria-label="Rename conversation"
          onChange={(event) => setName(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); commitRename(); }
            if (event.key === "Escape") { setName(thread.title); setRenaming(false); }
          }}
        />
      </div>
    );
  }

  const visibleCampaignName = showCampaignLabel ? campaignName : null;
  const threadPreview = thread.preview || visibleCampaignName || (thread.pinned ? "Pinned" : "Conversation");
  const label = (
    <span>
      <b>{thread.title}</b>
      {thread.running
        ? <small className="arc-thread-working"><span className="arc-thread-dots" aria-hidden="true"><i /><i /><i /></span>Working…{visibleCampaignName ? <em><Megaphone size={9} />{visibleCampaignName}</em> : null}</small>
        : <small className="arc-thread-preview" data-campaign={visibleCampaignName ? "true" : "false"}>{visibleCampaignName ? <Megaphone size={9} /> : null}<span>{threadPreview}</span><em>{thread.when}</em></small>}
    </span>
  );

  return (
    <div className={`arc-history-item${active ? " is-active" : ""}`} data-thread={thread.id} onContextMenu={handleThreadContextMenu}>
      {live
        ? <Link href={`/arc?c=${thread.id}`} className="arc-history-open" onClick={onOpen}>{label}</Link>
        : <button type="button" className="arc-history-open" onClick={onOpen}>{label}</button>}
      {thread.pinned ? <Pin size={12} className="arc-history-pin" aria-label="Pinned" /> : null}
      <button type="button" className="arc-history-menu-btn" aria-label="Conversation options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (menuOpen) setMenuOpen(false); else openThreadMenu(); }}>
        <MoreHorizontal size={15} />
      </button>
      {menuOpen ? (
        <div className="arc-history-menu" role="menu" onKeyDown={handleThreadMenuKeyDown}>
          {campaignPicker ? (
            <div className="arc-history-campaign-picker">
              <div><button type="button" onClick={() => setCampaignPicker(false)} aria-label="Back to conversation options"><ArrowLeft size={13} /></button><span><b>Campaign</b><small>{campaignName || "Not linked"}</small></span></div>
              <button type="button" role="menuitemradio" aria-checked={!thread.campaignId} onClick={() => { setMenuOpen(false); setCampaignPicker(false); onAssignCampaign(null); }}><span>No campaign</span>{!thread.campaignId ? <Check size={13} /> : null}</button>
              {campaigns.map((campaign) => <button type="button" role="menuitemradio" aria-checked={thread.campaignId === campaign.id} key={campaign.id} onClick={() => { setMenuOpen(false); setCampaignPicker(false); onAssignCampaign(campaign.id); }}><span>{campaign.label}</span>{thread.campaignId === campaign.id ? <Check size={13} /> : null}</button>)}
            </div>
          ) : confirmDelete ? (
            <div className="arc-history-menu-confirm">
              <span>Delete this conversation?</span>
              <div>
                <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
                <button type="button" className="is-danger" onClick={() => { setMenuOpen(false); onDelete(); }}>Delete</button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onPin(!thread.pinned); }}><Pin size={14} />{thread.pinned ? "Unpin" : "Pin"}</button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setName(thread.title); setRenaming(true); }}><PencilLine size={14} />Rename</button>
              <button type="button" role="menuitem" className="has-detail" onClick={() => setCampaignPicker(true)}><Megaphone size={14} /><span><b>{campaignName ? "Change campaign" : "Assign campaign"}</b><small>{campaignName || "Keep this chat with its campaign"}</small></span><ChevronRight size={13} /></button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onArchive(); }}><Archive size={14} />Archive</button>
              <button type="button" role="menuitem" className="is-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} />Delete</button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

type DrawerConnectorStatus = ConnectorView["status"] | ConnectionView["status"];

type DrawerConnectorItem = {
  key: string;
  label: string;
  description: string;
  status: DrawerConnectorStatus;
  statusLabel: string;
  kindLabel: string;
  accessLabel: string;
  mark: string;
  color: string;
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

function connectorStatusLabel(status: DrawerConnectorStatus): string {
  if (status === "connected") return "Connected";
  if (status === "disabled") return "Paused";
  if (status === "error") return "Needs attention";
  if (status === "unavailable") return "Planned";
  return "Not connected";
}

function ThreadDrawer({
  live,
  groups,
  activeConversationId,
  selectedDemoId,
  needsReviewCount,
  onSelectDemo,
  onStartNew,
  onOpenReview,
  onUseSkill,
  installedSkills,
  installedSkillKeys,
  installingSkillKey,
  onSetSkillInstalled,
  workspaceSkills,
  onWorkspaceSkillsChange,
  generatedSkills,
  onGeneratedSkillsChange,
  workspaceName,
  campaignItems,
  connectorsConfigured,
  connectors,
  emailConnection,
  liveSendEnabled,
  onClose,
}: {
  live: boolean;
  groups: ArcThreadGroupVM[];
  activeConversationId: string | null;
  selectedDemoId: string;
  needsReviewCount: number;
  onSelectDemo: (id: string) => void;
  onStartNew: () => void;
  onOpenReview: () => void;
  onUseSkill: (skill: ArcSkillDefinition) => void;
  installedSkills: ArcSkillDefinition[];
  installedSkillKeys: string[];
  installingSkillKey: string | null;
  onSetSkillInstalled: (skill: ArcSkillDefinition, installed: boolean) => void;
  workspaceSkills: WorkspaceArcSkill[];
  onWorkspaceSkillsChange: (skills: WorkspaceArcSkill[]) => void;
  generatedSkills: GeneratedSkillRecord[];
  onGeneratedSkillsChange: (skills: GeneratedSkillRecord[]) => void;
  workspaceName: string;
  campaignItems: ArcMention[];
  connectorsConfigured: boolean;
  connectors: ConnectorView[];
  emailConnection: ConnectionView | null;
  liveSendEnabled: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [view, setView] = useState<"conversations" | "skills" | "connectors" | "saved">("conversations");
  // Saved items are loaded lazily the first time the Saved tab opens.
  const [savedItems, setSavedItems] = useState<SavedArcItemVM[] | null>(null);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  // Archived conversations: a lazy-loaded disclosure at the bottom of the list.
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archivedConvos, setArchivedConvos] = useState<ArchivedArcConversationVM[] | null>(null);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [skillsMode, setSkillsMode] = useState<"installed" | "library">("installed");
  const [skillSearch, setSkillSearch] = useState("");
  /** Search over the skills you already have — distinct from `skillSearch`,
   *  which searches the not-yet-installed library. */
  const [installedSearch, setInstalledSearch] = useState("");
  /** Authoring and installing are the rare case: collapsed by default. */
  const [manageOpen, setManageOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ArcThreadFilter>("all");
  const [threadGrouping, setThreadGrouping] = useState<"recent" | "campaign">("recent");
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [githubPreview, setGithubPreview] = useState<WorkspaceArcSkill | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<{ tone: "ok" | "info"; text: string } | null>(null);
  const [githubStatus, setGithubStatus] = useState<string | null>(null);
  const [githubBusy, setGithubBusy] = useState(false);
  const [demoGroups, setDemoGroups] = useState<ArcThreadGroupVM[]>(DEMO_THREADS);

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
  const removeSaved = (id: string) => {
    const prev = savedItems;
    setSavedItems((cur) => (cur ? cur.filter((s) => s.id !== id) : cur));
    removeSavedArcItemAction(id).then((res) => {
      if (!res.ok) { setSavedItems(prev); setSavedError(res.error); }
    });
  };

  const toggleArchived = () => {
    const next = !archivedOpen;
    setArchivedOpen(next);
    if (next && archivedConvos === null) {
      setArchivedError(null);
      listArchivedArcConversationsAction().then((res) => {
        if (res.ok) setArchivedConvos(res.items);
        else { setArchivedConvos([]); setArchivedError(res.error); }
      });
    }
  };
  const restoreConvo = (id: string) => {
    const prev = archivedConvos;
    setArchivedConvos((cur) => (cur ? cur.filter((c) => c.id !== id) : cur));
    unarchiveArcConversationAction(id).then((res) => {
      if (res.ok) { if (live) router.refresh(); }
      else { setArchivedConvos(prev); setArchivedError(res.error); }
    });
  };

  const sourceGroups = live ? groups : demoGroups;
  const availableCampaigns: ArcMention[] = campaignItems.length > 0 ? campaignItems : [
    { type: "campaign", id: "demo-camp", label: "Pricing-Intent Fast Track", href: "/campaigns" },
    { type: "campaign", id: "past-customer", label: "Past Customer Re-engagement", href: "/campaigns" },
    { type: "campaign", id: "property-partners", label: "Property Partner Growth", href: "/campaigns" },
  ];
  const campaignNames = new Map<string, string>([
    ["demo-camp", "Pricing-Intent Fast Track"],
    ["past-customer", "Past Customer Re-engagement"],
    ["property-partners", "Property Partner Growth"],
    ...availableCampaigns.map((campaign) => [campaign.id, campaign.label] as [string, string]),
  ]);
  const campaignGroups = (() => {
    const byCampaign = new Map<string, ArcThreadGroupVM["items"]>();
    for (const thread of sourceGroups.flatMap((group) => group.items)) {
      const key = thread.campaignId || "__none__";
      const items = byCampaign.get(key);
      if (items) items.push(thread);
      else byCampaign.set(key, [thread]);
    }
    return [...byCampaign.entries()]
      .sort(([left], [right]) => {
        if (left === "__none__") return 1;
        if (right === "__none__") return -1;
        return (campaignNames.get(left) ?? left).localeCompare(campaignNames.get(right) ?? right);
      })
      .map(([campaignId, items]) => ({ group: campaignId === "__none__" ? "No campaign" : campaignNames.get(campaignId) ?? "Campaign", items }));
  })();
  const visibleGroups = filterThreadGroups(threadGrouping === "campaign" ? campaignGroups : sourceGroups, query, filter);
  const allThreads = sourceGroups.flatMap((group) => group.items);
  const runningCount = allThreads.filter((thread) => thread.running).length;
  const pinnedCount = allThreads.filter((thread) => thread.pinned).length;
  const connectorItems: DrawerConnectorItem[] = [
    ...(emailConnection ? [{
      key: "resend",
      label: "Resend",
      description: "Approved campaign and transactional email delivery.",
      status: emailConnection.status === "connected" && !liveSendEnabled ? "disabled" as const : emailConnection.status,
      statusLabel: emailConnection.status === "connected" && !liveSendEnabled ? "Not armed" : connectorStatusLabel(emailConnection.status),
      kindLabel: "Channel",
      accessLabel: "gated write",
      ...CONNECTOR_PRESENTATION.resend!,
    }] : []),
    ...connectors.map((connector) => ({
      key: connector.key,
      label: connector.label,
      description: connector.description.replace(/^PLANNED —\s*/i, ""),
      status: connector.status,
      statusLabel: connectorStatusLabel(connector.status),
      kindLabel: CONNECTOR_KIND_LABEL[connector.kind],
      accessLabel: connector.access === "read_only" ? "read-only" : "gated write",
      ...(CONNECTOR_PRESENTATION[connector.key] ?? { mark: connector.label.slice(0, 2), color: "#9aa0ac" }),
    })),
  ].sort((a, b) => {
    const rank: Record<DrawerConnectorStatus, number> = { connected: 0, error: 1, disabled: 2, not_configured: 3, unavailable: 4 };
    return rank[a.status] - rank[b.status] || a.label.localeCompare(b.label);
  });
  const connectedCount = connectorItems.filter((connector) => connector.status === "connected").length;
  const visibleLibrarySkills = ARC_SKILL_LIBRARY.filter((skill) => {
    const needle = skillSearch.trim().toLocaleLowerCase();
    return !needle || `${skill.name} ${skill.description} ${skill.commands.join(" ")} ${skill.publisher ?? ""}`.toLocaleLowerCase().includes(needle);
  });

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

  // Demo mutations are local; live mutations hit the real actions then refresh.
  const applyDemo = (id: string, transform: (item: ThreadItem) => ThreadItem | null) => {
    setDemoGroups((prev) => prev
      .map((group) => ({ ...group, items: group.items.flatMap((item) => {
        if (item.id !== id) return [item];
        const next = transform(item as ThreadItem);
        return next ? [next as (typeof group.items)[number]] : [];
      }) }))
      .filter((group) => group.items.length > 0));
  };

  const doRename = (id: string, title: string) => {
    if (!live) return applyDemo(id, (item) => ({ ...item, title }));
    renameArcConversationAction({ conversationId: id, title }).then((result) => { if (result.ok) router.refresh(); });
  };
  const doPin = (id: string, pinned: boolean) => {
    if (!live) return applyDemo(id, (item) => ({ ...item, pinned }));
    pinArcConversationAction({ conversationId: id, pinned }).then((result) => { if (result.ok) router.refresh(); });
  };
  const doAssignCampaign = (id: string, campaignId: string | null) => {
    if (!live) return applyDemo(id, (item) => ({ ...item, campaignId }));
    assignArcConversationCampaignAction({ conversationId: id, campaignId }).then((result) => { if (result.ok) router.refresh(); });
  };
  const doArchive = (id: string) => {
    if (!live) return applyDemo(id, () => null);
    archiveArcConversationAction(id).then((result) => { if (result.ok) router.refresh(); });
  };
  const doDelete = (id: string) => {
    if (!live) return applyDemo(id, () => null);
    deleteArcConversationAction(id).then((result) => {
      if (!result.ok) return;
      if (id === activeConversationId) router.push("/arc?new=1");
      else router.refresh();
    });
  };

  return (
    <motion.aside className="arc-history" initial={{ x: -24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -24, opacity: 0 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }} aria-label="Arc workspace">
      <div className="arc-history-topline"><span className="arc-history-eyebrow">Your Arc workspace</span><button type="button" className="arc-icon-button" onClick={onClose} aria-label="Close Arc workspace" autoFocus><X size={17} /></button></div>
      <nav className="arc-drawer-nav" aria-label="Arc workspace sections">
        <button type="button" className={view === "conversations" ? "is-active" : ""} aria-current={view === "conversations" ? "page" : undefined} onClick={() => setView("conversations")}><MessageSquareText size={14} /><span>Conversations</span></button>
        <button type="button" className={view === "skills" ? "is-active" : ""} aria-current={view === "skills" ? "page" : undefined} onClick={() => { setView("skills"); setSkillsMode("installed"); }}><Blocks size={14} /><span>Skills</span></button>
        <button type="button" className={view === "connectors" ? "is-active" : ""} aria-current={view === "connectors" ? "page" : undefined} onClick={() => setView("connectors")}><Link2 size={14} /><span>Connectors</span></button>
        <button type="button" className={view === "saved" ? "is-active" : ""} aria-current={view === "saved" ? "page" : undefined} onClick={openSaved}><Bookmark size={14} /><span>Saved</span></button>
      </nav>

      {view === "conversations" ? <section className="arc-drawer-view" aria-labelledby="arc-conversations-title">
        <header className="arc-drawer-view-head"><h2 id="arc-conversations-title">Conversations</h2><p>Return to active work, reviews, and saved context.</p></header>
        {live ? <Link href="/arc?new=1" className="arc-new-chat" prefetch={false} scroll={false} onClick={onStartNew}><Plus size={16} /> New conversation</Link> : <button type="button" className="arc-new-chat" onClick={() => onSelectDemo("new")}><Plus size={16} /> New conversation</button>}
        <label className="arc-history-search"><Search size={15} /><input type="search" aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="arc-history-filters" role="group" aria-label="Filter conversations">
          {([
            ["all", "All", allThreads.length],
            ["running", "Working", runningCount],
            ["pinned", "Pinned", pinnedCount],
          ] as const).map(([id, label, count]) => <button type="button" key={id} className={filter === id ? "is-active" : ""} aria-pressed={filter === id} onClick={() => setFilter(id)}><span>{label}</span>{count > 0 ? <small>{count}</small> : null}</button>)}
        </div>
        <div className="arc-thread-grouping" role="group" aria-label="Organize conversations">
          <button type="button" className={threadGrouping === "recent" ? "is-active" : ""} aria-pressed={threadGrouping === "recent"} onClick={() => setThreadGrouping("recent")}>Recent</button>
          <button type="button" className={threadGrouping === "campaign" ? "is-active" : ""} aria-pressed={threadGrouping === "campaign"} onClick={() => setThreadGrouping("campaign")}><Megaphone size={12} /> Campaigns</button>
        </div>
        {needsReviewCount > 0 || runningCount > 0 ? <div className="arc-history-attention">
          {needsReviewCount > 0 ? <button type="button" onClick={onOpenReview}><span><ClipboardCheck size={15} /><b>{needsReviewCount} need review</b></span><ArrowRight size={14} /></button> : null}
          {runningCount > 0 ? <span><LoaderCircle size={14} className="is-spinning" />{runningCount} active {runningCount === 1 ? "run" : "runs"}</span> : null}
        </div> : null}
        <div className="arc-history-list" onKeyDown={handleRovingListKeyDown}>
          {visibleGroups.map((group) => (
            <div className="arc-history-group" key={group.group}>
              <h3 data-kind={threadGrouping === "campaign" ? "campaign" : "date"} data-unassigned={group.group === "No campaign" ? "true" : undefined}>
                {threadGrouping === "campaign" ? <span className="arc-campaign-group-icon" aria-hidden="true">{group.group === "No campaign" ? <Circle size={8} /> : <Megaphone size={10} />}</span> : null}
                <span>{group.group}</span>
              </h3>
              {group.items.map((thread) => {
                const active = live ? thread.id === activeConversationId : thread.id === selectedDemoId;
                return (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    active={active}
                    live={live}
                    campaignName={thread.campaignId ? campaignNames.get(thread.campaignId) ?? "Campaign" : null}
                    showCampaignLabel={threadGrouping === "recent"}
                    campaigns={availableCampaigns}
                    onOpen={live ? onClose : () => onSelectDemo(thread.id)}
                    onRename={(title) => doRename(thread.id, title)}
                    onPin={(pinned) => doPin(thread.id, pinned)}
                    onAssignCampaign={(campaignId) => doAssignCampaign(thread.id, campaignId)}
                    onArchive={() => doArchive(thread.id)}
                    onDelete={() => doDelete(thread.id)}
                  />
                );
              })}
            </div>
          ))}
          {visibleGroups.length === 0 ? <div className="arc-history-empty"><Search size={17} /><b>No conversations found</b><span>Try a different title or date.</span></div> : null}
        </div>
        <div className="arc-archived">
          <button type="button" className={`arc-archived-toggle${archivedOpen ? " is-open" : ""}`} onClick={toggleArchived} aria-expanded={archivedOpen}>
            <Archive size={13} />
            <span>Archived{archivedConvos && archivedConvos.length > 0 ? ` · ${archivedConvos.length}` : ""}</span>
            <ChevronDown size={14} className="arc-archived-chevron" />
          </button>
          {archivedOpen ? (
            archivedError ? <p className="arc-archived-error" role="alert">{archivedError}</p>
            : archivedConvos === null ? <div className="arc-archived-empty"><LoaderCircle size={14} className="is-spinning" /> Loading…</div>
            : archivedConvos.length === 0 ? <div className="arc-archived-empty">No archived conversations.</div>
            : <div className="arc-archived-list">
                {archivedConvos.map((conversation) => (
                  <div className="arc-archived-item" key={conversation.id}>
                    <span className="arc-archived-title" title={conversation.title}>{conversation.title}</span>
                    {conversation.when ? <span className="arc-archived-when">{conversation.when}</span> : null}
                    <button type="button" className="arc-archived-restore" onClick={() => restoreConvo(conversation.id)} title="Restore to active conversations">
                      <RotateCcw size={12} /> Restore
                    </button>
                  </div>
                ))}
              </div>
          ) : null}
        </div>
      </section> : null}

      {view === "skills" && skillsMode === "installed" ? <section className="arc-drawer-view arc-drawer-skills" aria-labelledby="arc-skills-title">
        <header className="arc-drawer-view-head"><div className="arc-drawer-title-row"><h2 id="arc-skills-title">Skills</h2><span>{installedSkills.length + generatedSkills.length} installed</span></div><p>Reusable workflows you can call with <code>/</code> in any conversation.</p></header>
        <label className="arc-skill-search"><Search size={14} /><input type="search" aria-label="Search your skills" placeholder="Search your skills" value={installedSearch} onChange={(event) => setInstalledSearch(event.target.value)} /></label>
        {voiceStatus ? <p className="arc-voice-status" data-tone={voiceStatus.tone}>{voiceStatus.tone === "ok" ? <Check size={13} /> : <Info size={13} />}{voiceStatus.text}</p> : null}
        <div className="arc-skills-section-head"><span>Your skills</span><small>{installedEntries.length} of {installedSkills.length + generatedSkills.length}</small></div>
        <div className="arc-skills-list" onKeyDown={handleRovingListKeyDown}>
          {installedEntries.map(({ skill, detail, generated }) => {
            const removable = Boolean(generated) || skill.source === "github" || skill.source === "library";
            return (
              <div className="arc-skill-item" key={skill.key}>
                <button type="button" className="arc-skill-row" onClick={() => onUseSkill(skill)}>
                  <span className="arc-skill-icon"><SkillIcon skill={skill} /></span>
                  <span>
                    <span className="arc-skill-row-title">
                      <b>{skill.name}</b>
                      <span className="arc-skill-source" data-source={skill.source}>{SKILL_SOURCE_LABEL[skill.source]}</span>
                    </span>
                    <small>{detail}</small>
                    {/* Every command the skill answers to. Showing only the first
                        hid the aliases that make it findable from the composer. */}
                    <span className="arc-skill-commands">{skill.commands.map((command) => <em key={command}>{command}</em>)}</span>
                  </span>
                </button>
                {removable ? <button type="button" className="arc-skill-remove" aria-label={`Remove ${skill.name}`} disabled={voiceBusy || githubBusy || installingSkillKey === skill.key} onClick={() => removeInstalledSkill(skill, generated)}><X size={13} /></button> : <span />}
              </div>
            );
          })}
          {installedEntries.length === 0 ? <div className="arc-skill-empty"><Search size={17} /><b>No skills match</b><span>Try another workflow name or command.</span></div> : null}
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

      {view === "skills" && skillsMode === "library" ? <section className="arc-drawer-view arc-drawer-skills arc-skill-library" aria-labelledby="arc-skill-library-title">
        <header className="arc-drawer-view-head arc-skill-library-head"><button type="button" onClick={() => setSkillsMode("installed")}><ArrowLeft size={14} /> Skills</button><div className="arc-drawer-title-row"><h2 id="arc-skill-library-title">Skill library</h2><span>Workspace</span></div><p>Install reviewed workflows from Arc or a public GitHub repository.</p></header>
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
        <label className="arc-skill-search"><Search size={14} /><input type="search" aria-label="Search online skills" placeholder="Search skills" value={skillSearch} onChange={(event) => setSkillSearch(event.target.value)} /></label>
        <div className="arc-skills-section-head"><span>Discover</span><small>{visibleLibrarySkills.length} skills</small></div>
        <div className="arc-skills-list arc-library-list" onKeyDown={handleRovingListKeyDown}>
          {visibleLibrarySkills.map((skill) => {
            const installed = installedSkillKeys.includes(skill.key);
            const saving = installingSkillKey === skill.key;
            return <article className="arc-library-skill" data-installed={installed ? "true" : "false"} key={skill.key}>
              <span className="arc-skill-icon"><SkillIcon skill={skill} /></span>
              <div><span><b>{skill.name}</b></span><small>{skill.description}</small><span className="arc-skill-commands">{skill.commands.map((command) => <em key={command}>{command}</em>)}</span><p>{skill.publisher} · Reviewed by Arc</p></div>
              <button type="button" disabled={saving} onClick={() => onSetSkillInstalled(skill, !installed)}>{saving ? <LoaderCircle size={13} className="is-spinning" /> : installed ? <Check size={13} /> : <Download size={13} />}{saving ? "Saving" : installed ? "Installed" : "Install"}</button>
            </article>;
          })}
          {visibleLibrarySkills.length === 0 ? <div className="arc-connector-empty"><Search size={17} /><b>No skills found</b><span>Try a different workflow or command.</span></div> : null}
        </div>
        <p className="arc-drawer-footnote"><ShieldCheck size={13} /> GitHub skills are treated as untrusted text and cannot expand Arc&apos;s read-only tool boundary.</p>
      </section> : null}

      {view === "connectors" ? <section className="arc-drawer-view arc-drawer-connectors" aria-labelledby="arc-connectors-title">
        <header className="arc-drawer-view-head"><div className="arc-drawer-title-row"><h2 id="arc-connectors-title">Connectors</h2><span className="is-connector-count">{connectedCount} connected</span></div><p>Arc&apos;s plugins, with the live status for this workspace.</p></header>
        {!connectorsConfigured ? <div className="arc-connector-notice"><ShieldCheck size={14} /><span><b>Catalog preview</b><small>Connect a workspace to store credentials and live status.</small></span></div> : null}
        <div className="arc-connectors-section-head"><span>{connectorItems.length} workspace connectors</span><Link href="/settings?s=connections">Manage all <ArrowRight size={12} /></Link></div>
        <div className="arc-connector-list">
          {connectorItems.map((connector) => (
            <Link href={`/settings?s=connections&c=${encodeURIComponent(connector.key)}`} className="arc-connector-row" data-status={connector.status} key={connector.key}>
              <span className="arc-connector-logo" style={{ "--connector-color": connector.color } as React.CSSProperties}>{connector.mark}</span>
              <span className="arc-connector-copy"><span><b>{connector.label}</b><em>{connector.statusLabel}</em></span><small>{connector.kindLabel} · {connector.accessLabel}</small><p>{connector.description}</p></span>
              <ChevronRight size={14} />
            </Link>
          ))}
          {connectorItems.length === 0 ? <div className="arc-connector-empty"><Link2 size={17} /><b>No connectors found</b><span>Open Settings to refresh the workspace catalog.</span></div> : null}
        </div>
        <p className="arc-drawer-footnote"><ShieldCheck size={13} /> Connections are workspace-scoped and controlled in Settings.</p>
      </section> : null}

      {view === "saved" ? <section className="arc-drawer-view arc-drawer-saved" aria-labelledby="arc-saved-title">
        <header className="arc-drawer-view-head"><h2 id="arc-saved-title">Saved</h2><p>Responses and drafts you saved from Arc — kept for reuse.</p></header>
        {savedError ? <p className="arc-saved-error" role="alert">{savedError}</p> : null}
        {savedLoading ? (
          <div className="arc-saved-empty"><LoaderCircle size={16} className="is-spinning" /> Loading your saved items…</div>
        ) : savedItems && savedItems.length > 0 ? (
          <div className="arc-saved-list">
            {savedItems.map((item) => (
              <div className="arc-saved-item" key={item.id}>
                <div className="arc-saved-main">
                  <span className={`arc-saved-kind is-${item.kind}`}>{item.kind === "draft" ? "Draft" : item.kind === "media" ? "Media" : "Angle"}</span>
                  <b className="arc-saved-title">{item.title}</b>
                  {item.preview ? <p className="arc-saved-preview">{item.preview}</p> : null}
                  {item.conversationHref ? <Link href={item.conversationHref} className="arc-saved-open" onClick={onClose}>Open source chat <ArrowRight size={12} /></Link> : null}
                </div>
                <button type="button" className="arc-saved-remove" onClick={() => removeSaved(item.id)} aria-label={`Remove saved item: ${item.title}`} title="Remove"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        ) : (
          <div className="arc-saved-empty">
            <Bookmark size={18} />
            <div><b>Nothing saved yet.</b><span>Use the bookmark on any Arc response to keep it here for reuse.</span></div>
          </div>
        )}
      </section> : null}
    </motion.aside>
  );
}

/**
 * How much a generated skill's ranking is actually grounded. Surfaced next to
 * every voice skill so "a human approved these" is never mistaken for
 * "these converted" — the two look identical once rendered.
 */
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
  );
}

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
  const [composerMenu, setComposerMenu] = useState<ComposerMenu>(null);
  const [selectedMentions, setSelectedMentions] = useState<ArcMention[]>([]);
  const [attachments, setAttachments] = useState<ArcAttachment[]>([]);
  const [command, setCommand] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [contextInfoOpen, setContextInfoOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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
  const resolvedDemoConversationId =
    initialDemoConversationId &&
    (initialDemoConversationId === "new" ||
      DEMO_THREADS.some((group) => group.items.some((thread) => thread.id === initialDemoConversationId)))
      ? initialDemoConversationId
      : "storm";
  const [selectedDemoId, setSelectedDemoId] = useState(resolvedDemoConversationId);
  const [dismissedQuestionId, setDismissedQuestionId] = useState<string | null>(null);
  const [demoTurns, setDemoTurns] = useState<DemoTurn[]>([]);
  const [demoPending, setDemoPending] = useState(false);
  const [stoppingTaskId, setStoppingTaskId] = useState<string | null>(null);
  const demoTimer = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const composerMenuRef = useRef<HTMLDivElement | null>(null);
  const composerMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const chatRootRef = useRef<HTMLDivElement | null>(null);
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
  const awaitingReply = live && (Boolean(optimisticTurn) || visibleMessages.some((message) => message.status === "pending" || (message.role === "arc" && !message.body.trim())));
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

  // Backstop: reconcile with the server on a slow cadence while awaiting, so a
  // blocked or proxy-buffered SSE stream still resolves. Defense in depth, not the
  // primary path — the SSE stream above carries the live updates.
  useEffect(() => {
    if (!awaitingReply) return;
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      if (Date.now() - startedAt > 120_000) return window.clearInterval(interval);
      router.refresh();
    }, 6000);
    return () => window.clearInterval(interval);
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
  const latestQuestion = live ? [...visibleMessages].reverse().find((message) => message.role === "arc")?.questions?.[0] ?? null : null;
  const visibleQuestion = latestQuestion && latestQuestion.id !== dismissedQuestionId ? latestQuestion : null;
  const contextState = visibleMessages.length > 0
    ? contextUsage(visibleMessages.map((message) => message.body ?? ""))
    : { tokens: 4_320, pct: 18, level: "ok" as const };
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
    const results = await Promise.all(files.map(async (file) => {
      const formData = new FormData();
      formData.append("file", file);
      return uploadArcAttachmentAction(formData);
    }));
    const uploaded = results.flatMap((result) => result.ok ? [result.attachment] : []);
    const firstError = results.find((result) => !result.ok);
    if (uploaded.length > 0) setAttachments((current) => [...current, ...uploaded]);
    setComposerNotice(firstError && !firstError.ok ? firstError.error : `${uploaded.length} file${uploaded.length === 1 ? "" : "s"} attached`);
    setUploading(false);
  };

  const submitDraft = () => {
    const body = draft.trim();
    if (!body || /^\/[^\s]*$/.test(body) || /@$/.test(body) || isSending || demoPending || uploading) return;
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

  const selectDemoThread = (id: string) => {
    setOptimisticTurn(null);
    setSelectedDemoId(id);
    setHistoryOpen(false);
    setReviewCards(null);
    // Not a hard close: an operator who opened the workspace and then switched
    // threads asked for it open, and resetting it is the same override one step
    // removed. Closed when they have expressed no preference.
    setWorkPanelOpen(workPanelOpenOnConversationChange());
    setContextInfoOpen(false);
    setDemoTurns([]);
    setDemoPending(false);
    if (id === "new") {
      scrollToStart();
      window.requestAnimationFrame(() => composerInputRef.current?.focus());
    }
  };

  const startNewConversation = () => {
    setOptimisticTurn(null);
    setStartingNewConversation(true);
    setHistoryOpen(false);
    setReviewCards(null);
    setWorkPanelOpen(workPanelOpenOnConversationChange());
    setShareOpen(false);
    setComposerMenu(null);
    setContextInfoOpen(false);
    setComposerNotice(null);
    setDraft("");
    setSelectedMentions([]);
    setAttachments([]);
    setCommand(null);
    repin();
    scrollToStart();
    window.requestAnimationFrame(() => composerInputRef.current?.focus());
  };

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

  const handleEditResend = (messageId: string, newBody: string) => {
    setComposerNotice(null);
    startSend(async () => {
      const result = await editAndResendArcMessageAction({ messageId, body: newBody });
      if (!result.ok) return setComposerNotice(result.error);
      router.refresh();
    });
  };

  const handleRegenerate = (replyMessageId: string) => {
    setComposerNotice(null);
    startSend(async () => {
      const result = await regenerateArcReplyAction(replyMessageId);
      if (!result.ok) return setComposerNotice(result.error);
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
  const workCards = live ? latestArcMessage?.actions ?? [] : demoSeed ? DEMO_PACKAGE_CARDS : [];
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

  const needsReviewCards = reviewableWorkCards.filter((card) => {
    const status = assetStatuses[card.approval?.assetId ?? ""] ?? card.status ?? "draft";
    return status !== "approved" && status !== "rejected" && status !== "revision";
  });
  const panelVisible = workPanelOpen || Boolean(reviewCards?.length);

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
    <div className="arc-chat" ref={chatRootRef} data-workspace-open={panelVisible ? "true" : "false"} data-new-conversation={live && !visibleConversationId && visibleMessages.length === 0 && !optimisticTurn ? "true" : "false"}>
      <header className="arc-conversation-header">
        <button type="button" className="arc-history-button" onClick={() => setHistoryOpen(true)} aria-label="Open conversations"><MessagesSquare size={17} /><span>Conversations</span></button>
        <div className="arc-conversation-title"><h1>{header.title}</h1><p>{header.subtitle}</p></div>
        <div className="arc-conversation-actions">
          {needsReviewCards.length > 0 ? <button type="button" className="arc-header-attention" aria-label={`${needsReviewCards.length} items need review`} onClick={() => openReview(needsReviewCards)}><ClipboardCheck size={15} /><span>{needsReviewCards.length} need review</span></button> : null}
          <button type="button" onClick={() => setShareOpen(true)} disabled={!visibleConversationId} title={!visibleConversationId ? "Start a real conversation before sharing" : "Share conversation"}><Share2 size={15} /> Share</button>
          <button type="button" className="arc-header-work" aria-expanded={panelVisible} aria-label={panelVisible ? "Close conversation workspace" : "Open conversation workspace"} onClick={() => setWorkPanelVisibility(!panelVisible)}>{panelVisible ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}<span>Workspace</span></button>
        </div>
      </header>

      <main className="arc-conversation-scroll" ref={scrollRef}>
        <div className="arc-conversation-column">
          {live && historyLoadError ? <div className="arc-history-load-error" role="status"><CircleAlert size={15} /><span><b>History is temporarily unavailable.</b>{historyLoadError}</span></div> : null}
          {live ? <LiveConversation messages={renderedMessages} optimisticTurn={optimisticTurn} operatorName={greetName} waiting={waiting} assetStatuses={assetStatuses} onSuggestion={updateDraft} onReview={openReview} onEdit={handleEditResend} onRegenerate={handleRegenerate} onCancelRun={stopLiveRun} stoppingTaskId={stoppingTaskId} onAssetStatus={recordAssetStatus} /> : showDemoLauncher ? <ArcLauncher greetName={greetName} waiting={DEMO_WAITING} onPick={updateDraft} /> : <DemoConversation turns={demoTurns} pending={demoPending} includeSeed={selectedDemoId !== "new"} packageStatuses={assetStatuses} pendingContract={buildArcRunContract({ mode, route, contextScopes, agentTaskId: "DEMO-RUNNING" })} onReview={openReview} onEditResend={demoEditResend} onStop={stopDemoRun} onAssetStatus={recordAssetStatus} />}
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
      </main>

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

            <textarea ref={composerInputRef} aria-label="Message Arc" placeholder={selectedSkill?.key === "skill-authoring" ? "Describe the workflow you want Arc to learn…" : selectedSkill?.key === "skill-installation" ? "Paste a public GitHub repository or SKILL.md URL…" : selectedSkill ? `Add details for ${selectedSkill.name}…` : command ? "Add details for this skill…" : "Message Arc…"} value={draft} rows={2} disabled={isSending || demoPending || isSavingSkill} onChange={(event) => { const value = event.target.value; updateDraft(value); if (value.endsWith("@")) { composerMenuTriggerRef.current = null; setComposerMenu("mentions"); } else if (/^\s*\/[^\s]*$/.test(value)) { composerMenuTriggerRef.current = null; setComposerMenu("commands"); } }} onKeyDown={(event) => {
              if (event.key === "Escape") { closeComposerMenu(); return; }
              if (composerMenu && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                event.preventDefault();
                const items = Array.from(composerMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]') ?? []).filter((item) => !item.disabled);
                items[event.key === "ArrowDown" ? 0 : items.length - 1]?.focus();
                return;
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

      {/* The two side panels swap in place, so they get their own presence scope:
          mode="wait" lets the outgoing panel finish exiting before the next one
          enters — rendering both at once cross-fades their text on top of each other. */}
      <AnimatePresence mode="wait">
        {reviewCards && reviewCards.length > 0
          ? <AssetReviewPanel key="asset-review" cards={reviewCards} statuses={assetStatuses} onStatus={recordAssetStatus} onClose={() => setReviewCards(null)} />
          : workPanelOpen
            ? <ArcWorkPanel key="work-panel" message={latestArcMessage} messages={live ? renderedMessages : undefined} cards={workCards} statuses={assetStatuses} demoSeed={demoSeed} demoPending={demoPending} demoRequest={latestDemoRequest} demoOutcome={latestDemoArcTurn ? latestDemoArcTurn.outcome ?? "complete" : undefined} onReview={openReview} onRecover={recoverRun} onClose={() => setWorkPanelVisibility(false)} />
            : null}
      </AnimatePresence>
      <AnimatePresence>
        {panelVisible ? <motion.button type="button" className="arc-workspace-scrim" aria-label="Close conversation workspace" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setReviewCards(null); setWorkPanelVisibility(false); }} /> : null}
        {historyOpen ? <Fragment key="arc-workspace"><motion.button type="button" className="arc-drawer-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setHistoryOpen(false)} aria-label="Close Arc workspace" /><ThreadDrawer live={live} groups={threadGroups} activeConversationId={visibleConversationId} selectedDemoId={selectedDemoId} needsReviewCount={needsReviewCards.length} onSelectDemo={selectDemoThread} onStartNew={startNewConversation} onOpenReview={() => { setHistoryOpen(false); openReview(needsReviewCards); }} onUseSkill={applyDrawerSkill} installedSkills={installedSkills} installedSkillKeys={installedSkillKeys} installingSkillKey={installingSkillKey} onSetSkillInstalled={setLibrarySkillInstalled} workspaceSkills={workspaceSkills} onWorkspaceSkillsChange={setWorkspaceSkills} generatedSkills={generatedSkills} onGeneratedSkillsChange={setGeneratedSkills} workspaceName={workspaceName} campaignItems={mentionGroups.find((group) => group.type === "campaign")?.items ?? []} connectorsConfigured={connectorsConfigured} connectors={connectors} emailConnection={emailConnection} liveSendEnabled={liveSendEnabled} onClose={() => setHistoryOpen(false)} /></Fragment> : null}
        {shareOpen ? <ShareDialog key="share-dialog" conversationId={visibleConversationId} onClose={() => setShareOpen(false)} /> : null}
      </AnimatePresence>
    </div>
  );
}
