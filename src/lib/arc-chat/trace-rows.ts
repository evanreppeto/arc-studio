/**
 * Tidy the live run trace down to what is worth a line of its own.
 *
 * The raw trace lists every reported step, which turned a simple turn into a
 * four-item checklist of internal phases sitting under a header that already
 * named the current one — the same information three times over, in more space
 * than the answer.
 *
 * Two rules:
 *
 * 1. The step in progress is the header. It does not also get a row.
 * 2. Finished phases that carried no reasoning and touched nothing are
 *    bookkeeping, not events. Consecutive ones collapse into a single quiet
 *    line, the way Codex groups "Loaded tools, read files, ran a command".
 *
 * Anything with narration behind it, or any tool call, keeps its own row —
 * those are the lines that actually say what happened.
 */

export type TraceRow = {
  id: string;
  label: string;
  detail?: string;
  result?: string;
  isTool?: boolean;
  status: "queued" | "running" | "done" | "error";
  /** Icon key, carried through so a grouped line still has one. */
  kind?: string;
};

/** Sentence-case a label so joined fragments read as one phrase. */
function lower(label: string, first: boolean): string {
  if (first) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

export function collapseTraceRows<T extends TraceRow>(rows: T[]): (T | TraceRow)[] {
  const out: (T | TraceRow)[] = [];
  let run: T[] = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      out.push(run[0]!);
    } else {
      out.push({
        id: `grouped-${run[0]!.id}`,
        label: run.map((row, index) => lower(row.label, index === 0)).join(", "),
        status: "done",
        kind: run[0]!.kind,
      });
    }
    run = [];
  };

  for (const row of rows) {
    // The running step is the header; showing it again is the duplication.
    if (row.status === "running") {
      flush();
      continue;
    }
    const isBookkeeping = row.status === "done" && !row.isTool && !row.detail?.trim() && !row.result?.trim();
    if (isBookkeeping) {
      run.push(row);
      continue;
    }
    flush();
    out.push(row);
  }
  flush();
  return out;
}
