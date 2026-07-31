// Shared view types for the Arc chat surface. Kept in one leaf module so the
// container (arc-view.tsx), the demo data layer (arc-demo-data.ts), and the
// presentational components can all reference the same shapes without importing
// each other. Pure types only — no runtime, no JSX.

import type { ArcMode } from "@/domain";
import type { ArcWaitingOpp } from "@/lib/arc-chat/waiting-opps";

/** A single unit of Arc's live/receipt worklog — a step or a tool call, normalized
 *  into one row the run trace and work panel both render. */
export type RunKind = "think" | "search" | "match" | "draft" | "media" | "tool";

export type RunRow = {
  id: string;
  label: string;
  detail?: string;
  result?: string;
  isTool?: boolean;
  status: "queued" | "running" | "done" | "error";
  kind: RunKind;
  /** A line of Arc's own prose rather than an action — rendered as text, with no
   *  label and no status tick. */
  isNarration?: boolean;
};

/** One turn in the backend-less demo conversation (no persistence). */
export type DemoTurn = {
  id: string;
  role: "operator" | "arc";
  body: string;
  outcome?: "complete" | "canceled";
  mode?: ArcMode;
  command?: string | null;
};

/** Which composer popover is open — null closed. */
export type ComposerMenu = "tools" | "mode" | "model" | "mentions" | "commands" | null;

/** Work waiting on the operator, surfaced in the launcher: approval + opportunity
 *  counts, plus the top opportunity nudges to greet them with. */
export type ArcWaiting = { approvals: number; opportunities: number; items?: ArcWaitingOpp[] };

/** A conversation row in the thread drawer. */
export type ThreadItem = {
  id: string;
  title: string;
  preview?: string | null;
  when: string;
  pinned?: boolean;
  running?: boolean;
  campaignId?: string | null;
};
