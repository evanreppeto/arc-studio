/**
 * Page-window math for the CRM board (BSR-683).
 *
 * Pulled out of the component so the off-by-one-prone part — the displayed
 * range, the last partial page, and the clamp when the set shrinks under a
 * stale page index — is testable. The component's own wiring (buttons that
 * actually call setPage, a select that actually calls setPageSize) is not
 * covered here: this repo runs vitest in `environment: "node"` with no
 * component renderer, so "the control has a handler" and "the table renders at
 * a real height" are browser-verified properties, not unit-testable ones. That
 * gap is exactly how the original bug shipped — a pager whose buttons had no
 * onClick at all, under a footer that correctly read "1–100 of 254".
 */

export type PageWindow = {
  /** Never below 1, so an empty set still reports "page 1 of 1". */
  totalPages: number;
  /** `page` clamped into range — a filter can shrink the set under a stale index. */
  safePage: number;
  /** Zero-based slice start. */
  start: number;
  /** Zero-based slice end (exclusive). */
  end: number;
};

export function pageWindow(total: number, page: number, pageSize: number): PageWindow {
  const size = Math.max(1, Math.floor(pageSize));
  const count = Math.max(0, Math.floor(total));
  const totalPages = Math.max(1, Math.ceil(count / size));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (safePage - 1) * size;
  return { totalPages, safePage, start, end: Math.min(start + size, count) };
}

/**
 * The "1–25 of 254" label. Takes the count of rows actually on screen rather
 * than recomputing it, so a short last page reports what it shows.
 */
export function pageRangeLabel(start: number, shown: number, total: number): string {
  if (shown === 0) return `0 of ${total.toLocaleString()}`;
  return `${(start + 1).toLocaleString()}–${(start + shown).toLocaleString()} of ${total.toLocaleString()}`;
}
