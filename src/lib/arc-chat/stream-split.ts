/**
 * Split streamed markdown into a prefix that has settled and the block still
 * being written.
 *
 * Streaming re-renders the reply on every animation frame, and re-parsing the
 * whole document each time is linear in reply length: measured through the
 * chat's own react-markdown + remark-gfm pipeline, a 2,300-word reply costs
 * ~4.3ms per render — ~260ms of work for every second of streaming — while one
 * in-progress paragraph costs ~0.11ms. Rendering the settled prefix through a
 * memoized component and re-parsing only the tail turns that back into roughly
 * constant work per frame.
 *
 * Because the reply is append-only, the boundary only ever moves forward, so
 * the memoized prefix stays stable until a new block completes.
 *
 * The split has to be conservative: `settled` and `tail` are parsed as separate
 * documents, so a boundary that lands *inside* a construct would change how it
 * renders — a loose list split across the boundary would become two lists, and
 * an ordered list would restart its numbering. We therefore only split where the
 * next block unambiguously starts something new, and fall back to "nothing has
 * settled yet" whenever that can't be established. A wrong split is a visible
 * rendering bug; a missed split only costs the optimisation.
 *
 * Not handled, deliberately: link reference definitions (`[x]: https://…`) that
 * appear in the tail but are used in the prefix would fail to resolve. Arc emits
 * inline links, not reference links.
 */

/** ```/~~~ fence open or close, allowing up to three leading spaces. */
const FENCE = /^ {0,3}(```|~~~)/;
/** `-`, `*`, `+`, `1.` or `1)` list markers. */
const LIST_ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/;
/** Lines that lean on what came before them: lazy indented continuations,
 *  blockquote lines, and table rows. */
const CONTINUATION = /^(\s{2,}|>|\|)/;

type Block = { start: number; end: number; isList: boolean; continues: boolean };

/** Group lines into blank-line-separated blocks, treating a fenced code span as
 *  one block however many blank lines it contains. */
function toBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let inFence = false;
  let start = -1;

  const close = (end: number) => {
    if (start === -1) return;
    const first = lines[start] ?? "";
    blocks.push({ start, end, isList: LIST_ITEM.test(first), continues: CONTINUATION.test(first) });
    start = -1;
  };

  lines.forEach((line, index) => {
    if (FENCE.test(line)) {
      if (start === -1) start = index;
      inFence = !inFence;
      // A closing fence ends the block; an opening one keeps collecting.
      if (!inFence) close(index + 1);
      return;
    }
    if (!inFence && line.trim() === "") {
      close(index);
      return;
    }
    if (start === -1) start = index;
  });
  close(lines.length);

  return blocks;
}

/**
 * Can the document be cut between these two blocks without changing how either
 * renders? Splitting *before* a list is fine — the whole list lands in the tail.
 * Splitting *between two list items* is not: parsed as separate documents they
 * become two lists, and an ordered list restarts its numbering.
 */
function canSplitBetween(before: Block, after: Block): boolean {
  if (after.continues) return false;
  if (before.isList && after.isList) return false;
  return true;
}

export function splitStreamedMarkdown(text: string): { settled: string; tail: string } {
  if (!text) return { settled: "", tail: "" };

  const lines = text.split("\n");
  const blocks = toBlocks(lines);
  // Nothing has settled until at least one block is complete and another has
  // started — the tail must always keep a block for the caret to attach to.
  if (blocks.length < 2) return { settled: "", tail: text };

  let boundary = -1;
  for (let index = 1; index < blocks.length; index += 1) {
    if (canSplitBetween(blocks[index - 1]!, blocks[index]!)) boundary = index;
  }
  if (boundary < 1) return { settled: "", tail: text };

  const tailStart = blocks[boundary]!.start;
  return {
    settled: lines.slice(0, tailStart).join("\n").replace(/\s+$/, ""),
    tail: lines.slice(tailStart).join("\n"),
  };
}
