"use client";

// The Arc chat presentational component library: the message bubbles, run trace /
// receipt, draft + asset review surfaces, work panel, and the small icon/format
// helpers they share. No conversation orchestration and no state container live
// here — arc-view.tsx (the shell) and arc-conversation.tsx (the renderers) import
// from this module, never the reverse.

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Bookmark,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Copy,
  Database,
  FileText,
  LayoutTemplate,
  Link2,
  LoaderCircle,
  Mail,
  Megaphone,
  MessageSquareText,
  PanelRightClose,
  PanelRightOpen,
  PencilLine,
  RotateCcw,
  Search,
  Smartphone,
  Square,
  Target,
  ThumbsDown,
  ThumbsUp,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import {
  arcToolLabel,
  redactToolPayload,
  summarizeToolPayload,
  ASSET_NOUN,
  countOf,
  summarizeSteps,
  WORK_STATE_LABEL,
  type ArcActionCard,
  type ArcAssetStatus,
  type ArcMention,
  type ArcQuestion,
  type ArcRecall,
} from "@/domain";
import type {
  ArcAttachment,
  ArcMessage,
  ArcStep,
  ArcToolCall,
} from "@/lib/arc-chat/persistence";
import type { ArcRunContract } from "@/lib/arc-chat/run-contract";
import { visibleRecallCount } from "@/lib/arc-chat/recall-visibility";
import { isNarrationEntry, isRunPhaseLabel } from "@/lib/arc-chat/run-phases";
import { visibleStepNarration } from "@/lib/arc-chat/step-narration";
import { collapseTraceRows } from "@/lib/arc-chat/trace-rows";
import { buildArcRunProfile } from "@/lib/arc-chat/run-profile";
import { resolveArcRunViewState } from "@/lib/arc-chat/run-view-state";
import { getToolKind } from "@/lib/arc-chat/tool-labels";
import {
  buildArcWorkspaceEvidence,
  buildArcWorkspaceRuns,
  formatRunDuration,
  type ArcWorkspaceActivityRow,
  type ArcWorkspaceRun,
} from "@/lib/arc-chat/workspace-digest";
import { collectArcWorkspaceCards } from "@/lib/arc-chat/workspace-scope";
import {
  DEFAULT_WORK_SECTIONS,
  readWorkSectionPreference,
  writeWorkSectionPreference,
  type WorkSectionId,
} from "@/lib/arc-chat/work-panel-preference";

import {
  decideArcDraftAction,
  requestArcDraftRevisionAction,
  saveArcMessageAction,
  saveArcMessageToBrainAction,
  setArcMessageFeedbackAction,
} from "../actions";
import { LiveReasoning, ReasoningMarkdown } from "./arc-markdown";
import { buildDemoLiveWork, DEMO_STEPS, DEMO_TOOLS, DEMO_WORKSPACE_MESSAGES } from "./arc-demo-data";
import type { RunKind, RunRow } from "./arc-view.types";

export { getToolKind };

export function formatMessageTime(iso: string) {
  const value = new Date(iso);
  if (!Number.isFinite(value.getTime())) return "";
  return value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const subscribeToHydration = () => () => undefined;

/** Render local wall-clock time only after hydration. Vercel renders in UTC,
 * while the browser formats in the operator's timezone; formatting during SSR
 * made the two trees disagree and triggered React hydration error #418. */
function MessageTime({ iso, className }: { iso: string; className?: string }) {
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  return (
    <time className={className} dateTime={iso}>
      {hydrated ? formatMessageTime(iso) : ""}
    </time>
  );
}

export function RunIcon({ kind, size = 15 }: { kind: RunKind; size?: number }) {
  if (kind === "search") return <Search size={size} />;
  if (kind === "match") return <Database size={size} />;
  if (kind === "draft") return <FileText size={size} />;
  if (kind === "media") return <LayoutTemplate size={size} />;
  if (kind === "tool") return <Wrench size={size} />;
  return <Brain size={size} />;
}

/** One anchor per evidence group. The section used to be five identical stacks
 *  of uppercase text, which made scanning it work the reader had to do. */
/** How many memories the panel shows before asking. Long enough to be useful,
 *  short enough that the section stays scannable next to the deliverables. */
const MEMORY_PREVIEW = 6;

function EvidenceIcon({ group }: { group: string }) {
  if (group === "memory") return <Brain size={12} />;
  if (group === "records") return <Link2 size={12} />;
  if (group === "audience") return <Target size={12} />;
  if (group === "tools") return <Wrench size={12} />;
  return <Database size={12} />;
}

export function formatWorkingTime(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}


export function RunContract({ contract, outcome = "complete" }: { contract: ArcRunContract; outcome?: "complete" | "failed" | "canceled" }) {
  const title = outcome === "canceled" ? "Canceled receipt" : outcome === "failed" ? "Failed receipt" : "Run receipt";
  const contractGrid = (
    <div className="arc-run-contract-grid">
      <div><span>Reads</span><b>{contract.readScopes.length > 0 ? contract.readScopes.join(" · ") : "Conversation only"}</b></div>
      <div><span>Workspace effect</span><b>{contract.workspaceEffect}</b></div>
      <div><span>External effect</span><b>{contract.externalEffect}</b></div>
      <div><span>Recorded output</span><b>{contract.outputSummary}</b></div>
    </div>
  );

  return (
    <div className="arc-run-contract" data-state={outcome}>
      <div className="arc-run-contract-head">
        {outcome === "complete" ? <ClipboardCheck size={15} /> : <X size={15} />}
        <span><b>{title}</b><small>{contract.modelLabel}</small></span>
        {contract.receiptId ? <code>#{contract.receiptId}</code> : null}
      </div>
      {contractGrid}
    </div>
  );
}

/**
 * A tool label dropped into the middle of a sentence. Blanket `.toLowerCase()`
 * turned "CRM search" into "Running crm search", one line under a label reading
 * "CRM search" — so an acronym keeps its case and everything else lowers.
 */
function midSentence(label: string): string {
  const first = label.split(" ")[0] ?? "";
  if (first && first === first.toUpperCase()) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

export function RunTrace({
  pending,
  responding = false,
  reasoning,
  steps = [],
  toolCalls = [],
  contract,
  onStop,
  stopping = false,
  outcome = "complete",
  demoRows = [],
  thoughtSeconds,
  startedAtIso,
  answerText = "",
}: {
  pending: boolean;
  /** The answer has started arriving. The answer itself renders in the message's
   *  own container (never in here — see the note on the live block below); this
   *  only shifts the status label from "Thinking" to "Responding". */
  responding?: boolean;
  reasoning?: string | null;
  steps?: ArcStep[];
  toolCalls?: ArcToolCall[];
  contract?: ArcRunContract;
  onStop?: () => void;
  stopping?: boolean;
  outcome?: "complete" | "failed" | "canceled";
  demoRows?: RunRow[];
  /** Measured wall-clock of the run, rendered as "Thought for Ns" on the
   *  collapsed summary (Claude-style). Omitted when unknown. */
  thoughtSeconds?: number;
  /** When the run began, server-side. Without it the elapsed count restarts
   *  whenever this component mounts. */
  startedAtIso?: string;
  /** The reply this trace sits with. A step's narration is copied from the prose
   *  Arc wrote before acting and is never removed from the reply, so narration
   *  the answer already contains is suppressed here rather than shown twice. */
  answerText?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // Consecutive same-verb steps fold into one counted row ("Creating lead · 46")
  // rather than 46 near-identical chips; a collapsed group trades its own detail
  // line for the step it is on right now. Tool calls stay 1:1 — each is a
  // distinct, individually meaningful action.
  const stepSummary = summarizeSteps(steps);
  const sourceRows: RunRow[] = [
    ...stepSummary.groups.map((group, index) => {
      // Prefer the narration — the prose Arc wrote before acting — over the
      // group's latest label. Grouping used to discard it, so a repeated action
      // ("Searching CRM · 3") replaced the reasoning with its own restated name.
      // Hidden when the answer already says the same thing, so a sentence that
      // survived into the reply isn't read twice.
      const narration = group.steps.map((item) => item.detail?.join(" · ")).find((value) => value?.trim());
      // A narration entry is a line Arc wrote, not an action it took: no label,
      // no status tick, and dropped entirely when the answer already says it.
      if (isNarrationEntry(group.title)) {
        return {
          id: `step-${index}`,
          label: "",
          detail: visibleStepNarration(narration, answerText) ?? undefined,
          status: group.status,
          kind: group.kind,
          isNarration: true,
        };
      }
      return {
        id: `step-${index}`,
        label: group.count > 1 ? `${group.title} · ${group.count}` : group.title,
        detail: visibleStepNarration(narration, answerText) ?? (group.count > 1 ? group.latestLabel : undefined),
        status: group.status,
        kind: group.kind,
      };
    }),
    ...toolCalls.map((tool, index) => ({
      id: `tool-${index}`,
      // The raw name here rendered `mcp__arc__weather_lookup` straight into the
      // trace — the protocol prefix is how Arc reaches the tool, not what it did.
      // Found by the dev identifier check, not by reading the screen (BSR-709).
      label: arcToolLabel(tool.name),
      // One line by default, the payload behind a disclosure. This used to print
      // the tool's raw input and output into the row — `{"limit":0} ·
      // {"contacts":[],"total":243}` — and two of prod's payloads carried a
      // phone number, because a tool that reads contacts returns contact rows
      // (BSR-724).
      detail: summarizeToolPayload(tool.input) || `Running ${midSentence(arcToolLabel(tool.name))}`,
      result: summarizeToolPayload(tool.output) || undefined,
      payload: [tool.input, tool.output].filter(Boolean).map((p) => redactToolPayload(p!)).join("\n\n") || undefined,
      isTool: true,
      status: tool.status === "complete" ? "done" as const : tool.status === "error" ? "error" as const : "running" as const,
      kind: getToolKind(tool.name),
    })),
  ];
  const rows = sourceRows.length > 0 ? sourceRows : demoRows;

  useEffect(() => {
    if (!pending || reduceMotion || sourceRows.length > 0 || demoRows.length === 0) return;
    const interval = window.setInterval(() => {
      setActiveIndex((current) => Math.min(current + 1, rows.length - 1));
    }, 1350);
    return () => window.clearInterval(interval);
  }, [demoRows.length, pending, reduceMotion, rows.length, sourceRows.length]);

  // Count from when the run actually began, not from when this component
  // mounted. Mount time meant a reload — or navigating away and back — reset the
  // counter to 0s on a run that was already a minute in, and made the live
  // number disagree with the runner-measured "Thought for Ns" at the end.
  useEffect(() => {
    if (!pending) return;
    const startedAt = startedAtIso ? Date.parse(startedAtIso) : Date.now();
    const from = Number.isFinite(startedAt) ? startedAt : Date.now();
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - from) / 1000)));
    tick(); // don't show 0s for a second on a run already in progress
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [pending, startedAtIso]);

  if (!pending) {
    if (!reasoning && sourceRows.length === 0 && !contract) return null;
    // Counted from the steps themselves, not the collapsed rows: the headline
    // says "46 activities" and the row below it reads "Creating lead · 46".
    // Counting rows would say "3 activities" over a row claiming 46.
    const completeCount = stepSummary.doneCount + toolCalls.filter((tool) => tool.status === "complete").length;
    const activityCount = stepSummary.totalSteps + toolCalls.length;
    const activityLabel = activityCount === 1 ? "activity" : "activities";
    const durationLabel = thoughtSeconds && thoughtSeconds > 0 ? formatWorkingTime(Math.round(thoughtSeconds)) : null;
    const summaryLabel = outcome === "canceled"
      ? activityCount > 0 ? `Stopped after ${activityCount} ${activityLabel}` : "Run stopped"
      : outcome === "failed"
        ? activityCount > 0 ? `Failed after ${activityCount} ${activityLabel}` : "Run failed"
        : durationLabel
          ? `Thought for ${durationLabel}${activityCount > 0 ? ` · ${completeCount || activityCount} ${activityLabel}` : ""}`
          : activityCount > 0 ? `Completed ${completeCount || activityCount} ${activityLabel}` : "Run complete";
    return (
      <details
        className="arc-run-summary"
        data-outcome={outcome}
        onToggle={(event) => {
          const details = event.currentTarget;
          if (!details.open) return;
          // Expanding the last message's receipt grows the feed below the fold,
          // leaving the details under the composer — nudge the revealed block
          // minimally into view. "nearest" keeps an already-visible block still.
          requestAnimationFrame(() => {
            details.querySelector(".arc-run-details")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          });
        }}
      >
        <summary>
          <span className="arc-run-summary-main">{outcome === "complete" ? <CheckCircle2 size={15} /> : outcome === "canceled" ? <Square size={13} /> : <X size={15} />}{summaryLabel}</span>
          <span className="arc-run-summary-meta">View details <ChevronRight size={14} /></span>
        </summary>
        <div className="arc-run-details">
          {contract ? <RunContract contract={contract} outcome={outcome} /> : null}
          {reasoning ? (
            <div className="arc-reasoning-summary">
              <Brain size={15} />
              <div><b>Thinking</b><ReasoningMarkdown text={reasoning} /></div>
            </div>
          ) : null}
          <div className="arc-run-rows">
            {sourceRows.map((row) => (
              <div className={`arc-run-row is-${row.status}`} key={row.id}>
                <span className="arc-run-kind"><RunIcon kind={row.kind} /></span>
                {/* The summary line is ours and stays checked by the dev
                    identifier check. The raw payload inside the disclosure is
                    the tool's own text — ids and argument names — so it carries
                    the same exemption the run page's <pre> gets (BSR-709/724). */}
                <span className="arc-run-copy">
                  <b>{row.label}</b>
                  {row.detail || row.result ? <small>{[row.detail, row.result].filter(Boolean).join(" · ")}</small> : null}
                  {row.payload ? (
                    <details className="arc-run-raw">
                      <summary>Show raw</summary>
                      <pre data-identifiers-ok>{row.payload}</pre>
                    </details>
                  ) : null}
                </span>
                {row.status === "error" ? <X size={14} className="arc-run-state" aria-label="Failed" /> : <Check size={14} className="arc-run-state" aria-label="Complete" />}
              </div>
            ))}
          </div>
        </div>
      </details>
    );
  }

  const liveRows = rows.map((row, index) => {
    if (sourceRows.length > 0) return row;
    if (index < activeIndex) return { ...row, status: "done" as const };
    if (index === activeIndex) return { ...row, status: "running" as const };
    return row;
  }).filter((row) => sourceRows.length > 0 || row.status !== "queued");
  const hasError = liveRows.some((row) => row.status === "error");
  const hasReportedWork = liveRows.some((row) => row.isTool || !isRunPhaseLabel(row.label)) || Boolean(reasoning?.trim());
  const elapsedLabel = formatWorkingTime(elapsedSeconds);
  // Name the phase Arc is actually in rather than a generic "Thinking". The
  // runner reports its own phases now, so the most recent running row is the
  // truthful answer to "what is it doing?" — and it reads as one calm line
  // changing as the work moves, which is the shape asked for.
  const currentActivity = [...liveRows].reverse().find((row) => row.status === "running")?.label;
  // What the reader sees. The runner's own phases name the current activity in
  // the header above; as rows they are just our plumbing, listed back at someone
  // waiting on an answer. Arc's actions on their workspace keep their rows.
  const visibleLiveRows = liveRows.filter((row) => {
    if (row.isNarration) return Boolean(row.detail?.trim());
    return row.isTool || !isRunPhaseLabel(row.label);
  });
  const statusLabel = stopping
    ? "Stopping safely…"
    : hasError
      ? `Needs attention after ${elapsedLabel}`
      : currentActivity
        ? `${currentActivity} · ${elapsedLabel}`
        : responding
          ? `Responding · ${elapsedLabel}`
          : `Thinking · ${elapsedLabel}`;

  // NOTE: the streamed answer is deliberately NOT rendered here. It used to be —
  // as `.arc-live-commentary`, nested between the reasoning and the activity
  // list — and then the completed message re-rendered it in a different
  // container at a different type scale, so finishing a run read as a page swap
  // rather than a reply settling. The answer now lives in the message's own
  // container from the first token; this block only ever holds reasoning and
  // activity, and collapses above the answer when the run completes.
  return (
    <motion.div
      className="arc-run-live"
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      data-state={stopping ? "stopping" : hasError ? "error" : "running"}
      // Before any real work lands there is nothing to frame, so the block drops
      // its rule and padding and stays a single calm line.
      data-empty={hasReportedWork ? undefined : "true"}
    >
      <div className="arc-run-live-head">
        <ThinkingIndicator label={stopping ? "Stopping" : hasError ? "Needs attention" : "Thinking"} />
        <span><b aria-hidden="true" className={!stopping && !hasError ? "arc-shimmer" : undefined}>{statusLabel}</b><span className="sr-only" role="status" aria-live="polite">{stopping ? "Arc is stopping safely" : hasError ? "Arc needs attention" : currentActivity ? `Arc is ${currentActivity.toLowerCase()}` : "Arc is working"}</span></span>
        <button type="button" className="arc-stop" aria-label="Stop Arc" onClick={onStop} disabled={!onStop || stopping}><Square size={11} /> {stopping ? "Stopping…" : "Stop"}</button>
      </div>
      {/* Nothing to report yet: the head already spins, shimmers, and counts.
          There used to be a placeholder row here reading "Starting the run… /
          Waiting for the first reported activity" — our own plumbing narrated to
          someone waiting on an answer, dressed as an activity item, inside a
          bordered box framing dead space. */}
      {!hasReportedWork ? null : (
      <>
      <div className="arc-run-divider" />
      <div className="arc-live-worklog">
        {/* Arc thinking, as it forms. This is the most interesting thing on the
            screen during a run and it belongs in front of the reader, not behind
            a disclosure — a previous pass hid it whenever any step had landed,
            which meant it was never visible at all once the run reported its own
            phases. */}
        {reasoning?.trim() ? (
          <motion.div initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }}>
            <LiveReasoning text={reasoning} streaming={!responding} />
          </motion.div>
        ) : null}
        <div className="arc-live-events" role="list" aria-label="Live activity">
        {(collapseTraceRows(visibleLiveRows) as RunRow[]).map((row, index) => (
          <motion.div
            className={`arc-live-event is-${row.status}${row.isNarration ? " is-narration" : ""}`}
            key={row.id}
            initial={reduceMotion ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: row.status === "queued" ? 0.62 : 1, y: 0 }}
            transition={{ delay: reduceMotion ? 0 : index * 0.08 }}
            role="listitem"
            aria-current={row.status === "running" ? "step" : undefined}
          >
            {row.isNarration ? null : <span className="arc-live-event-icon"><RunIcon kind={row.kind} size={15} /></span>}
            <span className="arc-live-event-copy">
              {row.label ? <b data-tool={row.isTool ? "true" : undefined}>{row.label}</b> : null}
              {row.detail ? <small>{row.detail}</small> : null}
              {row.result ? <small className="arc-live-event-result">{row.result}</small> : null}
            </span>
            <span className="arc-live-event-state">
              {row.isNarration ? null : row.status === "done" ? <Check size={14} aria-label="Complete" /> : null}
              {row.status === "running" ? <LoaderCircle size={15} aria-label="Active" /> : null}
              {row.status === "queued" ? <Circle size={10} aria-label="Queued" /> : null}
              {row.status === "error" ? <X size={14} aria-label="Needs attention" /> : null}
            </span>
          </motion.div>
        ))}
        </div>
      </div>
      </>
      )}
    </motion.div>
  );
}

export function ThinkingIndicator({ label }: { label: string }) {
  return <span className="arc-thinking-indicator arc-spinner" role="status" aria-label={label} />;
}

/** A tiny image thumbnail (composer chip). Attachment URLs are arbitrary signed
 *  URLs, so next/image (which needs configured remote patterns) doesn't fit. */
export function ChipThumb({ url }: { url: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="arc-chip-thumb" />;
}

/** Renders a message's attachments — image uploads as clickable thumbnails, other
 *  files as compact chips (both open the full asset in a new tab). */
export function MessageAttachments({ attachments }: { attachments: ArcAttachment[] }) {
  if (attachments.length === 0) return null;
  const images = attachments.filter((attachment) => attachment.contentType.startsWith("image/"));
  const files = attachments.filter((attachment) => !attachment.contentType.startsWith("image/"));
  return (
    <div className="arc-attachments">
      {images.map((attachment) => (
        <a key={attachment.objectPath} href={attachment.url} target="_blank" rel="noopener noreferrer" className="arc-attachment-image" title={attachment.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={attachment.url} alt={attachment.name} loading="lazy" />
        </a>
      ))}
      {files.map((attachment) => (
        <a key={attachment.objectPath} href={attachment.url} target="_blank" rel="noopener noreferrer" className="arc-attachment-file" title={attachment.name}>
          <FileText size={13} />{attachment.name}
        </a>
      ))}
    </div>
  );
}

export function OperatorMessage({ body, time, timeIso, attachments, onEdit, onContextMenu }: { body: string; time?: string; timeIso?: string; attachments?: ArcAttachment[]; onEdit?: (newBody: string) => void; onContextMenu?: (event: React.MouseEvent, helpers: { startEdit: (() => void) | null }) => void }) {
  const reduceMotion = useReducedMotion();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(body);

  const cancel = () => { setText(body); setEditing(false); };
  const submit = () => {
    const next = text.trim();
    if (!next) return;
    setEditing(false);
    if (next !== body) onEdit?.(next);
  };

  if (editing) {
    return (
      <div className="arc-operator-message is-editing">
        <textarea
          autoFocus
          rows={2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") cancel();
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
          }}
        />
        <div className="arc-operator-edit-actions">
          <button type="button" onClick={cancel}>Cancel</button>
          <button type="button" className="is-primary" onClick={submit} disabled={!text.trim()}>Save &amp; resend</button>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="arc-operator-message"
      onContextMenu={onContextMenu ? (event) => onContextMenu(event, { startEdit: onEdit ? () => { setText(body); setEditing(true); } : null }) : undefined}
      initial={reduceMotion ? false : { opacity: 0, y: 7 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {time ? <span className="arc-message-time">{time}</span> : timeIso ? <MessageTime className="arc-message-time" iso={timeIso} /> : null}
      <div>{body}</div>
      {attachments && attachments.length > 0 ? <MessageAttachments attachments={attachments} /> : null}
      {onEdit ? <button type="button" className="arc-operator-edit" onClick={() => { setText(body); setEditing(true); }}><PencilLine size={12} /> Edit</button> : null}
    </motion.div>
  );
}

export function AssistantMessage({
  time,
  timeIso,
  active = false,
  onContextMenu,
  children,
}: {
  time?: string;
  timeIso?: string;
  active?: boolean;
  onContextMenu?: (event: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.article
      className={`arc-assistant-message${active ? " is-active" : ""}`}
      onContextMenu={onContextMenu}
      initial={reduceMotion ? false : { opacity: 0, y: 9 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="arc-assistant-content">
        {children}
        {!active && (time || timeIso) ? <div className="arc-assistant-footer">{time ? <time>{time}</time> : timeIso ? <MessageTime iso={timeIso} /> : null}</div> : null}
      </div>
    </motion.article>
  );
}

/** Channel-keyed icon for an asset tab / summary. */
export function ChannelIcon({ channel, size = 17 }: { channel?: string; size?: number }) {
  const c = (channel ?? "").toLowerCase();
  if (c.includes("email")) return <Mail size={size} />;
  if (c.includes("sms") || c.includes("text")) return <Smartphone size={size} />;
  if (c.includes("social") || c.includes("ad") || c.includes("meta") || c.includes("instagram")) return <Megaphone size={size} />;
  if (c.includes("land") || c.includes("page")) return <LayoutTemplate size={size} />;
  if (c.includes("audience") || c.includes("segment")) return <Target size={size} />;
  return <FileText size={size} />;
}

export function assetStatusMeta(status: ArcAssetStatus | null) {
  return DRAFT_STATUS_META[status ?? "review"] ?? DRAFT_STATUS_META.review;
}

/** An asset the operator has already ruled on, either way — it is no longer
 *  waiting on them, so the workspace stops counting it as work to do. */
export function isDecidedAssetStatus(status: ArcAssetStatus | null) {
  return status === "approved" || status === "rejected";
}

/** The compact package summary shown inline when Arc drafts a multi-asset
 *  campaign — a channel overview + a button into the review workspace. */
export function DraftPackageCard({ cards, statuses, onReview, onContextMenu }: { cards: ArcActionCard[]; statuses: Record<string, ArcAssetStatus>; onReview: () => void; onContextMenu?: (event: React.MouseEvent) => void }) {
  const statusOf = (card: ArcActionCard) => statuses[card.approval?.assetId ?? ""] ?? card.status ?? null;
  const approvedCount = cards.filter((card) => statusOf(card) === "approved").length;
  return (
    <div className="arc-package" onContextMenu={onContextMenu}>
      <div className="arc-package-kicker">Campaign · {approvedCount}/{cards.length} approved</div>
      <div className="arc-package-row">
        <span className="arc-package-icon"><MessageSquareText size={18} /></span>
        <span className="arc-package-title"><b>{countOf(cards.length, ASSET_NOUN)} need you</b><small>Review each channel in the workspace</small></span>
        <div className="arc-package-channels">
          {cards.slice(0, 4).map((card, index) => {
            const meta = assetStatusMeta(statusOf(card));
            return <span key={`${card.title}-${index}`} data-tone={meta.tone}><i />{card.channel ?? card.title}<small>{meta.label}</small></span>;
          })}
        </div>
        <button type="button" className="arc-review-button" data-arc-review-trigger="true" onClick={onReview}>Review assets <PanelRightOpen size={15} /></button>
      </div>
    </div>
  );
}

/** Approval-gated assets stay compact in the conversation; the Workspace owns
 * the detailed preview and decision flow so the same content is not repeated. */
export function DraftReceiptCard({ card, status, onReview, onContextMenu }: { card: ArcActionCard; status: ArcAssetStatus | null; onReview: () => void; onContextMenu?: (event: React.MouseEvent) => void }) {
  const meta = assetStatusMeta(status);
  return (
    <button type="button" className="arc-created-receipt" data-arc-review-trigger="true" onClick={onReview} onContextMenu={onContextMenu}>
      <span className="arc-created-receipt-icon"><ChannelIcon channel={card.channel} size={16} /></span>
      <span><b>{card.title}</b><small>{[card.channel, card.format].filter(Boolean).join(" · ") || "Created by Arc"}</small></span>
      <em className={`is-${meta.tone}`}><i />{meta.label}</em>
      <ArrowRight size={14} />
    </button>
  );
}

/**
 * The conversation workspace.
 *
 * BSR-562 gave this panel the conversation and left the single turn to the
 * inline trace; BSR-567 stopped it opening over nothing. What it still did with
 * that scope was replay every step of every run in one flat list — a transcript
 * the inline trace already tells better, in a panel the operator opened for a
 * different reason, with the deliverables hidden behind a tab.
 *
 * So it now leads with the decision it exists to serve — what Arc made, and what
 * is waiting on a human — then the evidence behind it. Run history stays,
 * because spanning runs is the one thing the inline trace cannot do, but as
 * navigation: one line per run, expandable, rather than forty rows deep.
 */
export function ArcWorkPanel({
  message,
  messages,
  cards,
  statuses,
  demoSeed,
  demoPending,
  demoRequest,
  demoOutcome,
  onReview,
  onRecover,
  onClose,
}: {
  message?: ArcMessage;
  messages?: ArcMessage[];
  cards: ArcActionCard[];
  statuses: Record<string, ArcAssetStatus>;
  demoSeed: boolean;
  demoPending: boolean;
  demoRequest?: string;
  demoOutcome?: "complete" | "canceled";
  onReview: (cards: ArcActionCard[]) => void;
  onRecover: (prompt: string) => void;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [openSections, setOpenSections] = useState<Record<WorkSectionId, boolean>>(DEFAULT_WORK_SECTIONS);
  const [showAllMemory, setShowAllMemory] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [demoActiveIndex, setDemoActiveIndex] = useState(0);

  useEffect(() => {
    const stored = readWorkSectionPreference();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restored after hydration so server and client markup stay identical
    if (stored) setOpenSections(stored);
  }, []);

  const toggleSection = (id: WorkSectionId) => {
    setOpenSections((current) => {
      const next = { ...current, [id]: !current[id] };
      writeWorkSectionPreference(next);
      return next;
    });
  };

  const conversation = messages ?? (message ? [message] : []);
  const liveRuns = buildArcWorkspaceRuns(conversation);
  const scopedCards = messages ? collectArcWorkspaceCards(messages, "conversation", cards) : cards;
  // The offline preview has no persisted conversation, so it digests the demo
  // fixture instead — otherwise this section reads empty in the one place the
  // design gets reviewed.
  const evidence = buildArcWorkspaceEvidence(
    liveRuns.length > 0 ? conversation : demoSeed || demoRequest ? DEMO_WORKSPACE_MESSAGES : [],
    scopedCards,
  );
  const evidenceCount = evidence.reduce((total, group) => total + group.items.length, 0);

  const demoWork = demoRequest ? buildDemoLiveWork(demoRequest) : null;
  const demoProfile = demoRequest ? buildArcRunProfile({
    request: demoRequest,
    sources: ["Workspace knowledge", "CRM records", "Campaign context"],
  }) : null;

  useEffect(() => {
    if (!demoPending || reduceMotion || !demoWork?.rows.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new demo request starts a fresh progress sequence
    setDemoActiveIndex(0);
    const interval = window.setInterval(() => {
      setDemoActiveIndex((current) => Math.min(current + 1, demoWork.rows.length - 1));
    }, 1350);
    return () => window.clearInterval(interval);
  }, [demoPending, demoRequest, demoWork?.rows.length, reduceMotion]);

  // The backend-less preview has no messages to digest, so its rows are built
  // here and folded into the same single-run shape the live path produces.
  const demoRows: ArcWorkspaceActivityRow[] = demoOutcome === "canceled"
    ? [{ id: "demo-panel-canceled", label: "Stopped before remaining work was applied", detail: "Completed work remains available", status: "done", kind: "think" }]
    : !demoPending && demoProfile
      ? demoProfile.phases.map((phase) => ({ id: `demo-panel-${phase.id}`, label: phase.label, detail: phase.detail, status: "done" as const, kind: phase.kind }))
      : demoWork?.rows.map((row, index) => ({
          ...row,
          kind: (row.kind ?? "think") as ArcWorkspaceActivityRow["kind"],
          status: index < demoActiveIndex ? "done" as const : index === demoActiveIndex ? "running" as const : "queued" as const,
        }))
        ?? (demoSeed
          ? [
              ...DEMO_STEPS.map((step, index) => ({ id: `demo-panel-step-${index}`, label: step.label, detail: step.detail?.join(" · "), status: "done" as const, kind: step.kind ?? "think" })),
              ...DEMO_TOOLS.map((tool, index) => ({ id: `demo-panel-tool-${index}`, label: arcToolLabel(tool.name), detail: tool.output, status: "done" as const, kind: getToolKind(tool.name) })),
            ]
          : []);

  const runs: ArcWorkspaceRun[] = liveRuns.length > 0
    ? liveRuns
    : demoRows.length > 0
      ? [{
          id: "demo-run",
          index: 1,
          request: demoRequest?.replace(/\s+/g, " ").trim() || "This conversation",
          state: demoPending ? "working" : "complete",
          stepCount: demoRows.filter((row) => row.kind !== "tool").length,
          toolCount: demoRows.filter((row) => row.kind === "tool").length,
          durationMs: null,
          rows: demoRows,
        }]
      : [];

  const latestRun = runs.at(-1);
  const runView = resolveArcRunViewState({
    pending: demoPending || latestRun?.state === "working",
    messageStatus: latestRun?.state === "failed" ? "failed" : latestRun?.state === "complete" ? "complete" : undefined,
    outcome: demoOutcome,
    rows: latestRun?.rows ?? [],
    // No reasoning here by design: it is fed by `metadata.reasoning`, which is
    // permanently empty (BSR-573), and narrating a run is the inline trace's job.
    hasContent: false,
  });

  const statusOf = (card: ArcActionCard) => statuses[card.approval?.assetId ?? ""] ?? card.status ?? null;
  const approvedCount = scopedCards.filter((card) => statusOf(card) === "approved").length;
  const awaitingCards = scopedCards.filter((card) => card.approval && !isDecidedAssetStatus(statusOf(card)));
  const isEmpty = runs.length === 0 && scopedCards.length === 0;

  const summary = [
    runs.length > 0 ? `${runs.length} ${runs.length === 1 ? "run" : "runs"}` : null,
    scopedCards.length > 0 ? `${scopedCards.length} ${scopedCards.length === 1 ? "deliverable" : "deliverables"}` : null,
    awaitingCards.length > 0 ? `${awaitingCards.length} waiting on you` : null,
  ].filter(Boolean).join(" · ");

  return (
    <motion.aside
      className="arc-artifact-workspace arc-work-panel"
      aria-label="Conversation workspace"
      initial={reduceMotion ? false : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, x: 18 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      <header className="arc-artifact-header">
        <div><h2>Workspace</h2><p>{summary || "Everything Arc makes here collects in this panel"}</p></div>
        <button type="button" onClick={onClose} aria-label="Close conversation workspace"><PanelRightClose size={17} /></button>
      </header>

      <div className="arc-work-body">
        {runs.length > 0 ? (
          <div className="arc-work-run-status" data-state={runView.state} aria-live="polite">
            <span><i />{runView.label}</span>
            {runView.progressLabel ? <em>{runView.progressLabel}</em> : null}
          </div>
        ) : null}

        {runView.state === "failed" ? (
          <div className="arc-work-recovery">
            <div><RotateCcw size={15} /><span><b>One step needs attention</b><small>The rest of the run is still available.</small></span></div>
            <div>
              <button type="button" onClick={() => onRecover("Retry the failed step from the last run and keep the completed work.")}>Retry failed step</button>
              <button type="button" onClick={() => onRecover("Continue the last request without the failed tool and explain any limitations.")}>Continue without it</button>
            </div>
          </div>
        ) : null}

        {awaitingCards.length > 0 ? (
          <div className="arc-work-decision">
            <div>
              <ClipboardCheck size={16} />
              <span>
                <b>{awaitingCards.length === 1 ? "1 draft needs your decision" : `${awaitingCards.length} drafts need your decision`}</b>
                <small>Nothing reaches a customer until you approve it.</small>
              </span>
            </div>
            <button type="button" className="arc-work-review" onClick={() => onReview(awaitingCards)}>
              {awaitingCards.length === 1 ? "Review draft" : `Review all ${awaitingCards.length}`} <ArrowRight size={14} />
            </button>
          </div>
        ) : null}

        {isEmpty ? (
          <div className="arc-work-empty">
            Drafts, campaign assets, and the records behind them collect here as Arc works. Nothing from this conversation yet.
          </div>
        ) : null}

        {scopedCards.length > 0 ? (
          <section className="arc-work-section">
            <h3 className="arc-work-section-title arc-work-section-head">
              <span className="arc-work-section-name">Deliverables</span>
              <span className="arc-work-section-meta">{approvedCount} of {scopedCards.length} approved</span>
            </h3>
            <div className="arc-created-progress"><div><i style={{ width: `${(approvedCount / scopedCards.length) * 100}%` }} /></div></div>
            <div className="arc-created-list">
              {scopedCards.map((card, index) => {
                const status = statusOf(card);
                const meta = assetStatusMeta(status);
                const content = (
                  <>
                    <span className="arc-created-icon"><ChannelIcon channel={card.channel} size={15} /></span>
                    <span><b>{card.title}</b><small>{[card.channel, card.format].filter(Boolean).join(" · ")}</small></span>
                    <em className={`is-${meta.tone}`}>{meta.label}</em>
                  </>
                );
                return card.approval
                  ? <button type="button" className="arc-created-item" key={`${card.title}-${index}`} onClick={() => onReview([card])} aria-label={`Review ${card.title}`}>{content}</button>
                  : <div className="arc-created-item" key={`${card.title}-${index}`}>{content}</div>;
              })}
            </div>
          </section>
        ) : null}

        {runs.length > 0 ? (
          <section className="arc-work-section">
            <h3 className="arc-work-section-title">
              <button type="button" className="arc-work-section-head is-toggle" aria-expanded={openSections.evidence} onClick={() => toggleSection("evidence")}>
                <span className="arc-work-section-name">Evidence</span>
                <span className="arc-work-section-meta">{evidenceCount > 0 ? `${evidenceCount} ${evidenceCount === 1 ? "source" : "sources"}` : "None recorded"}</span>
                <ChevronDown size={14} className={openSections.evidence ? "is-open" : ""} />
              </button>
            </h3>
            {openSections.evidence ? (
              evidence.length > 0 ? (
                <div className="arc-work-evidence">
                  {evidence.map((group) => (
                    // Memories are sentences Arc wrote; everything else is a
                    // name and a number. They get different shapes because they
                    // read differently — a sentence forced into a one-line row
                    // is what made this section a wall of truncated keys.
                    <div key={group.id} data-group={group.id}>
                      <h4><span className="arc-work-evidence-icon"><EvidenceIcon group={group.id} /></span>{group.label}<i>{group.items.length}</i></h4>
                      {group.id === "memory"
                        ? (() => {
                            // The parser no longer caps recall (BSR-624), so a
                            // real turn can carry fifteen facts. Long is fine —
                            // hiding some of them and printing a confident count
                            // of the survivors is not. The limit is the reader's
                            // to lift, and the button says what it is holding.
                            const shown = showAllMemory ? group.items : group.items.slice(0, MEMORY_PREVIEW);
                            return (
                              <>
                                {shown.map((item, index) => (
                                  <p className="arc-work-fact" key={`${group.id}-${index}`}>
                                    {item.label}
                                    {item.detail ? <em>{item.detail}</em> : null}
                                  </p>
                                ))}
                                {group.items.length > MEMORY_PREVIEW ? (
                                  <button type="button" className="arc-work-more" aria-expanded={showAllMemory} onClick={() => setShowAllMemory((value) => !value)}>
                                    {showAllMemory ? "Show fewer" : `Show all ${group.items.length}`}
                                    <ChevronDown size={13} className={showAllMemory ? "is-open" : ""} />
                                  </button>
                                ) : null}
                              </>
                            );
                          })()
                        : group.items.map((item, index) => (
                            item.href
                              ? <Link className="arc-work-evidence-item" key={`${group.id}-${index}`} href={item.href}><b>{item.label}</b>{item.detail ? <span>{item.detail}</span> : null}<ArrowRight size={12} /></Link>
                              : <div className="arc-work-evidence-item" key={`${group.id}-${index}`}><b>{item.label}</b>{item.detail ? <span>{item.detail}</span> : null}</div>
                          ))}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="arc-work-note">Arc did not record a source for this conversation. Records, recalled memory, and the tools it ran show up here.</p>
              )
            ) : null}
          </section>
        ) : null}

        {runs.length > 0 ? (
          <section className="arc-work-section">
            <h3 className="arc-work-section-title">
              <button type="button" className="arc-work-section-head is-toggle" aria-expanded={openSections.runs} onClick={() => toggleSection("runs")}>
                <span className="arc-work-section-name">Run history</span>
                <span className="arc-work-section-meta">{runs.length} {runs.length === 1 ? "run" : "runs"}</span>
                <ChevronDown size={14} className={openSections.runs ? "is-open" : ""} />
              </button>
            </h3>
            {openSections.runs ? (
              <div className="arc-work-runs">
                {runs.map((run) => {
                  const open = expandedRun === run.id;
                  const duration = formatRunDuration(run.durationMs);
                  const detail = [
                    `${run.stepCount} ${run.stepCount === 1 ? "step" : "steps"}`,
                    run.toolCount > 0 ? `${run.toolCount} ${run.toolCount === 1 ? "tool" : "tools"}` : null,
                    duration,
                  ].filter(Boolean).join(" · ");
                  return (
                    <div key={run.id}>
                      <button type="button" className="arc-work-run" aria-expanded={open} onClick={() => setExpandedRun(open ? null : run.id)}>
                        <span className="arc-work-run-index" data-state={run.state}>{run.index}</span>
                        <span><b>{run.request}</b><small>{detail}</small></span>
                        <ChevronRight size={14} className={open ? "is-open" : ""} />
                      </button>
                      {open ? (
                        <>
                          {/* A sibling link, not a nested one: the row above is a
                              <button> and an anchor inside it would be invalid.
                              run.id IS the arc_messages id, so this routes
                              directly (BSR-509). */}
                          <Link className="arc-work-inspect" href={`/arc/runs/${run.id}`}>
                            Inspect this run — steps, retrieval, cost
                          </Link>
                          {run.rows.length > 0 ? (
                          <div className="arc-work-activity">
                            {run.rows.map((row) => (
                              <div key={row.id} className={`is-${row.status}`}>
                                <span><RunIcon kind={row.kind} size={14} /></span>
                                <div>
                                  <b>{row.label}</b>
                                  {row.detail ? <small>{row.detail}</small> : null}
                                  <span className="sr-only">{row.status === "done" ? "Complete" : row.status === "running" ? "In progress" : row.status === "error" ? "Error" : "Queued"}</span>
                                </div>
                                {row.status === "done" ? <Check size={13} /> : row.status === "running" ? <LoaderCircle size={14} /> : row.status === "error" ? <X size={13} /> : <Circle size={9} />}
                              </div>
                            ))}
                          </div>
                          ) : <p className="arc-work-note">This run reported no separate steps.</p>}
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </motion.aside>
  );
}

/**
 * Shared Approve / Revise / Decline state machine for an Arc-drafted, approval-
 * gated asset. Owns the ephemeral interaction state (busy, notice, the revise
 * textarea) and the two server-action calls, then hands the resolved status back
 * through `onResolved` so each surface keeps its own status ownership — the inline
 * card holds it locally, the review panel lifts it to the parent so it reflects on
 * the package summary. Both surfaces consume this hook so the decision flow (the
 * actions, the status transitions, the notice copy, and the disabled gating) can
 * never drift between them; only the surrounding layout differs.
 */
export function useDraftDecision({
  approval,
  status,
  onResolved,
}: {
  approval: ArcActionCard["approval"];
  status: ArcAssetStatus | null;
  onResolved: (assetId: string, status: ArcAssetStatus) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseText, setReviseText] = useState("");
  const decided = status === "approved" || status === "rejected";

  const decide = (decision: "approved" | "declined") => {
    if (!approval || busy) return;
    setBusy(true);
    setNotice(null);
    decideArcDraftAction({ campaignId: approval.campaignId, assetId: approval.assetId, decision }).then((result) => {
      setBusy(false);
      if (!result.ok) return setNotice(result.error);
      onResolved(approval.assetId, decision === "approved" ? "approved" : "rejected");
      setNotice(result.persisted ? (decision === "approved" ? "Approved" : "Declined") : "Preview — decision not saved");
    });
  };

  const submitRevision = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const instruction = reviseText.trim();
    if (!approval || !instruction || busy) return;
    setBusy(true);
    setNotice(null);
    requestArcDraftRevisionAction({ campaignId: approval.campaignId, assetId: approval.assetId, instruction }).then((result) => {
      setBusy(false);
      if (!result.ok) return setNotice(result.error);
      onResolved(approval.assetId, "revision");
      setReviseOpen(false);
      setReviseText("");
      if (!result.persisted) return setNotice("Preview — revision not saved");
      // "Arc is updating it" is only true if the runner actually took the wake.
      // On `dispatched: false` the request is saved but nothing is running, and
      // nothing will re-surface it — so point at the campaign, where the retry
      // lives, rather than reporting an update that is not happening.
      setNotice(
        result.dispatched === false
          ? "Saved, but Arc hasn't picked it up — open the campaign to send it again"
          : "Revision requested — Arc is updating it",
      );
    });
  };

  const openRevise = () => setReviseOpen(true);
  const cancelRevise = () => { setReviseOpen(false); setReviseText(""); };
  // Clear the ephemeral state when the panel moves to a different asset.
  const reset = () => { setReviseOpen(false); setReviseText(""); setNotice(null); };

  return { busy, notice, reviseOpen, reviseText, setReviseText, decided, decide, submitRevision, openRevise, cancelRevise, reset } as const;
}

/**
 * Card-driven review workspace: the assets Arc drafted, one tab each, with the
 * full draft content and per-asset Approve / Revise / Decline wired (via
 * `useDraftDecision`) to the real campaign decision flow. Decisions are lifted to
 * the parent (keyed by asset id) so they persist while the panel is open and
 * reflect back on the package summary.
 */
export function AssetReviewPanel({ cards, statuses, onStatus, onClose }: { cards: ArcActionCard[]; statuses: Record<string, ArcAssetStatus>; onStatus: (assetId: string, status: ArcAssetStatus) => void; onClose: () => void }) {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState(0);
  const card = cards[Math.min(active, cards.length - 1)];
  const assetId = card.approval?.assetId ?? "";
  const status = statuses[assetId] ?? card.status ?? null;
  const meta = assetStatusMeta(status);
  const approvedCount = cards.filter((c) => (statuses[c.approval?.assetId ?? ""] ?? c.status) === "approved").length;
  const { busy, notice, reviseOpen, reviseText, setReviseText, decided, decide, submitRevision, openRevise, cancelRevise, reset } = useDraftDecision({ approval: card.approval, status, onResolved: onStatus });

  const selectTab = (index: number) => { setActive(index); reset(); };

  return (
    <motion.aside
      className="arc-artifact-workspace"
      aria-label="Asset review workspace"
      initial={reduceMotion ? false : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, x: 18 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      <header className="arc-artifact-header">
        <div><span>Review workspace</span><h2>{cards.length === 1 ? "Asset review" : "Campaign assets"}</h2><p>{countOf(cards.length, ASSET_NOUN)} · {approvedCount} approved</p></div>
        <button type="button" onClick={onClose} aria-label="Close review workspace"><PanelRightClose size={17} /></button>
      </header>
      <div className="arc-artifact-shell">
        <div className="arc-artifact-tabs" role="tablist" aria-label="Campaign assets">
          {cards.map((tabCard, index) => {
            const tabStatus = statuses[tabCard.approval?.assetId ?? ""] ?? tabCard.status ?? null;
            return (
              <button type="button" role="tab" key={`${tabCard.title}-${index}`} aria-selected={index === active} className={index === active ? "is-active" : ""} onClick={() => selectTab(index)}>
                <ChannelIcon channel={tabCard.channel} />
                <span>{tabCard.channel ?? tabCard.title}</span>
                <i className={`arc-artifact-dot is-${assetStatusMeta(tabStatus).tone}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <div className="arc-artifact-content">
          <div className="arc-artifact-status" aria-live="polite"><span className={`is-${meta.tone}`}><CheckCircle2 size={14} />{meta.label}</span></div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={active} role="tabpanel" className="arc-artifact-view" initial={reduceMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
              <div className="arc-artifact-title"><span>{card.channel ?? "Asset"}</span><h3>{card.title}</h3>{card.format ? <p>{card.format}</p> : null}</div>
              {card.preview ? <div className="arc-asset-preview">{card.preview}</div> : null}
              {card.rows.length > 0 ? (
                <section className="arc-artifact-section"><h4>Details</h4>{card.rows.slice(0, 6).map((row, index) => <div className="arc-asset-row" key={`${row.name}-${index}`}><b>{row.name}</b><span>{row.meta ?? ""}</span></div>)}</section>
              ) : null}
              {card.flags.length > 0 ? (
                <section className="arc-artifact-section"><h4>Checks</h4><div className="arc-check-grid">{card.flags.slice(0, 4).map((flag, index) => <span key={`${flag.label}-${index}`} className={`is-${flag.tone}`}><CheckCircle2 size={14} />{flag.label}</span>)}</div></section>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <footer className="arc-artifact-footer" aria-busy={busy}>
        {reviseOpen ? (
          <form className="arc-revision-form" onSubmit={submitRevision}>
            <label htmlFor="arc-revision-request">What should Arc change in the {(card.channel ?? "asset").toLowerCase()}?</label>
            <textarea id="arc-revision-request" autoFocus value={reviseText} onChange={(event) => setReviseText(event.target.value)} placeholder="Describe the change…" rows={2} />
            <div><button type="button" onClick={cancelRevise}>Cancel</button><button type="submit" className="is-primary" disabled={!reviseText.trim() || busy}>Send revision</button></div>
          </form>
        ) : (
          <>
            <div role="status" aria-live="polite">{notice ?? "Approve, revise, or decline each asset."}</div>
            <button type="button" onClick={openRevise} disabled={busy || decided}>Revise</button>
            <button type="button" onClick={() => decide("declined")} disabled={busy || decided}>Decline</button>
            <button type="button" className="is-primary" onClick={() => decide("approved")} disabled={busy || decided}><Check size={14} />{status === "approved" ? "Approved" : "Approve"}</button>
          </>
        )}
      </footer>
    </motion.aside>
  );
}

export const DRAFT_STATUS_META: Record<ArcAssetStatus | "review", { label: string; tone: string }> = {
  review: { label: WORK_STATE_LABEL.needs_you, tone: "muted" },
  draft: { label: WORK_STATE_LABEL.needs_you, tone: "muted" },
  revision: { label: WORK_STATE_LABEL.needs_changes, tone: "accent" },
  approved: { label: WORK_STATE_LABEL.approved, tone: "ok" },
  rejected: { label: WORK_STATE_LABEL.declined, tone: "red" },
};

/**
 * An Arc-drafted deliverable, in-flow: title + channel + status, the draft preview
 * (so it never reads empty when an asset exists), structured detail, guardrail
 * checks, and — when the card is approval-gated — Approve / Revise / Decline
 * wired to the real campaign decision flow. Cards without an approval hook fall
 * back to a compact deep-link.
 */
export function ArcDraftCard({ card }: { card: ArcActionCard }) {
  // The inline card owns its status locally (it isn't part of a package summary);
  // the shared hook drives the decision flow and hands the resolved status back.
  const [status, setStatus] = useState<ArcAssetStatus | null>(card.status ?? null);
  const approval = card.approval;
  const destination = card.appState?.href ?? card.href;
  const meta = DRAFT_STATUS_META[status ?? "review"] ?? DRAFT_STATUS_META.review;
  const { busy, notice, reviseOpen, reviseText, setReviseText, decided, decide, submitRevision, openRevise, cancelRevise } = useDraftDecision({
    approval,
    status,
    onResolved: (_assetId, next) => setStatus(next),
  });

  return (
    <div className="arc-draft" data-status={status ?? "review"}>
      <div className="arc-draft-head">
        <span className="arc-draft-icon"><FileText size={16} /></span>
        <span className="arc-draft-title"><b>{card.title}</b>{card.channel || card.format ? <small>{[card.channel, card.format].filter(Boolean).join(" · ")}</small> : null}</span>
        <span className={`arc-draft-status is-${meta.tone}`}><i />{meta.label}</span>
      </div>
      {card.preview ? <p className="arc-draft-preview">{card.preview}</p> : null}
      {card.rows.length > 0 ? (
        <div className="arc-draft-rows">
          {card.rows.slice(0, 4).map((row, index) => (
            <div key={`${row.name}-${index}`}><b>{row.name}</b>{row.meta ? <span>{row.meta}</span> : null}{row.badge ? <em>{row.badge}</em> : null}</div>
          ))}
        </div>
      ) : null}
      {card.flags.length > 0 ? <div className="arc-draft-flags">{card.flags.slice(0, 3).map((flag, index) => <span key={`${flag.label}-${index}`} className={`arc-action-flag is-${flag.tone}`}>{flag.label}</span>)}</div> : null}
      {reviseOpen ? (
        <form className="arc-draft-revise" onSubmit={submitRevision}>
          <textarea autoFocus rows={2} value={reviseText} onChange={(event) => setReviseText(event.target.value)} placeholder={`What should Arc change in the ${(card.channel ?? "draft").toLowerCase()}?`} />
          <div>
            <button type="button" onClick={cancelRevise}>Cancel</button>
            <button type="submit" className="is-primary" disabled={!reviseText.trim() || busy}>Send revision</button>
          </div>
        </form>
      ) : (
        <div className="arc-draft-foot">
          {notice ? <span className="arc-draft-notice" role="status" aria-live="polite">{notice}</span> : null}
          <div className="arc-draft-actions">
            {destination?.startsWith("/") ? <Link className="arc-draft-open" href={destination}>Open <ArrowRight size={13} /></Link> : null}
            {approval ? (
              <>
                <button type="button" className="arc-draft-btn" onClick={openRevise} disabled={busy || decided}><PencilLine size={13} /> Revise</button>
                <button type="button" className="arc-draft-btn" onClick={() => decide("declined")} disabled={busy || decided}><X size={13} /> Decline</button>
                <button type="button" className="arc-draft-btn is-approve" onClick={() => decide("approved")} disabled={busy || decided}><Check size={14} /> {status === "approved" ? "Approved" : "Approve"}</button>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/** A source/citation icon keyed to the mentioned record's type. */
export function MentionIcon({ type }: { type: ArcMention["type"] }) {
  const size = 12;
  if (type === "campaign") return <Megaphone size={size} />;
  if (type === "vault") return <Bookmark size={size} />;
  if (type === "property" || type === "job" || type === "outcome") return <Database size={size} />;
  if (type === "company" || type === "contact" || type === "lead" || type === "persona") return <Users size={size} />;
  return <FileText size={size} />;
}

/** "Sources Arc used" — the records Arc referenced for this reply, each a clickable
 *  deep-link to the record. Makes the evidence behind an answer navigable. */
export function SourcesRow({ mentions, onMentionContextMenu }: { mentions: ArcMention[]; onMentionContextMenu?: (event: React.MouseEvent, mention: ArcMention) => void }) {
  if (mentions.length === 0) return null;
  const menuFor = (mention: ArcMention) =>
    onMentionContextMenu ? (event: React.MouseEvent) => onMentionContextMenu(event, mention) : undefined;
  return (
    <div className="arc-sources">
      <span><Link2 size={13} /> Sources</span>
      {mentions.slice(0, 8).map((mention, index) => (
        mention.href?.startsWith("/")
          ? <Link key={`${mention.type}-${mention.id}-${index}`} href={mention.href} className="arc-source" onContextMenu={menuFor(mention)}><MentionIcon type={mention.type} />{mention.label}</Link>
          : <span key={`${mention.type}-${mention.id}-${index}`} className="arc-source is-static" onContextMenu={menuFor(mention)}><MentionIcon type={mention.type} />{mention.label}</span>
      ))}
    </div>
  );
}

/** Recalled Brain memory used for this reply — each chip links to its node in the
 *  Brain (via `?node=`), so a citation lands on the exact fact. */
export function RecallRow({ recall: rawRecall, onRecallContextMenu }: { recall: ArcRecall[]; onRecallContextMenu?: (event: React.MouseEvent, item: ArcRecall) => void }) {
  const [expanded, setExpanded] = useState(false);
  // Recall arrives with repeats — the same fact matched by several queries comes
  // back once per match, so the row rendered "Lead: csv 65%" three times and then
  // offered to show four more of the same. One chip per distinct fact.
  const recall = rawRecall.filter(
    (item, index) => rawRecall.findIndex((other) => (other.nodeId ?? other.label) === (item.nodeId ?? item.label)) === index,
  );
  if (recall.length === 0) return null;
  const visibleCount = visibleRecallCount(recall.length, expanded);
  const remaining = recall.length - visibleCount;
  const menuFor = (item: ArcRecall) =>
    onRecallContextMenu ? (event: React.MouseEvent) => onRecallContextMenu(event, item) : undefined;
  return (
    <div className="arc-recall">
      <span><Brain size={14} /> Recalled</span>
      {recall.slice(0, visibleCount).map((item, index) => {
        // The fact, not the brain's node key. A chip reading
        // `crm_contacts_empty` cites nothing a human can check; the summary is
        // the sentence Arc actually recalled, clipped to chip length with the
        // full text on hover.
        const fact = item.summary?.trim() || item.label;
        const short = fact.length > 52 ? `${fact.slice(0, 51).trimEnd()}…` : fact;
        const inner = <>{short}{item.confidence != null ? <small>{Math.round(item.confidence * 100)}%</small> : null}</>;
        return item.nodeId
          ? <Link key={`${item.label}-${index}`} href={`/brain?node=${encodeURIComponent(item.nodeId)}`} className="arc-recall-chip" title={fact} onContextMenu={menuFor(item)}>{inner}</Link>
          : <span key={`${item.label}-${index}`} className="arc-recall-chip is-static" title={fact} onContextMenu={menuFor(item)}>{inner}</span>;
      })}
      {recall.length > visibleCount || expanded ? (
        <button
          type="button"
          className="arc-recall-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : `Show ${remaining} more`}
          <ChevronDown size={12} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function QuestionPrompt({ question, onChoose, onDismiss }: { question: ArcQuestion; onChoose: (value: string) => void; onDismiss: () => void }) {
  return (
    <div className="arc-question">
      <div><b>{question.prompt}</b><div className="arc-question-options">{question.options.map((option, index) => <button type="button" key={`${option}-${index}`} onClick={() => onChoose(option)}>{option}</button>)}</div></div>
      <button type="button" className="arc-icon-button" onClick={onDismiss} aria-label="Dismiss question"><X size={15} /></button>
    </div>
  );
}

export function MessageActions({ message, onRegenerate }: { message: ArcMessage; onRegenerate?: () => void }) {
  const [feedback, setFeedback] = useState<"up" | "down" | null>(message.feedback);
  const [saved, setSaved] = useState(false);
  const [remembered, setRemembered] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, startAction] = useTransition();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.body);
      setNotice("Copied");
    } catch {
      setNotice("Copy failed");
    }
  };

  const rate = (value: "up" | "down") => {
    const previous = feedback;
    const next = feedback === value ? null : value;
    setFeedback(next);
    setNotice(null);
    startAction(async () => {
      const result = await setArcMessageFeedbackAction({ messageId: message.id, value: next });
      if (!result.ok) {
        setFeedback(previous);
        setNotice(result.error);
      } else {
        setNotice(next ? "Feedback saved" : "Feedback cleared");
      }
    });
  };

  const save = () => startAction(async () => {
    const result = await saveArcMessageAction(message.id);
    setSaved(result.ok);
    setNotice(result.ok ? "Saved to your Arc library" : result.error);
  });

  const remember = () => startAction(async () => {
    const result = await saveArcMessageToBrainAction(message.id);
    setRemembered(result.ok);
    setNotice(result.ok ? "Remembered in the Brain" : result.error);
  });

  return (
    <div className="arc-message-action-row">
      <div className="arc-message-actions">
        <button type="button" aria-label="Copy response" title="Copy response" onClick={copy}><Copy size={15} /></button>
        <button type="button" aria-label="Good response" title="Good response" aria-pressed={feedback === "up"} className={feedback === "up" ? "is-active" : ""} onClick={() => rate("up")} disabled={busy}><ThumbsUp size={15} /></button>
        <button type="button" aria-label="Bad response" title="Bad response" aria-pressed={feedback === "down"} className={feedback === "down" ? "is-active" : ""} onClick={() => rate("down")} disabled={busy}><ThumbsDown size={15} /></button>
        <button type="button" aria-label={saved ? "Response saved" : "Save response"} title={saved ? "Saved" : "Save response"} aria-pressed={saved} className={saved ? "is-active" : ""} onClick={save} disabled={busy || saved}><Bookmark size={15} /></button>
        <button type="button" aria-label={remembered ? "Remembered in the Brain" : "Save to Brain"} title={remembered ? "Remembered in the Brain" : "Save to Brain"} aria-pressed={remembered} className={remembered ? "is-active" : ""} onClick={remember} disabled={busy || remembered}><Brain size={15} /></button>
        {onRegenerate ? <button type="button" aria-label="Regenerate response" title="Regenerate response" onClick={() => { setNotice("Regenerating…"); onRegenerate(); }} disabled={busy}><RotateCcw size={15} /></button> : null}
      </div>
      <span className="arc-message-action-notice" role="status" aria-live="polite">{notice}</span>
    </div>
  );
}

/* ── Message context menu ─────────────────────────────────────────────────
   Right-click on a message bubble. Portaled to <body> because the chat root is
   a size container (layout containment), which would otherwise trap and clip a
   fixed-position menu. One menu instance per conversation, owned by the
   useMessageContextMenu hook. */

export type MessageMenuItem =
  | {
      kind: "item";
      label: string;
      icon?: React.ReactNode;
      /** Muted right-aligned annotation, e.g. why an item is disabled. */
      hint?: string;
      disabled?: boolean;
      /** A returned string is shown as a transient toast near the menu origin. */
      onSelect: () => void | string | null | Promise<void | string | null>;
    }
  | { kind: "separator" };

/* The menu escapes the chat root's containment via a portal — but it must land
   inside `.arc-app`, not <body>, because the theme variables it styles with are
   scoped to that wrapper. `.arc-app` has no transform/containment, so `fixed`
   still positions against the viewport there. */
function menuPortalRoot(): Element {
  return document.querySelector(".arc-app") ?? document.body;
}

function MessageContextMenu({
  x,
  y,
  items,
  onSelect,
  onClose,
}: {
  x: number;
  y: number;
  items: MessageMenuItem[];
  onSelect: (item: Extract<MessageMenuItem, { kind: "item" }>) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Some platforms deliver a duplicate contextmenu right after the one that
  // opened us (observed with synthetic input drivers; long-press can too).
  // Ignore contextmenu-based dismissal in the first beat after mount so the
  // duplicate doesn't instantly close the menu it just opened.
  const mountedAtRef = useRef<number>(0);
  useEffect(() => { mountedAtRef.current = performance.now(); }, []);
  const [pos, setPos] = useState({ left: x, top: y });

  // Clamp to the viewport once the real size is known (flip up/left near edges).
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    setPos({ left, top });
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const dismissIfOutside = (event: Event) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      if (event.type === "contextmenu" && performance.now() - mountedAtRef.current < 200) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") { onClose(); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      if (!buttons.length) return;
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown"
        ? buttons[(current + 1) % buttons.length]
        : buttons[(current - 1 + buttons.length) % buttons.length];
      next?.focus();
    };
    document.addEventListener("pointerdown", dismissIfOutside, true);
    document.addEventListener("contextmenu", dismissIfOutside, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", dismissIfOutside, true);
      document.removeEventListener("contextmenu", dismissIfOutside, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div ref={menuRef} className="arc-context-menu" role="menu" style={{ left: pos.left, top: pos.top }}>
      {items.map((item, index) =>
        item.kind === "separator" ? (
          <div className="arc-context-sep" role="separator" key={`sep-${index}`} />
        ) : (
          <button type="button" role="menuitem" key={`${item.label}-${index}`} disabled={item.disabled} onClick={() => onSelect(item)}>
            {item.icon}
            <span>{item.label}</span>
            {item.hint ? <small>{item.hint}</small> : null}
          </button>
        ),
      )}
    </div>,
    menuPortalRoot(),
  );
}

export function useMessageContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MessageMenuItem[] } | null>(null);
  const [toast, setToast] = useState<{ x: number; y: number; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const openMenu = (event: React.MouseEvent, items: MessageMenuItem[]) => {
    // Hold the native menu on plain right-click, keep it on modified clicks so
    // "Inspect element" style workflows stay reachable via Shift+right-click.
    if (event.shiftKey) return;
    if (!items.length) return;
    event.preventDefault();
    event.stopPropagation();
    setToast(null);
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  const handleSelect = (item: Extract<MessageMenuItem, { kind: "item" }>) => {
    const origin = menu;
    setMenu(null);
    void Promise.resolve(item.onSelect()).then((result) => {
      if (typeof result !== "string" || !result || !origin) return;
      setToast({ x: origin.x, y: origin.y, text: result });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 2200);
    });
  };

  const element = (
    <>
      {menu ? <MessageContextMenu x={menu.x} y={menu.y} items={menu.items} onSelect={handleSelect} onClose={() => setMenu(null)} /> : null}
      {toast
        ? createPortal(
            <div className="arc-context-toast" role="status" style={{ left: toast.x, top: toast.y }}>{toast.text}</div>,
            menuPortalRoot(),
          )
        : null}
    </>
  );

  return { openMenu, menuElement: element };
}

/** Clipboard copy shared by the hover row and the context menu. */
export async function copyMessageText(body: string): Promise<string> {
  try {
    await navigator.clipboard.writeText(body);
    return "Copied";
  } catch {
    return "Copy failed";
  }
}

export function operatorMessageBefore(messages: ArcMessage[], index: number): ArcMessage | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor]?.role === "operator") return messages[cursor] ?? null;
  }
  return null;
}
