/**
 * One CRM record as the board renders it, plus the small formatters it needs.
 *
 * Shared because two callers need the SAME shape: the page's initial render and
 * the server-side search action (BSR-633), which reaches records the page's
 * 1,000-row window never loaded. A second copy of this mapping is how search
 * results start looking subtly different from the rows beside them.
 */
import { humanizePersonaLabel } from "@/domain";
import { type CrmObjectRow } from "@/lib/crm/read-model";

import { type CrmRowVM } from "../_components/crm-board";

function initials(name: string): string {
  return (
    (name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "•"
  );
}

function humanizePersona(persona: string): string {
  const label = humanizePersonaLabel(persona);
  return /^unassigned/i.test(label) ? "" : label;
}

function personaDot(persona: string): string {
  const p = (persona || "").toLowerCase();
  if (/emergency|urgent|storm|hail|flood|fire|burst|water\s*damage/.test(p)) return "#cc6a6a"; // red — urgent
  if (/insurance|adjuster|agent/.test(p)) return "#88b6d8"; // blue
  if (/plumb|partner|contractor|referral|vendor|trade|sub/.test(p)) return "#7fb89a"; // green
  if (/preventative|preventive|maintenance|monitor|inspection/.test(p)) return "#6fae9e"; // teal
  if (/rebuild|restoration|reconstruct|remodel|renov/.test(p)) return "#d8a24a"; // amber
  if (/hoa|board|association|landlord|tenant/.test(p)) return "#9678c8"; // purple
  if (/past|repeat|existing|customer|reactivat/.test(p)) return "#b58fd0"; // light purple
  if (/property|manager|realtor|commercial|reit/.test(p)) return "#c8a24a"; // gold
  return "#c8a24a"; // gold default
}

function scoreColor(score: number): string {
  if (score >= 70) return "var(--ok)";
  if (score >= 40) return "var(--accent)";
  return "var(--muted)";
}

function relativeTime(value: string): string {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return value && !/^now$/i.test(value) ? value : "now";
  const min = Math.round((Date.now() - then) / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Absolute time for the second line of the "Last activity" cell (mockup: "10:42 AM" / "Jun 24").
function timeLabel(value: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function toRow(row: CrmObjectRow): CrmRowVM {
  const persona = humanizePersona(row.personaTag);
  // Mockup subtitle is "role · location" (dot-separated, no email). Drop email
  // segments and the slash separators the read-model emits.
  const detailText = (row.detail || row.sourceLabel || "")
    .split(/\s*[/·]\s*/)
    .map((s) => s.trim())
    .filter((s) => s && !s.includes("@"))
    .slice(0, 2)
    .join(" · ");
  return {
    id: row.id,
    name: row.name,
    detail: detailText,
    initials: initials(row.name),
    isCompany: row.objectKey === "companies",
    statusLabel: row.status || "—",
    statusTone: row.statusTone,
    persona,
    dot: personaDot(row.personaTag),
    score: typeof row.score === "number" ? Math.round(row.score) : null,
    scoreColor: typeof row.score === "number" ? scoreColor(row.score) : "var(--muted)",
    owner: row.owner || "—",
    updatedRel: relativeTime(row.updated),
    updatedTime: timeLabel(row.updated),
    href: row.href,
    company: (row.relationships.find((r) => /compan/i.test(r.label))?.value ?? "").replace(/\s+\d{8,}$/, "").trim(),
    value: row.valueLabel || "",
    tier: "",
    routing: "",
    tasks: row.openTasks ? `${row.openTasks} open` : "",
  };
}
