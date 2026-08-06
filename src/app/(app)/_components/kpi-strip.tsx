import { Sparkline } from "./sparkline";

export type KpiTone = "default" | "attention" | "ok";

export type KpiCell = {
  label: string;
  /** The number itself. Leave empty and pass `emptyHint` when there isn't one yet. */
  value: string;
  /** Trend delta, e.g. "+12.5%". `dir` colours it: up=green, dn=red, flat=muted. */
  delta?: { label: string; dir: "up" | "dn" | "flat" };
  /**
   * The line under the value. This is where the comparison window belongs — a
   * delta with no period is decoration (BSR-659), so prefer "vs previous 30 days"
   * over a bare "580 prev".
   */
  sublabel?: string;
  /** Trend series for the inline sparkline. Omit for count-style metrics. */
  spark?: { points: number[]; up: boolean };
  /** Gold for "needs you", green for healthy. Never red — see DESIGN.md §4.2. */
  tone?: KpiTone;
  /**
   * Shown in place of the value when there is no data yet. It must say what the
   * USER would have to do — "Starts once you send your first campaign" — never
   * which input our pipeline is missing.
   */
  emptyHint?: string;
};

/**
 * The one KPI strip (BSR-658).
 *
 * There were seven: `.metrics`, `.okpis`, `.kpis`, `.asum`, `.pstats`, `.bstats`,
 * `.jr-kpis` — each hand-rolled in its own CSS, six of them an equal
 * `repeat(N, 1fr)` row, which DESIGN.md §5 and the Calm Principles both ban in
 * bold. This component was built for exactly this job and only CRM ever used it.
 *
 * Because each was built separately the CELLS disagreed too: Outbox put the
 * value above the label and everything else put it below; Analytics carried a
 * "prev" line nobody else had; Personas carried a mono sublabel; CRM's middle
 * cell had neither the sparkline nor the delta its neighbours had, so the row
 * looked broken. One component means one cell anatomy.
 *
 * Layout is asymmetric on purpose: the first metric is the lead and takes ~1.5×
 * the width, which satisfies the design rule instead of fighting it. Four cells
 * or fewer is the intent; five is the ceiling for a single row, and only because
 * Analytics and Journeys genuinely track five things.
 *
 * Six is the one count that wraps: campaign performance tracks six metrics on
 * both its demo AND its attributed path, so the number is the surface's real
 * shape rather than a strip that grew. It lays out 3×2 — the same footprint the
 * hand-rolled `.perfkpis` grid had — but over the shared asymmetric columns
 * instead of the `repeat(3, 1fr)` DESIGN.md §5 bans. Seven would be a prompt to
 * cut a metric, not to add a rule.
 */
export type KpiStripTone = "quiet" | "full";

/** A value that is present but reports nothing: "0", "$0", "0%", "—", "". */
function isZeroish(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "—") return true;
  // Strip currency, separators and units, then ask whether anything is left.
  const digits = trimmed.replace(/[^0-9.]/g, "");
  return digits === "" || Number.parseFloat(digits) === 0;
}

/**
 * How loudly this strip should speak (BSR-738).
 *
 * Follows BSR-703's rule for the Studio spend strip: change VOLUME, not
 * visibility. A strip whose every cell reads zero, with no movement behind any
 * of them, has nothing to report — and on a live workspace with 243 contacts it
 * was three big serif zeros with flat sparklines occupying the top of both Home
 * and CRM, which reads as broken rather than as empty.
 *
 * Quiet still states every number. It just stops shouting them.
 *
 * Pure and exported so the threshold is assertable — a silent drift back to
 * always-loud is exactly the change nobody would notice.
 */
export function kpiStripTone(items: KpiCell[]): KpiStripTone {
  if (items.length === 0) return "full";
  const everyValueEmpty = items.every((m) => isZeroish(m.value));
  const anyMovement = items.some((m) => (m.spark?.points ?? []).some((point) => point !== 0));
  return everyValueEmpty && !anyMovement ? "quiet" : "full";
}

export function KpiStrip({ items, className }: { items: KpiCell[]; className?: string }) {
  if (items.length === 0) return null;

  if (kpiStripTone(items) === "quiet") {
    return (
      <div className={`kpistrip is-quiet${className ? ` ${className}` : ""}`}>
        {items.map((m) => (
          <span key={m.label}>
            {m.label} <b>{m.value || "—"}</b>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className={`kpistrip${className ? ` ${className}` : ""}`} data-count={Math.min(items.length, 6)}>
      {items.map((m) => (
        <div className={`kpicell${m.tone && m.tone !== "default" ? ` ${m.tone}` : ""}`} key={m.label}>
          <div className="kpilabel">{m.label}</div>
          <div className="kpirow">
            <span className={`kpivalue${m.value ? "" : " is-empty"}`}>{m.value || "—"}</span>
            {m.value && m.delta && m.delta.label && m.delta.label !== "—" ? (
              <span className={`kpidelta ${m.delta.dir}`}>{m.delta.label}</span>
            ) : null}
          </div>
          {m.spark && m.spark.points.length > 1 ? (
            <div className="kpispark">
              <Sparkline points={m.spark.points} up={m.spark.up} />
            </div>
          ) : null}
          {!m.value && m.emptyHint ? (
            <div className="kpisub is-hint">{m.emptyHint}</div>
          ) : m.sublabel ? (
            <div className="kpisub">{m.sublabel}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
