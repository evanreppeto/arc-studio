import type { ScanStatus } from "@/lib/opportunities/scan-status";

/**
 * How the inbox describes Arc's last background scan.
 *
 * The whole point is that these six outcomes must not look alike. Before this,
 * every one of them rendered as the same unchanged inbox — a scan that added
 * three opportunities, one that considered the workspace and found nothing, and
 * one that died without starting were indistinguishable, which is how a broken
 * scan went unnoticed on 2026-08-04.
 *
 * Pure, so the copy is locked by tests rather than only by eye — the same reason
 * `scanMessage` in scan-feedback.ts is pure.
 */

export type ScanStatusLine = {
  /** Leading sentence, always safe to show on its own. */
  text: string;
  /** Arc's own words / the error, when there are any worth showing. */
  detail: string | null;
  /** Drives the dot colour: gold needs attention, green is healthy, muted is idle. */
  tone: "ok" | "warn" | "muted";
};

/** "just now" / "14m ago" / "3h ago" / "2d ago" — coarse on purpose; this is a status line. */
export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Arc's words alone, with the runner's bookkeeping stripped off the front.
 *
 * The stored summary is "Opportunity scan complete — proposed 0 opportunity(ies).
 * Arc's reason: …", and the count is already in the line above it. Tasks written
 * before the runner recorded a reason have ONLY that prefix, so stripping it
 * correctly leaves nothing to show rather than an echo.
 */
export function reasonOnly(detail: string | null): string | null {
  if (!detail) return null;
  const stripped = detail
    .replace(/^Opportunity scan complete\s*[—-]\s*proposed\s+\d+\s+opportunit(?:y|ies)\(?i?e?s?\)?\.?\s*/i, "")
    .replace(/^Arc's reason:\s*/i, "")
    .trim();
  return stripped || null;
}

export function scanStatusLine(status: ScanStatus, now: number = Date.now()): ScanStatusLine {
  const when = relativeTime(status.finishedAt ?? status.startedAt, now);
  const ago = when ? ` ${when}` : "";

  switch (status.outcome) {
    case "never":
      return { text: "Arc hasn't scanned this workspace yet.", detail: null, tone: "muted" };

    case "running":
      return { text: "Arc is scanning now…", detail: null, tone: "ok" };

    // The 2026-08-04 case. A wake that never landed leaves a task open forever,
    // and saying "scanning now" three hours later would be a comforting lie.
    case "stalled":
      return {
        text: `Arc's scan started${ago} and never finished.`,
        detail: reasonOnly(status.detail),
        tone: "warn",
      };

    // The error is shown verbatim — it is the one string here that must never be
    // edited on its way to the reader.
    case "failed":
      return { text: `Arc's last scan${ago} failed.`, detail: status.detail, tone: "warn" };

    case "added": {
      const count = status.proposed ?? 0;
      return { text: `Arc scanned${ago} and added ${plural(count, "opportunity", "opportunities")}.`, detail: null, tone: "ok" };
    }

    case "empty":
    default:
      // Deliberately not "no opportunities found": Arc looked and judged there
      // was nothing new, which is a result. The reason is the interesting part
      // and is exactly what used to be discarded.
      return {
        text: `Arc scanned${ago} and found nothing new.`,
        detail: reasonOnly(status.detail),
        tone: "muted",
      };
  }
}
