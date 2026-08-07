import { findStage, statusTone, type PipelineStage } from "@/domain";
import type { CustomRecord } from "@/lib/custom-objects/records";

import type { CrmRowVM } from "../_components/crm-board";

/**
 * A tenant-defined record, in the shape the board already renders.
 *
 * The board is built around CrmRowVM and every column reads from it, so the
 * cheapest correct way to show a custom object is to speak that shape rather
 * than fork the table. The fields the six carry and a custom object does not —
 * persona, score, status tone, routing — are left empty on purpose: the custom
 * COLS set never asks for them, and inventing values would put a "—" under a
 * heading no custom object has.
 */

function initialsOf(name: string): string {
  return (
    (name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "•"
  );
}

/** "3h ago" / "2d ago", matching the six. */
function relativeTime(iso: string): { rel: string; time: string } {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return { rel: "—", time: "" };
  const ms = Date.now() - then.getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return { rel: "now", time: "" };
  if (mins < 60) return { rel: `${mins}m ago`, time: "" };
  const hours = Math.round(mins / 60);
  if (hours < 24) {
    return { rel: `${hours}h ago`, time: then.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) };
  }
  const days = Math.round(hours / 24);
  return { rel: `${days}d ago`, time: then.toLocaleDateString("en-US", { month: "short", day: "numeric" }) };
}

export function customRecordToRow(
  objectKey: string,
  record: CustomRecord,
  /** The object's own stages, empty when it has no pipeline. */
  stages: readonly PipelineStage[] = [],
): CrmRowVM {
  const { rel, time } = relativeTime(record.updatedAt);
  // Ask the stage for its label and meaning rather than matching the key to a
  // word — the tenant renames these, and a name comparison fails silently.
  // An unknown key (its stage archived) shows the raw value instead of
  // vanishing, so the record is visibly odd rather than quietly stageless.
  const stage = findStage(stages, record.status);
  const statusLabel = stage?.label ?? (record.status ?? "");
  return {
    id: record.id,
    name: record.title,
    detail: record.subtitle ?? "",
    initials: initialsOf(record.title),
    isCompany: false,
    statusLabel,
    statusTone: statusLabel ? statusTone(statusLabel, stage) : "",
    persona: "",
    dot: "var(--muted)",
    score: null,
    scoreColor: "var(--muted)",
    owner: record.origin === "agent" ? "Arc" : "You",
    updatedRel: rel,
    updatedTime: time,
    href: `/crm/${objectKey}/${record.id}`,
    company: "",
    value: "",
    tier: "",
    routing: "",
    tasks: "",
  };
}
